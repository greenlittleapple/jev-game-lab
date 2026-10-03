// btd6-jev-v6 revision 17, btd6-playbook-v5 revision 21, btd6-claude-v1 revision 20: moab_short binds only below a ratio of
// 0.5 (policy-v4.mjs MOAB_BIND_RATIO), looks 10 rounds ahead for rounds with DDTs (moab.mjs MOAB_DDT_LEAD_ROUNDS) and saves
// for the cheapest DDT-capable purchase with one life (moabSaving); lead_capacity is due below 1.0 (threat.mjs LEAD_CAPACITY_AT; 0.5 in v6 revision 17, LEAD_CAPACITY_AT_R17).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setDdtCheck, setMoabCalibration, setMoabDdtLead, moabDue, moabDdtLeadFor, MOAB_LEAD_ROUNDS, MOAB_DDT_LEAD_ROUNDS} from './moab.mjs';
import {floorRulesV4, moabShort, MOAB_BIND_RATIO, DDT_GAP_SHARE} from './policy-v4.mjs';
import {floorRulesV6, TOWER_CAP} from './policy-v6.mjs';
import {THREAT_KINDS_V4, THREAT_BURST_AHEAD, LEAD_CAPACITY_AT, LEAD_CAPACITY_AT_R12, LEAD_CAPACITY_AT_R17, threatShort, leadAtFor} from './threat.mjs';
import {setPopsCalibration} from './estimate.mjs';
import {v0Round6, meadowPaths as paths} from './fixtures/index.mjs';
import {playbookGameV5} from './game.mjs';
import {loadPlaybook} from './playbook-v5.mjs';

const ids = list => list.map(c => c.id);
const moabRule = r => r.constraint?.rules?.find(q => q.kind === 'moab_short');
// Revision 18's options for the DDT binding and saving (revision 19, moab-ddt-save.test.mjs, changes both).
const R18 = {moabCapacity: false, ddtGapShare: 0, moabNearest: false, ddtSaveBest: false, ddtReach: false, capacitySame: false};
// Revision 19's rule options (revision 20 turns moabCapacity and ddtGapShare off and moabNearest on; these states also have a short MOAB round 87 below 0.5).
const R19 = {moabCapacity: true, ddtGapShare: DDT_GAP_SHARE, moabNearest: false, ddtSaveBest: false, ddtReach: false, capacitySame: false};
const R16 = {...R18, moabBindBelow: Infinity, moabSaving: false, threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R12}};

// Series 1h match 3, rounds 36 to 39 (moab-bind.test.mjs): round 40 at 0.18 to 0.24 under the factor 1.27.
const f = JSON.parse(readFileSync(new URL('./fixtures/moab-bind-r40.json', import.meta.url), 'utf8'));
const fTowers = new Map(f.towers.map(t => [t.id, t]));
const stateOf = d => ({in_game: true, match: f.match, round: {index: d.round - 1, number: d.round, active: true, before_first_wave: false}, cash: d.cash, lives: d.lives, starting_lives: 1, max_lives: 1,
 towers: f.tower_sets[d.towers].split(' ').map(s => { const [id, tiers] = s.split(':'); return {...fTowers.get(Number(id)), tiers: tiers.split('-').map(Number)}; })});
const optionsOf = d => d.candidates.map(i => f.options[i]);
const at = (round, cash) => f.decisions.find(d => d.round === round && d.cash === cash);
const settings = async (fn, {factor = 1.27, lead = MOAB_DDT_LEAD_ROUNDS} = {}) => {
 setDdtCheck(true); setMoabCalibration(factor); setMoabDdtLead(lead);
 try { return await fn(); } finally { setDdtCheck(false); setMoabCalibration(1); setMoabDdtLead(MOAB_LEAD_ROUNDS); }
};
// The MOAB factor that puts the state's short round at `ratio` (the ratio scales with the factor).
const factorFor = (state, ratio) => settings(() => 1.27 * ratio / moabShort(state, paths).ratio);

