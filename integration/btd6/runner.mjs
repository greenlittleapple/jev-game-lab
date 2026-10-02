// Wires core/runner.mjs and core/hierarchical.mjs to the BTD6 bridge. The command-line entry that
// starts a match and runs this loop is run-cli.mjs (npm run btd6:run); session.mjs has the lifecycle.
import {createRunner} from '../../core/runner.mjs';
import {decide} from '../../core/hierarchical.mjs';
import {btd6Game, claudeGameV1, playbookGameV5} from './game.mjs';
import {CLAUDE_POLICY_V1, CLAUDE_V1_REVISION, passedTargets} from './plan-v1.mjs';
import {PLAYBOOK_POLICY_V5, TIE_MARGIN, V5_REVISION, playbookTowers} from './playbook-v5.mjs';
import {JEV_POLICY_V6, V6_REVISION} from './policy-v6.mjs';
import {nearTrackPoints, pickSpots} from './spots.mjs';
import {DEFAULT_BOUNDS} from './spot-catalog.mjs';
import {buildCandidates, stillValid} from './candidates.mjs';
import {fingerprint} from './state.mjs';
import {leadRounds} from './triggers.mjs';
import {STRATEGY_POLICY} from './plan.mjs';
import {DEFAULT_RULESET, allowedCatalog, rulesetProblem, runMetadata} from './rulesets.mjs';
import {popupCandidate, popupProblem} from './popups.mjs';
import {MOD_HELPER_PIN, modHelperProblem} from './pins.mjs';
import {JEV_POLICY} from './question.mjs';
import {profileGuard} from './profile.mjs';
import {pressureTracker} from './policy-v3.mjs';
import {observedSpeed} from './speed.mjs';
import {aimStep} from './aim.mjs';
import {missingTowerData, towerDataInfo} from './towers.mjs';
import {zeroLeakFor, zeroLeakGame} from './zero-leak.mjs';

// How often the runner sends the same aiming command for a tower in a match before leaving it (a refused
// command is logged; the tower then counts as unaimed in the estimates).
export const AIM_ATTEMPTS = 2;

// The forced aiming step (aim.mjs): the first placed tower that needs set_targeting or set_target_point, as a
// candidate the game adapters take without a Jev call (game.mjs isForced). attempts: {key: count} for the match.
export function aimCandidate(state, paths, attempts = new Map()) {
 if (!state.in_game || state.match.result || state.popup) return null;
 for (const t of state.towers) {
  const step = aimStep(t, paths);
  if (!step) continue;
  const key = aimKey(step);
  if ((attempts.get(key) ?? 0) >= AIM_ATTEMPTS) continue;
  const {target, ...command} = step;
  const what = command.action === 'set_targeting' ? `targeting ${command.mode}` : `target point (${command.x}, ${command.y})`;
  return {id: `aim:${t.id}:${command.action}`, label: `Aim #${t.id} ${t.base_id}: ${what}`, command,
   details: {kind: 'aim_tower', tower_id: t.id, base_id: t.base_id, action: command.action, mode: target.mode, point: target.point, key,
    // The last command for this tower: the aim is complete once it executes.
    completes: command.action === 'set_target_point' || !target.point}};
 }
 return null;
}
const aimKey = step => step.action === 'set_targeting' ? `${step.tower_id}|mode|${step.mode}` : `${step.tower_id}|point|${step.x},${step.y}`;

// After a purchase the game answered "queued", the runner waits until the state shows it (the towers hash, a
// tower's ID or tiers changed) before deciding again, at most this long; a timeout is logged
// (queued_wait_timeout). In the logs of 2026-09-30, 21 of 40 stale_towers refusals came 1.2 to 1.5 s after a
// queued purchase, from a decision built on the state before the purchase applied.
export const QUEUED_WAIT_MS = 1500;
const towersKey = s => JSON.stringify([s.towers_hash ?? null, [...s.towers].sort((a, b) => a.id - b.id).map(t => [t.id, t.tiers])]);

// Places offered beside the track once the catalog's spots are taken.
export const FALLBACK_SPOTS = 8;

// Compact state for the decision log: what the scorecard and a later review need.
// The bloons part of a logged state: the count, the furthest progress and the bloons nearest the exit (bridge 0.3.15; []
// before), or null when the state has no bloon summary (bridges before 0.3.3).
export function bloonLog(b) {
 if (!b) return null;
 return {count: b.count, furthest: b.furthest ?? null, nearest_exit: (b.nearest_exit ?? []).map(x => ({type: x.type, camo: x.camo, regrow: x.regrow, fortified: x.fortified, progress: x.progress}))};
}

