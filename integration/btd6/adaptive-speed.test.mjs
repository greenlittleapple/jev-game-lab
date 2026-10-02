import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLog} from '../../core/runner.mjs';
import {readSeries, scoreRuns, table} from '../../core/scorecard.mjs';
import {THREAT_ROUNDS, adaptiveSpeed, parseSpeedMode, speedClock, speedMode, speedTriggers} from './speed.mjs';
import {createSession, runSession, teeLog} from './session.mjs';
import {computeSpotCatalog} from './spot-catalog.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {parseSetup} from './lifecycle.mjs';
import {runOf, scoreRun, SCORE_COLUMNS, setupViews} from './progress.mjs';

const read = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
const none = {count: 0, furthest: null, moab_class: 0};
const st = ({round = 10, active = true, lives = 100, bloons = none, result = null, id = 'm-1', ff = true, multiplier = 5} = {}) =>
 ({in_game: true, match: {id, result}, round: {number: round, active}, lives, bloons, fast_forward: ff, multiplier});

test('--speed adaptive takes cruise 3 to 10 and pressure 1 or 3', () => {
 assert.deepEqual(parseSpeedMode('adaptive'), {mode: 'adaptive', cruise: 5, pressure: 1, label: 'adaptive:5/1'});
 assert.deepEqual(parseSpeedMode('adaptive:10/3'), {mode: 'adaptive', cruise: 10, pressure: 3, label: 'adaptive:10/3'});
 assert.deepEqual(parseSpeedMode('4'), {mode: 'fixed', speed: 4, label: 4});
 assert.throws(() => parseSpeedMode('adaptive:5/2'), /pressure speed must be 1/);
 assert.throws(() => parseSpeedMode('adaptive:2/1'), /cruise speed must be from 3 to 10/);
 assert.throws(() => parseSpeedMode('adaptive:11/1'), /cruise speed/);
 assert.throws(() => parseSpeedMode('adaptive:5'), /adaptive:<cruise>\/<pressure>/);
 assert.equal(speedMode(null), null);
 assert.equal(speedMode(3).speed, 3);
 assert.equal(speedMode('adaptive:6/1').cruise, 6);
});

test('threat rounds from rounds.json: first Camo, Purple, Lead and Fortified rounds, and every MOAB-class round', () => {
 assert.deepEqual(THREAT_ROUNDS[24], ['camo']);
 assert.deepEqual(THREAT_ROUNDS[25], ['purple']);
 assert.deepEqual(THREAT_ROUNDS[28], ['lead']);
 assert.deepEqual(THREAT_ROUNDS[40], ['moab_class']);
 assert.deepEqual(THREAT_ROUNDS[45], ['fortified']);
 for (const r of [60, 62, 80, 90, 100]) assert.ok(THREAT_ROUNDS[r].includes('moab_class'), `round ${r}`);
 for (const r of [10, 23, 26, 39]) assert.equal(THREAT_ROUNDS[r], undefined, `round ${r}`);
});

test('each slow-down trigger fires on its own fixture', () => {
 assert.deepEqual(speedTriggers(st()), []);
 assert.deepEqual(speedTriggers(st(), {livesLost: 2}), ['lives_lost']);
 assert.deepEqual(speedTriggers(st({bloons: {count: 5, furthest: 0.5, moab_class: 0}})), [], 'at 0.5 exactly');
 assert.deepEqual(speedTriggers(st({bloons: {count: 5, furthest: 0.51, moab_class: 0}})), ['bloons_past_half']);
 assert.deepEqual(speedTriggers(st({bloons: {count: 1, furthest: 0.1, moab_class: 1}})), ['moab_present']);
 assert.deepEqual(speedTriggers(st({round: 28, active: false})), ['threat_round:lead']);
 assert.deepEqual(speedTriggers(st(), {pressure: {active: true, reason: 'leaked_last_round'}}), ['leak_pressure']);
 assert.deepEqual(speedTriggers(st(), {pressure: {active: false}}), []);
 assert.deepEqual(speedTriggers(st(), {moabShort: true}), ['moab_short']);
 for (const reason of ['threat_ahead', 'big_leak', 'moab_window']) assert.deepEqual(speedTriggers(st(), {consult: reason}), [`consult:${reason}`]);
 for (const reason of ['match_start', 'review']) assert.deepEqual(speedTriggers(st(), {consult: reason}), [], reason);
 assert.deepEqual(speedTriggers(st({result: 'victory'}), {livesLost: 1}), [], 'nothing after the result');
});

