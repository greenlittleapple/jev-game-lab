import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decide, newStrategyStatus} from './hierarchical.mjs';
import {fileChannel} from './strategy-channel.mjs';

const options = [{id: 'wait', label: 'Wait'}, {id: 'buy', label: 'Buy'}, {id: 'sell', label: 'Sell'}];
const jevAnswer = choice => ({model: 'jev-test', answers: {move: {type: 'choice', choice, confidence: 0.8, probabilities: {[choice]: 0.8}}}, usage: {input_tokens: 50, output_tokens: 1}});

// A game whose trigger comes from the test and whose plan allows the options listed in plan.allow.
function fakeGame(trigger = () => null) {
 return {
  instructions: 'Plan.', schema: {type: 'object'},
  trigger: (state, plan, status) => trigger(state, plan, status),
  brief: (state, candidates, t) => ({reason: t.reason, round: state.round}),
  stamp: state => ({round: state.round, needed_by: state.round + 2}),
  adopt: (plan, request, meta) => ({...plan, ...meta, round_at: request.stamp.round}),
  isLate: (request, state) => state.round > request.stamp.needed_by,
  constrain: (state, candidates, plan) => {
   const kept = candidates.filter(c => plan.allow.includes(c.id));
   return {candidates: kept, constraint: kept.length < candidates.length ? {kind: 'plan', removed: candidates.length - kept.length} : null};
  },
  question: (state, candidates, plan) => ({state: {round: state.round, plan: plan?.summary ?? null}, questions: {move: {type: 'choice', instructions: 'x', criteria: Object.fromEntries(candidates.map(c => [c.id, c.label]))}}}),
 };
}

async function setup(t) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-loop-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 return {channel: fileChannel(dir), status: newStrategyStatus({enabled: true})};
}

test('without a strategist, Jev chooses among all candidates and must return one of them', async () => {
 const asked = [];
 const r = await decide({state: {round: 5}, candidates: options, game: fakeGame(), ask: async q => { asked.push(q); return jevAnswer('buy'); }});
 assert.equal(r.decisionSource, 'jev');
 assert.equal(r.choice.id, 'buy');
 assert.deepEqual(Object.keys(asked[0].questions.move.criteria), ['wait', 'buy', 'sell']);
 await assert.rejects(decide({state: {round: 5}, candidates: options, game: fakeGame(), ask: async () => jevAnswer('steal')}), /invalid action ID/);
});

test('a non-blocking trigger posts a request and play continues; the answer is adopted at a later decision', async t => {
 const {channel, status} = await setup(t);
 const game = fakeGame((state, plan) => plan ? null : {reason: 'threat_ahead', key: 'm:threat:camo', priority: 2});
 let calls = 0;
 const ask = async () => { calls++; return jevAnswer('wait'); };
 const first = await decide({state: {round: 20}, candidates: options, game, strategist: {channel, status}, ask});
 assert.equal(first.decisionSource, 'jev', 'Jev decided without waiting for the strategist');
 assert.deepEqual(first.strategyEvents.map(e => e.kind), ['strategy_request']);
 const request = await channel.current();
 assert.equal(request.reason, 'threat_ahead');
 assert.deepEqual(request.brief, {reason: 'threat_ahead', round: 20});
 await decide({state: {round: 21}, candidates: options, game, strategist: {channel, status}, ask});
 assert.equal(status.requests, 1, 'the same trigger is not posted twice');
 await channel.answer(request.id, {summary: 'Save for camo', allow: ['buy']});
 const third = await decide({state: {round: 23}, candidates: options, game, strategist: {channel, status}, ask});
 assert.equal(third.decisionSource, 'plan', 'the plan left one option, taken without a Jev call');
 assert.equal(third.choice.id, 'buy');
 assert.equal(calls, 2);
 const adopted = third.strategyEvents.find(e => e.kind === 'strategy_adopted');
 assert.equal(adopted.late, true, 'answered after round 22, when it was needed');
 assert.equal(status.late, 1);
 assert.equal(status.plan.round_at, 20);
 assert.equal(status.latencies.length, 1);
});

test('a blocking trigger waits for the answer, and a pause cancels the wait', async t => {
 const {channel, status} = await setup(t);
 const game = fakeGame((state, plan) => plan ? null : {reason: 'match_start', key: 'm:match_start', priority: 4, blocking: true});
 let slept = 0;
 const sleep = async () => {
  slept++;
  if (slept === 2) { const request = await channel.current(); await channel.answer(request.id, {summary: 'Open with darts', allow: ['wait', 'buy']}); }
 };
 const r = await decide({state: {round: 3}, candidates: options, game, strategist: {channel, status}, ask: async q => { assert.equal(q.state.plan, 'Open with darts'); return jevAnswer('buy'); }, sleep});
 assert.equal(r.choice.id, 'buy');
 assert.equal(slept, 2);
 assert.deepEqual(r.strategyEvents.map(e => e.kind), ['strategy_request', 'strategy_adopted']);
 const other = await setup(t);
 await assert.rejects(decide({state: {round: 3}, candidates: options, game, strategist: other, ask: async () => jevAnswer('wait'),
  sleep: async () => {}, cancelled: () => true}), /Decision cancelled/);
});

