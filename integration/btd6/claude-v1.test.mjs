// Policy btd6-claude-v1: plan checks, targets, enforcement edge cases, triggers, the v3 round-40 replay and a
// dry run with a scripted strategist.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validatePlan} from '../../core/plan-schema.mjs';
import {decide, newStrategyStatus} from '../../core/hierarchical.mjs';
import {fileChannel} from '../../core/strategy-channel.mjs';
import {runLog} from '../../core/runner.mjs';
import {readSeries, scoreRuns} from '../../core/scorecard.mjs';
import {PLAN_SCHEMA_V1, STRATEGIST_INSTRUCTIONS_V1, checkAnswerV1, planTargets, onPlanPurchases, adoptPlanV1, requestStampV1, strategistBriefV1, moabWindows} from './plan-v1.mjs';
import {constrainV1} from './rules-v1.mjs';
import {claudeTrigger, TRIGGERS_V1} from './triggers-v1.mjs';
import {claudeGameV1} from './game.mjs';
import {buildCandidates} from './candidates.mjs';
import {floorRulesV4, groupOptionsV4} from './policy-v4.mjs';
import {scriptedStrategist, simplePlan} from './fake-strategist.mjs';
import {createSession, runConfig, runSession, teeLog} from './session.mjs';
import {computeSpotCatalog} from './spot-catalog.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {parseSetup} from './lifecycle.mjs';
import {runOf, scoreRun} from './progress.mjs';
import {preRound, v0Round6, v0Catalog, meadowPaths as paths, meadowSpots, meadowSpot} from './fixtures/index.mjs';

const tower = (id, base_id, spot, tiers, next_upgrades = []) => ({id, base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y, next_upgrades});
// The best v3 run's towers at round 40 (Hard Standard, 2026-09-30 05:48 UTC), as in policy-v4.test.mjs.
const build40 = () => [
 tower(1, 'MortarMonkey', 'S01', [0, 3, 2], [{path: 1, cost: 1100, id: 'Artillery Battery'}]), tower(2, 'DartMonkey', 'S02', [2, 3, 0]),
 tower(3, 'WizardMonkey', 'S12', [1, 0, 0], [{path: 0, cost: 450, id: 'Fireball'}]), tower(4, 'BombShooter', 'S07', [0, 2, 3]),
 tower(5, 'DartMonkey', 'S03', [2, 3, 0]), tower(6, 'MortarMonkey', 'S06', [0, 3, 2], [{path: 1, cost: 1100, id: 'Artillery Battery'}]),
 tower(7, 'NinjaMonkey', 'S09', [0, 1, 0], [{path: 0, cost: 300, id: 'Ninja Discipline'}]),
 tower(8, 'SniperMonkey', 'S05', [2, 2, 0], [{path: 0, cost: 1300, id: 'Deadly Precision'}]), tower(9, 'DartMonkey', 'S11', [3, 2, 0]),
];
const freeSpots = meadowSpots.filter(s => ['S04', 'S08', 'S10'].includes(s.id));
function between(round, {cash = 1500, towers = build40(), lives = 32} = {}) {
 const s = v0Round6({cash, lives, starting_lives: 100, max_lives: 100, auto_start: true, towers, round: {index: round - 1, active: false, before_first_wave: false}});
 s.match = {...s.match, mode: 'Standard', mode_name: 'Standard', end_round: 80, start_round: 3};
 return s;
}
const options = state => buildCandidates(state, {catalog: v0Catalog, freeSpots, paths});
const ids = list => list.map(c => c.id);
const spends = c => ['place', 'upgrade'].includes(c.details?.kind);
const request = (state, reason = 'match_start') => ({reason, stamp: requestStampV1(state, {key: 'k'}, {lead: 4, catalog: v0Catalog, freeSpots})});
const plan = (extra = {}) => ({summary: 'Mortars carry MOAB damage by round 38.', hero: {tower: 'none', round_from: 3},
 build: [{id: 'moab', tower: 'MortarMonkey', tiers: '0-4-2', count: 2, round_from: 30, round_by: 38, priority: 1}],
 cash_hold: [], threats: [{threat: 'moab', by_round: 38, answer: 'moab'}], note: '', ...extra});
