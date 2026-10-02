import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCandidates, nextTierAllowed, stillValid} from './candidates.mjs';
import {round21, preRound, catalog, paths} from './fixtures/index.mjs';
import {pickSpots, gridPoints, pathBounds} from './spots.mjs';

const freeSpots = pickSpots(gridPoints(pathBounds(paths, 20), 10), paths, {radius: 40, count: 8, minSeparation: 20});

test('the crosspath rule: two paths at most, one above tier 2, tier 5 at most', () => {
 assert.equal(nextTierAllowed([0, 2, 0], 1), true);
 assert.equal(nextTierAllowed([0, 2, 0], 2), true);
 assert.equal(nextTierAllowed([1, 2, 0], 3), false, 'a third path');
 assert.equal(nextTierAllowed([3, 2, 0], 2), false, 'a second path above tier 2');
 assert.equal(nextTierAllowed([5, 0, 0], 1), false);
 assert.equal(nextTierAllowed([2, 2, 0], 1), true);
});

test('mid-round: wait, affordable placements at the best spots, and unlocked upgrades', () => {
 const c = buildCandidates(round21(), {catalog, freeSpots, paths, spotsPerTower: 2});
 const ids = c.map(x => x.id);
 assert.equal(ids[0], 'wait');
 assert.ok(!ids.includes('start_round'));
 assert.ok(!ids.some(id => id.startsWith('place:Quincy')), 'the hero is already placed');
 assert.ok(!ids.some(id => id.startsWith('place:NinjaMonkey')), 'a locked tower is not offered');
 assert.equal(ids.filter(id => id.startsWith('place:DartMonkey@')).length, 2);
 assert.ok(ids.includes('upgrade:7:p1') && ids.includes('upgrade:7:p2'));
 assert.ok(!ids.includes('upgrade:7:p3'), 'a locked upgrade is not offered');
 const dart = c.find(x => x.id.startsWith('place:DartMonkey@'));
 const spot = freeSpots.find(s => s.id === dart.details.spot);
 assert.deepEqual(dart.command, {action: 'place_tower', tower: 'DartMonkey', x: spot.x, y: spot.y});
 assert.equal(dart.details.cash_after, 1200 - 215);
 assert.match(dart.details.track, /^covers \d+% of the track/);
 const up = c.find(x => x.id === 'upgrade:7:p2');
 assert.deepEqual(up.command, {action: 'upgrade_tower', tower_id: 7, path: 1, expect_tiers: round21().towers.find(t => t.id === 7).tiers},
  'the bridge takes the game\'s 0-based path, and the tiers the option was built on');
 assert.equal(up.details.tiers_after, '0-3-0');
 const named = buildCandidates(round21(), {catalog, freeSpots, paths, spotsPerTower: 1, required: [{tower: 'DartMonkey', spot: 'S08'}]});
 assert.ok(named.some(x => x.id === 'place:DartMonkey@S08'), 'a spot a plan step names is offered too');
});

test('towers the mode doesn\'t allow are not offered', () => {
 const ids = buildCandidates(round21(), {catalog, freeSpots, paths}).map(x => x.id);
 assert.ok(!ids.some(id => id.startsWith('place:Druid@')), 'in_inventory false, as CHIMPS does with the Banana Farm');
});

test('with per-tower spots, each tower is offered only where it can be placed', () => {
 const left = freeSpots.filter(s => s.x < 0);
 const c = buildCandidates(round21(), {catalog, freeSpots: tower => tower === 'BoomerangMonkey' ? left : freeSpots, paths, spotsPerTower: 8});
 const at = prefix => c.filter(x => x.id.startsWith(prefix)).map(x => x.details.spot);
 assert.ok(at('place:BoomerangMonkey@').length > 0 && at('place:BoomerangMonkey@').every(id => left.some(s => s.id === id)));
 assert.ok(at('place:DartMonkey@').some(id => !left.some(s => s.id === id)), 'other towers keep every free spot');
});

test('a series tower list limits placements and upgrades to its towers', () => {
 const c = buildCandidates(round21(), {catalog, freeSpots, paths, towerWhitelist: ['BoomerangMonkey']});
 assert.ok(c.some(x => x.id.startsWith('place:BoomerangMonkey@')));
 assert.ok(!c.some(x => x.id.startsWith('place:DartMonkey@') || x.id.startsWith('upgrade:7:')), 'no darts and no upgrades on the dart');
});

test('before the first round the round can be started and waiting is not offered; nothing is offered when not ready', () => {
 const c = buildCandidates(preRound(), {catalog, freeSpots, paths});
 assert.equal(c[0].id, 'start_round');
 assert.ok(!c.some(x => x.id === 'wait'));
 assert.deepEqual(buildCandidates({...preRound(), ready: false}, {catalog, freeSpots, paths}), []);
 assert.deepEqual(buildCandidates({...round21(), match: {...round21().match, result: 'defeat'}}, {catalog}), []);
});

test('preconditions on a fresh observation', () => {
 const [place] = buildCandidates(round21(), {catalog, freeSpots, paths}).filter(x => x.id.startsWith('place:'));
 assert.equal(stillValid(round21(), place), true);
 assert.equal(stillValid({...round21(), cash: place.details.cost - 1}, place), false);
 const start = buildCandidates(preRound(), {catalog, freeSpots, paths})[0];
 assert.equal(stillValid({...preRound(), round: {...preRound().round, active: true}}, start), false);
});
