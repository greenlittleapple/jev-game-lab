import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLog} from '../../core/runner.mjs';
import {readSeries, scoreRuns} from '../../core/scorecard.mjs';
import {DANGER_PROGRESS, KILL_MARGIN, compositionCap, dangerProgress, isEmergency, STEP_UP_MS, dangerSignals, defenceMargins, gradeFor, gradedLevels, gradedSpeed, moabOutrun, parseSpeedMode,
 withBetweenRounds} from './speed.mjs';
import {moabDps, MOAB_SPEED, DEFAULT_TRACK_LENGTH} from './moab.mjs';
import {createSession, runConfig, runSession, teeLog} from './session.mjs';
import {computeSpotCatalog} from './spot-catalog.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {parseSetup} from './lifecycle.mjs';
import {runOf, scoreRun, setupViews, speedVariant} from './progress.mjs';

const read = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
const none = {count: 0, furthest: null, moab_class: 0, moabs: []};
const st = ({round = 10, active = true, lives = 100, bloons = none, towers = [], result = null, id = 'm-1'} = {}) =>
 ({in_game: true, match: {id, result}, round: {number: round, active}, lives, bloons, towers, fast_forward: true, multiplier: 10});
const dart = {base_id: 'DartMonkey', tiers: [0, 0, 0], x: 0, y: 0};

test('--speed graded[:max] takes a maximum from 3 to 10; the levels are max, 5, 3 and 1', () => {
 assert.deepEqual(parseSpeedMode('graded'), {mode: 'graded', max: 10, levels: [10, 5, 3, 1], label: 'graded:10'});
 assert.deepEqual(parseSpeedMode('graded:6').levels, [6, 5, 3, 1]);
 assert.deepEqual(gradedLevels(4), [4, 3, 1]);
 assert.deepEqual(gradedLevels(3), [3, 1]);
 assert.throws(() => parseSpeedMode('graded:2'), /graded maximum must be from 3 to 10/);
 assert.throws(() => parseSpeedMode('graded:11'), /graded maximum/);
 assert.throws(() => parseSpeedMode('graded:5/1'), /graded or graded:<max>/);
 const c = runConfig(['--policy', 'jev-v4', '--dry-run', '--between-rounds'], {});
 assert.deepEqual([c.speed.mode, c.speed.betweenRounds, c.speed.label], ['graded', true, 'graded:10+between-rounds']);
 assert.equal(runConfig(['--policy', 'jev-v4', '--dry-run', '--speed', '5', '--between-rounds'], {}).speed.label, '5+between-rounds');
 assert.equal(runConfig(['--policy', 'jev-v4', '--dry-run'], {}).speed.betweenRounds, undefined);
});

test('the level from the margin: 2.0 or more max, 1.3 or more 5, 1.0 or more 3, below 1', () => {
 for (const [margin, level] of [[5, 10], [2.0, 10], [1.99, 5], [1.3, 5], [1.29, 3], [1.0, 3], [0.99, 1], [0, 1], [Infinity, 10], [null, 3]])
  assert.equal(gradeFor(margin, 10), level, `margin ${margin}`);
 assert.equal(gradeFor(1.5, 4), 4, 'never above the maximum');
 assert.equal(gradeFor(2.5, 3), 3);
});

test('a MOAB round is judged by its MOAB margin, not its category or its pops', () => {
 const towers = [{base_id: 'DartMonkey', tiers: [0, 2, 4], x: 0, y: 0}, {base_id: 'BombShooter', tiers: [2, 0, 3], x: 0, y: 0}, {base_id: 'TackShooter', tiers: [2, 0, 4], x: 0, y: 0}];
 const before = defenceMargins(st({round: 39, towers}));
 assert.equal(before.moab, null, 'round 39 has no MOAB-class bloon');
 assert.equal(before.margin, before.pops);
 const moab = defenceMargins(st({round: 40, towers}));
 assert.ok(moab.pops >= 2 && moab.moab < moab.pops, JSON.stringify(moab));
 assert.equal(moab.margin, moab.moab);
 // 1.83: the MOAB has to die before the exit (moab.mjs KILL_BY), so this plays at 5; with the first-half
 // requirement and / 0.8 it was 0.73 and played at 1.
 assert.equal(gradeFor(moab.margin, 10), 5);
 const short = defenceMargins(st({round: 40, towers: towers.slice(1)}));
 assert.ok(short.pops >= 2 && short.moab < 1, JSON.stringify(short));
 assert.equal(gradeFor(short.margin, 10), 1);
 // A round with Lead that no tower can pop counts as margin 0.
 assert.equal(defenceMargins(st({round: 28, towers: [dart]})).pops, 0);
});

