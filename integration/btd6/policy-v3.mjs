// Policy btd6-jev-v3: Jev alone, reacting to bloons on the track (docs/ARCHITECTURE.md, "Policy
// btd6-jev-v3"). Same structure as v2 (policy-v2.mjs). What changes:
//  - the estimate counts each tower's pops only for the track it reaches (estimate.mjs reachFactor), so a
//    base Tack Shooter no longer covers round 6 on its own;
//  - coverage per option uses the tower's own range after the purchase (data/towers.json), with the share
//    of the late part of the track (past LATE_TRACK, 0.6) in range;
//  - leak_pressure: while bloons are past LEAK_PROGRESS of the track or lives were lost this round, "wait"
//    is removed when a defence purchase is affordable, and purchases that reach the late track rank first;
//    it lasts until a round ends with no new leaks (pressureTracker);
//  - waiting otherwise needs the defence "ahead" for this round and the next, and no leaks this round or
//    the last;
//  - the question adds the bloons on the track and the pressure.
import {THREATS, upcomingThreats} from './rounds.mjs';
import {towerFacts} from './towers.mjs';
import {roundCheck, bloonList, towerEstimate, effectivePps, reachFactor, margin, COMFORT} from './estimate.mjs';
import {LATE_TRACK} from './spots.mjs';
import {MAX_CHOICES, groupOptions, criterion as criterionV1, pct} from './policy-v1.mjs';
import {HERO_EARLY_ROUND} from './policy-v2.mjs';

export const JEV_POLICY_V3 = 'btd6-jev-v3';
// The furthest bloon's progress (0 entrance, 1 exit) at which leak pressure starts.
export const LEAK_PROGRESS = LATE_TRACK;

const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';
const isHero = (c, catalog = []) => c.details?.tower === 'Quincy' || catalog.some(t => t.id === c.details?.tower && t.is_hero);
const tiersOf = s => s.split('-').map(Number);

// Leak pressure across observations. Starts when the furthest bloon passes LEAK_PROGRESS or lives are
// lost in the round; a round ending with no leaks clears it, a round ending with leaks carries it into
// the next round. A round ends when it stops running, or when the round number moves on while it runs
// (automatic start).
export function pressureTracker() {
 const p = {match: null, round: null, running: false, lastLives: null, leaked: false, active: false, reason: null, since: null};
 const start = (reason, round) => { if (!p.active) Object.assign(p, {active: true, reason, since: round}); else if (reason === 'lives_lost') p.reason = reason; };
 p.observe = s => {
  if (!s.in_game) return;
  if (s.match.id !== p.match) Object.assign(p, {match: s.match.id, round: s.round.number, running: Boolean(s.round.active), lastLives: s.lives, leaked: false, active: false, reason: null, since: null});
  // Lives lost since the last observation belong to the round that was running.
  const lost = p.lastLives != null && s.lives < p.lastLives;
  if (lost) { p.leaked = true; start('lives_lost', p.round); }
  p.lastLives = s.lives;
  const ended = p.running && (!s.round.active || s.round.number !== p.round);
  if (ended) {
   if (p.active && !p.leaked) Object.assign(p, {active: false, reason: null, since: null});
   else if (p.active) p.reason = 'leaked_last_round';
   p.leaked = false;
  }
  p.round = s.round.number;
  p.running = Boolean(s.round.active);
  if (!p.running) return;
  if ((s.round.lives_lost ?? 0) > 0) { p.leaked = true; start('lives_lost', p.round); }
  if ((s.bloons?.count ?? 0) > 0 && (s.bloons.furthest ?? 0) >= LEAK_PROGRESS) start('bloons_past_threshold', p.round);
 };
 p.status = () => ({active: p.active, reason: p.reason, since_round: p.since});
 return p;
}

