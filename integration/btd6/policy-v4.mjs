// Policy btd6-jev-v4: Jev alone, v3 plus MOAB readiness (docs/ARCHITECTURE.md, "Policy btd6-jev-v4").
// The best v3 run (Hard Standard, bridge 0.3.7) lost all its lives to the first MOAB in round 40: v3's
// estimate counts pops (pierce and splash), which say little about one bloon with a 200-health shell.
// What changes from v3 (policy-v3.mjs):
//  - each purchase carries the MOAB damage per second it adds over the first half of the track (moab.mjs);
//  - moab_short: from MOAB_LEAD_ROUNDS (4) rounds before a MOAB-class round, while the towers' MOAB damage
//    is short of what that round needs, "Start round" and "Wait" are removed when a purchase that adds
//    MOAB damage is affordable, and those purchases move to the front (the way v2 and v3 treat camo and
//    lead: the missing piece keeps the round from starting);
//  - in the capped action list, purchases that add MOAB damage rank first while it is short (most added
//    per dollar first);
//  - the question adds `moab` (the next MOAB-class round, its health, the towers' MOAB damage per second
//    and what it needs) from 8 rounds before it, and `moab_dps` per option.
import {floorRulesV3, groupOptionsV3, jevQuestionV3, rankV3, withReach, after} from './policy-v3.mjs';
import {groupOptions, MAX_CHOICES} from './policy-v1.mjs';
import {moabCheck, moabDps, moabDue, nextMoabRound, ddtCheckOn, moabDdtLead, hasDdtRound, MOAB_LEAD_ROUNDS} from './moab.mjs';
import {applyEarlyShort} from './early.mjs';
import {applyThreatShort, answerPool, LEAD_CAPACITY_AT, threatOrder, threatChecks, capacityAnswers, burstPerDollar, camoPerDollar, leadPerDollar, withBindAnswers, THREAT_KINDS, THREAT_KEEP} from './threat.mjs';

export const JEV_POLICY_V4 = 'btd6-jev-v4';
// Rounds before the next MOAB-class round from which the question shows `moab`.
export const MOAB_FACTS_ROUNDS = 8;
// moab_short binds (moabBinding) only below this ratio of the short round's MOAB damage to its need (moabBindBelow).
export const MOAB_BIND_RATIO = 0.5;
// The DDT saving's target must add at least this share of the short round's gap, needs_dps - dps (ddtGapShare, from
// btd6-jev-v6 revision 19, btd6-playbook-v5 revision 23 and btd6-claude-v1 revision 22).
export const DDT_GAP_SHARE = 0.25;

const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';

// Options with the MOAB damage per second each purchase adds (details.moab), on top of v3's reach and pops. With the DDT
// check (moab.mjs setDdtCheck, from btd6-jev-v6 revision 13) it is the gain in moabCheck's figure for the round in focus
// (moabFocus): the DDT-capable damage when that round's toughest need is a DDT's, every tower's otherwise, as before.
export function withMoab(state, candidates, paths = []) {
 const focus = ddtCheckOn() && state.round ? moabFocus(state, paths) : null;
 const figure = focus == null ? towers => moabDps(towers, paths) : towers => moabCheck(towers, focus, {lives: state.lives, paths}).dps;
 const now = figure(state.towers);
 return candidates.map(c => spends(c) && !('moab' in c.details) ? {...c, details: {...c.details, moab: +(figure(after(state, c)) - now).toFixed(2)}} : c);
}
// The MOAB-class round the gains are for: moab_short's round, else the next MOAB-class round within MOAB_FACTS_ROUNDS, or null.
export function moabFocus(state, paths = []) {
 if (!state.match) return null;
 const now = state.round.number;
 return moabShort(state, paths)?.round ?? nextMoabRound(now, Math.min(state.match.end_round ?? 100, now + MOAB_FACTS_ROUNDS));
}
const addsMoab = c => spends(c) && (c.details.moab ?? 0) > 0;

// The weakest MOAB-class round due within MOAB_LEAD_ROUNDS (rounds with DDTs: within ddtLead, moab.mjs setMoabDdtLead by
// default) that the towers are short for, or null.
export function moabShort(state, paths = [], {ddtLead} = {}) {
 const due = moabDue(state.towers, state.round.number, {lives: state.lives, paths, end: state.match.end_round ?? 100, ...(ddtLead != null ? {ddtLead} : {})});
 return due.find(c => !c.enough) ?? null;
}