test('constants and the revisions that use them', () => {
 assert.deepEqual([MOAB_BIND_RATIO, MOAB_LEAD_ROUNDS, MOAB_DDT_LEAD_ROUNDS, LEAD_CAPACITY_AT, LEAD_CAPACITY_AT_R12, LEAD_CAPACITY_AT_R17], [0.5, 4, 10, 1.0, 1.0, 0.5]);
 assert.deepEqual([moabDdtLeadFor('btd6-jev-v6'), moabDdtLeadFor('btd6-jev-v6', 16), moabDdtLeadFor('btd6-playbook-v5', 21), moabDdtLeadFor('btd6-claude-v1', 19), moabDdtLeadFor('btd6-jev-v4')], [10, 4, 10, 4, 4]);
 assert.deepEqual([leadAtFor('btd6-jev-v6', 17), leadAtFor('btd6-jev-v6', 16), leadAtFor('btd6-playbook-v5', 21), leadAtFor('btd6-claude-v1', 19)], [0.5, 1, 0.5, 1]);
 assert.deepEqual([leadAtFor('btd6-jev-v6', 18), leadAtFor('btd6-playbook-v5', 22), leadAtFor('btd6-claude-v1', 21), leadAtFor('btd6-claude-v1', 20), leadAtFor('btd6-jev-v4', 3)], [1, 1, 1, 0.5, 1]);
});

test('below 0.5 the binding applies, as in revision 16', () => settings(() => {
 const d = at(36, 341), state = stateOf(d), options = optionsOf(d);
 const neu = floorRulesV6(state, options, {paths}), rule = moabRule(neu);
 assert.ok(rule.binding && moabShort(state, paths).ratio < MOAB_BIND_RATIO);
 assert.deepEqual(ids(neu.candidates), ids(floorRulesV6(state, options, {paths}, R16).candidates));
 assert.ok(neu.candidates.every(c => c.details.moab > 0));
}));

test('from 0.5 to 1 moab_short does what v4 does: no "Wait" or "Start round", no binding', async () => {
 const d = at(36, 341), state = stateOf(d), options = optionsOf(d);
 for (const ratio of [0.55, 0.75, 0.95]) await settings(() => {
  const short = moabShort(state, paths);
  assert.ok(short.ratio >= MOAB_BIND_RATIO && short.ratio < 1, `ratio ${short.ratio}`);
  const neu = floorRulesV6(state, options, {paths}), rule = moabRule(neu);
  assert.equal(rule.binding, undefined);
  assert.equal(rule.removed, 1);
  assert.ok(!neu.candidates.some(c => ['wait', 'start_round'].includes(c.details.kind)));
  // 12 towers: the cap then removes the placements, MOAB adders among them, as in revision 15 (no cap_binding).
  assert.equal(neu.constraint.rules.at(-1).cap_binding, undefined);
  assert.deepEqual(neu, floorRulesV6(state, options, {paths}, {moabBinding: false}), 'as revision 15 (v4\'s moab_short)');
  assert.equal(moabRule(floorRulesV6(state, options, {paths}, R16)).binding, true, 'revision 16 binds here');
  // v4's own rule gives the same record.
  assert.deepEqual(moabRule(floorRulesV4(state, options, {paths})), rule);
 }, {factor: await factorFor(state, ratio)});
});

test('under the cap: the cap chooses for moab_short only below 0.5', async () => {
 const d = at(39, 248), state = stateOf(d), options = optionsOf(d);
 await settings(() => {
  const r = floorRulesV6(state, options, {paths});
  assert.deepEqual([r.constraint.rules.at(-1).kind, r.constraint.rules.at(-1).cap_binding?.rule], ['tower_cap', 'moab_short']);
 }, {factor: await factorFor(state, 0.45)});
 await settings(() => {
  assert.ok(moabShort(state, paths).ratio >= MOAB_BIND_RATIO);
  const r = floorRulesV6(state, options, {paths}), cap = r.constraint.rules.at(-1);
  assert.equal(cap.kind, 'tower_cap');
  assert.equal(cap.cap, TOWER_CAP);
  assert.equal(cap.cap_binding, undefined);
  assert.deepEqual(r, floorRulesV6(state, options, {paths}, {moabBinding: false}));
  assert.equal(floorRulesV6(state, options, {paths}, R16).constraint.rules.at(-1).cap_binding?.rule, 'moab_short', 'revision 16 chooses');
 }, {factor: await factorFor(state, 0.6)});
});