test('danger signals: a bloon past the progress for the speed, lives lost this round, leak pressure, moab_short, a consult', () => {
 assert.deepEqual(dangerSignals(st()), []);
 // The furthest-bloon threshold drops with the speed: 0.5 at 10, 0.6 at 5, 0.7 at 3 and 1.
 const at = (speed, furthest) => dangerSignals({...st({bloons: {...none, count: 3, furthest}}), fast_forward: speed > 1, multiplier: speed});
 assert.deepEqual([dangerProgress(10), dangerProgress(7), dangerProgress(5), dangerProgress(3), dangerProgress(1), dangerProgress(null)], [0.5, 0.6, 0.6, 0.7, 0.7, 0.7]);
 assert.deepEqual(at(10, 0.5), [], 'at 0.5 exactly, at 10');
 assert.deepEqual(at(10, 0.51), ['bloons_past_0.5']);
 assert.deepEqual(at(5, 0.55), []);
 assert.deepEqual(at(5, 0.61), ['bloons_past_0.6']);
 assert.deepEqual(at(3, 0.65), []);
 assert.deepEqual(at(3, DANGER_PROGRESS), [], 'at 0.7 exactly, at 3');
 assert.deepEqual(at(1, 0.71), ['bloons_past_0.7']);
 assert.ok(isEmergency('bloons_past_0.5') && isEmergency('lives_lost') && !isEmergency('moab_short'));
 assert.deepEqual(dangerSignals(st(), {livesLost: 1}), ['lives_lost']);
 assert.deepEqual(dangerSignals(st(), {pressure: {active: true}}), ['leak_pressure']);
 assert.deepEqual(dangerSignals(st(), {moabShort: true}), ['moab_short']);
 assert.deepEqual(dangerSignals(st(), {consult: 'moab_window'}), ['consult:moab_window']);
 assert.deepEqual(dangerSignals(st({result: 'defeat'}), {livesLost: 3}), [], 'nothing after the result');
});

test('a MOAB-class bloon is danger when its time to kill, with the margin, exceeds its time to the exit', () => {
 const dps = moabDps([dart]);
 const exitAt = p => (1 - p) * DEFAULT_TRACK_LENGTH / MOAB_SPEED;
 const moab = (progress, health, type = 'Moab') => ({type, progress, health, max_health: 200});
 const with_ = list => st({towers: [dart], bloons: {...none, count: list.length, moab_class: list.length, furthest: list[0]?.progress ?? null, moabs: list}});
 // Kill time x KILL_MARGIN just under the time to exit: safe; just over: danger.
 const safe = dps * exitAt(0.5) / KILL_MARGIN * 0.95, unsafe = dps * exitAt(0.5) / KILL_MARGIN * 1.05;
 assert.equal(moabOutrun(with_([moab(0.5, safe)])), null);
 const hit = moabOutrun(with_([moab(0.5, unsafe)]));
 assert.equal(hit.type, 'Moab');
 assert.ok(hit.kill_s * KILL_MARGIN > hit.exit_s);
 assert.deepEqual(dangerSignals(with_([moab(0.5, unsafe)])), ['moab_outrun']);
 // No MOAB damage at all: any MOAB-class bloon is danger.
 assert.ok(moabOutrun(st({bloons: {...none, count: 1, moab_class: 1, furthest: 0.1, moabs: [moab(0.1, 200)]}})));
 // The bloon behind waits for the one ahead: alone it would be safe, after the first it isn't.
 const alone = dps * exitAt(0.45) / KILL_MARGIN * 0.9;
 assert.equal(moabOutrun(with_([moab(0.45, alone)])), null);
 assert.equal(moabOutrun(with_([moab(0.5, dps * 2), moab(0.45, alone)]))?.progress, 0.45);
 // A BFB's four MOABs count toward its time to kill.
 assert.equal(moabOutrun(with_([moab(0.1, 1, 'Moab')])), null);
 assert.ok(moabOutrun(with_([moab(0.1, 1, 'Bfb')])), 'a BFB with 800 health of MOABs inside');
 // A bridge before 0.3.11 lists no MOABs: no signal.
 assert.equal(moabOutrun(st({towers: [dart], bloons: {count: 1, moab_class: 1, furthest: 0.9}})), null);
});

