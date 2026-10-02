// Policy btd6-claude-v1: the strategist's plan on top of btd6-jev-v4 (docs/BTD6-STRATEGIST.md,
// docs/ARCHITECTURE.md "Policy btd6-claude-v1"). This file has the plan schema, the instructions sent with
// each request, target tracking, the brief, the request stamp, adoption and the answer checks.
// Enforcement is rules-v1.mjs; triggers are triggers-v1.mjs.
import {THREAT_IDS, upcomingThreats} from './rounds.mjs';
import {livesPercent} from './state.mjs';
import {describeCoverage} from './spots.mjs';
import {towerEstimate} from './estimate.mjs';
import {moabCheck, moabDps} from './moab.mjs';
import TOWER_DATA from './data/towers.json' with {type: 'json'};

export const CLAUDE_POLICY_V1 = 'btd6-claude-v1';
// The policy's code revision, recorded in run_start (policy_revision) and in each decision's plan record: 22: moab_short's DDT binding and saving keep camo_capacity and lead_capacity answers within 0.8 of their kind's best gain per dollar, after the Lead, camo and camo Lead answers, and the DDT saving targets only the cheapest purchase that adds a quarter of the short round's gap (policy-v4.mjs moabCapacity, ddtGapShare; game.mjs gives the earlier floor with moabCapacity: false, ddtGapShare: 0). In series 1j (btd6-jev-v6 revision 18) camo_capacity was deferred to moab_short up to 27 times a match, three of the five losses leaked camo regrowing Ceramics first, and four matches saved for a $16,200 Dart 5-0-2 credited with about 3 damage per second; 21: lead_capacity is due below a Lead margin of 1.0 again, as before revision 20 (threat.mjs LEAD_CAPACITY_AT; in CHIMPS v6 revision 17's first match lead_capacity stayed off at a round-28 Lead margin of 0.62, Jev bought Dart Monkeys and the match was lost at round 28 to Leads; every revision 12 to 14 match passed round 28) (threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R17} gives revision 20); 20: with one life moab_short binds only while the short round's ratio is below 0.5 (policy-v4.mjs MOAB_BIND_RATIO; from 0.5 to 1 it removes "Wait" and "Start round" and orders the MOAB adders, as v4 does); it looks 10 rounds ahead for rounds with DDTs (moab.mjs MOAB_DDT_LEAD_ROUNDS, set by the session; the graded speed keeps 4) and, with one life, below 0.5 and with no affordable DDT-capable purchase, saves for the cheapest one, keeping only the pass options (moabSaving); lead_capacity is due below a Lead margin of 0.5 instead of 1.0 (threat.mjs LEAD_CAPACITY_AT) (moabBindBelow: Infinity, moabSaving: false, threatOptions.leadAt: LEAD_CAPACITY_AT_R12 and setMoabDdtLead(MOAB_LEAD_ROUNDS) give revision 19); 19: with one life moab_short binds: while a short MOAB-class round within its lead has an affordable purchase that adds MOAB damage for it (the per-round gain, so a DDT round counts only DDT-capable damage), only threat_short's Lead, camo and camo Lead answers, first, and the MOAB adders within 0.8 of the best MOAB gain per dollar stay; with 12 or more towers affordable upgrade answers come first and placements pass only when none (policy-v4.mjs moabBinding, policy-v6.mjs capBinding; moabBinding: false gives revision 18); 18: lead_capacity's Lead RBE counts only Lead bloons that aren't MOAB-class (Lead and its camo, fortified and regrow variants), leaving DDTs, including those inside a BAD, to the DDT-capable MOAB figure (estimate.mjs leadRbe, threat.mjs; threatOptions.leadDdt: true gives revision 17); 17: with one life and 12 or more towers, a burst binding with no affordable answer the tower cap allows steps aside for that decision instead of passing its placement answers: threat_short only orders the options and the cap removes placements as usual, so upgrades or waiting; camo capacity, Lead capacity and early_short keep the placement pass (policy-v6.mjs applyTowerCap burstStandAside; burstStandAside: false gives revision 16); 16: DDT-capable MOAB damage (moab.mjs setDdtCheck, hitsDdt): in moabCheck a DDT, and the DDTs inside a BAD, count only the MOAB damage of towers with an attack that sees camo and pops Lead and Black (data/towers-ddt.json), and the check takes the toughest need for each bloon's own figure, so moab_short, moab_outrun, graded speed and the MOAB gains that order answers use the DDT figure in a DDT round (setDdtCheck(false) gives revision 15); 15: a Lead capacity kind in threat_short (threat.mjs THREAT_KINDS_V4, lead_capacity): a round within 3 rounds with Lead bloons whose Lead margin (estimate.mjs leadCheck) is below 1.0 puts the purchases that raise it first, by Lead-margin gain per dollar, binding with one life as camo capacity does, and with one life saving for the cheapest answer while none is affordable, as the Lead check does, and set aside as camo capacity is while moab_short fires; 14: with one life and 12 or more towers, a camo capacity, burst or early_short binding chooses among the answers the tower cap allows (affordable upgrades and on-plan placements, within 0.8 of the best of those), and its placement answers pass the cap when there are none (policy-v6.mjs applyTowerCap bindUnderCap); 13: with one life the tower cap's exception passes only placements that add a missing Lead, camo or camo Lead; camo capacity, burst and early_short answers must be upgrades while 12 or more towers are placed (policy-v6.mjs applyTowerCap, ONE_LIFE_PASS); 12: threat_short binds with one life: while a gap has an affordable answer, only that gap's answers stay (Lead, camo and camo Lead: all of them; camo capacity and burst: within 0.8 of the best gain per dollar; threat.mjs bindAnswers, THREAT_KEEP); 
// 11: early_short
// binds: only answers within 0.8 of the best gain per dollar (and Lead, camo and camo Lead answers) stay, and unmeasured types are not answers (early.mjs EARLY_KEEP); 10 adds early_short to the floor
// (early.mjs; a survival rule, rules-v1.mjs SURVIVAL_RULES): with one life, a short round up to 10 puts the purchases with the
// highest corrected capacity gain per dollar (data/early-ratios.json) first; 9 sets the one-life
// margin for rounds up to 10 at 3.0 times RBE (estimate.mjs EARLY_ONE_LIFE_MARGIN); 8 adds camo capacity to
// threat_short (threat.mjs THREAT_KINDS_V3, camo_capacity); 7: the tower table (data/towers.json 922e6b5e918c: on-damage projectiles such as the Sniper's shrapnel counted, the Skywarden at one weapon of its stance-swapped pair, the Bomb Shooter's ring clusters at half) changes every estimate behind its decisions,
// and threat_short takes its burst adders by burst-ratio gain per dollar (threat.mjs THREAT_BURST_AHEAD; the same order
// as 6's pops per dollar in effect); 6 adds camo Lead and burst
// to threat_short (threat.mjs THREAT_KINDS_V2) and counts the Monkey Ace at its measured share (towers.mjs GLOBAL_SHARE);
// 5 runs the floor with
// threat_short (threat.mjs; a survival rule, rules-v1.mjs SURVIVAL_RULES); 4 adds
// btd6-jev-v6's tower cap after the plan filters, also under survival_first, with on-plan placements exempt
// (rules-v1.mjs towerCap); 3 lets
// majority wait replace "Wait" only with an on-plan purchase, one that advances a target due now (game.mjs
// planMajorityWait); 2 lets
// holds whose targets are complete lapse (activeHolds, from bridge 0.3.12's commit) and replaces "Wait" with the most
// probable purchase when more than half of Jev's probability is on purchases (game.mjs MAJORITY_WAIT); 1 (unrecorded) is the version of the first match.
export const CLAUDE_V1_REVISION = 22;
const short = n => ({type: 'string', maxLength: n});
const round = {type: 'integer', minimum: 1, maximum: 200};
const itemId = {type: 'string', pattern: '^[a-z][a-z0-9_]{0,15}$'};
export const TIERS_PATTERN = '^[0-5]-[0-5]-[0-5]$';