// v3's rules, then moab_short, then (threatShort: btd6-jev-v6 revision 2, btd6-playbook-v5 revision 6,
// btd6-claude-v1 revision 5; threat.mjs) threat_short. v4 itself runs without it. threatKinds: the kinds it checks,
// THREAT_KINDS (Lead and camo) or, from v6 revision 3, v5 revision 7 and claude-v1 revision 6, THREAT_KINDS_V2 (plus
// camo Lead and burst), or from v6 revision 5, v5 revision 9 and claude-v1 revision 8 THREAT_KINDS_V3 (plus camo capacity), or from v6 revision 12, v5 revision 16 and claude-v1 revision 15 THREAT_KINDS_V4 (plus Lead capacity). threatOptions: THREAT_BURST_AHEAD (threat.mjs) from v6 revision 4, v5 revision 8 and claude-v1
// revision 7 (burst adders by burst-ratio gain per dollar); {} before. threatOptions.leadDdt: true counts DDTs in lead_capacity's Lead
// RBE, as v6 revisions 12 to 14, v5 16 to 18 and claude-v1 15 to 17 did (threat.mjs). earlyShort (early.mjs): early_short, after threat_short
// (its order replaces threat_short's for burst and camo capacity; Lead, camo and camo Lead answers stay first), from v6 revision 7, v5 revision 11 and claude-v1 revision 10;
// earlyBinding (default) makes it binding, from v6 revision 8, v5 revision 12 and claude-v1 revision 11. threatBinding (default)
// makes threat_short binding with one life (threat.mjs bindAnswers), from v6 revision 9, v5 revision 13 and claude-v1 revision 12;
// when early_short also acts, it runs on threat_short's unbound order and its set applies (threat_short's Lead, camo and camo
// Lead answers stay first, as before), and threat_short's record shows binding: false, deferred_to: 'early_short'.
// moabBinding (from v6 revision 16, v5 revision 20 and claude-v1 revision 19; v4 and the earlier revisions run without it):
// with lives <= 1, while moab_short fires (a short MOAB-class round within MOAB_LEAD_ROUNDS and an affordable purchase that
// adds MOAB damage for it, details.moab: revision 13's gain for that round, so a DDT round counts only DDT-capable damage),
// the options are reduced to threat_short's Lead, camo and camo Lead answers (first, as while moab_short fires now) and the
// MOAB adders within THREAT_KEEP (0.8) of the best MOAB gain per dollar (applyMoabBinding). It runs after threat_short, on
// its unbound order when threat_short bound (its record then shows binding: false, deferred_to: 'moab_short'), so the rate
// kinds stay set aside; a threat_short saving for a check kind stands. The moab_short record carries binding: true, keep,
// best (MOAB gain per dollar), adders (the affordable MOAB adders), kept and binding_removed, and the answers for the one-life tower cap (policy-v6.mjs
// capBinding: revision 11's choice, affordable upgrade answers first, placements only when none). With no affordable MOAB
// adder moab_short does not fire, so nothing changes (it never saves). In CHIMPS series 1h match 3 (v6 revision 14, log
// 2026-10-02T00-22-58) moab_short flagged round 40 from round 36 (4.3 against 18.8 MOAB damage per second) and only removed
// "Wait"; Jev bought upgrades that added no MOAB damage and lost at round 40 (fixtures/moab-bind-r40.json).
// moabBindBelow (from v6 revision 17, v5 revision 21 and claude-v1 revision 20; MOAB_BIND_RATIO, 0.5): the binding applies only
// while the short round's ratio (moabCheck ratio) is below it; from there to 1 moab_short does what v4 does (removes "Wait" and
// "Start round", MOAB adders first), and so does the tower cap (no cap_binding). Infinity gives revision 16. Revision 16 bound
// at 1,680 of 5,829 rebuilt decisions of the CHIMPS v6 logs from 2026-10-01T20:19 under the pinned factor 1.27, which runs
// low for CHIMPS (ordinary MOAB rounds measured 1.6 to 2.2 times the estimate); the losses it answers were at 0.14 to 0.31.
// moabSaving (same revisions; false gives revision 16): with lives <= 1, while the short round has DDTs (moabCheck's ddt_dps,
// so with the DDT check on), its ratio is below moabBindBelow and no affordable purchase adds DDT-capable damage for it,
// moab_short saves for the cheapest purchase in the pool that does (withMoab's gain for that round): only the pass options
// ("Wait", "Start round") stay while it is out of reach, recorded with saving (its cost), for (its ID) and cash, as
// lead_capacity saves (threat.mjs saveFor). Leak pressure stops it, as it stops the other savings; a threat_short saving for a
// check kind stands and threat_short's Lead, camo and camo Lead answers stay. Once a DDT-capable purchase is affordable the
// binding takes over. Series 1h match 4 (log 2026-10-02T00-29-52) lost at round 90 with nothing affordable that added
// DDT-capable damage from round 86, at 13.5 against 99.3 needed.
// moabCapacity (from v6 revision 19, v5 revision 23 and claude-v1 revision 22; false gives revision 18): with lives <= 1, while
// the short round has DDTs ('ddt_dps' and hasDdtRound, as the saving tests it) and moab_short binds or saves, threat_short's
// camo_capacity and lead_capacity answers that are affordable and within THREAT_KEEP of their kind's best gain per dollar
// stay (threat.mjs capacityAnswers), after the Lead, camo and camo Lead answers and before the MOAB adders (binding) or the
// pass options (saving). threat_short evaluates those two kinds for it even while moab_short has MOAB adders (threat.mjs
// capacityUnderMoab); when moab_short then neither binds nor saves, threat_short's result without them stands. The moab_short
// record carries kept_capacity, and the binding's answers carry them for the tower cap (withBindAnswers also: the cap keeps
// those it allows). Rounds without DDTs, and so Hard Standard, are unchanged. In series 1j (revision 18) camo_capacity was
// deferred to moab_short 27, 8, 1, 17 and 0 times in the five matches; three of the five losses leaked camo regrowing Ceramics
// first, and match 2 (log 2026-10-02T05-50-38) waited through rounds 92 and 93 at a camo margin of 0.73 with $9,002 to $13,674.
// ddtGapShare (same revisions; 0 gives revision 18): the DDT saving targets the cheapest pool purchase whose MOAB gain for the
// short round (withMoab's details.moab, in the same DDT-capable figure as short.dps) is at least this share (DDT_GAP_SHARE) of
// the gap short.needs_dps - short.dps (needs_dps includes the lives margin). Without one it doesn't save, and moab_short orders
// the MOAB adders and removes "Wait" and "Start round" as from moabBindBelow to 1. The record adds gap and gain. Four of the
// five series 1j matches saved for a $16,200 Dart 5-0-2 credited with about 3 damage per second; match 2 bought one at round 88
// (40.9 to 43.8 against 99.3 needed), then saved for a second until it lost at round 93 with $13,674.
// context: {paths, leaks, pressure} as for v3; pool (optional): threat_short's saving pool, a list or a function returning it, in place of
// answerPool (the replays and fixtures pass the purchases the logs show, threat-replay.mjs poolFor).
export function floorRulesV4(state, candidates, context = {}, {threatShort = false, threatKinds = THREAT_KINDS, threatOptions = {}, earlyShort = false, earlyBinding = true, threatBinding = true, moabBinding = false, moabBindBelow = MOAB_BIND_RATIO, moabSaving = false, moabCapacity = false, ddtGapShare = 0} = {}) {
 const base = floorRulesV3(state, candidates, context);
 if (!state.in_game || state.popup) return base;
 const paths = context.paths ?? [];
 let kept = withMoab(state, base.candidates, paths);
 const rules = [...(base.constraint?.rules ?? [])];
 const short = moabShort(state, paths);
 let unbound = null;
 // Most MOAB damage added per dollar first.
 const binds = Boolean(short) && moabBinding && state.lives <= 1 && short.ratio < moabBindBelow;
 const adders = short ? kept.filter(addsMoab).sort((x, y) => y.details.moab / y.details.cost - x.details.moab / x.details.cost) : [];
 if (adders.length) {
  const next = kept.filter(c => c.details?.kind !== 'start_round' && c.details?.kind !== 'wait');
  if (next.length < kept.length || binds) rules.push({kind: 'moab_short', removed: kept.length - next.length, round: short.round, dps: short.dps, needs_dps: short.needs_dps});
  kept = [...adders, ...next.filter(c => !adders.includes(c))];
 }
 const ddtRound = Boolean(short) && 'ddt_dps' in short && hasDdtRound(short.round);
 // moabCapacity: threat_short run again with camo and Lead capacity evaluated under moab_short's adders (held), used only
 // when moab_short binds or saves.
 const holding = moabCapacity && binds && ddtRound;
 let held = null;
 if (threatShort) {
  const options = {paths, kinds: threatKinds, burstLead: threatOptions.burstLead, burstGain: threatOptions.burstGain === true, leadDdt: threatOptions.leadDdt === true, leadAt: threatOptions.leadAt ?? LEAD_CAPACITY_AT, moabFirst: adders.length > 0, all: candidates, pool: context.pool ?? (() => answerPool(state, context)), pressure: context.pressure ?? null, binding: threatBinding};
  const threat = applyThreatShort(state, kept, options);
  // Only when threat_short stood aside: when it fired, the two runs are the same.
  if (holding && adders.length && !threat.rule) {
   const more = applyThreatShort(state, kept, {...options, capacityUnderMoab: true});
   if (more.rule) held = more;
  }
  if (threat.rule) { rules.push(threat.rule); kept = threat.candidates; }
  if (threat.unbound) unbound = threat.unbound;
 }
 // The options moab_short's binding and saving work from, and threat_short's record once they act.
 const source = () => held ? held.unbound?.candidates ?? held.candidates : unbound?.candidates ?? kept;
 const defer = () => {
  if (held) rules.push(held.unbound ? {...held.unbound.rule, binding: false, deferred_to: 'moab_short'} : held.rule);
  else if (unbound) rules[rules.findIndex(r => r.kind === 'threat_short')] = {...unbound.rule, binding: false, deferred_to: 'moab_short'};
 };
 const capacity = holding ? options => capacityAnswers(options, state.cash) : () => [];
 if (binds && adders.length) {
  const bound = applyMoabBinding(state, source(), rules, capacity);
  if (bound) { defer(); kept = bound; unbound = null; held = null; }
 }
 let saved = false;
 if (moabSaving && binds && !adders.some(c => !(c.details.cost > state.cash)) && ddtRound) {
  const saving = saveForDdt(state, source(), short, rules, {paths, all: candidates, pool: context.pool ?? (() => answerPool(state, context)), pressure: context.pressure ?? null, capacity, gapShare: ddtGapShare});
  if (saving) { defer(); kept = saving; unbound = null; held = null; saved = true; }
 }
 if (earlyShort && !saved) {
  const early = applyEarlyShort(state, unbound?.candidates ?? kept, {paths, binding: earlyBinding});
  if (early.rule) {
   if (unbound) rules[rules.length - 1] = {...unbound.rule, binding: false, deferred_to: 'early_short'};
   rules.push(early.rule); kept = early.candidates;
  }
 }
 return {candidates: kept, constraint: rules.length ? {kind: 'rules', rules, removed: candidates.length - kept.length} : null};
}

