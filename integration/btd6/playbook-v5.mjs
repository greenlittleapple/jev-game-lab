// Policy btd6-playbook-v5: btd6-jev-v4 plus a playbook written ahead of time (docs/ARCHITECTURE.md, "Policy
// btd6-playbook-v5"). The playbook holds strategist-quality plans for round ranges (phases, in claude-v1's plan
// format) and branches: a condition computed from the state plus an override of the plan. Code picks the
// phase for the round, applies the branches whose conditions hold, and enforces the result with claude-v1's
// filters (rules-v1.mjs). No Claude call is made during a match.
//
// Condition language (a branch's `when`; every listed condition must hold):
//   rounds: [from, to]            the current round is in the range (inclusive)
//   moab_short: {within: n}       the next MOAB-class round within n rounds needs more MOAB damage per second
//                                 than the towers have (moab.mjs moabCheck, v4's measure)
//   lives_lost: {rounds: n, at_least: l}  at least l lives were lost in the last n rounds (this one included)
//   no_free_spot: true            the next due target that needs a new tower has no free valid spot for it
//   cash_above: {margin: m}       cash is at least m above the cheapest purchase that advances a due target
//                                 (above 0 when no target is due; never while a due target is unaffordable)
// Conditions are evaluated against the phase's plan before any override, so branches don't depend on
// each other. Matching branches are applied in file order.
//
// Override fields, applied in this order:
//   build           targets; one with an existing ID replaces it in place, a new one goes at the end
//   threats         threat answers; one for a listed threat replaces it
//   cash_hold       holds, added
//   lift_holds      true: no cash holds
//   bring_forward   n: every target's round_from comes n rounds earlier
//   focus           target IDs that are due now at priority 0 (before every other target)
//   defer_unplaceable  true: due targets needing a new tower with no free spot are dropped, with their holds
//                   and threat answers, so the plan moves on to upgrades
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validatePlan} from '../../core/plan-schema.mjs';
import {PLAN_SCHEMA_V1, parseTiers, crosspathOk, dueTargets, onPlanPurchases, activeHold} from './plan-v1.mjs';
import {THREAT_IDS} from './rounds.mjs';
import {moabCheck, nextMoabRound} from './moab.mjs';
import {DEFAULT_RULESET} from './rulesets.mjs';
import TOWER_DATA from './data/towers.json' with {type: 'json'};