test('a round with DDTs is due 10 rounds ahead; other MOAB-class rounds 4', () => settings(() => {
 const rounds = (now, opts = {}) => moabDue([], now, {lives: 1, ...opts}).map(c => c.round).sort((a, b) => a - b);
 assert.deepEqual(rounds(80), [80, 81, 82, 83, 84, 90], 'round 90 (3 DDTs) 10 ahead; 85 to 89 not yet');
 assert.deepEqual(rounds(79), [79, 80, 81, 82, 83], 'round 90 is 11 ahead');
 assert.deepEqual(rounds(90, {end: 100}), [90, 91, 92, 93, 94, 95, 99, 100], 'DDTs at 95 and 99, a BAD\'s DDTs at 100');
 assert.deepEqual(rounds(35), [], 'round 40 (a MOAB) is 5 ahead');
 assert.deepEqual(rounds(36), [40]);
 assert.deepEqual(rounds(80, {ddtLead: MOAB_LEAD_ROUNDS}), [80, 81, 82, 83, 84], 'the graded speed\'s lead');
 setMoabDdtLead(MOAB_LEAD_ROUNDS);
 assert.deepEqual(rounds(80), [80, 81, 82, 83, 84], 'revision 16');
}));

// Round 86, one life: a Super Monkey 2-0-0 (no camo: can't hit a DDT) and a Druid 3-0-0 (4-0-0 hits DDTs). Round 90's DDTs get
// no DDT-capable damage (ratio 0); the Super Monkey's upgrade is affordable but adds none for it.
const T = (base_id, tiers, id) => ({id, base_id, tiers, level: 1, x: 0, y: 0});
const superMonkey = T('SuperMonkey', [2, 0, 0], 1), druid = T('Druid', [3, 0, 0], 4);
const ddtState = ({cash = 1000, lives = 1} = {}) => ({in_game: true, round: {number: 86, index: 85}, cash, lives, match: {end_round: 100}, towers: [superMonkey, druid]});
const up = (t, tiers_after, cost) => ({id: `upgrade:${t.id}:p1`, details: {kind: 'upgrade', tower_id: t.id, path: 1, tiers_before: t.tiers.join('-'), tiers_after, cost}});
const pass = [{id: 'wait', details: {kind: 'wait'}}, {id: 'start_round', details: {kind: 'start_round'}}];
const superUp = up(superMonkey, '3-0-0', 900), druidUp = up(druid, '4-0-0', 4500);
const pool = [superUp, druidUp];
const ddtOptions = cash => [...pass, superUp, ...(cash >= 4500 ? [druidUp] : [])];
const floor = (s, extra = {}, opts = R18) => floorRulesV6(s, ddtOptions(s.cash), {paths: [], pool, ...extra}, opts);

test('one life, a DDT round below 0.5, nothing affordable adds DDT-capable damage: only the pass options while saving for the cheapest', () => settings(() => {
 const s = ddtState(), short = moabShort(s, []);
 assert.deepEqual([short.round, short.ratio, short.ddt_dps], [90, 0, 0]);
 const r = floor(s), rule = moabRule(r);
 assert.deepEqual(ids(r.candidates), ['wait', 'start_round']);
 assert.deepEqual([rule.round, rule.ratio, rule.saving, rule.for, rule.cash, rule.removed], [90, 0, 4500, 'upgrade:4:p1', 1000, 1]);
 assert.equal(rule.binding, undefined);
 // Revision 16 neither looks 10 rounds ahead nor saves.
 setMoabDdtLead(MOAB_LEAD_ROUNDS);
 assert.equal(moabRule(floor(s, {}, R16))?.saving, undefined);
}));

test('hand-off: once a DDT-capable purchase is affordable the binding keeps it', () => settings(() => {
 const r = floor(ddtState({cash: 5000})), rule = moabRule(r);
 assert.equal(rule.saving, undefined);
 assert.deepEqual([rule.binding, rule.round], [true, 90]);
 assert.deepEqual(ids(r.candidates), ['upgrade:4:p1']);
}));

