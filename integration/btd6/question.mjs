// The Jev request for one BTD6 decision: a single Choice question over the candidate IDs, with the
// match, towers, threats ahead and (with the strategist) the current plan as named state fields.
// See .agents/skills/typesafe-ai/SKILL.md and https://docs.typesafe.ai/primitives/choice.
import {upcomingThreats} from './rounds.mjs';
import {nextStep, activeReserve, stepContext} from './plan.mjs';

export const JEV_POLICY = 'btd6-jev-v0';

const INSTRUCTIONS = 'Choose the next action in this Bloons TD 6 match. Only the chosen action is taken; then the game is observed again and you may be asked again. The game keeps running while you decide. "wait" keeps the cash for a later purchase. Compare the options by cost, the cash left after them, how much of the track a spot covers, the towers already placed and the threats in threats_ahead. Lives lost are not regained.';
const PLAN_NOTE = ' strategist_plan is the current plan from a slower strategist. The options already exclude purchases it does not allow; among the rest, follow its priorities.';

const describeStep = s => s.action === 'place'
 ? `place ${s.tower}${s.spot ? ` at ${s.spot}` : ''} from round ${s.round_from}`
 : `upgrade ${s.target} path ${s.path} to tier ${s.tier} from round ${s.round_from}`;

function criterion(c) {
 const d = c.details ?? {};
 if (d.kind === 'wait') return {action: 'Wait', effect: `keep $${d.cash} and decide again shortly`};
 if (d.kind === 'start_round') return {action: c.label, effect: 'bloons start coming and pops earn cash again'};
 if (d.kind === 'place') return {action: c.label, cost: d.cost, cash_after: d.cash_after, range: d.range, track: d.track};
 if (d.kind === 'upgrade') return {action: c.label, cost: d.cost, cash_after: d.cash_after, upgrade: d.upgrade};
 return {action: c.label};
}

// context: {stepTowers, leaks}
export function jevQuestion(state, candidates, plan, context = {}) {
 const now = state.round.number, m = state.match;
 const next = plan ? nextStep(plan, state, stepContext(plan, context)) : null;
 return {
  state: {
   game: 'Bloons TD 6',
   match: {map: m.map, difficulty: m.difficulty, mode: m.mode_name ?? m.mode, round: now, final_round: m.end_round, round_in_progress: Boolean(state.round.active),
    lives: state.lives, starting_lives: state.starting_lives, cash: Math.floor(state.cash)},
   towers: state.towers.map(t => ({id: t.id, tower: t.base_id, upgrades: t.tiers.join('-'), x: Math.round(t.x), y: Math.round(t.y)})),
   threats_ahead: upcomingThreats(now - 1, {within: 8, start: m.start_round ?? 1, end: m.end_round ?? 100}).map(t => `round ${t.round}: ${t.label}`),
   ...(context.leaks?.length ? {recent_leaks: context.leaks.slice(-3)} : {}),
   ...(plan ? {strategist_plan: {summary: plan.summary, priorities: plan.priorities,
    next_step: next ? describeStep(next.step) : 'none; the build order is complete', cash_reserve: activeReserve(plan, now)}} : {}),
  },
  questions: {move: {type: 'choice', instructions: INSTRUCTIONS + (plan ? PLAN_NOTE : ''),
   criteria: Object.fromEntries(candidates.map(c => [c.id, criterion(c)]))}},
 };
}
