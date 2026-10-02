// Policy btd6-jev-v2: Jev alone, with a floor from the round's bloons (docs/ARCHITECTURE.md, "Policy
// btd6-jev-v2"). Same structure as v1 (policy-v1.mjs): plan-independent rules, at most MAX_CHOICES
// options per question with a second question for the spot or path, compact facts. What changes:
//  - "enough" for a round is the estimate in estimate.mjs: what the towers can pop in that round against
//    its RBE times a margin for the lives left, plus camo, lead and early-track checks;
//  - starting a round needs enough for it, and for the round after when one affordable purchase would
//    get there; waiting while a round runs or is about to start needs enough for both;
//  - Quincy (the hero) ranks right after start/wait early in the match, once placing him leaves the
//    current and next round covered;
//  - the question lists the next rounds' bloons and the estimate against their RBE, and each option's
//    added pops per second.
import {THREATS, upcomingThreats} from './rounds.mjs';
import {towerFacts} from './towers.mjs';
import {roundCheck, bloonList, towerEstimate, baseEstimate, margin, COMFORT} from './estimate.mjs';
import {MAX_CHOICES, groupOptions, criterion as criterionV1} from './policy-v1.mjs';

export const JEV_POLICY_V2 = 'btd6-jev-v2';
// Quincy ranks near the top of the capped list up to this round.
export const HERO_EARLY_ROUND = 30;

const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';
const isHero = (c, catalog = []) => c.details?.tower === 'Quincy' || catalog.some(t => t.id === c.details?.tower && t.is_hero);
const tiersOf = s => s.split('-').map(Number);

// The towers after a purchase: a placement adds the tower at its spot; an upgrade raises one path.
function after(state, c) {
 const d = c.details;
 if (d.kind === 'place') return [...state.towers, {id: -1, base_id: d.tower, tiers: [0, 0, 0], level: 1, x: c.command.x, y: c.command.y}];
 return state.towers.map(t => t.id === d.tower_id ? {...t, tiers: tiersOf(d.tiers_after)} : t);
}
// Pops per second a purchase adds (null when the tower isn't in towers.json).
function addedPps(state, c) {
 const d = c.details;
 if (d.kind === 'place') return baseEstimate(d.tower)?.pps ?? null;
 const t = state.towers.find(t => t.id === d.tower_id);
 const now = t && towerEstimate(t), next = t && towerEstimate({...t, tiers: tiersOf(d.tiers_after)});
 return now && next ? +(next.pps - now.pps).toFixed(1) : null;
}

// The rounds the rules look at: the round being played or about to start, and the one after.
function checks(state, paths) {
 const now = state.round.number, end = state.match.end_round ?? 100;
 return [now, now + 1].filter(r => r <= end).map(r => roundCheck(state.towers, r, {lives: state.lives, paths})).filter(Boolean);
}
const better = (b, a) => a.can_pop > b.can_pop || (b.camo === false && a.camo) || (b.lead === false && a.lead) || (b.early === false && a.early);

// {checks, verdict: 'short' | 'enough' | 'ahead'} for the state's towers.
export function defenceV2(state, {paths = []} = {}) {
 const list = checks(state, paths);
 const verdict = list.some(c => !c.enough) ? 'short' : list.every(c => c.ratio >= COMFORT) ? 'ahead' : 'enough';
 return {checks: list, verdict};
}

// Plan-independent rules. Each removes options and keeps at least one.
//  damage_first:   with no damage-dealing tower, no Banana Farm, Monkey Village or their upgrades
//  no_start_short: no "start round" while the round isn't covered and an affordable purchase improves
//                  it, or while it is covered, the round after isn't, and one affordable purchase covers it
//  no_wait_short:  no "wait" (a round running or about to start) while this round or the next isn't
//                  covered and an affordable purchase improves it
// Waiting stays when both rounds are covered, including when far ahead (saving for later rounds).
export function floorRulesV2(state, candidates, {paths = []} = {}) {
 if (!state.in_game || state.popup) return {candidates, constraint: null};
 let kept = candidates;
 const rules = [];
 const apply = (kind, next, extra = {}) => {
  if (next.length && next.length < kept.length) { rules.push({kind, removed: kept.length - next.length, ...extra}); kept = next; }
 };
 const damaging = state.towers.filter(t => { const e = towerEstimate(t); return e ? e.pps > 0 : towerFacts(t.base_id).damage !== false; });
 if (!damaging.length) apply('damage_first', kept.filter(c => !spends(c) || (baseEstimate(c.details.tower)?.pps ?? (towerFacts(c.details.tower).damage === false ? 0 : 1)) > 0));
 const list = checks(state, paths), short = list.filter(c => !c.enough);
 const fact = c => ({round: c.round, can_pop: c.can_pop, needs: c.needs});
 const simulated = c => list.map(ch => roundCheck(after(state, c), ch.round, {lives: state.lives, paths}));
 const improves = c => spends(c) && simulated(c).some((a, i) => !list[i].enough && better(list[i], a));
 const canImprove = kept.some(improves);
 const [cur, next] = list;
 if (cur && canImprove && !cur.enough) apply('no_start_short', kept.filter(c => c.details?.kind !== 'start_round'), fact(cur));
 else if (cur?.enough && next && !next.enough && kept.some(c => spends(c) && simulated(c)[1]?.enough))
  apply('no_start_short', kept.filter(c => c.details?.kind !== 'start_round'), fact(next));
 if (short.length && canImprove) apply('no_wait_short', kept.filter(c => c.details?.kind !== 'wait'), fact(short[0]));
 return {candidates: kept, constraint: rules.length ? {kind: 'rules', rules, removed: candidates.length - kept.length} : null};
}