test('graded control: drops at once, steps up one level at a time with a gap, and not while a danger signal is active', () => {
 let t = 0;
 const c = gradedSpeed({max: 10, now: () => t, calibrated: true});
 const m = margin => ({round: 10, pops: margin, moab: null, margin});
 assert.deepEqual(c.observe(st(), {margins: m(2.5)}).speed, 10, 'the first observation sets the level');
 t = 1000;
 assert.equal(c.observe(st(), {margins: m(2.5)}), null);
 const drop = c.observe(st(), {margins: m(2.5), danger: ['bloons_past_0.7']});
 assert.deepEqual([drop.speed, drop.reason], [1, 'drop: bloons_past_0.7']);
 // The danger clears, but the gap since the drop hasn't passed.
 t = 1000 + STEP_UP_MS - 1;
 assert.equal(c.observe(st(), {margins: m(2.5)}), null);
 t = 1000 + STEP_UP_MS;
 assert.equal(c.observe(st(), {margins: m(2.5)}).speed, 3, 'one level up');
 t += STEP_UP_MS;
 assert.equal(c.observe(st(), {margins: m(2.5), danger: ['lives_lost']}).speed, 1, 'lives lost drops again at once');
 t += 10 * STEP_UP_MS;
 assert.equal(c.observe(st(), {margins: m(2.5), danger: ['lives_lost']}), null, 'no step up while danger lasts');
 assert.equal(c.observe(st(), {margins: m(2.5)}).speed, 3);
 t += STEP_UP_MS;
 assert.equal(c.observe(st(), {margins: m(2.5)}).speed, 5);
 t += STEP_UP_MS;
 assert.equal(c.observe(st(), {margins: m(2.5)}), null, 'the cooldown after a danger drop keeps it at 5 in this round');
 assert.equal(c.observe(st({round: 13}), {margins: m(2.5)}), null, 'and the next three');
 const up = c.observe(st({round: 14}), {margins: m(2.5)});
 assert.equal(up.speed, 10);
 assert.match(up.reason, /^up: margin 2.5 for round 10 /);
 // A lower margin (a new round) drops straight to its level.
 t += 1;
 assert.equal(c.observe(st({round: 15}), {margins: m(1.1)}).speed, 3);
 t += STEP_UP_MS;
 assert.equal(c.observe(st({round: 15}), {margins: m(1.1)}), null, 'at its level: stays');
 // A new match starts again from its first observation.
 assert.equal(c.observe(st({id: 'm-2'}), {margins: m(0.5)}).speed, 1);
});

