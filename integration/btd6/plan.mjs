// Strategist plan for BTD6: schema, instructions, brief, request stamp, adoption, and the checks
// the answer CLI runs against the request. See docs/ARCHITECTURE.md, "Plan schema".
import {THREAT_IDS, upcomingThreats} from './rounds.mjs';
import {towerLabel, livesPercent} from './state.mjs';
import {describeCoverage} from './spots.mjs';

export const STRATEGY_POLICY = 'btd6-strategist-v0';
const short = n => ({type: 'string', maxLength: n});
const round = {type: 'integer', minimum: 1, maximum: 200};
const stepId = {type: 'string', pattern: '^[a-z0-9_-]{1,24}$'};

export const PLAN_SCHEMA = {
 type: 'object', additionalProperties: false,
 required: ['summary', 'priorities', 'build_order', 'cash_reserve', 'allowed_towers', 'threats', 'replan_below_lives_percent', 'review_round', 'note'],
 properties: {
  summary: short(300),
  priorities: {type: 'array', maxItems: 5, items: short(120)},
  build_order: {type: 'array', maxItems: 40, items: {type: 'object', additionalProperties: false,
   required: ['step', 'action', 'round_from'],
   properties: {
    step: stepId, action: {type: 'string', enum: ['place', 'upgrade']}, round_from: round, round_by: round,
    tower: short(40), spot: {type: 'string', pattern: '^S\\d{2}$'}, ref: {type: 'string', pattern: '^[a-z][a-z0-9_]{0,15}$'},
    target: {type: 'string', pattern: '^([a-z][a-z0-9_]{0,15}|tower:\\d+)$'},
    path: {type: 'integer', minimum: 1, maximum: 3}, tier: {type: 'integer', minimum: 1, maximum: 5}, note: short(120)}}},
  cash_reserve: {type: 'array', maxItems: 10, items: {type: 'object', additionalProperties: false, required: ['from_round', 'to_round', 'amount'],
   properties: {from_round: round, to_round: round, amount: {type: 'integer', minimum: 0, maximum: 1000000}, reason: short(120)}}},
  allowed_towers: {type: 'array', maxItems: 30, items: short(40)},
  threats: {type: 'array', maxItems: 12, items: {type: 'object', additionalProperties: false, required: ['threat', 'round', 'handled_by'],
   properties: {threat: {type: 'string', enum: THREAT_IDS}, round, handled_by: {type: 'array', maxItems: 6, items: stepId}, note: short(120)}}},
  replan_below_lives_percent: {type: 'integer', minimum: 0, maximum: 100},
  review_round: round,
  note: short(200),
 },
};

export const STRATEGIST_INSTRUCTIONS = `You are the strategist for an automated Bloons TD 6 player. A fast model (Jev) takes each in-game action; code enforces your plan between your answers. Unlike a turn-based game, BTD6 keeps running while you answer, except before the first round, when the game waits for this plan. brief.timing says how many rounds pass during a typical answer: plan from brief.timing.plan_from_round on and leave the rounds before it to the current plan.

Use only the brief. Tower IDs come from brief.catalog, spot IDs from brief.spots, existing towers from brief.towers; brief.ruleset says what the run may use. Keep strings short and concrete.

Fields:
- summary: one sentence on how this setup reaches the final round (brief.match.end_round). The dashboard shows it as the current plan.
- priorities: at most 5, most important first.
- build_order: purchases in order. {step, action: "place", tower, spot?, ref?, round_from, round_by?} places a tower; without spot, Jev picks the spot from the offered ones. {step, action: "upgrade", target, path, tier, round_from, round_by?} upgrades target (a ref from an earlier place step, or "tower:<id>" for a tower in brief.towers) on path 1, 2 or 3 until it reaches tier. Upgrades follow the game's crosspath rule (at most two paths, only one above tier 2). Enforced: the first unfinished step whose round_from has come is bought as soon as it is affordable, and other spending waits for it. round_by is when you want it done; it is scored, not enforced. Keep steps already done in the list; code tracks them.
- cash_reserve: [{from_round, to_round, amount, reason}]. Enforced: purchases outside the build order that would leave less cash than amount are removed in those rounds.
- allowed_towers: tower IDs Jev may buy outside the build order when cash exceeds the reserve; [] keeps all spending to the build order.
- threats: [{threat, round, handled_by: [step IDs]}] for the threats in brief.threats_ahead. Enforced: when a threat is within brief.timing.lead_rounds and a handling step is unfinished, that step goes first. You are asked again before a threat that no plan entry covers.
- replan_below_lives_percent: lives percentage at which you are asked again (0 = never).
- review_round: the round at which you are asked to review the plan.
- note: one sentence for the operator, or "".

When lives drop fast within a round, code lifts the reserve and the build-order hold so Jev can respond; you are asked about the leak at the same time.`;

