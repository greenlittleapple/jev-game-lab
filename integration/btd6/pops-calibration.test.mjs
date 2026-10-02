// Pops calibration: the factor on the estimate and the rounds it applies from, outcome bounds from run logs,
// the measured factor from pops_round records, the per-setup file, the interim entry, and a pinned factor.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {outcomeBounds, roundsOf, lostByRound, runFactor, interimFactor, loadPopsCalibration, recordPopsCalibration, pinCalibration,
 MIN_ROUNDS} from './pops-calibration.mjs';
import {roundCheck, roundFacts, setPopsCalibration, popsCalibration} from './estimate.mjs';
import {popsTracker} from './pops.mjs';
import {defenceV3} from './policy-v3.mjs';
import {parseSetup} from './lifecycle.mjs';
import {meadowPaths as paths, meadowSpot} from './fixtures/index.mjs';

const tower = (id, base_id, spot, tiers) => ({id, base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y});
const towers = [tower(1, 'DartMonkey', 'S02', [0, 3, 2]), tower(2, 'BombShooter', 'S05', [0, 2, 4])];
const state = (round, lives, list = towers) => ({in_game: true, match: {id: 'm', result: null, end_round: 80}, round: {number: round, active: true, lives_lost: 0}, lives, towers: list});
const decision = (round, lives, list) => ({kind: 'decision', policy: 'btd6-jev-v4', state: state(round, lives, list)});

test('the factor scales can_pop with reach, from its first round on, and not the v2 estimate', () => {
 const before = roundCheck(towers, 70, {paths, useReach: true, factor: 1});
 try {
  setPopsCalibration(1.5, {fromRound: 60});
  assert.deepEqual(popsCalibration(), {factor: 1.5, from_round: 60});
  assert.ok(Math.abs(roundCheck(towers, 70, {paths, useReach: true}).can_pop - 1.5 * before.can_pop) <= 1);
  assert.equal(roundCheck(towers, 50, {paths, useReach: true}).can_pop, roundCheck(towers, 50, {paths, useReach: true, factor: 1}).can_pop, 'before round 60: no factor');
  assert.equal(roundCheck(towers, 70).can_pop, roundCheck(towers, 70, {factor: 1.5}).can_pop, 'v2 (no reach) is left alone');
  assert.throws(() => setPopsCalibration(0), /above 0/);
  assert.throws(() => setPopsCalibration(1.2, {fromRound: 0}), /round/);
 } finally { setPopsCalibration(1); }
 assert.equal(roundCheck(towers, 70, {paths, useReach: true}).can_pop, before.can_pop);
});

test('outcome bounds: a cleared round bounds the factor from below, a round that lost lives from above', () => {
 const small = [towers[0]];
 const records = [decision(70, 100, small), decision(70, 100, towers), decision(71, 100, towers), decision(71, 90, towers), decision(72, 90, towers)];
 const rounds = roundsOf(records);
 assert.deepEqual(rounds.map(r => [r.round, r.lost, r.cleared]), [[70, 0, true], [71, 10, true], [72, 0, false]]);
 assert.deepEqual(lostByRound(records), {70: 0, 71: 10, 72: 0});
 const bounds = outcomeBounds(records, {paths});
 const can = r => roundCheck(towers, r, {paths, useReach: true, factor: 1}).can_pop;
 // The largest tower set in the round counts (the smallest bound); the last round, not finished, gives none.
 assert.deepEqual(bounds.map(b => [b.round, b.kind, b.can_pop]), [[70, 'lower', can(70)], [71, 'upper', can(71)]]);
 assert.equal(bounds[0].bound, +(roundFacts(70).rbe / can(70)).toFixed(2));
 // A tower missing from towers.json (0 pops) would inflate the bound: its rounds are left out.
 assert.deepEqual(outcomeBounds([decision(70, 100, [...towers, tower(3, 'NoSuchTower', 'S03', [1, 0, 1])]), decision(71, 100)], {paths}), []);
 // A won match clears its last round.
 assert.equal(outcomeBounds([decision(80, 100), {kind: 'run_end', result: 'victory'}], {paths})[0].kind, 'lower');
});

test('interim factor: the 25th percentile of the lower bounds above 1, from the given round', () => {
 const b = (round, bound, kind = 'lower') => ({round, bound, kind});
 const bounds = [b(10, 0.2), b(20, 0.3, 'upper'), b(20, 0.2, 'upper'), b(20, 0.25, 'upper'), b(60, 0.8), b(61, 1.1), b(62, 1.2), b(63, 1.4), b(64, 2.0)];
 assert.equal(interimFactor(bounds, {fromRound: 60}).factor, 1.1);
 // Upper bounds from the early rounds would pull it to the floor of FACTOR_BOUNDS.
 assert.equal(interimFactor(bounds).factor, 1);
 assert.equal(interimFactor([b(60, 1.5)], {fromRound: 60}).factor, 1, 'too few bounds');
});

