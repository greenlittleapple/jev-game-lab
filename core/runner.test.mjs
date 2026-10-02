import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRunner, runLog, acquireOperatorLock} from './runner.mjs';
import {RequestError} from './request-error.mjs';

const buy = {id: 'buy', label: 'Buy', command: {action: 'place_tower', tower: 'DartMonkey', x: 1, y: 2}, details: {cost: 100}};
const wait = {id: 'wait', label: 'Wait', command: null, hold_ms: 5000};
const readLog = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));

async function setup(t, overrides = {}) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-runner-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const log = runLog(join(dir, 'run.jsonl'));
 const states = overrides.states ?? [{towers: 1, cash: 500}];
 let reads = 0;
 const sent = [];
 const runner = createRunner({
  observe: overrides.observe ?? (async () => states[Math.min(reads++, states.length - 1)]),
  candidates: () => [wait, buy],
  decide: overrides.decide ?? (async () => ({decisionSource: 'jev', choice: buy, answers: {move: {choice: 'buy'}}})),
  fingerprint: s => String(s.towers),
  stillValid: (s, choice) => s.cash >= choice.details.cost,
  send: overrides.send ?? (async command => { sent.push({command, logged: await readLog(log.file)}); return {command_id: command.command_id, status: 'executed', tower_id: 12}; }),
  lookup: overrides.lookup ?? null,
  onExecuted: overrides.onExecuted,
  log, usage: overrides.usage, limits: overrides.limits, now: overrides.now,
 });
 runner.resume();
 return {runner, log, sent, dir};
}

test('a command is sent once, after a fresh observation and after its dispatch record is on disk', async t => {
 const executed = [];
 const {runner, log, sent} = await setup(t, {onExecuted: (d, r) => executed.push(r.tower_id)});
 assert.equal(await runner.step(), 'executed');
 assert.equal(sent.length, 1);
 const before = sent[0].logged.at(-1);
 assert.equal(before.kind, 'dispatch');
 assert.equal(before.outcome, 'pending');
 assert.equal(before.command.command_id, sent[0].command.command_id, 'the dispatch record names the command before it is sent');
 assert.deepEqual(executed, [12]);
 assert.equal((await readLog(log.file)).at(-1).outcome, 'executed');
});

test('a changed structure or a failed precondition rejects the decision without sending', async t => {
 const moved = await setup(t, {states: [{towers: 1, cash: 500}, {towers: 2, cash: 500}]});
 assert.equal(await moved.runner.step(), 'stale');
 assert.equal(moved.sent.length, 0);
 assert.equal((await readLog(moved.log.file)).at(-1).outcome, 'stale_rejected');
 const poorer = await setup(t, {states: [{towers: 1, cash: 500}, {towers: 1, cash: 50}]});
 assert.equal(await poorer.runner.step(), 'stale');
 assert.equal(poorer.sent.length, 0);
});

test('a pause during the decision drops it; a wait holds without sending', async t => {
 let runner;
 const paused = await setup(t, {decide: async () => { runner.pause('Paused by operator.'); return {decisionSource: 'jev', choice: buy}; }});
 runner = paused.runner;
 assert.equal(await runner.step(), 'cancelled');
 assert.equal(paused.sent.length, 0);
 const waiting = await setup(t, {decide: async () => ({decisionSource: 'jev', choice: wait}), now: () => 1000});
 assert.equal(await waiting.runner.step(), 'held');
 assert.equal(waiting.runner.memory.holdUntil, 6000);
 assert.equal(waiting.sent.length, 0);
});

test('a lost response is looked up by command ID and never resent', async t => {
 let sends = 0;
 const found = await setup(t, {send: async () => { sends++; throw Error('fetch failed'); }, lookup: async id => ({command_id: id, status: 'executed'})});
 assert.equal(await found.runner.step(), 'executed');
 assert.equal(sends, 1);
 const unknown = await setup(t, {send: async () => { sends++; throw Error('timeout'); }, lookup: async () => null});
 assert.equal(await unknown.runner.step(), 'uncertain');
 assert.equal(unknown.runner.status.mode, 'paused');
 assert.throws(() => unknown.runner.resume(), /Reconcile/);
 assert.equal(await unknown.runner.reconcile(), 'unresolved');
 assert.equal(await unknown.runner.reconcile({force: true}), 'forced');
 unknown.runner.resume();
 assert.equal(sends, 2);
});

test('a queued command blocks further actions until the bridge reports its result', async t => {
 let result = {status: 'queued'};
 const sent = [];
 const {runner} = await setup(t, {
  send: async command => { sent.push(command); return {command_id: command.command_id, status: sent.length === 1 ? 'queued' : 'executed'}; },
  lookup: async id => ({command_id: id, ...result})});
 assert.equal(await runner.step(), 'queued');
 assert.equal(await runner.step(), 'uncertain', 'still queued: nothing new is sent');
 assert.equal(sent.length, 1);
 result = {status: 'executed'};
 assert.equal(await runner.step(), 'executed', 'resolved, then the next decision runs');
 assert.equal(sent.length, 2);
 assert.equal(runner.status.actions, 2);
});