// ---- Build-order bookkeeping ----
const near = (t, p, d = 6) => Math.hypot(t.x - p.x, t.y - p.y) <= d;

// What step tracking needs: towers placed for each step (recorded by the runner from the bridge's
// tower_id) and the spot positions the plan's request listed.
export const stepContext = (plan, {stepTowers = {}} = {}) => ({stepTowers, spotPositions: plan?.spot_positions ?? {}});

// context: {stepTowers: {stepId: towerId}, spotPositions: {S01: {x, y}}}
export function placeStepTower(step, state, {stepTowers = {}, spotPositions = {}} = {}) {
 const id = stepTowers[step.step];
 const byId = id != null ? state.towers.find(t => t.id === id) : null;
 if (byId) return byId;
 const spot = step.spot && spotPositions[step.spot];
 return spot ? state.towers.find(t => t.base_id === step.tower && near(t, spot)) ?? null : null;
}

export function resolveTarget(target, plan, state, context = {}) {
 const id = /^tower:(\d+)$/.exec(target ?? '');
 if (id) return state.towers.find(t => t.id === Number(id[1])) ?? null;
 const place = plan.build_order.find(s => s.action === 'place' && s.ref === target);
 return place ? placeStepTower(place, state, context) : null;
}

export function stepDone(step, plan, state, context = {}) {
 if (step.action === 'place') return Boolean(placeStepTower(step, state, context));
 const tower = resolveTarget(step.target, plan, state, context);
 return Boolean(tower && tower.tiers[step.path - 1] >= step.tier);
}

// The step the plan wants next: an unfinished step handling a threat within `lead` rounds goes
// first, otherwise the first unfinished step in order. due: its round_from has come (urgent steps
// are always due).
export function nextStep(plan, state, {lead = 2, ...context} = {}) {
 const open = plan.build_order.filter(s => !stepDone(s, plan, state, context));
 if (!open.length) return null;
 const now = state.round.number;
 const urgent = plan.threats.filter(t => t.round >= now && t.round - now <= lead)
  .flatMap(t => t.handled_by).map(id => open.find(s => s.step === id)).find(Boolean);
 const step = urgent ?? open[0];
 return {step, urgent: Boolean(urgent), due: Boolean(urgent) || step.round_from <= now};
}

// Candidates that carry out a step (several when Jev picks the spot).
export function stepCandidates(step, candidates, plan, state, context = {}) {
 if (step.action === 'place')
  return candidates.filter(c => c.details?.kind === 'place' && c.details.tower === step.tower && (!step.spot || c.details.spot === step.spot));
 const tower = resolveTarget(step.target, plan, state, context);
 if (!tower || tower.tiers[step.path - 1] >= step.tier) return [];
 return candidates.filter(c => c.details?.kind === 'upgrade' && c.details.tower_id === tower.id && c.details.path === step.path);
}

// Why a step can't be carried out now or later (not just unaffordable), or null.
// context.freeSpotsFor(tower), when given, has each tower's own free spots; freeSpots is the fallback.
export function stepBlocked(step, plan, state, {catalog = [], freeSpots = [], ...context} = {}) {
 if (step.action === 'place') {
  const entry = catalog.find(t => t.id === step.tower);
  if (!entry || entry.unlocked === false) return `tower ${step.tower} is not available`;
  const free = context.freeSpotsFor?.(step.tower) ?? freeSpots;
  if (step.spot && !free.some(s => s.id === step.spot)) return `spot ${step.spot} is not free`;
  return null;
 }
 const tower = resolveTarget(step.target, plan, state, context);
 if (!tower) return `target ${step.target} does not exist yet`;
 if (tower.tiers[step.path - 1] >= step.tier) return null;
 const next = tower.next_upgrades.find(u => u.path === step.path - 1); // the bridge's paths are 0-based
 if (!next) return `path ${step.path} of ${towerLabel(tower)} can't be upgraded further`;
 if (next.unlocked === false) return `upgrade ${next.id} is locked on this account`;
 return null;
}

export function activeReserve(plan, roundNumber) {
 return Math.max(0, ...plan.cash_reserve.filter(r => r.from_round <= roundNumber && roundNumber <= r.to_round).map(r => r.amount));
}

