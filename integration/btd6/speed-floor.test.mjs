// Graded speed's floor (--min-speed, label +min3): speed.mjs gradedSpeed minSpeed, session.mjs runConfig,
// dashboard.mjs parseSpeedLabel and speed-replay.mjs floorEstimate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gradedLevels, gradedSpeed} from './speed.mjs';
import {runConfig, speedControl} from './session.mjs';
import {parseSpeedLabel} from './dashboard.mjs';
import {floorEstimate, formatFloor, speedCauses} from './speed-replay.mjs';
import {parseSetup} from './lifecycle.mjs';

const s = (round = 36, id = 'm') => ({in_game: true, match: {id, result: null, end_round: 100}, round: {number: round, active: true}});
const m = (margin, round = 36) => ({round, margin, pops: margin, moab: null});
const HARD = ['lives_lost', 'bloons_past_0.5', 'moab_outrun', 'leak_pressure', 'consult:threat_ahead'];

test('floor 3: every path that set 1 sets 3 (margin below 1.0, each hard danger signal, moab_short at 1, the start)', () => {
 const minSpeed = 3; {
  const start = gradedSpeed({max: 10, now: () => 0, calibrated: true, options: {minSpeed}});
  const first = start.observe(s(), {margins: m(0.5)});
  assert.equal(first.speed, 3, 'the start with a margin below 1.0');
  assert.match(first.reason, /^start: .*floor 3$/);
  for (const d of [...HARD, 'moab_short']) {
   let t = 0;
   const c = gradedSpeed({max: 10, now: () => t, calibrated: true, options: {minSpeed, moabShortSpeed: 1}});
   assert.equal(c.observe(s(), {margins: m(4)}).speed, 10);
   const drop = c.observe(s(), {margins: m(4), danger: [d]});
   assert.equal(drop.speed, 3, d);
   assert.match(drop.reason, /floor 3$/, d);
   t += 10_000;
   assert.equal(c.observe(s(), {margins: m(4), danger: [d]}), null, `${d}: held at 3 while it lasts`);
   const startDanger = gradedSpeed({max: 10, now: () => 0, calibrated: true, options: {minSpeed}}).observe(s(), {margins: m(4), danger: [d]});
   assert.equal(startDanger.speed, 3, `${d} at the start`);
  }
  let t = 0;
  const c = gradedSpeed({max: 10, now: () => t, calibrated: true, options: {minSpeed}});
  assert.equal(c.observe(s(), {margins: m(4)}).speed, 10);
  assert.equal(c.observe(s(), {margins: m(0.9)}).speed, 3, 'a margin below 1.0 drops to 3');
  assert.equal(c.observe(s(), {margins: m(0)}), null, 'and no lower');
 }
});

test('floor 3: steps up to 5 and 10 as before, and caps above 3 still apply', () => {
 let t = 0;
 const c = gradedSpeed({max: 10, now: () => t, calibrated: true, options: {minSpeed: 3}});
 assert.equal(c.observe(s(), {margins: m(0.5)}).speed, 3);
 assert.equal(c.observe(s(), {margins: m(4)}), null, 'no step before STEP_UP_MS');
 t += 4000;
 assert.equal(c.observe(s(), {margins: m(4)}).speed, 5);
 t += 4000;
 assert.equal(c.observe(s(), {margins: m(4)}).speed, 10);
 t += 4000;
 assert.equal(c.observe(s(), {margins: m(4), danger: ['lives_lost']}).speed, 3);
 t += 4000;
 assert.deepEqual(c.observe(s(), {margins: m(4)}), {speed: 5, reason: 'up: margin 4 for round 36 (pops 4, moab -), cap 5: cooldown', cap: ['cooldown']}, 'cooldown cap 5');
 assert.deepEqual(gradedLevels(10, 3), [10, 5, 3]);
 assert.deepEqual(gradedLevels(3, 3), [3]);
 // With moab_short at 5 and the floor, moab_short alone plays at 5.
 const d = gradedSpeed({max: 10, now: () => 0, calibrated: true, options: {minSpeed: 3, moabShortSpeed: 5}});
 assert.equal(d.observe(s(), {margins: m(4), danger: ['moab_short']}).speed, 5);
});

