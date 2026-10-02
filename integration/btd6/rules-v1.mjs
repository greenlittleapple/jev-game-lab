// Plan enforcement for policy btd6-claude-v1, applied after btd6-jev-v4's floor rules (core game.rules).
// Each filter removes purchases only, keeps at least one option, and is recorded with what it removed.
//  survival_first: while the floor applies leak_pressure, moab_short, threat_short or early_short (early.mjs; btd6-playbook-v5
//                  revision 11, btd6-claude-v1 revision 10), no plan filter applies.
//                  threat_short (threat.mjs) runs in the floor of btd6-playbook-v5 revision 6 and btd6-claude-v1
//                  revision 5 only: claude-v1 revision 4 lost at round 28, the first Lead round, after its plan moved
//                  the Lead answer to round 30. The tower cap below still applies, and exempts a placement that adds
//                  the missing property only when no upgrade adds it (policy-v6.mjs applyTowerCap).
//  no_hero:        the plan says hero "none": hero placements are removed
//  off_plan:       while a purchase that advances a due target is affordable, other purchases are removed
//  plan_priority:  of those, only the best priority is kept (a threat answer within the lead time first)
//  cash_hold:      purchases that would leave less than the active hold are removed, unless they advance a
//                  target the hold is for; lifted while the floor applies no_start_short (the round is short).
//                  When every option left spends below the hold because the floor removed waiting
//                  (no_wait_behind), waiting comes back if the floor's verdict for the round is not short and
//                  nothing leaked (restored: "wait"); otherwise the hold is lifted (cash_hold_lifted, with the
//                  reason). In the first claude-v1 match the holds from round 50 on were lost this way.
//  idle_cash:      (btd6-playbook-v5 only, idleCash) waiting is removed while a purchase that advances a due
//                  target is affordable and leaves at least IDLE_MARGIN above every active hold for other targets
//                  (a hold never blocks a purchase for its own target). In the first two graded v5 runs Jev
//                  chose waiting at 0.58 to 0.63 at every decision while cash rose to $9,851 and $11,550, and
//                  the next round leaked more than 50 lives.
//  tower_cap:      (towerCap; btd6-playbook-v5 revision 5, btd6-claude-v1 revision 4) btd6-jev-v6's tower cap
//                  (policy-v6.mjs applyTowerCap) on what the filters above left, also while survival_first set them
//                  aside, with v6's exception (tower_cap_exception). Placements that advance a due target needing a
//                  new tower (onPlanPurchases) are exempt, so the plan still decides how many towers it wants. In a
//                  v5 revision 4 run, leak_pressure and survival_first let Jev place 19 Bomb Shooters in rounds
//                  56-57 with $6,481 in hand; it lost at round 76 with 48 towers, 27 of them 0-0-0 Bomb Shooters.
//                  With one life (v5 revision 14, claude-v1 revision 13; oneLifeCap: false gives the earlier revisions) the
//                  exception passes only placements that add a missing Lead, camo or camo Lead (policy-v6.mjs ONE_LIFE_PASS).
//                  From v5 revision 15 and claude-v1 revision 14 (bindUnderCap: false gives the earlier revisions) a
//                  one-life binding on camo_capacity, burst or early_short chooses among the answers the cap allows:
//                  affordable upgrades and the on-plan placements exempted here (policy-v6.mjs applyTowerCap).
//                  From v5 revision 18 and claude-v1 revision 17 (burstStandAside: false gives the earlier revisions) a
//                  burst binding with none of those steps aside instead of passing its placement answers.
// Holds whose targets are all complete no longer apply (plan-v1.mjs activeHolds).
// Records for the adherence measure: survival_first carries the active hold's amount (a hold lifted for
// survival), cash_hold one that held, cash_hold_lifted one lifted and why.
import {onPlanPurchases, activeHold, activeHolds, isHeroCandidate} from './plan-v1.mjs';
import {applyTowerCap} from './policy-v6.mjs';

// idle_cash: cash an on-plan purchase must leave above the holds for other targets.
export const IDLE_MARGIN = 200;

export const SURVIVAL_RULES = ['leak_pressure', 'moab_short', 'threat_short', 'early_short'];
const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';

