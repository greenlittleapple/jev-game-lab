import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLog} from '../../core/runner.mjs';
import {createSession, runConfig, runSession, teeLog, steadyBridge} from './session.mjs';
import {computeSpotCatalog} from './spot-catalog.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {parseSetup} from './lifecycle.mjs';
import {readSeries, scoreRuns} from '../../core/scorecard.mjs';
import {runOf, scoreRun} from './progress.mjs';

const read = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
const instant = async () => {};
const timings = {pollMs: 0, pausedPollMs: 0, minIntervalMs: 0, lifecyclePollMs: 0, homeAfterResultMs: 50};
const SECRET = 'ts-test-secret-value';

test('run config: a live run needs --confirm, the TypeSafe key and both caps; the key never appears in a message', () => {
 const argv = ['--setup', 'MonkeyMeadow/Hard/CHIMPS', '--policy', 'jev', '--confirm'];
 const env = {TYPESAFE_API_KEY: SECRET, MAX_DECISIONS: '400', MAX_INPUT_TOKENS: '2000000'};
 const config = runConfig(argv, env);
 assert.deepEqual(config.setup, {map: 'Tutorial', difficulty: 'Hard', mode: 'Clicks', hero: 'Quincy'});
 assert.equal(config.policy, 'btd6-jev-v0');
 assert.deepEqual(config.limits, {maxDecisions: 400, maxRequests: 400, maxInputTokens: 2000000});
 assert.equal(config.statusPort, 4318);
 const refusals = [
  [argv, {...env, TYPESAFE_API_KEY: ''}, /TYPESAFE_API_KEY is not set/],
  [argv, {...env, MAX_DECISIONS: undefined}, /MAX_DECISIONS is not set/],
  [argv, {...env, MAX_INPUT_TOKENS: '-5'}, /MAX_INPUT_TOKENS must be a positive whole number/],
  [argv.filter(a => a !== '--confirm'), env, /--confirm/],
  [['--setup', 'MonkeyMeadow/Hard/CHIMPS', '--policy', 'strategist', '--confirm'], env, /--policy must be one of jev, jev-v0, jev-v1/],
  [['--setup', 'MonkeyMeadow/Hard', '--policy', 'jev', '--confirm'], env, /--setup is/],
  [[...argv, '--status-port', '4317'], env, /4317/],
  [[...argv, '--fast'], env, /Unknown option --fast/],
 ];
 for (const [a, e, pattern] of refusals) {
  assert.throws(() => runConfig(a, e), error => pattern.test(error.message) && !error.message.includes(SECRET));
 }
 const dry = runConfig(['--setup', 'MonkeyMeadow/Hard/CHIMPS', '--policy', 'jev', '--dry-run'], {});
 assert.equal(dry.dryRun, true);
 assert.equal(dry.apiKey, null, 'a dry run needs no key');
 assert.ok(dry.limits.maxDecisions > 0);
 assert.equal(dry.policy, 'btd6-jev-v0', '--policy jev stays the v0 baseline');
 assert.equal(runConfig(['--setup', 'MonkeyMeadow/Hard/CHIMPS', '--policy', 'jev-v1', '--dry-run'], {}).policy, 'btd6-jev-v1');
});

test('parseSetup takes <map>/<difficulty>/<mode> with the operator names', () => {
 assert.deepEqual(parseSetup('MonkeyMeadow/Medium/Standard'), {map: 'Tutorial', difficulty: 'Medium', mode: 'Standard', hero: 'Quincy'});
 assert.throws(() => parseSetup('Tutorial/Medium/Races'), /Use one of/);
});

