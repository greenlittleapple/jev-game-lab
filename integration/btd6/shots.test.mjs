// Screenshots (bridge 0.3.12): the endpoint through the client, the runner's triggers and --no-shots; the
// composition cap and the reads while a step waits (graded-speed safety).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {bridgeClient, isPng} from './bridge-client.mjs';
import {fakeGame, TINY_PNG} from './fake-bridge.mjs';
import {shotKeeper, MAX_TRIES} from './shots.mjs';
import {runConfig, stepWatching} from './session.mjs';
import {CAPPED_SPEED, compositionCap, gradedSpeed, speedCaps} from './speed.mjs';
import {hardRoundsFor} from './hard-rounds.mjs';
import {speedSeries} from './progress.mjs';

const json = (status, data) => ({ok: status < 300, status, json: async () => data});

test('the client reads a PNG from the screenshot endpoint and reports the bridge\'s refusals', async () => {
 const requests = [];
 const answers = [
  {ok: true, status: 200, arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.length)},
  json(429, {error: 'One screenshot per second; try again in 400 ms'}),
  json(503, {error: 'The game\'s main thread is not running frames'}),
  {ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('{"not":"a png"}').buffer},
 ];
 const client = bridgeClient({fetch: async url => { requests.push(url); return answers.shift(); }});
 const png = await client.screenshot(480);
 assert.ok(isPng(png) && png.equals(TINY_PNG));
 assert.match(requests[0], /\/api\/v1\/screenshot\?width=480$/);
 await assert.rejects(client.screenshot(), /HTTP 429 \(One screenshot per second/);
 await assert.rejects(client.screenshot(), /HTTP 503/);
 await assert.rejects(client.screenshot(), /not a PNG/);
 assert.match(requests[1], /width=960$/, 'default width');
});

test('the fake bridge serves one screenshot per second', async () => {
 let clock = 0;
 const fake = fakeGame({clock: () => clock});
 assert.ok(isPng(await fake.bridge.screenshot()));
 clock = 500;
 await assert.rejects(fake.bridge.screenshot(), /HTTP 429/);
 clock = 1000;
 assert.ok(isPng(await fake.bridge.screenshot()));
 assert.equal(fake.game.shots, 2);
});

const st = ({round = 5, lives = 100, lost = 0, popup = null, result = null, id = 'm-1'} = {}) =>
 ({in_game: true, match: {id, result}, round: {number: round, active: true, lives_lost: lost}, lives, popup, towers: []});

test('shots: every 10th round start, once per round with a leak, the result screen, after aiming; saved per run and logged', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-shots-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 let clock = 0, fail = 0;
 const logged = [];
 const bridge = {screenshot: async () => { if (fail > 0) { fail--; throw Error('Bridge /api/v1/screenshot: HTTP 429'); } return TINY_PNG; }};
 const k = shotKeeper({bridge, dir: join(dir, 'shots'), root: dir, log: {append: async e => logged.push(e)}, now: () => clock});
 const step = async s => { clock += 1000; return k.observe(s); };
 await step(st({round: 9}));
 await step(st({round: 10}));
 await step(st({round: 10}));
 await step(st({round: 11, lives: 98, lost: 2}));
 await step(st({round: 11, lives: 95, lost: 5}));
 k.request(st({round: 11}), 'aim_50');
 await step(st({round: 11, lives: 95}));
 await step(st({round: 12, lives: 0, popup: {kind: 'defeat'}, result: 'defeat'}));
 await step(st({round: 12, lives: 0, popup: {kind: 'defeat'}, result: 'defeat'}));
 await step(st({round: 12, lives: 0, popup: {kind: 'defeat'}, result: 'defeat'}));
 assert.deepEqual(logged.map(e => [e.round, e.reason]), [[10, 'round_10'], [11, 'leak'], [11, 'aim_50'], [12, 'defeat']]);
 assert.equal(logged[0].path, 'shots/m-1/10-round_10.png', 'relative to the root, one folder per run');
 assert.deepEqual((await readdir(join(dir, 'shots', 'm-1'))).sort(), ['10-round_10.png', '11-aim_50.png', '11-leak.png', '12-defeat.png']);
 assert.ok((await readFile(join(dir, 'shots', 'm-1', '12-defeat.png'))).equals(TINY_PNG));
 // A refused shot waits and is tried again; after MAX_TRIES it is logged as failed.
 fail = 1;
 await step(st({round: 20, id: 'm-2'}));
 assert.equal(logged.length, 4, 'refused, still queued');
 await step(st({round: 20, id: 'm-2'}));
 assert.deepEqual(logged.at(-1).reason, 'round_20');
 fail = MAX_TRIES;
 k.request(st({round: 20, id: 'm-2'}), 'aim_9');
 for (let i = 0; i < MAX_TRIES; i++) await step(st({round: 20, id: 'm-2'}));
 assert.match(logged.at(-1).error, /429/);
 // Nothing is taken more often than once a second.
 clock += 100;
 k.request(st({round: 20, id: 'm-2'}), 'aim_10');
 assert.equal(await k.observe(st({round: 20, id: 'm-2'})), null);
});

