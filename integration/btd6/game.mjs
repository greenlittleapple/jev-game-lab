// The BTD6 game adapter for core/hierarchical.mjs decide().
// context() returns the runner's current facts: {lead, secondsPerRound, catalog, freeSpots, freeSpotsFor,
// paths, livesAtRoundStart, leaks, pressure}. Towers placed for plan steps live in the strategy status (stepTowers).
import {PLAN_SCHEMA, STRATEGIST_INSTRUCTIONS, STRATEGY_POLICY, strategistBrief, requestStamp, adoptPlan} from './plan.mjs';
import {strategyTrigger} from './triggers.mjs';
import {constrain} from './rules.mjs';
import {jevQuestion, JEV_POLICY} from './question.mjs';
import {JEV_POLICY_V1, floorRules, groupOptions, jevQuestionV1} from './policy-v1.mjs';
import {JEV_POLICY_V2, floorRulesV2, groupOptionsV2, jevQuestionV2} from './policy-v2.mjs';
import {JEV_POLICY_V3, floorRulesV3, groupOptionsV3, jevQuestionV3} from './policy-v3.mjs';
import {JEV_POLICY_V4, floorRulesV4, groupOptionsV4, jevQuestionV4} from './policy-v4.mjs';
import {JEV_POLICY_V6, floorRulesV6} from './policy-v6.mjs';
import {CLAUDE_POLICY_V1, CLAUDE_V1_REVISION, PLAN_SCHEMA_V1, onPlanPurchases, STRATEGIST_INSTRUCTIONS_V1, strategistBriefV1, requestStampV1, adoptPlanV1, planFact} from './plan-v1.mjs';
import {claudeTrigger} from './triggers-v1.mjs';
import {constrainV1} from './rules-v1.mjs';
import {PLAYBOOK_POLICY_V5, TIE_MARGIN, THREAT_LEAD, resolvePlaybook, tieBreakV5} from './playbook-v5.mjs';
import {THREAT_KINDS_V4, THREAT_OPTIONS_R21} from './threat.mjs';

// Steps taken without a Jev call: dismissing an allowlisted screen, and aiming a tower (runner.mjs aimCandidate).
export const FORCED_KINDS = ['dismiss_popup', 'aim_tower'];

// Majority wait (core/hierarchical.mjs majorityWait): "Wait" in the group or flat question stands unless more
// than half of Jev's probability is on purchases; then the most probable purchase is taken. Starting the next
// round is a pass, not a purchase, so it never replaces a wait. Used by btd6-jev-v6 (any purchase) and, as
// planMajorityWait, by btd6-playbook-v5 (revision 4) and btd6-claude-v1 (revision 3), after their rules and plan
// filters; not by v0 to v4.
export const MAJORITY_WAIT = {threshold: 0.5, isWait: c => c.details?.kind === 'wait', isPass: c => ['wait', 'start_round'].includes(c.details?.kind)};

// Plan-aware majority wait (v5 revision 4, claude-v1 revision 3): only on-plan purchases count, those that advance
// a target due now (plan-v1.mjs onPlanPurchases, the test the plan filters use); a group counts when any member
// does. With nothing due, or no plan, the wait stands: in a plan policy that wait is saving for the next target.
// v5 revision 3 lost at round 51 after majority wait placed off-plan Bomb Shooters 13 times in rounds 48 to 50, when
// nothing was due and the cash was meant for the Sticky Bomb Ninja due from round 51.
export function planMajorityWait(facts) {
 return {...MAJORITY_WAIT, eligible: (state, options, plan) => {
  if (!plan) return new Set();
  const on = onPlanPurchases(plan, state, options.flatMap(o => o.members ?? [o]), facts());
  return new Set(options.filter(o => (o.members ?? [o]).some(m => on.has(m.id))).map(o => o.id));
 }};
}

const PLAN_NOTE = ' plan: the strategist plan (summary, the targets due now, cash to hold). While a purchase that advances a due target is affordable, other purchases were removed.';

