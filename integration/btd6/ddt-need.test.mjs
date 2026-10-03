// Deadline-based need in rounds with DDTs (moab.mjs setDdtNeed, moabSpawns, deadlinesOf) and the support-effects DDT figure
// turned on by revision (btd6-jev-v6 revision 20, btd6-playbook-v5 revision 24, btd6-claude-v1 revision 23).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {margin} from './estimate.mjs';
import {moabCheck, moabDue, moabDps, moabSpawns, deadlinesOf, moabDeadlines, hasDdtRound, blendedDps, windowSeconds, setDdtCheck,
 setDdtNeed, ddtNeedOn, ddtNeedFor, setDdtSupport, ddtSupportOn, ddtSupportFor, DDT_NEED_FROM, DDT_SUPPORT_FROM} from './moab.mjs';
import {V6_REVISION} from './policy-v6.mjs';
import {V5_REVISION} from './playbook-v5.mjs';
import {CLAUDE_V1_REVISION} from './plan-v1.mjs';
import {buildView, runModel} from './dashboard.mjs';

const T = (base_id, tiers, id = 0) => ({id, base_id, tiers, level: 1, x: 0, y: 0});
const nonCamo = T('SuperMonkey', [2, 0, 0], 1);   // pops Lead and Black, no camo
const camoOnly = T('DartMonkey', [0, 1, 4], 2);   // camo, no Lead
const druid = T('Druid', [4, 0, 0], 4);           // camo, Lead and Black
const sniper = T('SniperMonkey', [1, 1, 0], 5);   // camo, Lead and Black
const mixed = [nonCamo, camoOnly, druid, sniper];
const W = windowSeconds(2.64);                    // a DDT's kill window on the default track
const ddtSpawn = t => ({t, window: W, hp: 400, ddt: 400});
const topNeed = spawns => Math.max(...deadlinesOf(spawns).map(c => (c.other + c.ddt) / c.seconds));
const opts = {ddt: true, lives: 1};

test('a single bloon gives exactly the per-bloon need', () => {
 const one = deadlinesOf([ddtSpawn(12.3)]);
 assert.equal(one.length, 1);
 assert.equal(one[0].seconds, W, 'its own interval is exactly its window');
 assert.equal(topNeed([ddtSpawn(12.3)]), 400 / W);
 // Round 100 sends one BAD: the deadline need and the per-bloon need are the same record.
 assert.equal(hasDdtRound(100), true);
 for (const towers of [mixed, [druid], []]) {
  const old = moabCheck(towers, 100, {...opts, need: false}), now = moabCheck(towers, 100, {...opts, need: true});
  assert.equal(now.needs_dps, old.needs_dps);
  assert.equal(now.dps, old.dps);
  assert.equal(now.ratio, old.ratio);
  assert.equal(now.count, 1);
 }
});

test('3 DDTs within 1.5 seconds (round 90) need their health over 1.5 s plus one window', () => {
 assert.deepEqual(moabSpawns(90).map(s => s.t), [10.4, 11.15, 11.9]);
 const c = moabCheck(mixed, 90, {...opts, need: true}), old = moabCheck(mixed, 90, {...opts, need: false});
 assert.equal(c.count, 3);
 assert.equal(c.hp_window, 1200);
 assert.equal(c.seconds, +(1.5 + W).toFixed(1));
 assert.equal(c.needs_dps, +(1200 / (1.5 + W) * margin(1, 90)).toFixed(1));
 assert.equal(c.dps, moabDps(mixed, [], {ddt: true}));
 assert.ok(c.needs_dps > 2 * old.needs_dps);
});

test('30 DDTs over 20 seconds need their whole health over 20 s plus one window', () => {
 const spawns = Array.from({length: 30}, (_, i) => ddtSpawn(20 * i / 29));
 assert.ok(Math.abs(topNeed(spawns) - 12000 / (20 + W)) < 1e-9);
 assert.ok(topNeed(spawns) > 6 * 400 / W);
});

test('spawns spaced wider than their windows give the per-bloon need', () => {
 const spawns = [0, W + 0.5, 2 * W + 1, 3 * W + 1.5].map(ddtSpawn);
 assert.equal(topNeed(spawns), 400 / W);
 const top = deadlinesOf(spawns).reduce((a, c) => (c.other + c.ddt) / c.seconds > (a.other + a.ddt) / a.seconds ? c : a);
 assert.equal(top.count, 1, 'the toughest interval holds one bloon');
});

// Every interval, no pruning: the toughest for this figure, as moabCheck chooses it.
function bruteForce(round, towers) {
 const spawns = moabSpawns(round), all = moabDps(towers), ddtDps = moabDps(towers, [], {ddt: true});
 let best = null;
 for (const a of spawns) for (const e of spawns) {
  const seconds = (e.t - a.t) + e.window;
  if (!(seconds > 0)) continue;
  const inside = spawns.filter(s => s.t >= a.t && s.t + s.window <= e.t + e.window);
  const other = inside.reduce((n, s) => n + s.hp - s.ddt, 0), ddt = inside.reduce((n, s) => n + s.ddt, 0), need = (other + ddt) / seconds;
  const dps = ddt > 0 ? +blendedDps(other, ddt, all, ddtDps).toFixed(1) : all, per = dps > 0 ? need / dps : Infinity;
  if (!best || per > best.per || (per === best.per && need > best.need)) best = {per, need, dps, count: inside.length, seconds};
 }
 return best;
}

