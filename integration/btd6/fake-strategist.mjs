// A scripted strategist for --dry-run and the tests: no Claude session. It wraps the file channel the runner
// uses, and each time the runner reads the channel it answers the pending request from its script, with the
// same checks as the answer CLI (the schema, then checkAnswerV1). So it is driven by the runner's own reads
// and the simulated game's rounds, not by wall time.
// script: [{plan(request) -> plan, afterRounds?: n}], used in order, one entry per answer attempt:
//  - afterRounds: wait until the game's round is n rounds past the request's round (a late answer);
//  - a plan that fails the checks is recorded as rejected and the next entry answers the same request, as an
//    answering session would after the CLI refused its plan.
// fallback(request) -> plan answers once the script is used up (null: leave later requests unanswered).
import {validatePlan} from '../../core/plan-schema.mjs';
import {PLAN_SCHEMA_V1, checkAnswerV1} from './plan-v1.mjs';

export function scriptedStrategist(channel, {script = [], fallback = null, round = () => null} = {}) {
 const queue = [...script], record = [];
 let busy = null;
 const step = async () => {
  const request = await channel.pending();
  if (!request) return;
  const entry = queue[0] ?? (fallback ? {plan: fallback} : null);
  if (!entry) return;
  if (entry.afterRounds != null && !((round() ?? 0) >= request.stamp.round + entry.afterRounds)) return;
  if (queue.length) queue.shift();
  const plan = entry.plan(request);
  const errors = validatePlan(plan, request.schema ?? PLAN_SCHEMA_V1);
  if (!errors.length) errors.push(...checkAnswerV1(plan, request));
  if (errors.length) { record.push({request_id: request.id, reason: request.reason, outcome: 'rejected', errors}); return; }
  await channel.answer(request.id, plan);
  record.push({request_id: request.id, reason: request.reason, outcome: 'delivered', round: round()});
 };
 // One step at a time: the runner may read the channel from overlapping calls.
 const advance = async () => { busy ??= step().finally(() => { busy = null; }); await busy; };
 return {
  ...channel, record,
  current: async () => { await advance(); return channel.current(); },
  pendingAnswer: async () => { await advance(); return channel.pendingAnswer(); },
 };
}

// A plan that fits any request: the first two affordable towers in a fixed preference, a camo and a lead
// answer, and a MOAB answer by round 38. Valid against the request's catalog and heroes.
export function simplePlan(request, {review = 10} = {}) {
 const {stamp} = request, have = id => stamp.catalog.includes(id);
 const pick = list => list.find(have) ?? stamp.catalog[0];
 const main = pick(['DartMonkey', 'BoomerangMonkey', 'TackShooter']), lead = pick(['BombShooter', 'WizardMonkey']);
 const from = stamp.round, by = (n, min = 0) => Math.max(from, n, min);
 const build = [
  {id: 'main', tower: main, tiers: '0-2-2', count: 2, round_from: from, round_by: by(12), priority: 1},
  {id: 'lead', tower: lead, tiers: '0-2-0', round_from: by(15), round_by: by(26), priority: 2},
  {id: 'moab', tower: lead, tiers: '0-2-3', round_from: by(28), round_by: by(38), priority: 1},
 ];
 return {
  summary: `${main} early, ${lead} for lead and MOAB damage.`,
  hero: {tower: stamp.heroes?.[0] ?? 'none', round_from: from},
  build,
  cash_hold: [{from_round: by(30), to_round: by(36), amount: 800, for: ['moab']}],
  threats: [{threat: 'camo', by_round: 24, answer: 'main'}, {threat: 'lead', by_round: 28, answer: 'lead'}, {threat: 'moab', by_round: 38, answer: 'moab'}],
  review_round: from + review, note: '',
 };
}