const adopt = (p, state = between(3)) => adoptPlanV1(p, request(state), {request_id: 'r1'});

test('plan checks: the schema, then the request facts', () => {
 const state = between(20), req = request(state);
 assert.deepEqual(validatePlan(plan(), PLAN_SCHEMA_V1), []);
 assert.deepEqual(checkAnswerV1(plan(), req), []);
 const bad = plan({hero: {tower: 'Obyn', round_from: 3}, build: [
  {id: 'a', tower: 'DartMonkey', tiers: '3-3-0', round_from: 10, round_by: 5, priority: 1},
  {id: 'a', tower: 'Quincy', tiers: '0-0-0', spot: 'S99', round_from: 3, round_by: 3, priority: 1},
 ], cash_hold: [{from_round: 30, to_round: 20, amount: 100, for: ['zzz']}], threats: [{threat: 'camo', by_round: 24, answer: 'nope'}], review_round: 20});
 assert.deepEqual(checkAnswerV1(bad, req), [
  'plan.build[0].tiers 3-3-0 breaks the crosspath rule (at most two paths above 0, one above 2)',
  'plan.build[0].round_by is before round_from',
  'plan.build[1].id a is used twice',
  'plan.build[1].tower Quincy is not in brief.catalog (heroes go in plan.hero)',
  'plan.build[1].spot S99 is not in brief.spots',
  'plan.hero.tower Obyn is not in brief.heroes (or "none")',
  'plan.cash_hold[0].to_round is before from_round',
  'plan.cash_hold[0].for zzz is not a build id',
  'plan.threats[0].answer nope is not a build id',
  'plan.review_round must be after the current round (20)',
 ]);
 assert.ok(validatePlan({...plan(), summary: 'x'.repeat(201)}, PLAN_SCHEMA_V1).length, 'long strings are refused');
 assert.ok(validatePlan({...plan(), extra: 1}, PLAN_SCHEMA_V1).length, 'unknown fields are refused');
});

test('targets: towers count toward the first target they can reach, each tower once', () => {
 const p = plan({build: [
  {id: 'darts', tower: 'DartMonkey', tiers: '2-3-0', count: 2, round_from: 3, round_by: 20, priority: 2},
  {id: 'crossbow', tower: 'DartMonkey', tiers: '0-2-4', round_from: 30, round_by: 38, priority: 1},
  {id: 'moab', tower: 'MortarMonkey', tiers: '0-4-2', count: 2, round_from: 30, round_by: 38, priority: 1},
 ]});
 const t = planTargets(p, between(33));
 assert.deepEqual(t.map(x => [x.item.id, x.towers.map(w => w.id), x.done]), [['darts', [2, 5], true], ['crossbow', [], false], ['moab', [1, 6], false]],
  'tower 9 (3-2-0) cannot reach 0-2-4, so the crossbow target has no tower yet');
});

test('enforcement: off-plan purchases go while an on-plan one is affordable; waiting stays', () => {
 const state = between(33), opts = options(state);
 const {candidates, constraint} = constrainV1(state, opts, plan(), {lead: 4, catalog: v0Catalog});
 assert.deepEqual(ids(candidates), ['wait', 'upgrade:1:p2', 'upgrade:6:p2']);
 assert.deepEqual(constraint.rules.map(r => [r.kind, r.removed]), [['no_hero', 3], ['off_plan', 57]]);
 assert.deepEqual(constraint.rules[1].targets, ['moab']);
 // Before round_from, and when nothing on the plan is affordable, the plan removes nothing.
 assert.equal(constrainV1(between(29), options(between(29)), plan({hero: {tower: 'Quincy', round_from: 60}}), {lead: 4, catalog: v0Catalog}).constraint, null);
 const poor = between(33, {cash: 700});
 assert.equal(constrainV1(poor, options(poor), plan({hero: {tower: 'Quincy', round_from: 60}}), {lead: 4, catalog: v0Catalog}).constraint, null);
});