test('no saving with more lives', () => settings(() => {
 const s = ddtState({lives: 2}), r = floor(s);
 assert.equal(moabRule(r), undefined, 'no MOAB adder on offer: moab_short does not fire');
 assert.ok(ids(r.candidates).includes('upgrade:1:p1'));
}));

test('survival rules override the saving: leak pressure stops it', () => settings(() => {
 const r = floor(ddtState(), {pressure: {active: true, reason: 'lives_lost'}});
 assert.equal(moabRule(r)?.saving, undefined);
 assert.ok(ids(r.candidates).includes('upgrade:1:p1'));
}));

test('no saving from 0.5 up, nor for a round without DDTs', () => settings(() => {
 // Round 86 itself (BFBs) can be short; the saving needs a round with DDTs.
 const s = {...ddtState(), round: {number: 80, index: 79}};
 setMoabDdtLead(MOAB_LEAD_ROUNDS);
 assert.equal(moabRule(floor(s))?.saving, undefined);
}));

// The round-28 Lead check (lead-capacity.test.mjs): two Darts, a Wizard and a Bomb Shooter 0-0-0 at round 25, Lead margin 0.34
// with one life. The pops calibration scales the margin.
const LT = (id, base_id, tiers, x, y, next_upgrades = []) => ({id, base_id, tiers, x, y, next_upgrades});
const leadState = () => {
 const s = v0Round6({cash: 2000, lives: 1, starting_lives: 1, max_lives: 1, auto_start: true, round: {index: 24, active: true, before_first_wave: false},
  towers: [LT(1, 'DartMonkey', [2, 0, 0], -62, -2), LT(2, 'DartMonkey', [2, 0, 0], -26, -44), LT(3, 'WizardMonkey', [0, 0, 0], -38, -2), LT(4, 'BombShooter', [0, 0, 0], -74, 40)]});
 s.match = {...s.match, mode: 'Clicks', mode_name: 'CHIMPS', end_round: 100, start_round: 6};
 return s;
};
// Revision 18: the round-28 state of run 2026-10-02T04-44-47 (revision 17) had a Lead margin of 0.62, which 0.5 didn't flag.
test('lead_capacity is due at Lead margins of 0.45 and 0.62 from revision 18 (1.0); revision 17 (0.5) flags only 0.45', () => {
 const s = leadState(), opts = {kinds: THREAT_KINDS_V4, ...THREAT_BURST_AHEAD};
 const margin = factor => { setPopsCalibration(factor); try { return threatShort(s, paths, {...opts, leadAt: 10})?.ratios?.lead_capacity; } finally { setPopsCalibration(1); } };
 const due = (factor, leadAt) => { setPopsCalibration(factor); try { return 'lead_capacity' in (threatShort(s, paths, {...opts, ...(leadAt ? {leadAt} : {})})?.rounds ?? {}); } finally { setPopsCalibration(1); } };
 const base = margin(1), at45 = 0.454 / base, at62 = 0.624 / base;
 assert.deepEqual([margin(at45), margin(at62)], [0.45, 0.62]);
 assert.deepEqual([due(at45), due(at62)], [true, true]);
 assert.deepEqual([due(at45, LEAD_CAPACITY_AT_R17), due(at62, LEAD_CAPACITY_AT_R17)], [true, false]);
 assert.deepEqual([due(at45, LEAD_CAPACITY_AT_R12), due(at62, LEAD_CAPACITY_AT_R12)], [true, true]);
});

// From v5 revision 23 the Druid's 4-0-0 (8 of the 99.3 gap) is no target (moab-ddt-save.test.mjs has a v5 saving that meets it).
test('the v5 floor runs the DDT saving too: no target below a quarter of the gap', () => settings(async () => {
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 const s = ddtState(), r = playbookGameV5(() => ({paths: [], pool}), {playbook}).rules(s, ddtOptions(s.cash));
 assert.equal(moabRule(r)?.saving, undefined);
 assert.deepEqual(moabRule(floor(s))?.saving, 4500, 'revision 18 saved for it');
}));