async function session(t, {game = {}, limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9}, ...options} = {}) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-run-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = fakeGame(game);
 const usage = {requests: 0, inputTokens: 0};
 const s = createSession({policy: 'btd6-jev-v0', setup: parseSetup('MonkeyMeadow/Hard/CHIMPS'), limits, usage});
 const file = runLog(join(dir, 'run.jsonl')), series = runLog(join(dir, 'series.jsonl'));
 const run = runSession({bridge: fake.bridge, ask: fakeJev({usage, limits}), log: teeLog(file, s), series, session: s, setup: s.setup, limits, usage,
  loadSpots: async () => (await computeSpotCatalog(fake.bridge)).spots, timings, sleep: instant, dryRun: true, ...options});
 return {fake, s, run, usage, dir, logFile: file.file, seriesFile: series.file};
}

test('a dry run goes from the title screen to a lost CHIMPS match and back to the main menu, logging every step', {timeout: 30000}, async t => {
 const {fake, s, run, logFile, seriesFile, usage} = await session(t, {bridgePort: 15528});
 const outcome = await run;
 assert.equal(outcome.reason, 'ended');
 assert.equal(outcome.result, 'defeat');
 assert.equal(fake.game.match, null, 'back on the main menu');
 const events = await read(logFile);
 const kinds = events.map(e => e.kind);
 assert.equal(kinds[0], 'session_start');
 assert.equal(kinds.at(-1), 'session_end');
 // Every command's dispatch record is on disk before its result.
 const pending = events.filter(e => e.kind === 'dispatch' && e.outcome === 'pending');
 for (const p of pending) {
  const at = events.indexOf(p);
  const after = events.findIndex((e, i) => i > at && (e.command_id === p.command.command_id || e.result?.command_id === p.command.command_id));
  assert.ok(after > at, `${p.command.action} has a result after its pending record`);
 }
 const actions = pending.map(p => p.command.action);
 assert.deepEqual(actions.slice(0, 5), ['dismiss_popup', 'dismiss_popup', 'dismiss_popup', 'start_match', 'dismiss_popup'],
  'title screen, Modded Client notice (refused once as button_unavailable, then pressed), start, CHIMPS rules');
 assert.equal(pending[3].command.replace_saved, true, 'benchmark starts always replace a saved game');
 assert.equal(events.find(e => e.result?.reason === 'button_unavailable')?.outcome, 'rejected');
 assert.ok(actions.includes('place_tower') && actions.includes('start_round'));
 assert.equal(actions.at(-1), 'dismiss_popup', 'Home on the defeat screen');
 assert.equal(pending.at(-1).command.button, 'home');
 // Run metadata: ruleset, Mod Helper pin, unlock_all.
 const start = events.find(e => e.kind === 'run_start');
 assert.equal(start.ruleset.id, 'btd6-open-v2');
 assert.equal(start.unlock_all, true);
 assert.equal(start.mod_helper_pin.version, '3.6.8');
 assert.equal(start.mod_helper.sha256, start.mod_helper_pin.sha256);
 assert.equal(start.setup.mode_name, 'CHIMPS');
 const [entry, check] = await read(seriesFile);
 assert.equal(entry.run, start.match_id);
 assert.equal(entry.ruleset.id, 'btd6-open-v2');
 assert.equal(entry.mod_helper_pin.version, '3.6.8');
 // Code provenance from this checkout (provenance.mjs), the same in run_start and the series entry.
 for (const k of ['lab_commit', 'code_commit', 'code_dirty']) { assert.ok(k in start, `run_start has ${k}`); assert.equal(entry[k], start[k]); }
 assert.equal(entry.unlock_all, true);
 assert.equal(entry.label, 'btd6-jev-v0');
 // The bridge port (a second game copy): in session_start, run_start and the series entry.
 assert.deepEqual([events.find(e => e.kind === 'session_start').bridge_port, start.bridge_port, entry.bridge_port], [15528, 15528, 15528]);
 assert.equal(events.find(e => e.kind === 'run_end').result, 'defeat');
 // The saved profile: snapshots at the start and end, compared at the end, and nothing was written.
 assert.deepEqual(events.filter(e => e.kind === 'profile_snapshot').map(e => [e.at, e.profile.unlocked_towers.length]), [['start', 3], ['end', 3]]);
 assert.deepEqual(entry.profile_start.unlocked_heroes, ['Quincy']);
 assert.deepEqual([check.run, check.kind, check.status, check.profile_write], [start.match_id, 'profile_check', 'checked', false]);
 assert.ok(!events.some(e => e.kind === 'warning'));
 const decisions = events.filter(e => e.kind === 'decision');
 assert.ok(decisions.some(e => e.decisionSource === 'jev'), 'Jev chose among several options');
 assert.ok(decisions.filter(e => e.decisionSource === 'forced').length >= 2, 'the rules dialog and the defeat screen are forced steps');
 assert.equal(usage.requests, decisions.filter(e => e.decisionSource === 'jev').length);
 assert.equal(s.phase, 'finished');
 assert.ok(s.recent.decisions.length > 0 && s.recent.dispatches.length > 0);
});