// Policy btd6-claude-v1: btd6-jev-v4's floor rules, grouping and question, plus the strategist's plan
// (plan-v1.mjs), its triggers (triggers-v1.mjs) and its filters (rules-v1.mjs), which apply after the floor rules.
// From revision 4 btd6-jev-v6's tower cap follows the filters (rules-v1.mjs towerCap); from revision 5 the floor
// runs threat_short (threat.mjs); from revision 6 it also checks camo Lead and burst (THREAT_KINDS_V2); from revision 7
// burst adders by burst-ratio gain per dollar (THREAT_BURST_AHEAD); from revision 8 camo capacity too (THREAT_KINDS_V3); from
// revision 10 early_short (early.mjs), binding from revision 11; threat_short binding with one life from revision 12;
// with one life the tower cap passes only Lead and camo answer placements from revision 13; with one life a camo capacity,
// burst or early_short binding chooses among the answers the cap allows from revision 14; Lead capacity (THREAT_KINDS_V4,
// lead_capacity) from revision 15 (threatKinds: THREAT_KINDS_V3 gives revision 14's floor); DDT-capable MOAB damage
// (moab.mjs setDdtCheck, set by the session) from revision 16; no DDTs in lead_capacity's Lead RBE from revision 18
// (threatOptions: {...THREAT_BURST_AHEAD, leadDdt: true} gives revision 17's floor); moab_short binding with one life
// (policy-v4.mjs moabBinding) from revision 19 (moabBinding: false gives revision 18's floor); from revision 20 that binding only
// below a ratio of 0.5, the 10-round lead for DDT rounds (moab.mjs setMoabDdtLead, set by the session) with its saving, and
// lead_capacity below 0.5 (moabBindBelow: Infinity, moabSaving: false, threatOptions.leadAt: LEAD_CAPACITY_AT_R12 give revision 19's floor);
// lead_capacity below 1.0 again from revision 21 (threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R17} gives revision 20's floor).
// From revision 22, moab_short's DDT binding and saving keep camo and Lead capacity answers, and the DDT saving targets only a
// purchase that adds a quarter of the gap (policy-v4.mjs moabCapacity, ddtGapShare; moabCapacity: false, ddtGapShare: 0 give revision 21's floor).
// From revision 23, the support-effects DDT figure and the deadline-based need in DDT rounds (moab.mjs setDdtSupport, setDdtNeed,
// set by the session), the binding and DDT saving aimed at the nearest due round below 0.5 (policy-v4.mjs moabNearest), and the
// DDT saving for the most gain per dollar (ddtSaveBest);
// Revision 22's moabCapacity and ddtGapShare are off again (moabCapacity: false, ddtGapShare: 0, as revision 21; series 1k kept revision 18
// over 19). setDdtSupport(false), setDdtNeed(false), moabNearest: false and ddtSaveBest: false give revision 21; with moabCapacity: true and
// ddtGapShare: DDT_GAP_SHARE (policy-v4.mjs) as well, revision 22.
// From revision 24, threat_short's camo_capacity on the camo rate (threat.mjs camoRate, THREAT_OPTIONS_R21), and with one life
// a nearer camo or Lead capacity round not set aside by moab_short (policy-v4.mjs capacityNearer); threatOptions:
// THREAT_BURST_AHEAD with capacityNearer: false gives revision 23's floor.
// From revision 25, the DDT saving only for a purchase reachable before its round with the expected CHIMPS income, and camo and
// Lead capacity answers due at moab_short's short round kept under its binding and saving (policy-v4.mjs ddtReach,
// capacitySame; as btd6-jev-v6 revision 22); ddtReach: false and capacitySame: false give revision 24's floor.
// openingTimeoutMs: how long the opening request is waited for before the first round.
export function claudeGameV1(context = () => ({}), {openingTimeoutMs} = {}) {
 const facts = () => ({...context(), ...(openingTimeoutMs != null ? {openingTimeoutMs} : {})});
 return {
  policy: CLAUDE_POLICY_V1,
  revision: CLAUDE_V1_REVISION,
  majorityWait: planMajorityWait(facts),
  instructions: STRATEGIST_INSTRUCTIONS_V1,
  schema: PLAN_SCHEMA_V1,
  isForced: (state, candidates) => candidates.length === 1 && FORCED_KINDS.includes(candidates[0].details?.kind),
  trigger: (state, plan, status) => claudeTrigger(state, plan, status, facts()),
  brief: (state, candidates, trigger, plan, status) => strategistBriefV1(state, trigger, plan, facts(), status),
  stamp: (state, candidates, trigger) => requestStampV1(state, trigger, facts()),
  adopt: adoptPlanV1,
  isLate: (request, state) => state.in_game && state.round.number > request.stamp.needed_by_round,
  rules: (state, candidates) => floorRulesV4(state, candidates, context(), {threatShort: true, threatKinds: THREAT_KINDS_V4, threatOptions: THREAT_OPTIONS_R21, earlyShort: true, moabBinding: true, moabSaving: true, moabCapacity: false, ddtGapShare: 0, moabNearest: true, ddtSaveBest: true, capacityNearer: true, ddtReach: true, capacitySame: true}),
  constrain: (state, candidates, plan, status, {floor = null, all = null} = {}) => constrainV1(state, candidates, plan, facts(), {floor, all, towerCap: true}),
  group: (state, candidates) => { const c = context(); return groupOptionsV4(state, candidates, {catalog: c.catalog ?? [], paths: c.paths ?? [], pressure: c.pressure ?? null}); },
  question: (state, candidates, plan, status, {stage} = {}) => {
   const q = jevQuestionV4(state, candidates, {...context(), stepTowers: {}}, {stage});
   const fact = planFact(plan, state, facts());
   if (!fact) return q;
   return {state: {...q.state, plan: fact}, questions: {move: {...q.questions.move, instructions: q.questions.move.instructions + PLAN_NOTE}}};
  },
 };
}