// context: {lead, catalog}; floor: the floor rules' constraint for this decision, or null; all: the options
// before the floor rules.
export function constrainV1(state, candidates, plan, context = {}, {floor = null, all = null, idleCash = false, towerCap = false, oneLifeCap = true, bindUnderCap = true, burstStandAside = true} = {}) {
 const out = planFilters(state, candidates, plan, context, {floor, all, idleCash});
 if (!towerCap) return out;
 // The floor binding's answers before its keep cut (threat.mjs withBindAnswers) can be exempt too, and threat_short's
 // order-only options, which a burst binding falls back to when it steps aside.
 const answers = (floor?.rules ?? []).flatMap(r => [...(r.answers?.list ?? []), ...(r.answers?.unbound ?? [])]).filter(a => !out.candidates.some(c => c.id === a.id));
 const onPlan = onPlanPurchases(plan, state, [...out.candidates, ...answers], context);
 const exempt = c => c.details?.kind === 'place' && onPlan.has(c.id);
 const capped = applyTowerCap(state, all ?? candidates, out.candidates, floor?.rules ?? [], context, {exempt, oneLife: oneLifeCap, bindUnderCap, burstStandAside});
 if (!capped) return out;
 return {candidates: capped.candidates, constraint: {kind: 'plan', rules: [...(out.constraint?.rules ?? []), capped.rule], removed: candidates.length - capped.candidates.length}};
}

function planFilters(state, candidates, plan, context, {floor, all, idleCash}) {
 let kept = candidates;
 const rules = [];
 const apply = (kind, next, extra = {}) => {
  if (next.length && next.length < kept.length) {
   const gone = kept.filter(c => !next.includes(c)).map(c => c.id);
   rules.push({kind, removed: gone.length, ...extra, ids: gone.slice(0, 8)});
   kept = next;
  }
 };
 const done = () => ({candidates: kept, constraint: rules.length ? {kind: 'plan', rules, removed: candidates.length - kept.length} : null});
 const floorKinds = (floor?.rules ?? []).map(r => r.kind);
 const survival = floorKinds.filter(k => SURVIVAL_RULES.includes(k));
 const hold = activeHold(plan, state.round.number, state);
 if (survival.length) { rules.push({kind: 'survival_first', removed: 0, floor: survival, ...(hold?.amount > 0 ? {hold: hold.amount} : {})}); return done(); }

 const catalog = context.catalog ?? [];
 if (plan.hero?.tower === 'none') apply('no_hero', kept.filter(c => !(c.details?.kind === 'place' && isHeroCandidate(c, catalog))));

 const on = onPlanPurchases(plan, state, kept, context);
 if (on.size) {
  apply('off_plan', kept.filter(c => !spends(c) || on.has(c.id)), {targets: [...new Set([...on.values()].map(v => v.target))]});
  const best = Math.min(...[...on.values()].map(v => v.priority));
  apply('plan_priority', kept.filter(c => !spends(c) || on.get(c.id)?.priority === best), {priority: best});
 }

 if (hold && hold.amount > 0) {
  if (floorKinds.includes('no_start_short')) rules.push({kind: 'cash_hold_lifted', removed: 0, amount: hold.amount, floor: 'no_start_short', reason: 'no_start_short'});
  else {
   // Buying a target the hold saves for is allowed early, before its round_from.
   const saving = onPlanPurchases(plan, state, kept, {...context, anyRound: true, only: hold.for});
   const exempt = c => saving.has(c.id);
   const next = kept.filter(c => !spends(c) || c.details.cash_after >= hold.amount || exempt(c));
   if (next.length) apply('cash_hold', next, {amount: hold.amount, for: hold.for});
   else {
    const behind = (floor?.rules ?? []).find(r => r.kind === 'no_wait_behind');
    const wait = (all ?? []).find(c => c.details?.kind === 'wait');
    if (behind && behind.verdict !== 'short' && !behind.leaks && wait) {
     rules.push({kind: 'cash_hold', removed: kept.length, amount: hold.amount, for: hold.for, restored: 'wait', ids: kept.map(c => c.id).slice(0, 8)});
     kept = [wait];
    } else rules.push({kind: 'cash_hold_lifted', removed: 0, amount: hold.amount, reason: behind ? `no_wait_behind:${behind.verdict}${behind.leaks ? '+leaks' : ''}` : 'no_option_left'});
   }
  }
 }

 if (idleCash && kept.some(c => c.details?.kind === 'wait')) {
  const due = onPlanPurchases(plan, state, kept, context);
  const holds = activeHolds(plan, state.round.number, state);
  const floorFor = target => Math.max(0, ...holds.filter(h => !(h.for ?? []).includes(target)).map(h => h.amount)) + IDLE_MARGIN;
  const buy = kept.find(c => spends(c) && due.has(c.id) && c.details.cash_after >= floorFor(due.get(c.id).target));
  if (buy) apply('idle_cash', kept.filter(c => c.details?.kind !== 'wait'), {cash: Math.floor(state.cash), affordable: buy.id, target: due.get(buy.id).target});
 }
 return done();
}