export const PLAN_SCHEMA_V1 = {
 type: 'object', additionalProperties: false,
 required: ['summary', 'hero', 'build', 'cash_hold', 'threats', 'note'],
 properties: {
  summary: short(200),
  hero: {type: 'object', additionalProperties: false, required: ['tower', 'round_from'], properties: {tower: short(40), round_from: round}},
  build: {type: 'array', maxItems: 24, items: {type: 'object', additionalProperties: false,
   required: ['id', 'tower', 'tiers', 'round_from', 'round_by', 'priority'],
   properties: {
    id: itemId, tower: short(40), tiers: {type: 'string', pattern: TIERS_PATTERN}, count: {type: 'integer', minimum: 1, maximum: 6},
    spot: {type: 'string', pattern: '^S\\d{2}$'}, round_from: round, round_by: round, priority: {type: 'integer', minimum: 1, maximum: 3}, note: short(80)}}},
  cash_hold: {type: 'array', maxItems: 6, items: {type: 'object', additionalProperties: false, required: ['from_round', 'to_round', 'amount', 'for'],
   properties: {from_round: round, to_round: round, amount: {type: 'integer', minimum: 0, maximum: 1000000}, for: {type: 'array', maxItems: 6, items: itemId}}}},
  threats: {type: 'array', maxItems: 12, items: {type: 'object', additionalProperties: false, required: ['threat', 'by_round', 'answer'],
   properties: {threat: {type: 'string', enum: THREAT_IDS}, by_round: round, answer: itemId}}},
  review_round: round,
  note: short(160),
 },
};