test('adaptive control: slow on a trigger, stay slow to the round end, cruise after a clean round, one change per round each way', () => {
 const c = adaptiveSpeed({cruise: 5, pressure: 1});
 assert.equal(c.observe(st({round: 10}), []), null, 'starts at cruise');
 assert.deepEqual(c.observe(st({round: 10}), ['bloons_past_half']), {speed: 1, reason: 'bloons_past_half'});
 assert.equal(c.observe(st({round: 10}), []), null, 'the trigger cleared mid-round: stays slow');
 // Round 10 ends (automatic start moves to 11) with no lives lost and nothing active: back to cruise.
 assert.deepEqual(c.observe(st({round: 11}), []), {speed: 5, reason: 'round 10 ended with no lives lost and no trigger active'});
 assert.deepEqual(c.observe(st({round: 11}), ['moab_short']), {speed: 1, reason: 'moab_short'}, 'one slow-down in round 11');
 // Round 11 ends with lives lost: stays slow through round 12 even with nothing active.
 assert.equal(c.observe(st({round: 11, lives: 98}), ['lives_lost']), null);
 assert.equal(c.observe(st({round: 12, lives: 98}), []), null, 'lives were lost in round 11');
 assert.deepEqual(c.observe(st({round: 13, lives: 98}), []), {speed: 5, reason: 'round 12 ended with no lives lost and no trigger active'});
 // A trigger still active at the round end keeps it slow.
 assert.deepEqual(c.observe(st({round: 13, lives: 98}), ['bloons_past_half']), {speed: 1, reason: 'bloons_past_half'});
 assert.equal(c.observe(st({round: 14, lives: 98}), ['leak_pressure']), null);
 assert.deepEqual(c.observe(st({round: 15, lives: 98}), []), {speed: 5, reason: 'round 14 ended with no lives lost and no trigger active'});
});

test('adaptive control: a round that stops running ends it once; a second slow-down in a round only while lives are being lost', () => {
 const c = adaptiveSpeed({cruise: 6, pressure: 3});
 c.observe(st({round: 20}), []);
 assert.equal(c.observe(st({round: 20}), ['bloons_past_half']).speed, 3);
 assert.equal(c.observe(st({round: 20, active: false}), []).speed, 6, 'round 20 stopped running (no automatic start)');
 // Still round 20 between rounds: a new trigger doesn't slow it again in the same round...
 assert.equal(c.observe(st({round: 20, active: false}), ['leak_pressure']), null);
 // ...unless lives are being lost.
 assert.equal(c.observe(st({round: 20, active: false, lives: 99}), ['leak_pressure', 'lives_lost']).speed, 3);
 // Lives lost after round 20 stopped count toward round 21.
 assert.equal(c.observe(st({round: 21, lives: 99}), []), null);
 assert.equal(c.observe(st({round: 22, lives: 99}), []), null, 'lives were lost in round 21');
 assert.equal(c.observe(st({round: 23, lives: 99}), []).speed, 6);
 // A new match starts at cruise again.
 assert.equal(c.observe(st({round: 3, id: 'm-2'}), []), null);
 assert.equal(c.speed, 6);
 // cruise equal to pressure never changes.
 const flat = adaptiveSpeed({cruise: 3, pressure: 3});
 assert.equal(flat.observe(st(), ['lives_lost']), null);
});

