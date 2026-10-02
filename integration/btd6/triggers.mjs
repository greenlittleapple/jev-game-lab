// When to ask the strategist. BTD6 doesn't wait for the answer (except before the first round),
// so threat triggers fire `lead` rounds ahead: the rounds a typical answer takes, plus one to act on it.
import {upcomingThreats} from './rounds.mjs';
import {livesPercent} from './state.mjs';
import {nextStep, stepBlocked, stepContext} from './plan.mjs';

// A newer trigger replaces an outstanding request only when its priority is higher.
export const PRIORITY = {match_start: 4, leak: 3, low_lives: 3, off_plan: 2, threat_ahead: 2, plan_done: 1, review: 1};

// Rounds that pass while the strategist answers, from the slowest of the last five answers (or a
// default) and the observed seconds per round, plus one round to carry out the answer.
export function leadRounds({latencies = [], defaultLatencyMs = 90000, secondsPerRound = null, fallbackSecondsPerRound = 30} = {}) {
 const slowest = latencies.length ? Math.max(...latencies.slice(-5)) : defaultLatencyMs;
 const perRound = secondsPerRound > 0 ? secondsPerRound : fallbackSecondsPerRound;
 return Math.max(1, Math.ceil(slowest / 1000 / perRound)) + 1;
}

// context: {lead, catalog, freeSpots, stepTowers, livesAtRoundStart}
export function strategyTrigger(state, plan, status, context = {}) {
 if (!state.in_game || state.match.result) return null;
 const match = state.match.id, round = state.round.number, lead = context.lead ?? 2;
 const make = (reason, key, extra = {}) => ({reason, key: `${match}:${key}`, priority: PRIORITY[reason], ...extra});
 const asked = key => Boolean(status.asked?.[`${match}:${key}`]);
 // Before the first round the game waits for input, so the opening plan is waited for too.
 if (!plan || plan.match_id !== match) return make('match_start', 'match_start', {blocking: Boolean(state.round.before_first_wave)});
 const lost = context.livesAtRoundStart != null ? context.livesAtRoundStart - state.lives : 0;
 if (lost > 0 && !asked(`leak:${round}`)) return make('leak', `leak:${round}`, {detail: {round, lives_lost: lost}});
 const pct = livesPercent(state), floor = plan.replan_below_lives_percent;
 if (floor > 0 && pct < floor && (plan.lives_percent_at ?? 100) >= floor) return make('low_lives', `low_lives:${plan.request_id}`);
 const uncovered = upcomingThreats(round - 1, {within: lead + 1, start: state.match.start_round ?? 1, end: state.match.end_round ?? 100, consultOnly: true})
  .find(t => !plan.threats.some(p => p.threat === t.id) && !asked(`threat:${t.id}`));
 if (uncovered) return make('threat_ahead', `threat:${uncovered.id}`, {threat: uncovered});
 const steps = {...stepContext(plan, context), lead};
 const next = nextStep(plan, state, steps);
 const problem = next?.due && stepBlocked(next.step, plan, state, {...steps, catalog: context.catalog ?? [], freeSpots: context.freeSpots ?? [], freeSpotsFor: context.freeSpotsFor});
 if (problem) return make('off_plan', `off_plan:${plan.request_id}:${next.step.step}`, {detail: {step: next.step.step, problem}});
 if (!next) return asked(`plan_done:${plan.request_id}`) ? null : make('plan_done', `plan_done:${plan.request_id}`);
 if (round >= plan.review_round) return make('review', `review:${plan.request_id}`);
 return null;
}
