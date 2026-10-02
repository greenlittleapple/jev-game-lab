// One decision of the hierarchical loop: check triggers, consult the strategist, remove the
// options the plan doesn't allow, take a single remaining option without a model call, and
// otherwise ask Jev. Generalized from integration/sts2/hierarchical.mjs in jev-spire-strategist.
//
// The game adapter supplies everything game-specific:
//   policy                                   label written to the logs
//   instructions, schema                     sent with every strategist request
//   isForced(state, candidates)              true when the only candidate is the only legal game action
//   trigger(state, plan, status, candidates) null or {reason, key, priority?, blocking?}
//   brief(state, candidates, trigger, plan, status)  what the strategist reads
//   stamp(state, candidates, trigger)        facts captured when the request is made
//   adopt(plan, request, meta)               the active plan built from an answer
//   isLate(request, state)                   optional: the answer arrived after it was needed
//   constrain(state, candidates, plan, status, {floor, all})  {candidates, constraint}; must keep at least
//                                            one; floor is the rules' constraint for this decision (or null),
//                                            all the options before the rules
//   rules(state, candidates, status)         optional: {candidates, constraint}, the plan-independent rules,
//                                            applied before constrain with or without a plan; keeps at least one
//   group(state, candidates, plan, status)   optional: null for one flat question, or groups
//                                            [{id, label, details, members}] (members are candidates); Jev
//                                            picks a group, then an option inside it. groups.dropped: options
//                                            left out to keep the group question short
//   question(state, candidates, plan, status, {stage})  one Jev request payload; stage is 'flat', 'group'
//                                            or 'member'
//   escalate(state, answer, plan, status)    optional: a trigger after an unsure Jev answer
//   plan(state, candidates)                  optional, without a strategist: the game's own plan for this
//                                            decision (a prepared playbook), passed to constrain and question
//                                            like a strategist's plan; planInForce(plan) is what the decision
//                                            records about it
//   tieBreak(state, options, answer, plan, {stage})  optional: null, or {choice, record} to take another
//                                            option than Jev's (a near tie the plan ranks); each record is
//                                            returned in the result's tieBreaks
//   majorityWait                             optional: {threshold, isWait(option), isPass(option), eligible?}. In
//                                            the group and flat questions, after tieBreak, a waiting option taken
//                                            while more than threshold of Jev's probability is on purchases is
//                                            replaced by the most probable purchase (majorityWait below); the
//                                            record {kind: 'majority_wait', ...} goes into tieBreaks.
//                                            eligible(state, options, plan, {stage}), when given, returns the Set
//                                            of option IDs that count as purchases (a plan policy's on-plan ones)
//   revision                                 optional: the policy's code revision, added to a strategist's
//                                            planInForce record
//
// A trigger with blocking: true waits for the answer (STS2 always waits, because the game
// waits for input); with timeoutMs as well, it waits at most that long, logs strategy_timeout and
// plays on without the answer (the request stays posted). Otherwise the request is posted and play
// continues under the current plan; the answer is adopted at the first decision after it arrives.
// The result's planInForce names the plan each decision was made under (null: none yet); it is
// undefined without a strategist or a game plan.
const noUsage = {input_tokens: 0, output_tokens: 0};
const addUsage = (a, b) => ({input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0), output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0)});
const direct = (decisionSource, choice, extra = {}) => ({decisionSource, model: null, usage: noUsage, choice, ...extra,
 answers: {move: {type: 'choice', choice: choice.id, confidence: null, probabilities: {}}}});
const sleepFor = ms => new Promise(r => setTimeout(r, ms));
// One constraint record from the plan-independent rules and the plan's rules.
function mergeConstraints(a, b) {
 if (!a || !b) return a ?? b ?? null;
 return {kind: `${a.kind}+${b.kind}`, rules: [...(a.rules ?? []), ...(b.rules ?? [])], removed: (a.removed ?? 0) + (b.removed ?? 0)};
}