// A dry run on the simulated game (see adaptive-speed.test.mjs); game: fakeGame options.
async function dryRun(t, {speed = 'graded:10', clockStep = 1000, game = {}, onRead = null} = {}) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-graded-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = fakeGame({ticksPerRound: 4, ...game});
 let clock = 0, reads = 0;
 const state = fake.bridge.state;
 const bridge = {...fake.bridge, state: async () => { clock += clockStep; reads++; onRead?.(fake.game, reads); return state(); }};
 const usage = {requests: 0, inputTokens: 0}, limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9};
 const s = createSession({policy: 'btd6-jev-v4', setup: parseSetup('MonkeyMeadow/Hard/Standard'), limits, usage});
 const file = runLog(join(dir, 'run.jsonl')), series = runLog(join(dir, 'series.jsonl'));
 const outcome = await runSession({bridge, ask: fakeJev({usage, limits}), log: teeLog(file, s), series, session: s, setup: s.setup, policy: 'btd6-jev-v4',
  limits, usage, loadSpots: async () => computeSpotCatalog(fake.bridge), sleep: async () => {}, dryRun: true, speed, now: () => clock,
  timings: {pollMs: 0, pausedPollMs: 0, minIntervalMs: 0, lifecyclePollMs: 0, homeAfterResultMs: 50}});
 return {outcome, fake, events: await read(file.file), series: await read(series.file), dir};
}

test('a graded dry run sets its level from the margin, drops on danger, steps back up, and records the mode and time', {timeout: 60000}, async t => {
 const {outcome, fake, events, series, dir} = await dryRun(t);
 assert.equal(outcome.reason, 'ended');
 const sets = events.filter(e => e.kind === 'speed_set');
 assert.match(sets[0].reason, /^match_start: start: margin/);
 assert.equal(sets[0].mode, 'graded:10');
 assert.ok(sets[0].margins && 'pops' in sets[0].margins);
 // The fake's bloons pass 0.7 of the track late in each round.
 assert.ok(sets.some(e => e.speed === 1 && e.reason.startsWith('drop: ') && e.danger.includes('bloons_past_0.7')), 'a drop on danger');
 assert.ok(sets.some(e => e.reason.startsWith('up: ')), 'a step back up');
 for (const [a, b] of sets.slice(1).map((e, i) => [sets[i], e])) if (b.speed > a.speed) {
  assert.equal([10, 5, 3, 1].indexOf(b.speed), [10, 5, 3, 1].indexOf(a.speed) - 1, `one level up: ${a.speed} to ${b.speed}`);
 }
 assert.ok(sets.every(e => e.status === 'executed'));
 assert.deepEqual(fake.game.speeds.map(x => x.speed), sets.map(e => e.speed));
 // The session passes Monkey Meadow's hard-round list and the runner's purchases to the controller.
 const caps = new Set(sets.flatMap(e => e.cap ?? []));
 assert.ok(caps.has('hard_round') || caps.has('hard_round_next'), [...caps].join());
 assert.ok(caps.has('buying'), [...caps].join());
 assert.ok(!events.some(e => e.kind === 'warning'));
 assert.equal(events.find(e => e.kind === 'session_start').speed, 'graded:10');
 assert.equal(events.find(e => e.kind === 'run_start').speed, 'graded:10');
 assert.equal(series[0].speed, 'graded:10');
 assert.ok(events.filter(e => e.kind === 'speed_round').some(r => Object.keys(r.seconds).length > 1));
 assert.ok(fake.game.upgradeTiers?.length && fake.game.upgradeTiers.every(x => Array.isArray(x) && x.length === 3), 'upgrades carry expect.tiers');
 // Measured pops (bridge 0.3.13, logging only): one pops_round per round played, with the round's RBE and each tower's estimate.
 const popsRounds = events.filter(e => e.kind === 'pops_round');
 assert.ok(popsRounds.length > 3);
 assert.ok(popsRounds.every(r => r.match_id && Number.isFinite(r.rbe) && r.towers.every(t => Number.isInteger(t.pops) && t.pops >= 0 && 'est' in t && 'est_reach' in t)));
 assert.ok(popsRounds.some(r => r.pops > 0));
 assert.equal(new Set(popsRounds.map(r => r.round)).size, popsRounds.length, 'one record per round');
 assert.ok(events.filter(e => e.kind === 'decision').some(e => e.state?.towers?.some(t => Number.isInteger(t.pops))), 'the logged state keeps pops');
 const end = events.find(e => e.kind === 'run_end');
 assert.equal(end.speed_time.mode, 'graded:10');
 assert.equal(end.speed_time.changes, sets.length - 1);
 assert.equal(end.speed_time.adapting, true);
 assert.ok(end.speed_time.slow_s > 0 && end.speed_time.slow_s === end.speed_time.seconds[1]);
 const [row] = scoreRuns(events, await readSeries(join(dir, 'series.jsonl')), {runOf, score: scoreRun});
 assert.equal(row.speed, 'graded:10');
});

