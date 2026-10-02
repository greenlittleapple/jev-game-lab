import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan} from '../../core/plan-schema.mjs';
import {PLAN_SCHEMA, checkAnswer, requestStamp, adoptPlan, strategistBrief, nextStep, stepDone, stepBlocked, activeReserve, stepContext} from './plan.mjs';
import {preRound, round21, catalog, paths, openingPlan} from './fixtures/index.mjs';
import {pickSpots, gridPoints, pathBounds} from './spots.mjs';

const freeSpots = pickSpots(gridPoints(pathBounds(paths, 20), 10), paths, {radius: 40, count: 8, minSeparation: 20});
const trigger = {reason: 'match_start', key: 'm:match_start'};
const request = (state = preRound()) => ({reason: 'match_start', stamp: requestStamp(state, trigger, {lead: 3, catalog, freeSpots})});

test('the opening plan passes the schema and the request checks', () => {
 assert.deepEqual(validatePlan(openingPlan(), PLAN_SCHEMA), []);
 assert.deepEqual(checkAnswer(openingPlan(), request()), []);
});

test('the answer checks catch names the brief does not offer', () => {
 const plan = openingPlan({
  build_order: [
   {step: 's1', action: 'place', tower: 'SuperMonkey', spot: 'S99', round_from: 3},
   {step: 's1', action: 'upgrade', target: 'dart9', path: 1, tier: 2, round_from: 4},
   {step: 's3', action: 'upgrade', target: 'tower:42', path: 1, tier: 1, round_from: 5, round_by: 4},
   {step: 's4', action: 'place', tower: 'NinjaMonkey', path: 1, round_from: 6},
  ],
  threats: [{threat: 'camo', round: 24, handled_by: ['s9']}], allowed_towers: ['Sniper'], review_round: 3,
 });
 assert.deepEqual(validatePlan(plan, PLAN_SCHEMA), []);
 assert.deepEqual(checkAnswer(plan, request()), [
  'plan.build_order[0].tower SuperMonkey is not in brief.catalog', 'plan.build_order[0].spot S99 is not in brief.spots',
  'plan.build_order[1].step s1 is used twice', 'plan.build_order[1].target dart9 is not the ref of an earlier place step',
  'plan.build_order[2].round_by is before round_from', 'plan.build_order[2].target tower:42 is not in brief.towers',
  'plan.build_order[3].tower NinjaMonkey is not in brief.catalog', 'plan.build_order[3].path is only for upgrade steps',
  'plan.threats[0].handled_by s9 is not a build_order step', 'plan.allowed_towers[0] Sniper is not in brief.catalog',
  'plan.review_round must be after the current round (3)']);
 assert.match(validatePlan({...openingPlan(), priorities: ['a', 'b', 'c', 'd', 'e', 'f']}, PLAN_SCHEMA)[0], /allows at most 5 entries/);
});

test('steps are tracked from the towers they made or by standing on their spot', () => {
 const plan = adoptPlan(openingPlan(), request(), {request_id: 'r1'});
 const s1 = plan.build_order[0], s1spot = plan.spot_positions.S01;
 const state = {...round21(), towers: []};
 assert.equal(stepDone(s1, plan, state, stepContext(plan)), false);
 const placed = {...state, towers: [{id: 3, base_id: 'DartMonkey', tiers: [0, 1, 0], x: s1spot.x + 2, y: s1spot.y - 2, next_upgrades: []}]};
 assert.equal(stepDone(s1, plan, placed, stepContext(plan)), true, 'a dart within 6 units of S01');
 const elsewhere = {...state, towers: [{id: 3, base_id: 'DartMonkey', tiers: [0, 2, 0], x: 500, y: 500, next_upgrades: []}]};
 assert.equal(stepDone(s1, plan, elsewhere, stepContext(plan)), false);
 assert.equal(stepDone(s1, plan, elsewhere, stepContext(plan, {stepTowers: {s1: 3}})), true, 'recorded when it was placed');
 assert.equal(stepDone(plan.build_order[1], plan, elsewhere, stepContext(plan, {stepTowers: {s1: 3}})), true, 'dart1 reached tier 2 on path 2');
 assert.equal(stepDone(plan.build_order[1], plan, placed, stepContext(plan)), false);
});

