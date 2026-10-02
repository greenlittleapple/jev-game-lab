import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide} from '../../core/hierarchical.mjs';
import {btd6Game} from './game.mjs';
import {buildCandidates} from './candidates.mjs';
import {JEV_POLICY} from './question.mjs';
import {JEV_POLICY_V1, MAX_CHOICES, defence, neededPoints, floorRules, groupOptions, jevQuestionV1} from './policy-v1.mjs';
import {v0Round6, v0Catalog, round21, catalog, paths} from './fixtures/index.mjs';
import {pickSpots, gridPoints, pathBounds} from './spots.mjs';

const spots = pickSpots(gridPoints(pathBounds(paths, 20), 10), paths, {radius: 40, count: 12, minSeparation: 20});
const options = (state, cat = v0Catalog) => buildCandidates(state, {catalog: cat, freeSpots: spots, paths});
const running = {round: {index: 5, active: true, before_first_wave: false}};
const tower = (id, base_id, tiers = [0, 0, 0], next_upgrades = []) => ({id, base_id, tiers, x: 0, y: 30, next_upgrades});
const ids = list => list.map(c => c.id);
const kinds = list => new Set(list.map(c => c.details?.kind));

// Jev as in the v0 run: start the round when offered, otherwise wait, otherwise the first option.
function v0LikeJev(asked) {
 return async q => {
  asked.push(q);
  const offered = Object.keys(q.questions.move.criteria);
  const choice = offered.find(id => id === 'start_round') ?? offered.find(id => id === 'wait') ?? offered[0];
  return {model: 'jev-test', answers: {move: {type: 'choice', choice, confidence: 0.6, probabilities: {}}}, usage: {input_tokens: Math.ceil(JSON.stringify(q).length / 2), output_tokens: 1}};
 };
}

test('the v0 failure replayed: v0 offers 73 options and Jev starts round 6 with no towers', async () => {
 const state = v0Round6();
 const offered = options(state);
 assert.equal(offered.length, 73, '18 towers at 4 spots each, and start_round');
 const asked = [];
 const r = await decide({state, candidates: offered, game: btd6Game(() => ({}), {policy: JEV_POLICY}), ask: v0LikeJev(asked)});
 assert.equal(r.choice.id, 'start_round');
 assert.equal(Object.keys(asked[0].questions.move.criteria).length, 73);
});

test('v1 never starts round 6 with no towers: Jev picks a tower, then a spot, from short questions', async () => {
 const state = v0Round6();
 const asked = [];
 const r = await decide({state, candidates: options(state), game: btd6Game(() => ({}), {policy: JEV_POLICY_V1}), ask: v0LikeJev(asked)});
 assert.equal(r.choice.details.kind, 'place');
 assert.equal(r.decisionSource, 'jev');
 assert.deepEqual(r.constraint.rules.map(x => x.kind), ['no_start_undefended']);
 assert.equal(asked.length, 2, 'an action question, then a spot question');
 for (const q of asked) {
  const offered = Object.keys(q.questions.move.criteria);
  assert.ok(offered.length <= MAX_CHOICES, `${offered.length} options`);
  assert.ok(!offered.includes('start_round') && !offered.includes('wait'));
 }
 assert.ok(r.answers.group && r.answers.move.choice === r.choice.id);
 assert.deepEqual(r.narrowed, {groups: 16, dropped: 8});
 assert.equal(r.usage.input_tokens, asked.reduce((n, q) => n + Math.ceil(JSON.stringify(q).length / 2), 0), 'both calls counted');
});

test('v1 never chooses wait with zero towers while round 6 runs', async () => {
 const state = v0Round6(running);
 const offered = options(state);
 assert.ok(ids(offered).includes('wait'));
 const {candidates, constraint} = floorRules(state, offered);
 assert.ok(!ids(candidates).includes('wait'));
 assert.deepEqual(constraint.rules, [{kind: 'no_wait_undefended', removed: 1, points: 0, needed: 2}]);
 const r = await decide({state, candidates: offered, game: btd6Game(() => ({}), {policy: JEV_POLICY_V1}), ask: v0LikeJev([])});
 assert.equal(r.choice.details.kind, 'place');
});