export function describeState(s) {
 if (!s.in_game) return {in_game: false, screen: s.screen ?? null, unlock_all: s.unlock_all ?? null};
 return {in_game: true, match: s.match, round: s.round, cash: Math.floor(s.cash), lives: s.lives, starting_lives: s.starting_lives, max_lives: s.max_lives, unlock_all: s.unlock_all ?? null,
  fast_forward: s.fast_forward ?? null, multiplier: s.multiplier ?? null, speed: observedSpeed(s), auto_start: s.auto_start ?? null,
  ...(s.bloons ? {bloons: bloonLog(s.bloons)} : {}),
  towers: s.towers.map(t => ({id: t.id, base_id: t.base_id, tiers: t.tiers, x: Math.round(t.x), y: Math.round(t.y), ...(Number.isFinite(t.pops) ? {pops: t.pops} : {}),
   ...(t.targeting != null ? {targeting: t.targeting} : {}), ...(t.target_point ? {target_point: {x: Math.round(t.target_point.x), y: Math.round(t.target_point.y)}} : {})}))};
}

// What single observations don't show: round durations, lives at the start of the round, leaks, and leak
// pressure (policy-v3.mjs pressureTracker).
export function matchTracker(now = Date.now) {
 const t = {match: null, round: null, startedAt: null, durations: [], livesAtRoundStart: null, leaks: [], lastLives: null, pressure: pressureTracker()};
 t.observe = s => {
  if (!s.in_game) return;
  t.pressure.observe(s);
  if (s.match.id !== t.match) Object.assign(t, {match: s.match.id, round: null, startedAt: null, durations: [], leaks: [], lastLives: null});
  if (s.round.number !== t.round) {
   if (t.startedAt != null && s.round.number === t.round + 1) t.durations = [...t.durations, (now() - t.startedAt) / 1000].slice(-8);
   Object.assign(t, {round: s.round.number, startedAt: now(), livesAtRoundStart: s.lives});
  }
  if (t.lastLives != null && s.lives < t.lastLives) {
   const entry = t.leaks.at(-1), lost = t.lastLives - s.lives;
   if (entry?.round === s.round.number) entry.lives_lost += lost; else t.leaks.push({round: s.round.number, lives_lost: lost});
  }
  t.lastLives = s.lives;
 };
 t.secondsPerRound = () => { const d = [...t.durations].sort((a, b) => a - b); return d.length ? d[d.length >> 1] : null; };
 return t;
}