test('a won match: Home on the victory screen ends the session', {timeout: 30000}, async t => {
 const {run} = await session(t, {game: {required: () => 0, endRound: 9}});
 const outcome = await run;
 assert.deepEqual([outcome.reason, outcome.result], ['ended', 'victory']);
});

test('the decision cap stops the run and leaves the match open', {timeout: 30000}, async t => {
 const limits = {maxDecisions: 3, maxRequests: 3, maxInputTokens: 1e9};
 const {run, fake, s, logFile} = await session(t, {limits});
 const outcome = await run;
 assert.equal(outcome.reason, 'limit');
 assert.ok(fake.game.match, 'the match is still open');
 assert.equal(s.runner.status.decisions, 3);
 const events = await read(logFile);
 assert.equal(events.find(e => e.kind === 'profile_check')?.status, 'checked', 'a match left open still gets its end-of-run check');
});

test('a tower, hero or upgrade added to the saved profile during a run is logged as a warning and flagged on the scorecard', {timeout: 30000}, async t => {
 const limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9};
 let fake = null;
 const jev = fakeJev({usage: {requests: 0, inputTokens: 0}, limits});
 const {run, logFile, seriesFile, fake: made} = await session(t, {ask: async payload => {
  if (!fake.game.profile.unlocked_towers.includes('SuperMonkey')) fake.game.profile.unlocked_towers.push('SuperMonkey');
  if (!fake.game.profile.acquired_upgrades.includes('Laser Blasts')) fake.game.profile.acquired_upgrades.push('Laser Blasts');
  fake.game.profile.tower_xp.DartMonkey += 50;
  return jev(payload);
 }});
 fake = made;
 assert.equal((await run).reason, 'ended');
 const events = await read(logFile);
 const check = events.find(e => e.kind === 'profile_check');
 assert.equal(check.profile_write, true);
 assert.deepEqual(check.writes, {towers: ['SuperMonkey'], heroes: [], upgrades: ['Laser Blasts']});
 assert.ok(check.changes.tower_xp.find(x => x.tower === 'DartMonkey').gained >= 50, 'tower XP is recorded, not flagged');
 assert.match(events.find(e => e.kind === 'warning').message, /towers: SuperMonkey.*upgrades: Laser Blasts/);
 const [row] = scoreRuns(events, await readSeries(seriesFile), {runOf, score: scoreRun});
 assert.equal(row.profile, 'WRITE (towers: SuperMonkey; upgrades: Laser Blasts)');
 assert.equal(row.label, 'btd6-jev-v0', 'the profile_check line does not replace the series entry of the run');
});

test('a Mod Helper other than the pinned one, an open match or an operator stop ends the run before play', {timeout: 30000}, async t => {
 const other = await session(t, {modHelperPin: {version: '3.6.9', sha256: 'f'.repeat(64)}});
 await assert.rejects(other.run, /not the pinned 3.6.9/);
 assert.equal(other.fake.game.requests.filter(r => r.path === '/api/v1/command').length, 0, 'nothing was sent');

 const open = fakeGame();
 open.game.screen = 'menu'; open.game.popup = null;
 await open.bridge.command({command_id: 'c1', action: 'start_match', map: 'Tutorial', difficulty: 'Hard', mode: 'Clicks', hero: 'Quincy', replace_saved: true});
 const opened = await session(t, {bridge: open.bridge});
 await assert.rejects(opened.run, /A match is already open/);

 const stopped = await session(t);
 stopped.s.held = true;
 stopped.s.stopRequested = true;
 await assert.rejects(stopped.run, /Stopped by the operator/);
 assert.equal(stopped.fake.game.requests.filter(r => r.path === '/api/v1/command').length, 0);
});