test('mixed DDT and MOAB rounds: the pruned intervals give the same toughest interval as every interval', () => {
 for (const round of [93, 95, 99]) for (const towers of [mixed, [nonCamo, druid], [druid, sniper]]) {
  const c = moabCheck(towers, round, {...opts, need: true}), b = bruteForce(round, towers);
  assert.equal(c.needs_dps, +(b.need * margin(1, round)).toFixed(1), `round ${round}`);
  assert.equal(c.dps, b.dps, `round ${round}`);
  assert.ok(c.needs_dps / c.dps >= moabCheck(towers, round, {...opts, need: false}).needs_dps / c.dps - 1e-9, 'never lower than the per-bloon need');
 }
 // Round 95: 30 camo DDTs and 50 Fortified MOABs. With no DDT-capable damage beyond one Druid the DDTs decide.
 const r95 = moabCheck([nonCamo, druid], 95, {...opts, need: true});
 assert.ok(r95.count >= 30);
 assert.equal(moabDeadlines(95), moabDeadlines(95), 'cached per round and track length');
});

test('a round without DDTs is unchanged, and moabDue passes the option', () => {
 for (let r = 1; r <= 100; r++) {
  if (hasDdtRound(r)) continue;
  assert.deepEqual(moabCheck(mixed, r, {...opts, need: true}), moabCheck(mixed, r, {...opts, need: false}), `round ${r}`);
 }
 const due = moabDue(mixed, 85, {...opts, need: true, ddtLead: 10}).find(c => c.round === 90);
 assert.equal(due.count, 3);
 assert.equal(moabDue(mixed, 85, {...opts, need: false, ddtLead: 10}).find(c => c.round === 90).count, undefined);
});

test('the session settings: the deadline need and the support figure follow setDdtNeed and setDdtSupport', () => {
 setDdtCheck(true);
 try {
  assert.equal(ddtNeedOn(), false, 'off by default');
  setDdtNeed(true);
  assert.equal(moabCheck(mixed, 90).count, 3);
  setDdtNeed(false);
  assert.equal(moabCheck(mixed, 90).count, undefined);
 } finally { setDdtCheck(false); setDdtNeed(false); }
});

test('revision gating: on from v6 revision 20, v5 revision 24 and claude-v1 revision 23; off for revision 19 and v4', () => {
 assert.deepEqual([V6_REVISION, V5_REVISION, CLAUDE_V1_REVISION], [22, 26, 25]);
 for (const table of [DDT_NEED_FROM, DDT_SUPPORT_FROM]) assert.deepEqual(table, {'btd6-jev-v6': 20, 'btd6-playbook-v5': 24, 'btd6-claude-v1': 23});
 for (const fn of [ddtNeedFor, ddtSupportFor]) {
  assert.equal(fn('btd6-jev-v6'), true);
  assert.equal(fn('btd6-jev-v6', 20), true);
  assert.equal(fn('btd6-jev-v6', 19), false);
  assert.equal(fn('btd6-playbook-v5', 24), true);
  assert.equal(fn('btd6-playbook-v5', 23), false);
  assert.equal(fn('btd6-claude-v1', 23), true);
  assert.equal(fn('btd6-claude-v1', 22), false);
  assert.equal(fn('btd6-jev-v4'), false);
 }
});

const view = revision => { const run = runModel('run.jsonl'); run.add({kind: 'run_start', policy: 'btd6-jev-v6', policy_revision: revision}); buildView({run}); };
test('the dashboard applies the support figure and the deadline need for revision 20 and not for revision 19', () => {
 try {
  view(20);
  assert.deepEqual([ddtSupportOn(), ddtNeedOn()], [true, true]);
  view(19);
  assert.deepEqual([ddtSupportOn(), ddtNeedOn()], [false, false]);
 } finally { setDdtSupport(false); setDdtNeed(false); setDdtCheck(false); }
});