test('a person\'s speed change during a round stops graded speed for the rest of the match', {timeout: 60000}, async t => {
 let changed = false;
 const {outcome, events} = await dryRun(t, {game: {ticksPerRound: 12, bloonProgress: () => 0.2}, onRead: game => {
  const m = game.match;
  if (!changed && m && m.round.index + 1 === 12 && m.round.active && game.ticks === 8) { Object.assign(m, {fast_forward: true, multiplier: 7}); changed = true; }
 }});
 assert.equal(outcome.reason, 'ended');
 const warnings = events.filter(e => e.kind === 'warning');
 assert.equal(warnings.length, 1);
 assert.match(warnings[0].message, /to 7 during round 12.*Graded speed is off for the rest of the match/);
 assert.deepEqual(events.slice(events.indexOf(warnings[0])).filter(e => e.kind === 'speed_set'), []);
 assert.equal(events.find(e => e.kind === 'run_end').speed_time.adapting, false);
});

const purchase = e => e.kind === 'decision' && /^(place|upgrade):/.test(e.chosen?.id ?? '') && e.outcome !== 'cancelled';

test('between rounds: auto-start off at the start, purchases only while no round runs, each round started by the runner, auto-start restored', {timeout: 60000}, async t => {
 const {outcome, fake, events, series, dir} = await dryRun(t, {speed: withBetweenRounds(parseSpeedMode('graded:10')), game: {bloonProgress: () => 0.3}});
 assert.equal(outcome.reason, 'ended');
 const autos = events.filter(e => e.kind === 'auto_start_set');
 assert.deepEqual(autos.map(e => [e.enabled, e.reason, e.status, e.previous]), [[false, 'between_rounds', 'executed', true], [true, 'restore', 'executed', true]]);
 assert.deepEqual(fake.game.autoStarts.map(a => a.enabled), [false, true]);
 const bought = events.filter(purchase);
 assert.ok(bought.length > 3);
 assert.ok(bought.every(e => e.state.round.active === false), 'no purchase while a round runs');
 const starts = events.filter(e => e.kind === 'decision' && e.chosen?.id === 'start_round' && e.outcome === 'executed');
 const played = events.filter(e => e.kind === 'speed_round').length;
 assert.ok(played >= 5 && starts.length >= played, `${starts.length} rounds started, ${played} played`);
 assert.ok(!events.some(e => e.kind === 'warning'));
 assert.equal(events.find(e => e.kind === 'session_start').between_rounds, true);
 assert.equal(events.find(e => e.kind === 'run_start').speed, 'graded:10+between-rounds');
 assert.equal(series[0].speed, 'graded:10+between-rounds');
 const [row] = scoreRuns(events, await readSeries(join(dir, 'series.jsonl')), {runOf, score: scoreRun});
 assert.equal(row.speed, 'graded:10+between-rounds');
});

test('between rounds: an emergency during a round allows purchases', {timeout: 60000}, async t => {
 // From round 12 the bloons pass 0.7 of the track in every round.
 const {outcome, events} = await dryRun(t, {speed: withBetweenRounds(parseSpeedMode('graded:10')),
  game: {ticksPerRound: 6, bloonProgress: (tick, ticks, round) => round >= 12 && tick >= 2 ? 0.8 : 0.3}});
 assert.equal(outcome.reason, 'ended');
 const during = events.filter(purchase).filter(e => e.state.round.active);
 assert.ok(during.length > 0, 'purchases during a round');
 assert.ok(during.every(e => e.state.round.number >= 12));
});

