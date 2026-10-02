import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide} from '../../core/hierarchical.mjs';
import {btd6Game} from './game.mjs';
import {buildCandidates} from './candidates.mjs';
import {floorRulesV2} from './policy-v2.mjs';
import {JEV_POLICY_V3, LEAK_PROGRESS, floorRulesV3, groupOptionsV3, jevQuestionV3, pressureTracker, withReach} from './policy-v3.mjs';
import {roundCheck} from './estimate.mjs';
import {reach} from './spots.mjs';
import {normalizeState} from './state.mjs';
import {runConfig, POLICIES} from './session.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths, meadowSpots as spots, meadowSpot} from './fixtures/index.mjs';

const options = (state, cat = v0Catalog) => buildCandidates(state, {catalog: cat, freeSpots: spots, paths});
const ids = list => list.map(c => c.id);
const tower = (id, base_id, spot, tiers = [0, 0, 0], next_upgrades = []) => ({id, base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y, next_upgrades});
const bloons = (furthest, count = 20) => ({count, by_type: {Blue: count - 4, Green: 4}, other_types: 0, camo: 0, regrow: 0, fortified: 0, moab_class: 0,
 furthest, progress_p50: +(furthest / 2).toFixed(3), progress_p75: +(furthest * 0.75).toFixed(3), progress_p90: +(furthest * 0.9).toFixed(3)});
const running = (extra = {}) => ({round: {index: 5, active: true, before_first_wave: false, lives_lost: 0}, ...extra});
const pressured = {active: true, reason: 'bloons_past_threshold', since_round: 6};

// The v2 run: a Tack Shooter at S03 ($280), then round 6 started and Jev waited nine times with $370+.
const v2Tack = () => tower(392, 'TackShooter', 'S03', [0, 0, 0], [{path: 0, cost: 150, id: 'Faster Shooting'}, {path: 1, cost: 100, id: 'Long Range Tacks'}, {path: 2, cost: 110, id: 'Extra Range Tacks'}]);
// Jev as in the v2 run: wait whenever offered, else start, else the first option.
function waitingJev(asked = []) {
 return async q => {
  asked.push(q);
  const offered = Object.keys(q.questions.move.criteria);
  const choice = offered.find(id => id === 'wait') ?? offered.find(id => id === 'start_round') ?? offered[0];
  return {model: 'jev-test', answers: {move: {type: 'choice', choice, confidence: 0.6, probabilities: {}}}, usage: {input_tokens: 1, output_tokens: 1}};
 };
}
const game = context => btd6Game(() => context, {policy: JEV_POLICY_V3});

test('the v2 failure replayed: v2 started round 6 with one base Tack; v3 does not', () => {
 const state = v0Round6({cash: 370, towers: [v2Tack()]});
 assert.ok(ids(floorRulesV2(state, options(state), {paths}).candidates).includes('start_round'), 'v2 allowed "Start round 6"');
 const {candidates, constraint} = floorRulesV3(state, options(state), {paths});
 assert.ok(!ids(candidates).includes('start_round'));
 assert.deepEqual(constraint.rules.find(r => r.kind === 'no_start_short'), {kind: 'no_start_short', removed: 1, round: 6, can_pop: 55, needs: 86});
});

test('the v2 failure replayed: no waiting while bloons pass 0.6 with cash for a purchase', async () => {
 const state = normalizeState({...structuredClone(v0Round6({cash: 370, towers: [v2Tack()]})), ...running(), bloons: bloons(0.65)});
 const offered = options(state);
 assert.ok(ids(offered).includes('wait'));
 assert.ok(ids(floorRulesV2(state, offered, {paths}).candidates).includes('wait'), 'v2 kept waiting: its estimate said round 6 was covered');
 const {candidates, constraint} = floorRulesV3(state, offered, {paths, pressure: pressured});
 assert.ok(!ids(candidates).includes('wait'));
 assert.deepEqual(constraint.rules[0], {kind: 'leak_pressure', removed: 1, reason: 'bloons_past_threshold', furthest: 0.65, lives_lost: 0});
 const r = await decide({state, candidates: offered, game: game({paths, pressure: pressured, leaks: []}), ask: waitingJev()});
 assert.ok(['place', 'upgrade'].includes(r.choice.details.kind), r.choice.id);
});

