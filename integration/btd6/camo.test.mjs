import test from 'node:test';
import assert from 'node:assert/strict';
import {camoShare, camoWindow, camoTimingOf, camoFigures, modelA, modelB, modelC} from './camo.mjs';
import {camoCheck, roundFacts, roundSeconds, DWELL_SECONDS} from './estimate.mjs';
import {camoTiming} from './data/generate.mjs';
import {modelsRun} from './camo-replay.mjs';

test('model A scales the pops by the camo share', () => {
 assert.equal(modelA({canPop: 264, needs: 116, share: 1}), 2.28);
 assert.equal(modelA({canPop: 264, needs: 116, share: 77 / 1202}), 0.15);
 assert.equal(modelA({canPop: 0, needs: 116, share: 0.5}), 0);
 assert.equal(modelA({canPop: 10, needs: 0, share: 1}), null);
});

test('model B compares rates: the pops per second over the round against the camo RBE per second over the camo window', () => {
 // Same window as the round: the same as today's ratio.
 assert.equal(modelB({canPop: 842, needs: 108, roundSecs: 33.3, windowSecs: 33.3}), 7.8);
 // Round 78: 72 camo Ceramics in 1.2 s (window 9.2 s) in a 98 s round.
 assert.equal(modelB({canPop: 14520, needs: 11232, roundSecs: 98, windowSecs: 9.2}), 0.12);
 assert.equal(modelB({canPop: 100, needs: 10, roundSecs: 0, windowSecs: 9}), null);
 assert.equal(modelB({canPop: 100, needs: 10, roundSecs: 20, windowSecs: null}), null);
});

test('model C is B with the camo share on the towers rate', () => {
 const x = {canPop: 264, needs: 116, share: 77 / 1202, roundSecs: 51.5, windowSecs: 9.59};
 assert.equal(modelC(x), 0.03);
 assert.ok(modelC(x) <= modelB(x) && modelC(x) <= modelA(x));
});

test('camo share, window and timing data', () => {
 assert.equal(camoShare({rbe: 72, camo_rbe: 72}), 1);
 assert.equal(camoShare({rbe: 100, camo_rbe: 0}), 0);
 assert.equal(camoWindow({start: 77.92, end: 79.12}), 1.2 + DWELL_SECONDS);
 assert.equal(camoWindow(null), null);
 assert.deepEqual(camoTimingOf(78), {start: 77.92, end: 79.12});
 assert.equal(camoTimingOf(1), null);
 for (let r = 1; r <= 100; r++) assert.equal(camoTimingOf(r) != null, roundFacts(r).camo_rbe > 0, `round ${r}`);
 assert.deepEqual(camoTiming([{bloon: 'Red', start: 0, end: 600, count: 10}, {bloon: 'YellowCamo', start: 120, end: 240, count: 3}, {bloon: 'RedCamo', start: 60, end: 90, count: 2}]), {start: 1, end: 4});
 assert.equal(camoTiming([{bloon: 'Red', start: 0, end: 600, count: 10}]), null);
});

test('camoFigures: today is camoCheck ratio; null without camo bloons', () => {
 const towers = [{id: 1, base_id: 'NinjaMonkey', tiers: [0, 0, 0], x: 0, y: 0}];
 const f = camoFigures(towers, 78, {lives: 100, factor: 1}), c = camoCheck(towers, 78, {lives: 100, factor: 1});
 assert.equal(f.today, c.ratio);
 assert.equal(f.round_seconds, roundSeconds(78));
 assert.ok(f.a < f.today && f.b < f.today && f.c <= f.b);
 assert.equal(camoFigures(towers, 1, {lives: 100}), null);
});

test('modelsRun: lives lost from pops_round, camo-capable pops, nearest exit and binding', () => {
 const ninja = {id: 1, base_id: 'NinjaMonkey', tiers: [0, 0, 0], x: 0, y: 0}, dart = {id: 2, base_id: 'DartMonkey', tiers: [0, 0, 0], x: 0, y: 0};
 const state = (round, bloons) => ({in_game: true, round: {number: round}, lives: 1, cash: 0, towers: [ninja, dart], match: {end_round: 80}, ...(bloons ? {bloons} : {})});
 const records = [{kind: 'session_start', calibration: {}}, {kind: 'run_start', policy: 'btd6-jev-v6'},
  {kind: 'decision', state: state(36)}, {kind: 'decision', state: state(37)},
  {kind: 'decision', state: state(37, {nearest_exit: [{type: 'WhiteCamo', camo: true}]})},
  {kind: 'pops_round', round: 37, lives_lost: 4, towers: [{base_id: 'NinjaMonkey', tiers: [0, 0, 0], pops: 30, est: 90}, {base_id: 'DartMonkey', tiers: [0, 0, 0], pops: 50, est: 60}]},
  {kind: 'decision', state: state(38)}];
 const out = modelsRun(records, {losses: [37], binding: true});
 const r37 = out.rounds.find(x => x.round === 37);
 assert.equal(r37.lost, 4);
 assert.equal(r37.lost_from, 'pops_round');
 assert.equal(r37.camo_tower_pops, 30);
 assert.equal(r37.camo_near_exit, true);
 assert.deepEqual(out.losses[37].map(x => x.at), [34, 35, 36, 37]);
 assert.equal(out.losses[37][0].figures, null);
 assert.equal(out.binding.decisions, 4);
 for (const k of ['a', 'b', 'c']) assert.ok(out.binding.due[k] >= out.binding.due.today);
});