// v3's ranking, with purchases that add MOAB damage first while it is short. Before them, groups with a purchase
// threat_short tagged (details.threat, set only by the policies that run it), in threat_short's order; then groups with an
// early_short answer (details.early, early.mjs), highest corrected gain per dollar first; these rank before groups threat_short
// tagged for burst or camo capacity only, after those that add Lead, camo or camo Lead.
// moab_short's binding with one life (moabBinding above). options: the order-only options (threat_short's unbound order when
// it bound). Returns the bound options, or null when it doesn't bind (a threat_short saving, or no affordable MOAB adder), and
// puts the binding on the moab_short record in rules.
const moabPerDollar = c => addsMoab(c) && c.details.cost > 0 ? c.details.moab / c.details.cost : null;
// capacity(options): the camo and Lead capacity answers kept after the check answers (moabCapacity; none by default).
function applyMoabBinding(state, options, rules, capacity = () => []) {
 if (rules.some(r => r.kind === 'threat_short' && r.saving != null)) return null;
 const answers = options.filter(c => moabPerDollar(c) != null && !(c.details.cost > state.cash)).sort((x, y) => moabPerDollar(y) - moabPerDollar(x));
 if (!answers.length) return null;
 const best = moabPerDollar(answers[0]);
 const checks = options.filter(c => (c.details?.threat?.length ?? 0) > 0 && threatChecks(c) > 0);
 const held = capacity(options).filter(c => !checks.includes(c));
 const next = [...checks, ...held, ...answers.filter(c => !checks.includes(c) && !held.includes(c) && moabPerDollar(c) >= best * THREAT_KEEP)];
 const i = rules.findIndex(r => r.kind === 'moab_short');
 const record = {...rules[i], binding: true, keep: THREAT_KEEP, best: +best.toFixed(5), adders: answers.length,
  kept: next.map(c => c.id), ...(checks.length ? {kept_threat: checks.length} : {}), ...(held.length ? {kept_capacity: held.length} : {}), binding_removed: options.length - next.length};
 rules[i] = withBindAnswers(record, {list: answers, value: moabPerDollar, keep: THREAT_KEEP, always: checks, ...(held.length ? {also: held} : {})});
 return next;
}