test('leak pressure removes waiting even when the estimate is ahead, and only while a defence purchase is affordable', () => {
 const towers = [tower(1, 'DartMonkey', 'S01', [0, 0, 2]), tower(2, 'DartMonkey', 'S02', [0, 0, 2]), tower(3, 'BombShooter', 'S03', [2, 0, 0]), tower(4, 'DartMonkey', 'S07', [0, 0, 2])];
 const state = normalizeState({...structuredClone(v0Round6({cash: 400, towers})), ...running({lives: 100, starting_lives: 100}), bloons: bloons(0.7)});
 const calm = floorRulesV3(state, options(state), {paths});
 assert.ok(ids(calm.candidates).includes('wait'), 'ahead with no pressure and no leaks: waiting stays');
 const under = floorRulesV3(state, options(state), {paths, pressure: pressured});
 assert.ok(!ids(under.candidates).includes('wait'));
 const broke = {...state, cash: 20};
 assert.deepEqual(ids(floorRulesV3(broke, options(broke), {paths, pressure: pressured}).candidates), ['wait'], 'nothing affordable: waiting is the only option');
});

test('waiting needs the defence ahead and no leaks this round or the last', () => {
 const towers = [tower(1, 'DartMonkey', 'S01', [0, 0, 2]), tower(2, 'DartMonkey', 'S02', [0, 0, 2]), tower(3, 'BombShooter', 'S03', [2, 0, 0]), tower(4, 'DartMonkey', 'S07', [0, 0, 2])];
 const state = normalizeState({...structuredClone(v0Round6({cash: 400, towers})), ...running({lives: 97, starting_lives: 100})});
 assert.ok(ids(floorRulesV3(state, options(state), {paths}).candidates).includes('wait'));
 const {candidates, constraint} = floorRulesV3(state, options(state), {paths, leaks: [{round: 5, lives_lost: 3}]});
 assert.ok(!ids(candidates).includes('wait'));
 { const {rounds, ...rule} = constraint.rules.at(-1); assert.deepEqual(rule, {kind: 'no_wait_behind', removed: 1, verdict: 'ahead', leaks: 1}); assert.ok(rounds.length && rounds.every(r => r.rbe > 0 && r.can_pop > 0 && r.needs > 0), 'the figures behind the verdict are recorded'); }
 const oneDart = normalizeState({...structuredClone(v0Round6({cash: 400, towers: [towers[0]]})), ...running({lives: 100, starting_lives: 100})});
 assert.equal(floorRulesV3(oneDart, options(oneDart), {paths}).constraint.rules.at(-1).kind, 'no_wait_behind', 'short: no waiting');
});

test('pressure starts at 0.6, lasts the round, and ends with a round that has no new leaks', () => {
 const p = pressureTracker();
 const at = (round, active, lives, furthest = null, lives_lost = 0) => p.observe(normalizeState({...structuredClone(v0Round6()), lives, starting_lives: 100,
  round: {index: round - 1, active, before_first_wave: false, lives_lost}, bloons: furthest == null ? bloons(0, 0) : bloons(furthest)}));
 at(6, true, 100, 0.3);
 assert.equal(p.status().active, false);
 at(6, true, 100, LEAK_PROGRESS);
 assert.deepEqual(p.status(), {active: true, reason: 'bloons_past_threshold', since_round: 6});
 at(6, true, 100, 0.2);
 assert.equal(p.status().active, true, 'stays for the rest of the round');
 at(7, false, 100);
 assert.equal(p.status().active, false, 'the round ended with no leaks');
 at(7, true, 100, 0.5);
 at(7, true, 98, 0.8, 2);
 assert.deepEqual(p.status(), {active: true, reason: 'lives_lost', since_round: 7});
 at(8, false, 98);
 assert.deepEqual(p.status(), {active: true, reason: 'leaked_last_round', since_round: 7}, 'a leaky round carries pressure into the next');
 at(8, true, 98, 0.1);
 assert.equal(p.status().active, true);
 at(9, true, 98, 0.1);
 assert.equal(p.status().active, false, 'round 8 ended (automatic start) with no new leaks');
 at(9, true, 97, 0.2);
 assert.equal(p.status().reason, 'lives_lost', 'a lives drop alone starts it');
});