test('graded and between-rounds runs are their own series in the chart and README table', () => {
 assert.deepEqual(['graded:10', 'graded:10+between-rounds', '5+between-rounds', 'adaptive:5/1', 5, null].map(speedVariant),
  ['graded', 'graded between rounds', 'between rounds', 'adaptive', '', '']);
 const data = {game: 'BTD6', unit: 'round', groups: [{id: 'jev', label: 'Jev only'}],
  setups: [{id: 'hard-standard', label: 'Hard Standard', match: 'Tutorial Hard Standard', start: 3, end: 80, lives: 100}],
  versions: [{name: 'v4', policy: 'btd6-jev-v4', group: 'jev', setup: 'hard-standard', added: 'MOAB check', runs: [
   {run: 'a', setup: 'hard-standard', result: 'won', value: 80, lives: 100, speed: 5},
   {run: 'b', setup: 'hard-standard', result: 'lost', value: 60, lives: 0, speed: 'graded:10'},
   {run: 'c', setup: 'hard-standard', result: 'lost', value: 70, lives: 0, speed: 'graded:10+between-rounds'},
   {run: 'd', setup: 'hard-standard', result: 'lost', value: 50, lives: 0, speed: 'adaptive:5/1'}]}]};
 const [{view}] = setupViews(data);
 assert.deepEqual(view.versions.map(v => [v.name, v.runs.map(r => r.run)]),
  [['v4', ['a']], ['v4 adaptive', ['d']], ['v4 graded', ['b']], ['v4 graded between rounds', ['c']]]);
 assert.match(view.versions[3].added, /graded game speed .* and between-rounds purchases/);
});

test('hard rounds, the round before one, the last rounds and buying cap the level; each cap is named', async () => {
 const {speedCaps, buyingNow, isPurchase, HARD_SPEED, HARD_LEAD_SPEED, BUYING_SPEED, END_ROUNDS} = await import('./speed.mjs');
 const hard = {rounds: new Map([[49, ['rbe_record:1.73']], [51, ['camo_layered:15']]])};
 const caps = (round, o = {}) => speedCaps(round, {calibrated: true, margins: {moab: null}, hard, endRound: 80, ...o}).map(x => `${x.reason}:${x.speed}`);
 assert.deepEqual([HARD_SPEED, HARD_LEAD_SPEED, BUYING_SPEED, END_ROUNDS], [3, 5, 5, 6]);
 assert.deepEqual(caps(47), []);
 assert.deepEqual(caps(48), ['hard_round_next:5']);
 assert.deepEqual(caps(49), ['hard_round:3']);
 assert.deepEqual(caps(50), ['hard_round_next:5']);
 assert.deepEqual(caps(51), ['hard_round:3']);
 assert.deepEqual(caps(48, {hardLeadSpeed: 3}), ['hard_round_next:3']);
 assert.deepEqual(caps(48, {hardLead: 0}), []);
 assert.deepEqual(caps(74), [], 'round 74 is before the last 6 of 80');
 assert.deepEqual(caps(75), ['end_rounds:3']);
 assert.deepEqual(caps(60, {buying: true}), ['buying:5']);
 assert.deepEqual(caps(60, {noMoabCap: true}), ['no_moab_estimate:5']);
 assert.deepEqual(speedCaps(49, {calibrated: true}), [], 'no list, no end round: no caps');
 // Buying: the last decision was a purchase that went to the game less than 3 s before.
 const buy = {chosen: {id: 'upgrade:5:p1'}, outcome: 'queued'}, wait = {chosen: {id: 'wait'}, outcome: 'held'};
 assert.equal(isPurchase(buy), true);
 assert.equal(isPurchase({...buy, outcome: 'stale_rejected'}), false);
 assert.equal(buyingNow(buy, 1000, 3999), true);
 assert.equal(buyingNow(buy, 1000, 4000), false);
 assert.equal(buyingNow(wait, 1000, 1500), false);
 assert.equal(buyingNow(null, -Infinity, 0), false);
});