export const STRATEGIST_INSTRUCTIONS_V1 = `You plan for an automated Bloons TD 6 player. Jev, a fast model, takes each action; code enforces your plan between answers. The game keeps running while you answer (only the opening request before the first round is waited for, up to a timeout). Your plan is adopted at the next decision after you answer. Plan from brief.timing.plan_from_round; brief.timing.lead_rounds is how many rounds a typical answer takes.

Use only the brief: towers from brief.catalog, heroes from brief.heroes, spots from brief.spots, tower facts from brief.tower_facts. Keep strings short and plain.

Fields:
- summary: one sentence on how this setup reaches brief.match.end_round.
- hero: {tower, round_from}. tower is a hero from brief.heroes, or "none" to never place one.
- build: targets, in order. {id, tower, tiers "a-b-c" (path 1, 2, 3 tiers; at most two paths above 0 and one above 2), count (default 1), spot (optional), round_from, round_by, priority 1-3 (1 highest)}. A target is met when count towers of that type have at least those tiers. From round_from, while a purchase that advances an unmet target is affordable, other purchases are removed, and only the best priority among the affordable ones is kept. Towers already placed count toward targets. Keep met targets in the list.
- cash_hold: [{from_round, to_round, amount, for: [target ids]}]. In those rounds, purchases that would leave less than amount are removed unless they advance a target in for. Use it to save for an expensive target; without it, Jev spends freely on other things while the next target is unaffordable.
- threats: [{threat, by_round, answer: target id}] for the threats in brief.threats_ahead: which target handles camo, lead, MOAB-class bloons and so on. Within brief.timing.lead_rounds of by_round, that target goes first. Set by_round at least 2 rounds before the threat's round in brief.threats_ahead, never later. Answer each threat with one target whose tiers have that property in brief.tower_facts, with a cash_hold if it isn't affordable yet.
- review_round (optional): when to be asked again; default 10 rounds after this request.
- note: one sentence for the operator, or "".

Survival first: while bloons are leaking, the towers' MOAB damage is short of a MOAB-class round due within 4 rounds (brief.moab), or no tower handles the Lead or camo of a round due within 3 rounds, code lifts your filters and holds and lets Jev defend. You are asked again after a large leak.`;

// ---- Targets ----
export const parseTiers = s => String(s).split('-').map(Number);
export const crosspathOk = tiers => tiers.length === 3 && tiers.every(t => Number.isInteger(t) && t >= 0 && t <= 5)
 && tiers.filter(t => t > 0).length <= 2 && tiers.filter(t => t > 2).length <= 1;
const meets = (tower, target) => target.every((t, i) => tower.tiers[i] >= t);
const reaches = (tower, target) => crosspathOk(tower.tiers.map((t, i) => Math.max(t, target[i])));
const progress = (tower, target) => target.reduce((n, t, i) => n + Math.min(t, tower.tiers[i]), 0);
const isHeroTower = t => Boolean(t.is_hero) || t.base_id === 'Quincy';

