import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request, createServer} from 'node:http';
import {mkdtemp, mkdir, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildView, currentSeries, logTail, parseSpeedLabel, runModel, historyScanner, liveTracker} from './dashboard.mjs';
import {dashboardConfig, dashboardSource, startDashboard} from './dashboard-server.mjs';
import {bridgeClient} from './bridge-client.mjs';
import {defenceMargins, gradeFor} from './speed.mjs';
import {setPopsCalibration} from './estimate.mjs';
import {setMoabCalibration} from './moab.mjs';
import {paths, rawRound21, round21} from './fixtures/index.mjs';

const tempDir = async () => mkdtemp(join(tmpdir(), 'btd6-dashboard-'));
const line = e => JSON.stringify(e) + '\n';
const setup = {map: 'Tutorial', difficulty: 'Hard', mode: 'Standard'};
const calibration = {moab: {factor: 1.27, source: 'pinned', stored: {factor: 0.74, source: 'measured (5 runs)'}}, pops: {factor: 1, from_round: 60, source: 'pinned'}};
// The records a v6 run writes, trimmed.
const runRecords = (match = '20260929T200000Z-1', state = round21()) => [
 {time: '2026-09-30T20:00:00.000Z', kind: 'session_start', dry_run: false, policy: 'btd6-jev-v6', setup, ruleset: 'btd6-open-v3', speed: 'graded:10+moab3', calibration, bridge: {version: '0.3.14'}},
 {time: '2026-09-30T20:00:01.000Z', kind: 'speed_set', match_id: match, round: 3, speed: 1, mode: 'graded:10+moab3', reason: 'match_start: start: margin 0 for round 3 (pops 0, moab -)', status: 'executed'},
 {time: '2026-09-30T20:00:02.000Z', kind: 'run_start', match_id: match, setup: {...setup, mode_name: 'Standard', start_round: 3, end_round: 80}, ruleset: {id: 'btd6-open-v3'}, speed: 'graded:10+moab3',
  bridge_version: '0.3.14', policy: 'btd6-jev-v6', policy_revision: 3, calibration, tower_data: {version: 'x'}},
 {time: '2026-09-30T20:05:00.000Z', kind: 'speed_set', match_id: match, round: 19, speed: 1, mode: 'graded:10+moab3', reason: 'drop: leak_pressure', status: 'executed'},
 {time: '2026-09-30T20:05:10.000Z', kind: 'decision', match_id: match, policy: 'btd6-jev-v6', decisionSource: 'jev', model: 'jev-1.13.0', usage: {input_tokens: 2000, output_tokens: 100},
  answer: {choice: 'place:BombShooter@S04', confidence: 0.4, probabilities: {'place:BombShooter@S04': 0.6, 'place:BombShooter@S05': 0.4}},
  group_answer: {choice: 'place:BombShooter', probabilities: {'place:BombShooter': 0.5, wait: 0.45, 'place:DartMonkey': 0.05}},
  constraint: {kind: 'rules', removed: 3, rules: [{kind: 'tower_cap', removed: 3, towers: 12, cap: 12}]}, tie_break: [{stage: 'group', kind: 'majority_wait', p_wait: 0.45, p_buy: 0.55, chosen_group: 'place:BombShooter'}],
  chosen: {id: 'place:BombShooter@S04', label: 'Place BombShooter at S04 ($405)'}, options: ['wait', 'place:BombShooter@S04', 'place:BombShooter@S05'], state, outcome: 'queued', result: {status: 'queued'}},
 {time: '2026-09-30T20:05:20.000Z', kind: 'pops_round', match_id: match, round: 20, rbe: 100, pops: 100, est: 120, est_reach: 110, lives_lost: 0, towers: [{id: 7, base_id: 'DartMonkey', pops: 100, est_reach: 110}]},
 {time: '2026-09-30T20:05:20.000Z', kind: 'speed_round', match_id: match, round: 20, seconds: {1: 10, 3: 20.5}, slow_s: 10},
];

