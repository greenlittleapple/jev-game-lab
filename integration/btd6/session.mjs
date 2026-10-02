// One match from the command line (npm run btd6:run): check the bridge, step from launch to the main
// menu, start the setup (always replacing a saved game), load the spot catalog, run the decision loop
// (runner.mjs) until the match is won or lost and the runner has pressed Home, then stop. Every
// lifecycle command, decision and dispatch goes to the run log. The game speed (speed.mjs) is set once the
// match has loaded and set again when the game changes it at a round start. In graded mode (the default)
// the runner moves it between its levels by the defence's margin and danger signals; in adaptive mode,
// between its cruise and pressure speeds. A change the runner didn't make, during a round, is a person's:
// it is logged as a warning and left alone for the rest of the match. In between-rounds mode the runner
// turns auto-start off, buys while no round runs, starts each round itself, buys during a round only in an
// emergency, and restores auto-start when the match ends.
// While a runner step waits (a Jev call takes one to three seconds), the session keeps reading the state
// every watchMs of real time for the speed control, the MOAB measure and screenshots (stepWatching), so a
// leak at 10x is answered within a quarter second instead of after the decision.
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createBtd6Runner} from './runner.mjs';
import {advanceToMenu, dispatchOnce, parseSetup, waitForState} from './lifecycle.mjs';
import {startMatchCommand, goHomeCommand} from './match-flow.mjs';
import {mapPaths} from './spot-catalog.mjs';
import {DEFAULT_RULESET, allUnlocksProblem, findRuleset, requireAllUnlocks, rulesetId} from './rulesets.mjs';
import {shotKeeper} from './shots.mjs';
import {codeProvenance} from './provenance.mjs';
import {bridgePortFrom} from './ports.mjs';
import {MOD_HELPER_PIN, modHelperProblem} from './pins.mjs';
import {JEV_POLICY} from './question.mjs';
import {JEV_POLICY_V1} from './policy-v1.mjs';
import {JEV_POLICY_V2} from './policy-v2.mjs';
import {JEV_POLICY_V3} from './policy-v3.mjs';
import {JEV_POLICY_V4} from './policy-v4.mjs';
import {setTowerTable} from './towers.mjs';
import {JEV_POLICY_V6} from './policy-v6.mjs';
import {CLAUDE_POLICY_V1} from './plan-v1.mjs';
import {PLAYBOOK_POLICY_V5, TIE_MARGIN} from './playbook-v5.mjs';
import {TRIGGERS_V1} from './triggers-v1.mjs';
import {DEFAULT_SPEED_MODE, GRADE_AT_CAMO, isEmergency, MIN_SPEED, MIN_SPEED_FLOORS, adaptiveSpeed, buyingNow, dangerSignals, defenceMargins, gradedSpeed, parseSpeedMode, speedClock, speedCommand, speedKeeper,
 speedMode, speedTriggers, withBetweenRounds} from './speed.mjs';
import {moabShort} from './policy-v4.mjs';
import {moabCalibration, setMoabCalibration, setDdtCheck, ddtCheckFor, setMoabDdtLead, moabDdtLeadFor, MOAB_LEAD_ROUNDS} from './moab.mjs';
import {moabMeter} from './moab-calibration.mjs';
import {popsTracker} from './pops.mjs';
import {popsCalibration as currentPops, setPopsCalibration, setEarlyMargin, earlyMarginFor} from './estimate.mjs';
import {hardRoundsFor} from './hard-rounds.mjs';
import {ZERO_LEAK_POLICIES, zeroLeakFor, zeroLeakView} from './zero-leak.mjs';

// --policy names. "jev" stays the v0 baseline so earlier commands mean the same thing. claude-v1 is
// btd6-jev-v4 with a Claude strategist answering through the file channel (docs/BTD6-STRATEGIST.md).
// playbook-v5 is btd6-jev-v4 with a playbook prepared ahead of time (playbook-v5.mjs), no Claude calls.
export const POLICIES = {jev: JEV_POLICY, 'jev-v0': JEV_POLICY, 'jev-v1': JEV_POLICY_V1, 'jev-v2': JEV_POLICY_V2, 'jev-v3': JEV_POLICY_V3, 'jev-v4': JEV_POLICY_V4, 'jev-v6': JEV_POLICY_V6,
 'claude-v1': CLAUDE_POLICY_V1, 'playbook-v5': PLAYBOOK_POLICY_V5};
export const usesStrategist = policy => policy === CLAUDE_POLICY_V1;
// Jev-only versions are tested on Hard Standard (rounds 3 to 80, 100 lives): a leak costs lives instead of
// ending the match, so the round reached measures progress. CHIMPS (--setup MonkeyMeadow/Hard/CHIMPS) stays
// selectable and becomes the test once Jev reliably passes about round 30.
export const DEFAULT_SETUP = 'MonkeyMeadow/Hard/Standard';
// --speed when none is given: graded up to 10, for every policy (the speed is independent of the decision policy).
export const defaultSpeed = () => DEFAULT_SPEED_MODE;