test('defence floor: 1 point per damage-dealing tower and upgrade tier against ceil(round / 4)', () => {
 assert.deepEqual([1, 4, 6, 20, 40, 100].map(neededPoints), [1, 1, 2, 5, 10, 25]);
 const state = v0Round6({towers: [tower(1, 'DartMonkey', [1, 0, 1]), tower(2, 'BananaFarm', [2, 0, 0]), tower(3, 'Skywarden')]});
 assert.deepEqual(defence(state), {damage_towers: 2, points: 4, needed: 2, meets_floor: true}, 'the farm counts nothing; an unknown tower counts');
});

test('rules keep at least one option: with no towers and no affordable tower, starting stays', () => {
 const state = v0Round6({cash: 50});
 const offered = options(state);
 assert.deepEqual(ids(offered), ['start_round']);
 assert.deepEqual(floorRules(state, offered), {candidates: offered, constraint: null});
 const during = v0Round6({...running, cash: 50});
 assert.deepEqual(ids(floorRules(during, options(during)).candidates), ['wait']);
});

test('with no damage-dealing tower, farms and villages are removed and the round is not started', () => {
 const cat = [...v0Catalog.filter(t => t.id === 'DartMonkey'), {id: 'BananaFarm', name: 'Banana Farm', cost: 500, range: 20, is_hero: false, unlocked: true}];
 const state = v0Round6({towers: [tower(1, 'BananaFarm', [0, 0, 0], [{path: 0, cost: 300, id: 'Increased Production'}])]});
 const {candidates, constraint} = floorRules(state, options(state, cat));
 assert.ok(candidates.length > 0 && candidates.every(c => c.details.tower === 'DartMonkey'));
 assert.deepEqual(constraint.rules.map(x => x.kind), ['damage_first', 'no_start_undefended']);
});

test('at or above the floor the rules remove nothing', () => {
 const state = v0Round6({...running, towers: [tower(1, 'DartMonkey', [2, 0, 0])]});
 assert.equal(floorRules(state, options(state)).constraint, null);
 const before = v0Round6({towers: [tower(1, 'DartMonkey', [2, 0, 0])]});
 assert.ok(ids(floorRules(before, options(before)).candidates).includes('start_round'));
});

test('below the floor, waiting stays when no defending purchase is affordable', () => {
 const dart = tower(1, 'DartMonkey', [0, 0, 0], [{path: 0, cost: 140, id: 'Sharp Shots'}]);
 const broke = v0Round6({...running, cash: 100, towers: [dart]});
 assert.deepEqual(ids(floorRules(broke, options(broke)).candidates), ['wait']);
 // Only a farm is affordable: not a defending purchase.
 const farmOnly = [{id: 'BananaFarm', name: 'Banana Farm', cost: 500, range: 20, is_hero: false, unlocked: true}];
 const state = v0Round6({...running, cash: 600, towers: [tower(1, 'DartMonkey')]});
 assert.equal(floorRules(state, options(state, farmOnly)).constraint, null);
 // An affordable upgrade of the dart removes waiting.
 const upgradable = v0Round6({...running, cash: 150, towers: [dart]});
 assert.deepEqual(ids(floorRules(upgradable, options(upgradable, [])).candidates), ['upgrade:1:p1']);
});

test('groups: one per tower type or placed tower, keep first, capped at MAX_CHOICES with a count of what was left out', () => {
 const state = v0Round6({...running, cash: 5000, towers: [tower(7, 'DartMonkey', [0, 0, 0], [{path: 0, cost: 140, id: 'Sharp Shots'}, {path: 2, cost: 90, id: 'Long Range Darts'}])]});
 const groups = groupOptions(state, options(state));
 assert.equal(groups.length, MAX_CHOICES);
 assert.equal(groups[0].id, 'wait');
 assert.equal(groups[1].id, 'upgrade:7', 'upgrades of damage-dealing towers come before new towers');
 assert.deepEqual(groups[1].members.map(m => m.id), ['upgrade:7:p1', 'upgrade:7:p3']);
 assert.ok(groups.every(g => g.id !== 'place:BananaFarm'), 'a tower that deals no damage ranks last');
 assert.equal(groups.dropped, options(state).length - groups.reduce((n, g) => n + g.members.length, 0));
 assert.equal(groupOptions(state, options(state).slice(0, MAX_CHOICES)), null, 'a short list stays one question');
});

