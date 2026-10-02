// MOAB damage calibration: the live measurement, the per-run and per-setup factor, the interim factor, and
// the factor applied to the estimate; an unaimed Mortar; plan targets and the adherence measure.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {moabMeter, loadCalibration, recordCalibration, runFactor, MIN_ROUNDS} from './moab-calibration.mjs';
import {moabDps, moabDpsRaw, moabCheck, setMoabCalibration, moabCalibration, towerMoab} from './moab.mjs';
import {reachFactor} from './estimate.mjs';
import {passedTargets} from './plan-v1.mjs';
import {planAdherence, SCORE_COLUMNS} from './progress.mjs';
import {parseSetup} from './lifecycle.mjs';
import {v0Round6, meadowPaths as paths, meadowSpot} from './fixtures/index.mjs';

const tower = (id, base_id, spot, tiers) => ({id, base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y, next_upgrades: []});
const towers = [tower(1, 'SniperMonkey', 'S05', [2, 0, 4]), tower(2, 'DartMonkey', 'S02', [0, 3, 2])];
function at(round, {active = true, moabs = [], lives = 100, fast_forward = false, result = null} = {}) {
 const s = v0Round6({cash: 0, lives, starting_lives: 100, towers, fast_forward, round: {index: round - 1, active, before_first_wave: false}});
 s.match = {...s.match, result, mode: 'Standard', end_round: 80, start_round: 3};
 s.bloons = {count: moabs.length, moabs};
 return s;
}

test('the meter follows the lead MOAB-class bloon: health drop over game time, a pop between reads, and the estimate beside it', () => {
 let clock = 0;
 const meter = moabMeter({paths, now: () => clock});
 const read = (s, ms = 1000) => { clock += ms; return meter.observe(s); };
 assert.deepEqual(read(at(40, {moabs: [{type: 'Moab', progress: 0.1, health: 200}]})), []);
 read(at(40, {moabs: [{type: 'Moab', progress: 0.2, health: 150}]}));
 read(at(40, {moabs: [{type: 'Moab', progress: 0.3, health: 100}]}));
 read(at(40, {moabs: []}));
 const [r] = read(at(41, {active: false}));
 // 50 + 50 over 2 s, then the last 100 popped within the next second: 200 over 3 s.
 assert.deepEqual([r.round, r.types, r.damage, r.seconds, r.measured_dps], [40, ['Moab'], 200, 3, 66.7]);
 assert.equal(r.estimated_dps, moabDpsRaw(towers, paths));
 assert.equal(r.ratio, +(66.7 / r.estimated_dps).toFixed(2));
 assert.ok(r.table_dps >= r.estimated_dps);
 // At 5x fast-forward one wall second is five game seconds; a leak drops its interval.
 const fast = moabMeter({paths, now: () => clock});
 clock += 1000; fast.observe(at(50, {fast_forward: true, moabs: [{type: 'Moab', progress: 0.5, health: 200}]}));
 const s = at(50, {fast_forward: true, moabs: [{type: 'Moab', progress: 0.6, health: 100}]}); s.multiplier = 5;
 clock += 1000; fast.observe(s);
 clock += 1000; fast.observe(at(50, {lives: 90, moabs: []}));
 const [f] = fast.finish();
 assert.deepEqual([f.damage, f.seconds], [100, 5]);
});

// The whole bloon summary as the bridge (0.3.11 on) sends it, through normalizeState like a live read. Before the
// fix, normalizing dropped bloons.moabs, so live runs logged no moab_measure (2026-09-30, rounds 40, 50 and 60).
test('a bridge-shaped state keeps bloons.moabs through normalizing, and the meter measures from it', () => {
 const raw = (health, progress) => ({count: 31, by_type: {Moab: 1, Ceramic: 30}, other_types: 0, camo: 0, regrow: 0, fortified: 0, moab_class: 1,
  furthest: progress, progress_p50: 0.1, progress_p75: 0.2, progress_p90: 0.3, moabs: health == null ? [] : [{type: 'Moab', progress, health, max_health: 200}]});
 const read = (round, bloons) => v0Round6({cash: 0, lives: 100, starting_lives: 100, towers, round: {index: round - 1, active: true, before_first_wave: false}, bloons});
 assert.deepEqual(read(40, raw(200, 0.1)).bloons.moabs, [{type: 'Moab', progress: 0.1, health: 200, max_health: 200}]);
 let clock = 0;
 const meter = moabMeter({paths, now: () => clock});
 for (const [health, progress] of [[200, 0.1], [150, 0.2], [100, 0.3]]) { clock += 1000; assert.deepEqual(meter.observe(read(40, raw(health, progress))), []); }
 clock += 1000; meter.observe(read(40, raw(null, 0.3)));
 clock += 1000;
 const [r] = meter.observe(read(41, raw(null, 0)));
 assert.deepEqual([r.round, r.damage, r.seconds], [40, 200, 3]);
});