const PLAYBOOK_NOTE = ' plan: the prepared playbook for this round (summary, the targets due now, cash to hold). While a purchase that advances a due target is affordable, other purchases were removed.';

// Policy btd6-playbook-v5: btd6-jev-v4's floor rules, grouping and question, plus a prepared playbook
// (playbook-v5.mjs) resolved for each decision and enforced with claude-v1's filters (rules-v1.mjs). No
// strategist: the playbook is the game's own plan (core decide's game.plan). tieMargin: Jev's top two
// options within this probability go to the one the playbook ranks higher (0 turns it off).
// From revision 5 btd6-jev-v6's tower cap follows the filters (rules-v1.mjs towerCap); from revision 6 the floor
// runs threat_short (threat.mjs); from revision 7 it also checks camo Lead and burst (THREAT_KINDS_V2); from revision 8
// burst adders by burst-ratio gain per dollar (THREAT_BURST_AHEAD); from revision 9 camo capacity too (THREAT_KINDS_V3); from
// revision 11 early_short (early.mjs), binding from revision 12; threat_short binding with one life from revision 13;
// with one life the tower cap passes only Lead and camo answer placements from revision 14; with one life a camo capacity,
// burst or early_short binding chooses among the answers the cap allows from revision 15; Lead capacity (THREAT_KINDS_V4,
// lead_capacity) from revision 16 (threatKinds: THREAT_KINDS_V3 gives revision 15's floor); DDT-capable MOAB damage
// (moab.mjs setDdtCheck, set by the session) from revision 17; no DDTs in lead_capacity's Lead RBE from revision 19
// (threatOptions: {...THREAT_BURST_AHEAD, leadDdt: true} gives revision 18's floor); moab_short binding with one life
// (policy-v4.mjs moabBinding) from revision 20 (moabBinding: false gives revision 19's floor); from revision 21 that binding only
// below a ratio of 0.5, the 10-round lead for DDT rounds (moab.mjs setMoabDdtLead, set by the session) with its saving, and
// lead_capacity below 0.5 (moabBindBelow: Infinity, moabSaving: false, threatOptions.leadAt: LEAD_CAPACITY_AT_R12 give revision 20's floor);
// lead_capacity below 1.0 again from revision 22 (threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R17} gives revision 21's floor).
// From revision 23, moab_short's DDT binding and saving keep camo and Lead capacity answers, and the DDT saving targets only a
// purchase that adds a quarter of the gap (policy-v4.mjs moabCapacity, ddtGapShare; moabCapacity: false, ddtGapShare: 0 give revision 22's floor).
// From revision 24, the support-effects DDT figure and the deadline-based need in DDT rounds (moab.mjs setDdtSupport, setDdtNeed,
// set by the session), the binding and DDT saving aimed at the nearest due round below 0.5 (policy-v4.mjs moabNearest), and the
// DDT saving for the most gain per dollar (ddtSaveBest);
// Revision 23's moabCapacity and ddtGapShare are off again (moabCapacity: false, ddtGapShare: 0, as revision 22; series 1k kept revision 18
// over 19). setDdtSupport(false), setDdtNeed(false), moabNearest: false and ddtSaveBest: false give revision 22; with moabCapacity: true and
// ddtGapShare: DDT_GAP_SHARE (policy-v4.mjs) as well, revision 23.
// From revision 25, threat_short's camo_capacity on the camo rate (threat.mjs camoRate, THREAT_OPTIONS_R21), and with one life
// a nearer camo or Lead capacity round not set aside by moab_short (policy-v4.mjs capacityNearer); threatOptions:
// THREAT_BURST_AHEAD with capacityNearer: false gives revision 24's floor.
// From revision 26, the DDT saving only for a purchase reachable before its round with the expected CHIMPS income, and camo and
// Lead capacity answers due at moab_short's short round kept under its binding and saving (policy-v4.mjs ddtReach,
// capacitySame; as btd6-jev-v6 revision 22); ddtReach: false and capacitySame: false give revision 25's floor.
export function playbookGameV5(context = () => ({}), {playbook, tieMargin = TIE_MARGIN} = {}) {
 if (!playbook) throw Error(`Policy ${PLAYBOOK_POLICY_V5} needs a playbook.`);
 // The runner's lead is a strategist's answer time; a playbook has none, so threat answers get a fixed lead.
 const facts = () => ({...context(), lead: THREAT_LEAD});
 return {
  policy: PLAYBOOK_POLICY_V5,
  majorityWait: planMajorityWait(facts),
  isForced: (state, candidates) => candidates.length === 1 && FORCED_KINDS.includes(candidates[0].details?.kind),
  plan: (state, candidates) => state.in_game && !state.popup && !state.match?.result ? resolvePlaybook(playbook, state, candidates, facts()) : null,
  planInForce: plan => plan.record,
  rules: (state, candidates) => floorRulesV4(state, candidates, context(), {threatShort: true, threatKinds: THREAT_KINDS_V4, threatOptions: THREAT_OPTIONS_R21, earlyShort: true, moabBinding: true, moabSaving: true, moabCapacity: false, ddtGapShare: 0, moabNearest: true, ddtSaveBest: true, capacityNearer: true, ddtReach: true, capacitySame: true}),
  constrain: (state, candidates, plan, status, {floor = null, all = null} = {}) => constrainV1(state, candidates, plan, facts(), {floor, all, idleCash: true, towerCap: true}),
  group: (state, candidates) => { const c = context(); return groupOptionsV4(state, candidates, {catalog: c.catalog ?? [], paths: c.paths ?? [], pressure: c.pressure ?? null}); },
  question: (state, candidates, plan, status, {stage} = {}) => {
   const q = jevQuestionV4(state, candidates, {...context(), stepTowers: {}}, {stage});
   const fact = planFact(plan, state, facts());
   if (!fact) return q;
   return {state: {...q.state, plan: fact}, questions: {move: {...q.questions.move, instructions: q.questions.move.instructions + PLAYBOOK_NOTE}}};
  },
  tieBreak: (state, options, answer, plan) => tieBreakV5(state, options, answer, plan, {margin: tieMargin, context: facts()}),
 };
}

