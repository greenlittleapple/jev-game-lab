import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {startStatusServer, statusSnapshot} from './status-server.mjs';
import {createSession} from './session.mjs';
import {preRound} from './fixtures/index.mjs';

// node:http so the Host header can be set (fetch doesn't allow it).
const call = (port, path, {method = 'GET', headers = {}} = {}) => new Promise((resolve, reject) => {
 const req = request({host: '127.0.0.1', port, path, method, headers}, res => {
  let body = '';
  res.on('data', c => { body += c; });
  res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
 });
 req.on('error', reject);
 req.end();
});

function fakeSession() {
 const s = createSession({policy: 'btd6-jev-v0', setup: {map: 'Tutorial', difficulty: 'Hard', mode: 'Clicks'}, limits: {maxDecisions: 10, maxInputTokens: 1000}, usage: {requests: 2, inputTokens: 300}});
 const runner = {status: {mode: 'running', message: 'Running.', decisions: 2, actions: 1, uncertain: null}, pause: m => Object.assign(runner.status, {mode: 'paused', message: m}),
  resume: () => Object.assign(runner.status, {mode: 'running', message: 'Running.'}), reconcile: async () => 'clear'};
 Object.assign(s, {runner, state: preRound(), health: {version: '0.3.1', main_thread_pumping: true, unlock_all: true, mod_helper: {version: '3.6.8', sha256: 'abc'}}});
 s.record({kind: 'decision', decisionSource: 'jev', chosen: {id: 'start_round', label: 'Start round 3'}, outcome: 'executed', options: ['start_round', 'place:DartMonkey@S01'], state: {round: {number: 3}}, usage: {input_tokens: 150}});
 s.record({kind: 'dispatch', outcome: 'pending', command: {action: 'start_round', command_id: 'abc12345'}});
 s.record({kind: 'dispatch', outcome: 'executed', command_id: 'abc12345', result: {status: 'executed'}});
 return s;
}

test('the snapshot has bridge health, the match, the runner, usage against the caps and recent decisions', () => {
 const snap = statusSnapshot(fakeSession());
 assert.equal(snap.bridge.unlock_all, true);
 assert.equal(snap.match.setup, 'Tutorial Hard Standard');
 assert.equal(snap.match.round, 3);
 assert.deepEqual(snap.usage, {jev_requests: 2, input_tokens: 300});
 assert.deepEqual(snap.limits, {max_decisions: 10, max_input_tokens: 1000});
 assert.equal(snap.decisions[0].chosen, 'Start round 3');
 assert.deepEqual(snap.dispatches.map(d => [d.action, d.outcome]), [['start_round', 'executed'], ['start_round', 'pending']]);
});

test('the status page serves 127.0.0.1 only, and its buttons need the page token', async t => {
 const session = fakeSession();
 const server = await startStatusServer(session, {port: 0});
 t.after(() => server.close());
 const host = {Host: `127.0.0.1:${server.port}`};
 const page = await call(server.port, '/', {headers: host});
 assert.equal(page.status, 200);
 assert.ok(page.body.includes(server.token) && page.body.includes('<title>BTD6 runner</title>'));
 assert.match(page.headers['content-security-policy'], /default-src 'none'/);
 const status = JSON.parse((await call(server.port, '/api/status', {headers: host})).body);
 assert.equal(status.runner.mode, 'running');
 assert.equal((await call(server.port, '/api/status', {headers: {Host: `evil.example:${server.port}`}})).status, 403, 'another host name is refused');
 assert.equal((await call(server.port, '/api/pause', {method: 'POST', headers: host})).status, 403, 'no token');
 assert.equal((await call(server.port, '/api/pause', {method: 'POST', headers: {...host, 'X-Status-Token': 'wrong'}})).status, 403);
 assert.equal((await call(server.port, '/api/pause', {method: 'POST', headers: {...host, 'X-Status-Token': server.token, Origin: 'http://evil.example'}})).status, 403, 'a foreign origin');
 assert.equal((await call(server.port, '/api/pause', {method: 'POST', headers: {...host, 'X-Status-Token': server.token}})).status, 200);
 assert.equal(session.runner.status.mode, 'paused');
 assert.equal(session.held, true);
 assert.equal((await call(server.port, '/api/resume', {method: 'POST', headers: {...host, 'X-Status-Token': server.token}})).status, 200);
 assert.equal(session.runner.status.mode, 'running');
 assert.equal(session.held, false);
 const reconcile = await call(server.port, '/api/reconcile', {method: 'POST', headers: {...host, 'X-Status-Token': server.token}});
 assert.equal(JSON.parse(reconcile.body).reconcile, 'clear');
 assert.equal(server.server.address().address, '127.0.0.1');
});