test('groups: a tower known to handle a threat due soon, which no tower handles, ranks first', () => {
 const state = v0Round6({round: {index: 22, active: true, before_first_wave: false}, cash: 5000, towers: [tower(1, 'DartMonkey', [2, 0, 0])]});
 const groups = groupOptions(state, options(state));
 assert.deepEqual(groups.slice(1, 4).map(g => g.id).sort(), ['place:BombShooter', 'place:NinjaMonkey', 'place:WizardMonkey'].sort(),
  'camo (round 24) and lead (round 28) are within 8 rounds');
});

test('question facts: costs, cash after, track and known answers per option; rounds, lives and defence per decision; null when unknown', () => {
 const state = v0Round6();
 const {candidates} = floorRules(state, options(state));
 const groups = groupOptions(state, candidates);
 const q = jevQuestionV1(state, groups, {}, {stage: 'group'});
 assert.deepEqual(q.state.match, {map: 'Tutorial', mode: 'CHIMPS', round: 6, final_round: 100, round_in_progress: false, lives: 1, cash: 650});
 assert.deepEqual(q.state.rounds, [{round: 6, new_threats: [], bloons: null}, {round: 7, new_threats: [], bloons: null}]);
 assert.deepEqual(q.state.defence, {damage_towers: 0, points: 0, needed: 2, meets_floor: false});
 const bomb = q.questions.move.criteria['place:BombShooter'];
 assert.deepEqual(Object.keys(bomb), ['action', 'cost', 'cash_after', 'best_track', 'answers']);
 assert.deepEqual(bomb.answers, ['lead']);
 assert.match(bomb.best_track, /^\d+%, \d+-\d+%$/);
 assert.equal(q.questions.move.criteria['place:Skywarden']?.answers ?? null, null, 'an unknown tower has answers null');
 assert.equal('answers' in q.questions.move.criteria['place:DartMonkey'], false, 'known to handle neither lead nor camo');
 const at21 = jevQuestionV1(round21(), buildCandidates(round21(), {catalog, freeSpots: spots, paths}).slice(0, 5), {leaks: [{round: 20, lives_lost: 2}]});
 assert.deepEqual(at21.state.rounds.map(r => r.new_threats), [[], ['first White bloons']]);
 assert.deepEqual(at21.state.recent_leaks, [{round: 20, lives_lost: 2}]);
});

// Budget: the v0 question for this state was 73 options and about 7,300 input tokens (logged). Using that
// run's ratio of question characters to input tokens (the same state rebuilt as a v0 question here is
// about 13,800 characters), 3,000 characters is about 1,600 tokens.
test('question size: the v1 action question is under 3,000 characters and the spot question under 1,100', () => {
 const state = v0Round6();
 const {candidates} = floorRules(state, options(state));
 const groups = groupOptions(state, candidates);
 const group = JSON.stringify(jevQuestionV1(state, groups, {}, {stage: 'group'})).length;
 const member = JSON.stringify(jevQuestionV1(state, groups[0].members, {}, {stage: 'member'})).length;
 assert.ok(group < 3000, `action question ${group} characters`);
 assert.ok(member < 1100, `spot question ${member} characters`);
});

test('v0 keeps its behaviour: no floor rules, no groups, the v0 question', () => {
 const game = btd6Game(() => ({}), {policy: JEV_POLICY});
 assert.equal(game.rules, undefined);
 assert.equal(game.group, undefined);
 assert.ok('threats_ahead' in game.question(v0Round6(), options(v0Round6()).slice(0, 3), null, null).state);
 assert.deepEqual(kinds(options(v0Round6())), new Set(['start_round', 'place']));
});
