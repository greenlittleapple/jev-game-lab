// Policy btd6-jev-v1: Jev alone, with a defence floor and short questions. What it adds over v0
// (docs/ARCHITECTURE.md, "Policy btd6-jev-v1"):
//  - rules that never start a round or keep waiting while the defence is below a simple floor;
//  - facts in the question: cost, cash after, track coverage and known answers per option, and per
//    decision the current and next rounds, the defence against the floor and the lives;
//  - at most MAX_CHOICES options per Jev question: past that, Jev first picks an action (keep the cash,
//    place a tower type, upgrade a tower), then the spot or upgrade path.
import {THREATS, upcomingThreats} from './rounds.mjs';
import {towerFacts, answers} from './towers.mjs';

export const JEV_POLICY_V1 = 'btd6-jev-v1';
export const MAX_CHOICES = 16;

// Defence floor. Points: 1 per tower that pops bloons (or might: unknown towers count) plus 1 per
// upgrade tier it has. Needed: 1 point per 4 rounds, rounded up, at least 1 (2 at round 6, 5 at round
// 20, 10 at round 40, 25 at round 100). A modest floor so that a round is never played with nothing,
// not an estimate of what a round needs; the round composition (bloon counts, RBE) isn't in the repo.
export const neededPoints = round => Math.max(1, Math.ceil(round / 4));

export function defence(state) {
 const counted = state.towers.filter(t => towerFacts(t.base_id).damage !== false);
 const points = counted.reduce((n, t) => n + 1 + t.tiers.reduce((a, b) => a + b, 0), 0);
 const needed = neededPoints(state.round.number);
 return {damage_towers: counted.length, points, needed, meets_floor: counted.length > 0 && points >= needed};
}

const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';
// A purchase that adds to the defence points: a tower not known to deal no damage, or an upgrade of one.
const defends = c => spends(c) && towerFacts(c.details.tower).damage !== false;

// Plan-independent rules. Each removes options and keeps at least one.
//  damage_first:        with no damage-dealing tower, no Banana Farm, Monkey Village or their upgrades
//  no_start_undefended: no "start round" with no damage-dealing tower, or below the floor while a
//                       defending purchase is affordable
//  no_wait_undefended:  no "wait" (during a round or before an automatic start) below the floor while a
//                       defending purchase is affordable
export function floorRules(state, candidates) {
 if (!state.in_game || state.popup) return {candidates, constraint: null};
 let kept = candidates;
 const rules = [];
 const apply = (kind, next, extra = {}) => {
  if (next.length && next.length < kept.length) { rules.push({kind, removed: kept.length - next.length, ...extra}); kept = next; }
 };
 const d = defence(state), facts = {points: d.points, needed: d.needed};
 if (d.damage_towers === 0) apply('damage_first', kept.filter(c => !spends(c) || towerFacts(c.details.tower).damage !== false));
 const canDefend = kept.some(defends);
 if (d.damage_towers === 0 || (!d.meets_floor && canDefend)) apply('no_start_undefended', kept.filter(c => c.details?.kind !== 'start_round'), facts);
 if (!d.meets_floor && canDefend) apply('no_wait_undefended', kept.filter(c => c.details?.kind !== 'wait'), facts);
 return {candidates: kept, constraint: rules.length ? {kind: 'rules', rules, removed: candidates.length - kept.length} : null};
}

export const pct = v => `${Math.round(100 * v)}%`;
// e.g. "29%, 6-35%": the share of the track in range, and where that part lies from the entrance (0) to the exit (100).
export const track = cov => cov ? (cov.share ? `${pct(cov.share)}, ${Math.round(100 * cov.from)}-${Math.round(100 * cov.to)}%` : 'none') : null;
// Known answers only when there are some; null when the tower is unknown.
export const known = list => list?.length === 0 ? {} : {answers: list};
const towerName = c => c.label.replace(/^Place /, '').replace(/ at .*$/, '');

// Threats within 8 rounds that the base form of no current tower is known to handle.
export function uncoveredThreats(state) {
 const m = state.match;
 const soon = upcomingThreats(state.round.number - 1, {within: 8, start: m.start_round ?? 1, end: m.end_round ?? 100}).map(t => t.id);
 return ['lead', 'camo'].filter(k => soon.includes(k) && !state.towers.some(t => towerFacts(t.base_id)[k] === true));
}

export function toGroup(id, members) {
 const d = members[0].details ?? {};
 if (d.kind === 'place') {
  const best = [...members].sort((a, b) => (b.details.coverage?.share ?? 0) - (a.details.coverage?.share ?? 0))[0];
  return {id, label: `Place ${towerName(members[0])}`, members,
   details: {kind: 'place_group', tower: d.tower, cost: d.cost, cash_after: d.cash_after, spots: members.length, best: best.details.coverage ?? null, answers: answers(d.tower)}};
 }
 if (d.kind === 'upgrade') return {id, label: `Upgrade ${d.tower} #${d.tower_id} (${d.tiers_before})`, members,
  details: {kind: 'upgrade_group', tower: d.tower, tower_id: d.tower_id, cheapest: Math.min(...members.map(m => m.details.cost)),
   paths: members.map(m => `path ${m.details.path}: $${m.details.cost} to ${m.details.tiers_after}`)}};
 return {id, label: members[0].label, details: d, members};
}