test('enforcement: priority, a threat answer within the lead time, the hero, and at least one option', () => {
 const state = between(33);
 const p = plan({hero: {tower: 'Quincy', round_from: 3}, build: [
  {id: 'snipe', tower: 'SniperMonkey', tiers: '3-2-0', round_from: 30, round_by: 45, priority: 2},
  {id: 'moab', tower: 'MortarMonkey', tiers: '0-4-2', count: 2, round_from: 30, round_by: 38, priority: 3},
 ], threats: [{threat: 'moab', by_round: 38, answer: 'moab'}]});
 const lead2 = constrainV1(state, options(state), p, {lead: 2, catalog: v0Catalog});
 assert.deepEqual(ids(lead2.candidates.filter(spends)).sort(), ['place:Quincy@S04', 'place:Quincy@S08', 'place:Quincy@S10'], 'the hero is priority 1 from its round');
 const noHero = {...p, hero: {tower: 'Quincy', round_from: 60}};
 assert.deepEqual(ids(constrainV1(state, options(state), noHero, {lead: 2, catalog: v0Catalog}).candidates.filter(spends)), ['upgrade:8:p1'], 'priority 2 before 3');
 const urgent = constrainV1(state, options(state), noHero, {lead: 6, catalog: v0Catalog});
 assert.deepEqual(ids(urgent.candidates.filter(spends)), ['upgrade:1:p2', 'upgrade:6:p2'], 'within the lead time of by_round, the threat answer goes first');
 assert.deepEqual(urgent.constraint.rules.at(-1), {kind: 'plan_priority', removed: 1, priority: 0, ids: ['upgrade:8:p1']});
 // With only purchases on offer and a hold that none of them clears, the hold removes nothing.
 const only = options(state).filter(c => c.id === 'upgrade:3:p1');
 assert.deepEqual(ids(constrainV1(state, only, plan({cash_hold: [{from_round: 30, to_round: 38, amount: 5000, for: []}]}), {lead: 2, catalog: v0Catalog}).candidates), ['upgrade:3:p1']);
});

test('enforcement: cash hold, its exemption for the targets it saves for, and survival first', () => {
 const hold = {cash_hold: [{from_round: 30, to_round: 38, amount: 1100, for: ['moab']}], hero: {tower: 'Quincy', round_from: 60}};
 const poor = between(33, {cash: 700});
 const saved = constrainV1(poor, options(poor), plan(hold), {lead: 2, catalog: v0Catalog});
 assert.deepEqual(ids(saved.candidates), ['wait'], 'saving for the Artillery Battery');
 assert.equal(saved.constraint.rules[0].kind, 'cash_hold');
 // The saved-for target may be bought early, before its round_from.
 const early = between(27, {cash: 1500});
 const p = plan({...hold, cash_hold: [{from_round: 25, to_round: 38, amount: 1100, for: ['moab']}]});
 const kept = constrainV1(early, options(early), p, {lead: 2, catalog: v0Catalog}).candidates.filter(spends);
 assert.ok(['upgrade:1:p2', 'upgrade:6:p2'].every(id => ids(kept).includes(id)), 'they leave $400, under the hold, and stay');
 assert.ok(kept.every(c => c.details.cash_after >= 1100 || ['upgrade:1:p2', 'upgrade:6:p2'].includes(c.id)), 'other purchases keep the hold');
 assert.ok(!ids(kept).includes('upgrade:8:p1'));
 // The floor's survival rules come first: no plan filter, and the record says why.
 const floor = {kind: 'rules', rules: [{kind: 'leak_pressure', removed: 1}]};
 const s = constrainV1(poor, options(poor), plan(hold), {lead: 2, catalog: v0Catalog}, {floor});
 assert.equal(s.candidates.length, options(poor).length);
 assert.deepEqual(s.constraint.rules, [{kind: 'survival_first', removed: 0, floor: ['leak_pressure'], hold: 1100}]);
 const short = constrainV1(poor, options(poor), plan(hold), {lead: 2, catalog: v0Catalog}, {floor: {kind: 'rules', rules: [{kind: 'no_start_short', removed: 1}]}});
 assert.equal(short.constraint.rules.at(-1).kind, 'cash_hold_lifted', 'a round the towers are short for lifts the hold');
 // The floor removed waiting (no_wait_behind) and every purchase left spends below the hold: waiting comes back
 // when the round is covered and nothing leaked, as it wasn't in the first claude-v1 match from round 50 on.
 const behind = verdict => ({kind: 'rules', rules: [{kind: 'no_wait_behind', removed: 1, verdict, leaks: 0}]});
 const spending = options(poor).filter(spends);
 const restored = constrainV1(poor, spending, plan(hold), {lead: 2, catalog: v0Catalog}, {floor: behind('enough'), all: options(poor)});
 assert.deepEqual(ids(restored.candidates), ['wait']);
 assert.equal(restored.constraint.rules.at(-1).restored, 'wait');
 const lifted = constrainV1(poor, spending, plan(hold), {lead: 2, catalog: v0Catalog}, {floor: behind('short'), all: options(poor)});
 assert.equal(lifted.candidates.length, spending.length);
 assert.deepEqual(lifted.constraint.rules.at(-1), {kind: 'cash_hold_lifted', removed: 0, amount: 1100, reason: 'no_wait_behind:short'});
});