// policy: the Jev policy. btd6-jev-v1 adds its floor rules, two-level choice and compact question
// (policy-v1.mjs); btd6-jev-v2 the same structure with a floor from the round's bloons (policy-v2.mjs);
// btd6-jev-v3 adds leak pressure from the bloons on the track and per-tower reach (policy-v3.mjs);
// btd6-jev-v4 adds MOAB readiness to v3 (policy-v4.mjs); btd6-jev-v6 adds majority wait and the tower cap
// to v4, and from revision 2 threat_short (policy-v6.mjs, threat.mjs);
// btd6-jev-v0 and the strategist policy use none of them.
export function btd6Game(context = () => ({}), {policy = JEV_POLICY} = {}) {
 const facts = status => ({...context(), stepTowers: status?.stepTowers ?? {}});
 const v1 = policy === JEV_POLICY_V1, v2 = policy === JEV_POLICY_V2, v3 = policy === JEV_POLICY_V3, v4 = policy === JEV_POLICY_V4, v6 = policy === JEV_POLICY_V6;
 return {
  policy: STRATEGY_POLICY,
  instructions: STRATEGIST_INSTRUCTIONS,
  schema: PLAN_SCHEMA,
  // Dismissing an allowlisted screen and aiming a tower are the forced transitions: no triggers, no Jev call.
  // Otherwise even a lone option (waiting) still lets the strategist plan ahead.
  isForced: (state, candidates) => candidates.length === 1 && FORCED_KINDS.includes(candidates[0].details?.kind),
  trigger: (state, plan, status) => strategyTrigger(state, plan, status, facts(status)),
  brief: (state, candidates, trigger, plan, status) => strategistBrief(state, trigger, plan, facts(status)),
  stamp: (state, candidates, trigger) => requestStamp(state, trigger, context()),
  adopt: adoptPlan,
  isLate: (request, state) => state.in_game && state.round.number > request.stamp.needed_by_round,
  constrain: (state, candidates, plan, status) => constrain(state, candidates, plan, facts(status)),
  ...(v6 ? {
   rules: (state, candidates) => floorRulesV6(state, candidates, context()),
   group: (state, candidates) => { const c = context(); return groupOptionsV4(state, candidates, {catalog: c.catalog ?? [], paths: c.paths ?? [], pressure: c.pressure ?? null}); },
   question: (state, candidates, plan, status, {stage} = {}) => jevQuestionV4(state, candidates, facts(status), {stage}),
   majorityWait: MAJORITY_WAIT,
  } : v4 ? {
   rules: (state, candidates) => floorRulesV4(state, candidates, context()),
   group: (state, candidates) => { const c = context(); return groupOptionsV4(state, candidates, {catalog: c.catalog ?? [], paths: c.paths ?? [], pressure: c.pressure ?? null}); },
   question: (state, candidates, plan, status, {stage} = {}) => jevQuestionV4(state, candidates, facts(status), {stage}),
  } : v3 ? {
   rules: (state, candidates) => floorRulesV3(state, candidates, context()),
   group: (state, candidates) => { const c = context(); return groupOptionsV3(state, candidates, {catalog: c.catalog ?? [], paths: c.paths ?? [], pressure: c.pressure ?? null}); },
   question: (state, candidates, plan, status, {stage} = {}) => jevQuestionV3(state, candidates, facts(status), {stage}),
  } : v2 ? {
   rules: (state, candidates) => floorRulesV2(state, candidates, context()),
   group: (state, candidates) => groupOptionsV2(state, candidates, {catalog: context().catalog ?? [], paths: context().paths ?? []}),
   question: (state, candidates, plan, status, {stage} = {}) => jevQuestionV2(state, candidates, facts(status), {stage}),
  } : v1 ? {
   rules: (state, candidates) => floorRules(state, candidates),
   group: (state, candidates) => groupOptions(state, candidates),
   question: (state, candidates, plan, status, {stage} = {}) => jevQuestionV1(state, candidates, facts(status), {stage}),
  } : {
   question: (state, candidates, plan, status) => jevQuestion(state, candidates, plan, facts(status)),
  }),
 };
}