// moab_short's saving for a DDT round (moabSaving above). options: the options left (threat_short's unbound order when it
// bound); all: the options before any rule. Returns the options (threat_short's Lead, camo and camo Lead answers, then the pass
// options), or null when it doesn't save, and puts the saving on the moab_short record in rules (added before threat_short's if not there).
// capacity(options): the camo and Lead capacity answers kept after the check answers (moabCapacity); gapShare: the share of the
// gap the target must add (ddtGapShare; 0, any MOAB gain, by default).
function saveForDdt(state, options, short, rules, {paths, all, pool, pressure, capacity = () => [], gapShare = 0}) {
 if (pressure?.active || rules.some(r => r.kind === 'threat_short' && r.saving != null)) return null;
 const list = withMoab(state, typeof pool === 'function' ? pool() : pool ?? [], paths).filter(addsMoab).sort((a, b) => (a.details.cost ?? 1e9) - (b.details.cost ?? 1e9));
 // Both in moabCheck's figure for the short round: details.moab is the gain in short.dps (the DDT-capable figure for a DDT round).
 const gap = short.needs_dps - short.dps;
 const target = gapShare > 0 ? list.find(c => c.details.moab >= gapShare * gap) : list[0];
 if (!target || !(target.details.cost > state.cash)) return null;
 const passes = all.filter(c => c.details?.kind === 'wait' || c.details?.kind === 'start_round');
 if (!passes.length) return null;
 const checks = options.filter(c => (c.details?.threat?.length ?? 0) > 0 && threatChecks(c) > 0 && !(c.details.cost > state.cash));
 const held = capacity(options).filter(c => !checks.includes(c));
 const next = [...checks, ...held, ...passes];
 let i = rules.findIndex(r => r.kind === 'moab_short');
 // Before threat_short's record, where moab_short's goes when it removes "Wait".
 if (i < 0) { const t = rules.findIndex(r => r.kind === 'threat_short'); i = t < 0 ? rules.length : t; rules.splice(i, 0, {kind: 'moab_short', removed: 0, round: short.round, dps: short.dps, needs_dps: short.needs_dps}); }
 rules[i] = {...rules[i], ratio: short.ratio, removed: options.filter(c => !next.includes(c)).length, saving: target.details.cost, for: target.id, cash: Math.floor(state.cash),
  ...(gapShare > 0 ? {gap: +gap.toFixed(1), gain: target.details.moab} : {}),
  ...(checks.length ? {kept_threat: checks.length} : {}), ...(held.length ? {kept_capacity: held.length} : {}), ...(passes.some(c => !options.includes(c)) ? {restored: passes.map(c => c.id)} : {})};
 return next;
}