test('graded:10 with the hard list: 10 in a comfortable round, 5 the round before a hard round, 3 in it, 3 in the last rounds', () => {
 let t = 0;
 const hard = {rounds: new Map([[51, ['camo_layered:15']]])};
 const c = gradedSpeed({max: 10, now: () => t, calibrated: true, hard});
 const s = round => ({in_game: true, match: {id: 'm', result: null, end_round: 80}, round: {number: round, active: true}});
 const m = {margin: 4, pops: 4, moab: null};
 assert.equal(c.observe(s(49), {margins: m}).speed, 10);
 t += 5000;
 assert.deepEqual(c.observe(s(50), {margins: {...m, round: 50}}), {speed: 5, reason: 'drop: margin 4 for round 50 (pops 4, moab -), cap 5: hard_round_next', cap: ['hard_round_next']});
 t += 5000;
 assert.equal(c.observe(s(51), {margins: m}).speed, 3);
 t += 5000;
 assert.equal(c.observe(s(52), {margins: m}).speed, 5, 'one level at a time');
 t += 5000;
 assert.deepEqual(c.observe(s(52), {margins: m, buying: true}), null, 'buying holds it at 5');
 t += 5000;
 assert.equal(c.observe(s(52), {margins: m}).speed, 10);
 t += 5000;
 assert.deepEqual(c.observe(s(75), {margins: m}).cap, ['end_rounds']);
});

test('moabShortSpeed: moab_short alone holds the level at that speed; any other danger still forces 1', () => {
 let t = 0;
 const c = gradedSpeed({max: 10, now: () => t, calibrated: true, options: {moabShortSpeed: 3}});
 const s = {in_game: true, match: {id: 'm', result: null, end_round: 80}, round: {number: 36, active: true}};
 const m = {round: 36, margin: 4, pops: 4, moab: null};
 assert.equal(c.observe(s, {margins: m}).speed, 10);
 assert.equal(c.observe(s, {margins: m, danger: ['moab_short']}).speed, 3);
 t += 5000;
 assert.equal(c.observe(s, {margins: m, danger: ['moab_short']}), null, 'held at 3, no step up');
 assert.equal(c.observe(s, {margins: m, danger: ['moab_short', 'lives_lost']}).speed, 1);
 t += 5000;
 assert.equal(c.observe(s, {margins: m, danger: ['moab_short']}).speed, 3, 'back up to 3 once only moab_short is left');
 const d = gradedSpeed({max: 10, now: () => 0, calibrated: true});
 assert.equal(d.observe(s, {margins: m, danger: ['moab_short']}).speed, 1, 'by default moab_short forces 1');
});

test('--moab-short-speed sets graded speed\'s level for moab_short alone and marks the speed label', async () => {
 const {runConfig} = await import('./session.mjs');
 const base = ['--policy', 'jev-v6', '--dry-run'];
 const three = runConfig([...base, '--speed', 'graded:10', '--moab-short-speed', '3'], {}).speed;
 assert.deepEqual([three.moabShortSpeed, three.label], [3, 'graded:10+moab3']);
 const one = runConfig([...base, '--speed', 'graded:10', '--moab-short-speed', '1'], {}).speed;
 assert.deepEqual([one.moabShortSpeed, one.label], [undefined, 'graded:10'], '1 is the default: no mark');
 assert.throws(() => runConfig([...base, '--speed', '5', '--moab-short-speed', '3'], {}), /graded speed/);
 assert.throws(() => runConfig([...base, '--speed', 'graded:3', '--moab-short-speed', '5'], {}), /at most the graded maximum/);
 assert.throws(() => runConfig([...base, '--speed', 'graded:10', '--moab-short-speed', '2'], {}), /1, 3 or 5/);
 assert.throws(() => runConfig([...base, '--speed', 'graded:10', '--moab-short-speed'], {}), /1, 3 or 5/, 'a missing level');
 // Without --speed the default (graded:10) takes it.
 assert.deepEqual(runConfig([...base, '--moab-short-speed', '3'], {}).speed.label, 'graded:10+moab3');
 // At graded:3 the level is allowed; moab_short alone then doesn't lower the speed.
 assert.equal(runConfig([...base, '--speed', 'graded:3', '--moab-short-speed', '3'], {}).speed.label, 'graded:3+moab3');
 // With --between-rounds the suffix stays last, and the run is in the graded between-rounds series.
 const both = runConfig([...base, '--speed', 'graded:10', '--moab-short-speed', '3', '--between-rounds'], {}).speed;
 assert.deepEqual([both.label, both.betweenRounds, both.moabShortSpeed], ['graded:10+moab3+between-rounds', true, 3]);
 assert.equal(speedVariant(both.label), 'graded between rounds');
 assert.equal(speedVariant(three.label), 'graded');
});