// The plan's targets with the towers counted toward each, in plan order: [{item, target, need, towers, met, done}].
// Each tower counts toward one target: the first target it can still reach, preferring towers that already meet it.
// The hero is a target with id "hero" (priority 1), unless plan.hero.tower is "none".
export function planTargets(plan, state) {
 const claimed = new Set(), out = [];
 const hero = plan.hero?.tower && plan.hero.tower !== 'none'
  ? [{id: 'hero', tower: plan.hero.tower, tiers: '0-0-0', count: 1, round_from: plan.hero.round_from, round_by: plan.hero.round_from, priority: 1, hero: true}] : [];
 for (const item of [...hero, ...plan.build]) {
  const target = parseTiers(item.tiers), need = item.count ?? 1;
  const pool = state.towers.filter(t => !claimed.has(t.id) && (item.hero ? isHeroTower(t) : !isHeroTower(t) && t.base_id === item.tower && reaches(t, target)))
   .sort((a, b) => (meets(b, target) - meets(a, target)) || progress(b, target) - progress(a, target) || a.id - b.id).slice(0, need);
  pool.forEach(t => claimed.add(t.id));
  const met = pool.filter(t => meets(t, target)).length;
  out.push({item, target, need, towers: pool, met, done: met >= need});
 }
 return out;
}

// Targets that are due now: round_from has come, or a threat they answer is within `lead` rounds.
// Each gets its effective priority (0 for a threat answer within the lead time). anyRound: every unmet
// target, whatever its round_from. only: target IDs to keep (all when null).
export function dueTargets(plan, state, {lead = 2, anyRound = false, only = null} = {}) {
 const now = state.round.number;
 const urgent = new Set(plan.threats.filter(t => t.by_round >= now && t.by_round - now <= lead).map(t => t.answer));
 return planTargets(plan, state).filter(t => !t.done && (!only || only.includes(t.item.id)) && (anyRound || urgent.has(t.item.id) || t.item.round_from <= now))
  .map(t => ({...t, priority: urgent.has(t.item.id) ? 0 : t.item.priority}));
}

// The purchases among the candidates that advance a due target: Map candidate ID -> {target, priority}
// (the best priority when a purchase advances several).
export function onPlanPurchases(plan, state, candidates, context = {}) {
 const out = new Map();
 const add = (c, t) => { const had = out.get(c.id); if (!had || t.priority < had.priority) out.set(c.id, {target: t.item.id, priority: t.priority}); };
 for (const t of dueTargets(plan, state, context)) for (const c of candidates) {
  const d = c.details ?? {};
  if (d.kind === 'place' && t.towers.length < t.need && (t.item.hero ? isHeroCandidate(c, context.catalog) : d.tower === t.item.tower && !isHeroCandidate(c, context.catalog))
   && (!t.item.spot || d.spot === t.item.spot)) add(c, t);
  if (d.kind === 'upgrade' && !t.item.hero) {
   const tower = t.towers.find(x => x.id === d.tower_id);
   if (tower && !meets(tower, t.target) && t.target[d.path - 1] > tower.tiers[d.path - 1]) add(c, t);
  }
 }
 return out;
}
// Targets whose round_by has just passed (in the last TARGET_WINDOW rounds before the current one), each once
// per ID and round_by (reported, a Set of keys, is updated): {id, tower, tiers, count, round_by, met, done}.
// The runner logs them as plan_target records for the adherence measure (progress.mjs planAdherence).
export const TARGET_WINDOW = 2;
export function passedTargets(plan, state, reported = new Set()) {
 const now = state.round.number, out = [];
 for (const t of planTargets(plan, state)) {
  const key = `${t.item.id}@${t.item.round_by}`;
  if (t.item.round_by >= now || t.item.round_by < now - TARGET_WINDOW || reported.has(key)) continue;
  reported.add(key);
  out.push({id: t.item.id, tower: t.item.tower, tiers: t.item.tiers, count: t.need, round_by: t.item.round_by, met: t.met, done: t.done});
 }
 return out;
}

export const isHeroCandidate = (c, catalog = []) => c.details?.tower === 'Quincy' || catalog.some(t => t.id === c.details?.tower && t.is_hero);

// The holds in force for the round. With the state, a hold whose `for` targets are all complete no longer
// applies: in the first two graded btd6-playbook-v5 runs the bfb hold ($3,500 for the Bomb Shooter, rounds 44
// to 50) kept cash back after the Bomb Shooter had reached its tiers in round 43.
export function activeHolds(plan, roundNumber, state = null) {
 const done = state?.in_game ? new Set(planTargets(plan, state).filter(t => t.done).map(t => t.item.id)) : new Set();
 return plan.cash_hold.filter(h => h.from_round <= roundNumber && roundNumber <= h.to_round && !(h.for?.length && h.for.every(id => done.has(id))));
}
export function activeHold(plan, roundNumber, state = null) {
 const holds = activeHolds(plan, roundNumber, state);
 if (!holds.length) return null;
 return {amount: Math.max(...holds.map(h => h.amount)), for: [...new Set(holds.flatMap(h => h.for))]};
}