// A candidate's reach with the tower's own range after the purchase (towers.json; else the shop's range).
// Global towers reach the whole track.
function reachOf(state, c, paths) {
 const d = c.details;
 const t = d.kind === 'place' ? {base_id: d.tower, tiers: [0, 0, 0], level: 1, x: c.command.x, y: c.command.y}
  : (() => { const now = state.towers.find(x => x.id === d.tower_id); return now && {...now, tiers: tiersOf(d.tiers_after)}; })();
 if (!t) return null;
 const range = towerEstimate(t)?.range ?? d.range ?? 0;
 if (!paths.length) return null;
 const {factor, reach, aim} = reachFactor(t, range, paths);
 if (aim === 'global') return {range, share: 1, from: 0, to: 1, late: 1, factor};
 // A point tower (aim.mjs) reports the track around its aim point; unaimed, none.
 if (!reach) return {range, share: 0, from: null, to: null, late: 0, factor};
 const r3 = v => v == null ? null : +v.toFixed(3);
 return {range, share: r3(reach.share), from: r3(reach.from), to: r3(reach.to), late: r3(reach.late), factor};
}
// The towers after a purchase: a placement adds the tower at its spot; an upgrade raises one path.
export function after(state, c) {
 const d = c.details;
 if (d.kind === 'place') return [...state.towers, {id: -1, base_id: d.tower, tiers: [0, 0, 0], level: 1, x: c.command.x, y: c.command.y}];
 return state.towers.map(t => t.id === d.tower_id ? {...t, tiers: tiersOf(d.tiers_after)} : t);
}
// Pops per second a purchase adds on this track (null when the tower isn't in towers.json).
function addedPps(state, c, paths) {
 const d = c.details;
 if (d.kind === 'place') return effectivePps({base_id: d.tower, tiers: [0, 0, 0], level: 1, x: c.command.x, y: c.command.y}, paths);
 const t = state.towers.find(t => t.id === d.tower_id);
 const now = t && effectivePps(t, paths), next = t && effectivePps({...t, tiers: tiersOf(d.tiers_after)}, paths);
 return now != null && next != null ? +(next - now).toFixed(2) : null;
}
// Options with their reach and effective pops added, in details (the rules, grouping and question read them).
export function withReach(state, candidates, paths = []) {
 return candidates.map(c => spends(c) ? {...c, details: {...c.details, reach: reachOf(state, c, paths), pops: addedPps(state, c, paths)}} : c);
}
// A purchase that adds to the defence: pops on this track, or a tower not known to deal no damage.
const defends = c => spends(c) && (c.details.pops != null ? c.details.pops > 0 : towerFacts(c.details.tower).damage !== false);
const reachesLate = c => (c.details.reach?.late ?? 0) > 0;

function checks(state, paths) {
 const now = state.round.number, end = state.match.end_round ?? 100;
 return [now, now + 1].filter(r => r <= end).map(r => roundCheck(state.towers, r, {lives: state.lives, paths, useReach: true})).filter(Boolean);
}
const better = (b, a) => a.can_pop > b.can_pop || (b.camo === false && a.camo) || (b.lead === false && a.lead) || (b.early === false && a.early);

export function defenceV3(state, {paths = []} = {}) {
 const list = checks(state, paths);
 const verdict = list.some(c => !c.enough) ? 'short' : list.every(c => c.ratio >= COMFORT) ? 'ahead' : 'enough';
 return {checks: list, verdict};
}
// Leaks in this round or the one before (the runner's matchTracker leaks: [{round, lives_lost}]).
export const recentLeaks = (state, leaks = []) => leaks.filter(l => l.round >= state.round.number - 1 && l.lives_lost > 0);

// Plan-independent rules. Each removes options and keeps at least one.
//  damage_first:   with no damage-dealing tower, no Banana Farm, Monkey Village or their upgrades
//  no_start_short: as in v2, with the v3 estimate
//  leak_pressure:  under leak pressure, no "wait" while a defence purchase is affordable; purchases that
//                  reach the late track are moved to the front
//  no_wait_behind: no "wait" while a defence purchase is affordable, unless the defence is ahead for this
//                  round and the next and nothing leaked this round or the last
// context: {paths, leaks, pressure: pressureTracker().status()}
export function floorRulesV3(state, candidates, {paths = [], leaks = [], pressure = null} = {}) {
 if (!state.in_game || state.popup) return {candidates, constraint: null};
 let kept = withReach(state, candidates, paths);
 const rules = [];
 const apply = (kind, next, extra = {}) => {
  if (next.length && next.length < kept.length) { rules.push({kind, removed: kept.length - next.length, ...extra}); kept = next; }
 };
 const damaging = state.towers.filter(t => { const e = towerEstimate(t); return e ? e.pps > 0 : towerFacts(t.base_id).damage !== false; });
 if (!damaging.length) apply('damage_first', kept.filter(c => !spends(c) || defends(c)));
 const list = checks(state, paths), short = list.filter(c => !c.enough);
 const fact = c => ({round: c.round, can_pop: c.can_pop, needs: c.needs});
 const simulated = c => list.map(ch => roundCheck(after(state, c), ch.round, {lives: state.lives, paths, useReach: true}));
 const improves = c => spends(c) && simulated(c).some((a, i) => !list[i].enough && better(list[i], a));
 const [cur, next] = list;
 if (cur && !cur.enough && kept.some(improves)) apply('no_start_short', kept.filter(c => c.details?.kind !== 'start_round'), fact(cur));
 else if (cur?.enough && next && !next.enough && kept.some(c => spends(c) && simulated(c)[1]?.enough))
  apply('no_start_short', kept.filter(c => c.details?.kind !== 'start_round'), fact(next));
 const canDefend = kept.some(defends);
 const noWait = () => kept.filter(c => c.details?.kind !== 'wait');
 if (pressure?.active && canDefend) {
  apply('leak_pressure', noWait(), {reason: pressure.reason, furthest: state.bloons?.furthest ?? null, lives_lost: state.round.lives_lost ?? null});
  const late = kept.filter(c => defends(c) && reachesLate(c));
  if (late.length) kept = [...late, ...kept.filter(c => !late.includes(c))];
 }
 const leaked = recentLeaks(state, leaks);
 const verdict = short.length ? 'short' : list.every(c => c.ratio >= COMFORT) ? 'ahead' : 'enough';
 // The figures behind the verdict (rbe, can_pop, needs for this round and the next), for the pops calibration's
 // outcome bounds (pops-calibration.mjs); runs before 2026-09-30 logged the verdict only.
 if (canDefend && (verdict !== 'ahead' || leaked.length)) apply('no_wait_behind', noWait(), {verdict, leaks: leaked.length,
  rounds: list.map(c => ({round: c.round, rbe: c.rbe, can_pop: c.can_pop, needs: c.needs}))});
 return {candidates: kept, constraint: rules.length ? {kind: 'rules', rules, removed: candidates.length - kept.length} : null};
}

