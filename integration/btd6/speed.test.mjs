import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runLog} from '../../core/runner.mjs';
import {readSeries, scoreRuns, table} from '../../core/scorecard.mjs';
import {GAME_FAST_FORWARD, observedSpeed, parseSpeed, speedCommand, speedKeeper, RESEND_MS} from './speed.mjs';
import {createSession, defaultSpeed, runConfig, runSession, teeLog} from './session.mjs';
import {computeSpotCatalog} from './spot-catalog.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {parseSetup} from './lifecycle.mjs';
import {runOf, runSpeed, scoreRun, SCORE_COLUMNS} from './progress.mjs';

const read = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
const match = (over = {}) => ({in_game: true, match: {id: 'm-1', result: null}, round: {number: 5}, fast_forward: true, multiplier: 3, ...over});

test('a speed is 1 to 10; 1 turns fast-forward off, 3 is the game\'s fast-forward, others set the multiplier', () => {
 assert.equal(parseSpeed('5'), 5);
 for (const bad of ['0.5', '11', 'fast', '', undefined]) assert.throws(() => parseSpeed(bad), /from 1 to 10/);
 const state = match();
 assert.deepEqual(speedCommand(state, 1, 'id-00000001'), {command_id: 'id-00000001', action: 'set_speed', fast_forward: false, expect: {match_id: 'm-1'}});
 assert.deepEqual(speedCommand(state, 3, 'id-00000002'), {command_id: 'id-00000002', action: 'set_speed', fast_forward: true, expect: {match_id: 'm-1'}});
 assert.deepEqual(speedCommand(state, 6, 'id-00000003'), {command_id: 'id-00000003', action: 'set_speed', fast_forward: true, multiplier: 6, expect: {match_id: 'm-1'}});
 assert.throws(() => speedCommand({in_game: false}, 3, 'id-00000004'), /Not in a match/);
 assert.equal(observedSpeed(match({fast_forward: false, multiplier: 6})), 1);
 assert.equal(observedSpeed(match({multiplier: 6})), 6);
 assert.equal(observedSpeed(match({multiplier: undefined})), GAME_FAST_FORWARD, 'a bridge before 0.3.4 reports no multiplier');
 assert.equal(observedSpeed({in_game: false}), null);
});

test('the runner defaults to graded:10 for every policy and takes a fixed --speed', () => {
 assert.equal(defaultSpeed('btd6-jev-v3'), 'graded:10');
 for (const policy of ['jev', 'jev-v1', 'jev-v2', 'jev-v3', 'jev-v4', 'claude-v1'])
  assert.deepEqual(runConfig(['--policy', policy, '--dry-run'], {}).speed, {mode: 'graded', max: 10, levels: [10, 5, 3, 1], label: 'graded:10'});
 assert.deepEqual(runConfig(['--policy', 'jev-v3', '--dry-run', '--speed', '1'], {}).speed, {mode: 'fixed', speed: 1, label: 1});
 assert.equal(runConfig(['--policy', 'jev-v3', '--speed', '8', '--dry-run'], {}).speed.speed, 8);
 assert.equal(runConfig(['--policy', 'jev-v4', '--speed', 'adaptive:8/3', '--dry-run'], {}).speed.label, 'adaptive:8/3');
 assert.throws(() => runConfig(['--policy', 'jev-v3', '--dry-run', '--speed', '12'], {}), /from 1 to 10/);
 assert.throws(() => runConfig(['--policy', 'jev-v3', '--dry-run', '--speed'], {}), /from 1 to 10/);
});

