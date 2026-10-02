// early_short: early answers with one life (btd6-jev-v6 revision 7, btd6-playbook-v5 revision 11, btd6-claude-v1
// revision 10; binding from v6 revision 8, v5 revision 12 and claude-v1 revision 11; btd6-jev-v4 is frozen and runs
// without it). CHIMPS series 1 lost four matches at round 6: Jev placed a
// Bomb Shooter ($405), then put the rest into its 0-0-1 upgrade ($215) and started with $30. In the current-era Hard
// Standard logs, rounds 3 to 10, a Bomb Shooter popped about 0.2 of its estimate with reach and a Dart Monkey about
// 0.5 (data/early-ratios.json, early-ratios.mjs), so the uncorrected estimate makes the Bomb look best.
//  - when: lives <= 1, the early one-life margin is in force (estimate.mjs margin, EARLY_ONE_LIFE_MARGIN), and the
//    current round or else the next one, both <= EARLY_ROUND_LAST, is short by roundCheck with reach (the verdict
//    no_start_short reads, policy-v3.mjs);
//  - answers: affordable purchases (placements and upgrades) of a measured type (at least min_tower_rounds
//    tower-rounds in data/early-ratios.json; Mermonkey, the Ace and other types without enough data are not answers)
//    whose corrected capacity for that round rises. Corrected capacity: each tower's effective pops per second times
//    its type's early ratio (the all-types ratio only for unmeasured towers already placed), over the round as
//    roundCheck counts it. An upgrade's gain is the corrected capacity after minus before. Highest gain per dollar first;
//  - effect (binding): the options are reduced to the answers whose gain per dollar is at least EARLY_KEEP times the
//    best answer's, plus threat_short's Lead, camo and camo Lead answers (threat.mjs threatChecks), which stay first.
//    Waiting and starting the round are removed. Before binding (v6 revision 7, v5 revision 11, claude-v1 revision
//    10) the answers only went first, nothing was removed but waiting and starting, and the all-types ratio ranked
//    unmeasured types; in CHIMPS series 1c Jev ignored that order (one Sniper, then its upgrade). With no answer
//    affordable it does nothing (it never saves), so the last option is never removed. It runs after threat_short (policy-v4.mjs floorRulesV4) and
//    its order replaces threat_short's for burst and camo capacity: in a CHIMPS round 6 both fire, and burst-ratio gain
//    per dollar, from the uncorrected estimate, put the Bomb Shooter first. Answers that add Lead, camo or camo Lead
//    (threat.mjs threatChecks) stay first. Answers carry details.early (gain per dollar) for the
//    grouping (policy-v4.mjs rankV4) and the tower cap (policy-v6.mjs applyTowerCap: an answering placement passes
//    the cap only when no upgrade answers). Jev's facts are unchanged.
import {readFileSync} from 'node:fs';
import {roundCheck, effectivePps, roundSeconds, EFFICIENCY, margin, popsCalibration, EARLY_ROUND_LAST, EARLY_ONE_LIFE_MARGIN} from './estimate.mjs';
import {aimStatus} from './aim.mjs';
import {after} from './policy-v3.mjs';
import {threatChecks, withBindAnswers} from './threat.mjs';

let loaded = null;
const loadRatios = () => loaded ??= JSON.parse(readFileSync(new URL('./data/early-ratios.json', import.meta.url), 'utf8'));
// The early ratio for a base tower type: its own (enough tower-rounds) or the ratio over all types.
export function earlyRatio(type, file = loadRatios()) {
 return file.types?.[type]?.ratio ?? file.all.ratio;
}
// A type's own measured early ratio (at least min_tower_rounds tower-rounds), or null.
export function measuredRatio(type, file = loadRatios()) {
 const t = file.types?.[type];
 return t && t.uses !== '*' && t.tower_rounds >= (file.min_tower_rounds ?? 30) ? t.ratio : null;
}
// Binding: early answers within EARLY_KEEP of the best gain per dollar are kept, the other purchases removed.
export const EARLY_KEEP = 0.8;

const checksOf = c => c.details?.threat?.length ? threatChecks(c) : 0;
const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';