test('triggers: the opening blocks once with a timeout, then leaks, threats, MOAB windows and reviews', () => {
 const status = {asked: {}};
 const pre = preRound();
 const opening = claudeTrigger(pre, null, status, {lead: 4, openingTimeoutMs: 1000});
 assert.deepEqual(opening, {reason: 'match_start', key: `${pre.match.id}:match_start`, priority: 4, blocking: true, timeoutMs: 1000});
 assert.equal(claudeTrigger(pre, null, {asked: {[opening.key]: 't'}}, {lead: 4}).blocking, undefined, 'after a timeout the same request stays, without waiting');
 assert.equal(claudeTrigger(between(21), null, status, {lead: 4}).blocking, undefined, 'mid-match: no wait');

 const p = adopt(plan({review_round: 60}));
 const m = p.match_id, ask = (...keys) => ({asked: Object.fromEntries(keys.map(k => [`${m}:${k}`, 't']))});
 assert.equal(claudeTrigger(between(21, {lives: 50}), p, {asked: {}}, {lead: 4, livesAtRoundStart: 55})?.reason, 'threat_ahead', '5 lives lost is not more than 5');
 const leak = claudeTrigger(between(21, {lives: 50}), p, {asked: {}}, {lead: 4, livesAtRoundStart: 56});
 assert.deepEqual([leak.reason, leak.detail], ['big_leak', {round: 21, lives_lost: 6, threshold: 5}]);
 // Camo (24) and purple (25) come in one request; lead (28) later; a met answer doesn't ask.
 const threat = claudeTrigger(between(20), p, {asked: {}}, {lead: 4});
 assert.deepEqual([threat.key, threat.detail.threats.map(t => t.threat)], [`${m}:threat:camo+purple`, ['camo', 'purple']]);
 assert.equal(claudeTrigger(between(20), p, ask('threat:camo+purple'), {lead: 4}), null);
 assert.equal(claudeTrigger(between(23), p, ask('threat:camo+purple'), {lead: 4}).key, `${m}:threat:lead`);
 const camoMet = adopt(plan({review_round: 60, threats: [{threat: 'camo', by_round: 24, answer: 'ninja'}], build: [{id: 'ninja', tower: 'NinjaMonkey', tiers: '0-1-0', round_from: 3, round_by: 20, priority: 1}]}));
 assert.equal(claudeTrigger(between(20), camoMet, {asked: {}}, {lead: 4}).key, `${m}:threat:purple`);
 // MOAB windows: the round-40 window asks at round 32 with a lead of 4, and covers the moab threat.
 assert.deepEqual(moabWindows(3, 80), [{from: 40, to: 40}, {from: 50, to: 58}, {from: 60, to: 68}, {from: 70, to: 79}, {from: 80, to: 80}]);
 const done38 = ask('threat:camo+purple', 'threat:lead', 'threat:ceramic');
 assert.equal(claudeTrigger(between(31), p, done38, {lead: 4}), null);
 assert.equal(claudeTrigger(between(32), p, done38, {lead: 4}).key, `${m}:moab:40-40`);
 assert.equal(claudeTrigger(between(34), p, ask('threat:camo+purple', 'threat:lead', 'threat:ceramic', 'moab:40-40'), {lead: 4}), null, 'the MOAB threat is covered by its window');
 // Review: the plan's review_round, or 10 rounds after its request.
 const r = adopt(plan(), between(12));
 assert.equal(claudeTrigger(between(22), r, ask('threat:camo+purple'), {lead: 1}).reason, 'review');
 // The cap: after MAX_CONSULTS requests only match_start asks.
 const many = {asked: Object.fromEntries(Array.from({length: TRIGGERS_V1.MAX_CONSULTS}, (_, i) => [`${m}:x${i}`, 't']))};
 assert.equal(claudeTrigger(between(21, {lives: 10}), p, many, {lead: 4, livesAtRoundStart: 50}), null);
});

