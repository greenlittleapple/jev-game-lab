// Deterministic rules between the strategist's plan and Jev. Each rule removes options and keeps at
// least one; a single remaining option is taken without a Jev call. See docs/ARCHITECTURE.md, "Rules".
import {nextStep, stepCandidates, stepBlocked, activeReserve, stepContext} from './plan.mjs';

// Lives lost within the current round that lift the plan's spending holds, so Jev can respond
// before the strategist's answer arrives: at least 5% of the starting lives (and at least 1).
export function emergency(state, {livesAtRoundStart = null} = {}) {
 if (livesAtRoundStart == null) return false;
 const lost = livesAtRoundStart - state.lives;
 return lost > 0 && lost >= Math.max(1, Math.ceil(0.05 * state.starting_lives));
}

const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';

// context: {lead, catalog, freeSpots, stepTowers, livesAtRoundStart}
export function constrain(state, candidates, plan, context = {}) {
 let kept = candidates;
 const rules = [];
 const apply = (kind, next, extra = {}) => {
  if (next.length && next.length < kept.length) { rules.push({kind, removed: kept.length - next.length, ...extra}); kept = next; }
 };
 const done = () => ({candidates: kept, constraint: rules.length ? {kind: 'plan', rules, removed: candidates.length - kept.length} : null});
 if (emergency(state, context)) {
  rules.push({kind: 'emergency', removed: 0, lives_lost: context.livesAtRoundStart - state.lives});
  return done();
 }
 const steps = {...stepContext(plan, context), lead: context.lead ?? 2};
 const next = nextStep(plan, state, steps);
 if (next?.due && !stepBlocked(next.step, plan, state, {...steps, catalog: context.catalog ?? [], freeSpots: context.freeSpots ?? [], freeSpotsFor: context.freeSpotsFor})) {
  const planned = stepCandidates(next.step, kept, plan, state, steps);
  // The planned step is the only purchase now; with several spots offered, Jev picks the spot.
  if (planned.length) { apply('planned_step', planned, {step: next.step.step, urgent: next.urgent}); return done(); }
  // Not affordable yet: other spending waits for it.
  apply('save_for_step', kept.filter(c => !spends(c)), {step: next.step.step});
 }
 const reserve = activeReserve(plan, state.round.number);
 if (reserve > 0) apply('cash_reserve', kept.filter(c => !spends(c) || c.details.cash_after >= reserve), {reserve});
 const allowed = new Set(plan.allowed_towers);
 apply('allowed_towers', kept.filter(c => !spends(c) || allowed.has(c.details.tower)));
 return done();
}