test('the next step goes in order, except that a step handling a near threat goes first', () => {
 const plan = adoptPlan(openingPlan(), request(), {request_id: 'r1'});
 const empty = {...round21(), towers: []};
 assert.deepEqual(nextStep(plan, {...empty, round: {...empty.round, number: 3}}, {lead: 3, ...stepContext(plan)}), {step: plan.build_order[0], urgent: false, due: true});
 const later = nextStep(plan, {...empty, round: {...empty.round, number: 26}}, {lead: 3, ...stepContext(plan)});
 assert.equal(later.step.step, 's4', 'lead arrives at round 28, three rounds away');
 assert.equal(later.urgent, true);
 const tooEarly = nextStep(plan, {...empty, round: {...empty.round, number: 20}}, {lead: 3, ...stepContext(plan)});
 assert.equal(tooEarly.step.step, 's1');
});

test('a step that cannot happen is reported, as opposed to one that is only unaffordable', () => {
 const plan = adoptPlan(openingPlan(), request(), {request_id: 'r1'});
 const state = round21();
 assert.equal(stepBlocked(plan.build_order[0], plan, state, {...stepContext(plan), catalog, freeSpots}), null);
 assert.equal(stepBlocked(plan.build_order[0], plan, state, {...stepContext(plan), catalog, freeSpots: freeSpots.filter(s => s.id !== 'S01')}), 'spot S01 is not free');
 assert.equal(stepBlocked(plan.build_order[0], plan, state, {...stepContext(plan), catalog, freeSpots, freeSpotsFor: () => freeSpots.filter(s => s.id !== 'S01')}),
  'spot S01 is not free', 'a spot free for the reference tower may not be free for the tower the step places');
 assert.equal(stepBlocked({step: 'x', action: 'place', tower: 'NinjaMonkey', round_from: 1}, plan, state, {catalog, freeSpots}), 'tower NinjaMonkey is not available');
 assert.equal(stepBlocked(plan.build_order[1], plan, state, {...stepContext(plan), catalog, freeSpots}), 'target dart1 does not exist yet');
 const locked = {step: 'u', action: 'upgrade', target: 'tower:7', path: 3, tier: 1, round_from: 1};
 assert.equal(stepBlocked(locked, plan, state, {catalog, freeSpots}), 'upgrade Long Range Darts is locked on this account');
 assert.equal(activeReserve(plan, 21), 400);
 assert.equal(activeReserve(plan, 27), 0);
});

test('the brief gives timing, spots and the previous plan with done steps', () => {
 const plan = adoptPlan(openingPlan(), request(), {request_id: 'r1'});
 const brief = strategistBrief(round21(), {reason: 'threat_ahead', threat: {id: 'camo', round: 24}}, plan, {lead: 3, secondsPerRound: 31, catalog, freeSpots});
 assert.deepEqual(brief.timing, {lead_rounds: 3, seconds_per_round: 31, plan_from_round: 24});
 assert.equal(brief.match.round, 21);
 assert.ok(brief.catalog.every(t => t.tower !== 'NinjaMonkey'), 'locked towers are left out');
 assert.match(brief.spots[0].track, /^covers/);
 assert.deepEqual(brief.threats_ahead.map(t => t.id), ['white', 'camo', 'purple', 'zebra', 'lead', 'rainbow', 'ceramic', 'moab']);
 assert.deepEqual(brief.previous_plan.steps.map(s => s.done), [false, false, false, false]);
 assert.equal(strategistBrief(preRound(), trigger, null, {lead: 3}).timing.plan_from_round, 3, 'before the first round the plan starts now');
});
