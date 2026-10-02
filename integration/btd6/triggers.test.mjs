import {test} from 'node:test';
import assert from 'node:assert/strict';
import {strategyTrigger, leadRounds} from './triggers.mjs';
import {adoptPlan, requestStamp} from './plan.mjs';
import {preRound, round21, catalog, paths, openingPlan} from './fixtures/index.mjs';
import {pickSpots, gridPoints, pathBounds} from './spots.mjs';

const freeSpots = pickSpots(gridPoints(pathBounds(paths, 20), 10), paths, {radius: 40, count: 8, minSeparation: 20});
const adopt = (plan, state) => adoptPlan(plan, {reason: 'x', stamp: requestStamp(state, {key: 'k'}, {lead: 3, catalog, freeSpots})}, {request_id: 'r1'});
const at = (state, number, extra = {}) => ({...state, round: {...state.round, number}, ...extra});
const context = {lead: 3, catalog, freeSpots};
const noAsks = {asked: {}};

test('lead time: the rounds a slow answer takes at the observed round length, plus one', () => {
 assert.equal(leadRounds(), 4, 'no history: 90 s at 30 s per round, plus one');
 assert.equal(leadRounds({latencies: [20000, 45000], secondsPerRound: 30}), 3);
 assert.equal(leadRounds({latencies: [45000], secondsPerRound: 10}), 6, 'fast-forward shortens rounds, so triggers fire earlier');
 assert.equal(leadRounds({latencies: [1000], secondsPerRound: 60}), 2);
});

test('the first plan of a match is waited for only while the game waits before its first round', () => {
 const opening = strategyTrigger(preRound(), null, noAsks, context);
 assert.deepEqual(opening, {reason: 'match_start', key: `${preRound().match.id}:match_start`, priority: 4, blocking: true});
 assert.equal(strategyTrigger(round21(), null, noAsks, context).blocking, false, 'a runner started mid-match asks without waiting');
 const other = adopt(openingPlan(), preRound());
 assert.equal(strategyTrigger({...round21(), match: {...round21().match, id: 'next-match'}}, other, noAsks, context).reason, 'match_start');
});

test('leaks ask once per round; low lives ask when crossing the plan threshold', () => {
 const plan = adopt(openingPlan({threats: [{threat: 'camo', round: 24, handled_by: ['s1']}, {threat: 'lead', round: 28, handled_by: ['s4']}]}), preRound());
 const leak = strategyTrigger(round21(), plan, noAsks, {...context, livesAtRoundStart: 100});
 assert.deepEqual([leak.reason, leak.detail], ['leak', {round: 21, lives_lost: 2}]);
 assert.equal(strategyTrigger(round21(), plan, {asked: {[leak.key]: 't'}}, {...context, livesAtRoundStart: 100})?.reason ?? null, null);
 const low = strategyTrigger({...round21(), lives: 40}, plan, noAsks, context);
 assert.equal(low.reason, 'low_lives');
 assert.equal(strategyTrigger({...round21(), lives: 40}, {...plan, lives_percent_at: 45}, noAsks, context), null, 'the plan was written below the threshold');
});

test('a threat within the lead time that the plan does not cover asks once', () => {
 const plan = adopt(openingPlan(), preRound());
 const camo = strategyTrigger(at(round21(), 21), plan, noAsks, context);
 assert.equal(camo.reason, 'threat_ahead');
 assert.equal(camo.threat.id, 'camo');
 assert.equal(strategyTrigger(at(round21(), 20), plan, noAsks, context), null, 'round 24 is four rounds away');
 assert.equal(strategyTrigger(at(round21(), 21), plan, {asked: {[camo.key]: 't'}}, context), null);
 const covered = adopt(openingPlan({threats: [{threat: 'camo', round: 24, handled_by: ['s1']}, {threat: 'lead', round: 28, handled_by: ['s4']}]}), preRound());
 assert.equal(strategyTrigger(at(round21(), 21), covered, noAsks, context), null);
});

test('a due step that cannot happen, a finished build order and the review round each ask', () => {
 const base = {threats: [{threat: 'camo', round: 24, handled_by: ['s1']}, {threat: 'lead', round: 28, handled_by: ['s1']}]};
 const blocked = adopt(openingPlan({...base, build_order: [{step: 's1', action: 'place', tower: 'DartMonkey', spot: 'S01', round_from: 3}]}), preRound());
 const off = strategyTrigger(round21(), blocked, noAsks, {...context, freeSpots: freeSpots.filter(s => s.id !== 'S01')});
 assert.deepEqual([off.reason, off.detail], ['off_plan', {step: 's1', problem: 'spot S01 is not free'}]);
 const done = adopt(openingPlan({...base, build_order: [{step: 's1', action: 'upgrade', target: 'tower:7', path: 2, tier: 2, round_from: 3}]}), round21());
 assert.equal(strategyTrigger(round21(), done, noAsks, context).reason, 'plan_done');
 const review = adopt(openingPlan({...base, build_order: [{step: 's1', action: 'place', tower: 'BombShooter', round_from: 90}], review_round: 21}), preRound());
 assert.equal(strategyTrigger(round21(), review, noAsks, context).reason, 'review');
 assert.equal(strategyTrigger({...round21(), match: {...round21().match, result: 'victory'}}, review, noAsks, context), null);
});