// Rank for the cap: keeping the cash or starting first; under leak pressure, purchases that reach the
// late track (most pops added per dollar first); then as v2: Quincy early when he keeps the rounds
// covered, a tower for a threat due within 8 rounds, purchases by pops added per dollar, the rest.
export function rankV3(state, catalog, paths, pressure) {
 const covered = towers => checks({...state, towers}, paths).every(c => c.enough);
 return (group, uncovered) => {
  const d = group.details;
  if (d.kind !== 'place_group' && d.kind !== 'upgrade_group') return [0];
  const gain = Math.max(...group.members.map(m => (m.details.pops ?? 0) / m.details.cost));
  if (pressure?.active && group.members.some(m => defends(m) && reachesLate(m))) return [1, -gain, d.cost ?? d.cheapest];
  if (d.kind === 'place_group') {
   if (isHero(group.members[0], catalog) && state.round.number <= HERO_EARLY_ROUND && group.members.some(m => covered(after(state, m)))) return [2, d.cost];
   if (uncovered.some(k => towerFacts(d.tower)[k] === true)) return [3, d.cost];
  }
  if (gain > 0) return [4, -gain, d.cost ?? d.cheapest];
  return towerFacts(d.tower).damage === false ? [6, d.cost ?? d.cheapest] : [5, d.cost ?? d.cheapest];
 };
}

// Groups for the two-level question. Candidates normally arrive from floorRulesV3 with their reach.
export function groupOptionsV3(state, options, {catalog = [], paths = [], pressure = null, max = MAX_CHOICES} = {}) {
 const decorated = options.some(c => spends(c) && !('reach' in c.details)) ? withReach(state, options, paths) : options;
 return groupOptions(state, decorated, {max, rankGroup: rankV3(state, catalog, paths, pressure)});
}

const INSTRUCTIONS = 'Choose the next action in this Bloons TD 6 match. Only it is taken, then you may be asked again; the game keeps running meanwhile. Lives lost are not regained. rounds: the bloons each round sends and their RBE (layers to pop). on_track: the bloons now on the track and how far the furthest has got (0 entrance, 1 exit); pressure means bloons are near the exit or lives were lost this round. defence: a rough estimate of the layers the towers can pop in each round (can_pop) against that RBE times a safety margin for the lives left (needs); missing lists what else the round lacks. pops: pops per second the option adds on this track. track: share of the track in range, and where it lies from entrance (0) to exit (100%); late: share of the last 40% of the track in range. answers: lead or camo, if the tower without upgrades handles them. Quincy is the hero: one per match, he gains levels as the match goes on.';
const MEMBER_INSTRUCTIONS = 'Pick the spot or upgrade path for the Bloons TD 6 action already chosen. The game keeps running meanwhile. pops: pops per second the option adds on this track. track: share of the track in range, and where it lies from entrance (0) to exit (100%); late: share of the last 40% of the track in range.';
const GROUP_NOTE = ' If the chosen action has several spots or upgrade paths, a second question picks one.';

