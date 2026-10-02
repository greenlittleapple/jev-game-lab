import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bridgePortFrom, logBridgePort, runLogName, runnerLockName} from './ports.mjs';
import {logTail, historyScanner, buildView} from './dashboard.mjs';
import {withFileLock} from '../../core/runner.mjs';
import {recordCalibration} from './moab-calibration.mjs';

test('the runner lock and run log keep their names on 15527 and carry the port on any other', () => {
 assert.equal(runnerLockName(15527), 'runner.lock');
 assert.equal(runnerLockName(undefined), 'runner.lock');
 assert.equal(runnerLockName(15528), 'runner-15528.lock');
 assert.equal(runnerLockName('15528'), 'runner-15528.lock');
 assert.equal(runLogName('T', 'btd6-jev-v4', 15527), 'T-btd6-jev-v4.jsonl');
 assert.equal(runLogName('T', 'btd6-jev-v4', 15528), 'T-btd6-jev-v4-port15528.jsonl');
 assert.equal(bridgePortFrom({}), 15527);
 assert.equal(bridgePortFrom({BTD6_BRIDGE_PORT: '15528'}), 15528);
 assert.throws(() => bridgePortFrom({BTD6_BRIDGE_PORT: 'x'}), /port number/);
 assert.equal(logBridgePort('a.jsonl', {bridge_port: 15528}), 15528);
 assert.equal(logBridgePort('a-port15528.jsonl', null), 15528);
 assert.equal(logBridgePort('a.jsonl', {kind: 'session_start'}), 15527);
});

const line = r => JSON.stringify(r) + '\n';
async function runsDir() {
 const dir = await mkdtemp(join(tmpdir(), 'btd6-ports-'));
 const runs = join(dir, 'runs');
 await mkdir(runs);
 // Oldest to newest: an old log without the field (15527), copy B's log, copy A's log, then copy B's newer log whose
 // name has no suffix (the field decides).
 await writeFile(join(runs, '2026-01-01-a.jsonl'), line({kind: 'session_start', policy: 'p'}) + line({kind: 'run_start', match_id: 'm0'}));
 await writeFile(join(runs, '2026-01-02-b-port15528.jsonl'), line({kind: 'session_start', bridge_port: 15528}) + line({kind: 'run_start', match_id: 'm1', bridge_port: 15528}));
 await writeFile(join(runs, '2026-01-03-a.jsonl'), line({kind: 'session_start', bridge_port: 15527}) + line({kind: 'run_start', match_id: 'm2', bridge_port: 15527}));
 await writeFile(join(runs, '2026-01-04-b.jsonl'), line({kind: 'session_start', bridge_port: 15528}) + line({kind: 'run_start', match_id: 'm3', bridge_port: 15528}));
 return {dir, runs};
}

test('the dashboard follows the newest run log of its bridge port; logs without the field count as 15527', async () => {
 const {dir, runs} = await runsDir();
 try {
  const fileOf = async port => (await logTail(runs, {bridgePort: port}).poll()).at(-1)?.file ?? null;
  assert.equal(await fileOf(15528), '2026-01-04-b.jsonl');
  assert.equal(await fileOf(15527), '2026-01-03-a.jsonl');
  assert.equal(await fileOf(16000), null);
  assert.equal(await fileOf(null), '2026-01-04-b.jsonl');
  // A newer log of the other copy doesn't move copy A's dashboard; a newer one of its own does.
  const a = logTail(runs, {bridgePort: 15527});
  await a.poll();
  await writeFile(join(runs, '2026-01-05-b-port15528.jsonl'), '');
  assert.deepEqual((await a.poll()).filter(p => p.fresh), []);
  await writeFile(join(runs, '2026-01-06-a.jsonl'), '');
  assert.equal((await a.poll()).find(p => p.fresh)?.file, '2026-01-06-a.jsonl');
  // The history lists every run from both copies with its port, and the series rows carry it too.
  const history = await historyScanner(runs)();
  assert.deepEqual(history.map(h => h.bridge_port), [15527, 15528, 15527, 15528, 15528, 15527]);
  const series = [{run: 'm2', time: '2026-01-03T00:00:00Z', policy: 'p'}, {run: 'm3', time: '2026-01-04T00:00:00Z', policy: 'p', bridge_port: 15528}];
  const view = buildView({history, series});
  assert.deepEqual(view.history.series.map(r => [r.run, r.bridge_port]), [['m3', 15528], ['m2', 15527]]);
 } finally { await rm(dir, {recursive: true, force: true}); }
});

test('the calibration update holds a short lock: two writers at once keep both runs', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'btd6-cal-'));
 try {
  const setup = {map: 'MonkeyMeadow', difficulty: 'Hard', mode: 'Standard'};
  const records = Array.from({length: 6}, (_, i) => ({round: 40 + i, ratio: 0.8 + i * 0.01, seconds: 30}));
  await Promise.all([recordCalibration(dir, setup, 'run-a', records), recordCalibration(dir, setup, 'run-b', records)]);
  const files = (await import('node:fs/promises')).readdir(dir);
  const json = (await files).filter(f => f.endsWith('.json'));
  assert.equal(json.length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(dir, json[0]), 'utf8')).runs.map(r => r.run).sort(), ['run-a', 'run-b']);
  assert.deepEqual((await files).filter(f => !f.endsWith('.json')), []);
  // A held lock is waited for, then taken; a stale one is removed.
  const file = join(dir, 'x.json');
  await writeFile(`${file}.lock`, '');
  const order = [];
  const waiting = withFileLock(file, async () => order.push('second'), {waitMs: 5});
  setTimeout(async () => { order.push('first'); await rm(`${file}.lock`); }, 30);
  await waiting;
  assert.deepEqual(order, ['first', 'second']);
  await writeFile(`${file}.lock`, '');
  assert.equal(await withFileLock(file, async () => 'taken', {staleMs: -1}), 'taken');
  await assert.rejects(access(`${file}.lock`));
  await writeFile(`${file}.lock`, '');
  await assert.rejects(withFileLock(file, async () => {}, {waitMs: 5, timeoutMs: 20}), /still held/);
 } finally { await rm(dir, {recursive: true, force: true}); }
});