// Rank for the cap: keeping the cash or starting first, then a tower that handles a threat due within 8
// rounds that no current tower is known to handle, then upgrades of damage-dealing towers (cheapest
// first), then other damage-dealing placements (most track coverage first, then cheapest), then the rest.
export function rank(group, uncovered) {
 const d = group.details;
 if (d.kind === 'place_group') {
  const f = towerFacts(d.tower);
  if (uncovered.some(k => f[k] === true)) return [1, d.cost];
  return f.damage === false ? [4, d.cost] : [3, -(d.best?.share ?? 0), d.cost];
 }
 if (d.kind === 'upgrade_group') return towerFacts(d.tower).damage === false ? [4, d.cheapest] : [2, d.cheapest];
 return [0];
}
export const byRank = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };

// null when the options fit in one question; otherwise at most MAX_CHOICES groups, with the number of
// options left out as groups.dropped. rankGroup(group, uncovered) replaces rank (policy v2 uses it).
export function groupOptions(state, options, {max = MAX_CHOICES, rankGroup = rank} = {}) {
 if (options.length <= max) return null;
 const byKey = new Map();
 for (const c of options) {
  const d = c.details ?? {};
  const key = d.kind === 'place' ? `place:${d.tower}` : d.kind === 'upgrade' ? `upgrade:${d.tower_id}` : c.id;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(c);
 }
 const uncovered = uncoveredThreats(state);
 const all = [...byKey].map(([id, members]) => toGroup(id, members))
  .map((g, i) => ({g, i, r: rankGroup(g, uncovered)})).sort((a, b) => byRank(a.r, b.r) || a.i - b.i).map(x => x.g);
 const groups = all.slice(0, max);
 groups.dropped = all.slice(max).reduce((n, g) => n + g.members.length, 0);
 return groups;
}

const INSTRUCTIONS = 'Choose the next action in this Bloons TD 6 match. Only it is taken, then you may be asked again; the game keeps running meanwhile. Lives lost are not regained. defence: 1 point per damage-dealing tower and per upgrade tier, against a floor for this round (a minimum, not a target). track: share of the track in range, and where it lies from entrance (0) to exit (100%). answers: lead or camo, if the tower without upgrades is known to handle them. null: unknown.';
const MEMBER_INSTRUCTIONS = 'Pick the spot or upgrade path for the Bloons TD 6 action already chosen. The game keeps running meanwhile. track: share of the track in range, and where it lies from entrance (0) to exit (100%). answers: lead or camo, if the tower without upgrades is known to handle them.';
const GROUP_NOTE = ' If the chosen action has several spots or upgrade paths, a second question picks one.';

export function criterion(c) {
 const d = c.details ?? {};
 if (d.kind === 'wait') return {action: 'Wait and keep the cash', effect: 'decide again in a few seconds'};
 if (d.kind === 'start_round') return {action: c.label, effect: 'bloons start coming'};
 if (d.kind === 'place') return {action: c.label, cost: d.cost, cash_after: d.cash_after, track: track(d.coverage), ...known(answers(d.tower))};
 if (d.kind === 'upgrade') return {action: c.label, cost: d.cost, cash_after: d.cash_after, upgrade: d.upgrade};
 if (d.kind === 'place_group') return {action: c.label, cost: d.cost, cash_after: d.cash_after, best_track: track(d.best), ...known(d.answers)};
 if (d.kind === 'upgrade_group') return {action: c.label, paths: d.paths};
 return {action: c.label};
}

// context: {leaks}; stage: 'flat' (one question), 'group' (the action) or 'member' (spot or path).
export function jevQuestionV1(state, options, context = {}, {stage = 'flat'} = {}) {
 const now = state.round.number, m = state.match, end = m.end_round ?? 100;
 const d = defence(state);
 const match = {map: m.map, mode: m.mode_name ?? m.mode, round: now, final_round: m.end_round ?? null, round_in_progress: Boolean(state.round.active),
  lives: state.lives, cash: Math.floor(state.cash)};
 const def = {damage_towers: d.damage_towers, points: d.points, needed: d.needed, meets_floor: d.meets_floor};
 const facts = stage === 'member' ? {match: {round: now, round_in_progress: match.round_in_progress, lives: state.lives, cash: match.cash}, defence: def} : {
  match,
  towers: state.towers.map(t => `${t.base_id} ${t.tiers.join('-')}`),
  // bloons: the round's bloon count; null until the round data is in the repo.
  rounds: [now, now + 1].filter(r => r <= end).map(r => ({round: r, new_threats: THREATS.filter(t => t.round === r).map(t => t.label), bloons: null})),
  threats_ahead: upcomingThreats(now + 1, {within: 7, start: m.start_round ?? 1, end}).map(t => `round ${t.round}: ${t.label}`),
  defence: def,
  ...(context.leaks?.length ? {recent_leaks: context.leaks.slice(-3)} : {}),
 };
 return {
  state: {game: 'Bloons TD 6', ...facts},
  questions: {move: {type: 'choice', instructions: stage === 'member' ? MEMBER_INSTRUCTIONS : INSTRUCTIONS + (stage === 'group' ? GROUP_NOTE : ''),
   criteria: Object.fromEntries(options.map(c => [c.id, criterion(c)]))}},
 };
}
