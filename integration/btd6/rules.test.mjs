import {test} from 'node:test';
import assert from 'node:assert/strict';
import {constrain, emergency} from './rules.mjs';
import {buildCandidates} from './candidates.mjs';
import {adoptPlan, requestStamp} from './plan.mjs';
import {preRound, round21, catalog, paths, openingPlan} from './fixtures/index.mjs';
import {pickSpots, gridPoints, pathBounds} from './spots.mjs';

const freeSpots = pickSpots(gridPoints(pathBounds(paths, 20), 10), paths, {radius: 40, count: 8, minSeparation: 20});
const adopt = (plan, state = preRound()) => adoptPlan(plan, {reason: 'match_start', stamp: requestStamp(state, {key: 'k'}, {lead: 3, catalog, freeSpots})}, {request_id: 'r1'});
const context = {lead: 3, catalog, freeSpots};
const options = (state, plan) => buildCandidates(state, {catalog, freeSpots, paths, spotsPerTower: 3,
 required: plan.build_order.filter(s => s.action === 'place' && s.spot).map(s => ({tower: s.tower, spot: s.spot}))});

test('a due, affordable step is the only option, so it is taken without asking Jev', () => {
 const plan = adopt(openingPlan());
 const state = preRound();
 const {candidates, constraint} = constrain(state, options(state, plan), plan, context);
 assert.deepEqual(candidates.map(c => c.id), ['place:DartMonkey@S01']);
 assert.deepEqual(constraint.rules, [{kind: 'planned_step', removed: constraint.removed, step: 's1', urgent: false}]);
});

test('a step without a spot leaves the spot to Jev', () => {
 const plan = adopt(openingPlan({build_order: [{step: 's1', action: 'place', tower: 'BoomerangMonkey', round_from: 3}]}));
 const state = preRound();
 const {candidates} = constrain(state, options(state, plan), plan, context);
 assert.equal(candidates.length, 3);
 assert.ok(candidates.every(c => c.id.startsWith('place:BoomerangMonkey@')));
});

test('an unaffordable due step holds other spending; before the first round that means starting it', () => {
 const plan = adopt(openingPlan({build_order: [{step: 's1', action: 'place', tower: 'BombShooter', round_from: 3}]}));
 const poor = {...preRound(), cash: 400};
 const {candidates, constraint} = constrain(poor, options(poor, plan), plan, context);
 assert.deepEqual(candidates.map(c => c.id), ['start_round']);
 assert.equal(constraint.rules[0].kind, 'save_for_step');
 const midRound = {...round21(), cash: 400};
 assert.deepEqual(constrain(midRound, options(midRound, plan), plan, context).candidates.map(c => c.id), ['wait']);
});

test('outside the build order: the reserve and the allowed towers limit what Jev may buy', () => {
 // The only step waits for round 25, so nothing is planned for round 21.
 const plan = adopt(openingPlan({build_order: [{step: 's4', action: 'place', tower: 'BombShooter', round_from: 25}],
  cash_reserve: [{from_round: 18, to_round: 26, amount: 800}], threats: []}));
 const state = round21();
 const all = options(state, plan);
 const {candidates, constraint} = constrain(state, all, plan, context);
 assert.ok(candidates.some(c => c.id === 'wait'));
 assert.ok(candidates.every(c => c.id === 'wait' || c.details.cash_after >= 800));
 assert.ok(candidates.every(c => c.id === 'wait' || c.details.tower === 'DartMonkey'), 'only darts are allowed outside the build order');
 assert.deepEqual(constraint.rules.map(r => r.kind), ['cash_reserve', 'allowed_towers']);
});

test('fast leaking lifts the plan so Jev can respond at once', () => {
 const plan = adopt(openingPlan({build_order: [{step: 's1', action: 'place', tower: 'BombShooter', round_from: 3}], allowed_towers: []}));
 const leaking = {...round21(), cash: 400, lives: 90};
 assert.equal(emergency(leaking, {livesAtRoundStart: 98}), true, '8 of 100 lives in one round');
 assert.equal(emergency(leaking, {livesAtRoundStart: 93}), false, '3 is under 5% of max lives');
 const all = options(leaking, plan);
 const {candidates, constraint} = constrain(leaking, all, plan, {...context, livesAtRoundStart: 98});
 assert.equal(candidates.length, all.length);
 assert.deepEqual(constraint.rules, [{kind: 'emergency', removed: 0, lives_lost: 8}]);
});

test('a step that cannot happen is not enforced; the off_plan trigger asks about it instead', () => {
 const plan = adopt(openingPlan({build_order: [{step: 's1', action: 'place', tower: 'DartMonkey', spot: 'S02', round_from: 3}], allowed_towers: ['DartMonkey', 'BoomerangMonkey']}));
 const state = preRound();
 const taken = freeSpots.filter(s => s.id !== 'S02');
 const {candidates} = constrain(state, buildCandidates(state, {catalog, freeSpots: taken, paths}), plan, {...context, freeSpots: taken});
 assert.ok(candidates.length > 1, 'no hold on other spending');
});
