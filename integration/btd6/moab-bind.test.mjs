// moab_short binding with one life (btd6-jev-v6 revision 16, btd6-playbook-v5 revision 20, btd6-claude-v1 revision 19;
// policy-v4.mjs moabBinding, policy-v6.mjs capBinding). Before it moab_short removed only "Wait": in CHIMPS series 1h
// match 3 (log 2026-10-02T00-22-58) it flagged round 40 from round 36 and Jev bought upgrades that added no MOAB damage.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setDdtCheck, setMoabCalibration} from './moab.mjs';
import {floorRulesV4} from './policy-v4.mjs';
import {floorRulesV6, TOWER_CAP} from './policy-v6.mjs';
import {THREAT_KEEP} from './threat.mjs';
import {playbookGameV5} from './game.mjs';
import {loadPlaybook} from './playbook-v5.mjs';
import {meadowPaths as paths} from './fixtures/index.mjs';

const ids = list => list.map(c => c.id);
const kinds = r => (r.constraint?.rules ?? []).map(q => q.kind);
const moabRule = r => r.constraint?.rules?.find(q => q.kind === 'moab_short');
const perDollar = c => c.details.moab / c.details.cost;
const f = JSON.parse(readFileSync(new URL('./fixtures/moab-bind-r40.json', import.meta.url), 'utf8'));
const fTowers = new Map(f.towers.map(t => [t.id, t]));
const stateOf = d => ({in_game: true, match: f.match, round: {index: d.round - 1, number: d.round, active: true, before_first_wave: false}, cash: d.cash, lives: d.lives, starting_lives: 1, max_lives: 1,
 towers: f.tower_sets[d.towers].split(' ').map(s => { const [id, tiers] = s.split(':'); return {...fTowers.get(Number(id)), tiers: tiers.split('-').map(Number)}; })});
const optionsOf = d => d.candidates.map(i => f.options[i]);
const at = (round, cash) => f.decisions.find(d => d.round === round && d.cash === cash);
// The run's settings: the DDT check on and MOAB calibration 1.27.
const run = async fn => { setDdtCheck(true); setMoabCalibration(1.27); try { return await fn(); } finally { setDdtCheck(false); setMoabCalibration(1); } };

test('rounds 36 to 39 of CHIMPS series 1h match 3: revision 15 keeps the logged choices; revision 16 keeps only MOAB adders', () => run(() => {
 assert.equal(f.decisions.length, 30);
 let bound = 0, removed = 0;
 const kept = {};
 for (const d of f.decisions) {
  const state = stateOf(d), options = optionsOf(d);
  const old = floorRulesV6(state, options, {paths}, {moabBinding: false}), neu = floorRulesV6(state, options, {paths});
  assert.deepEqual(kinds(old), d.logged, `round ${d.round} $${d.cash}: revision 15 gives the logged rules`);
  assert.ok(ids(old.candidates).includes(d.chosen), `round ${d.round} $${d.cash}: revision 15 keeps the logged choice`);
  const rule = moabRule(neu);
  if (!rule?.binding) { assert.deepEqual(ids(neu.candidates), ids(old.candidates), `round ${d.round} $${d.cash}: unchanged`); continue; }
  bound++;
  assert.equal(rule.round, 40);
  assert.ok(neu.candidates.every(c => c.details.moab > 0), 'only MOAB adders');
  if (!ids(neu.candidates).includes(d.chosen)) removed++;
  const key = neu.candidates.map(c => `${c.id} ${(perDollar(c) * 1000).toFixed(2)}`).join(', ');
  kept[key] = (kept[key] ?? 0) + 1;
 }
 // 21 decisions bind; 18 logged choices (upgrades with no MOAB gain for round 40, and two weaker placements) are removed.
 assert.deepEqual([bound, removed], [21, 18]);
 // What stays, with the MOAB damage per second added per $1,000. Under the cap no upgrade adds MOAB damage at most of
 // them, so the placement answers pass; where one does, it is chosen.
 assert.deepEqual(kept, {
  'place:Skywarden@S10 2.27, place:Skywarden@S09 1.82': 1,
  'place:SniperMonkey@S12 4.47, place:SniperMonkey@S15 4.47, place:SniperMonkey@S22 4.47, place:SniperMonkey@S09 4.47': 1,
  'place:Skywarden@S10 3.18': 10,
  'place:Skywarden@S10 2.73, place:Skywarden@S11 2.27': 4,
  'place:DartMonkey@S10 1.40': 1,
  'upgrade:65188:p3 2.11': 1,
  'upgrade:65188:p3 0.47': 1,
  'place:Skywarden@S10 2.27, place:Skywarden@S22 1.82': 1,
  'upgrade:24839:p2 0.47': 1,
 });
}));

test('one life binds; two lives and v4 are unchanged', () => run(() => {
 const d = at(36, 341), state = stateOf(d), options = optionsOf(d);
 const neu = floorRulesV6(state, options, {paths});
 const rule = moabRule(neu);
 assert.deepEqual([rule.binding, rule.keep, rule.round, rule.dps, rule.needs_dps, rule.best], [true, THREAT_KEEP, 40, 4.3, 18.8, 0.00227]);
 assert.equal(JSON.stringify(neu.constraint).includes('"answers"'), false, 'the answers are not logged');
 const two = {...state, lives: 2};
 assert.deepEqual(floorRulesV6(two, options, {paths}), floorRulesV6(two, options, {paths}, {moabBinding: false}));
 assert.equal(moabRule(floorRulesV6(two, options, {paths}))?.binding, undefined);
 const v4 = floorRulesV4(state, options, {paths});
 assert.equal(moabRule(v4).binding, undefined, 'v4 frozen');
 assert.ok(ids(v4.candidates).includes(d.chosen));
}));

