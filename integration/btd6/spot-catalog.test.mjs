import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {computeSpotCatalog, selectSpots, saveSpotCatalog, loadSpotCatalog, mapPaths, pathsHash, catalogFile} from './spot-catalog.mjs';
import {gridPoints, pathBounds, coverage} from './spots.mjs';
import {fakeGame} from './fake-bridge.mjs';
import {paths, catalog} from './fixtures/index.mjs';

// The simulated game in a fresh CHIMPS match on the fixture track.
async function inMatch() {
 const fake = fakeGame();
 Object.assign(fake.game, {screen: 'menu', popup: null});
 await fake.bridge.command({command_id: 's', action: 'start_match', map: 'Tutorial', difficulty: 'Hard', mode: 'Clicks', hero: 'Quincy', replace_saved: true});
 while (!(await fake.bridge.state().catch(() => null))?.in_game);
 return fake;
}

test('mapPaths reads the bridge map format and prefers active paths', () => {
 const map = {map: 'Tutorial', paths: [{id: '0', active: true, points: [[0, 0], [10, 0]]}, {id: '1', active: false, points: [[5, 5], [6, 6]]}]};
 assert.deepEqual(mapPaths(map), [[{x: 0, y: 0}, {x: 10, y: 0}]]);
 assert.equal(mapPaths({paths: [{active: false, points: [[1, 1], [2, 2]]}]}).length, 1, 'all paths when none is active');
});

test('the catalog is computed from the live map with batched placement checks for each ruleset tower', async () => {
 const fake = await inMatch();
 const result = await computeSpotCatalog(fake.bridge, {map: 'Tutorial', now: () => new Date('2026-09-29T00:00:00Z')});
 const checks = fake.game.requests.filter(r => r.path === '/api/v1/placement-check');
 assert.ok(checks.every(r => r.points <= 400), 'at most 400 points per request');
 assert.equal(result.grid.points, 1739);
 assert.equal(checks.length, 5 * result.towers.length, '1,739 points in five requests per tower');
 const ids = result.towers.map(t => t.id);
 assert.ok(ids.includes('Quincy') && !ids.includes('Gwendolin') && !ids.includes('Druid'), 'the ruleset hero only; towers outside the inventory are skipped');
 assert.equal(result.map, 'Tutorial');
 assert.equal(result.paths_hash, pathsHash(paths));
 assert.equal(result.ruleset, 'btd6-open-v1');
 assert.deepEqual(result.reference, {tower: 'DartMonkey', radius: 32});
 assert.ok(result.spots.length >= 4 && result.spots.length <= 40);
 assert.deepEqual(result.selection, {count: 30, spread: 10});
 assert.equal(result.spots[0].id, 'S01');
 for (let i = 1; i < result.spots.length; i++) assert.ok(result.spots[i - 1].share >= result.spots[i].share, 'IDs follow coverage');
 for (const s of result.spots) {
  assert.ok(Math.abs(coverage(s, 32, paths).share - s.share) < 0.001);
  assert.ok(result.spots.every(o => o === s || Math.hypot(o.x - s.x, o.y - s.y) >= 12), 'spots are at least 12 apart');
 }
 const bomb = result.towers.find(t => t.id === 'BombShooter');
 assert.ok(bomb.valid_points < result.towers.find(t => t.id === 'DartMonkey').valid_points, 'validity is per tower');
});

test('the catalog refuses a match with towers or on another map', async () => {
 const fake = await inMatch();
 await assert.rejects(computeSpotCatalog(fake.bridge, {map: 'InTheLoop'}), /on Tutorial, not InTheLoop/);
 await fake.bridge.command({command_id: 'd', action: 'dismiss_popup', popup: 'mode_rules_notice', button: 'ok', expect: {popup_class: 'Popup'}});
 const s = await fake.bridge.state();
 const placed = await fake.bridge.command({command_id: 'p', action: 'place_tower', tower: 'DartMonkey', x: -100, y: 40, expect: {match_id: s.match.id, towers_hash: s.towers_hash}});
 assert.equal(placed.status, 'queued');
 await assert.rejects(computeSpotCatalog(fake.bridge), /already has towers/);
});

test('selectSpots adds spots for a tower that the reference spots leave out', () => {
 const grid = gridPoints(pathBounds(paths, 30), 6);
 const onTrack = p => paths[0].some((q, i) => i > 0 && Math.hypot(p.x - q.x, p.y - q.y) < 12);
 const dart = grid.filter(p => !onTrack(p));
 // A tower that can only stand in the lower right quarter.
 const corner = dart.filter(p => p.x > 60 && p.y < -70);
 const towers = [{id: 'DartMonkey', range: 32}, {id: 'Corner', range: 60}, {id: 'Nowhere', range: 40}];
 const spots = selectSpots({DartMonkey: dart, Corner: corner, Nowhere: []}, towers, paths, {count: 6, perTower: 3, maxSpots: 10});
 const inCorner = spots.filter(s => corner.some(p => p.x === s.x && p.y === s.y));
 assert.ok(inCorner.length >= 3, 'the corner tower has its own spots');
 assert.ok(spots.length <= 10);
 assert.deepEqual(spots.map(s => s.id), spots.map((_, i) => `S${String(i + 1).padStart(2, '0')}`));
 assert.throws(() => selectSpots({}, [{id: 'Corner', range: 60}], paths), /reference tower DartMonkey/);
});

test('a saved catalog loads only for the same map and track', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-spots-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = await inMatch();
 const made = await computeSpotCatalog(fake.bridge);
 const file = await saveSpotCatalog(dir, made);
 assert.equal(file, catalogFile(dir, 'Tutorial'));
 assert.deepEqual((await loadSpotCatalog(dir, 'Tutorial', paths)).spots, made.spots);
 await assert.rejects(loadSpotCatalog(dir, 'InTheLoop', paths), /No spot catalog for InTheLoop.*btd6:spots/);
 await assert.rejects(loadSpotCatalog(dir, 'Tutorial', [[{x: 0, y: 0}, {x: 1, y: 1}]]), /different track/);
 await writeFile(catalogFile(dir, 'Tutorial'), JSON.stringify({...made, version: 0}));
 await assert.rejects(loadSpotCatalog(dir, 'Tutorial', paths), /isn't a version 1 catalog/);
 assert.ok(catalog.length > 0);
});