test('the log tail reads whole lines, waits for a partial one, and follows a newer file', async () => {
 const dir = await tempDir();
 try {
  const tail = logTail(join(dir, 'missing'));
  assert.deepEqual(await tail.poll(), []);
  const t = logTail(dir);
  assert.deepEqual(await t.poll(), [], 'an empty directory');
  await writeFile(join(dir, '2026-09-30T20-00-00-000Z-a.jsonl'), '');
  assert.deepEqual((await t.poll()).map(p => [p.records.length, p.fresh]), [[0, true]], 'an empty log');
  await appendFile(join(dir, '2026-09-30T20-00-00-000Z-a.jsonl'), line({kind: 'x', n: 1}) + '{"kind":"x","n":');
  assert.deepEqual((await t.poll())[0].records.map(r => r.n), [1]);
  await appendFile(join(dir, '2026-09-30T20-00-00-000Z-a.jsonl'), '2}\nnot json\n');
  assert.deepEqual((await t.poll())[0].records.map(r => r.n), [2], 'the partial line once complete; a bad line skipped');
  // A new run mid-view: the old file's last records first, then the new file from the start.
  await appendFile(join(dir, '2026-09-30T20-00-00-000Z-a.jsonl'), line({kind: 'run_end', n: 3}));
  await writeFile(join(dir, '2026-09-30T20-10-00-000Z-b.jsonl'), line({kind: 'session_start', n: 4}));
  const out = await t.poll();
  assert.deepEqual(out.map(p => [p.file.slice(-7), p.fresh, p.records.map(r => r.n)]), [['a.jsonl', false, [3]], ['b.jsonl', true, [4]]]);
  assert.deepEqual(await t.poll(), [{file: '2026-09-30T20-10-00-000Z-b.jsonl', records: [], fresh: false}]);
 } finally { await rm(dir, {recursive: true, force: true}); }
});

test('speed labels read back as modes, with the moab_short level and between-rounds suffix', () => {
 assert.deepEqual([parseSpeedLabel('graded:10+moab3')].map(m => [m.mode, m.max, m.moabShortSpeed]), [['graded', 10, 3]]);
 assert.equal(parseSpeedLabel('graded:5').moabShortSpeed, 1);
 assert.equal(parseSpeedLabel('graded:10+moab5+between-rounds').betweenRounds, true);
 assert.equal(parseSpeedLabel('adaptive:5/1').mode, 'adaptive');
 assert.equal(parseSpeedLabel(5).speed, 5);
 assert.equal(parseSpeedLabel('nonsense'), null);
});

test('the view from a log alone: header, recomputed margins with the run\'s factors, caps, rounds and the decision feed', () => {
 const model = runModel('run.jsonl');
 for (const r of runRecords()) model.add(r);
 const v = buildView({run: model, bridge: {enabled: false, up: false}, paths, now: Date.parse('2026-09-30T20:05:11.000Z')});
 assert.equal(v.header.policy, 'btd6-jev-v6');
 assert.equal(v.header.revision, 3);
 assert.equal(v.header.speed, 'graded:10+moab3');
 assert.deepEqual([v.header.calibration.moab, v.header.calibration.pops, v.header.calibration.measured], [1.27, 1, true]);
 assert.equal(v.match.source, 'log');
 assert.equal(v.match.round, 21);
 // The same numbers the runner's own functions give with the same factors.
 setMoabCalibration(1.27); setPopsCalibration(1, {fromRound: 60});
 const direct = defenceMargins(round21(), paths);
 assert.deepEqual({round: v.speed.margins.round, pops: v.speed.margins.pops, moab: v.speed.margins.moab, margin: v.speed.margins.margin}, direct);
 assert.equal(v.speed.margins.grade, gradeFor(direct.margin, 10));
 // Cooldown from the logged danger drop in round 19, and buying from the purchase a second before.
 assert.ok(v.speed.caps.some(c => c.reason === 'cooldown'));
 assert.ok(v.speed.caps.some(c => c.reason === 'buying'));
 assert.equal(v.speed.danger_round, 19);
 assert.equal(v.rounds.rounds[0].round, 21);
 assert.equal(v.rounds.rounds.length, 6);
 assert.ok(v.rounds.rounds.every(r => r.known && r.check));
 const d = v.decisions.items[0];
 assert.equal(d.chosen.id, 'place:BombShooter@S04');
 assert.deepEqual(d.group.map(g => g.id), ['place:BombShooter', 'wait', 'place:DartMonkey']);
 assert.equal(d.constraint.rules[0].kind, 'tower_cap');
 assert.equal(d.overrides[0].kind, 'majority_wait');
 assert.equal(d.state, undefined, 'the feed carries no full state');
 assert.deepEqual(v.decisions.rules, {tower_cap: 1});
 assert.deepEqual(v.speed_log.time.seconds, {1: 10, 3: 20.5});
 assert.equal(v.measurements.pops_rounds[0].round, 20);
 assert.equal(v.plan.kind, 'none');
});

test('the hard-round and end-round caps come from the setup\'s list and the final rounds', () => {
 const model = runModel('run.jsonl');
 const late = {...round21(), round: {...round21().round, number: 78, index: 77}};
 for (const r of runRecords('m', late).slice(0, 3)) model.add(r);
 model.lastState = late;
 const v = buildView({run: model, bridge: null, paths});
 assert.ok(v.speed.caps.some(c => c.reason === 'end_rounds' && c.speed === 3));
 assert.equal(v.hard_source, 'Tutorial/Hard/Standard');
 assert.ok(v.rounds.rounds.at(-1).round <= 80);
});