export const PLAYBOOK_POLICY_V5 = 'btd6-playbook-v5';
// The policy's code revision, recorded in each decision's plan record and in run_start: 23: moab_short's DDT binding and saving keep camo_capacity and lead_capacity answers within 0.8 of their kind's best gain per dollar, after the Lead, camo and camo Lead answers, and the DDT saving targets only the cheapest purchase that adds a quarter of the short round's gap (policy-v4.mjs moabCapacity, ddtGapShare; game.mjs gives the earlier floor with moabCapacity: false, ddtGapShare: 0). In series 1j (btd6-jev-v6 revision 18) camo_capacity was deferred to moab_short up to 27 times a match, three of the five losses leaked camo regrowing Ceramics first, and four matches saved for a $16,200 Dart 5-0-2 credited with about 3 damage per second; 22: lead_capacity is due below a Lead margin of 1.0 again, as before revision 21 (threat.mjs LEAD_CAPACITY_AT; in CHIMPS v6 revision 17's first match lead_capacity stayed off at a round-28 Lead margin of 0.62, Jev bought Dart Monkeys and the match was lost at round 28 to Leads; every revision 12 to 14 match passed round 28) (threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R17} gives revision 21); 21: with one life moab_short binds only while the short round's ratio is below 0.5 (policy-v4.mjs MOAB_BIND_RATIO; from 0.5 to 1 it removes "Wait" and "Start round" and orders the MOAB adders, as v4 does); it looks 10 rounds ahead for rounds with DDTs (moab.mjs MOAB_DDT_LEAD_ROUNDS, set by the session; the graded speed keeps 4) and, with one life, below 0.5 and with no affordable DDT-capable purchase, saves for the cheapest one, keeping only the pass options (moabSaving); lead_capacity is due below a Lead margin of 0.5 instead of 1.0 (threat.mjs LEAD_CAPACITY_AT) (moabBindBelow: Infinity, moabSaving: false, threatOptions.leadAt: LEAD_CAPACITY_AT_R12 and setMoabDdtLead(MOAB_LEAD_ROUNDS) give revision 20); 20: with one life moab_short binds: while a short MOAB-class round within its lead has an affordable purchase that adds MOAB damage for it (the per-round gain, so a DDT round counts only DDT-capable damage), only threat_short's Lead, camo and camo Lead answers, first, and the MOAB adders within 0.8 of the best MOAB gain per dollar stay; with 12 or more towers affordable upgrade answers come first and placements pass only when none (policy-v4.mjs moabBinding, policy-v6.mjs capBinding; moabBinding: false gives revision 19); 19: lead_capacity's Lead RBE counts only Lead bloons that aren't MOAB-class (Lead and its camo, fortified and regrow variants), leaving DDTs, including those inside a BAD, to the DDT-capable MOAB figure (estimate.mjs leadRbe, threat.mjs; threatOptions.leadDdt: true gives revision 18); 18: with one life and 12 or more towers, a burst binding with no affordable answer the tower cap allows steps aside for that decision instead of passing its placement answers: threat_short only orders the options and the cap removes placements as usual, so upgrades or waiting; camo capacity, Lead capacity and early_short keep the placement pass (policy-v6.mjs applyTowerCap burstStandAside; burstStandAside: false gives revision 17); 17: DDT-capable MOAB damage (moab.mjs setDdtCheck, hitsDdt): in moabCheck a DDT, and the DDTs inside a BAD, count only the MOAB damage of towers with an attack that sees camo and pops Lead and Black (data/towers-ddt.json), and the check takes the toughest need for each bloon's own figure, so moab_short, moab_outrun, graded speed and the MOAB gains that order answers use the DDT figure in a DDT round (setDdtCheck(false) gives revision 16); 16: a Lead capacity kind in threat_short (threat.mjs THREAT_KINDS_V4, lead_capacity): a round within 3 rounds with Lead bloons whose Lead margin (estimate.mjs leadCheck) is below 1.0 puts the purchases that raise it first, by Lead-margin gain per dollar, binding with one life as camo capacity does, and with one life saving for the cheapest answer while none is affordable, as the Lead check does, and set aside as camo capacity is while moab_short fires; 15: with one life and 12 or more towers, a camo capacity, burst or early_short binding chooses among the answers the tower cap allows (affordable upgrades and on-plan placements, within 0.8 of the best of those), and its placement answers pass the cap when there are none (policy-v6.mjs applyTowerCap bindUnderCap); 14: with one life the tower cap's exception passes only placements that add a missing Lead, camo or camo Lead; camo capacity, burst and early_short answers must be upgrades while 12 or more towers are placed (policy-v6.mjs applyTowerCap, ONE_LIFE_PASS); 13: threat_short binds with one life: while a gap has an affordable answer, only that gap's answers stay (Lead, camo and camo Lead: all of them; camo capacity and burst: within 0.8 of the best gain per dollar; threat.mjs bindAnswers, THREAT_KEEP); 
// 12: early_short
// binds: only answers within 0.8 of the best gain per dollar (and Lead, camo and camo Lead answers) stay, and unmeasured types are not answers (early.mjs EARLY_KEEP); 11 adds early_short to the floor
// (early.mjs; a survival rule, rules-v1.mjs SURVIVAL_RULES): with one life, a short round up to 10 puts the purchases with the
// highest corrected capacity gain per dollar (data/early-ratios.json) first; 10 sets the one-life
// margin for rounds up to 10 at 3.0 times RBE (estimate.mjs EARLY_ONE_LIFE_MARGIN); 9 adds camo capacity to threat_short
// (threat.mjs THREAT_KINDS_V3, camo_capacity), with playbook 1.1.0; 8: the tower table (data/towers.json 922e6b5e918c: on-damage projectiles such as the Sniper's shrapnel counted, the Skywarden at one weapon of its stance-swapped pair, the Bomb Shooter's ring clusters at half) changes every estimate behind its decisions,
// and threat_short takes its burst adders by burst-ratio gain per dollar (threat.mjs THREAT_BURST_AHEAD; the same order as
// 7's pops per dollar in effect); 7 adds camo Lead and burst
// to threat_short (threat.mjs THREAT_KINDS_V2) and counts the Monkey Ace at its measured share (towers.mjs
// GLOBAL_SHARE); 6 runs the floor with
// threat_short (threat.mjs; a survival rule, rules-v1.mjs SURVIVAL_RULES); 5 adds btd6-jev-v6's
// tower cap after the plan filters, also under survival_first, with on-plan placements exempt (rules-v1.mjs
// towerCap); 4 lets majority wait
// replace "Wait" only with an on-plan purchase, one that advances a target due now (game.mjs planMajorityWait); 3 replaces "Wait" with
// the most probable purchase when more than half of Jev's probability is on purchases, after the plan filters
// (game.mjs MAJORITY_WAIT); 2 drops holds whose targets
// are complete and removes waiting while an on-plan purchase is affordable (rules-v1.mjs idle_cash); 1 (unrecorded)
// is the version of the first two graded runs.
export const V5_REVISION = 23;
// Jev's top two options within this probability are a near tie, which the playbook's ranking decides.
export const TIE_MARGIN = 0.05;
// A threat's answer goes before every other target in the rounds this close to the threat's by_round.
export const THREAT_LEAD = 3;
// Threats every playbook answers.
export const REQUIRED_THREATS = ['camo', 'lead', 'purple', 'fortified', 'moab', 'bfb', 'zomg', 'ddt'];
const HEROES = [DEFAULT_RULESET.hero];
const TOWERS = Object.keys(TOWER_DATA.towers).filter(id => !HEROES.includes(id));