test('the factor: a low quantile per run, the median of runs per setup, the interim hypothesis before any run', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-moab-cal-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const setup = parseSetup('MonkeyMeadow/Hard/Standard');
 const interim = await loadCalibration(dir, setup);
 assert.equal(interim.factor, 2);
 assert.match(interim.source, /interim/);
 const rec = ratio => ({ratio, seconds: 5});
 assert.equal(runFactor([rec(3), rec(3)]), null, `fewer than ${MIN_ROUNDS} rounds`);
 assert.deepEqual(runFactor([rec(4), rec(2.5), rec(3), rec(6), rec(2)]), {rounds: 5, factor: 2.5});
 assert.equal(await recordCalibration(dir, setup, 'm1', [rec(1)]), null);
 assert.equal(await recordCalibration(dir, setup, 'm1', [rec(3), rec(3), rec(3)]), 3);
 assert.equal(await recordCalibration(dir, setup, 'm2', [rec(4), rec(4), rec(4)]), 3.5);
 assert.equal(await recordCalibration(dir, setup, 'm3', [rec(9), rec(9), rec(9)]), 4, 'the median of three runs');
 assert.deepEqual(await loadCalibration(dir, setup), {factor: 4, source: 'measured (3 runs)', runs: 3});
 assert.equal((await loadCalibration(dir, parseSetup('MonkeyMeadow/Hard/CHIMPS'))).factor, 2, 'per setup');
});

test('the factor multiplies every MOAB damage estimate; an unaimed Mortar counts nothing', () => {
 const raw = moabDps(towers, paths);
 try {
  setMoabCalibration(2);
  assert.equal(moabCalibration(), 2);
  assert.equal(moabDps(towers, paths), +(raw * 2).toFixed(1));
  assert.equal(moabDpsRaw(towers, paths), raw);
  assert.equal(moabCheck(towers, 80, {lives: 96, paths}).dps, +(raw * 2).toFixed(1));
 } finally { setMoabCalibration(1); }
 assert.throws(() => setMoabCalibration(0), /above 0/);
 const mortar = tower(3, 'MortarMonkey', 'S01', [0, 3, 2]);
 // Placed with its reticle never set (the state reports targeting and no point): no credit (aim.mjs).
 const unaimed = {...mortar, targeting: 'TargetSelectedPoint', target_modes: ['TargetSelectedPoint'], target_point: null};
 assert.equal(towerMoab(unaimed, paths).share, 0);
 assert.deepEqual([reachFactor(unaimed, 30, paths).factor, reachFactor(unaimed, 30, paths).aim], [0, 'unaimed']);
});

test('plan targets are reported once when their round has passed; the adherence measure counts targets, holds and survival skips', () => {
 const plan = {hero: {tower: 'none', round_from: 3}, cash_hold: [], threats: [],
  build: [{id: 'snipe', tower: 'SniperMonkey', tiers: '2-0-4', count: 1, round_from: 30, round_by: 38, priority: 1},
   {id: 'darts', tower: 'DartMonkey', tiers: '0-4-2', count: 2, round_from: 30, round_by: 38, priority: 2}]};
 const reported = new Set();
 assert.deepEqual(passedTargets(plan, at(38), reported), []);
 const passed = passedTargets(plan, at(39), reported);
 assert.deepEqual(passed.map(t => [t.id, t.done, t.met]), [['snipe', true, 1], ['darts', false, 0]]);
 assert.deepEqual(passedTargets(plan, at(40), reported), [], 'once each');
 assert.deepEqual(passedTargets(plan, at(45), new Set()), [], 'only just after the round');
 const d = (rules, plan = {phase: 'x'}) => ({kind: 'decision', plan, constraint: {rules}});
 const events = [...passed.map(t => ({kind: 'plan_target', ...t}))];
 const decisions = [d([{kind: 'cash_hold'}]), d([{kind: 'cash_hold', restored: 'wait'}]), d([{kind: 'cash_hold_lifted', reason: 'no_wait_behind:short'}]),
  d([{kind: 'survival_first', floor: ['moab_short'], hold: 1100}]), d([{kind: 'survival_first', floor: ['leak_pressure']}]), d([])];
 const a = planAdherence(events, decisions);
 assert.deepEqual(a, {targets: {met: 1, of: 2, missed: ['darts']}, holds: {kept: 2, lifted: {'no_wait_behind:short': 1, survival_first: 1}}, survival_skips: 2, decisions: 6});
 const column = SCORE_COLUMNS.find(([h]) => h === 'Plan')[1];
 assert.equal(column({plan_adherence: a}), 'targets 1/2 on time; holds kept 2, lifted 2 (no_wait_behind:short 1, survival_first 1); survival skips 2/6');
 assert.equal(planAdherence([], [{kind: 'decision'}]), null, 'no plan: no measure');
});