test('the keeper re-applies the speed once when the game resets it at a round start, and yields to a change during a round', () => {
 let clock = 0;
 const k = speedKeeper(3, {now: () => clock});
 assert.deepEqual(k.observe(match()), {}, 'at the target');
 clock = 10_000;
 assert.deepEqual(k.observe(match({round: {number: 6}, fast_forward: false})), {reapply: true, observed: 1}, 'reset at the round start');
 k.applied();
 clock += 200;
 assert.deepEqual(k.observe(match({round: {number: 6}, fast_forward: false})), {}, 'the state catches up after set_speed');
 assert.deepEqual(k.observe(match({round: {number: 6}})), {});
 // A reset a moment after the round starts is still the game's.
 clock = 20_000;
 assert.deepEqual(k.observe(match({round: {number: 7}})), {});
 clock += 1000;
 assert.deepEqual(k.observe(match({round: {number: 7}, fast_forward: false})), {reapply: true, observed: 1});
 k.applied();
 clock += 100;
 assert.deepEqual(k.observe(match({round: {number: 7}})), {});
 // A person changes it mid-round: one warning, then the runner leaves it.
 clock += 10_000;
 const changed = k.observe(match({round: {number: 7}, multiplier: 5}));
 assert.match(changed.warning, /changed from 3 to 5 during round 7; the runner had set 3/);
 clock += 10_000;
 assert.deepEqual(k.observe(match({round: {number: 8}, fast_forward: false})), {}, 'no re-apply after a person changed it');
 assert.deepEqual(speedKeeper(null).observe(match({fast_forward: false})), {}, 'no target: the speed is left alone');
});

test('a set_speed the game refused stays pending and is sent again until the game takes it', () => {
 let clock = 0;
 const k = speedKeeper(5, {now: () => clock});
 k.sent();
 assert.deepEqual(k.observe(match()), {}, 'not again within RESEND_MS');
 clock = RESEND_MS;
 assert.deepEqual(k.observe(match()), {resend: true, observed: 3});
 k.sent();
 clock = 60_000;
 assert.deepEqual(k.observe(match()), {resend: true, observed: 3}, 'still pending mid-round, and not taken as a person changing it');
 k.sent(); k.applied();
 clock += 100;
 assert.deepEqual(k.observe(match({multiplier: 5})), {});
 clock += 10_000;
 assert.deepEqual(k.observe(match({multiplier: 5})), {}, 'taken: nothing more to send');
});

// 2026-09-30, run 08-39-43 (bridge 0.3.11): round 49 started behind a Level Up screen; graded speed's 10 -> 5 and the
// round-start reapply 30 ms later were both refused with game_paused; the screens were dismissed and the game
// ran at 10x with nothing resending the 5x.
test('a speed change refused behind a Level Up screen is resent once the screen is closed', () => {
 let clock = 0;
 const k = speedKeeper(10, {now: () => clock});
 const at = (round, extra = {}) => match({round: {number: round}, multiplier: 10, ...extra});
 k.sent(); k.applied();
 clock += 100; assert.deepEqual(k.observe(at(48)), {});
 clock += 40_000;
 const levelUp = {popup: {kind: 'level_up', class: 'LevelUpScreen', scope: 'match'}, paused: true};
 // Round 49: the margin drops, graded retargets to 5 and sends it; refused (game_paused), so applied() isn't called.
 k.retarget(5); k.sent();
 clock += 30; assert.deepEqual(k.observe(at(49, levelUp)), {}, 'nothing is sent while the screen is open');
 clock += 600; assert.deepEqual(k.observe(at(49, {popup: {kind: 'xp_notice', class: 'XpNotice', scope: 'match'}})), {});
 clock += 400;
 assert.deepEqual(k.observe(at(49)), {resend: true, observed: 10}, 'screens closed, the game at 10x: 5 is sent again');
 k.sent(); k.applied();
 clock += 250; assert.deepEqual(k.observe(match({round: {number: 49}, multiplier: 5})), {});
 // A person's change later still yields.
 clock += 10_000;
 assert.match(k.observe(match({round: {number: 49}, multiplier: 3})).warning ?? '', /changed from 5 to 3/);
});