const addsEarly = c => (c.details?.early ?? 0) > 0;
const addsThreat = c => (c.details?.threat?.length ?? 0) > 0;
function rankV4(state, catalog, paths, pressure) {
 const v3 = rankV3(state, catalog, paths, pressure), short = moabShort(state, paths);
 return (group, uncovered) => {
  const threat = group.members?.filter(addsThreat).sort(threatOrder);
  const early = group.members?.filter(addsEarly);
  if (early?.length && !(threat?.length && threatChecks(threat[0]))) return [0.25, -0.5, -Math.max(...early.map(m => m.details.early)), group.details.cost ?? group.details.cheapest];
  // Burst alone (threat.mjs): most pops per dollar, or with burst_gain recorded the highest burst-ratio gain per dollar, whatever the cost.
  // Camo capacity (no check kind added): before burst alone, highest camo-margin gain per dollar first; then Lead capacity, highest
  // Lead-margin gain per dollar first.
  if (threat?.length) {
   const d = threat[0].details, n = threatChecks(threat[0]), g = burstPerDollar(threat[0]), cg = n ? null : camoPerDollar(threat[0]);
   if (cg != null) return [0.25, 0, -1, -cg];
   const lg = n ? null : leadPerDollar(threat[0]);
   if (lg != null) return [0.25, 0, -0.5, -lg];
   return [0.25, -n, n ? d.cost ?? 1e9 : 0, -(n || g == null ? (d.pops ?? 0) / (d.cost || 1) : g)];
  }
  const adding = short && group.members?.filter(addsMoab);
  if (adding?.length) return [0.5, -Math.max(...adding.map(m => m.details.moab / m.details.cost)), group.details.cost ?? group.details.cheapest];
  return v3(group, uncovered);
 };
}