const V1 = PLAN_SCHEMA_V1.properties;
const short = n => ({type: 'string', maxLength: n});
const round = {type: 'integer', minimum: 1, maximum: 200};
const itemId = {type: 'string', pattern: '^[a-z][a-z0-9_]{0,15}$'};
// claude-v1's target without `spot`: spot IDs change when the catalog is rebuilt.
const {spot: _spot, ...targetProps} = V1.build.items.properties;
const TARGET = {...V1.build.items, properties: targetProps};
const BUILD = {...V1.build, items: TARGET};
const WHEN = {type: 'object', additionalProperties: false, properties: {
 rounds: {type: 'array', minItems: 2, maxItems: 2, items: round},
 moab_short: {type: 'object', additionalProperties: false, required: ['within'], properties: {within: {type: 'integer', minimum: 1, maximum: 20}}},
 lives_lost: {type: 'object', additionalProperties: false, required: ['rounds', 'at_least'],
  properties: {rounds: {type: 'integer', minimum: 1, maximum: 10}, at_least: {type: 'integer', minimum: 1, maximum: 1000}}},
 no_free_spot: {type: 'boolean'},
 cash_above: {type: 'object', additionalProperties: false, required: ['margin'], properties: {margin: {type: 'integer', minimum: 0, maximum: 1000000}}},
}};
const OVERRIDE = {type: 'object', additionalProperties: false, properties: {
 build: {...BUILD, maxItems: 8}, threats: V1.threats, cash_hold: V1.cash_hold, lift_holds: {type: 'boolean'},
 bring_forward: {type: 'integer', minimum: 1, maximum: 30}, focus: {type: 'array', maxItems: 6, items: itemId}, defer_unplaceable: {type: 'boolean'},
}};
export const PLAYBOOK_SCHEMA = {
 type: 'object', additionalProperties: false,
 required: ['playbook_version', 'id', 'setup', 'summary', 'hero', 'phases', 'branches'],
 properties: {
  playbook_version: {type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$'},
  id: {type: 'string', pattern: '^[a-z0-9-]{1,60}$'},
  setup: {type: 'object', additionalProperties: false, required: ['map', 'difficulty', 'mode', 'start_round', 'end_round'],
   properties: {map: short(40), difficulty: short(20), mode: short(20), start_round: round, end_round: round}},
  summary: short(300),
  note: short(300),
  hero: V1.hero,
  phases: {type: 'array', minItems: 1, maxItems: 12, items: {type: 'object', additionalProperties: false,
   required: ['id', 'from_round', 'to_round', 'summary', 'build', 'cash_hold', 'threats'],
   properties: {id: itemId, from_round: round, to_round: round, summary: short(200), build: BUILD, cash_hold: V1.cash_hold, threats: V1.threats}}},
  branches: {type: 'array', maxItems: 16, items: {type: 'object', additionalProperties: false, required: ['id', 'when', 'override'],
   properties: {id: itemId, when: WHEN, override: OVERRIDE, note: short(160)}}},
 },
};

// ---- Validation ----
// The table row for a tower at tiers, from data/towers.json: {lead, camo, moab} or null.
function row(tower, tiers) {
 const r = TOWER_DATA.towers[tower]?.[tiers.replaceAll('-', '')];
 return r ? {lead: r[1] === 1, camo: r[2] === 1, moab: r[4] ?? 0} : null;
}
// What a threat answer must do, checked against the table: [test, description].
const ANSWERS = {
 camo: [r => r.camo, 'detect camo'], camo_lead: [r => r.camo && r.lead, 'detect camo and pop lead'],
 lead: [r => r.lead, 'pop lead'], fortified: [r => r.lead, 'pop lead'],
 moab: [r => r.moab > 0, 'damage MOAB-class bloons'], bfb: [r => r.moab > 0, 'damage MOAB-class bloons'],
 zomg: [r => r.moab > 0, 'damage MOAB-class bloons'], fortified_moab: [r => r.moab > 0, 'damage MOAB-class bloons'],
 ddt: [r => r.camo && r.lead && r.moab > 0, 'detect camo, pop lead and damage MOAB-class bloons'],
 bad: [r => r.moab > 0, 'damage MOAB-class bloons'],
};

function checkTargets(build, at, errors) {
 build.forEach((b, n) => {
  const where = `${at}.build[${n}]`;
  if (b.id === 'hero') errors.push(`${where}.id "hero" is reserved for the hero`);
  if (!TOWERS.includes(b.tower)) errors.push(`${where}.tower ${b.tower} is not a tower in data/towers.json`);
  if (!crosspathOk(parseTiers(b.tiers))) errors.push(`${where}.tiers ${b.tiers} breaks the crosspath rule`);
  if (b.round_by < b.round_from) errors.push(`${where}.round_by is before round_from`);
 });
}

// Schema check, then the playbook's own rules. Returns a list of errors (empty when valid).
export function validatePlaybook(pb) {
 const errors = validatePlan(pb, PLAYBOOK_SCHEMA, 'playbook');
 if (errors.length) return errors;
 const {setup} = pb;
 if (setup.end_round < setup.start_round) errors.push('playbook.setup.end_round is before start_round');
 if (pb.hero.tower !== 'none' && !HEROES.includes(pb.hero.tower)) errors.push(`playbook.hero.tower must be ${HEROES.join(' or ')} or "none"`);
 const ids = new Set(['hero']), phaseIds = new Set();
 pb.phases.forEach((p, i) => {
  const at = `playbook.phases[${i}]`;
  if (phaseIds.has(p.id)) errors.push(`${at}.id ${p.id} is used twice`);
  phaseIds.add(p.id);
  if (p.to_round < p.from_round) errors.push(`${at}.to_round is before from_round`);
  if (i === 0 && p.from_round > setup.start_round) errors.push(`${at} starts after the setup's first round ${setup.start_round}`);
  if (i > 0 && p.from_round !== pb.phases[i - 1].to_round + 1) errors.push(`${at}.from_round must follow the previous phase (${pb.phases[i - 1].to_round + 1})`);
  const own = new Set(['hero']);
  for (const b of p.build) { if (own.has(b.id)) errors.push(`${at}.build id ${b.id} is used twice`); own.add(b.id); ids.add(b.id); }
  checkTargets(p.build, at, errors);
  p.cash_hold.forEach((h, n) => {
   if (h.to_round < h.from_round) errors.push(`${at}.cash_hold[${n}].to_round is before from_round`);
   for (const id of h.for) if (!own.has(id)) errors.push(`${at}.cash_hold[${n}].for ${id} is not a target of this phase`);
  });
  p.threats.forEach((t, n) => {
   const target = p.build.find(b => b.id === t.answer);
   if (!target && t.answer !== 'hero') { errors.push(`${at}.threats[${n}].answer ${t.answer} is not a target of this phase`); return; }
   const need = ANSWERS[t.threat];
   if (!target || !need) return;
   const r = row(target.tower, target.tiers);
   if (!r) errors.push(`${at}.threats[${n}]: ${target.tower} ${target.tiers} is not in data/towers.json`);
   else if (!need[0](r)) errors.push(`${at}.threats[${n}]: ${target.tower} ${target.tiers} does not ${need[1]} (${t.threat})`);
  });
 });
 const last = pb.phases.at(-1);
 if (last && last.to_round < setup.end_round) errors.push(`the last phase ends at ${last.to_round}, before the setup's final round ${setup.end_round}`);
 const answered = new Set(pb.phases.flatMap(p => p.threats.map(t => t.threat)));
 for (const t of REQUIRED_THREATS) if (!answered.has(t)) errors.push(`no phase answers the threat ${t}`);
 const branchIds = new Set();
 pb.branches.forEach((b, i) => {
  const at = `playbook.branches[${i}]`;
  if (branchIds.has(b.id)) errors.push(`${at}.id ${b.id} is used twice`);
  branchIds.add(b.id);
  if (!Object.keys(b.when).length) errors.push(`${at}.when needs at least one condition`);
  if (b.when.rounds && b.when.rounds[1] < b.when.rounds[0]) errors.push(`${at}.when.rounds ends before it starts`);
  if (b.when.no_free_spot === false) errors.push(`${at}.when.no_free_spot can only be true`);
  if (!Object.keys(b.override).length) errors.push(`${at}.override is empty`);
  const known = new Set([...ids, ...(b.override.build ?? []).map(x => x.id)]);
  if (b.override.build) checkTargets(b.override.build, `${at}.override`, errors);
  for (const id of b.override.focus ?? []) if (!known.has(id)) errors.push(`${at}.override.focus ${id} is not a target`);
  (b.override.cash_hold ?? []).forEach((h, n) => { for (const id of h.for) if (!known.has(id)) errors.push(`${at}.override.cash_hold[${n}].for ${id} is not a target`); });
  (b.override.threats ?? []).forEach((t, n) => { if (!known.has(t.answer)) errors.push(`${at}.override.threats[${n}].answer ${t.answer} is not a target`); });
 });
 for (const t of pb.phases.flatMap(p => p.threats)) if (!THREAT_IDS.includes(t.threat)) errors.push(`unknown threat ${t.threat}`);
 return errors;
}

export async function loadPlaybook(file) {
 const pb = JSON.parse(await readFile(file, 'utf8'));
 const errors = validatePlaybook(pb);
 if (errors.length) throw Error(`${file} is not a valid playbook:\n ${errors.join('\n ')}`);
 return pb;
}

// The playbook in `dir` for a setup ({map, difficulty, mode}), or an error naming what exists.
export async function findPlaybook(dir, setup) {
 const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json')).sort();
 for (const f of files) {
  const pb = await loadPlaybook(join(dir, f));
  if (pb.setup.map === setup.map && pb.setup.difficulty === setup.difficulty && pb.setup.mode === setup.mode) return {file: join(dir, f), playbook: pb};
 }
 throw Error(`No playbook in ${dir} for ${setup.map} ${setup.difficulty} ${setup.mode}; pass one with --playbook <file>.`);
}

// ---- Entry selection ----
export function phaseAt(pb, roundNumber) {
 return pb.phases.find(p => p.from_round <= roundNumber && roundNumber <= p.to_round)
  ?? (roundNumber < pb.phases[0].from_round ? pb.phases[0] : pb.phases.at(-1));
}

const copyPlan = (pb, phase) => ({summary: phase.summary, hero: {...pb.hero}, build: phase.build.map(b => ({...b})),
 cash_hold: phase.cash_hold.map(h => ({...h, for: [...h.for]})), threats: phase.threats.map(t => ({...t})), note: ''});

const heroTower = plan => plan.hero?.tower && plan.hero.tower !== 'none' ? plan.hero.tower : null;
// Due targets that still need a new tower, in priority order, with the tower each needs.
function placementsDue(plan, state, context) {
 return dueTargets(plan, state, context).filter(t => t.towers.length < t.need)
  .sort((a, b) => a.priority - b.priority).map(t => ({id: t.item.id, tower: t.item.hero ? heroTower(plan) : t.item.tower}));
}
const freeFor = (context, tower) => (typeof context.freeSpotsFor === 'function' ? context.freeSpotsFor(tower) : context.freeSpots) ?? [];

// Each condition: (arg, state, plan, candidates, context) -> {holds, fact}.
export const CONDITIONS = {
 rounds: ([from, to], state) => ({holds: from <= state.round.number && state.round.number <= to, fact: state.round.number}),
 moab_short: ({within}, state, plan, candidates, context) => {
  const now = state.round.number, next = nextMoabRound(now, Math.min(state.match.end_round ?? 100, now + within));
  if (next == null) return {holds: false, fact: null};
  const c = moabCheck(state.towers, next, {lives: state.lives, paths: context.paths ?? []});
  return {holds: !c.enough, fact: {round: next, dps: c.dps, needs_dps: c.needs_dps}};
 },
 lives_lost: ({rounds, at_least}, state, plan, candidates, context) => {
  const now = state.round.number;
  const lost = (context.leaks ?? []).filter(l => l.round > now - rounds && l.round <= now).reduce((n, l) => n + l.lives_lost, 0);
  return {holds: lost >= at_least, fact: lost};
 },
 no_free_spot: (on, state, plan, candidates, context) => {
  const next = placementsDue(plan, state, context)[0];
  if (!on || !next?.tower) return {holds: false, fact: null};
  return {holds: freeFor(context, next.tower).length === 0, fact: next.id};
 },
 cash_above: ({margin}, state, plan, candidates, context) => {
  const on = onPlanPurchases(plan, state, candidates, context);
  const costs = candidates.filter(c => on.has(c.id)).map(c => c.details.cost);
  const next = costs.length ? Math.min(...costs) : dueTargets(plan, state, context).length ? Infinity : 0;
  return {holds: state.cash - next >= margin, fact: Number.isFinite(next) ? next : null};
 },
};

export function branchHolds(branch, state, plan, candidates, context = {}) {
 const facts = {};
 for (const [name, arg] of Object.entries(branch.when)) {
  const r = CONDITIONS[name](arg, state, plan, candidates, context);
  facts[name] = r.fact;
  if (!r.holds) return {holds: false, facts};
 }
 return {holds: true, facts};
}

function applyOverride(plan, o, state, context, start) {
 const now = state.round.number;
 for (const item of o.build ?? []) {
  const i = plan.build.findIndex(b => b.id === item.id);
  if (i >= 0) plan.build[i] = {...item}; else plan.build.push({...item});
 }
 for (const t of o.threats ?? []) {
  const i = plan.threats.findIndex(x => x.threat === t.threat);
  if (i >= 0) plan.threats[i] = {...t}; else plan.threats.push({...t});
 }
 plan.cash_hold.push(...(o.cash_hold ?? []).map(h => ({...h, for: [...h.for]})));
 if (o.lift_holds) plan.cash_hold = [];
 if (o.bring_forward) {
  for (const b of plan.build) b.round_from = Math.max(start, b.round_from - o.bring_forward);
  plan.hero.round_from = Math.max(start, plan.hero.round_from - o.bring_forward);
 }
 for (const id of o.focus ?? []) {
  const b = plan.build.find(x => x.id === id);
  if (b) Object.assign(b, {round_from: Math.min(b.round_from, now), priority: 0});
 }
 const deferred = [];
 if (o.defer_unplaceable) {
  for (const t of placementsDue(plan, state, context)) if (t.tower && freeFor(context, t.tower).length === 0) deferred.push(t.id);
  plan.build = plan.build.filter(b => !deferred.includes(b.id));
  if (deferred.includes('hero')) plan.hero = {...plan.hero, tower: 'none'};
  plan.cash_hold = plan.cash_hold.map(h => ({...h, for: h.for.filter(id => !deferred.includes(id))})).filter(h => h.for.length);
  plan.threats = plan.threats.filter(t => !deferred.includes(t.answer));
 }
 return deferred;
}

// The plan in force for a decision: the phase for the round, with the branches whose conditions hold.
// Returns claude-v1's plan shape plus `record`, what the decision log keeps about it.
// context: the runner's facts {lead, catalog, paths, leaks, freeSpots, freeSpotsFor}.
export function resolvePlaybook(pb, state, candidates, context = {}) {
 const phase = phaseAt(pb, state.round.number);
 const base = copyPlan(pb, phase);
 const plan = copyPlan(pb, phase);
 const branches = [], deferred = [];
 for (const b of pb.branches) {
  const check = branchHolds(b, state, base, candidates, context);
  if (!check.holds) continue;
  deferred.push(...applyOverride(plan, b.override, state, context, pb.setup.start_round));
  branches.push({id: b.id, facts: check.facts});
 }
 const due = dueTargets(plan, state, context).sort((a, b) => a.priority - b.priority).slice(0, 6).map(t => t.item.id);
 const hold = activeHold(plan, state.round.number, state);
 plan.record = {playbook: pb.id, version: pb.playbook_version, revision: V5_REVISION, phase: phase.id, branches, due, hold: hold?.amount ?? null, ...(deferred.length ? {deferred} : {})};
 return plan;
}

// ---- Ranking and the near-tie break ----
// The playbook's rank of each option (lower is better): the priority of a due target it advances (0 for a
// threat answer within the lead time or a focus target), else 4 + the priority of a later target it
// advances, else null (not ranked). A group ranks as its best member.
export function playbookRanks(plan, state, options, context = {}) {
 const flat = options.flatMap(o => o.members ?? [o]);
 const due = onPlanPurchases(plan, state, flat, context), later = onPlanPurchases(plan, state, flat, {...context, anyRound: true});
 const rank = c => due.has(c.id) ? due.get(c.id).priority : later.has(c.id) ? 4 + later.get(c.id).priority : null;
 return new Map(options.map(o => {
  const ranks = (o.members ?? [o]).map(rank).filter(r => r != null);
  return [o.id, ranks.length ? Math.min(...ranks) : null];
 }));
}

// When Jev's top two options are within `margin`, take the one the playbook ranks higher; when neither is
// ranked, or they rank the same, Jev's choice stays. Returns null (no near tie, or no ranked option) or
// {choice, record}.
export function tieBreakV5(state, options, answer, plan, {margin = TIE_MARGIN, context = {}} = {}) {
 if (!(margin > 0) || !plan) return null;
 const probs = Object.entries(answer?.probabilities ?? {}).filter(([id, p]) => Number.isFinite(p) && options.some(o => o.id === id)).sort((a, b) => b[1] - a[1]);
 if (probs.length < 2) return null;
 const [[a, pa], [b, pb]] = probs, gap = pa - pb;
 if (gap > margin) return null;
 const ranks = playbookRanks(plan, state, options, context);
 const ra = ranks.get(a), rb = ranks.get(b);
 if (ra == null && rb == null) return null;
 let choice = answer.choice;
 if (ra != null && (rb == null || ra < rb)) choice = a;
 else if (rb != null && (ra == null || rb < ra)) choice = b;
 return {choice, record: {margin: +gap.toFixed(3), top: [a, b], ranks: [ra, rb], jev: answer.choice, chosen: choice, switched: choice !== answer.choice}};
}

// The smallest gap between the top two probabilities in a Jev answer, or null with fewer than two.
export function topTwoMargin(answer) {
 const p = Object.values(answer?.probabilities ?? {}).filter(Number.isFinite).sort((a, b) => b - a);
 return p.length >= 2 ? p[0] - p[1] : null;
}

// Every tower a playbook names (the runner checks their free spots each layout).
export const playbookTowers = pb => [...new Set([...(heroTower(pb) ? [pb.hero.tower] : []),
 ...pb.phases.flatMap(p => p.build.map(b => b.tower)), ...pb.branches.flatMap(b => (b.override.build ?? []).map(x => x.tower))])];

