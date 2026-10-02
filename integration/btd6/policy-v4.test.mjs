import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide} from '../../core/hierarchical.mjs';
import {btd6Game} from './game.mjs';
import {buildCandidates} from './candidates.mjs';
import {floorRulesV3} from './policy-v3.mjs';
import {JEV_POLICY_V4, floorRulesV4, groupOptionsV4, jevQuestionV4, moabFacts} from './policy-v4.mjs';
import {runConfig} from './session.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths, meadowSpots, meadowSpot} from './fixtures/index.mjs';

const tower = (id, base_id, spot, tiers, next_upgrades = []) => ({id, base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y, next_upgrades});
// The best v3 run's towers at round 40 (Hard Standard, 2026-09-30 05:48 UTC). Upgrade costs are illustrative.
const build = () => [
 tower(1, 'MortarMonkey', 'S01', [0, 3, 2], [{path: 1, cost: 1100, id: 'Artillery Battery'}]), tower(2, 'DartMonkey', 'S02', [2, 3, 0]),
 tower(3, 'WizardMonkey', 'S12', [1, 0, 0], [{path: 0, cost: 450, id: 'Fireball'}]), tower(4, 'BombShooter', 'S07', [0, 2, 3]),
 tower(5, 'DartMonkey', 'S03', [2, 3, 0]), tower(6, 'MortarMonkey', 'S06', [0, 3, 2], [{path: 1, cost: 1100, id: 'Artillery Battery'}]),
 tower(7, 'NinjaMonkey', 'S09', [0, 1, 0], [{path: 0, cost: 300, id: 'Ninja Discipline'}]),
 tower(8, 'SniperMonkey', 'S05', [2, 2, 0], [{path: 0, cost: 1300, id: 'Deadly Precision'}]), tower(9, 'DartMonkey', 'S11', [3, 2, 0]),
];
const freeSpots = meadowSpots.filter(s => ['S04', 'S08', 'S10'].includes(s.id));
// Hard Standard between rounds, 32 lives left as in the run.
function between(round, {cash = 1500, towers = build(), auto_start = true} = {}) {
 const s = v0Round6({cash, lives: 32, starting_lives: 100, max_lives: 100, auto_start, towers, round: {index: round - 1, active: false, before_first_wave: false}});
 s.match = {...s.match, mode: 'Standard', mode_name: 'Standard', end_round: 80, start_round: 3};
 return s;
}
const options = state => buildCandidates(state, {catalog: v0Catalog, freeSpots, paths});
const ids = list => list.map(c => c.id);
const kinds = list => list.map(c => c.details?.kind);

test('rounds 36 to 40 with the round-40 build: v3 lets the round start, v4 does not while MOAB damage is affordable', () => {
 for (const round of [36, 38, 40]) {
  const state = between(round);
  assert.ok(ids(floorRulesV3(state, options(state), {paths}).candidates).includes('wait'), `v3 kept "Wait" (auto-start) at round ${round}`);
  const {candidates, constraint} = floorRulesV4(state, options(state), {paths});
  assert.ok(!kinds(candidates).includes('wait'), `round ${round}`);
  // The Mortars count the track within their blast of the densest point (aim.mjs; the fixture has no targeting).
  assert.deepEqual(constraint.rules.at(-1), {kind: 'moab_short', removed: 1, round: 40, dps: 8.4, needs_dps: 14.4});
  // Most MOAB damage per dollar first: Deadly Precision (+8.2 for $1,300), then a Sniper (+1.3 for $350);
  // Artillery Battery adds less for $1,100: the Mortar hits only around its aim point.
  assert.deepEqual(ids(candidates.slice(0, 2)), ['upgrade:8:p1', 'place:SniperMonkey@S04']);
  assert.deepEqual(candidates.slice(0, 2).map(c => c.details.moab), [8.2, 1.3]);
 }
 const manual = between(36, {auto_start: false});
 assert.ok(!kinds(floorRulesV4(manual, options(manual), {paths}).candidates).includes('start_round'), 'with auto-start off, "Start round" goes');
});

