import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide} from '../../core/hierarchical.mjs';
import {btd6Game} from './game.mjs';
import {buildCandidates} from './candidates.mjs';
import {MAX_CHOICES, floorRules, groupOptions, jevQuestionV1} from './policy-v1.mjs';
import {JEV_POLICY_V2, floorRulesV2, groupOptionsV2, jevQuestionV2, defenceV2} from './policy-v2.mjs';
import {runConfig} from './session.mjs';
import {v0Round6, v0Catalog, paths} from './fixtures/index.mjs';
import {pickSpots, gridPoints, pathBounds} from './spots.mjs';

const spots = pickSpots(gridPoints(pathBounds(paths, 20), 10), paths, {radius: 40, count: 12, minSeparation: 20});
const options = (state, cat = v0Catalog) => buildCandidates(state, {catalog: cat, freeSpots: spots, paths});
const at = (round, active) => ({round: {index: round - 1, active, before_first_wave: !active && round === 6}});
const tower = (id, base_id, tiers = [0, 0, 0], next_upgrades = [], x = 0, y = 30) => ({id, base_id, tiers, x, y, next_upgrades});
const ids = list => list.map(c => c.id);
const game = () => btd6Game(() => ({}), {policy: JEV_POLICY_V2});

// Jev as in the v1 run: start the round when offered, otherwise wait, otherwise the first option.
function v1LikeJev(asked) {
 return async q => {
  asked.push(q);
  const offered = Object.keys(q.questions.move.criteria);
  const choice = offered.find(id => id === 'start_round') ?? offered.find(id => id === 'wait') ?? offered[0];
  return {model: 'jev-test', answers: {move: {type: 'choice', choice, confidence: 0.6, probabilities: {}}}, usage: {input_tokens: 1, output_tokens: 1}};
 };
}

// The v1 run: a Dart Monkey at S03, 0-0-1, then Jev started round 6 and waited with the cash.
const v1Dart = () => tower(392, 'DartMonkey', [0, 0, 1], [{path: 0, cost: 150, id: 'Sharp Shots'}, {path: 1, cost: 110, id: 'Quick Shots'}, {path: 2, cost: 150, id: 'Enhanced Eyesight'}], -62, -2);

test('the v1 failure replayed: v1 allowed starting round 6 with one Dart 0-0-1', () => {
 const state = v0Round6({cash: 340, towers: [v1Dart()]});
 assert.ok(ids(floorRules(state, options(state)).candidates).includes('start_round'));
});

test('v2 does not start round 6 with one Dart 0-0-1 while a purchase that helps is affordable', async () => {
 const state = v0Round6({cash: 340, towers: [v1Dart()]});
 const {candidates, constraint} = floorRulesV2(state, options(state));
 assert.ok(!ids(candidates).includes('start_round'));
 assert.deepEqual(constraint.rules, [{kind: 'no_start_short', removed: 1, round: 6, can_pop: 45, needs: 86}]);
 const r = await decide({state, candidates: options(state), game: game(), ask: v1LikeJev([])});
 assert.notEqual(r.choice.details.kind, 'start_round');
});

test('v2 does not wait during round 6 with $600 and one Dart 0-0-1', async () => {
 const state = v0Round6({...at(6, true), cash: 600, towers: [v1Dart()]});
 const offered = options(state);
 assert.ok(ids(offered).includes('wait'));
 assert.ok(ids(floorRules(state, offered).candidates).includes('wait'), 'v1 kept waiting: its floor was met');
 const {candidates, constraint} = floorRulesV2(state, offered);
 assert.ok(!ids(candidates).includes('wait'));
 assert.deepEqual(constraint.rules.map(x => x.kind), ['no_wait_short']);
 const r = await decide({state, candidates: offered, game: game(), ask: v1LikeJev([])});
 assert.ok(['place', 'upgrade'].includes(r.choice.details.kind));
});

test('two Dart Monkeys cover rounds 6 and 7: starting and waiting stay', () => {
 const towers = [v1Dart(), tower(2, 'DartMonkey')];
 const before = v0Round6({cash: 400, towers});
 assert.ok(ids(floorRulesV2(before, options(before)).candidates).includes('start_round'));
 const during = v0Round6({...at(6, true), cash: 400, towers});
 assert.equal(floorRulesV2(during, options(during)).constraint, null);
 assert.equal(defenceV2(during).verdict, 'enough');
});

test('the round after counts when one affordable purchase covers it', () => {
 // Three base Dart Monkeys (6.3 pops per second) cover round 12 (needs 5.9) but not round 13 (7.9).
 const darts = [1, 2, 3].map(i => tower(i, 'DartMonkey'));
 const cheap = v0Round6({...at(12, false), auto_start: false, cash: 250, towers: darts});
 const {candidates, constraint} = floorRulesV2(cheap, options(cheap));
 assert.ok(!ids(candidates).includes('start_round'));
 assert.equal(constraint.rules[0].round, 13);
 const broke = v0Round6({...at(12, false), auto_start: false, cash: 100, towers: darts});
 assert.deepEqual(ids(floorRulesV2(broke, options(broke)).candidates), ['start_round']);
});

