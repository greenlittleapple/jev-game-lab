// btd6-jev-v6 revision 22, btd6-playbook-v5 revision 26, btd6-claude-v1 revision 25 (policy-v4.mjs ddtReach and capacitySame):
// the DDT saving saves only for a purchase reachable before its round with the expected CHIMPS income (income.mjs), and with one
// life camo and Lead capacity answers due at moab_short's short round stay under its binding and saving.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setDdtCheck, setMoabCalibration, setMoabDdtLead, MOAB_LEAD_ROUNDS, MOAB_DDT_LEAD_ROUNDS} from './moab.mjs';
import {floorRulesV4} from './policy-v4.mjs';
import {floorRulesV6, V6_REVISION} from './policy-v6.mjs';
import {playbookGameV5, claudeGameV1} from './game.mjs';
import {loadPlaybook, V5_REVISION} from './playbook-v5.mjs';
import {CLAUDE_V1_REVISION} from './plan-v1.mjs';
import {setIncomeTable, expectedIncome, incomeTable, matchIncome} from './income.mjs';

const ids = list => list.map(c => c.id);
const moabRule = r => r.constraint?.rules?.find(q => q.kind === 'moab_short');
const threatRule = r => r.constraint?.rules?.find(q => q.kind === 'threat_short');
const R21 = {ddtReach: false, capacitySame: false};
const settings = async (fn, income = null) => {
 setDdtCheck(true); setMoabCalibration(1.27); setMoabDdtLead(MOAB_DDT_LEAD_ROUNDS); if (income) setIncomeTable({income});
 try { return await fn(); } finally { setDdtCheck(false); setMoabCalibration(1); setMoabDdtLead(MOAB_LEAD_ROUNDS); setIncomeTable(null); }
};
const T = (base_id, tiers, id) => ({id, base_id, tiers, level: 1, x: 0, y: 0});
const up = (t, tiers_after, cost, id = `upgrade:${t.id}:p1`, path = 1) => ({id, details: {kind: 'upgrade', tower_id: t.id, path, tiers_before: t.tiers.join('-'), tiers_after, cost}});
const pass = [{id: 'wait', details: {kind: 'wait'}}, {id: 'start_round', details: {kind: 'start_round'}}];

test('the income table: every CHIMPS round from 6 to 100 has a figure, and the expected income sums the rounds given', () => {
 setIncomeTable(null);
 for (let n = 6; n <= 100; n++) assert.ok(Number.isFinite(expectedIncome(n, n)) && expectedIncome(n, n) > 0, `round ${n}`);
 assert.equal(expectedIncome(88, 89), expectedIncome(88, 88) + expectedIncome(89, 89));
 assert.equal(expectedIncome(90, 89), 0);
});

test('the income measure: cash at the next round minus the cash now, plus the executed purchases; failed ones and dry runs left out', () => {
 const match = {id: 'm', mode: 'Clicks', difficulty: 'Hard'};
 const dec = (n, cash, chosen = {id: 'wait', label: 'Wait', command: null}) => ({kind: 'decision', state: {in_game: true, match, round: {number: n}, cash}, chosen});
 const buy = cost => ({id: 'x', label: `Upgrade X ($${cost})`, command: {action: 'upgrade_tower'}});
 const done = (status = 'executed') => ({kind: 'dispatch', outcome: 'executed', result: {action: 'upgrade_tower', status}});
 const records = [dec(40, 1000), dec(40, 1500, buy(1200)), done(), dec(40, 400, buy(5000)), done('failed'),
  dec(41, 900), dec(41, 950), dec(43, 3000), dec(44, 3500), {kind: 'run_end'}];
 // Round 40: 900 - 1000 + 1200; round 41 has no round 42 after it; round 43: 500; round 44 ends the log.
 assert.deepEqual(matchIncome(records), [{40: 1100, 43: 500}]);
 assert.deepEqual(matchIncome([{kind: 'session_start', dry_run: true}, ...records]), []);
 // Rounds without enough logs take the average of the nearest measured rounds on each side.
 const t = incomeTable([{records}], {first: 40, last: 44, minLogs: 1});
 assert.deepEqual([t.income, t.samples, t.filled], [{40: 1100, 41: 800, 42: 800, 43: 500, 44: 800}, {40: 1, 41: 0, 42: 0, 43: 1, 44: 0}, [41, 42, 44]]);
});