// Corrected capacity of towers for a round: pops over the round with each type's early ratio.
export function earlyCapacity(towers, round, paths = [], file = loadRatios()) {
 const cal = popsCalibration(), factor = round >= cal.from_round ? cal.factor : 1;
 let pps = 0;
 for (const t of towers) {
  if (aimStatus(t, paths).kind === 'unaimed') continue;
  pps += (effectivePps(t, paths) ?? 0) * earlyRatio(t.base_id, file);
 }
 return pps * roundSeconds(round) * EFFICIENCY * factor;
}

// The round early_short acts for, or null: {check, round}.
export function earlyShort(state, paths = []) {
 if (!state.in_game || state.popup || !(state.lives <= 1)) return null;
 const now = state.round.number, end = state.match?.end_round ?? 100;
 for (const r of [now, now + 1]) {
  if (r > end || r > EARLY_ROUND_LAST || margin(state.lives, r) !== EARLY_ONE_LIFE_MARGIN) continue;
  const check = roundCheck(state.towers, r, {lives: state.lives, paths, useReach: true});
  if (!check) continue;
  // The current round first; the next only when the current one is enough (as no_start_short).
  if (!check.enough) return {round: r, check};
  if (r === now) continue;
 }
 return null;
}

// candidates: the options the floor rules kept. Returns {candidates, rule} (rule null when it doesn't act).
// binding: false gives the order-only rule of v6 revision 7, v5 revision 11 and claude-v1 revision 10.
export function applyEarlyShort(state, candidates, {paths = [], file = loadRatios(), binding = true} = {}) {
 const short = earlyShort(state, paths);
 if (!short) return {candidates, rule: null};
 const before = earlyCapacity(state.towers, short.round, paths, file);
 const tagged = candidates.map(c => {
  if (!spends(c) || !(c.details.cost > 0) || c.details.cost > state.cash) return c;
  if (binding && measuredRatio(towerType(state, c), file) == null) return c;
  const gain = earlyCapacity(after(state, c), short.round, paths, file) - before;
  return gain > 0 ? {...c, details: {...c.details, early: +(gain / c.details.cost).toFixed(5)}} : c;
 });
 const answers = tagged.filter(c => c.details?.early > 0).sort((a, b) => checksOf(b) - checksOf(a) || b.details.early - a.details.early);
 if (!answers.length) return {candidates, rule: null};
 const rest = tagged.filter(c => !(c.details?.early > 0) && c.details?.kind !== 'wait' && c.details?.kind !== 'start_round');
 let kept = [...answers, ...rest], extra = {};
 if (binding) {
  // Lead, camo and camo Lead answers first, then the early answers within EARLY_KEEP of the best.
  const best = answers.reduce((m, c) => Math.max(m, c.details.early), 0);
  const threat = tagged.filter(c => checksOf(c) > 0).sort((a, b) => checksOf(b) - checksOf(a) || (b.details.early ?? 0) - (a.details.early ?? 0));
  kept = [...threat, ...answers.filter(c => !threat.includes(c) && c.details.early >= best * EARLY_KEEP)];
  extra = {binding: true, keep: EARLY_KEEP, best_gain_per_dollar: best, kept: kept.map(c => c.id), kept_threat: threat.length};
 }
 const first = answers[0];
 const rule = {kind: 'early_short', removed: tagged.length - kept.length, ...extra, round: short.round, can_pop: short.check.can_pop, needs: short.check.needs,
  corrected_can_pop: Math.round(before), corrected_ratio: +(before / short.check.needs).toFixed(2), answers: answers.length, first: first.id,
  first_tower: first.details.tower ?? null, first_cost: first.details.cost, first_gain_per_dollar: first.details.early, first_type_ratio: earlyRatio(towerType(state, first), file)};
 // The answers before the keep cut, for the one-life tower cap (threat.mjs withBindAnswers, from v6 revision 11).
 if (binding) withBindAnswers(rule, {list: answers, value: c => c.details?.early > 0 ? c.details.early : null, keep: EARLY_KEEP, always: kept.filter(c => checksOf(c) > 0)});
 return {candidates: kept, rule};
}

const towerType = (state, c) => c.details.kind === 'place' ? c.details.tower : state.towers.find(t => t.id === c.details.tower_id)?.base_id;