test('floor 1 (the default): behaviour unchanged', () => {
 const run = options => {
  let t = 0;
  const c = gradedSpeed({max: 10, now: () => t, calibrated: true, options});
  const out = [];
  for (const [margin, danger] of [[0.5, []], [4, []], [4, []], [4, []], [4, ['lives_lost']], [4, ['moab_short']], [4, []], [0.9, []], [4, []]]) {
   out.push(c.observe(s(), {margins: m(margin), danger})); t += 4000;
  }
  return out;
 };
 assert.deepEqual(run({minSpeed: 1, moabShortSpeed: 3}), run({moabShortSpeed: 3}));
 assert.deepEqual(run({minSpeed: 1}).map(x => x?.speed ?? null), [1, 3, 5, 10, 1, null, 3, 1, 3]);
 assert.deepEqual(gradedLevels(10), [10, 5, 3, 1]);
});

test('--min-speed: the label +min3 after +camo, 1 leaves it unmarked; other values and non-graded speeds are refused', () => {
 const base = ['--policy', 'jev-v6', '--dry-run'];
 const full = runConfig([...base, '--speed', 'graded:10', '--moab-short-speed', '3', '--camo-margin', '--min-speed', '3'], {}).speed;
 assert.deepEqual([full.label, full.minSpeed, full.moabShortSpeed, full.camoMargin], ['graded:10+moab3+camo+min3', 3, 3, true]);
 assert.equal(runConfig([...base, '--speed', 'graded:10', '--min-speed', '3', '--between-rounds'], {}).speed.label, 'graded:10+min3+between-rounds');
 const one = runConfig([...base, '--speed', 'graded:10', '--min-speed', '1'], {}).speed;
 assert.deepEqual([one.label, one.minSpeed], ['graded:10', undefined]);
 for (const v of ['2', '5', '0', 'x']) assert.throws(() => runConfig([...base, '--speed', 'graded:10', '--min-speed', v], {}), /must be 1 or 3/, v);
 assert.throws(() => runConfig([...base, '--speed', 'graded:10', '--min-speed'], {}), /must be 1 or 3/, 'a missing level');
 assert.throws(() => runConfig([...base, '--speed', '5', '--min-speed', '3'], {}), /graded speed/);
 assert.throws(() => runConfig([...base, '--speed', 'adaptive:5/1', '--min-speed', '3'], {}), /graded speed/);
 // The session's controller takes the floor from the mode.
 const c = speedControl(full, {now: () => 0, calibrated: true, setup: parseSetup('MonkeyMeadow/Hard/CHIMPS')});
 assert.equal(c.observe(s(), {margins: m(0.2), danger: ['leak_pressure']}).speed, 3);
 // The dashboard reads the label back.
 const label = parseSpeedLabel('graded:10+moab3+camo+min3');
 assert.deepEqual([label.mode, label.max, label.moabShortSpeed, label.camoMargin, label.minSpeed], ['graded', 10, 3, true, 3]);
 assert.equal(parseSpeedLabel('graded:10+moab3+camo').minSpeed, undefined);
});

test('floorEstimate: time below the floor at the floor, game time unchanged; speedCauses limits at the floor', () => {
 const records = [{kind: 'session_start', time: 't', speed: 'graded:10+moab3+camo', setup: {mode: 'Clicks'}},
  {kind: 'run_end', result: 'defeat', speed_time: {seconds: {1: 300, 3: 60, 5: 60, 10: 0}}}];
 const e = floorEstimate(records, 3);
 assert.equal(e.minutes, 7);
 assert.equal(e.floor_minutes, (100 + 60 + 60) / 60);
 assert.deepEqual(Object.values(e.game_share).map(x => +x.toFixed(3)), [0.385, 0.231, 0.385, 0]);
 assert.equal(floorEstimate([{kind: 'session_start'}], 3), null);
 assert.match(formatFloor([{name: 'run-a', e}], 3), /1 matches: 7\.0 min logged .* 3\.7 min with floor 3 .*48% less\)\nreal time: 1x 71%/);
 const t = sec => new Date(Date.UTC(2026, 0, 1, 0, 0, sec)).toISOString();
 const c = speedCauses([{kind: 'session_start', speed: 'graded:10+min3'},
  {kind: 'speed_set', status: 'executed', time: t(0), speed: 3, reason: 'drop: lives_lost', danger: ['lives_lost'], round: 5},
  {kind: 'run_end', time: t(60)}]);
 assert.equal(c.climb, 0, 'at the floor already: no climb');
 assert.ok(Math.abs(c.causes.lives_lost - 0.7) < 1e-9);
});
