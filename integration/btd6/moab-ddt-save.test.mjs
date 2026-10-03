// btd6-jev-v6 revision 19, btd6-playbook-v5 revision 23, btd6-claude-v1 revision 22 (policy-v4.mjs moabCapacity and ddtGapShare):
// with one life, moab_short's DDT binding and saving keep threat_short's camo and Lead capacity answers, and the DDT saving
// targets only a purchase that adds at least a quarter of the short round's gap (DDT_GAP_SHARE).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setDdtCheck, setMoabCalibration, setMoabDdtLead, MOAB_LEAD_ROUNDS, MOAB_DDT_LEAD_ROUNDS} from './moab.mjs';
import {moabShort, withMoab, DDT_GAP_SHARE} from './policy-v4.mjs';
import {floorRulesV6, applyTowerCap, TOWER_CAP, V6_REVISION} from './policy-v6.mjs';
import {withBindAnswers, THREAT_KEEP} from './threat.mjs';
import {playbookGameV5, claudeGameV1} from './game.mjs';
import {loadPlaybook, V5_REVISION} from './playbook-v5.mjs';
import {CLAUDE_V1_REVISION} from './plan-v1.mjs';
import {meadowPaths as paths} from './fixtures/index.mjs';

const ids = list => list.map(c => c.id);
const moabRule = r => r.constraint?.rules?.find(q => q.kind === 'moab_short');
const threatRule = r => r.constraint?.rules?.find(q => q.kind === 'threat_short');
const R18 = {moabCapacity: false, ddtGapShare: 0, moabNearest: false, ddtSaveBest: false, ddtReach: false, capacitySame: false};
// Revision 19's rule options (revision 20 turns moabCapacity and ddtGapShare off and moabNearest on; these states also have a short MOAB round 87 below 0.5).
const R19 = {moabCapacity: true, ddtGapShare: DDT_GAP_SHARE, moabNearest: false, ddtSaveBest: false, ddtReach: false, capacitySame: false};
const settings = async (fn, {lead = MOAB_DDT_LEAD_ROUNDS} = {}) => {
 setDdtCheck(true); setMoabCalibration(1.27); setMoabDdtLead(lead);
 try { return await fn(); } finally { setDdtCheck(false); setMoabCalibration(1); setMoabDdtLead(MOAB_LEAD_ROUNDS); }
};

// Two towers with no track (moab-ddt.test.mjs): a Super Monkey 2-0-0 (no camo; its 3-0-0 adds Lead capacity, nothing against
// DDTs) and a Druid, which hits DDTs. Round 90's DDTs are the short round.
const T = (base_id, tiers, id) => ({id, base_id, tiers, level: 1, x: 0, y: 0});
const up = (t, tiers_after, cost, id = `upgrade:${t.id}:p1`) => ({id, details: {kind: 'upgrade', tower_id: t.id, path: 1, tiers_before: t.tiers.join('-'), tiers_after, cost}});
const pass = [{id: 'wait', details: {kind: 'wait'}}, {id: 'start_round', details: {kind: 'start_round'}}];

test('constants and revisions', () => {
 assert.equal(DDT_GAP_SHARE, 0.25);
 assert.deepEqual([V6_REVISION, V5_REVISION, CLAUDE_V1_REVISION, claudeGameV1(() => ({})).revision], [22, 26, 25, 25]);
});