test('an empty log and no bridge give an empty view without errors', () => {
 const v = buildView({run: null, bridge: {enabled: true, up: false, error: 'no answer'}});
 assert.equal(v.match, null);
 assert.equal(v.speed, null);
 assert.equal(v.decisions, null);
 assert.equal(v.bridge.up, false);
 const empty = buildView({run: runModel('empty.jsonl'), bridge: null});
 assert.equal(empty.match, null);
 assert.equal(empty.decisions.items.length, 0);
});

test('claude-v1 plans: the adopted plan, open requests and adoption latency', () => {
 const m = runModel('c.jsonl');
 m.add({kind: 'run_start', policy: 'btd6-claude-v1', match_id: 'm', setup, speed: 'graded:10'});
 m.add({kind: 'strategy_request', time: '2026-09-30T20:00:00.000Z', reason: 'match_start', request_id: 'r1', blocking: true});
 m.add({kind: 'strategy_adopted', time: '2026-09-30T20:00:04.000Z', reason: 'match_start', request_id: 'r1', latency_ms: 4000, late: false,
  plan: {summary: 'Darts then Bombs.', hero: {tower: 'Quincy', round_from: 3}, build: [], cash_hold: [], threats: [], review_round: 13}});
 m.add({kind: 'strategy_request', time: '2026-09-30T20:03:00.000Z', reason: 'threat_ahead', request_id: 'r2', blocking: false});
 const v = buildView({run: m, bridge: null});
 assert.equal(v.plan.kind, 'strategist');
 assert.equal(v.plan.plan.summary, 'Darts then Bombs.');
 assert.equal(v.plan.open.reason, 'threat_ahead');
 assert.deepEqual(v.plan.latency, {n: 1, median_ms: 4000, max_ms: 4000});
});

test('the series is the last run of start entries with the same speed, ruleset, bridge, setup and factors', () => {
 const start = (run, policy, speed = 'graded:10+moab3') => ({time: `2026-09-30T2${run}:00:00.000Z`, run: `r${run}`, policy, speed, ruleset: {id: 'btd6-open-v3'}, bridge_version: '0.3.14', setup, calibration});
 const s = currentSeries([start(0, 'btd6-jev-v6', 'graded:5'), start(1, 'btd6-jev-v6'), {kind: 'profile_check', run: 'r1'}, start(2, 'btd6-playbook-v5'), start(3, 'btd6-jev-v6')]);
 assert.equal(s.position, 3);
 assert.deepEqual(s.by_policy, {'btd6-jev-v6': 2, 'btd6-playbook-v5': 1});
 assert.equal(currentSeries([]), null);
});

test('history summaries come from each log\'s start and end records', async () => {
 const dir = await tempDir();
 try {
  const state = {...round21(), match: {...round21().match, result: 'defeat'}};
  await writeFile(join(dir, '2026-09-30T20-00-00-000Z-btd6-jev-v6.jsonl'), runRecords().map(line).join('')
   + line({kind: 'run_end', match_id: '20260929T200000Z-1', result: 'defeat', state, speed_time: {total_s: 600}})
   + line({kind: 'session_end', reason: 'ended', decisions: 5, usage: {inputTokens: 9000}}));
  const [h] = await historyScanner(dir)();
  assert.deepEqual([h.policy, h.result, h.round, h.lives, h.minutes, h.decisions, h.input_tokens], ['btd6-jev-v6', 'defeat', 21, 98, 10, 5, 9000]);
 } finally { await rm(dir, {recursive: true, force: true}); }
});

// node:http so the Host header can be set (fetch doesn't allow it).
const call = (port, path, {method = 'GET', host = `127.0.0.1:${port}`} = {}) => new Promise((resolve, reject) => {
 const req = request({host: '127.0.0.1', port, path, method, headers: {host}}, res => {
  let body = '';
  res.on('data', c => { body += c; });
  res.on('end', () => resolve({status: res.statusCode, body}));
 });
 req.on('error', reject);
 req.end();
});