// spots: the match's spot catalog [{id, x, y, share, from, to}] from spots.mjs pickSpots. Which of them
// are free is checked per tower with the bridge's placement check (water towers, footprints and aircraft
// differ), for the towers Jev could place now and those the plan names, and kept until the match or its
// towers change. referenceTower: the tower whose free spots the strategist's brief lists.
// catalog: the shop [{id, cost, ...}]; by default the bridge's, read again whenever the match or its towers
// change, since prices depend on the mode and on discounts. ruleset: what runs may use (rulesets.mjs),
// recorded with each run in the run log and, when `series` (a runLog for series.jsonl) is given, in the
// series file. afterDefeat: 'restart' while the series has runs to go, otherwise 'home' (popups.mjs).
// modHelperPin: the Mod Helper build runs may use (pins.mjs); null turns the check off.
// jevPolicy: the policy without a strategist, btd6-jev-v0 (default), btd6-jev-v1 (policy-v1.mjs),
// btd6-jev-v2 (policy-v2.mjs), btd6-jev-v3 (policy-v3.mjs), btd6-jev-v4 (policy-v4.mjs) or btd6-jev-v6 (policy-v6.mjs); btd6-claude-v1
// (plan-v1.mjs) is v4 with the strategist's plan and needs `strategist` ({channel, status}).
// openingTimeoutMs: btd6-claude-v1's wait for the opening plan before the first round.
// The saved profile is snapshot when a match starts and ends (profile.mjs); a tower, hero or upgrade
// added to its unlocked or acquired lists during the run is logged as a warning, unless the run's rank-up
// or unlock screens explain it. endProfile(matchId)
// takes the end snapshot for a match left without a result. speed: the speed the session set for the run
// (speed.mjs; a number, or "adaptive:<cruise>/<pressure>"), recorded in run_start and the series file; the
// session applies and keeps it. speedTime(): the time at each speed so far, recorded in run_end. matchId: the one
// match this runner plays (a session's); a state read showing another match pauses the runner before it logs
// a run_start or decides anything for it. Null (series runs) accepts each new match. offerDuringRound(state):
// whether to offer anything while a round runs (between-rounds mode offers purchases then only in an
// emergency; session.mjs); screens over the match are always handled.
// playbook: btd6-playbook-v5's playbook (playbook-v5.mjs), recorded with the run; tieMargin its near-tie margin.
// calibration: the session's MOAB and pops calibration ({moab, pops}), recorded in run_start and the series file.
// provenance: {lab_commit, code_commit, code_dirty} (provenance.mjs), recorded in run_start and the series file only.
// bridgePort: the bridge port the session talks to (bridge_port in run_start and the series file); null leaves it out.
// spotFallback: once every catalog spot is taken for a tower, look for places beside the track with the live
// placement check (fallbackSpots below). unplaceable: towers the spot catalog found no valid point for anywhere on
// the map (MonkeySub and MonkeyBuccaneer on Monkey Meadow, which has no water); no fallback search for them.
// aimTowers: aim the towers aim.mjs lists after each placement or upgrade, as forced steps (aimCandidate); onAim(state,
// details) runs once a tower's aim is complete; onAimRecord(state, details) after each `aim` record (pops.mjs aim_check). onObserve(state): side work on each state the runner reads, before it
// decides (the session's screenshots). zeroLeak: the policy plays as if the match had one life (zero-leak.mjs zeroLeakGame;
// btd6-jev-v6, btd6-playbook-v5 and btd6-claude-v1), recorded as zero_leak: true in run_start and the series file.
export function createBtd6Runner({bridge, ask, strategist = null, log, series = null, usage, limits, catalog = null, paths = [], spots = [],
 ruleset = DEFAULT_RULESET, afterDefeat = 'home', referenceTower = 'DartMonkey', modHelperPin = MOD_HELPER_PIN, minIntervalMs = 1000, pollMs = 1000, now = Date.now,
 jevPolicy = JEV_POLICY, speed = null, speedTime = () => null, matchId = null, openingTimeoutMs = undefined, offerDuringRound = () => true,
 playbook = null, tieMargin = undefined, calibration = null, provenance = null, spotFallback = true, unplaceable = [], aimTowers = true, onAim = null, onAimRecord = null, onObserve = null, bridgePort = null, zeroLeak = false}) {
 const tracker = matchTracker(now);
 // The shop and each tower's free spots, for one match and tower layout.
 // noData: the shop's non-hero towers data/towers.json has no entry for (towers.mjs missingTowerData), left out of
 // allowed so no policy buys a tower its estimates would count as 0; recorded in run_start with a warning.
 const layout = {key: null, allowed: [], noData: [], spots: {}, fallback: null};
 let warnedNoData = null;
 const ended = new Set(), started = new Set();
 const reported = {match: null, keys: new Set()};
 const claude = jevPolicy === CLAUDE_POLICY_V1, v5 = jevPolicy === PLAYBOOK_POLICY_V5;
 if (zeroLeak && !zeroLeakFor(jevPolicy)) throw Error(`Zero-leak mode is for btd6-jev-v6, btd6-playbook-v5 and btd6-claude-v1, not ${jevPolicy}.`);
 if (claude && !strategist?.status.enabled) throw Error(`Policy ${CLAUDE_POLICY_V1} needs a strategist channel.`);
 if (v5 && !playbook) throw Error(`Policy ${PLAYBOOK_POLICY_V5} needs a playbook.`);
 const planned = v5 ? playbookTowers(playbook) : [];
 const policy = claude ? CLAUDE_POLICY_V1 : strategist?.status.enabled ? STRATEGY_POLICY : jevPolicy;
 let last = null, runner = null, health = null;
 // The pause for an unhandled screen over a match: {match, message}, until the runner resumes or pauses
 // for something else.
 let screenPause = null;

 const plan = () => strategist?.status.enabled ? strategist.status.plan : null;
 // Spots the plan names are offered even when they aren't among a tower's best (v0 place steps, v1 targets).
 const required = (active = plan()) => [...(active?.build_order ?? []).filter(s => s.action === 'place' && s.spot), ...(active?.build ?? []).filter(b => b.spot)]
  .map(s => ({tower: s.tower, spot: s.spot}));
 const spotsFor = tower => layout.spots[tower] ?? layout.spots[referenceTower] ?? [];
 const refreshLayout = async state => {
  const key = `${state.match.id}|${state.towers_hash ?? ''}`;
  if (layout.key !== key) {
   const shop = catalog ?? (await bridge.catalog()).towers ?? [];
   const noData = missingTowerData(shop);
   Object.assign(layout, {key, allowed: allowedCatalog(ruleset, shop).filter(t => !noData.includes(t.id)), noData, spots: {}, fallback: null});
  }
  if (!spots.length) return;
  const heroPlaced = state.towers.some(t => t.is_hero);
  const placeable = layout.allowed.filter(t => t.unlocked !== false && t.in_inventory !== false && t.cost <= state.cash && !(t.is_hero && heroPlaced));
  for (const tower of new Set([referenceTower, ...required().map(r => r.tower), ...planned, ...placeable.map(t => t.id)])) {
   if (tower in layout.spots || (tower !== referenceTower && !layout.allowed.some(t => t.id === tower))) continue;
   const check = await bridge.placementCheck(tower, spots);
   layout.spots[tower] = spots.filter((s, i) => check.results?.[i]?.valid === true);
   if (!layout.spots[tower].length && spotFallback && !unplaceable.includes(tower)) layout.spots[tower] = await fallbackSpots(state, tower);
  }
 };
 // When every catalog spot is taken for a tower: places beside the track (spots.mjs nearTrackPoints) that
 // the live placement check accepts for the reference tower, the best FALLBACK_SPOTS by coverage spread
 // along the track, IDs F01 on; for another tower, those of them the check accepts for it. The reference
 // tower's accepted points are kept for the match (towers are only added, so they can only become invalid),
 // and only those are checked again when the layout changes. One spot_fallback record per layout.
 const fallback = {match: null, points: null};
 async function fallbackSpots(state, tower) {
  if (!layout.fallback) {
   if (fallback.match !== state.match.id) Object.assign(fallback, {match: state.match.id, points: nearTrackPoints(paths, {bounds: DEFAULT_BOUNDS})});
   const checked = fallback.points.length;
   const check = checked ? await bridge.placementCheck(referenceTower, fallback.points) : {results: []};
   fallback.points = fallback.points.filter((p, i) => check.results?.[i]?.valid === true);
   const radius = layout.allowed.find(t => t.id === referenceTower)?.range ?? 32;
   layout.fallback = fallback.points.length ? pickSpots(fallback.points, paths, {radius, count: FALLBACK_SPOTS, spread: FALLBACK_SPOTS, prefix: 'F'}) : [];
   // checked and valid count points for the reference tower; `tower` is the one whose spots ran out.
   await matchLog.append({kind: 'spot_fallback', round: state.round.number, tower, counts_for: referenceTower, checked, valid: fallback.points.length, spots: layout.fallback.map(s => s.id)});
  }
  if (tower === referenceTower || !layout.fallback.length) return layout.fallback;
  const check = await bridge.placementCheck(tower, layout.fallback);
  return layout.fallback.filter((s, i) => check.results?.[i]?.valid === true);
 }
 const context = () => ({
  lead: leadRounds({latencies: strategist?.status.latencies ?? [], secondsPerRound: tracker.secondsPerRound()}),
  secondsPerRound: tracker.secondsPerRound(), catalog: layout.allowed, freeSpots: spotsFor(referenceTower), freeSpotsFor: spotsFor, paths, ruleset,
  livesAtRoundStart: tracker.livesAtRoundStart, leaks: tracker.leaks, pressure: tracker.pressure.status(),
 });
 const baseGame = claude ? claudeGameV1(context, {openingTimeoutMs}) : v5 ? playbookGameV5(context, {playbook, tieMargin}) : btd6Game(context, {policy});
 const game = zeroLeak ? zeroLeakGame(baseGame) : baseGame;
 // Aiming commands sent per match (aimCandidate's attempts).
 const aimed = {match: null, attempts: new Map()};
 const aimOptions = state => {
  if (!aimTowers || !state.in_game) return null;
  if (aimed.match !== state.match.id) Object.assign(aimed, {match: state.match.id, attempts: new Map()});
  return aimCandidate(state, paths, aimed.attempts);
 };
 // The queued purchase being waited for: {match, command_id, action, key, since}.
 let queued = null;
 const waitForQueued = async state => {
  if (!queued) return false;
  if (!state.in_game || state.match.id !== queued.match || towersKey(state) !== queued.key) { queued = null; return false; }
  const waited = now() - queued.since;
  if (waited < QUEUED_WAIT_MS) return true;
  await matchLog.append({kind: 'queued_wait_timeout', round: state.round.number, command_id: queued.command_id, action: queued.action, waited_ms: waited});
  queued = null;
  return false;
 };
 const matchLog = {append: event => log.append({...(last?.in_game && !event.match_id ? {match_id: last.match.id} : {}), ...event})};
 const guard = profileGuard({read: () => bridge.profile ? bridge.profile() : Promise.reject(Error('the bridge client has no profile read')), log: matchLog, series});

 const options = (state, active = plan()) => buildCandidates(state, {catalog: layout.allowed, freeSpots: spotsFor, paths, required: required(active)});

 runner = createRunner({
  observe: async () => {
   const state = await bridge.state();
   if (matchId && state.in_game && state.match.id !== matchId) { last = state; runner.pause('Another match is open.'); return state; }
   tracker.observe(state);
   last = state;
   // Side work on each observation before anything is decided (screenshots of a screen the step may close).
   if (onObserve) await Promise.resolve(onObserve(state)).catch(() => null);
   const newMatch = state.in_game && !started.has(state.match.id);
   // Which Mod Helper is loaded: read at the start and for each new match (the game may have restarted).
   if (!health || newMatch) health = await bridge.health();
   if (state.in_game) await refreshLayout(state);
   // Plan targets whose round has passed, met or not (claude-v1 and v5): the adherence measure.
   const active = state.in_game && !state.match.result && !state.popup ? (v5 ? game.plan(state, []) : claude ? plan() : null) : null;
   if (active) {
    if (reported.match !== state.match.id) Object.assign(reported, {match: state.match.id, keys: new Set()});
    for (const t of passedTargets(active, state, reported.keys)) await matchLog.append({kind: 'plan_target', round: state.round.number, ...t});
   }
   if (newMatch) {
    started.add(state.match.id);
    const meta = {...runMetadata(state, ruleset, policy, speed), mod_helper: health?.mod_helper ?? null, mod_helper_pin: modHelperPin,
     tower_data: towerDataInfo(), no_data: [...layout.noData],
     ...(v5 ? {playbook: {id: playbook.id, version: playbook.playbook_version}, policy_revision: V5_REVISION, tie_margin: tieMargin ?? TIE_MARGIN} : claude ? {policy_revision: CLAUDE_V1_REVISION} : policy === JEV_POLICY_V6 ? {policy_revision: V6_REVISION} : {}),
     ...(calibration ? {calibration} : {}), ...(provenance ?? {}), ...(bridgePort != null ? {bridge_port: bridgePort} : {}), ...(zeroLeak ? {zero_leak: true} : {})};
    await matchLog.append({kind: 'run_start', ...meta});
    const noDataKey = layout.noData.join(',');
    if (layout.noData.length && warnedNoData !== noDataKey) {
     warnedNoData = noDataKey;
     await matchLog.append({kind: 'warning', message: `No tower data (data/towers.json) for ${layout.noData.join(', ')}; left out of the candidates.`});
    }
    const profileStart = await guard.start(state.match.id);
    await series?.append({run: state.match.id, ...meta, profile_start: profileStart});
   }
   // Rank-ups and unlock splashes over the match, which explain unlocks the profile gains (profile.mjs).
   if (state.in_game) await guard.screen(state.match.id, state.popup ?? null);
   if (state.in_game && state.match.result && !ended.has(state.match.id)) {
    ended.add(state.match.id);
    const time = speedTime();
    await matchLog.append({kind: 'run_end', result: state.match.result, state: describeState(state), ...(time ? {speed_time: time} : {})});
    await guard.end(state.match.id);
   }
   // A match that doesn't meet the ruleset, or runs on another Mod Helper than the pinned one, isn't
   // played: its results wouldn't be comparable. A screen the runner doesn't handle, over a match or
   // over the main menu, stops it for the operator.
   const setupProblem = modHelperProblem(health, modHelperPin) ?? rulesetProblem(ruleset, state);
   const screenProblem = setupProblem ? null : popupProblem(state, {afterDefeat});
   const problem = setupProblem ?? screenProblem;
   if (problem) {
    if (state.popup && !popupCandidate(state, {afterDefeat})) await matchLog.append({kind: 'popup_unhandled', popup: state.popup});
    runner.pause(problem);
    screenPause = screenProblem && state.in_game ? {match: state.match.id, message: problem} : null;
   }
   return state;
  },
  // An allowlisted screen is the only option while it is open.
  // An allowlisted screen is the only option while it is open; then a tower that needs aiming (forced too).
  candidates: state => state.popup ? [popupCandidate(state, {afterDefeat})].filter(Boolean)
   : aimOptions(state) ? [aimOptions(state)]
   : state.in_game && state.round?.active && !offerDuringRound(state) ? [] : options(state),
  // Decide when something changed (round, towers, affordable options, lives, leak pressure), when a strategist
  // answer is waiting, or when a wait has run out; never more often than minIntervalMs.
  due: async (state, offered, memory) => {
   if (await waitForQueued(state)) return false;
   if (now() - memory.lastDecisionAt < minIntervalMs) return false;
   const changed = fingerprint(state) !== memory.lastFingerprint || offered.map(o => o.id).join('|') !== memory.lastOptions?.join('|')
    || state.lives !== memory.lastLives || tracker.pressure.active !== (memory.lastPressure ?? false);
   const answered = strategist?.status.enabled ? Boolean(await strategist.channel.pendingAnswer()) : false;
   const due = changed || answered || now() >= memory.holdUntil;
   if (due) Object.assign(memory, {lastLives: state.lives, lastPressure: tracker.pressure.active});
   return due;
  },
  decide: (state, offered, {cancelled}) => decide({state, candidates: offered, game, strategist, ask, cancelled, pollMs,
   rebuild: adopted => options(state, adopted)}),
  fingerprint, stillValid,
  // The bridge re-checks the match, towers and open screen on the game thread before acting. A screen
  // over the main menu has no match.
  send: ({popup_class, expect_tiers, ...command}) => {
   if (command.action === 'set_targeting' || command.action === 'set_target_point') {
    const key = aimKey(command);
    aimed.attempts.set(key, (aimed.attempts.get(key) ?? 0) + 1);
   }
   const seen = last;
   return bridge.command({...command, expect: {
   ...(seen.in_game ? {match_id: seen.match.id, towers_hash: seen.towers_hash ?? null} : {}), ...(popup_class ? {popup_class} : {}), ...(expect_tiers ? {tiers: expect_tiers} : {})}})
    .then(result => {
     if (result?.status === 'queued' && seen.in_game && (command.action === 'place_tower' || command.action === 'upgrade_tower'))
      queued = {match: seen.match.id, command_id: command.command_id, action: command.action, key: towersKey(seen), since: now()};
     return result;
    });
  },
  lookup: id => bridge.commandResult(id),
  // A placement for a plan step: remember which tower it made, so later steps can target it.
  onExecuted: async (decision, result) => {
   const d = decision.choice.details;
   if (d?.kind === 'aim_tower') {
    await matchLog.append({kind: 'aim', round: last?.round?.number ?? null, tower_id: d.tower_id, base_id: d.base_id, action: d.action, mode: d.mode, point: d.point ?? null,
     ...(result.targeting ? {targeting: result.targeting} : {}), ...(result.target_point ? {target_point: result.target_point} : {})});
    if (onAimRecord) await Promise.resolve(onAimRecord(last, d)).catch(() => null);
    if (d.completes && onAim) await onAim(last, d);
    return;
   }
   const step = decision.constraint?.rules?.find(r => r.kind === 'planned_step')?.step;
   if (step && result.tower_id != null && decision.choice.details?.kind === 'place' && strategist)
    strategist.status.stepTowers = {...strategist.status.stepTowers, [step]: result.tower_id};
  },
  log: matchLog, usage, limits, describe: describeState, policy, now,
 });
 // After a pause for an unhandled screen over a match: once a fresh state read shows the same match with no
 // screen open and no result, resume and log it. Any other pause (the operator's, a limit, a TypeSafe error,
 // a command with an unknown result) replaces the message and needs an explicit resume. held: the
 // operator's pause is on. Returns whether the runner resumed.
 const resumeAfterScreen = async ({held = false} = {}) => {
  const p = screenPause;
  if (!p) return false;
  if (runner.status.mode !== 'paused' || runner.status.message !== p.message) { screenPause = null; return false; }
  if (held || runner.status.uncertain) return false;
  const state = await bridge.state().catch(() => null);
  if (!state?.in_game || state.match.id !== p.match || state.popup || state.match.result) return false;
  screenPause = null;
  tracker.observe(state);
  last = state;
  await matchLog.append({kind: 'runner_resumed', match_id: p.match, message: 'resumed after screen closed', paused_for: p.message});
  runner.resume();
  return true;
 };
 return {runner, tracker, context, resumeAfterScreen, freeSpots: () => spotsFor(referenceTower), spotsFor, last: () => last, health: () => health, endProfile: guard.end};
}