test('limits pause the runner before a decision; the operator lock is exclusive', async t => {
 const {runner, sent, dir} = await setup(t, {usage: {requests: 10, inputTokens: 0}, limits: {maxRequests: 10}});
 assert.equal(await runner.step(), 'budget');
 assert.equal(runner.status.mode, 'paused');
 assert.equal(sent.length, 0);
 const release = await acquireOperatorLock(join(dir, 'operator.lock'));
 await assert.rejects(acquireOperatorLock(join(dir, 'operator.lock')), /exists/);
 await release();
 const again = await acquireOperatorLock(join(dir, 'operator.lock'));
 await again();
});

test('the decision limit pauses the runner once that many decisions were made', async t => {
 const {runner, sent} = await setup(t, {states: [{towers: 1, cash: 500}, {towers: 1, cash: 500}, {towers: 2, cash: 500}], limits: {maxDecisions: 1}});
 assert.equal(await runner.step(), 'executed');
 assert.equal(runner.status.decisions, 1);
 assert.equal(await runner.step(), 'budget');
 assert.equal(runner.status.mode, 'paused');
 assert.equal(sent.length, 1);
});

const timedOut = (source, endpoint) => new RequestError(`${source} timed out`, {source, endpoint, timeoutMs: 30000, timedOut: true});

test('a Jev timeout is a decision with no answer: nothing is sent, no pause, and the next step decides again', async t => {
 let calls = 0, clock = 0;
 const {runner, log, sent} = await setup(t, {now: () => clock, limits: {maxDecisions: 3}, decide: async () => {
  calls++;
  throw timedOut('jev', 'https://api.typesafe.ai/v1/systemone');
 }});
 assert.equal(await runner.step(), 'jev_timeout');
 assert.equal(await runner.step(), 'jev_timeout');
 assert.equal(runner.status.mode, 'running');
 assert.equal(sent.length, 0);
 assert.equal(runner.memory.lastFingerprint, null);
 const records = await readLog(log.file);
 assert.deepEqual(records.map(r => r.kind), ['jev_timeout', 'jev_timeout']);
 assert.equal(records[0].source, 'jev');
 assert.equal(records[0].endpoint, 'https://api.typesafe.ai/v1/systemone');
 assert.equal(records[0].timeout_ms, 30000);
 // The decision cap still applies to timed-out decisions.
 assert.equal(await runner.step(), 'jev_timeout');
 assert.equal(await runner.step(), 'budget');
 assert.equal(calls, 3);
 assert.equal(runner.status.cause.source, 'limit');
});

test('a timed-out bridge read is logged and does not pause; other errors pause and name their source', async t => {
 let fail = true;
 const {runner, log} = await setup(t, {observe: async () => {
  if (fail) throw timedOut('bridge_read', '/api/v1/state');
  return {towers: 1, cash: 500};
 }});
 assert.equal(await runner.step(), 'read_timeout');
 assert.equal(runner.status.mode, 'running');
 fail = false;
 assert.equal(await runner.step(), 'executed');
 const [first] = await readLog(log.file);
 assert.equal(first.kind, 'bridge_read_timeout');
 assert.equal(first.source, 'bridge_read');
 assert.equal(first.endpoint, '/api/v1/state');

 const http = await setup(t, {decide: async () => { throw new RequestError('TypeSafe HTTP 500; paused.', {source: 'jev', endpoint: 'u', timeoutMs: 30000}); }});
 assert.equal(await http.runner.step(), 'error');
 assert.equal(http.runner.status.mode, 'paused');
 assert.equal(http.runner.status.cause.source, 'jev');
 const [error] = await readLog(http.log.file);
 assert.equal(error.kind, 'error');
 assert.equal(error.source, 'jev');

 const bug = await setup(t, {decide: async () => { throw Error('bad state'); }});
 assert.equal(await bug.runner.step(), 'error');
 assert.equal((await readLog(bug.log.file))[0].source, 'runner');
});

test('a timed-out command is never resent: looked up by ID, and the runner pauses only when the lookup fails', async t => {
 let sends = 0;
 const found = await setup(t, {send: async () => { sends++; throw timedOut('bridge_command', '/api/v1/command'); },
  lookup: async id => ({command_id: id, status: 'executed'})});
 assert.equal(await found.runner.step(), 'executed');
 assert.equal(found.runner.status.mode, 'running');
 assert.equal(sends, 1);
 const lost = await setup(t, {send: async () => { sends++; throw timedOut('bridge_command', '/api/v1/command'); },
  lookup: async () => { throw timedOut('bridge_read', '/api/v1/commands/x'); }});
 assert.equal(await lost.runner.step(), 'uncertain');
 assert.equal(sends, 2);
 assert.equal(lost.runner.status.mode, 'paused');
 assert.equal(lost.runner.status.cause.source, 'bridge_command');
 assert.equal(lost.runner.status.cause.timeout_ms, 30000);
 assert.equal(await lost.runner.step(), 'uncertain');
 assert.equal(sends, 2);
 const uncertain = (await readLog(lost.log.file)).find(r => r.outcome === 'uncertain');
 assert.equal(uncertain.source, 'bridge_command');
 assert.equal(uncertain.endpoint, '/api/v1/command');
});
