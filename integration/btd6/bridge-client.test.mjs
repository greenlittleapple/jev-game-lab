import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bridgeClient} from './bridge-client.mjs';
import {rawRound21} from './fixtures/index.mjs';

function fakeFetch(routes) {
 const calls = [];
 const fetch = async (url, init) => {
  calls.push({url, init});
  const [status, body] = routes[`${init.method} ${new URL(url).pathname}`] ?? [404, {error: 'Not found'}];
  return {ok: status < 400, status, json: async () => body};
 };
 return {fetch, calls};
}

test('state is normalized, commands are posted as JSON, and an unknown command ID is null', async () => {
 const {fetch, calls} = fakeFetch({
  'GET /api/v1/state': [200, rawRound21()],
  'POST /api/v1/command': [200, {command_id: 'c1', status: 'executed', tower_id: 12}],
  'GET /api/v1/commands/c1': [200, {command_id: 'c1', status: 'executed'}],
 });
 const bridge = bridgeClient({port: 15599, fetch});
 assert.equal((await bridge.state()).round.number, 21);
 assert.equal(calls[0].url, 'http://127.0.0.1:15599/api/v1/state');
 const command = {command_id: 'c1', action: 'place_tower', tower: 'DartMonkey', x: 1, y: 2, expect: {match_id: 'm', towers_hash: 'h'}};
 assert.deepEqual(await bridge.command(command), {command_id: 'c1', status: 'executed', tower_id: 12});
 assert.equal(calls[1].init.method, 'POST');
 assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
 assert.deepEqual(JSON.parse(calls[1].init.body), command);
 assert.deepEqual(await bridge.commandResult('c1'), {command_id: 'c1', status: 'executed'});
 assert.equal(await bridge.commandResult('c2'), null);
});

test('health reads without the game; placement checks go in batches of 400', async () => {
 const {fetch, calls} = fakeFetch({
  'GET /api/v1/health': [200, {name: 'Jev BTD6 Bridge', main_thread_pumping: true}],
  'POST /api/v1/placement-check': [200, {tower: 'DartMonkey', results: [{valid: true}]}],
 });
 const bridge = bridgeClient({fetch});
 assert.equal((await bridge.health()).main_thread_pumping, true);
 const points = Array.from({length: 450}, (_, i) => ({x: i, y: 0}));
 await bridge.placementCheck('DartMonkey', points);
 const sizes = calls.slice(1).map(c => JSON.parse(c.init.body).points.length);
 assert.deepEqual(sizes, [400, 50]);
});

test('HTTP errors throw with the bridge message; placement checks send point pairs', async () => {
 const {fetch, calls} = fakeFetch({
  'GET /api/v1/map': [409, {error: 'Not in a match'}],
  'POST /api/v1/placement-check': [200, {tower: 'DartMonkey', results: [{valid: true}]}],
 });
 const bridge = bridgeClient({fetch});
 await assert.rejects(bridge.map(), /HTTP 409 \(Not in a match\)/);
 await bridge.placementCheck('DartMonkey', [{id: 'S01', x: 5, y: -3}]);
 assert.deepEqual(JSON.parse(calls[1].init.body), {tower: 'DartMonkey', points: [[5, -3]]});
});

const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

test('a timed-out read is retried with backoff and reported; a timed-out command is not resent', async () => {
 let reads = 0, posts = 0;
 const retries = [], waits = [];
 const fetch = async (url, init) => {
  if (init.method === 'POST') { posts++; throw timeoutError(); }
  if (++reads < 3) throw timeoutError();
  return {ok: true, status: 200, json: async () => ({ok: true})};
 };
 const bridge = bridgeClient({port: 15599, fetch, timeoutMs: 100, onReadRetry: r => retries.push(r), sleep: async ms => { waits.push(ms); }});
 assert.deepEqual(await bridge.health(), {ok: true});
 assert.equal(reads, 3);
 assert.deepEqual(waits, [250, 500]);
 assert.deepEqual(retries.map(r => [r.source, r.endpoint, r.timeout_ms, r.attempt]), [['bridge_read', '/api/v1/health', 100, 1], ['bridge_read', '/api/v1/health', 100, 2]]);

 const error = await bridge.command({command_id: 'c1', action: 'place_tower'}).catch(e => e);
 assert.equal(posts, 1);
 assert.equal(error.source, 'bridge_command');
 assert.equal(error.endpoint, '/api/v1/command');
 assert.equal(error.timedOut, true);

 reads = -10;
 const read = await bridge.map().catch(e => e);
 assert.equal(reads, -7);
 assert.equal(read.source, 'bridge_read');
 assert.equal(read.timedOut, true);
 assert.match(read.message, /^Bridge \/api\/v1\/map: no answer/);
});