test('replay of the v3 round-40 loss: an opening plan for MOAB damage by round 38 changes what Jev sees before round 36', async () => {
 const opening = adopt(plan({cash_hold: [{from_round: 30, to_round: 38, amount: 1100, for: ['moab']}]}));
 const status = {...newStrategyStatus({enabled: true}), plan: opening};
 const context = {lead: 4, catalog: v0Catalog, paths, freeSpots};
 const game = claudeGameV1(() => context);
 const channel = {current: async () => ({id: 'r1', key: `${opening.match_id}:match_start`, priority: 4}), take: async () => null, post: async () => { throw Error('no request expected'); }};
 for (const round of [33, 35]) {
  const state = between(round);
  // v4 alone: nothing forces the MOAB upgrades yet, and 15 other groups compete with them.
  const v4 = groupOptionsV4(state, floorRulesV4(state, options(state), {paths}).candidates, {catalog: v0Catalog, paths});
  assert.equal(floorRulesV4(state, options(state), {paths}).constraint, null, `round ${round}: v4's moab_short starts at 36`);
  assert.ok(v4.length >= 10 && v4.some(g => g.id === 'upgrade:1'));
  const questions = [];
  const r = await decide({state, candidates: options(state), game, strategist: {channel, status}, ask: async q => { questions.push(q); return {model: 'jev-test', answers: {move: {type: 'choice', choice: 'upgrade:1:p2', confidence: 0.9}}, usage: {input_tokens: 10, output_tokens: 1}}; }});
  const offered = Object.keys(questions.at(-1).questions.move.criteria);
  assert.ok(offered.every(id => ['wait', 'upgrade:1', 'upgrade:6', 'upgrade:1:p2', 'upgrade:6:p2'].includes(id)), `round ${round}: only waiting or the Artillery Batteries (${offered})`);
  assert.equal(r.choice.id, 'upgrade:1:p2');
  assert.deepEqual(r.planInForce, {request_id: 'r1', reason: 'match_start', round_at: 3, adopted_at: null, revision: 25});
  assert.ok(r.constraint.rules.some(x => x.kind === 'off_plan'));
  assert.deepEqual(questions.at(-1).state.plan, {summary: 'Mortars carry MOAB damage by round 38.', next: ['MortarMonkey 0-4-2 x2 by round 38'], hold_cash: 1100});
 }
 // Short of cash, the hold keeps the money for the upgrade instead of letting Jev spend it (no Jev call).
 const poor = between(34, {cash: 700});
 const held = await decide({state: poor, candidates: options(poor), game, strategist: {channel, status}, ask: async () => { throw Error('no Jev call expected'); }});
 assert.deepEqual([held.decisionSource, held.choice.id], ['plan', 'wait']);
 // From round 36, v4's moab_short is in force and the plan steps aside (survival first).
 const r36 = between(36);
 const floor = floorRulesV4(r36, options(r36), {paths});
 assert.deepEqual(game.constrain(r36, floor.candidates, opening, status, {floor: floor.constraint}).constraint.rules, [{kind: 'survival_first', removed: 0, floor: ['moab_short'], hold: 1100}]);
});