test('the speed clock records the time at each speed per round and for the match', () => {
 let t = 0;
 const k = speedClock({now: () => t, slowAt: 1});
 assert.equal(k.observe(st({round: 5, multiplier: 5})), null);
 t = 4000;
 assert.equal(k.observe(st({round: 5, ff: false})), null);
 t = 6000;
 assert.deepEqual(k.observe(st({round: 6, multiplier: 5})), {round: 5, seconds: {5: 4, 1: 2}, slow_s: 2});
 t = 9000;
 k.observe(st({round: 6, multiplier: 5, result: 'victory'}));
 t = 20_000;
 k.observe(st({round: 6, result: 'victory'}));
 assert.deepEqual(k.totals(), {total_s: 9, seconds: {5: 7, 1: 2}, slow_s: 2}, 'no time counted after the result');
 assert.equal(speedClock({slowAt: null}).totals().slow_s, null, 'a fixed speed has no slow time');
});

// A dry run on the simulated game. clockStep: how far the session's clock moves on each state read, so the
// time at each speed and the round-start window (speed.mjs ROUND_RESET_MS) behave as in a live run.
async function dryRun(t, {speed = 'adaptive:5/1', clockStep = 1000, ticksPerRound = 4, onRead = null} = {}) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-adaptive-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = fakeGame({ticksPerRound});
 let clock = 0, reads = 0;
 const state = fake.bridge.state;
 const bridge = {...fake.bridge, state: async () => { clock += clockStep; reads++; onRead?.(fake.game, reads); return state(); }};
 const usage = {requests: 0, inputTokens: 0}, limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9};
 const s = createSession({policy: 'btd6-jev-v4', setup: parseSetup('MonkeyMeadow/Hard/Standard'), limits, usage});
 const file = runLog(join(dir, 'run.jsonl')), series = runLog(join(dir, 'series.jsonl'));
 const outcome = await runSession({bridge, ask: fakeJev({usage, limits}), log: teeLog(file, s), series, session: s, setup: s.setup, policy: 'btd6-jev-v4',
  limits, usage, loadSpots: async () => (await computeSpotCatalog(fake.bridge)).spots, sleep: async () => {}, dryRun: true, speed, now: () => clock,
  timings: {pollMs: 0, pausedPollMs: 0, minIntervalMs: 0, lifecyclePollMs: 0, homeAfterResultMs: 50}});
 return {outcome, fake, events: await read(file.file), series: await read(series.file), dir};
}

test('an adaptive dry run cruises, slows when bloons pass half the track, and records the time at each speed', {timeout: 60000}, async t => {
 const {outcome, fake, events, series, dir} = await dryRun(t);
 assert.equal(outcome.reason, 'ended');
 // The fake's bloons pass 0.5 of the track in every round, so each round slows once and the next speeds up.
 const sets = events.filter(e => e.kind === 'speed_set');
 assert.deepEqual([sets[0].reason, sets[0].speed, sets[0].mode], ['match_start', 5, 'adaptive:5/1']);
 assert.ok(sets.some(e => e.speed === 1 && e.reason.startsWith('slow: ') && e.reason.includes('bloons_past_half')));
 assert.ok(sets.some(e => e.speed === 5 && e.reason.startsWith('cruise: round ')));
 assert.ok(sets.every(e => e.status === 'executed'));
 // The fake bridge applied each one; at most one slow-down and one speed-up per round.
 assert.deepEqual(fake.game.speeds.map(x => x.speed), sets.map(e => e.speed));
 const perRound = {};
 for (const e of sets.slice(1)) { const key = `${e.round}:${e.speed}`; perRound[key] = (perRound[key] ?? 0) + 1; }
 assert.ok(Object.values(perRound).every(n => n === 1), JSON.stringify(perRound));
 assert.ok(!events.some(e => e.kind === 'warning'), 'the runner\'s own changes are not a person\'s');
 const start = events.find(e => e.kind === 'run_start');
 assert.equal(start.speed, 'adaptive:5/1');
 assert.equal(series[0].speed, 'adaptive:5/1');
 assert.equal(events.find(e => e.kind === 'session_start').speed, 'adaptive:5/1');
 const rounds = events.filter(e => e.kind === 'speed_round');
 assert.ok(rounds.length >= 5);
 assert.ok(rounds.some(r => r.seconds[5] > 0 && r.seconds[1] > 0 && r.slow_s === r.seconds[1]), JSON.stringify(rounds.slice(0, 3)));
 const end = events.find(e => e.kind === 'run_end');
 assert.equal(end.speed_time.mode, 'adaptive:5/1');
 assert.ok(end.speed_time.total_s > 0 && end.speed_time.slow_s > 0 && end.speed_time.slow_s < end.speed_time.total_s);
 assert.equal(end.speed_time.changes, sets.length - 1);
 assert.equal(end.speed_time.adapting, true);
 const [row] = scoreRuns(events, await readSeries(join(dir, 'series.jsonl')), {runOf, score: scoreRun});
 assert.equal(row.speed, 'adaptive:5/1');
 assert.equal(row.wall_min, Math.round(end.speed_time.total_s / 6) / 10);
 assert.equal(row.slow_min, Math.round(end.speed_time.slow_s / 6) / 10);
 assert.match(table([row], SCORE_COLUMNS), new RegExp(`${row.wall_min} \\(${row.slow_min} slow\\)`));
});