export function groupOptionsV4(state, options, {catalog = [], paths = [], pressure = null, max = MAX_CHOICES} = {}) {
 const decorated = withMoab(state, options.some(c => spends(c) && !('reach' in c.details)) ? withReach(state, options, paths) : options, paths);
 if (!moabShort(state, paths) && !options.some(o => addsThreat(o) || addsEarly(o))) return groupOptionsV3(state, decorated, {catalog, paths, pressure, max});
 return groupOptions(state, decorated, {max, rankGroup: rankV4(state, catalog, paths, pressure)});
}

const MOAB_NOTE = ' moab: the next round with MOAB-class bloons, their health (the shell and any MOAB-class bloons inside), the damage per second the towers deal to one of them in the first half of the track (dps) and what that round needs (needs_dps); MOAB-class bloons take damage one hit at a time, so pops and pierce don\'t count. moab_dps: MOAB damage per second the option adds.';

// The `moab` fact: the next MOAB-class round within MOAB_FACTS_ROUNDS, or null.
export function moabFacts(state, paths = []) {
 const now = state.round.number, end = state.match.end_round ?? 100;
 const next = nextMoabRound(now, Math.min(end, now + MOAB_FACTS_ROUNDS));
 if (next == null) return null;
 const c = moabCheck(state.towers, next, {lives: state.lives, paths});
 return {next_round: next, rounds_away: next - now, bloons: c.bloons, health: c.hp, dps: c.dps, needs_dps: c.needs_dps,
  verdict: c.enough ? 'enough' : 'short', required_from_round: Math.max(now, next - (hasDdtRound(next) ? Math.max(MOAB_LEAD_ROUNDS, moabDdtLead()) : MOAB_LEAD_ROUNDS))};
}

// context: {leaks, paths, pressure}; stage as for v3.
export function jevQuestionV4(state, options, context = {}, {stage = 'flat'} = {}) {
 const paths = context.paths ?? [];
 const q = jevQuestionV3(state, options, context, {stage});
 const moab = moabFacts(state, paths);
 if (!moab) return q;
 const decorated = new Map(withMoab(state, options.flatMap(c => c.members ?? [c]), paths).map(c => [c.id, c]));
 const added = c => { const list = (c.members ?? [c]).map(m => decorated.get(m.id)?.details?.moab).filter(v => v != null); return list.length ? Math.max(...list) : null; };
 const criteria = Object.fromEntries(Object.entries(q.questions.move.criteria).map(([id, crit]) => {
  const c = options.find(o => o.id === id), v = c && (c.members ?? [c]).every(spends) ? added(c) : null;
  return [id, v == null ? crit : {...crit, moab_dps: v}];
 }));
 return {state: {...q.state, moab}, questions: {move: {...q.questions.move, instructions: q.questions.move.instructions + MOAB_NOTE, criteria}}};
}