test("Lead, camo and camo Lead answers stay first; threat_short's binding defers to moab_short", () => run(() => {
 // Without its Dart Monkeys the round-36 defence misses camo (round 36), so threat_short binds on the camo answers.
 const d = at(36, 341), full = stateOf(d);
 const state = {...full, towers: full.towers.filter(t => t.base_id !== 'DartMonkey')}, left = new Set(state.towers.map(t => t.id));
 const options = optionsOf(d).filter(c => c.details.kind !== 'upgrade' || left.has(c.details.tower_id));
 const old = floorRulesV6(state, options, {paths}, {moabBinding: false});
 assert.deepEqual(ids(old.candidates), ['upgrade:5985:p1', 'upgrade:32445:p3']);
 const neu = floorRulesV6(state, options, {paths});
 assert.deepEqual(ids(neu.candidates), ['upgrade:5985:p1', 'upgrade:32445:p3', 'place:Skywarden@S10']);
 const threat = neu.constraint.rules.find(q => q.kind === 'threat_short');
 assert.deepEqual([threat.binding, threat.deferred_to, threat.missing.includes('camo')], [false, 'moab_short', true]);
 assert.deepEqual([moabRule(neu).binding, moabRule(neu).kept_threat], [true, 2]);
 assert.ok(neu.candidates[2].details.moab > 0);
}));

test('under the cap: affordable upgrade answers first, else the placement pass', () => run(() => {
 // Round 39, $248: one upgrade adds MOAB damage (0.47 per $1,000) beside better placements; the cap keeps the upgrade.
 const up = floorRulesV6(stateOf(at(39, 248)), optionsOf(at(39, 248)), {paths});
 assert.deepEqual(ids(up.candidates), ['upgrade:65188:p3']);
 const cap = up.constraint.rules.at(-1);
 assert.deepEqual([cap.kind, cap.cap, cap.cap_binding.rule, cap.cap_binding.kind, cap.cap_binding.allowed, cap.cap_binding.kept],
  ['tower_cap', TOWER_CAP, 'moab_short', 'moab_short', 1, ['upgrade:65188:p3']]);
 // Round 36, $341: no upgrade adds MOAB damage, so the binding's placement answers pass the cap.
 const pass = floorRulesV6(stateOf(at(36, 341)), optionsOf(at(36, 341)), {paths});
 assert.deepEqual(ids(pass.candidates), ['place:Skywarden@S10', 'place:Skywarden@S09']);
 const exc = pass.constraint.rules.at(-1);
 assert.deepEqual([exc.kind, exc.survival, exc.placement_pass], ['tower_cap_exception', ['moab_short'], true]);
}));

test('no affordable MOAB adder: as revision 15 (only "Wait" removed, no saving)', () => run(() => {
 for (const d of [at(39, 248), at(36, 341)]) {
  const state = {...stateOf(d), cash: 50}, options = optionsOf(d);
  const neu = floorRulesV6(state, options, {paths});
  assert.deepEqual(neu, floorRulesV6(state, options, {paths}, {moabBinding: false}));
  assert.equal(moabRule(neu).binding, undefined);
 }
 // A decision where moab_short didn't fire (no MOAB adder on offer) is unchanged.
 const d = at(36, 191);
 assert.deepEqual(floorRulesV6(stateOf(d), optionsOf(d), {paths}), floorRulesV6(stateOf(d), optionsOf(d), {paths}, {moabBinding: false}));
}));

test('a DDT round: only DDT-capable purchases count', () => {
 const T = (base_id, tiers, id) => ({id, base_id, tiers, level: 1, x: 0, y: 0});
 const superMonkey = T('SuperMonkey', [2, 0, 0], 1), druid = T('Druid', [4, 0, 0], 4); // no camo; camo, Lead and Black
 const state = {in_game: true, round: {number: 87, index: 86}, cash: 3000, lives: 1, match: {end_round: 100}, towers: [superMonkey, druid]};
 const up = (t, tiers_after, cost) => ({id: `upgrade:${t.id}:p1`, details: {kind: 'upgrade', tower_id: t.id, path: 1, tiers_before: t.tiers.join('-'), tiers_after, cost}});
 const options = [{id: 'wait', details: {kind: 'wait'}}, up(superMonkey, '3-0-0', 1000), up(druid, '5-0-0', 1500)];
 // Without the DDT check the short round is 87 (ZOMGs) and the Super Monkey's upgrade adds most per dollar.
 const plain = floorRulesV6(state, options, {paths: []});
 assert.deepEqual([moabRule(plain).round, ids(plain.candidates)], [87, ['upgrade:1:p1']]);
 setDdtCheck(true);
 try {
  // With it round 90's DDTs are the shortest, and only the Druid, which hits DDTs, adds to that figure. Revision 18's floor:
  // from revision 19 the Super Monkey's upgrade also stays as a Lead capacity answer (moab-ddt-save.test.mjs).
  const ddt = floorRulesV6(state, options, {paths: []}, {moabCapacity: false, ddtGapShare: 0, moabNearest: false, ddtReach: false, capacitySame: false});
  assert.deepEqual([moabRule(ddt).round, moabRule(ddt).adders, ids(ddt.candidates)], [90, 1, ['upgrade:4:p1']]);
 } finally { setDdtCheck(false); }
});

test('the v5 floor binds too', () => run(async () => {
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 const d = at(39, 248), r = playbookGameV5(() => ({paths}), {playbook}).rules(stateOf(d), optionsOf(d));
 assert.equal(moabRule(r).binding, true);
 assert.ok(r.candidates.every(c => c.details.moab > 0));
}));