test('a person\'s speed change during a round stops adapting for the rest of the match', {timeout: 60000}, async t => {
 let changedAt = null;
 // A person turns fast-forward to 7 in the middle of round 12 (rounds of 12 reads, so well after the round start).
 const {outcome, fake, events} = await dryRun(t, {ticksPerRound: 12, onRead: (game, reads) => {
  const m = game.match;
  if (changedAt == null && m && m.round.index + 1 === 12 && m.round.active && game.ticks === 8) { Object.assign(m, {fast_forward: true, multiplier: 7}); changedAt = reads; }
 }});
 assert.equal(outcome.reason, 'ended');
 assert.ok(changedAt, 'the change happened');
 const warnings = events.filter(e => e.kind === 'warning');
 assert.equal(warnings.length, 1);
 assert.match(warnings[0].message, /changed from \d+ to 7 during round 12.*Adaptive speed is off for the rest of the match/);
 const after = events.slice(events.indexOf(warnings[0])).filter(e => e.kind === 'speed_set');
 assert.deepEqual(after, [], 'no set_speed after the person\'s change');
 assert.ok(fake.game.speeds.every(x => x.round <= 12));
 assert.equal(fake.game.match?.multiplier ?? 7, 7);
 const end = events.find(e => e.kind === 'run_end');
 assert.equal(end.speed_time.adapting, false);
 assert.ok(end.speed_time.seconds[7] > 0, 'time at the person\'s speed is still recorded');
});

test('a fixed-speed dry run records its time but no slow time; the progress chart keeps adaptive runs as their own series', {timeout: 60000}, async t => {
 const {events} = await dryRun(t, {speed: 3});
 assert.ok(events.filter(e => e.kind === 'speed_set').every(e => e.speed === 3 && !e.mode));
 const end = events.find(e => e.kind === 'run_end');
 assert.deepEqual([end.speed_time.mode, end.speed_time.slow_s, end.speed_time.changes], [3, null, undefined]);
 const data = {game: 'BTD6', unit: 'round', groups: [{id: 'jev', label: 'Jev only'}],
  setups: [{id: 'hard-standard', label: 'Hard Standard', match: 'Tutorial Hard Standard', start: 3, end: 80, lives: 100}],
  versions: [{name: 'v4', policy: 'btd6-jev-v4', group: 'jev', setup: 'hard-standard', added: 'MOAB check', runs: [
   {run: 'a', setup: 'hard-standard', result: 'lost', value: 30, lives: 0, speed: 3},
   {run: 'b', setup: 'hard-standard', result: 'lost', value: 35, lives: 0, speed: 'adaptive:5/1'}]}]};
 const [{view}] = setupViews(data);
 assert.deepEqual(view.versions.map(v => [v.name, v.runs.map(r => r.run)]), [['v4', ['a']], ['v4 adaptive', ['b']]]);
 assert.equal(view.tableNote(view.versions[1].runs[0]), 'speed adaptive:5/1');
});