test('--no-shots turns screenshots off; --ruleset picks the ruleset', () => {
 assert.equal(runConfig(['--policy', 'jev-v4', '--dry-run'], {}).shots, true);
 assert.equal(runConfig(['--policy', 'jev-v4', '--dry-run', '--no-shots'], {}).shots, false);
 assert.equal(runConfig(['--policy', 'jev-v4', '--dry-run'], {}).ruleset.version, 2);
 assert.equal(runConfig(['--policy', 'jev-v4', '--dry-run', '--ruleset', 'btd6-open-v3'], {}).ruleset.version, 3);
 assert.throws(() => runConfig(['--policy', 'jev-v4', '--dry-run', '--ruleset', 'v7'], {}), /Unknown ruleset/);
});

test('composition cap: MOAB-class and RBE-spike rounds play at most at 5 until the MOAB calibration is measured', () => {
 assert.deepEqual(compositionCap(40), {speed: CAPPED_SPEED, reason: 'moab_class'});
 assert.deepEqual(compositionCap(49), {speed: CAPPED_SPEED, reason: 'rbe_spike'}, 'round 49, where both graded v5 runs leaked');
 assert.equal(compositionCap(41), null);
 assert.equal(compositionCap(40, {calibrated: true}), null);
 const st40 = {in_game: true, match: {id: 'm', result: null}, round: {number: 40, active: true}, fast_forward: true, multiplier: 10};
 const margins = {round: 40, pops: 3, moab: 3, margin: 3};
 const capped = gradedSpeed({max: 10, now: () => 0}).observe(st40, {margins});
 assert.deepEqual([capped.speed, capped.reason], [5, 'start: margin 3 for round 40 (pops 3, moab 3), cap 5: moab_class']);
 assert.equal(gradedSpeed({max: 10, now: () => 0, calibrated: true}).observe(st40, {margins}).speed, 10);
});

test('while a step waits, the state is read and watched every interval; a quick step is not watched', async () => {
 const seen = [];
 let reads = 0;
 const read = async () => ({n: ++reads});
 const slow = async () => { await delay(130); return 'executed'; };
 assert.equal(await stepWatching(slow, read, s => { seen.push(s.n); }, {intervalMs: 30}), 'executed');
 assert.ok(seen.length >= 2, `watched ${seen.length} times`);
 const quick = async () => 'idle';
 seen.length = 0;
 assert.equal(await stepWatching(quick, read, s => { seen.push(s.n); }, {intervalMs: 30}), 'idle');
 assert.equal(seen.length, 0);
 assert.equal(await stepWatching(slow, read, s => { seen.push(s.n); }, {intervalMs: 0}), 'executed', 'interval 0: no reads');
 assert.equal(seen.length, 0);
});

