import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coverage, pickSpots, gridPoints, pathBounds, pathLength, describeCoverage} from './spots.mjs';
import {paths} from './fixtures/index.mjs';

test('coverage is the share of track inside the range circle and where it lies along the track', () => {
 const straight = [[{x: 0, y: 0}, {x: 100, y: 0}]];
 assert.equal(pathLength(straight[0]), 100);
 const mid = coverage({x: 50, y: 0}, 10, straight);
 assert.ok(Math.abs(mid.share - 0.2) < 1e-9);
 assert.ok(Math.abs(mid.from - 0.4) < 1e-9 && Math.abs(mid.to - 0.6) < 1e-9);
 const offset = coverage({x: 50, y: 6}, 10, straight);
 assert.ok(Math.abs(offset.share - 0.16) < 1e-9, 'a chord of 16 at distance 6 from a radius-10 circle');
 assert.deepEqual(coverage({x: 50, y: 20}, 10, straight), {share: 0, from: null, to: null});
 assert.equal(describeCoverage(mid), 'covers 20% of the track, from 40% to 60% of the way to the exit');
});

test('spots are the best-covering valid points, kept apart, with IDs in coverage order', () => {
 const valid = gridPoints(pathBounds(paths, 20), 10);
 const spots = pickSpots(valid, paths, {radius: 40, count: 5, minSeparation: 25});
 assert.equal(spots.length, 5);
 assert.deepEqual(spots.map(s => s.id), ['S01', 'S02', 'S03', 'S04', 'S05']);
 for (let i = 1; i < spots.length; i++) assert.ok(spots[i - 1].share >= spots[i].share);
 for (const a of spots) for (const b of spots) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 25);
 assert.throws(() => pickSpots(valid, paths, {radius: 0}), /positive radius/);
});