test('npm run btd6:bridge -- speed 3 --confirm sends set_speed with its match and prints the speed', async t => {
 const fake = fakeGame();
 Object.assign(fake.game, {popup: null, screen: 'menu'});
 await fake.bridge.command({command_id: 'start-0001', action: 'start_match', map: 'Tutorial', difficulty: 'Hard', mode: 'Standard', replace_saved: true});
 while (!(await fake.bridge.state().catch(() => null))?.in_game);
 const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const answer = await fake.fetch(`http://127.0.0.1${req.url}`, {method: req.method, body: body || undefined});
  res.writeHead(answer.status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(await answer.json()));
 });
 await new Promise(done => server.listen(0, '127.0.0.1', done));
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-speed-'));
 t.after(() => { server.close(); return rm(dir, {recursive: true, force: true}); });
 const cli = fileURLToPath(new URL('./bridge-cli.mjs', import.meta.url));
 const dispatchLog = join(dir, 'dispatch.jsonl');
 const run = args => promisify(execFile)(process.execPath, [cli, ...args], {env: {...process.env, BTD6_BRIDGE_PORT: String(server.address().port), BTD6_DISPATCH_LOG: dispatchLog}});
 const out = (await run(['speed', '3', '--confirm'])).stdout;
 assert.match(out, /"status": "executed"/);
 assert.deepEqual(JSON.parse(out.slice(out.lastIndexOf('{'))), {speed: 3, fast_forward: true, multiplier: 3});
 const fast = (await run(['speed', '7', '--confirm'])).stdout;
 assert.deepEqual(JSON.parse(fast.slice(fast.lastIndexOf('{'))), {speed: 7, fast_forward: true, multiplier: 7});
 const [pending] = await read(dispatchLog);
 assert.deepEqual(pending.command.expect, {match_id: 'dry-1'});
 assert.equal(pending.command.action, 'set_speed');
 const sent = (await read(dispatchLog)).filter(e => e.outcome === 'pending').map(e => [e.command.fast_forward, e.command.multiplier ?? null]);
 assert.deepEqual(sent, [[true, null], [true, 7]]);
 await assert.rejects(run(['speed', '3']), 'a change needs --confirm');
 await assert.rejects(run(['speed', '20', '--confirm']), /from 1 to 10/);
});

async function dryRun(t, {game = {}, speed = 3} = {}) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-speed-run-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = fakeGame({ticksPerRound: 4, ...game});
 const usage = {requests: 0, inputTokens: 0}, limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9};
 const s = createSession({policy: 'btd6-jev-v3', setup: parseSetup('MonkeyMeadow/Hard/Standard'), limits, usage});
 const file = runLog(join(dir, 'run.jsonl')), series = runLog(join(dir, 'series.jsonl'));
 const outcome = await runSession({bridge: fake.bridge, ask: fakeJev({usage, limits}), log: teeLog(file, s), series, session: s, setup: s.setup, policy: 'btd6-jev-v3',
  limits, usage, loadSpots: async () => (await computeSpotCatalog(fake.bridge)).spots, sleep: async () => {}, dryRun: true, speed,
  timings: {pollMs: 0, pausedPollMs: 0, minIntervalMs: 0, lifecyclePollMs: 0, homeAfterResultMs: 50}});
 return {outcome, fake, events: await read(file.file), series: await read(series.file), dir};
}