test('steadyBridge retries state reads while the game loads', async () => {
 let reads = 0;
 const bridge = steadyBridge({state: async () => { if (++reads < 3) throw Error('HTTP 503'); return {ok: true}; }}, {sleep: instant});
 assert.deepEqual(await bridge.state(), {ok: true});
 const failing = steadyBridge({state: async () => { throw Error('down'); }}, {tries: 2, sleep: instant});
 await assert.rejects(failing.state(), /down/);
});

// Replay of the live logs with bridge 0.3.6 (2026-09-30): the match read after start_match got one ID, and the
// bridge gave the same match a second ID about a second later. The session plays only the match it started:
// no second run_start, no decision or command for the other ID, and it ends with match_changed.
test('a match ID that changes after the start ends the session without a second run_start', {timeout: 30000}, async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-run-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = fakeGame();
 let inGameReads = 0;
 const bridge = {...fake.bridge, state: async () => {
  const state = await fake.bridge.state();
  if (state.in_game && ++inGameReads === 4) fake.game.match.id = `${state.match.id}-second`;
  return state.in_game && inGameReads >= 4 ? {...state, match: {...state.match, id: fake.game.match.id}} : state;
 }};
 const limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9}, usage = {requests: 0, inputTokens: 0};
 const s = createSession({policy: 'btd6-jev-v0', setup: parseSetup('MonkeyMeadow/Hard/CHIMPS'), limits, usage});
 const file = runLog(join(dir, 'run.jsonl'));
 const outcome = await runSession({bridge, ask: fakeJev({usage, limits}), log: teeLog(file, s), series: null, session: s, setup: s.setup, limits, usage,
  loadSpots: async () => (await computeSpotCatalog(fake.bridge)).spots, timings, sleep: instant, dryRun: true});
 assert.equal(outcome.reason, 'match_changed');
 const events = await read(file.file);
 const starts = events.filter(e => e.kind === 'run_start');
 assert.equal(starts.length, 1);
 assert.equal(starts[0].match_id, outcome.matchId);
 const other = fake.game.match.id;
 assert.ok(!events.some(e => e.kind !== 'session_end' && (e.match_id === other || e.command?.expect?.match_id === other)), 'nothing logged or sent for the other ID');
 assert.ok(events.some(e => e.kind === 'runner_paused' && e.message === 'Another match is open.'));
});

test('with shots on, the session saves screenshots under the run and logs them; with none, it takes none', {timeout: 30000}, async t => {
 let tick = 0;
 const on = await session(t, {game: {clock: () => (tick += 1000)}, shots: {dir: join(tmpdir(), `jev-btd6-shots-${process.pid}-${Date.now()}`), root: tmpdir()}});
 const outcome = await on.run;
 assert.equal(outcome.reason, 'ended');
 const shots = (await read(on.logFile)).filter(e => e.kind === 'screenshot');
 assert.ok(shots.length >= 1 && shots.every(e => e.path && !e.error), JSON.stringify(shots));
 assert.ok(shots.every(e => e.path.includes(`/${e.match_id}/`)));
 await rm(join(tmpdir(), shots[0].path.split('/')[0]), {recursive: true, force: true});
 const off = await session(t, {game: {clock: () => (tick += 1000)}});
 await off.run;
 assert.equal((await read(off.logFile)).filter(e => e.kind === 'screenshot').length, 0);
 assert.equal(off.fake.game.shots, 0);
});