// A read-only stand-in for the bridge's HTTP API: state, health and map. It records every request, so the test can
// check that the dashboard sent no command.
async function fakeBridgeServer(raw) {
 const seen = [];
 const server = createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`);
  const send = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); };
  if (req.method !== 'GET') return send(405, {error: 'no'});
  if (req.url === '/api/v1/health') return send(200, {version: '0.3.14', main_thread_pumping: true});
  if (req.url === '/api/v1/state') return send(200, raw);
  if (req.url === '/api/v1/map') return send(200, {map: 'Tutorial', paths: paths.map((p, i) => ({id: String(i), active: true, points: p.map(q => [q.x, q.y])}))});
  return send(404, {error: 'not found'});
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 return {port: server.address().port, seen, close: () => new Promise(r => server.close(r))};
}

test('the server reads the bridge with GET only, serves the view on 127.0.0.1, and refuses other hosts and methods', async () => {
 const dir = await tempDir();
 const runs = join(dir, 'runs');
 await mkdir(runs);
 const raw = rawRound21();
 raw.bloons = {count: 12, by_type: {Red: 12}, furthest: 0.8, moab_class: 0};
 const fake = await fakeBridgeServer(raw);
 let dash;
 try {
  await writeFile(join(runs, '2026-09-30T20-00-00-000Z-btd6-jev-v6.jsonl'), runRecords().map(line).join(''));
  await writeFile(join(dir, 'series.jsonl'), line({time: '2026-09-30T20:00:02.000Z', run: '20260929T200000Z-1', policy: 'btd6-jev-v6', speed: 'graded:10+moab3'}));
  const source = dashboardSource({runsDir: runs, bridge: bridgeClient({port: fake.port, timeoutMs: 1000})});
  dash = await startDashboard({source, port: 0, intervalMs: 50});
  const v = JSON.parse((await call(dash.port, '/api/view')).body);
  assert.equal(v.bridge.up, true);
  assert.equal(v.match.source, 'bridge');
  assert.equal(v.paths.count, 1);
  assert.ok(v.speed.danger.some(d => d.startsWith('bloons_past_')), 'the furthest bloon is past the threshold for 1x');
  assert.equal(v.header.series.position, 1);
  assert.equal((await call(dash.port, '/')).status, 200);
  assert.equal((await call(dash.port, '/api/view', {host: 'evil.example:80'})).status, 403);
  assert.equal((await call(dash.port, '/api/view', {method: 'POST'})).status, 405);
  // A new run appears mid-view.
  await writeFile(join(runs, '2026-09-30T21-00-00-000Z-btd6-playbook-v5.jsonl'), line({time: '2026-09-30T21:00:00.000Z', kind: 'session_start', policy: 'btd6-playbook-v5', setup, speed: 'graded:10'}));
  await new Promise(r => setTimeout(r, 200));
  const v2 = JSON.parse((await call(dash.port, '/api/view')).body);
  assert.equal(v2.header.policy, 'btd6-playbook-v5');
  assert.equal(v2.decisions.counts.decisions, 0);
  // The bridge goes down: the view falls back to the log and says so.
  await fake.close();
  await new Promise(r => setTimeout(r, 300));
  const v3 = JSON.parse((await call(dash.port, '/api/view')).body);
  assert.equal(v3.bridge.up, false);
  assert.ok(v3.bridge.error);
  assert.ok(fake.seen.every(r => r.startsWith('GET /api/v1/state') || r.startsWith('GET /api/v1/health') || r.startsWith('GET /api/v1/map')), fake.seen.join(', '));
 } finally {
  await dash?.close();
  await fake.close().catch(() => {});
  await rm(dir, {recursive: true, force: true});
 }
});

test('the leak and lives tracker counts lives lost in the round from its own reads', () => {
 const k = liveTracker();
 const s = round21();
 k.observe(s);
 const later = {...s, lives: s.lives - 4, round: {...s.round, lives_lost: null}};
 k.observe(later);
 assert.equal(k.livesLost(later), 4);
 assert.equal(k.pressure.status().active, true);
});

test('the command line: defaults, dry run without bridge reads, and bad options', () => {
 const c = dashboardConfig([], {});
 assert.equal(c.port, 4319);
 assert.equal(c.bridge, true);
 assert.equal(c.bridgePort, 15527);
 assert.match(c.runsDir.replaceAll('\\', '/'), /\.private\/btd6\/runs$/);
 const d = dashboardConfig(['--dry-run'], {});
 assert.equal(d.bridge, false);
 assert.match(d.runsDir.replaceAll('\\', '/'), /\.private\/btd6\/dry-run\/runs$/);
 assert.match(d.seriesFile.replaceAll('\\', '/'), /\.private\/btd6\/dry-run\/series\.jsonl$/);
 assert.equal(dashboardConfig(['--port', '5000', '--bridge-port', '16000'], {}).bridgePort, 16000);
 assert.throws(() => dashboardConfig(['--port', 'x'], {}), /port/);
 assert.throws(() => dashboardConfig(['--send'], {}), /Unknown option/);
});
