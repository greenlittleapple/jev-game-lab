import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AIM_CHECK_SECONDS, popsTracker, towerRoundEstimate} from './pops.mjs';
import {EFFICIENCY, roundFacts, roundSeconds, towerEstimate} from './estimate.mjs';

const tower = (id, pops, extra = {}) => ({id, base_id: 'DartMonkey', tiers: [0, 0, 0], x: 0, y: 0, pops, ...extra});
const state = (round, towers, extra = {}) => ({in_game: true, match: {id: 'm', result: null}, round: {number: round, active: true}, paused: false,
 fast_forward: true, multiplier: 5, towers, ...extra});

test('pops_round: each tower\'s pops in the round next to its estimate, and the round\'s RBE', () => {
 let clock = 0;
 const k = popsTracker({now: () => clock});
 assert.deepEqual(k.observe(state(10, [tower(1, 100)])), []);
 clock += 1000;
 assert.deepEqual(k.observe(state(10, [tower(1, 180), tower(2, 5)])), []);
 clock += 1000;
 const [r] = k.observe(state(11, [tower(1, 260), tower(2, 40)]));
 const est = Math.round(towerEstimate(tower(1, 0)).pps * roundSeconds(10) * EFFICIENCY);
 assert.equal(r.kind, 'pops_round');
 assert.deepEqual([r.round, r.rbe, r.pops, r.est], [10, roundFacts(10).rbe, 160 + 40, 2 * est]);
 assert.deepEqual(r.towers.map(t => [t.id, t.pops, t.est]), [[1, 160, est], [2, 40, est]], 'a tower placed during the round starts at 0');
 // The match result closes the last round once.
 const [end] = k.observe(state(11, [tower(1, 300), tower(2, 60)], {match: {id: 'm', result: 'defeat'}}));
 assert.deepEqual([end.round, end.pops, end.result], [11, 40 + 20, 'defeat']);
 assert.deepEqual(k.observe(state(11, [tower(1, 300)], {match: {id: 'm', result: 'defeat'}})), []);
});

test('a bridge without pops writes no records', () => {
 const k = popsTracker();
 k.observe(state(10, [tower(1, undefined)]));
 assert.deepEqual(k.observe(state(11, [tower(1, undefined)])), []);
});

test('aim_check: pops at aiming and after 10 s of game time while a round runs', () => {
 let clock = 0;
 const k = popsTracker({now: () => clock});
 k.observe(state(8, [tower(3, 50, {base_id: 'MortarMonkey'})]));
 k.aimed(state(8, [tower(3, 50, {base_id: 'MortarMonkey'})]), {tower_id: 3, base_id: 'MortarMonkey', action: 'set_target_point'});
 // 1 s real at 5x is 5 s of game time; a paused read and a read between rounds add nothing.
 clock += 1000; assert.deepEqual(k.observe(state(8, [tower(3, 70, {base_id: 'MortarMonkey'})])), []);
 clock += 5000; assert.deepEqual(k.observe(state(8, [tower(3, 70, {base_id: 'MortarMonkey'})], {paused: true})), []);
 clock += 5000; assert.deepEqual(k.observe(state(8, [tower(3, 70, {base_id: 'MortarMonkey'})], {round: {number: 8, active: false}})), []);
 clock += 1000;
 const [c] = k.observe(state(8, [tower(3, 130, {base_id: 'MortarMonkey'})]));
 assert.deepEqual([c.kind, c.tower_id, c.pops_at_aim, c.pops_after, c.gained, c.game_seconds, c.complete], ['aim_check', 3, 50, 130, 80, AIM_CHECK_SECONDS, true]);
 // A check open at the end of the session is written as incomplete.
 k.aimed(state(8, [tower(3, 130)]), {tower_id: 3, base_id: 'MortarMonkey', action: 'set_target_point'});
 assert.deepEqual(k.finish().map(r => [r.pops_at_aim, r.complete]), [[130, false]]);
});

test('an unaimed point tower is estimated at 0 pops', () => {
 const mortar = {id: 4, base_id: 'MortarMonkey', tiers: [0, 0, 0], x: 0, y: 0, target_modes: ['TargetSelectedPoint'], targeting: 'TargetSelectedPoint', target_point: null};
 assert.deepEqual(towerRoundEstimate(mortar, 20), {est: 0, est_reach: 0});
});