// ---- Strategist request ----
// context: {lead, secondsPerRound, catalog, freeSpots, stepTowers, spotPositions, leaks}
export function strategistBrief(state, trigger, plan, context = {}) {
 const {lead = 2, secondsPerRound = null, catalog = [], freeSpots = [], leaks = [], ruleset = null} = context;
 const now = state.round.number;
 return {
  trigger: trigger.reason, ...(trigger.threat ? {threat: trigger.threat} : {}), ...(trigger.detail ? {detail: trigger.detail} : {}),
  match: {map: state.match.map, difficulty: state.match.difficulty, mode: state.match.mode_name ?? state.match.mode, round: now, end_round: state.match.end_round,
   round_active: Boolean(state.round.active), lives: state.lives, starting_lives: state.starting_lives, cash: Math.floor(state.cash),
   fast_forward: state.fast_forward ?? null, auto_start: state.auto_start ?? null},
  timing: {lead_rounds: lead, seconds_per_round: secondsPerRound, plan_from_round: state.round.active ? now + lead : now},
  ...(ruleset ? {ruleset: {id: `${ruleset.name}-v${ruleset.version}`, summary: ruleset.summary}} : {}),
  towers: state.towers.map(t => ({id: t.id, tower: t.base_id, tiers: t.tiers.join('-'), x: Math.round(t.x), y: Math.round(t.y)})),
  catalog: catalog.filter(t => t.unlocked !== false).map(t => ({tower: t.id, name: t.name ?? t.id, cost: t.cost, range: t.range})),
  spots: freeSpots.map(s => ({id: s.id, x: Math.round(s.x), y: Math.round(s.y), track: describeCoverage(s)})),
  threats_ahead: upcomingThreats(now - 1, {within: 20, start: state.match.start_round ?? 1, end: state.match.end_round ?? 100}),
  leaks: leaks.slice(-10),
  ...(plan ? {previous_plan: {summary: plan.summary, priorities: plan.priorities, threats: plan.threats,
   steps: plan.build_order.map(s => ({...s, done: stepDone(s, plan, state, stepContext(plan, context))}))}} : {}),
 };
}

export function requestStamp(state, trigger, context = {}) {
 const {lead = 2, catalog = [], freeSpots = []} = context;
 return {match_id: state.match.id, round: state.round.number, lives: state.lives, lives_percent: livesPercent(state),
  cash: Math.floor(state.cash), needed_by_round: state.round.number + (state.round.active ? lead : 0), key: trigger.key,
  tower_ids: state.towers.map(t => t.id), catalog: catalog.filter(t => t.unlocked !== false).map(t => t.id),
  spot_positions: Object.fromEntries(freeSpots.map(s => [s.id, {x: s.x, y: s.y}]))};
}

export function adoptPlan(plan, request, meta = {}) {
 const {stamp} = request;
 return {...plan, ...meta, reason: request.reason, match_id: stamp.match_id, round_at: stamp.round, lives_at: stamp.lives,
  lives_percent_at: stamp.lives_percent, needed_by_round: stamp.needed_by_round, spot_positions: stamp.spot_positions};
}

// Checks against the request's own facts, run by the answer CLI after the schema check.
export function checkAnswer(plan, request) {
 const {stamp} = request, errors = [];
 const steps = new Set(), refs = new Set();
 plan.build_order.forEach((s, n) => {
  const at = `plan.build_order[${n}]`;
  if (steps.has(s.step)) errors.push(`${at}.step ${s.step} is used twice`);
  steps.add(s.step);
  if (s.round_by != null && s.round_by < s.round_from) errors.push(`${at}.round_by is before round_from`);
  if (s.action === 'place') {
   if (!s.tower) errors.push(`${at}.tower is required for a place step`);
   else if (!stamp.catalog.includes(s.tower)) errors.push(`${at}.tower ${s.tower} is not in brief.catalog`);
   if (s.spot && !Object.hasOwn(stamp.spot_positions, s.spot)) errors.push(`${at}.spot ${s.spot} is not in brief.spots`);
   if (s.ref) { if (refs.has(s.ref)) errors.push(`${at}.ref ${s.ref} is used twice`); refs.add(s.ref); }
   for (const k of ['target', 'path', 'tier']) if (s[k] != null) errors.push(`${at}.${k} is only for upgrade steps`);
  } else {
   if (s.target == null || s.path == null || s.tier == null) errors.push(`${at} needs target, path and tier`);
   else if (s.target.startsWith('tower:')) { if (!stamp.tower_ids.includes(Number(s.target.slice(6)))) errors.push(`${at}.target ${s.target} is not in brief.towers`); }
   else if (!refs.has(s.target)) errors.push(`${at}.target ${s.target} is not the ref of an earlier place step`);
   for (const k of ['tower', 'spot', 'ref']) if (s[k] != null) errors.push(`${at}.${k} is only for place steps`);
  }
 });
 plan.threats.forEach((t, n) => { for (const id of t.handled_by) if (!steps.has(id)) errors.push(`plan.threats[${n}].handled_by ${id} is not a build_order step`); });
 plan.cash_reserve.forEach((r, n) => { if (r.to_round < r.from_round) errors.push(`plan.cash_reserve[${n}].to_round is before from_round`); });
 plan.allowed_towers.forEach((t, n) => { if (!stamp.catalog.includes(t)) errors.push(`plan.allowed_towers[${n}] ${t} is not in brief.catalog`); });
 if (plan.review_round <= stamp.round) errors.push(`plan.review_round must be after the current round (${stamp.round})`);
 return errors;
}