test('the brief is self-contained and modest in size', () => {
 const state = between(33), p = adopt(plan());
 const brief = strategistBriefV1(state, {reason: 'moab_window', detail: {from: 40, to: 40}}, p, {lead: 4, secondsPerRound: 12, catalog: v0Catalog, freeSpots, paths}, {requests: 3, answers: 3, late: 1});
 assert.deepEqual(brief.moab.windows[0], {rounds: '40', first: '1 MOAB', health: 200, needs_dps: 14.4});
 assert.equal(brief.previous_plan.build[0].have.join(' '), '0-3-2 0-3-2');
 assert.ok(brief.tower_facts.MortarMonkey.moab_dps.length);
 const size = JSON.stringify({instructions: STRATEGIST_INSTRUCTIONS_V1, schema: PLAN_SCHEMA_V1, brief}).length;
 assert.ok(size < 16000, `request is ${size} characters`);
});

test('run config: claude-v1 uses the strategist, graded speed like v4, and an opening timeout', () => {
 const c = runConfig(['--dry-run', '--policy', 'claude-v1']);
 assert.deepEqual([c.policy, c.strategist, c.speed.label, c.openingTimeoutMs, c.fakeStrategist], ['btd6-claude-v1', true, 'graded:10', 300000, true]);
 assert.equal(runConfig(['--dry-run', '--policy', 'claude-v1', '--opening-timeout', '60', '--no-fake-strategist']).fakeStrategist, false);
 assert.throws(() => runConfig(['--dry-run', '--policy', 'claude-v1', '--opening-timeout', 'x']), /opening-timeout/);
 // Calibration factors pinned for a series.
 assert.deepEqual([c.moabFactor, c.popsFactor], [null, null]);
 const pinned = runConfig(['--dry-run', '--policy', 'claude-v1', '--moab-factor', '2.5', '--pops-factor', '1.2']);
 assert.deepEqual([pinned.moabFactor, pinned.popsFactor], [2.5, 1.2]);
 assert.throws(() => runConfig(['--dry-run', '--policy', 'claude-v1', '--pops-factor', '0']), /pops-factor/);
 assert.throws(() => runConfig(['--dry-run', '--policy', 'claude-v1', '--moab-factor', 'x']), /moab-factor/);
 assert.equal(runConfig(['--dry-run', '--policy', 'jev-v4']).strategist, false);
});

test('hierarchical: a blocking consult with a timeout plays on without the answer, and later adopts it', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-claude-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const channel = fileChannel(dir), status = newStrategyStatus({enabled: true});
 const state = {...preRound(), towers: []};
 const game = claudeGameV1(() => ({lead: 2, catalog: v0Catalog, freeSpots, paths}), {openingTimeoutMs: 3000});
 const candidates = buildCandidates(state, {catalog: v0Catalog, freeSpots, paths});
 const ask = async q => ({model: 'jev-test', answers: {move: {type: 'choice', choice: Object.keys(q.questions.move.criteria).find(id => id.startsWith('place')), confidence: 1}}, usage: {input_tokens: 1, output_tokens: 1}});
 let slept = 0;
 const first = await decide({state, candidates, game, strategist: {channel, status}, ask, sleep: async ms => { slept += ms; }, pollMs: 1000});
 assert.equal(slept, 3000);
 assert.deepEqual(first.strategyEvents.map(e => e.kind), ['strategy_request', 'strategy_timeout']);
 assert.equal(first.planInForce, null);
 assert.equal(first.decisionSource, 'jev');
 const again = await decide({state, candidates, game, strategist: {channel, status}, ask, sleep: async () => { throw Error('no wait expected'); }});
 assert.deepEqual(again.strategyEvents, [], 'the request stays posted; no second wait');
 const req = await channel.current();
 await channel.answer(req.id, simplePlan(req));
 const third = await decide({state, candidates, game, strategist: {channel, status}, ask});
 assert.equal(third.strategyEvents[0].kind, 'strategy_adopted');
 assert.equal(third.planInForce.request_id, req.id);
});