// Round 87 with $1,000 (moab-ddt-save.test.mjs): round 90's DDTs are short and nothing affordable adds DDT damage. The Druid's
// 4-0-0 adds 8 DDT damage per second, its 5-0-0 59.4. moabNearest: false keeps round 90 as the short round (the nearest below
// 0.5 is round 87, which has no DDTs).
const savingState = () => ({in_game: true, round: {number: 87, index: 86}, cash: 1000, lives: 1, match: {end_round: 100},
 towers: [T('SuperMonkey', [2, 0, 0], 1), T('Druid', [3, 0, 0], 4)]});
const superUp = up(T('SuperMonkey', [2, 0, 0], 1), '3-0-0', 900);
const druid4 = up(T('Druid', [3, 0, 0], 4), '4-0-0', 4500);
const druid5 = cost => up(T('Druid', [3, 0, 0], 4), '5-0-0', cost, 'upgrade:4:p1:5');
const save = (pool, opts = {}) => floorRulesV6(savingState(), [...pass, superUp], {paths: [], pool}, {moabNearest: false, ...opts});

test('an unreachable $34,560 target is not saved for; with the income to reach it, it is', () => settings(() => {
 const pool = [superUp, druid5(34560)];
 // Revision 21 saves for it whatever the income.
 assert.equal(moabRule(save(pool, R21)).saving, 34560);
 setIncomeTable({income: {88: 5000, 89: 5000}});
 const none = save(pool);
 // No saving and no binding (nothing affordable adds DDT damage): the options aren't cut to the pass options.
 assert.deepEqual([moabRule(none)?.saving, moabRule(none)?.binding], [undefined, undefined]);
 assert.ok(ids(none.candidates).includes('upgrade:1:p1'));
 setIncomeTable({income: {88: 20000, 89: 20000}});
 const r = moabRule(save(pool));
 assert.deepEqual([r.saving, r.for, r.round, r.income, r.reach, r.cash], [34560, 'upgrade:4:p1:5', 90, 40000, 41000, 1000]);
}));

test('only the rounds that complete before the target round count: not the current one, nor the target itself', () => settings(() => {
 setIncomeTable({income: {87: 1e6, 88: 0, 89: 0, 90: 1e6}});
 assert.equal(moabRule(save([druid5(34560)]))?.saving, undefined);
 setIncomeTable({income: {87: 0, 88: 16780, 89: 16780, 90: 0}});
 const r = moabRule(save([druid5(34560)]));
 assert.deepEqual([r.saving, r.reach], [34560, 34560]);
}));

test('among the reachable targets, the most gain per dollar', () => settings(() => {
 // At $20,000 the Druid's 5-0-0 gives more per dollar (59.4 for 20,000) than its 4-0-0 (8 for 4,500).
 const pool = [superUp, druid4, druid5(20000)];
 assert.equal(moabRule(save(pool, R21)).for, 'upgrade:4:p1:5');
 setIncomeTable({income: {88: 2000, 89: 2000}});
 const near = moabRule(save(pool));
 assert.deepEqual([near.saving, near.for, near.reach], [4500, 'upgrade:4:p1', 5000]);
 setIncomeTable({income: {88: 10000, 89: 10000}});
 const far = moabRule(save(pool));
 assert.deepEqual([far.saving, far.for], [20000, 'upgrade:4:p1:5']);
}));

// Round 87 with four Ninja 4-0-2s: round 90 is short for DDT damage (the Druid's 5-0-0 at $30,000 adds it) and due for camo
// capacity (rate 0.63) and Lead capacity, the same round. The Sniper's 0-2-0 ($300) adds 0.0176 to the camo rate, past the 5%
// bar (0.05 x 0.37 = 0.0185 is the bar for the best answer, the Ninja's 3-0-2 at 0.026), and has the best camo gain per
// dollar; the Super Monkey's 3-0-0 ($900) adds Lead capacity.
const sameState = cash => ({in_game: true, round: {number: 87, index: 86}, cash, lives: 1, match: {end_round: 100},
 towers: [T('SuperMonkey', [2, 0, 0], 1), T('Druid', [4, 0, 0], 4), T('NinjaMonkey', [2, 0, 2], 7), T('SniperMonkey', [0, 1, 0], 8),
  ...Array.from({length: 4}, (_, i) => T('NinjaMonkey', [4, 0, 2], 20 + i))]});