test('coverage uses each tower\'s own range from towers.json, with the late-track share', () => {
 const state = v0Round6({cash: 2000, towers: [tower(7, 'DartMonkey', 'S07', [0, 0, 0], [{path: 2, cost: 150, id: 'Long Range Darts'}])]});
 const decorated = withReach(state, options(state), paths);
 const find = id => decorated.find(c => c.id === id)?.details.reach;
 const tack = find('place:TackShooter@S03'), dart = find('place:DartMonkey@S03');
 assert.equal(tack.range, 23);
 assert.equal(dart.range, 32);
 assert.ok(tack.share < dart.share, `${tack.share} < ${dart.share}`);
 assert.equal(tack.share, 0.079);
 assert.equal(dart.share, 0.131);
 const upgrade = find('upgrade:7:p3');
 assert.equal(upgrade.range, 40, 'Dart 0-0-1 reaches further');
 assert.ok(upgrade.late > reach(meadowSpot('S07'), 32, paths).late, 'more of the late track in range at 40 than at 32');
 const sniper = decorated.find(c => c.details.tower === 'SniperMonkey');
 if (sniper) assert.deepEqual([sniper.details.reach.share, sniper.details.reach.late], [1, 1], 'a global tower reaches the whole track');
});

test('under leak pressure, purchases that reach the late track rank first', () => {
 const state = normalizeState({...structuredClone(v0Round6({cash: 2000, towers: [v2Tack()]})), ...running(), bloons: bloons(0.8)});
 const {candidates} = floorRulesV3(state, options(state), {paths, pressure: pressured});
 const groups = groupOptionsV3(state, candidates, {catalog: v0Catalog, paths, pressure: pressured});
 const firstPurchase = groups.find(g => g.details.kind === 'place_group' || g.details.kind === 'upgrade_group');
 assert.ok(firstPurchase.members.some(m => m.details.reach.late > 0), firstPurchase.id);
 assert.ok(candidates.findIndex(c => (c.details.reach?.late ?? 0) > 0) < candidates.findIndex(c => c.details.reach && !c.details.reach.late));
});

test('round 6 verdicts on Monkey Meadow: one base Tack, one Dart, two Darts', () => {
 const verdict = (towers, lives) => { const c = roundCheck(towers, 6, {lives, paths, useReach: true}); return `${c.can_pop}/${c.needs} ${c.enough ? 'enough' : 'short'}`; };
 const tack = [tower(1, 'TackShooter', 'S03')], dart = [tower(1, 'DartMonkey', 'S01')], darts = [tower(1, 'DartMonkey', 'S01'), tower(2, 'DartMonkey', 'S02')];
 assert.equal(roundCheck(tack, 6, {lives: 1, paths}).enough, true, 'v2 said one Tack covers round 6');
 assert.deepEqual([verdict(tack, 1), verdict(dart, 1), verdict(darts, 1)], ['55/86 short', '45/86 short', '90/86 enough']);
 assert.deepEqual([verdict(tack, 100), verdict(dart, 100), verdict(darts, 100)], ['55/66 short', '45/66 short', '90/66 enough']);
});

test('the v3 question carries the bloon pressure and per-option reach', () => {
 const state = normalizeState({...structuredClone(v0Round6({cash: 370, towers: [v2Tack()]})), ...running({round: {index: 5, active: true, before_first_wave: false, lives_lost: 1}}), bloons: bloons(0.9)});
 const {candidates} = floorRulesV3(state, options(state), {paths, pressure: {active: true, reason: 'lives_lost', since_round: 6}});
 const q = jevQuestionV3(state, candidates.slice(0, 6), {paths, pressure: {active: true, reason: 'lives_lost', since_round: 6}, leaks: [{round: 6, lives_lost: 1}]});
 assert.deepEqual(q.state.on_track, {count: 20, furthest: 0.9, median: 0.45, types: '16 Blue, 4 Green', lives_lost_this_round: 1, pressure: 'lives_lost'});
 const place = Object.values(q.questions.move.criteria).find(c => c.track);
 assert.ok(place.late && place.pops != null, JSON.stringify(place));
 assert.ok(JSON.stringify(q).length < 4000);
});

test('Hard Standard is the default setup; CHIMPS and v0 to v2 stay selectable', () => {
 const base = ['--dry-run', '--policy', 'jev-v3'];
 assert.deepEqual(runConfig(base).setup, {map: 'Tutorial', difficulty: 'Hard', mode: 'Standard', hero: 'Quincy'});
 assert.equal(runConfig(base).policy, 'btd6-jev-v3');
 assert.equal(runConfig([...base, '--setup', 'MonkeyMeadow/Hard/CHIMPS']).setup.mode, 'Clicks');
 assert.deepEqual(Object.values(POLICIES), ['btd6-jev-v0', 'btd6-jev-v0', 'btd6-jev-v1', 'btd6-jev-v2', 'btd6-jev-v3', 'btd6-jev-v4', 'btd6-jev-v6', 'btd6-claude-v1', 'btd6-playbook-v5']);
});
