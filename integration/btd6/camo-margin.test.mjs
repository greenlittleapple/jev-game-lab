import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runConfig} from './session.mjs';
import {defenceMargins, gradedSpeed, gradeFor, GRADE_AT, GRADE_AT_CAMO} from './speed.mjs';
import {camoCheck, heroLevel, roundCheck, towerEstimate} from './estimate.mjs';
import {setTowerTable, towerDataInfo, TOWER_DATA_VERSION} from './towers.mjs';
import {parseSpeedLabel} from './dashboard.mjs';
import {matchThresholds} from './pops-study.mjs';

const base = ['--policy', 'jev-v6', '--dry-run'];
const state = (round, towers, lives = 100) => ({in_game: true, match: {id: 'm', result: null, end_round: 80}, round: {number: round, lives_lost: 0}, lives, towers});
const dart = {id: 1, base_id: 'DartMonkey', tiers: [0, 0, 0], x: 0, y: 0}, ninja = {id: 2, base_id: 'NinjaMonkey', tiers: [0, 0, 0], x: 0, y: 0};

test('--camo-margin: the label graded:10+moab3+camo; graded:10+moab3 is unchanged', () => {
 const camo = runConfig([...base, '--speed', 'graded:10', '--moab-short-speed', '3', '--camo-margin'], {}).speed;
 assert.deepEqual([camo.label, camo.camoMargin, camo.moabShortSpeed], ['graded:10+moab3+camo', true, 3]);
 const plain = runConfig([...base, '--speed', 'graded:10', '--moab-short-speed', '3'], {}).speed;
 assert.deepEqual([plain.label, plain.camoMargin], ['graded:10+moab3', undefined]);
 assert.equal(runConfig([...base, '--camo-margin'], {}).speed.label, 'graded:10+camo');
 assert.throws(() => runConfig([...base, '--speed', '5', '--camo-margin'], {}), /graded speed/);
 // A flag without a value: the next option is still checked.
 assert.throws(() => runConfig([...base, '--camo-margin', '--nonsense'], {}), /Unknown option --nonsense/);
 assert.deepEqual(parseSpeedLabel('graded:10+moab3+camo'), {...parseSpeedLabel('graded:10+moab3'), camoMargin: true, label: 'graded:10+moab3+camo'});
});

test('defenceMargins with camo: pops is no more than the camo margin; the controller grades on GRADE_AT_CAMO', () => {
 const s = state(24, [dart, ninja]);
 const before = defenceMargins(s), withCamo = defenceMargins(s, [], {camo: true}), c = camoCheck(s.towers, 24, {lives: 100});
 assert.equal(before.camo, undefined);
 assert.equal(withCamo.camo, c.ratio);
 assert.equal(withCamo.pops, Math.min(roundCheck(s.towers, 24, {lives: 100, useReach: true}).ratio, c.ratio));
 // Only the Ninja sees camo: the camo margin counts its pops alone.
 assert.ok(c.ratio < camoCheck([dart, ninja, {...ninja, id: 3}], 24, {lives: 100}).ratio);
 assert.equal(camoCheck([dart], 1, {lives: 100}), null, 'no camo bloons, no camo margin');
 assert.deepEqual(GRADE_AT_CAMO, [[1.82, 'max'], [1.17, 5], [0.88, 3]]);
 assert.deepEqual([gradeFor(1.85, 10, GRADE_AT_CAMO), gradeFor(1.85, 10), gradeFor(0.9, 10, GRADE_AT_CAMO), gradeFor(0.9, 10)], [10, 5, 3, 1]);
 const margins = {round: 30, pops: 1.85, moab: null, margin: 1.85};
 const camo = gradedSpeed({max: 10, now: () => 0, options: {gradeAt: GRADE_AT_CAMO}}), plain = gradedSpeed({max: 10, now: () => 0});
 camo.observe(state(30, []), {margins}); plain.observe(state(30, []), {margins});
 assert.deepEqual([camo.speed, plain.speed], [10, 5]);
});

test('matchThresholds: the new margin\'s clean-round value at each base threshold\'s share', () => {
 const rows = list => list.map((margin, i) => ({run: 'r', round: i, lost: 0, margin}));
 const t = matchThresholds(rows([3, 2.5, 2, 1.5, 1.2, 0.9]), rows([2.4, 2, 1.6, 1.2, 1, 0.7]), [2, 1.3]);
 assert.deepEqual(t, [{base: 2, share: 0.5, threshold: 1.6}, {base: 1.3, share: 0.6667, threshold: 1.2}]);
 // Rounds that lost lives don't count.
 assert.deepEqual(matchThresholds([...rows([2]), {lost: 5, margin: 9}], rows([1]), [2]), [{base: 2, share: 1, threshold: 1}]);
 assert.ok(GRADE_AT_CAMO.every(([at, level], i) => level === GRADE_AT[i][1] && at > 0));
});

test('Quincy: the level from the first tier, as the state carries it; the v4 table keeps the name only', () => {
 const quincy = {id: 9, base_id: 'Quincy', tiers: [7, 0, 0], x: 0, y: 0};
 assert.equal(heroLevel(quincy), 7);
 assert.equal(heroLevel({...quincy, tiers: [0, 0, 0], name: 'Quincy 3'}), 3, 'a fake bridge hero at [0, 0, 0] falls back to the name');
 assert.equal(heroLevel({...quincy, level: 4}), 4);
 assert.deepEqual(towerEstimate(quincy), towerEstimate({base_id: 'Quincy', level: 7}));
 assert.notDeepEqual(towerEstimate(quincy), towerEstimate({base_id: 'Quincy', level: 1}));
 setTowerTable('v4');
 try {
  assert.deepEqual(towerEstimate(quincy), towerEstimate({base_id: 'Quincy', level: 1}), 'v4: no name, level 1 as before');
  assert.deepEqual(towerEstimate({...quincy, name: 'Quincy 7'}), towerEstimate({base_id: 'Quincy', level: 7}));
 } finally { setTowerTable('current'); }
});

test('Tower tables: towers.json counts shrapnel; btd6-jev-v4 keeps towers-v4.json and records it', () => {
 const sniper = {id: 5, base_id: 'SniperMonkey', tiers: [3, 2, 0], x: 0, y: 0};
 assert.equal(towerEstimate(sniper).pps, 37.7);
 assert.deepEqual(towerDataInfo(), {source: towerDataInfo().source, version: TOWER_DATA_VERSION});
 setTowerTable('v4');
 try {
  assert.equal(towerEstimate(sniper).pps, 12.6);
  assert.equal(towerDataInfo().table, 'v4');
  assert.notEqual(towerDataInfo().version, TOWER_DATA_VERSION);
 } finally { setTowerTable('current'); }
 assert.throws(() => setTowerTable('v9'), /No tower table/);
});

test('speed-replay: replayStates computes the camo margin when asked', async () => {
 const {replayStates, VARIANTS} = await import('./speed-replay.mjs');
 const records = [{time: new Date(0).toISOString(), kind: 'decision', state: state(24, [dart, ninja]), chosen: {id: 'wait'}, outcome: 'held'}];
 assert.equal(replayStates(records)[0].margins.camo, undefined);
 assert.equal(replayStates(records, {camo: true})[0].margins.camo, camoCheck([dart, ninja], 24, {lives: 100}).ratio);
 assert.equal(VARIANTS['moab_short at 3 + camo margin'].options.gradeAt, GRADE_AT_CAMO);
});