test('binding on a DDT round keeps the capacity answers after the check answers and before the MOAB adders', () => settings(() => {
 const superMonkey = T('SuperMonkey', [2, 0, 0], 1), druid = T('Druid', [4, 0, 0], 4);
 const state = {in_game: true, round: {number: 87, index: 86}, cash: 3000, lives: 1, match: {end_round: 100}, towers: [superMonkey, druid]};
 const options = [pass[0], up(superMonkey, '3-0-0', 1000), up(druid, '5-0-0', 1500)];
 const neu = floorRulesV6(state, options, {paths: []}, R19), old = floorRulesV6(state, options, {paths: []}, R18);
 assert.deepEqual([moabRule(old).binding, ids(old.candidates), moabRule(old).kept_capacity], [true, ['upgrade:4:p1'], undefined]);
 // The Druid's upgrade adds camo capacity and MOAB damage; the Super Monkey's adds Lead capacity. Camo first, then Lead.
 assert.deepEqual([moabRule(neu).binding, moabRule(neu).round, ids(neu.candidates), moabRule(neu).kept_capacity], [true, 90, ['upgrade:4:p1', 'upgrade:1:p1'], 2]);
 assert.deepEqual(ids(moabRule(neu).answers.also), ['upgrade:4:p1', 'upgrade:1:p1']);
 // threat_short evaluated camo and Lead capacity under the MOAB adders, and its record shows it deferred.
 assert.deepEqual([threatRule(neu).deferred_to, threatRule(neu).missing.includes('camo_capacity'), threatRule(old)], ['moab_short', true, undefined]);
 // More lives: no binding, so nothing changes.
 const two = {...state, lives: 2};
 assert.deepEqual(floorRulesV6(two, options, {paths: []}), floorRulesV6(two, options, {paths: []}, R18));
}));

test('under the cap the binding keeps the capacity answers the cap allows', () => {
 const towers = Array.from({length: TOWER_CAP}, (_, i) => T('DartMonkey', [0, 0, 0], 100 + i));
 const state = {in_game: true, round: {number: 87, index: 86}, cash: 3000, lives: 1, match: {end_round: 100}, towers};
 const place = (tower, cost, moab, extra = {}) => ({id: `place:${tower}@s1`, details: {kind: 'place', tower, spot: 's1', cost, moab, ...extra}});
 const adderUp = {...up(towers[0], '1-0-0', 1000), details: {...up(towers[0], '1-0-0', 1000).details, moab: 5}};
 const adderPlace = place('Druid', 500, 10);
 const camoUp = {...up(towers[1], '1-0-0', 800), details: {...up(towers[1], '1-0-0', 800).details, threat: ['camo_capacity'], camo_gain: 0.5}};
 const camoPlace = place('NinjaMonkey', 400, 0, {threat: ['camo_capacity'], camo_gain: 0.5});
 const kept = [camoUp, camoPlace, adderPlace, adderUp];
 const value = c => c.details.moab / c.details.cost;
 const rule = rules => [withBindAnswers({kind: 'moab_short', binding: true}, {list: [adderPlace, adderUp], value, keep: THREAT_KEEP, always: [], ...rules})];
 const neu = applyTowerCap(state, [...pass, ...kept], kept, rule({also: [camoUp, camoPlace]}));
 assert.deepEqual(ids(neu.candidates), ['upgrade:101:p1', 'upgrade:100:p1']);
 // Revision 18's answers carry no capacity answers: the cap leaves only the MOAB upgrade.
 const old = applyTowerCap(state, [...pass, ...kept], kept, rule({}));
 assert.deepEqual(ids(old.candidates), ['upgrade:100:p1']);
});

// Round 87: round 90 is due for camo, camo Lead, camo and Lead capacity and burst; nothing affordable adds camo.
const savingState = ({cash = 1000} = {}) => ({in_game: true, round: {number: 87, index: 86}, cash, lives: 1, match: {end_round: 100},
 towers: [T('SuperMonkey', [2, 0, 0], 1), T('Druid', [3, 0, 0], 4)]});
const superUp = up(T('SuperMonkey', [2, 0, 0], 1), '3-0-0', 900);
const druid4 = up(T('Druid', [3, 0, 0], 4), '4-0-0', 4500), druid5 = up(T('Druid', [3, 0, 0], 4), '5-0-0', 20000, 'upgrade:4:p1:5');
const savingOptions = [...pass, superUp];