const trackText = r => r ? (r.share ? `${pct(r.share)}, ${Math.round(100 * r.from)}-${Math.round(100 * r.to)}%` : 'none') : null;
function criterion(state, c, paths) {
 const d = c.details ?? {};
 if (d.kind === 'wait') return {...criterionV1(c), effect: 'keep the cash; decide again in a few seconds'};
 const members = c.members ?? [c];
 if (!members.every(spends)) return criterionV1(c);
 const decorated = members.every(m => 'reach' in m.details) ? members : withReach(state, members, paths);
 const base = criterionV1(c);
 const best = [...decorated].sort((a, b) => (b.details.pops ?? -1) - (a.details.pops ?? -1))[0].details;
 const out = {...base, ...(best.pops != null ? {pops: best.pops} : {})};
 if (!best.reach) return out;
 const key = c.members ? 'best_track' : 'track';
 return {...out, [key]: trackText(best.reach), late: pct(best.reach.late ?? 0)};
}

// camo_lead (camo Lead bloons, from the Monkey Ace's measured share on: v6 revision 3, v5 revision 7, claude-v1 revision 6).
const MISSING = {camo: 'camo', lead: 'lead', camo_lead: 'one tower that sees camo and pops Lead', early: 'range in the first half of the track'};
const KEYS = Object.keys(MISSING);
const summary = c => ({round: c.round, can_pop: c.can_pop, needs: c.needs,
 ...(c.can_pop < c.needs || KEYS.some(k => c[k] === false)
  ? {missing: [...(c.can_pop < c.needs ? ['pops'] : []), ...KEYS.filter(k => c[k] === false).map(k => MISSING[k])]} : {})});

// The bloon-pressure summary for the question: small, no per-bloon list.
export function onTrack(state, pressure = null) {
 const b = state.bloons;
 if (!b) return null;
 const types = Object.entries(b.by_type ?? {}).slice(0, 4).map(([t, n]) => `${n} ${t}`).join(', ');
 return {count: b.count ?? 0, ...(b.count ? {furthest: b.furthest, median: b.progress_p50, types} : {}),
  lives_lost_this_round: state.round.lives_lost ?? 0, pressure: pressure?.active ? pressure.reason : null};
}

// context: {leaks, paths, pressure}; stage: 'flat' (one question), 'group' (the action) or 'member' (spot or path).
export function jevQuestionV3(state, options, context = {}, {stage = 'flat'} = {}) {
 const now = state.round.number, m = state.match, end = m.end_round ?? 100, paths = context.paths ?? [];
 const d = defenceV3(state, {paths});
 const pps = state.towers.reduce((n, t) => n + (effectivePps(t, paths) ?? 0), 0);
 const defence = {pops_per_second: +pps.toFixed(1), margin: margin(state.lives, now), verdict: d.verdict, rounds: d.checks.map(summary)};
 const cash = Math.floor(state.cash);
 const bloons = onTrack(state, context.pressure);
 const facts = stage === 'member' ? {match: {round: now, round_in_progress: Boolean(state.round.active), lives: state.lives, cash}, ...(bloons ? {on_track: bloons} : {}), defence} : {
  match: {map: m.map, mode: m.mode_name ?? m.mode, round: now, final_round: m.end_round ?? null, round_in_progress: Boolean(state.round.active), lives: state.lives, cash},
  towers: state.towers.map(t => `${t.base_id} ${t.is_hero ? `level ${t.level ?? (/ (\d+)$/.exec(t.name ?? '')?.[1] ?? 1)}` : t.tiers.join('-')}`),
  rounds: [now, now + 1].filter(r => r <= end).map(r => ({round: r, bloons: bloonList(r), rbe: d.checks.find(c => c.round === r)?.rbe ?? null,
   ...(THREATS.some(t => t.round === r) ? {new_threats: THREATS.filter(t => t.round === r).map(t => t.label)} : {})})),
  ...(bloons ? {on_track: bloons} : {}),
  threats_ahead: upcomingThreats(now + 1, {within: 7, start: m.start_round ?? 1, end}).map(t => `round ${t.round}: ${t.label}`),
  defence,
  ...(context.leaks?.length ? {recent_leaks: context.leaks.slice(-3)} : {}),
 };
 return {
  state: {game: 'Bloons TD 6', ...facts},
  questions: {move: {type: 'choice', instructions: stage === 'member' ? MEMBER_INSTRUCTIONS : INSTRUCTIONS + (stage === 'group' ? GROUP_NOTE : ''),
   criteria: Object.fromEntries(options.map(c => [c.id, criterion(state, c, paths)]))}},
 };
}