test('the session\'s graded controller takes the level for moab_short alone from the run config', async () => {
 const {speedControl} = await import('./session.mjs');
 const setup = parseSetup('MonkeyMeadow/Hard/Standard');
 const base = ['--policy', 'jev-v6', '--dry-run', '--speed', 'graded:10'];
 const s = {in_game: true, match: {id: 'm', result: null, end_round: 80}, round: {number: 47, active: true}};
 const m = {round: 47, margin: 4, pops: 4, moab: null};
 const control = argv => speedControl(runConfig(argv, {}).speed, {now: () => 0, calibrated: true, setup});
 const levelFor = (argv, danger) => {
  const c = control(argv);
  assert.equal(c.observe(s, {margins: m}).speed, 10, 'round 47 is not capped');
  return c.observe(s, {margins: m, danger})?.speed;
 };
 assert.equal(levelFor([...base, '--moab-short-speed', '3'], ['moab_short']), 3);
 assert.equal(levelFor([...base, '--moab-short-speed', '5'], ['moab_short']), 5);
 assert.equal(levelFor(base, ['moab_short']), 1, 'without the flag moab_short forces 1');
 assert.equal(levelFor([...base, '--moab-short-speed', '3'], ['moab_short', 'lives_lost']), 1, 'other danger still forces 1');
 const three = control(['--policy', 'jev-v6', '--dry-run', '--speed', 'graded:3', '--moab-short-speed', '3']);
 assert.equal(three.observe(s, {margins: m}).speed, 3);
 assert.equal(three.observe(s, {margins: m, danger: ['moab_short']}), null, 'graded:3 with moab 3: moab_short alone keeps 3');
 assert.equal(speedControl(runConfig(['--policy', 'jev-v6', '--dry-run', '--speed', '5'], {}).speed, {setup}), null, 'a fixed speed has no controller');
});

test('jumpHoldMs and stepUpMs (replay options): straight to the allowed level after a hold with no danger, or a shorter step', () => {
 let t = 0;
 const s = {in_game: true, match: {id: 'm', result: null, end_round: 80}, round: {number: 20, active: true}};
 const m = {round: 20, margin: 4, pops: 4, moab: null};
 const c = gradedSpeed({max: 10, now: () => t, calibrated: true, options: {jumpHoldMs: 1000}});
 assert.equal(c.observe(s, {margins: m}).speed, 10);
 assert.equal(c.observe(s, {margins: m, danger: ['leak_pressure']}).speed, 1);
 t = 5000;
 assert.equal(c.observe(s, {margins: m, danger: ['leak_pressure']}), null);
 t = 5500;
 assert.equal(c.observe(s, {margins: m}), null, 'the hold counts from the last danger seen');
 t = 6000;
 assert.equal(c.observe(s, {margins: m}).speed, 5, 'straight to the cooldown cap');
 t = 6000 + 60000;
 assert.equal(c.observe({...s, round: {number: 24, active: true}}, {margins: m}).speed, 10);
 t = 0;
 const d = gradedSpeed({max: 10, now: () => t, calibrated: true, options: {stepUpMs: 2000}});
 d.observe(s, {margins: m}); d.observe(s, {margins: m, danger: ['lives_lost']});
 t = 2000;
 assert.equal(d.observe(s, {margins: m}).speed, 3, 'one level after 2 s');
 t = 3999;
 assert.equal(d.observe(s, {margins: m}), null);
 t = 4000;
 assert.equal(d.observe(s, {margins: m}).speed, 5);
});