test('the DDT saving targets the cheapest purchase adding a quarter of the gap, and keeps the capacity answers', () => settings(() => {
 const s = savingState(), short = moabShort(s, []);
 const gains = withMoab(s, [druid4, druid5], []).map(c => c.details.moab), gap = short.needs_dps - short.dps;
 assert.deepEqual([short.round, short.dps, short.needs_dps], [90, 0, 99.3]);
 assert.ok(gains[0] > 0 && gains[0] < DDT_GAP_SHARE * gap && gains[1] >= DDT_GAP_SHARE * gap, `gains ${gains}, gap ${gap}`);
 const pool = [superUp, druid4, druid5];
 const old = floorRulesV6(s, savingOptions, {paths: [], pool}, R18), neu = floorRulesV6(s, savingOptions, {paths: [], pool}, R19);
 // Revision 18 saves for the cheapest DDT-capable purchase, whatever it adds, and keeps only the pass options.
 assert.deepEqual([moabRule(old).saving, moabRule(old).for, moabRule(old).gap, ids(old.candidates)], [4500, 'upgrade:4:p1', 99.3, ['wait', 'start_round']]);
 // Revision 19 saves for the Druid's 5-0-0, and the Super Monkey's Lead capacity upgrade stays before the pass options.
 const rule = moabRule(neu);
 assert.deepEqual([rule.saving, rule.for, rule.gap, rule.gain, rule.kept_capacity], [20000, 'upgrade:4:p1:5', 99.3, gains[1], 1]);
 assert.deepEqual(ids(neu.candidates), ['upgrade:1:p1', 'wait', 'start_round']);
 assert.equal(threatRule(neu).binding, false);
}));

test('no saving when no purchase in the pool adds a quarter of the gap', () => settings(() => {
 const s = savingState(), pool = [superUp, druid4];
 const old = floorRulesV6(s, savingOptions, {paths: [], pool}, R18), neu = floorRulesV6(s, savingOptions, {paths: [], pool}, R19);
 assert.equal(moabRule(old).saving, 4500);
 // No saving and no affordable MOAB adder: moab_short doesn't fire, and threat_short's own one-life binding applies.
 assert.equal(moabRule(neu), undefined);
 assert.deepEqual(ids(neu.candidates), ['upgrade:1:p1']);
 assert.equal(threatRule(neu).binding, true);
}));

test('the v5 floor: revision 24 targets the nearest round below 0.5 (87, no DDTs, so no DDT saving)', () => settings(async () => {
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 const s = savingState(), r = playbookGameV5(() => ({paths: [], pool: [superUp, druid4, druid5]}), {playbook}).rules(s, savingOptions);
 assert.deepEqual([moabRule(r)?.round, moabRule(r)?.weakest, moabRule(r)?.saving], [87, 90, undefined]);
}));

// MOAB-class rounds without DDTs are unchanged: every decision of the round-40 fixture (moab-bind.test.mjs).
test('a MOAB round without DDTs: revision 19 gives revision 18\'s options and records', () => settings(() => {
 const f = JSON.parse(readFileSync(new URL('./fixtures/moab-bind-r40.json', import.meta.url), 'utf8'));
 const towers = new Map(f.towers.map(t => [t.id, t]));
 let bound = 0;
 for (const d of f.decisions) {
  const state = {in_game: true, match: f.match, round: {index: d.round - 1, number: d.round, active: true, before_first_wave: false}, cash: d.cash, lives: d.lives, starting_lives: 1, max_lives: 1,
   towers: f.tower_sets[d.towers].split(' ').map(s => { const [id, tiers] = s.split(':'); return {...towers.get(Number(id)), tiers: tiers.split('-').map(Number)}; })};
  const options = d.candidates.map(i => f.options[i]);
  const neu = floorRulesV6(state, options, {paths}), old = floorRulesV6(state, options, {paths}, R18);
  assert.deepEqual(neu, old, `round ${d.round}, cash ${d.cash}`);
  if (moabRule(neu)?.binding) bound++;
 }
 assert.ok(bound > 0, 'moab_short binds in some of them');
}));

