import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jevQuestion} from './question.mjs';
import {buildCandidates} from './candidates.mjs';
import {adoptPlan, requestStamp} from './plan.mjs';
import {round21, preRound, catalog, paths, openingPlan} from './fixtures/index.mjs';
import {pickSpots, gridPoints, pathBounds} from './spots.mjs';

const freeSpots = pickSpots(gridPoints(pathBounds(paths, 20), 10), paths, {radius: 40, count: 8, minSeparation: 20});

test('one Choice question over exactly the candidate IDs, with named state fields and no model', () => {
 const candidates = buildCandidates(round21(), {catalog, freeSpots, paths, spotsPerTower: 2});
 const q = jevQuestion(round21(), candidates, null, {leaks: [{round: 20, lives_lost: 2}]});
 assert.equal(q.model, undefined, 'the client pins the model');
 assert.deepEqual(Object.keys(q.questions), ['move']);
 assert.equal(q.questions.move.type, 'choice');
 assert.deepEqual(Object.keys(q.questions.move.criteria), candidates.map(c => c.id));
 assert.deepEqual(q.state.match, {map: 'Tutorial', difficulty: 'Hard', mode: 'Standard', round: 21, final_round: 80, round_in_progress: true, lives: 98, starting_lives: 100, cash: 1200});
 assert.deepEqual(q.state.threats_ahead, ['round 22: first White bloons', 'round 24: first Camo bloon (one Camo Green)', 'round 25: first Purple bloons', 'round 26: first Zebra bloons', 'round 28: first Lead bloons']);
 assert.deepEqual(q.state.recent_leaks, [{round: 20, lives_lost: 2}]);
 assert.equal(q.state.strategist_plan, undefined);
 assert.doesNotMatch(q.questions.move.instructions, /strategist_plan/);
 const place = candidates.find(c => c.details.kind === 'place');
 assert.deepEqual(Object.keys(q.questions.move.criteria[place.id]), ['action', 'cost', 'cash_after', 'range', 'track']);
});

test('with a plan, Jev sees its summary, next step and reserve', () => {
 const plan = adoptPlan(openingPlan(), {reason: 'match_start', stamp: requestStamp(preRound(), {key: 'k'}, {lead: 3, catalog, freeSpots})}, {request_id: 'r1'});
 const q = jevQuestion(round21(), buildCandidates(round21(), {catalog, freeSpots, paths}), plan, {});
 assert.deepEqual(q.state.strategist_plan, {summary: plan.summary, priorities: plan.priorities, next_step: 'place DartMonkey at S01 from round 3', cash_reserve: 400});
 assert.match(q.questions.move.instructions, /strategist_plan is the current plan/);
});
