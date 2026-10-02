import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergePopsRounds, pathOf, groupKey, FITS, separation} from './pops-study.mjs';

const tower = (id, base_id, tiers, pops, est_reach) => ({id, base_id, tiers, pops, est: est_reach, est_reach});

test('mergePopsRounds: a flickered round sums its towers pops and keeps the first estimate; the Ace before its share counts 0.1', () => {
 const m = mergePopsRounds([
  {kind: 'pops_round', round: 44, rbe: 100, towers: [tower(1, 'DartMonkey', [0, 0, 0], 90, 200)]},
  {kind: 'pops_round', round: 45, rbe: 300, towers: [tower(1, 'DartMonkey', [0, 0, 0], -5, 400)]},
  {kind: 'pops_round', round: 44, rbe: 100, towers: [tower(1, 'DartMonkey', [0, 0, 0], 10, 210), tower(2, 'MonkeyAce', [2, 0, 0], 4, 50)]},
 ]);
 assert.deepEqual(m.get(44).towers.map(t => [t.pops, t.er]), [[100, 200], [4, 5]]);
 assert.equal(m.get(44).pops, 104);
 assert.equal(m.get(44).est, 205);
});

test('pathOf and groupKey', () => {
 assert.equal(pathOf('000'), '000');
 assert.equal(pathOf('024'), '2hi');
 assert.equal(pathOf('210'), '0lo');
 assert.equal(pathOf('h'), 'h');
 assert.equal(groupKey({type: 'BombShooter', tiers: '024'}, 'path'), 'BombShooter:2hi');
 assert.equal(groupKey({type: 'BombShooter', tiers: '024'}, 'type'), 'BombShooter');
});

test('FITS.rel: the round supply cancels, so two types that split pops in proportion to their estimates get the same factor', () => {
 const round = (n, rbe, a, b) => ({round: n, lost: 0, state: null, pr: {round: n, rbe, pops: a + b, est: 1000, towers: [{type: 'DartMonkey', tiers: '000', pops: a, er: 500}, {type: 'WizardMonkey', tiers: '000', pops: b, er: 500}]}});
 const runs = [{name: 'x', rounds: [round(1, 100, 50, 50), round(2, 400, 200, 200), round(3, 1000, 500, 500)]}];
 const f = FITS.rel(runs, 'type');
 assert.equal(+f.get('DartMonkey').toFixed(3), +f.get('WizardMonkey').toFixed(3));
 // leak: rounds that lost lives with pops at least half the RBE only
 const leak = FITS.leak([{name: 'y', rounds: [1, 2, 3].map(n => ({...round(n, 100, 30, 60), lost: 5}))}], 'type');
 assert.equal(leak.get('DartMonkey'), 0.06);
 assert.equal(leak.get('WizardMonkey'), 0.12);
});

test('separation: shares below and at or above each threshold, and the within-round AUC', () => {
 const rows = [{round: 78, lost: 100, whole: 1.5}, {round: 78, lost: 0, whole: 2.5}, {round: 78, lost: 3, whole: 0.9}, {round: 40, lost: 0, whole: 1.2}];
 const s = separation(rows, 'whole');
 assert.deepEqual(s.counts, {leak: 2, big: 1, clean: 2});
 assert.deepEqual(s.graded[0], {threshold: 2, leak_below: 2, big_below: 1, clean_at_or_above: 1});
 assert.deepEqual(s.graded[1], {threshold: 1.3, leak_below: 1, big_below: 0, clean_at_or_above: 1});
 assert.equal(s.within_round_auc, 1);
 assert.equal(s.pairs, 2);
});
