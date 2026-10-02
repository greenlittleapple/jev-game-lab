import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EARLY_ONE_LIFE_MARGIN, EARLY_ROUND_LAST, earlyMarginFor, margin, neededPps, roundCheck, setEarlyMargin} from './estimate.mjs';
import {buildCandidates} from './candidates.mjs';
import {floorRulesV6} from './policy-v6.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths, meadowSpots as spots, meadowSpot} from './fixtures/index.mjs';

const on = fn => { setEarlyMargin(true); try { return fn(); } finally { setEarlyMargin(false); } };
const ids = list => list.map(c => c.id);
// CHIMPS series 1, match 2: one 0-0-0 Bomb Shooter ($405) and $245 unspent at the start of round 6, one life.
const bomb = () => ({id: 1, base_id: 'BombShooter', tiers: [0, 0, 0], x: meadowSpot('S03').x, y: meadowSpot('S03').y, next_upgrades: []});
const chimps = cash => v0Round6({cash, towers: [bomb()], lives: 1, starting_lives: 1});
const options = state => buildCandidates(state, {catalog: v0Catalog, freeSpots: spots, paths});

test('the early one-life margin: 3.0 through round 10 with one life, 1.5 from round 11; other lives unchanged', () => {
 assert.deepEqual([EARLY_ROUND_LAST, EARLY_ONE_LIFE_MARGIN], [10, 3.0]);
 on(() => {
  assert.deepEqual([margin(1, 6), margin(1, 10), margin(1, 11), margin(1, 1), margin(1)], [3.0, 3.0, 1.5, 3.0, 1.5]);
  assert.deepEqual([margin(100, 6), margin(10, 6), margin(5, 6), margin(100, 40)], [1.15, 1.3, 1.3, 1.15], 'Hard Standard lives keep their margins');
  assert.ok(Math.abs(neededPps(6, 1) - neededPps(6, 100) * 3.0 / 1.15) < 1e-9);
 });
 // Off (btd6-jev-v4 and the earlier policies, and the default outside a session): the margin without the round.
 assert.deepEqual([margin(1, 6), margin(1, 10), margin(1, 11), margin(100, 6)], [1.5, 1.5, 1.5, 1.15]);
 assert.deepEqual(['btd6-jev-v6', 'btd6-playbook-v5', 'btd6-claude-v1', 'btd6-jev-v4', 'btd6-jev-v3'].map(earlyMarginFor), [true, true, true, false, false]);
});

test('the CHIMPS round-6 loss: one 0-0-0 Bomb Shooter covered round 6 at 1.5 and is short at 3.0', () => {
 const check = () => roundCheck([bomb()], 6, {lives: 1, paths, useReach: true});
 const before = check(), after = on(check);
 assert.deepEqual([before.ratio, before.enough], [1.66, true], 'v4 and the old margin: covered');
 assert.deepEqual([after.ratio, after.enough], [0.84, false]);
 assert.equal(on(() => roundCheck([bomb()], 11, {lives: 1, paths, useReach: true})).needs, roundCheck([bomb()], 11, {lives: 1, paths, useReach: true}).needs, 'round 11 unchanged');
});

test('no_start_short at round 6 with one life: the start goes while a purchase that raises the ratio is affordable', () => {
 const state = chimps(245);
 const kept = on(() => floorRulesV6(state, options(state), {paths}));
 assert.ok(!ids(kept.candidates).includes('start_round'), ids(kept.candidates).join(' '));
 assert.equal(kept.constraint.rules.find(r => r.kind === 'no_start_short')?.removed, 1);
 // What stays is the affordable Dart Monkey ($200 of the $245), which raises round 6's ratio.
 assert.ok(kept.candidates.length && ids(kept.candidates).every(id => id.startsWith('place:DartMonkey@')), ids(kept.candidates).join(' '));
 const dart = {id: 2, base_id: 'DartMonkey', tiers: [0, 0, 0], x: meadowSpot('S01').x, y: meadowSpot('S01').y, next_upgrades: []};
 const ratio = towers => on(() => roundCheck(towers, 6, {lives: 1, paths, useReach: true})).ratio;
 assert.ok(ratio([bomb(), dart]) > ratio([bomb()]));
 // The old margin (v4) kept the start.
 assert.ok(ids(floorRulesV6(state, options(state), {paths}).candidates).includes('start_round'));
});

test('no_start_short keeps the start when no purchase is affordable (the last option is never removed)', () => {
 const state = chimps(0);
 const kept = on(() => floorRulesV6(state, options(state), {paths}));
 assert.ok(ids(kept.candidates).includes('start_round'), ids(kept.candidates).join(' '));
});