// Majority wait: when the answer's pick is a waiting option (isWait) and more than `threshold` of Jev's
// probability is on purchases, the most probable purchase instead ({choice, record}); otherwise null. A
// purchase is an option that is not a pass (isPass: waiting, and options such as starting the next round
// that spend nothing; it defaults to isWait). eligible: a Set of option IDs; when given, only those purchases
// count, both for the threshold and for the replacement. Only in the group and flat questions, where waiting is offered.
// Jev spreads its probability for buying over many purchases, so a plurality "wait" can win while most of
// the probability favours buying something.
export function majorityWait(options, answer, {stage, threshold = 0.5, isWait, isPass = isWait, eligible = null} = {}) {
 if (stage !== 'group' && stage !== 'flat') return null;
 const picked = options.find(c => c.id === answer?.choice);
 if (!picked || !isWait?.(picked)) return null;
 const p = answer.probabilities ?? {}, pWait = p[picked.id];
 if (!Number.isFinite(pWait)) return null;
 const purchases = options.filter(c => !isPass(c) && Number.isFinite(p[c.id]) && (!eligible || eligible.has(c.id)));
 const pBuy = purchases.reduce((sum, c) => sum + p[c.id], 0);
 if (!(pBuy > threshold)) return null;
 const best = purchases.reduce((a, c) => !a || p[c.id] > p[a.id] ? c : a, null);
 return {choice: best.id, record: {kind: 'majority_wait', p_wait: pWait, p_buy: +pBuy.toFixed(3), [stage === 'group' ? 'chosen_group' : 'chosen']: best.id, p_chosen: p[best.id], ...(eligible ? {on_plan: true} : {})}};
}

export function newStrategyStatus({enabled = false, mode = 'constrained'} = {}) {
 if (!['constrained', 'advisory'].includes(mode)) throw Error('Strategy mode must be constrained or advisory');
 return {enabled, mode, plan: null, requests: 0, answers: 0, late: 0, asked: {}, latencies: []};
}

