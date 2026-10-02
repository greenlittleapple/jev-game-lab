import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsBefore, replayRun, totals, formatReplay, pathsFor} from './moab-replay.mjs';
import {moabCheck, setMoabCalibration} from './moab.mjs';
import {meadowPaths} from './fixtures/index.mjs';

test('the requirement before 2026-09-30: the figures the logs recorded', () => {
 // Logged needs_dps in the v6 run: round 40 36, 64 197.4, 68 201.9, 73 189.1, 75 550 (100 lives).
 assert.deepEqual([40, 64, 68, 73, 75].map(r => needsBefore(r, {lives: 100})), [36.1, 197.4, 201.9, 189.1, 550.1]);
 assert.deepEqual([40, 64, 68, 73, 75].map(r => needsBefore(r, {lives: 100, paths: meadowPaths})), [36, 197.4, 201.9, 189.1, 550]);
 assert.equal(needsBefore(41), null);
 // Kill before the exit, no / 0.8: 2.5 times lower for a lone MOAB.
 assert.equal(+(needsBefore(40, {lives: 100, paths: meadowPaths}) / moabCheck([], 40, {lives: 100, paths: meadowPaths}).needs_dps).toFixed(1), 2.5);
 assert.equal(pathsFor('Tutorial').length, 1);
 assert.deepEqual(pathsFor('Elsewhere'), []);
});

test('replayRun: per round, the logged rule, short before and after, and lives lost', () => {
 setMoabCalibration(1);
 const sniper = tiers => ({base_id: 'SniperMonkey', tiers, x: 0, y: 0, targeting: 'First'});
 const state = (round, lives, towers) => ({in_game: true, match: {id: 'm', end_round: 80}, round: {number: round}, lives, towers});
 const rule = {constraint: {rules: [{kind: 'moab_short'}]}};
 // A Sniper 2-2-0 (4.4 MOAB damage per second) is short of round 40 before and after (36, 14.4 now); a 4-2-0
 // (18.9) only before.
 const records = [
  {kind: 'decision', ...rule, state: state(36, 100, [sniper([2, 2, 0])])},
  {kind: 'decision', ...rule, state: state(37, 100, [sniper([4, 2, 0])])},
  {kind: 'decision', state: state(38, 100, [sniper([4, 2, 0])])},
  {kind: 'decision', state: state(39, 90, [sniper([4, 2, 0])])},
  {kind: 'decision', state: state(40, 90, [sniper([4, 2, 0])])},
 ];
 const rows = replayRun(records, {paths: []});
 assert.deepEqual(rows.map(r => r.round), [36, 37, 38, 39, 40]);
 const [a, b, c] = rows;
 assert.deepEqual([a.rule, a.rule_before, a.rule_after, a.short_after], [true, true, true, [40]]);
 assert.deepEqual([b.rule, b.rule_before, b.rule_after, b.short_before, b.short_after], [true, true, false, [40], []]);
 assert.deepEqual([c.rule, c.any_before, c.any_after, c.leaked], [false, true, false, true], 'lives drop from 100 to 90 at round 39');
 const t = totals([{name: 'x', rows}]);
 assert.deepEqual([t.rule, t.rule_before, t.rule_after], [{rounds: 2, leaked: 1}, {rounds: 2, leaked: 1}, {rounds: 1, leaked: 0}], "round 37 counts the drop after round 38");
 assert.match(formatReplay([{name: 'x', factor: 1, rows}]), /Those states replayed, before: 2 rounds, 1 with lives lost that round or the next; after: 1 rounds/);
});

test('DDT replay: the DDT rounds measured, with the DDT-capable estimate, and the newly short due rounds', async () => {
 const {ddtReplay} = await import('./moab-replay.mjs');
 const T = (base_id, tiers) => ({base_id, tiers, x: 0, y: 0});
 const towers = [T('SuperMonkey', [5, 0, 0]), T('Druid', [4, 0, 0])];
 const state = round => ({in_game: true, round: {number: round}, lives: 1, match: {end_round: 100}, towers});
 const records = [{kind: 'run_start', calibration: {moab: {factor: 1}}},
  {kind: 'decision', state: state(88)}, {kind: 'decision', state: state(90)},
  {kind: 'moab_measure', round: 88, types: ['Moab'], measured_dps: 50, estimated_dps: 306.3, factor: 1},
  {kind: 'moab_measure', round: 90, types: ['DdtCamo'], measured_dps: 20, estimated_dps: 306.3, factor: 1.5}];
 const r = ddtReplay(records, {chimps: true});
 assert.deepEqual(r.measures.map(m => [m.round, m.measured, m.logged, m.logged_x, m.old, m.ddt, m.ddt_x]), [[90, 20, 306.3, 459.5, 306.3, 6.3, 9.4]]);
 assert.deepEqual(r.short.map(s => [s.round, s.due, s.old_short]), [[88, [90], false], [90, [90, 93], false]]);
});