test('a dry run sets the speed after the match loads, records it, and sets it again when the game resets it', {timeout: 30000}, async t => {
 const {outcome, events, series, dir} = await dryRun(t, {game: {resetSpeedOnRound: true}, speed: 5});
 assert.equal(outcome.reason, 'ended');
 const sets = events.filter(e => e.kind === 'speed_set');
 assert.deepEqual([sets[0].reason, sets[0].speed, sets[0].status], ['match_start', 5, 'executed']);
 assert.ok(sets.slice(1).length >= 1 && sets.slice(1).every(e => e.reason.startsWith('round_start') && e.status === 'executed'), 'set again after the game reset it');
 const commands = events.filter(e => e.kind === 'dispatch' && e.command?.action === 'set_speed').map(e => e.command);
 assert.ok(commands.every(c => c.fast_forward === true && c.multiplier === 5));
 assert.ok(!events.some(e => e.kind === 'warning'), 'a reset at a round start is not a person\'s change');
 const start = events.find(e => e.kind === 'run_start');
 assert.equal(start.speed, 5);
 assert.deepEqual(start.conditions, {auto_start: true, fast_forward: true, multiplier: 5, speed: 5});
 assert.equal(events.find(e => e.kind === 'session_start').speed, 5);
 assert.equal(series[0].speed, 5);
 const [row] = scoreRuns(events, await readSeries(join(dir, 'series.jsonl')), {runOf, score: scoreRun});
 assert.equal(row.speed, 5);
 assert.match(table([row], SCORE_COLUMNS), /Speed/);
});

test('a dry run at speed 1 leaves fast-forward off; a run without a speed sends no set_speed', {timeout: 30000}, async t => {
 const slow = await dryRun(t, {speed: 1});
 assert.deepEqual(slow.events.filter(e => e.kind === 'speed_set').map(e => [e.reason, e.status]), [['match_start', 'executed']]);
 assert.equal(slow.events.find(e => e.kind === 'run_start').conditions.speed, 1);
 const none = await dryRun(t, {speed: null});
 assert.ok(!none.events.some(e => e.kind === 'speed_set' || e.command?.action === 'set_speed'));
 assert.equal(none.events.find(e => e.kind === 'run_start').speed, null);
});

test('runs before --speed are scored from the fast-forward they reported', () => {
 assert.equal(runSpeed({conditions: {auto_start: true, fast_forward: false}}), 1);
 assert.equal(runSpeed({conditions: {fast_forward: true}}), 3);
 assert.equal(runSpeed({speed: 6, conditions: {fast_forward: true, multiplier: 6}}), 6);
 assert.equal(runSpeed(null), null);
});

test('npm run btd6:bridge -- start-round --confirm sends start_round with the match and towers hash', async t => {
 const fake = fakeGame();
 Object.assign(fake.game, {popup: null, screen: 'menu'});
 await fake.bridge.command({command_id: 'start-0001', action: 'start_match', map: 'Tutorial', difficulty: 'Hard', mode: 'Standard', replace_saved: true});
 while (!(await fake.bridge.state().catch(() => null))?.in_game);
 fake.game.match.auto_start = false;
 const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const answer = await fake.fetch(`http://127.0.0.1${req.url}`, {method: req.method, body: body || undefined});
  res.writeHead(answer.status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(await answer.json()));
 });
 await new Promise(done => server.listen(0, '127.0.0.1', done));
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-start-round-'));
 t.after(() => { server.close(); return rm(dir, {recursive: true, force: true}); });
 const cli = fileURLToPath(new URL('./bridge-cli.mjs', import.meta.url));
 const dispatchLog = join(dir, 'dispatch.jsonl');
 const run = args => promisify(execFile)(process.execPath, [cli, ...args], {env: {...process.env, BTD6_BRIDGE_PORT: String(server.address().port), BTD6_DISPATCH_LOG: dispatchLog}});
 await assert.rejects(run(['start-round']), 'a change needs --confirm');
 const out = (await run(['start-round', '--confirm'])).stdout;
 assert.match(out, /"status": "executed"/);
 assert.equal(JSON.parse(out.slice(out.lastIndexOf('{'))).active, true);
 const [pending] = await read(dispatchLog);
 assert.equal(pending.command.action, 'start_round');
 assert.deepEqual(Object.keys(pending.command.expect).sort(), ['match_id', 'towers_hash']);
 assert.equal(typeof pending.command.expect.towers_hash, 'string');
 await assert.rejects(run(['start-round', '--confirm']), /is running/);
});