const druidTop = up(T('Druid', [4, 0, 0], 4), '5-0-0', 30000);
const sameOptions = [...pass, up(T('SniperMonkey', [0, 1, 0], 8), '0-2-0', 300, 'upgrade:8:p2', 2), up(T('NinjaMonkey', [2, 0, 2], 7), '3-0-2', 850),
 up(T('SuperMonkey', [2, 0, 0], 1), '3-0-0', 900), druidTop];
const same = (cash, opts = {}) => floorRulesV6(sameState(cash), sameOptions, {paths: [], pool: [druidTop]}, opts);

test('same-round camo and Lead answers stay under the binding: after the check answers, before the MOAB adders', () => settings(() => {
 const old = same(40000, R21), neu = same(40000);
 assert.deepEqual([moabRule(old).binding, ids(old.candidates), threatRule(old)], [true, ['upgrade:4:p1'], undefined]);
 assert.deepEqual([moabRule(neu).binding, moabRule(neu).round, moabRule(neu).kept_capacity, ids(neu.candidates)], [true, 90, 2, ['upgrade:8:p2', 'upgrade:1:p1', 'upgrade:4:p1']]);
 const t = threatRule(neu);
 assert.deepEqual([t.missing, t.at_moab, t.binding, t.deferred_to], [['camo_capacity', 'lead_capacity'], 90, false, 'moab_short']);
 // More lives: unchanged.
 const two = {...sameState(40000), lives: 2};
 assert.deepEqual(floorRulesV6(two, sameOptions, {paths: [], pool: [druidTop]}), floorRulesV6(two, sameOptions, {paths: [], pool: [druidTop]}, R21));
}, {88: 15000, 89: 15000}));

test('same-round camo and Lead answers stay under the saving: after the check answers, before the pass options', () => settings(() => {
 const old = same(1000, R21), neu = same(1000);
 assert.deepEqual([moabRule(old).saving, ids(old.candidates)], [30000, ['wait', 'start_round']]);
 assert.deepEqual([moabRule(neu).saving, moabRule(neu).kept_capacity, ids(neu.candidates)], [30000, 2, ['upgrade:8:p2', 'upgrade:1:p1', 'wait', 'start_round']]);
 assert.equal(threatRule(neu).deferred_to, 'moab_short');
}, {88: 15000, 89: 15000}));

test('a camo_capacity answer short of the 5% bar is not kept; the Lead answer still is', () => settings(() => {
 // Without the four Ninjas the camo rate is 0.06 and no affordable answer adds 5% of the gap (moabNearest: false keeps round 90,
 // as for savingState).
 const s = {...sameState(1000), towers: sameState(1000).towers.slice(0, 4)};
 const r = floorRulesV6(s, sameOptions, {paths: [], pool: [druidTop]}, {moabNearest: false});
 assert.deepEqual([moabRule(r).saving, moabRule(r).kept_capacity, ids(r.candidates), threatRule(r).missing], [30000, 1, ['upgrade:1:p1', 'wait', 'start_round'], ['lead_capacity']]);
}, {88: 15000, 89: 15000}));

test('revision gating: on from v6 22, v5 26 and claude-v1 25; off in v4 by default', () => settings(async () => {
 assert.deepEqual([V6_REVISION, V5_REVISION, CLAUDE_V1_REVISION, claudeGameV1(() => ({})).revision], [22, 26, 25, 25]);
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 const context = () => ({paths: [], pool: [druidTop]});
 for (const rules of [playbookGameV5(context, {playbook}).rules, claudeGameV1(context).rules]) {
  const r = rules(sameState(1000), sameOptions);
  assert.deepEqual([moabRule(r).saving, moabRule(r).kept_capacity, moabRule(r).reach], [30000, 2, 31000]);
 }
 const v4 = floorRulesV4(sameState(1000), sameOptions, {paths: [], pool: [druidTop]}, {threatShort: true, moabBinding: true, moabSaving: true});
 assert.deepEqual([moabRule(v4)?.kept_capacity, moabRule(v4)?.reach], [undefined, undefined]);
}, {88: 15000, 89: 15000}));