test('far ahead, waiting stays (saving for later rounds); short with nothing affordable, waiting stays', () => {
 const strong = v0Round6({...at(6, true), cash: 600, towers: [tower(1, 'DartMonkey', [0, 2, 0]), tower(2, 'BombShooter'), tower(3, 'TackShooter')]});
 assert.equal(defenceV2(strong).verdict, 'ahead');
 assert.equal(floorRulesV2(strong, options(strong)).constraint, null);
 const broke = v0Round6({...at(6, true), cash: 50, towers: [v1Dart()]});
 assert.deepEqual(ids(floorRulesV2(broke, options(broke)).candidates), ['wait']);
});

test('camo and lead: a round with them is not covered without a tower that pops them', () => {
 const darts = [1, 2, 3, 4].map(i => tower(i, 'DartMonkey', [0, 2, 0]));
 const r24 = defenceV2(v0Round6({...at(24, true), towers: darts}));
 assert.equal(r24.checks[0].camo, false);
 assert.equal(r24.verdict, 'short');
 const withNinja = defenceV2(v0Round6({...at(24, true), towers: [...darts, tower(5, 'NinjaMonkey')]}));
 assert.equal(withNinja.checks[0].camo, true);
 const r28 = defenceV2(v0Round6({...at(28, true), towers: [...darts, tower(5, 'NinjaMonkey')]}));
 assert.equal(r28.checks[0].lead, false);
});

test('early track: a defence that only reaches the second half of the track is short', () => {
 const end = paths[0].at(-1), start = paths[0][0];
 const late = [1, 2, 3].map(i => tower(i, 'DartMonkey', [0, 2, 0], [], end.x, end.y));
 assert.equal(defenceV2(v0Round6({...at(6, true), towers: late}), {paths}).checks[0].early, false);
 const early = [1, 2, 3].map(i => tower(i, 'DartMonkey', [0, 2, 0], [], start.x, start.y));
 assert.equal(defenceV2(v0Round6({...at(6, true), towers: early}), {paths}).checks[0].early, true);
});

test('Quincy ranks right after start/wait early in the match when the rounds stay covered with him, not after round 30', () => {
 const state = v0Round6({...at(6, true), cash: 5000, towers: [tower(1, 'DartMonkey', [0, 2, 0])]});
 const groups = groupOptionsV2(state, options(state), {catalog: v0Catalog});
 assert.equal(groups.length, MAX_CHOICES);
 assert.deepEqual(groups.slice(0, 2).map(g => g.id), ['wait', 'place:Quincy']);
 const late = v0Round6({...at(31, true), cash: 5000, towers: [tower(1, 'DartMonkey', [0, 2, 0])]});
 assert.notEqual(groupOptionsV2(late, options(late), {catalog: v0Catalog})[1].id, 'place:Quincy');
 // The opening: Quincy alone (3.2 pops per second) doesn't cover round 6, so he ranks by pops per dollar.
 const opening = groupOptionsV2(v0Round6(), options(v0Round6()), {catalog: v0Catalog});
 assert.notEqual(opening[1].id, 'place:Quincy');
 assert.ok(opening.some(g => g.id === 'place:Quincy'), 'still offered');
});

test('question facts: next rounds bloons and RBE, estimate against it, pops per option', () => {
 const state = v0Round6({cash: 340, towers: [v1Dart()]});
 const {candidates} = floorRulesV2(state, options(state));
 const groups = groupOptionsV2(state, candidates, {catalog: v0Catalog});
 const q = jevQuestionV2(state, groups, {}, {stage: 'group'});
 assert.deepEqual(q.state.rounds, [{round: 6, bloons: '4 Green, 15 Red, 15 Blue', rbe: 57}, {round: 7, bloons: '20 Blue, 5 Green, 20 Red', rbe: 75}]);
 assert.deepEqual(q.state.defence, {pops_per_second: 2.1, margin: 1.5, verdict: 'short',
  rounds: [{round: 6, can_pop: 45, needs: 86, missing: ['pops']}, {round: 7, can_pop: 58, needs: 113, missing: ['pops']}]});
 assert.equal(q.questions.move.criteria['place:DartMonkey'].pops, 2.1);
 assert.deepEqual(q.state.towers, ['DartMonkey 0-0-1']);
});

// Same yardstick as the v1 size test: 3,000 characters is about 1,600 input tokens.
test('question size: v2 stays close to v1', () => {
 const state = v0Round6({cash: 340, towers: [v1Dart()]});
 const v1 = JSON.stringify(jevQuestionV1(state, groupOptions(state, floorRules(state, options(state)).candidates), {}, {stage: 'group'})).length;
 const {candidates} = floorRulesV2(state, options(state));
 const groups = groupOptionsV2(state, candidates, {catalog: v0Catalog});
 const group = JSON.stringify(jevQuestionV2(state, groups, {}, {stage: 'group'})).length;
 const member = JSON.stringify(jevQuestionV2(state, groups.find(g => g.members.length > 1).members, {}, {stage: 'member'})).length;
 assert.ok(group < 3600 && group < v1 * 1.4, `action question ${group} characters (v1 ${v1})`);
 assert.ok(member < 1300, `spot question ${member} characters`);
});

test('policy names: jev-v2 is btd6-jev-v2; jev, jev-v0 and jev-v1 are unchanged', () => {
 const policy = name => runConfig(['--setup', 'MonkeyMeadow/Hard/CHIMPS', '--policy', name, '--dry-run'], {}).policy;
 assert.deepEqual(['jev', 'jev-v0', 'jev-v1', 'jev-v2'].map(policy), ['btd6-jev-v0', 'btd6-jev-v0', 'btd6-jev-v1', 'btd6-jev-v2']);
 const g = game();
 assert.ok(g.rules && g.group && g.question);
});