// Rank for the cap: keeping the cash or starting first; then Quincy up to HERO_EARLY_ROUND, when the rounds
// checked are covered with him at one of his offered spots; then a tower
// that handles a threat due within 8 rounds that no current tower is known to handle; then purchases by
// pops per second added per dollar (most first); then those adding nothing known, towers that deal no
// damage last.
function rankV2(state, catalog, paths) {
 const covered = towers => checks({...state, towers}, paths).every(c => c.enough);
 return (group, uncovered) => {
  const d = group.details;
  if (d.kind !== 'place_group' && d.kind !== 'upgrade_group') return [0];
  const gain = Math.max(...group.members.map(m => (addedPps(state, m) ?? 0) / m.details.cost));
  if (d.kind === 'place_group') {
   if (isHero(group.members[0], catalog) && state.round.number <= HERO_EARLY_ROUND && group.members.some(m => covered(after(state, m)))) return [1, d.cost];
   if (uncovered.some(k => towerFacts(d.tower)[k] === true)) return [2, d.cost];
  }
  if (gain > 0) return [3, -gain, d.cost ?? d.cheapest];
  return towerFacts(d.tower).damage === false ? [5, d.cost ?? d.cheapest] : [4, d.cost ?? d.cheapest];
 };
}

export const groupOptionsV2 = (state, options, {catalog = [], paths = [], max = MAX_CHOICES} = {}) =>
 groupOptions(state, options, {max, rankGroup: rankV2(state, catalog, paths)});

const INSTRUCTIONS = 'Choose the next action in this Bloons TD 6 match. Only it is taken, then you may be asked again; the game keeps running meanwhile. Lives lost are not regained. rounds: the bloons each round sends and their RBE (layers to pop). defence: a rough estimate of the layers the towers can pop in each round (can_pop) against that RBE times a safety margin for the lives left (needs); missing lists what else the round lacks. pops: pops per second the option adds. track: share of the track in range, and where it lies from entrance (0) to exit (100%). answers: lead or camo, if the tower without upgrades handles them. Quincy is the hero: one per match, he gains levels as the match goes on.';
const MEMBER_INSTRUCTIONS = 'Pick the spot or upgrade path for the Bloons TD 6 action already chosen. The game keeps running meanwhile. pops: pops per second the option adds. track: share of the track in range, and where it lies from entrance (0) to exit (100%).';
const GROUP_NOTE = ' If the chosen action has several spots or upgrade paths, a second question picks one.';

function criterion(state, c) {
 const base = criterionV1(c), d = c.details ?? {};
 if (d.kind === 'wait') return {...base, effect: 'keep the cash; decide again in a few seconds'};
 const members = c.members ?? [c];
 if (!members.every(spends)) return base;
 const gains = members.map(m => addedPps(state, m)).filter(v => v != null);
 return gains.length ? {...base, pops: Math.max(...gains)} : base;
}

const MISSING = {camo: 'camo', lead: 'lead', early: 'range in the first half of the track'};
const summary = c => ({round: c.round, can_pop: c.can_pop, needs: c.needs,
 ...(c.can_pop < c.needs || ['camo', 'lead', 'early'].some(k => c[k] === false)
  ? {missing: [...(c.can_pop < c.needs ? ['pops'] : []), ...['camo', 'lead', 'early'].filter(k => c[k] === false).map(k => MISSING[k])]} : {})});

// context: {leaks, paths}; stage: 'flat' (one question), 'group' (the action) or 'member' (spot or path).
export function jevQuestionV2(state, options, context = {}, {stage = 'flat'} = {}) {
 const now = state.round.number, m = state.match, end = m.end_round ?? 100;
 const d = defenceV2(state, {paths: context.paths ?? []});
 const pps = state.towers.reduce((n, t) => n + (towerEstimate(t)?.pps ?? 0), 0);
 const defence = {pops_per_second: +pps.toFixed(1), margin: margin(state.lives, now), verdict: d.verdict, rounds: d.checks.map(summary)};
 const cash = Math.floor(state.cash);
 const facts = stage === 'member' ? {match: {round: now, round_in_progress: Boolean(state.round.active), lives: state.lives, cash}, defence} : {
  match: {map: m.map, mode: m.mode_name ?? m.mode, round: now, final_round: m.end_round ?? null, round_in_progress: Boolean(state.round.active), lives: state.lives, cash},
  towers: state.towers.map(t => `${t.base_id} ${t.is_hero ? `level ${t.level ?? (/ (\d+)$/.exec(t.name ?? '')?.[1] ?? 1)}` : t.tiers.join('-')}`),
  rounds: [now, now + 1].filter(r => r <= end).map(r => ({round: r, bloons: bloonList(r), rbe: d.checks.find(c => c.round === r)?.rbe ?? null,
   ...(THREATS.some(t => t.round === r) ? {new_threats: THREATS.filter(t => t.round === r).map(t => t.label)} : {})})),
  threats_ahead: upcomingThreats(now + 1, {within: 7, start: m.start_round ?? 1, end}).map(t => `round ${t.round}: ${t.label}`),
  defence,
  ...(context.leaks?.length ? {recent_leaks: context.leaks.slice(-3)} : {}),
 };
 return {
  state: {game: 'Bloons TD 6', ...facts},
  questions: {move: {type: 'choice', instructions: stage === 'member' ? MEMBER_INSTRUCTIONS : INSTRUCTIONS + (stage === 'group' ? GROUP_NOTE : ''),
   criteria: Object.fromEntries(options.map(c => [c.id, criterion(state, c)]))}},
 };
}