// ---- Facts for the brief ----
// Per base tower in towers.json: the lowest tiers that detect camo and pop lead, and the best MOAB damage per
// second up to tier 4 (against one MOAB, the whole track in range).
const minimal = list => list.filter(a => !list.some(b => b !== a && b.every((v, i) => v <= a[i]))).map(t => t.join('-'));
export function towerFacts(id) {
 const table = TOWER_DATA.towers[id];
 if (!table || id === 'Quincy') return null;
 const rows = Object.entries(table).map(([k, r]) => ({tiers: k.split('').map(Number), lead: r[1] === 1, camo: r[2] === 1, moab: r[4] ?? 0}));
 const moab = rows.filter(r => Math.max(...r.tiers) <= 4 && r.moab > 0).sort((a, b) => b.moab - a.moab).slice(0, 3).map(r => `${r.tiers.join('-')}: ${r.moab}`);
 return {camo: minimal(rows.filter(r => r.camo).map(r => r.tiers)).slice(0, 3), lead: minimal(rows.filter(r => r.lead).map(r => r.tiers)).slice(0, 3), moab_dps: moab};
}

// MOAB-class rounds grouped into windows: a new window starts after a gap of more than 2 rounds or 10
// rounds after the window's first round. [{from, to}]
export function moabWindows(start = 1, end = 100) {
 const out = [];
 for (let r = start; r <= end; r++) {
  if (!moabCheck([], r)) continue;
  const w = out.at(-1);
  if (w && r - w.to <= 2 && r - w.from < 10) w.to = r; else out.push({from: r, to: r});
 }
 return out;
}

// What Jev's question adds: the plan's summary, up to three due targets and the active hold.
export function planFact(plan, state, context = {}) {
 if (!plan) return null;
 const due = dueTargets(plan, state, context).sort((a, b) => a.priority - b.priority).slice(0, 3);
 const hold = activeHold(plan, state.round.number, state);
 return {summary: plan.summary, next: due.map(t => `${t.item.tower} ${t.item.tiers}${t.need > 1 ? ` x${t.need}` : ''} by round ${t.item.round_by}`),
  ...(hold ? {hold_cash: hold.amount} : {})};
}

// ---- Strategist request ----
// context: {lead, secondsPerRound, catalog, freeSpots, leaks, paths, ruleset}
export function strategistBriefV1(state, trigger, plan, context = {}, status = null) {
 const {lead = 2, secondsPerRound = null, catalog = [], freeSpots = [], leaks = [], paths = [], ruleset = null} = context;
 const now = state.round.number, end = state.match.end_round ?? 100;
 const available = catalog.filter(t => t.unlocked !== false);
 const upcoming = moabWindows(state.match.start_round ?? 1, end).filter(w => w.to >= now).slice(0, 3).map(w => {
  const c = moabCheck(state.towers, w.from, {lives: state.lives, paths});
  return {rounds: w.from === w.to ? `${w.from}` : `${w.from}-${w.to}`, first: c.bloons, health: c.hp, needs_dps: c.needs_dps};
 });
 return {
  trigger: trigger.reason, ...(trigger.detail ? {detail: trigger.detail} : {}),
  match: {map: state.match.map, difficulty: state.match.difficulty, mode: state.match.mode_name ?? state.match.mode, round: now, end_round: end,
   round_active: Boolean(state.round.active), lives: state.lives, starting_lives: state.starting_lives, cash: Math.floor(state.cash)},
  timing: {lead_rounds: lead, seconds_per_round: secondsPerRound, plan_from_round: state.round.active ? now + lead : now},
  ...(ruleset ? {ruleset: ruleset.summary} : {}),
  heroes: available.filter(t => t.is_hero).map(t => ({tower: t.id, cost: t.cost})),
  catalog: available.filter(t => !t.is_hero).map(t => ({tower: t.id, cost: t.cost})),
  tower_facts: Object.fromEntries(available.filter(t => !t.is_hero).map(t => [t.id, towerFacts(t.id)]).filter(([, f]) => f)),
  towers: state.towers.map(t => {
   const e = towerEstimate(t);
   return {id: t.id, tower: t.base_id, tiers: t.tiers.join('-'), ...(e ? {camo: e.camo, lead: e.lead, moab_dps: e.moab} : {}),
    next: (t.next_upgrades ?? []).map(u => `p${u.path + 1} $${u.cost}`).join(', ')};
  }),
  spots: freeSpots.slice(0, 8).map(s => ({id: s.id, track: describeCoverage(s)})),
  threats_ahead: upcomingThreats(now - 1, {within: 20, start: state.match.start_round ?? 1, end}).map(t => ({threat: t.id, round: t.round})),
  moab: {dps_now: moabDps(state.towers, paths), windows: upcoming},
  leaks: leaks.slice(-5),
  ...(plan ? {previous_plan: {summary: plan.summary, hero: plan.hero, cash_hold: plan.cash_hold, threats: plan.threats,
   build: planTargets(plan, state).filter(t => !t.item.hero).map(t => ({id: t.item.id, tower: t.item.tower, tiers: t.item.tiers, count: t.need,
    round_from: t.item.round_from, round_by: t.item.round_by, priority: t.item.priority, have: t.towers.map(x => x.tiers.join('-')), done: t.done}))}} : {}),
  ...(status ? {consults: {requests: status.requests, answers: status.answers, late: status.late}} : {}),
 };
}