// CHIMPS series 1j match 2 (revision 18, log 2026-10-02T05-50-38), rounds 87 to 93: moab_short saved for a second Dart 5-0-2
// ($16,200, about 3 damage per second against a gap of 55 or more) and waited through rounds 92 and 93 at a camo margin of 0.73.
const g = JSON.parse(readFileSync(new URL('./fixtures/ddt-save-r87.json', import.meta.url), 'utf8'));
const gTowers = new Map(g.towers.map(t => [t.id, t]));
const gState = d => ({in_game: true, match: g.match, round: {index: d.round - 1, number: d.round, active: d.active, before_first_wave: false}, cash: d.cash, lives: d.lives, starting_lives: 1, max_lives: 1,
 towers: g.tower_sets[d.towers].split(' ').map(s => { const [id, tiers] = s.split(':'); return {...gTowers.get(Number(id)), tiers: tiers.split('-').map(Number)}; })});
const gOption = (d, i) => { const c = g.options[i]; return c.details.cost != null ? {...c, details: {...c.details, cash_after: d.cash - c.details.cost}} : c; };
const gRun = (d, opts) => floorRulesV6(gState(d), d.candidates.map(i => gOption(d, i)), {paths, pool: d.pool.map(i => g.options[i]), pressure: d.pressure ? {active: true} : null}, opts);

test('series 1j match 2: revision 18 rebuilds the logged saving; revision 19 does not save and answers the camo gap at rounds 92 and 93', () => settings(() => {
 const logged = g.decisions.filter(d => d.moab_short?.saving != null);
 assert.equal(logged.length, 29);
 for (const d of logged) {
  const old = gRun(d, R18), neu = gRun(d, R19);
  assert.deepEqual([moabRule(old).saving, moabRule(old).for, ids(old.candidates)], [16200, 'upgrade:415:p1', ['wait']], `round ${d.round}, cash ${d.cash}`);
  assert.equal(moabRule(neu)?.saving, undefined, `round ${d.round}, cash ${d.cash}`);
 }
 // The target's gain is under a quarter of the gap.
 const d = logged[0], s = gState(d), target = withMoab(s, d.pool.map(i => g.options[i]), paths).find(c => c.id === 'upgrade:415:p1');
 assert.ok(target.details.moab < DDT_GAP_SHARE * (d.moab_short.needs_dps - d.moab_short.dps), `${target.details.moab} against ${d.moab_short.needs_dps - d.moab_short.dps}`);
 // Rounds 92 and 93: revision 18 deferred camo_capacity to the saving and waited; revision 19 keeps the Wizard's 0-4-2.
 const late = g.decisions.filter(d => d.round >= 92 && d.moab_short?.saving != null);
 assert.ok(late.length >= 8);
 for (const d of late) {
  const old = gRun(d, R18), neu = gRun(d, R19);
  assert.deepEqual([threatRule(old).deferred_to, ids(old.candidates)], ['moab_short', ['wait']]);
  assert.deepEqual([threatRule(neu).missing, ids(neu.candidates)], [['camo_capacity'], ['upgrade:13562:p2']]);
 }
}));

test('revision 20 sits on revision 18\'s options: without moabNearest and ddtSaveBest (and the session\'s figure and need) it gives revision 18', () => settings(() => {
 for (const d of g.decisions.filter((d, i) => i % 5 === 0)) assert.deepEqual(gRun(d, {moabNearest: false, ddtSaveBest: false, ddtReach: false, capacitySame: false}), gRun(d, R18), `round ${d.round}, cash ${d.cash}`);
 const s = savingState(), r = floorRulesV6(s, savingOptions, {paths: [], pool: [superUp, druid4, druid5]}, {moabNearest: false, ddtSaveBest: false, ddtReach: false, capacitySame: false});
 assert.equal(moabRule(r)?.saving, 4500, 'the cheapest DDT-capable purchase, as revision 18');
}));