test('the examples in docs/BTD6-STRATEGIST.md pass the schema and the answer checks', async () => {
 const doc = await readFile(new URL('../../docs/BTD6-STRATEGIST.md', import.meta.url), 'utf8');
 const blocks = [...doc.split('## Examples')[1].matchAll(/```json\r?\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));
 assert.equal(blocks.length, 2);
 for (const [n, p] of blocks.entries()) {
  const state = between(n ? 33 : 3, {towers: []});
  const req = {reason: 'x', stamp: requestStampV1(state, {key: 'k'}, {lead: 4, catalog: v0Catalog, freeSpots: meadowSpots})};
  assert.deepEqual([...validatePlan(p, PLAN_SCHEMA_V1), ...checkAnswerV1(p, req)], [], `example ${n + 1}`);
 }
});

const read = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
test('dry run with a scripted strategist: an invalid answer, a late one, plans logged per decision', {timeout: 60000}, async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-claude-run-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = fakeGame({required: () => 0, endRound: 45});
 const usage = {requests: 0, inputTokens: 0}, limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9};
 const s = createSession({policy: 'btd6-claude-v1', setup: parseSetup('MonkeyMeadow/Hard/Standard'), limits, usage});
 const invalid = req => ({...simplePlan(req), build: [{id: 'x', tower: 'NotATower', tiers: '5-5-5', round_from: 3, round_by: 4, priority: 1}]});
 const channel = scriptedStrategist(fileChannel(join(dir, 'strategy')), {
  script: [{plan: invalid}, {plan: simplePlan}, {plan: simplePlan, afterRounds: 8}], fallback: simplePlan, round: () => s.state?.round?.number ?? null});
 const strategist = {channel, status: newStrategyStatus({enabled: true})};
 const file = runLog(join(dir, 'run.jsonl')), series = runLog(join(dir, 'series.jsonl'));
 const outcome = await runSession({bridge: fake.bridge, ask: fakeJev({usage, limits}), log: teeLog(file, s), series, session: s, setup: s.setup, limits, usage,
  loadSpots: async () => (await computeSpotCatalog(fake.bridge)).spots, timings: {pollMs: 0, pausedPollMs: 0, minIntervalMs: 0, lifecyclePollMs: 0, homeAfterResultMs: 50, strategyPollMs: 1},
  sleep: async () => {}, dryRun: true, policy: 'btd6-claude-v1', strategist, openingTimeoutMs: 5000, speed: 3});
 assert.equal(outcome.result, 'victory');
 assert.deepEqual(channel.record.slice(0, 2).map(r => [r.reason, r.outcome]), [['match_start', 'rejected'], ['match_start', 'delivered']]);
 assert.match(channel.record[0].errors.join('\n'), /NotATower is not in brief.catalog/);
 const events = await read(file.file);
 const requests = events.filter(e => e.kind === 'strategy_request'), adopted = events.filter(e => e.kind === 'strategy_adopted');
 assert.equal(requests[0].blocking, true);
 assert.ok(requests.length >= 3 && requests.length <= TRIGGERS_V1.MAX_CONSULTS, `${requests.length} requests`);
 assert.ok(adopted.some(e => e.late), 'the answer given 8 rounds after its request is counted late');
 const decisions = events.filter(e => e.kind === 'decision' && e.decisionSource !== 'forced');
 assert.ok(decisions.every(e => 'plan' in e), 'each decision names the plan in force');
 assert.ok(decisions.some(e => e.plan?.request_id === adopted.at(-1).request_id));
 assert.equal(events.find(e => e.kind === 'run_start').policy_revision, 25, 'revision 25: reachable DDT saving targets and same-round capacity answers');
 assert.ok(decisions.filter(e => e.plan).every(e => e.plan.revision === 25));
 assert.ok(decisions.some(e => e.constraint?.rules?.some(r => r.kind === 'off_plan')));
 const [entry] = await read(series.file);
 assert.deepEqual([entry.policy, entry.mode, entry.label], ['btd6-claude-v1', 'strategist', 'btd6-claude-v1']);
 const [score] = scoreRuns(events, await readSeries(series.file), {runOf, score: scoreRun});
 assert.equal(score.policy, 'btd6-claude-v1');
 assert.equal(score.strategist.requests, requests.length);
 assert.equal(score.strategist.late, adopted.filter(e => e.late).length);
 // How the request looks to the answering session: size of what `show` prints.
 const shown = JSON.stringify({instructions: STRATEGIST_INSTRUCTIONS_V1, schema: PLAN_SCHEMA_V1});
 assert.ok(shown.length < 8000);
});