// strategist = {channel, status} or null for Jev alone.
// rebuild(plan), optional: the candidates again after a plan was adopted during this decision, for
// games whose candidates depend on the plan (a BTD6 plan can name a spot that wasn't offered).
export async function decide({state, candidates, game, strategist = null, ask, onStage = () => {}, cancelled = () => false,
 pollMs = 1000, sleep = sleepFor, now = () => new Date(), rebuild = null}) {
 if (!candidates.length) throw Error('No legal candidates');
 const events = [];
 if (game.isForced?.(state, candidates)) return {...direct('forced', candidates[0]), strategyEvents: events};
 const status = strategist?.status?.enabled ? strategist.status : null;
 const channel = strategist?.channel;
 // A game's own plan (a prepared playbook) when no strategist is in use.
 const ownPlan = !status && game.plan ? game.plan(state, candidates) : null;
 const tieBreaks = [];

 const adopt = async () => {
  const request = await channel.current();
  const answer = request && await channel.take(request.id);
  if (!answer) return false;
  status.plan = game.adopt(answer.plan, request, {request_id: request.id, answered_at: answer.answeredAt, adopted_at: now().toISOString()});
  status.answers++;
  const latency = Date.parse(answer.answeredAt) - Date.parse(request.createdAt);
  if (Number.isFinite(latency)) status.latencies = [...status.latencies, latency].slice(-20);
  const late = Boolean(game.isLate?.(request, state));
  if (late) status.late++;
  events.push({kind: 'strategy_adopted', reason: request.reason, request_id: request.id, latency_ms: Number.isFinite(latency) ? latency : null, late, plan: status.plan});
  return true;
 };

 // Returns true when a blocking consult adopted an answer.
 const consult = async trigger => {
  const current = await channel.current();
  if (current?.key !== trigger.key) {
   // One outstanding request at a time. A more urgent trigger replaces it (the CLI then refuses
   // answers to the old ID); a less urgent one fires again at a later decision if still relevant.
   if (current && (trigger.priority ?? 0) <= (current.priority ?? 0)) return false;
   const request = await channel.post({key: trigger.key, reason: trigger.reason, priority: trigger.priority ?? 0, ...(game.policy ? {policy: game.policy} : {}),
    ...(current ? {replaces: current.id} : {}),
    instructions: game.instructions, schema: game.schema,
    brief: game.brief(state, candidates, trigger, status.plan, status), stamp: game.stamp(state, candidates, trigger)});
   status.requests++;
   status.asked[trigger.key] = now().toISOString();
   const keys = Object.keys(status.asked);
   if (keys.length > 200) delete status.asked[keys[0]];
   events.push({kind: 'strategy_request', reason: trigger.reason, key: trigger.key, request_id: request.id, blocking: Boolean(trigger.blocking)});
  }
  if (!trigger.blocking) { onStage(`Strategist asked (${trigger.reason}); play continues`); return false; }
  onStage('Waiting for the strategist');
  const request = await channel.current();
  for (let waited = 0; ; waited += pollMs) {
   if (cancelled()) throw Error('Decision cancelled.');
   if (trigger.timeoutMs != null && waited >= trigger.timeoutMs) {
    events.push({kind: 'strategy_timeout', reason: trigger.reason, key: trigger.key, request_id: request?.id ?? null, waited_ms: waited});
    onStage(`No strategist answer after ${Math.round(waited / 1000)} s (${trigger.reason}); play continues`);
    return false;
   }
   await sleep(pollMs);
   if (await adopt()) return true;
  }
 };

 const pick = async (plan, options, stage) => {
  const result = await ask(game.question(state, options, plan, status, {stage}));
  const answer = result.answers?.move;
  let choice = options.find(c => c.id === answer?.choice);
  if (answer?.type !== 'choice' || !choice) throw Error('Jev returned an invalid action ID.');
  const tie = game.tieBreak?.(state, options, answer, plan, {stage});
  if (tie) {
   const other = tie.choice && options.find(c => c.id === tie.choice);
   if (other) choice = other;
   tieBreaks.push({stage, ...tie.record});
  }
  // Applied to the pick after any tie-break, so a tie-break can't hand the choice back to waiting.
  const mw = game.majorityWait, eligible = mw?.eligible && (stage === 'group' || stage === 'flat') ? mw.eligible(state, options, plan, {stage}) : null;
  const majority = mw && majorityWait(options, {...answer, choice: choice.id}, {stage, ...mw, eligible});
  if (majority) {
   choice = options.find(c => c.id === majority.choice);
   tieBreaks.push({stage, ...majority.record});
  }
  return {result, answer, choice};
 };
 const choose = async () => {
  const plan = status?.plan ?? ownPlan;
  const floor = game.rules ? game.rules(state, candidates, status) : {candidates, constraint: null};
  if (!floor.candidates.length) throw Error('A rule removed every option.');
  const planned = plan && (status ? status.mode === 'constrained' : true)
   ? game.constrain(state, floor.candidates, plan, status, {floor: floor.constraint, all: candidates}) : {candidates: floor.candidates, constraint: null};
  let options = planned.candidates;
  const constraint = mergeConstraints(floor.constraint, planned.constraint);
  if (!options.length) throw Error('A rule removed every option.');
  if (options.length === 1) return direct(planned.constraint ? 'plan' : floor.constraint ? 'rules' : 'single_option', options[0], {constraint});
  // Two-level choice: Jev first picks a group (an action type and tower), then an option inside it.
  let first = null, narrowed = null;
  const groups = game.group ? game.group(state, options, plan, status) : null;
  if (groups?.length) {
   narrowed = {groups: groups.length, dropped: groups.dropped ?? 0};
   if (groups.length === 1) options = groups[0].members;
   else {
    onStage('Jev is choosing an action');
    first = await pick(plan, groups, 'group');
    options = first.choice.members;
   }
   if (!options?.length) throw Error('A group has no options.');
  }
  const extra = {constraint, ...(narrowed ? {narrowed} : {})};
  if (options.length === 1) {
   if (!first) return direct(planned.constraint ? 'plan' : floor.constraint ? 'rules' : 'single_option', options[0], extra);
   return {decisionSource: 'jev', model: first.result.model ?? null, usage: first.result.usage ?? noUsage, choice: options[0], ...extra,
    answers: {group: first.answer, move: {type: 'choice', choice: options[0].id, confidence: first.answer.confidence ?? null, probabilities: {}}}};
  }
  onStage('Jev is choosing');
  const second = await pick(plan, options, first ? 'member' : 'flat');
  return {decisionSource: 'jev', model: second.result.model ?? first?.result.model ?? null, usage: addUsage(first?.result.usage, second.result.usage),
   answers: {...(first ? {group: first.answer} : {}), move: second.answer}, choice: second.choice, ...extra};
 };

 const planBefore = status?.plan;
 const refresh = () => { if (rebuild && status.plan !== planBefore) { const next = rebuild(status.plan); if (next.length) candidates = next; } };
 if (status) {
  await adopt();
  const trigger = game.trigger(state, status.plan, status, candidates);
  if (trigger) await consult(trigger);
  refresh();
 }
 let result = await choose();
 const escalation = status && result.decisionSource === 'jev' && game.escalate?.(state, result.answers.move, status.plan, status);
 if (escalation && await consult(escalation)) {
  const first = result;
  refresh();
  result = await choose();
  result = {...result, usage: addUsage(first.usage, result.usage), escalatedFrom: first.answers.move};
 }
 const planInForce = ownPlan ? (game.planInForce ? game.planInForce(ownPlan) : {}) : status ? (status.plan ? {request_id: status.plan.request_id ?? null, reason: status.plan.reason ?? null,
  round_at: status.plan.round_at ?? null, adopted_at: status.plan.adopted_at ?? null, ...(game.revision != null ? {revision: game.revision} : {})} : null) : undefined;
 return {...result, strategyEvents: events, ...(planInForce !== undefined ? {planInForce} : {}), ...(tieBreaks.length ? {tieBreaks} : {})};
}