export function requestStampV1(state, trigger, context = {}) {
 const {lead = 2, catalog = [], freeSpots = []} = context;
 const available = catalog.filter(t => t.unlocked !== false);
 return {match_id: state.match.id, round: state.round.number, lives: state.lives, lives_percent: livesPercent(state),
  cash: Math.floor(state.cash), needed_by_round: state.round.number + (state.round.active ? lead : 0), key: trigger.key,
  tower_ids: state.towers.map(t => t.id), catalog: available.filter(t => !t.is_hero).map(t => t.id), heroes: available.filter(t => t.is_hero).map(t => t.id),
  spot_positions: Object.fromEntries(freeSpots.slice(0, 8).map(s => [s.id, {x: s.x, y: s.y}]))};
}

export function adoptPlanV1(plan, request, meta = {}) {
 const {stamp} = request;
 return {...plan, ...meta, reason: request.reason, match_id: stamp.match_id, round_at: stamp.round, lives_at: stamp.lives,
  needed_by_round: stamp.needed_by_round, spot_positions: stamp.spot_positions};
}

// Checks against the request's own facts, run by the answer CLI after the schema check.
export function checkAnswerV1(plan, request) {
 const {stamp} = request, errors = [];
 const ids = new Set();
 plan.build.forEach((b, n) => {
  const at = `plan.build[${n}]`;
  if (b.id === 'hero') errors.push(`${at}.id "hero" is reserved for the hero`);
  if (ids.has(b.id)) errors.push(`${at}.id ${b.id} is used twice`);
  ids.add(b.id);
  if (!stamp.catalog.includes(b.tower)) errors.push(`${at}.tower ${b.tower} is not in brief.catalog${stamp.heroes?.includes(b.tower) ? ' (heroes go in plan.hero)' : ''}`);
  if (!crosspathOk(parseTiers(b.tiers))) errors.push(`${at}.tiers ${b.tiers} breaks the crosspath rule (at most two paths above 0, one above 2)`);
  if (b.round_by < b.round_from) errors.push(`${at}.round_by is before round_from`);
  if (b.spot && !Object.hasOwn(stamp.spot_positions, b.spot)) errors.push(`${at}.spot ${b.spot} is not in brief.spots`);
 });
 if (plan.hero.tower !== 'none' && !(stamp.heroes ?? []).includes(plan.hero.tower)) errors.push(`plan.hero.tower ${plan.hero.tower} is not in brief.heroes (or "none")`);
 plan.cash_hold.forEach((h, n) => {
  if (h.to_round < h.from_round) errors.push(`plan.cash_hold[${n}].to_round is before from_round`);
  for (const id of h.for) if (!ids.has(id) && id !== 'hero') errors.push(`plan.cash_hold[${n}].for ${id} is not a build id`);
 });
 plan.threats.forEach((t, n) => { if (!ids.has(t.answer) && t.answer !== 'hero') errors.push(`plan.threats[${n}].answer ${t.answer} is not a build id`); });
 if (plan.review_round != null && plan.review_round <= stamp.round) errors.push(`plan.review_round must be after the current round (${stamp.round})`);
 return errors;
}