test('the rule starts 4 rounds ahead, stops once MOAB damage is enough, and never leaves nothing to do', () => {
 const early = between(35);
 assert.equal(floorRulesV4(early, options(early), {paths}).constraint, null, 'round 35: five rounds before the MOAB');
 const strong = build().map(t => t.id === 8 ? {...t, tiers: [2, 0, 4]} : t);
 const ready = between(36, {towers: strong});
 assert.equal(floorRulesV4(ready, options(ready), {paths}).constraint, null, 'a Sniper 2-0-4 (69.3 over the whole track): ready');
 const broke = between(36, {cash: 100});
 assert.deepEqual(ids(floorRulesV4(broke, options(broke), {paths}).candidates), ['wait'], 'nothing affordable adds MOAB damage');
 const after = between(41);
 assert.equal(floorRulesV4(after, options(after), {paths}).constraint?.rules.some(r => r.kind === 'moab_short') ?? false, false, 'round 41: the next MOAB is round 50');
});

test('the capped action list ranks purchases that add MOAB damage first while it is short', () => {
 const state = between(36);
 const kept = floorRulesV4(state, options(state), {paths}).candidates;
 const groups = groupOptionsV4(state, kept, {catalog: v0Catalog, paths});
 assert.deepEqual(ids(groups.slice(0, 2)), ['upgrade:8', 'place:SniperMonkey']);
});

test('the question shows MOAB readiness from 8 rounds before, and what each option adds', () => {
 assert.equal(moabFacts(between(31), paths), null);
 assert.deepEqual(moabFacts(between(32), paths), {next_round: 40, rounds_away: 8, bloons: '1 MOAB', health: 200, dps: 8.4, needs_dps: 14.4, verdict: 'short', required_from_round: 36});
 const state = between(36), kept = floorRulesV4(state, options(state), {paths}).candidates;
 const q = jevQuestionV4(state, kept, {paths});
 assert.equal(q.state.moab.verdict, 'short');
 assert.match(q.questions.move.instructions, /needs_dps/);
 assert.equal(q.questions.move.criteria['upgrade:8:p1'].moab_dps, 8.2);
 assert.equal(q.questions.move.criteria['place:BananaFarm@S04'].moab_dps, 0);
 const groups = groupOptionsV4(state, kept, {catalog: v0Catalog, paths});
 assert.equal(jevQuestionV4(state, groups, {paths}, {stage: 'group'}).questions.move.criteria['place:SniperMonkey'].moab_dps, 1.3);
 const quiet = jevQuestionV4(between(20), options(between(20)), {paths});
 assert.equal(quiet.state.moab, undefined);
 assert.doesNotMatch(quiet.questions.move.instructions, /needs_dps/);
});

test('a v4 decision at round 36 spends on MOAB damage where v3 would start the round', async () => {
 const state = between(36);
 const ask = async q => {
  const offered = Object.keys(q.questions.move.criteria);
  const choice = offered.find(id => id === 'wait') ?? offered[0];
  return {model: 'jev-test', answers: {move: {type: 'choice', choice, confidence: 0.6, probabilities: {}}}, usage: {input_tokens: 1, output_tokens: 1}};
 };
 const game = btd6Game(() => ({paths, catalog: v0Catalog, leaks: [], pressure: null}), {policy: JEV_POLICY_V4});
 const r = await decide({state, candidates: options(state), game, ask});
 assert.ok(r.choice.details.moab > 0, r.choice.id);
});

test('--policy jev-v4 selects btd6-jev-v4; v0 to v3 stay selectable', () => {
 for (const [name, id] of [['jev-v4', 'btd6-jev-v4'], ['jev-v3', 'btd6-jev-v3'], ['jev-v2', 'btd6-jev-v2'], ['jev-v1', 'btd6-jev-v1'], ['jev-v0', 'btd6-jev-v0'], ['jev', 'btd6-jev-v0']])
  assert.equal(runConfig(['--dry-run', '--policy', name]).policy, id);
 assert.equal(runConfig(['--dry-run', '--policy', 'jev-v4']).speed.label, 'graded:10');
});