// Command-line options and .env values. Throws with the reason when the run can't start. The API key
// is returned for the Jev client only and never appears in a message.
export function runConfig(argv, env = {}) {
 const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const known = new Set(['--setup', '--policy', '--status-port', '--speed', '--opening-timeout', '--playbook', '--tie-margin', '--ruleset', '--moab-factor', '--pops-factor', '--moab-short-speed', '--min-speed']);
 const unknown = argv.filter((a, i) => a.startsWith('--') && !known.has(a) && !['--confirm', '--dry-run', '--no-status', '--no-fake-strategist', '--between-rounds', '--no-shots', '--camo-margin', '--zero-leak'].includes(a) && !known.has(argv[i - 1]));
 if (unknown.length) throw Error(`Unknown option ${unknown[0]}.`);
 const dryRun = argv.includes('--dry-run');
 const setup = parseSetup(flag('--setup') ?? DEFAULT_SETUP);
 const policyName = flag('--policy');
 if (!Object.hasOwn(POLICIES, policyName ?? '')) throw Error(`--policy must be one of ${Object.keys(POLICIES).join(', ')} (jev is the v0 baseline).`);
 if (!dryRun && !argv.includes('--confirm')) throw Error('A live run changes the game: add --confirm (or use --dry-run).');
 const positive = (name, fallback) => {
  const raw = env[name];
  if (raw == null || raw === '') {
   if (fallback != null) return fallback;
   throw Error(`${name} is not set in .env. It is a hard cap for live runs; set it to a positive whole number.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw Error(`${name} must be a positive whole number.`);
  return value;
 };
 const apiKey = dryRun ? null : (env.TYPESAFE_API_KEY ?? '').trim();
 if (!dryRun && !apiKey) throw Error('TYPESAFE_API_KEY is not set in .env; the runner won\'t start without it.');
 const maxDecisions = positive('MAX_DECISIONS', dryRun ? 5000 : null), maxInputTokens = positive('MAX_INPUT_TOKENS', dryRun ? 50_000_000 : null);
 const statusPort = Number(flag('--status-port') ?? env.BTD6_STATUS_PORT ?? 4318);
 if (!Number.isInteger(statusPort) || statusPort < 1024 || statusPort > 65535 || statusPort === 4317)
  throw Error('The status page port must be 1024-65535 and not 4317 (the STS2 dashboard).');
 const opening = flag('--opening-timeout');
 const openingSeconds = opening == null ? TRIGGERS_V1.OPENING_TIMEOUT_MS / 1000 : Number(opening);
 if (!Number.isInteger(openingSeconds) || openingSeconds < 0 || openingSeconds > 3600) throw Error('--opening-timeout must be 0 to 3600 seconds.');
 const v5 = POLICIES[policyName] === PLAYBOOK_POLICY_V5;
 if (!v5 && (argv.includes('--playbook') || argv.includes('--tie-margin'))) throw Error('--playbook and --tie-margin are for --policy playbook-v5.');
 const tieMargin = argv.includes('--tie-margin') ? Number(flag('--tie-margin')) : TIE_MARGIN;
 if (!(tieMargin >= 0 && tieMargin <= 0.5)) throw Error('--tie-margin must be 0 to 0.5 (0 turns the tie-break off).');
 // --moab-factor / --pops-factor: calibration factors pinned for a series (used as given, source "pinned").
 const factor = name => {
  if (!argv.includes(name)) return null;
  const value = Number(flag(name));
  if (!(value > 0 && value <= 10)) throw Error(`${name} must be a number above 0 and at most 10.`);
  return value;
 };
 const moabFactor = factor('--moab-factor'), popsFactor = factor('--pops-factor');
 // --moab-short-speed <1|3|5>: graded speed's level while moab_short is the only danger signal (1 by default;
 // speed.mjs gradedSpeed). Recorded in the speed label as "+moab<n>", so a run's log says which it used.
 const withMoabShort = mode => {
  if (!argv.includes('--moab-short-speed')) return mode;
  const level = Number(flag('--moab-short-speed'));
  if (mode?.mode !== 'graded') throw Error('--moab-short-speed is for graded speed (--speed graded[:<max>]).');
  if (![1, 3, 5].includes(level) || level > mode.max) throw Error(`--moab-short-speed must be 1, 3 or 5, and at most the graded maximum (${mode.max}).`);
  return level > 1 ? {...mode, moabShortSpeed: level, label: `${mode.label}+moab${level}`} : mode;
 };
 // --camo-margin: graded speed's pops margin is also no more than the camo margin, graded on GRADE_AT_CAMO (speed.mjs
 // defenceMargins). Recorded in the speed label as "+camo", after "+moab<n>".
 const withCamo = mode => {
  if (!argv.includes('--camo-margin')) return mode;
  if (mode?.mode !== 'graded') throw Error('--camo-margin is for graded speed (--speed graded[:<max>]).');
  return {...mode, camoMargin: true, label: `${mode.label}+camo`};
 };
 // --min-speed <1|3>: graded speed's floor (speed.mjs gradedSpeed minSpeed; 1 by default, no floor). With 3, nothing in
 // the graded controller plays below the game's fast-forward. Recorded in the speed label as "+min3", after "+camo".
 const withMinSpeed = mode => {
  if (!argv.includes('--min-speed')) return mode;
  const level = Number(flag('--min-speed'));
  if (mode?.mode !== 'graded') throw Error('--min-speed is for graded speed (--speed graded[:<max>]).');
  if (!MIN_SPEED_FLOORS.includes(level)) throw Error(`--min-speed must be ${MIN_SPEED_FLOORS.join(' or ')}.`);
  return level > MIN_SPEED ? {...mode, minSpeed: level, label: `${mode.label}+min${level}`} : mode;
 };
 // --zero-leak: the policy and graded speed play as if the match had one life (zero-leak.mjs); v6, v5 and claude-v1 only.
 const zeroLeak = argv.includes('--zero-leak');
 if (zeroLeak && !zeroLeakFor(POLICIES[policyName])) throw Error(`--zero-leak is for --policy ${ZERO_LEAK_POLICIES.map(p => p.replace(/^btd6-/, '')).join(', ')}.`);
 return {setup, policy: POLICIES[policyName], dryRun, zeroLeak, moabFactor, popsFactor, apiKey, status: !argv.includes('--no-status'), statusPort,
  strategist: usesStrategist(POLICIES[policyName]), openingTimeoutMs: openingSeconds * 1000, fakeStrategist: dryRun && !argv.includes('--no-fake-strategist'),
  speed: (mode => argv.includes('--between-rounds') ? withBetweenRounds(mode) : mode)(withMinSpeed(withCamo(withMoabShort(parseSpeedMode(argv.includes('--speed') ? flag('--speed') : defaultSpeed(POLICIES[policyName])))))),
  ...(v5 ? {playbookFile: flag('--playbook') ?? null, tieMargin} : {}),
  // BTD6_BRIDGE_PORT: the bridge port (ports.mjs; 15527 by default). It also names the runner lock and run log.
  bridgePort: bridgePortFrom(env),
  // --ruleset: btd6-open-v2 by default (without the towers that need aiming); v3 aims them (rulesets.mjs).
  ruleset: findRuleset(flag('--ruleset')),
  // --no-shots: no screenshots during the run (shots.mjs).
  shots: !argv.includes('--no-shots'),
  limits: {maxDecisions, maxRequests: maxDecisions, maxInputTokens}};
}

// What the status page and the console read: phase, latest state, recent decisions and dispatches,
// and the operator's pause and resume.
export function createSession({policy, setup, limits, usage, recentSize = 20, onEvent = () => {}}) {
 const s = {phase: 'starting', message: 'Starting.', policy, setup, limits, usage, health: null, state: null, runner: null, held: false,
  stopRequested: false, result: null, startedAt: new Date().toISOString(), recent: {decisions: [], dispatches: [], events: []}};
 const push = (list, entry) => { list.push(entry); if (list.length > recentSize) list.shift(); };
 s.record = entry => {
  push(entry.kind === 'decision' ? s.recent.decisions : entry.kind === 'dispatch' ? s.recent.dispatches : s.recent.events, entry);
  onEvent(entry);
 };
 s.setPhase = (phase, message) => { s.phase = phase; s.message = message; onEvent({kind: 'phase', phase, message}); };
 s.pause = () => { s.held = true; s.runner?.pause('Paused by the operator.', {source: 'operator', endpoint: null, timeout_ms: null, timed_out: false}); };
 s.resume = () => { if (s.runner) s.runner.resume(); s.held = false; };
 s.reconcile = async ({force = false} = {}) => s.runner ? s.runner.reconcile({force}) : 'clear';
 return s;
}

// The speed controller for a speed mode: adaptiveSpeed, gradedSpeed (with the setup's hard rounds and the mode's
// moabShortSpeed from --moab-short-speed, minSpeed from --min-speed and, with --camo-margin, GRADE_AT_CAMO), or null for a fixed speed or none.
export function speedControl(mode, {now = Date.now, calibrated = false, setup} = {}) {
 if (mode?.mode === 'adaptive') return adaptiveSpeed(mode);
 if (mode?.mode !== 'graded') return null;
 return gradedSpeed({max: mode.max, now, calibrated, hard: hardRoundsFor(setup), options: {moabShortSpeed: mode.moabShortSpeed ?? MIN_SPEED, minSpeed: mode.minSpeed ?? MIN_SPEED, ...(mode.camoMargin ? {gradeAt: GRADE_AT_CAMO} : {})}});
}

// A run log that also feeds the session.
export const teeLog = (log, session) => ({file: log.file, append: async event => { const entry = await log.append(event); session.record(entry); return entry; }});

// State reads fail while the game loads a screen; the runner shouldn't stop for that.
export function steadyBridge(bridge, {tries = 15, waitMs = 1000, sleep = delay} = {}) {
 return {...bridge, state: async () => {
  for (let i = 1; ; i++) {
   try { return await bridge.state(); }
   catch (error) { if (i >= tries) throw error; await sleep(waitMs); }
  }
 }};
}

// watchMs: real milliseconds between state reads while a runner step waits (0: none).
export const RUN_TIMINGS = {watchMs: 250, strategyPollMs: 1000, pollMs: 250, pausedPollMs: 1000, minIntervalMs: 1000, lifecyclePollMs: 1000, loadTimeoutMs: 120_000, homeAfterResultMs: 30_000, healthEveryMs: 15_000};

// loadSpots(map, paths) -> the spot catalog (spot-catalog.mjs; its spots, and towers with valid_points), or just the
// spot list [{id, x, y, ...}]. Towers the catalog found no valid point for anywhere on the map are never placeable
// there, and the runner skips its fallback search for them.
// speed: a speed mode from parseSpeedMode (withBetweenRounds for between-rounds mode), a fixed speed 1 to 10, a
// "graded:<max>" or "adaptive:<cruise>/<pressure>" string (speed.mjs), or null to leave the game's speed alone. strategist: {channel, status} for
// btd6-claude-v1 (null otherwise); openingTimeoutMs: its wait for the opening plan. playbook: btd6-playbook-v5's
// playbook (playbook-v5.mjs loadPlaybook) and tieMargin its near-tie margin. moabCalibration: {factor, source}
// from moab-calibration.mjs loadCalibration, applied to every MOAB damage estimate for the session (and put
// back when it ends); the live MOAB damage is measured either way (moab_measure records, returned as
// moabMeasures). calibrated (the setup's MOAB calibration is measured, not the interim hypothesis) lifts graded
// speed's composition cap; it defaults to calibration.runs > 0. popsCalibration: {factor, from_round, source,
// basis} from pops-calibration.mjs loadPopsCalibration (or pinCalibration), applied to the pops estimate behind
// the v3 verdict and graded speed's pops margin for the session and put back when it ends; the pops_round
// records are logged either way and returned as popsMeasures. Both calibrations go into session_start and
// run_start. provenance(): the code commit fields for run_start and the series file (provenance.mjs; logging only),
// null for none. bridgePort: the bridge port, recorded as bridge_port in session_start, run_start and the series file
// (null leaves it out). shots: {dir, root} to save screenshots
// (shots.mjs), or null for none.
// Runs one runner step, and while it is pending reads the state every intervalMs of real time and passes it to
// watch (a failed read is skipped). Returns the step's outcome.
export async function stepWatching(step, read, watch, {intervalMs = RUN_TIMINGS.watchMs} = {}) {
 let done = false;
 const stepping = step().finally(() => { done = true; });
 if (!(intervalMs > 0)) return stepping;
 while (!done) {
  await Promise.race([stepping.catch(() => {}), delay(intervalMs)]);
  if (done) break;
  const state = await read().catch(() => null);
  if (state && !done) await watch(state);
 }
 return stepping;
}

export async function runSession({bridge, ask, log, series = null, session, setup, policy = JEV_POLICY, ruleset = DEFAULT_RULESET, limits, usage,
 loadSpots, modHelperPin = MOD_HELPER_PIN, timings = {}, sleep = delay, now = Date.now, newId = randomUUID, dryRun = false, speed = null,
 strategist = null, openingTimeoutMs = undefined, playbook = null, tieMargin = undefined, moabCalibration: calibration = null,
 popsCalibration: popsCal = null, calibrated = (calibration?.runs ?? 0) > 0, shots = null, provenance = codeProvenance, bridgePort = null, zeroLeak = false}) {
 const t = {...RUN_TIMINGS, ...timings};
 const mode = speedMode(speed), adaptive = mode?.mode === 'adaptive', graded = mode?.mode === 'graded', controlled = adaptive || graded;
 const betweenRounds = Boolean(mode?.betweenRounds);
 const speedLabel = mode?.label ?? null;
 // Zero-leak mode: graded speed's margins and moab_short signal read the one-life view (zero-leak.mjs); lives lost stay real.
 const policyView = zeroLeak ? zeroLeakView : s => s;
 const steady = steadyBridge(bridge, {sleep, waitMs: t.lifecyclePollMs});
 const waitWhileHeld = async () => { while (session.held && !session.stopRequested) await sleep(t.pausedPollMs); if (session.stopRequested) throw Error('Stopped by the operator.'); };
 const dispatch = async command => { await waitWhileHeld(); return dispatchOnce(bridge, log, command); };
 const wait = {sleep, now, pollMs: t.lifecyclePollMs};
 let matchId = null, result = null;
 let btd6 = null;
 const previousCalibration = moabCalibration();
 // What session_start and run_start record: the factors the session applies and where they came from.
 const calibrationRecord = () => ({
  moab: calibration ? {factor: calibration.factor, source: calibration.source ?? null, ...(calibration.stored ? {stored: calibration.stored} : {})} : {factor: moabCalibration(), source: 'default'},
  pops: popsCal ? {factor: popsCal.factor, from_round: popsCal.from_round ?? 1, source: popsCal.source ?? null, basis: popsCal.basis ?? null, ...(popsCal.stored ? {stored: popsCal.stored} : {})}
   : {...currentPops(), source: 'default'}});
 if (calibration) setMoabCalibration(calibration.factor);
 const previousPops = currentPops();
 if (popsCal) setPopsCalibration(popsCal.factor, {fromRound: popsCal.from_round ?? 1});
 // btd6-jev-v4 is the frozen baseline: its estimates keep the tower table from before on-damage projectiles (towers.mjs).
 setTowerTable(policy === JEV_POLICY_V4 ? 'v4' : 'current');
 // The early one-life margin (estimate.mjs EARLY_ONE_LIFE_MARGIN) is for v6, v5 and claude-v1 only.
 setEarlyMargin(earlyMarginFor(policy));
 // DDT-capable MOAB damage (moab.mjs setDdtCheck) for v6, v5 and claude-v1 at their current revisions.
 setDdtCheck(ddtCheckFor(policy));
 // moab_short's 10-round lead for DDT rounds (moab.mjs setMoabDdtLead) for v6, v5 and claude-v1 at their current revisions.
 setMoabDdtLead(moabDdtLeadFor(policy));
 const popsMeasures = [];
 let meter = null, popsTrack = null;
 const logPops = async records => { for (const r of records) { if (r.kind === 'pops_round') popsMeasures.push(r); await log.append({match_id: matchId, ...r}); } };
 const moabMeasures = [];
 const measure = async records => { for (const r of records) { moabMeasures.push(r); await log.append({kind: 'moab_measure', match_id: matchId, ...r, factor: moabCalibration()}); } };
 const finish = async (reason, message) => {
  const runner = session.runner;
  if (meter) await measure(meter.finish()).catch(() => {});
  if (popsTrack) await logPops(popsTrack.finish()).catch(() => {});
  setMoabCalibration(previousCalibration);
  setPopsCalibration(previousPops.factor, {fromRound: previousPops.from_round});
  setTowerTable('current');
  setEarlyMargin(false);
  setDdtCheck(false);
  setMoabDdtLead(MOAB_LEAD_ROUNDS);
  // A match left without a result still gets its end-of-run profile check.
  if (btd6 && matchId) await btd6.endProfile(matchId);
  await restoreAutoStart(session.state).catch(() => {});
  session.result = result;
  session.setPhase('finished', message);
  await log.append({kind: 'session_end', reason, result, match_id: matchId, message,
   decisions: runner?.status.decisions ?? 0, actions: runner?.status.actions ?? 0, usage: {...usage}});
  return {reason, result, matchId, message, moabMeasures, popsMeasures};
 };

 session.setPhase('checking', 'Checking the bridge.');
 const health = await bridge.health();
 session.health = health;
 const pin = modHelperProblem(health, modHelperPin);
 if (pin) throw Error(pin);
 if (requireAllUnlocks() && health.unlock_all !== true) throw Error(allUnlocksProblem('/health', health.unlock_all));
 await log.append({kind: 'session_start', dry_run: dryRun, ...(zeroLeak ? {zero_leak: true} : {}), ...(bridgePort != null ? {bridge_port: bridgePort} : {}), policy, setup, ruleset: rulesetId(ruleset), limits, speed: speedLabel, mod_helper_pin: modHelperPin,
  ...(strategist ? {strategist: {opening_timeout_ms: openingTimeoutMs ?? null}} : {}),
  ...(betweenRounds ? {between_rounds: true} : {}),
  ...(playbook ? {playbook: {id: playbook.id, version: playbook.playbook_version}, tie_margin: tieMargin ?? TIE_MARGIN} : {}),
  calibration: calibrationRecord(),
  bridge: {version: health.version ?? null, mod_helper: health.mod_helper ?? null, unlock_all: health.unlock_all ?? null, main_thread_pumping: health.main_thread_pumping ?? null}});

 session.setPhase('advancing', 'Stepping to the main menu.');
 await waitWhileHeld();
 let state = await advanceToMenu(bridge, dispatch, wait);
 if (state.in_game) throw Error('A match is already open. Leave it first (npm run btd6:bridge -- home --confirm), then run again.');

 session.setPhase('starting', `Starting ${setup.map} ${setup.difficulty} ${setup.mode}.`);
 const start = await dispatch(startMatchCommand(state, setup, newId(), {replaceSaved: true}));
 if (start.status !== 'executed') throw Error(`start_match was refused (${start.reason ?? start.status}${start.detail ? `: ${start.detail}` : ''}).`);
 state = await waitForState(bridge, s => s.in_game && s.match.map === setup.map, 'match', {...wait, timeoutMs: t.loadTimeoutMs});
 session.state = state;
 matchId = state.match.id;
 if (state.match.difficulty !== setup.difficulty || state.match.mode !== setup.mode)
  throw Error(`The loaded match is ${state.match.difficulty} ${state.match.mode}, not ${setup.difficulty} ${setup.mode}. Leave it and check the game.`);

 const paths = mapPaths(await bridge.map());
 meter = moabMeter({paths, now});
 popsTrack = popsTracker({paths, now});
 // A refused or failed set_speed is logged and doesn't stop the run; the keeper tries again at the next round start.
 // Adaptive mode starts at cruise; control (adaptiveSpeed) moves the keeper's target between cruise and pressure.
 // Graded mode starts at the level for the first round's margin; control (gradedSpeed) moves it between levels.
 // Graded mode caps the setup's hard rounds (hard-rounds.mjs, data/hard-rounds.json) and the rounds before them.
 const control = speedControl(mode, {now, calibrated, setup});
 const firstMargins = graded ? defenceMargins(policyView(state), paths, {camo: Boolean(mode?.camoMargin)}) : null;
 const first = graded ? control.observe(state, {margins: firstMargins}) : null;
 const keeper = speedKeeper(mode ? (adaptive ? mode.cruise : graded ? first.speed : mode.speed) : null, {now});
 const clock = speedClock({now, slowAt: adaptive ? mode.pressure : graded ? MIN_SPEED : null});
 let adapting = controlled, changes = 0;
 const applySpeed = async (s, reason, extra = {}) => {
  const target = keeper.target;
  keeper.sent();
  const result = await dispatch(speedCommand(s, target, newId())).catch(error => ({status: 'failed', reason: error.message}));
  if (result.status === 'executed' && keeper.target === target) keeper.applied();
  await log.append({kind: 'speed_set', match_id: s.match.id, round: s.round.number, speed: target, ...(controlled || betweenRounds ? {mode: speedLabel} : {}), reason, ...extra,
   status: result.status, ...(result.reason ? {refused: result.reason} : {})});
  return result;
 };
 if (mode) await applySpeed(state, graded ? `match_start: ${first.reason}` : 'match_start', graded ? {margins: firstMargins, ...(first.cap ? {cap: first.cap} : {})} : {});
 // What run_end records: the mode, time at each speed, and the changes the runner made.
 const speedTime = () => mode ? {mode: speedLabel, ...clock.totals(), ...(controlled ? {changes, adapting} : {})} : null;

 // Between-rounds mode: auto-start off for the match, restored to what it was when the match ends. A change
 // the runner didn't make (auto-start on again after the runner saw it off) is a person's: it is logged as a
 // warning, and the runner then plays as with auto-start (no between-rounds limits).
 const auto = {before: state.auto_start ?? null, off: false, seenOff: false, restored: false, yielded: false};
 const setAutoStart = async (s, enabled, reason) => {
  const result = await dispatch({command_id: newId(), action: 'set_auto_start', enabled, expect: {match_id: s.match.id}})
   .catch(error => ({status: 'failed', reason: error.message}));
  await log.append({kind: 'auto_start_set', match_id: s.match.id, round: s.round.number, enabled, previous: auto.before, reason, status: result.status,
   ...(result.reason ? {refused: result.reason} : {})});
  return result;
 };
 async function restoreAutoStart(s) {
  if (!auto.off || auto.restored || auto.before !== true || !s?.in_game || s.match.id !== matchId) return;
  auto.restored = true;
  await setAutoStart(s, true, 'restore');
 }
 if (betweenRounds) {
  if (auto.before === false) await log.append({kind: 'auto_start_set', match_id: matchId, round: state.round.number, enabled: false, previous: false, reason: 'between_rounds', status: 'already_off'});
  else {
   const r = await setAutoStart(state, false, 'between_rounds');
   if (r.status !== 'executed') throw Error(`set_auto_start was refused (${r.reason ?? r.status}); between-rounds mode needs bridge 0.3.11.`);
  }
  auto.off = true;
 }
 const betweenActive = () => betweenRounds && !auto.yielded;
 // Lives lost this round, from the bridge's count or the lives at the round start.
 const livesLostNow = s => Math.max(s.round.lives_lost ?? 0, btd6.tracker.livesAtRoundStart != null ? btd6.tracker.livesAtRoundStart - s.lives : 0);
 // The graded speed's moab_short signal: MOAB_LEAD_ROUNDS for every MOAB-class round, DDT rounds included, so the
 // 10-round DDT lead of the floor rule (from btd6-jev-v6 revision 17) doesn't hold the speed down for 10 rounds.
 const speedMoabShort = s => moabShort(policyView(s), paths, {ddtLead: MOAB_LEAD_ROUNDS});
 const dangerNow = async s => dangerSignals(s, {livesLost: livesLostNow(s), pressure: btd6.tracker.pressure.status(), moabShort: Boolean(speedMoabShort(s)),
  consult: await openConsult(), paths});
 // During a round, between-rounds mode offers purchases only in an emergency (speed.mjs EMERGENCIES).
 const offerDuringRound = s => !betweenActive() || dangerSignals(s, {livesLost: livesLostNow(s), pressure: btd6.tracker.pressure.status(), paths})
  .some(isEmergency);
 // The strategist request that is open (not yet answered), for the consult trigger.
 const openConsult = async () => {
  if (!strategist) return null;
  const read = strategist.channel.pending ?? strategist.channel.current;
  return (await read().catch(() => null))?.reason ?? null;
 };

 const shooter = shots ? shotKeeper({bridge, dir: shots.dir, root: shots.root ?? shots.dir, log, now}) : null;
 const loaded = await loadSpots(state.match.map, paths);
 const spots = Array.isArray(loaded) ? loaded : loaded.spots;
 const unplaceable = Array.isArray(loaded) ? [] : (loaded.towers ?? []).filter(t => t.valid_points === 0).map(t => t.id);
 await log.append({kind: 'spots', match_id: matchId, map: state.match.map, count: spots.length, ids: spots.map(s => s.id)});

 // The runner's last decision and when it was logged, for graded speed's buying cap (speed.mjs buyingNow).
 let lastDecision = null, lastDecisionAt = -Infinity;
 const runnerLog = {append: entry => { if (entry.kind === 'decision') { lastDecision = entry; lastDecisionAt = now(); } return log.append(entry); }};
 const seriesLog = series && {append: entry => series.append({...entry, label: policy, mode: strategist ? 'strategist' : playbook ? 'playbook' : 'jev-only', dry_run: dryRun})};
 btd6 = createBtd6Runner({bridge: steady, ask, strategist, series: seriesLog, usage, limits, paths, spots, ruleset, jevPolicy: policy,
  afterDefeat: 'home', modHelperPin, minIntervalMs: t.minIntervalMs, pollMs: t.strategyPollMs, now, speed: speedLabel, speedTime, matchId, openingTimeoutMs,
  offerDuringRound, playbook, tieMargin, zeroLeak, log: runnerLog, unplaceable, calibration: calibrationRecord(), provenance: provenance ? provenance() : null, bridgePort, aimTowers: true, onAim: (s, d) => shooter?.request(s, `aim_${d.tower_id}`), onAimRecord: (s, d) => popsTrack.aimed(s, d),
  onObserve: s => shooter && s.in_game && s.match.id === matchId ? shooter.observe(s) : null});
 const {runner} = btd6;
 session.runner = runner;
 session.setPhase('playing', `Playing match ${matchId}.`);
 if (!session.held) runner.resume();

 let resultSeenAt = null, homeSent = false, recoveries = 0, lastHealth = now(), noted = null, watching = false;
 for (;;) {
  if (session.stopRequested) { runner.pause('Stopped by the operator.', {source: 'operator', endpoint: null, timeout_ms: null, timed_out: false}); return finish('stopped', 'Stopped by the operator; the match is still open.'); }
  let outcome = 'paused';
  if (runner.status.mode === 'running') outcome = await stepWatching(() => runner.step(), () => bridge.state(),
   w => w.in_game && w.match.id === matchId ? watch(w) : null, {intervalMs: t.watchMs});
  else session.state = await steady.state().catch(() => session.state);
  const s = outcome === 'paused' ? session.state : btd6.last() ?? session.state;
  session.state = s;
  if (now() - lastHealth > t.healthEveryMs) { lastHealth = now(); session.health = await bridge.health().catch(() => session.health); }
  if (runner.status.mode === 'paused' && runner.status.message !== noted) {
   noted = runner.status.message;
   await log.append({kind: 'runner_paused', match_id: matchId, message: noted, ...(runner.status.cause ?? {source: 'runner', endpoint: null, timeout_ms: null, timed_out: false})});
  }
  // An unhandled screen over the match that has since closed (for example, the operator pressed OK).
  if (runner.status.mode === 'paused' && await btd6.resumeAfterScreen({held: session.held})) session.state = btd6.last() ?? session.state;
  if (runner.status.mode === 'running') noted = null;
  if (outcome === 'budget') return finish('limit', `${runner.status.message} The match is still open.`);
  if (s?.in_game && s.match.id !== matchId) { runner.pause('Another match is open.'); return finish('match_changed', `Match ${s.match.id} replaced ${matchId}.`); }
  if (s?.in_game && s.match.id === matchId) await watch(s);
  if (s?.in_game && s.match.result) { result = s.match.result; resultSeenAt ??= now(); await restoreAutoStart(s); }
  if (s && !s.in_game && s.main_menu && !s.loading && !s.popup) {
   if (result) return finish('ended', `The match ended in ${result}; back on the main menu.`);
   runner.pause('The match was left.');
   return finish('left_match', 'The match was left before it ended.');
  }
  if (result && s?.in_game) {
   // The runner presses Home on the victory or defeat screen. If none shows, leave the match directly.
   if (!homeSent && !s.popup && now() - resultSeenAt > t.homeAfterResultMs) {
    homeSent = true;
    const home = await dispatch(goHomeCommand(s, newId())).catch(error => ({status: 'failed', reason: error.message}));
    if (home.status !== 'executed') { runner.pause(`go_home after the ${result} failed (${home.reason ?? home.status}).`); return finish('home_failed', runner.status.message); }
   }
   // A read error between the end screen and the menu pauses the runner; resume it a few times.
   if (runner.status.mode === 'paused' && !session.held && !runner.status.uncertain && recoveries < 3) { recoveries++; runner.resume(); }
  }
  if (outcome !== 'executed') await sleep(runner.status.mode === 'running' ? t.pollMs : t.pausedPollMs);
 }

 // Per state of this match, from the loop or from a read while a step waits: the MOAB measure, screenshots, and
 // the speed clock and control. One at a time: a read that arrives while one runs is skipped.
 async function watch(s) {
  if (watching) return;
  watching = true;
  try { await watchOnce(s); } finally { watching = false; }
 }
 async function watchOnce(s) {
  await measure(meter.observe(s));
  await logPops(popsTrack.observe(s));
  if (shooter) await shooter.observe(s).catch(() => null);
  if (mode) {
   const record = clock.observe(s);
   if (record) await log.append({kind: 'speed_round', match_id: matchId, ...record});
  }
  if (!s.match.result && mode) {
   const check = keeper.observe(s);
   if (check.warning) {
    // A person's change wins: adaptive or graded mode stops for the rest of the match.
    const stop = adapting ? ` ${graded ? 'Graded' : 'Adaptive'} speed is off for the rest of the match.` : '';
    adapting = false;
    await log.append({kind: 'warning', match_id: matchId, message: check.warning + stop});
   }
   if (betweenRounds && !auto.yielded) {
    if (s.auto_start === false) auto.seenOff = true;
    else if (s.auto_start === true && auto.seenOff) {
     auto.yielded = true;
     await log.append({kind: 'warning', match_id: matchId, message: `Auto-start was turned on during round ${s.round.number}; the runner had turned it off. The runner leaves it on and plays without the between-rounds limits.`});
    }
   }
   let changed = false;
   if (adapting && !session.held && graded) {
    const margins = defenceMargins(policyView(s), paths, {camo: Boolean(mode?.camoMargin)}), danger = await dangerNow(s);
    const change = control.observe(s, {margins, danger, buying: buyingNow(lastDecision, lastDecisionAt, now())});
    if (change) {
     changes++;
     changed = true;
     keeper.retarget(change.speed);
     await applySpeed(s, change.reason, {margins, danger, ...(change.cap ? {cap: change.cap} : {})});
    }
   } else if (adapting && !session.held) {
    const pressure = btd6.tracker.pressure.status();
    const triggers = speedTriggers(s, {livesLost: livesLostNow(s), pressure, moabShort: Boolean(speedMoabShort(s)), consult: await openConsult()});
    const change = control.observe(s, triggers);
    if (change) {
     changes++;
     changed = true;
     keeper.retarget(change.speed);
     await applySpeed(s, change.speed === mode.pressure ? `slow: ${change.reason}` : `cruise: ${change.reason}`);
    }
   }
   if (check.reapply && !changed && !session.held) await applySpeed(s, `round_start (the game reported ${check.observed})`);
   // A target the game hasn't taken yet (refused behind a screen, or failed): sent again once it can be.
   else if (check.resend && !changed && !session.held) await applySpeed(s, `resend (the game reported ${check.observed})`);
  }
 }
}