test('runs under another ruleset are their own series', () => {
 const v = {name: 'Jev v4', runs: [{speed: 5, round: 40}, {speed: 5, round: 30, ruleset: 'btd6-open-v2'}, {speed: 'graded:10', round: 51, ruleset: 'btd6-open-v2'}]};
 const series = speedSeries([v]);
 assert.deepEqual(series.map(s => [s.name, s.runs.length]), [['Jev v4', 1], ['Jev v4 (btd6-open-v2)', 1], ['Jev v4 (btd6-open-v2) graded', 1]]);
});

test('graded caps on the third graded v5 run (lost at round 51 from 99 lives at 10x): cooldown after a danger drop and the hard-round list', () => {
 // The logged sequence (2026-09-30 09:01 run): margins and danger per round as the session saw them.
 const seq = [
  [47, {round: 47, pops: 3.45, moab: null, margin: 3.45}, []],
  [48, {round: 48, pops: 3.92, moab: null, margin: 3.92}, []],
  [49, {round: 49, pops: 2.06, moab: null, margin: 2.06}, ['bloons_past_0.7', 'leak_pressure']],
  [50, {round: 50, pops: 2.68, moab: 1.91, margin: 1.91}, []],
  [51, {round: 51, pops: 4.05, moab: null, margin: 4.05}, []],
 ];
 for (const calibrated of [false, true]) {
  let t = 0;
  const c = gradedSpeed({max: 10, now: () => t, calibrated, hard: hardRoundsFor({map: 'Tutorial', difficulty: 'Hard', mode: 'Standard'})});
  let speed = null;
  const changes = [];
  for (const [round, margins, danger] of seq) for (let i = 0; i < 4; i++) {
   t += 5000;
   const change = c.observe({in_game: true, match: {id: 'm', result: null}, round: {number: round, active: true}}, {margins, danger: i === 0 ? danger : []});
   if (change) { speed = change.speed; changes.push({round, ...change}); }
  }
  // The logged run went to 10x in round 48 and again in round 51; here nothing from round 48 on goes above 5.
  assert.ok(changes.filter(x => x.round >= 48).every(x => x.speed <= 5), JSON.stringify(changes));
  assert.deepEqual(changes.find(x => x.round === 48).cap, ['hard_round_next'], 'round 48 comes before hard round 49');
  assert.equal(speed, 3, 'round 51 is on the hard-round list');
  assert.ok(changes.filter(x => x.round === 49 && x.speed > 1).every(x => x.cap.includes('hard_round')), 'the climb after the drop is capped by the hard round');
  assert.deepEqual(changes.find(x => x.round === 51).cap, ['hard_round']);
 }
 assert.deepEqual(speedCaps(51, {dangerRound: 49, margins: {round: 51, moab: null}, noMoabCap: true}).map(x => x.reason), ['cooldown', 'no_moab_estimate'], 'round 51');
 // The rules one by one.
 assert.deepEqual(speedCaps(45, {calibrated: true, margins: {moab: 3}}), []);
 assert.deepEqual(speedCaps(45, {calibrated: true, margins: {moab: null}, noMoabCap: true}).map(x => x.reason), ['no_moab_estimate']);
 assert.deepEqual(speedCaps(45, {calibrated: true, margins: {moab: null}}), [], 'no_moab_estimate only when asked for (the replay)');
 assert.deepEqual(speedCaps(30, {calibrated: true, margins: {moab: null}, noMoabCap: true}), [], 'before round 40, no MOAB estimate needed');
 assert.deepEqual(speedCaps(33, {calibrated: true, dangerRound: 30, margins: {moab: 3}}).map(x => x.reason), ['cooldown']);
 assert.deepEqual(speedCaps(34, {calibrated: true, dangerRound: 30, margins: {moab: 3}}), [], 'three rounds after');
});