test('moabNearest: with one life the binding targets the nearest due round below 0.5, with its gains; off, the weakest', async () => {
 const {moabShort, moabNearestShort, withMoab} = await import('./policy-v4.mjs');
 const {floorRulesV6} = await import('./policy-v6.mjs');
 const {setMoabCalibration, setMoabDdtLead, MOAB_LEAD_ROUNDS, MOAB_DDT_LEAD_ROUNDS} = await import('./moab.mjs');
 setDdtCheck(true); setDdtNeed(true); setMoabCalibration(1.27); setMoabDdtLead(MOAB_DDT_LEAD_ROUNDS);
 try {
  const superMonkey = T('SuperMonkey', [2, 0, 0], 1), druid4 = T('Druid', [4, 0, 0], 4);
  const state = {in_game: true, round: {number: 86, index: 85}, cash: 30000, lives: 1, match: {end_round: 100}, towers: [superMonkey, druid4]};
  const druid5 = {id: 'upgrade:4:p1', details: {kind: 'upgrade', tower_id: 4, path: 1, tiers_before: '4-0-0', tiers_after: '5-0-0', cost: 20000}};
  const options = [{id: 'wait', details: {kind: 'wait'}}, druid5];
  // Rounds 87 and 88 (ratio 0.3) are the nearest below 0.5; round 95's DDTs are the weakest.
  assert.deepEqual([moabShort(state, []).round, moabNearestShort(state, []).round], [95, 87]);
  const rule = r => r.constraint.rules.find(q => q.kind === 'moab_short');
  const near = floorRulesV6(state, options, {paths: []}), weak = floorRulesV6(state, options, {paths: []}, {moabNearest: false});
  assert.deepEqual([rule(near).round, rule(near).weakest, rule(near).binding], [87, 95, true]);
  assert.deepEqual([rule(weak).round, rule(weak).weakest, rule(weak).binding], [95, undefined, true]);
  assert.equal(near.candidates[0].details.moab, withMoab(state, [druid5], [], {focus: 87})[0].details.moab, 'the gain is for the nearest round');
  assert.equal(weak.candidates[0].details.moab, withMoab(state, [druid5], [], {focus: 95})[0].details.moab);
  // More lives: the weakest, as before.
  assert.equal(floorRulesV6({...state, lives: 2}, options, {paths: []}).candidates.find(c => c.id === druid5.id).details.moab, weak.candidates[0].details.moab);
  // No due round below 0.5: the weakest stands.
  assert.equal(moabNearestShort(state, [], 0.01), null);
  assert.equal(floorRulesV6(state, options, {paths: []}, {moabBindBelow: 0.01}).constraint?.rules?.find(q => q.kind === 'moab_short')?.weakest, undefined);
 } finally { setDdtCheck(false); setDdtNeed(false); setMoabCalibration(1); setMoabDdtLead(MOAB_LEAD_ROUNDS); }
});

test('ddtSaveBest: the DDT saving targets the most DDT gain per dollar, ties to the cheaper; off, the cheapest adder', async () => {
 const {floorRulesV6} = await import('./policy-v6.mjs');
 const {setMoabCalibration, setMoabDdtLead, MOAB_LEAD_ROUNDS, MOAB_DDT_LEAD_ROUNDS} = await import('./moab.mjs');
 setDdtCheck(true); setMoabCalibration(1.27); setMoabDdtLead(MOAB_DDT_LEAD_ROUNDS);
 try {
  // Round 87, one life, $1,000 (as moab-ddt-save.test.mjs): round 90's DDTs are short, nothing affordable adds DDT damage, and the
  // Super Monkey's $900 Lead capacity upgrade keeps threat_short from saving. Pool gains are given
  // (details.moab), as the replay's logged figures: a $1,195 purchase at 0.4 (above the cash, like the replay's $595 Alchemist at lower cash), a Sniper-like $2,375 at 21.2 and a Dart-like
  // $16,200 at 3.
  const state = {in_game: true, round: {number: 87, index: 86}, cash: 1000, lives: 1, match: {end_round: 100}, towers: [T('SuperMonkey', [2, 0, 0], 1), T('Druid', [3, 0, 0], 4)]};
  const buy = (id, cost, moab) => ({id, details: {kind: 'upgrade', tower_id: 4, path: 1, tiers_before: '3-0-0', tiers_after: '4-0-0', cost, moab}});
  const alchemist = buy('alchemist', 1195, 0.4), sniper = buy('sniper', 2375, 21.2), dart = buy('dart', 16200, 3);
  const options = [{id: 'wait', details: {kind: 'wait'}}, {id: 'start_round', details: {kind: 'start_round'}},
   {id: 'upgrade:1:p1', details: {kind: 'upgrade', tower_id: 1, path: 1, tiers_before: '2-0-0', tiers_after: '3-0-0', cost: 900}}];
  // moabNearest off: round 87's ZOMGs, short below 0.5 with these towers, would be the nearest round, which has no DDTs.
  const rule = (pool, opts = {}) => floorRulesV6(state, options, {paths: [], pool}, {moabNearest: false, ...opts}).constraint.rules.find(q => q.kind === 'moab_short');
  assert.deepEqual([rule([dart, alchemist, sniper]).for, rule([dart, alchemist, sniper]).saving], ['sniper', 2375]);
  assert.equal(rule([dart, alchemist, sniper], {ddtSaveBest: false}).for, 'alchemist', 'the cheapest adder');
  // Ties go to the cheaper: the same gain per dollar at twice the cost.
  assert.equal(rule([buy('sniper2', 4750, 42.4), sniper, dart]).for, 'sniper');
  // The binding is unchanged: the option only picks the saving's target.
  assert.equal(rule([dart, alchemist, sniper]).binding, undefined);
 } finally { setDdtCheck(false); setMoabCalibration(1); setMoabDdtLead(MOAB_LEAD_ROUNDS); }
});