test('pops_round records carry the lives lost in the round', () => {
 let clock = 0;
 const k = popsTracker({now: () => clock});
 const at = (round, lives) => ({...state(round, lives, [{...towers[0], pops: 1000 * round}]), paused: false});
 k.observe(at(70, 100)); clock += 1000; k.observe(at(70, 95)); clock += 1000;
 const [r70] = k.observe(at(71, 93));
 assert.equal(r70.lives_lost, 7, 'a drop seen at the next round\'s first read belongs to the round before');
 const [r71] = k.observe(at(72, 93));
 assert.equal(r71.lives_lost, 0);
});

const popsRound = (round, pops, est_reach, lives_lost, rbe = 10_000) => ({kind: 'pops_round', round, rbe, pops, est_reach, lives_lost});

test('run factor: rounds that lost lives measure it; cleared rounds are only a floor', () => {
 const leaking = [popsRound(70, 9000, 6000, 5), popsRound(71, 8000, 4000, 2), popsRound(72, 7000, 5000, 1)];
 const cleared = [popsRound(73, 10_000, 9000, 0), popsRound(74, 10_000, 12_000, 0)];
 assert.deepEqual(runFactor([...leaking, ...cleared]), {rounds: 3, factor: 1.5, floor: 0.83});
 // A round lost at once (pops under half the RBE) doesn't measure anything.
 assert.equal(runFactor([...leaking.slice(0, 2), popsRound(75, 3000, 1000, 50)]), null);
 // Without lives_lost in the records (bridge 0.3.13 logs before it was added), lives lost per round from the log.
 const old = leaking.map(({lives_lost, ...r}) => r);
 assert.equal(runFactor(old, {70: 5, 71: 2, 72: 1}).factor, 1.5);
 // A high floor from cleared rounds raises it.
 assert.equal(runFactor([...leaking, popsRound(76, 10_000, 4000, 0)]).factor, 2.5);
 assert.equal(runFactor(leaking, {}, {fromRound: 71}), null, 'rounds before from_round are left out');
 assert.equal(MIN_ROUNDS, 3);
});

test('per setup: the interim entry until a measured run, then the median of measured runs; a pinned factor is used as given', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'pops-cal-'));
 try {
  const meadow = parseSetup('MonkeyMeadow/Hard/Standard'), chimps = parseSetup('MonkeyMeadow/Hard/CHIMPS');
  const interim = await loadPopsCalibration(dir, meadow);
  assert.deepEqual([interim.factor, interim.from_round, interim.runs, interim.basis], [1.08, 60, 0, 'outcome_bounds']);
  assert.deepEqual([(await loadPopsCalibration(dir, chimps)).factor, (await loadPopsCalibration(dir, chimps)).from_round], [1, 1], 'no evidence: the estimate as it is');
  const records = [popsRound(70, 9000, 6000, 5), popsRound(71, 8000, 4000, 2), popsRound(72, 7000, 5000, 1)];
  assert.equal(await recordPopsCalibration(dir, meadow, 'run1', records.slice(0, 2)), null, 'too few rounds');
  const first = await recordPopsCalibration(dir, meadow, 'run1', records);
  assert.deepEqual(first, {run: {rounds: 3, factor: 1.5, floor: 0}, factor: 1.5});
  const second = await recordPopsCalibration(dir, meadow, 'run2', records.map(r => ({...r, pops: r.pops * 2})));
  assert.equal(second.factor, 2.25, 'median of 1.5 and 3.0');
  const measured = await loadPopsCalibration(dir, meadow);
  assert.deepEqual([measured.factor, measured.from_round, measured.runs, measured.basis, measured.source], [2.25, 60, 2, 'pops_round', 'measured (2 runs)']);
  const pin = pinCalibration(measured, 1.2);
  assert.deepEqual([pin.factor, pin.source, pin.runs, pin.from_round, pin.stored], [1.2, 'pinned', 2, 60, {factor: 2.25, source: 'measured (2 runs)'}]);
 } finally { await rm(dir, {recursive: true, force: true}); }
});

test('replay: a short verdict from the pops estimate turns enough once the factor covers the gap', () => {
 // Round 70: the Bomb Shooter's ring clusters count at half (towers.json), so at round 75 the gap needs a factor above 10.
 const s = state(70, 100);
 const [now, next] = defenceV3(s, {paths}).checks;
 const worst = Math.min(now.ratio, next.ratio);
 assert.ok(worst < 1);
 try {
  setPopsCalibration(+(1.05 / worst).toFixed(2), {fromRound: 60});
  assert.notEqual(defenceV3(s, {paths}).verdict, 'short');
 } finally { setPopsCalibration(1); }
});