test('candidates are rebuilt after a plan is adopted during the decision', async t => {
 const {channel, status} = await setup(t);
 const game = fakeGame((state, plan) => plan ? null : {reason: 'match_start', key: 'm:match_start', priority: 4, blocking: true});
 const sleep = async () => { const request = await channel.current(); if (request) await channel.answer(request.id, {summary: 'Use the named spot', allow: ['place@S07']}); };
 const r = await decide({state: {round: 3}, candidates: options, game, strategist: {channel, status}, ask: async () => jevAnswer('wait'), sleep,
  rebuild: plan => [...options, {id: 'place@S07', label: 'Place at S07'}]});
 assert.equal(r.decisionSource, 'plan');
 assert.equal(r.choice.id, 'place@S07');
});

test('a more urgent trigger replaces an outstanding request; a less urgent one waits its turn', async t => {
 const {channel, status} = await setup(t);
 let next = {reason: 'review', key: 'm:review', priority: 1};
 const game = fakeGame(() => next);
 const ask = async () => jevAnswer('wait');
 await decide({state: {round: 30}, candidates: options, game, strategist: {channel, status}, ask});
 const review = await channel.current();
 next = {reason: 'leak', key: 'm:leak:31', priority: 3};
 await decide({state: {round: 31}, candidates: options, game, strategist: {channel, status}, ask});
 const leak = await channel.current();
 assert.equal(leak.reason, 'leak');
 assert.equal(leak.replaces, review.id);
 next = {reason: 'threat_ahead', key: 'm:threat:moab', priority: 2};
 await decide({state: {round: 32}, candidates: options, game, strategist: {channel, status}, ask});
 assert.equal((await channel.current()).id, leak.id, 'the leak request stays');
 assert.equal(status.asked['m:threat:moab'], undefined, 'so the threat can fire again later');
});

test('rules apply without a plan; one remaining option is taken without asking Jev', async () => {
 const game = {...fakeGame(), rules: (state, candidates) => ({candidates: candidates.filter(c => c.id === 'buy'), constraint: {kind: 'rules', rules: [{kind: 'no_wait', removed: 2}], removed: 2}})};
 const r = await decide({state: {round: 5}, candidates: options, game, ask: async () => { throw Error('no Jev call expected'); }});
 assert.equal(r.decisionSource, 'rules');
 assert.equal(r.choice.id, 'buy');
 assert.deepEqual(r.constraint.rules, [{kind: 'no_wait', removed: 2}]);
});

test('two-level choice: Jev picks a group, then an option in it; a one-option group needs no second call', async () => {
 const many = [...options, {id: 'buy:b', label: 'Buy B'}];
 const group = (state, candidates) => {
  const groups = [{id: 'hold', label: 'Hold', members: candidates.filter(c => c.id === 'wait')}, {id: 'buy', label: 'Buy', members: candidates.filter(c => c.id.startsWith('buy'))}];
  groups.dropped = 1;
  return groups;
 };
 const stages = [];
 const game = {...fakeGame(), group, question: (state, candidates, plan, status, {stage}) => { stages.push(stage); return {questions: {move: {type: 'choice', criteria: Object.fromEntries(candidates.map(c => [c.id, c.label]))}}}; }};
 const answers = ['buy', 'buy:b'];
 const r = await decide({state: {round: 5}, candidates: many, game, ask: async () => jevAnswer(answers.shift())});
 assert.deepEqual(stages, ['group', 'member']);
 assert.equal(r.choice.id, 'buy:b');
 assert.equal(r.answers.group.choice, 'buy');
 assert.deepEqual(r.usage, {input_tokens: 100, output_tokens: 2});
 assert.deepEqual(r.narrowed, {groups: 2, dropped: 1});
 let calls = 0;
 const held = await decide({state: {round: 5}, candidates: many, game, ask: async () => { calls++; return jevAnswer('hold'); }});
 assert.equal(calls, 1);
 assert.equal(held.choice.id, 'wait');
 assert.equal(held.answers.move.choice, 'wait');
 await assert.rejects(decide({state: {round: 5}, candidates: many, game, ask: async () => jevAnswer('wait')}), /invalid action ID/, 'a member ID is not a group');
});

test('a game plan without a strategist: constrain and the question get it, the decision records it, and a tie-break can change the choice', async () => {
 const game = {...fakeGame(), plan: () => ({summary: 'own', allow: ['buy', 'sell']}), planInForce: plan => ({summary: plan.summary}),
  tieBreak: (state, opts, answer) => answer.probabilities.sell > 0.4 ? {choice: 'sell', record: {jev: answer.choice, chosen: 'sell'}} : null};
 const answer = sell => ({model: 'jev-test', answers: {move: {type: 'choice', choice: 'buy', confidence: 0.5, probabilities: {buy: 0.5, sell}}}, usage: {input_tokens: 1, output_tokens: 1}});
 const asked = [];
 const r = await decide({state: {round: 5}, candidates: options, game, ask: async q => { asked.push(q); return answer(0.45); }});
 assert.deepEqual(Object.keys(asked[0].questions.move.criteria), ['buy', 'sell']);
 assert.equal(asked[0].state.plan, 'own');
 assert.deepEqual(r.planInForce, {summary: 'own'});
 assert.equal(r.choice.id, 'sell');
 assert.deepEqual(r.tieBreaks, [{stage: 'flat', jev: 'buy', chosen: 'sell'}]);
 const kept = await decide({state: {round: 5}, candidates: options, game, ask: async () => answer(0.1)});
 assert.equal(kept.choice.id, 'buy');
 assert.equal(kept.tieBreaks, undefined);
});
