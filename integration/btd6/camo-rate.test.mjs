// camo_capacity on the camo rate (threat.mjs camoRate; btd6-jev-v6 revision 21, btd6-playbook-v5 revision 25,
// btd6-claude-v1 revision 24).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {threatShort, threatEffect, camoRateScale, camoRateFor, camoPerDollar, CAMO_RATE_FROM, CAMO_CAPACITY_AT, THREAT_KINDS_V4, THREAT_BURST_AHEAD, THREAT_OPTIONS_R21, THREAT_KEEP, CAMO_BIND_GAP_SHARE, camoBindWeak} from './threat.mjs';
import {camoCheck} from './estimate.mjs';
import {camoFigures} from './camo.mjs';
import {floorRulesV6, V6_REVISION} from './policy-v6.mjs';
import {claudeGameV1, playbookGameV5} from './game.mjs';
import {V5_REVISION, loadPlaybook} from './playbook-v5.mjs';
import {CLAUDE_V1_REVISION} from './plan-v1.mjs';
import {after} from './policy-v3.mjs';
import {pathsFor} from './moab-replay.mjs';

// CHIMPS series 1k match 1 (v6 revision 19), the first decision of rounds 34 to 36 before the round-37 camo loss.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/camo-rate-r37.json', import.meta.url), 'utf8'));
const R20 = {kinds: THREAT_KINDS_V4, ...THREAT_BURST_AHEAD}, R21 = {kinds: THREAT_KINDS_V4, ...THREAT_OPTIONS_R21};
const threatRule = r => (r.constraint?.rules ?? []).find(q => q.kind === 'threat_short');

test('revisions and gating: camoRate from v6 21, v5 25 and claude-v1 24; THREAT_OPTIONS_R21 is THREAT_BURST_AHEAD with it', () => {
 assert.deepEqual([V6_REVISION, V5_REVISION, CLAUDE_V1_REVISION], [22, 26, 25]);
 assert.deepEqual(CAMO_RATE_FROM, {'btd6-jev-v6': 21, 'btd6-playbook-v5': 25, 'btd6-claude-v1': 24});
 assert.deepEqual(THREAT_OPTIONS_R21, {...THREAT_BURST_AHEAD, camoRate: true, camoBindShare: CAMO_BIND_GAP_SHARE});
 assert.equal(CAMO_BIND_GAP_SHARE, 0.05);
 for (const [policy, from] of Object.entries(CAMO_RATE_FROM)) {
  assert.equal(camoRateFor(policy, from), true);
  assert.equal(camoRateFor(policy, from - 1), false);
 }
 assert.equal(camoRateFor('btd6-jev-v4', 99), false);
 assert.equal(CAMO_CAPACITY_AT, 1.0);
});

test('the rate ratio is camo.mjs Model B: the camo margin times the camo window over the round seconds', () => {
 const {state} = fixture.decisions[0];
 const figures = camoFigures(state.towers, 37, {lives: state.lives});
 assert.deepEqual([figures.today, figures.b], [2.28, 0.42]);
 assert.equal(+(figures.today * camoRateScale(37)).toFixed(2), figures.b);
 assert.equal(camoRateScale(1), null, 'no camo timing: the camo margin stands');
});

test('round 37 of CHIMPS series 1k match 1: camo_capacity due from round 34 on the rate (0.42), not on the camo margin (2.28)', () => {
 assert.equal(fixture.decisions.length, 3);
 for (const d of fixture.decisions) {
  assert.ok(!('camo_capacity' in (threatShort(d.state, [], R20)?.rounds ?? {})), `round ${d.round}: revision 20 has nothing due`);
  const short = threatShort(d.state, [], R21);
  assert.deepEqual([short.rounds.camo_capacity, short.ratios.camo_capacity, short.camoMargin], [37, 0.42, 2.28]);
  // Revision 20 reproduces no threat_short; revision 21 binds with one life on camo_capacity.
  assert.equal(threatRule(floorRulesV6(d.state, d.candidates, {paths: []}, {threatOptions: THREAT_BURST_AHEAD})), undefined);
  const rule = threatRule(floorRulesV6(d.state, d.candidates, {paths: []}));
  assert.deepEqual([rule.round, rule.missing, rule.binding, rule.binding_kind], [37, ['camo_capacity'], true, 'camo_capacity']);
  assert.deepEqual(rule.camo_capacity, {round: 37, camo_rate: 0.42, camo_margin: 2.28, at: CAMO_CAPACITY_AT});
 }
});

test('camo answers ranked by the rate gain per dollar; the binding keeps those within THREAT_KEEP of the best', () => {
 const d = fixture.decisions[1];
 const short = threatShort(d.state, [], R21), scale = camoRateScale(37);
 const r = floorRulesV6(d.state, d.candidates, {paths: []});
 const kept = r.candidates;
 assert.ok(kept.length >= 1 && kept.every(c => camoPerDollar(c) != null));
 // Each answer's camo_gain is the rate ratio it adds: the camo can_pop it adds over the needs, times the round's scale.
 for (const c of kept) {
  const added = camoCheck(after(d.state, c), 37, {lives: d.state.lives}).can_pop - short.can_pop.camo_capacity;
  assert.equal(c.details.camo_gain, +(added / short.needs.camo_capacity * scale).toFixed(4));
  assert.equal(c.details.camo_gain, +threatEffect(d.state, c, short, []).camo_gain.toFixed(4));
 }
 const best = Math.max(...kept.map(camoPerDollar));
 assert.equal(camoPerDollar(kept[0]), best, 'the first answer has the most rate gain per dollar');
 assert.ok(kept.every(c => camoPerDollar(c) >= best * THREAT_KEEP));
 assert.ok(!kept.some(c => c.id === d.chosen), 'the logged choice, a Bomb Shooter upgrade, adds no camo capacity');
 // Without the scale (a copy of the short drops it, as under revision 20) the gain is the margin gain, larger by 1 / scale.
 const margin = threatEffect(d.state, kept[0], {...short}, []).camo_gain;
 assert.ok(Math.abs(margin * scale - kept[0].details.camo_gain) < 1e-3);
});

test('v5 and claude-v1 run camo_capacity on the rate by default', async () => {
 const d = fixture.decisions[1];
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 for (const game of [playbookGameV5(() => ({paths: []}), {playbook}), claudeGameV1(() => ({paths: []}))]) {
  const rule = threatRule(game.rules(d.state, d.candidates));
  assert.deepEqual([rule?.binding_kind, rule?.camo_capacity?.camo_rate], ['camo_capacity', 0.42]);
 }
});

test('round 36 with round 40 in view: the nearer camo_capacity round keeps its binding over moab_short (capacityNearer)', () => {
 const d = fixture.decisions[2], paths = pathsFor('Tutorial');
 assert.equal(d.round, 36);
 const kinds = r => (r.constraint?.rules ?? []).map(q => q.kind);
 // Without the option moab_short (round 40) binds and threat_short's camo_capacity is set aside, as in revision 20.
 const old = floorRulesV6(d.state, d.candidates, {paths}, {capacityNearer: false});
 const moab = old.constraint.rules.find(q => q.kind === 'moab_short');
 assert.deepEqual([moab.round, moab.binding, kinds(old).includes('threat_short')], [40, true, false]);
 assert.ok(old.candidates.some(c => c.id === d.chosen), 'the logged choice, a Dart Monkey upgrade for MOAB damage, stays');
 // With it threat_short binds on camo_capacity for round 37; moab_short only orders and doesn't bind.
 const neu = floorRulesV6(d.state, d.candidates, {paths});
 const threat = neu.constraint.rules.find(q => q.kind === 'threat_short');
 assert.deepEqual([threat.round, threat.missing, threat.binding, threat.binding_kind, threat.before_moab], [37, ['camo_capacity'], true, 'camo_capacity', 40]);
 assert.equal(neu.constraint.rules.find(q => q.kind === 'moab_short').binding, undefined);
 assert.ok(neu.candidates.length && neu.candidates.every(c => camoPerDollar(c) != null), 'only camo answers are left');
 assert.ok(!neu.candidates.some(c => c.id === d.chosen));
 // Rounds 34 and 35 have no moab_short: the option changes nothing there.
 for (const e of fixture.decisions.slice(0, 2)) assert.deepEqual(floorRulesV6(e.state, e.candidates, {paths}).candidates.map(c => c.id), floorRulesV6(e.state, e.candidates, {paths}, {capacityNearer: false}).candidates.map(c => c.id));
});

test('the gap guard: camo_capacity binds only when an affordable answer adds 5% of the gap to 1.0; otherwise it only orders', () => {
 const paths = pathsFor('Tutorial');
 const threat = r => (r.constraint?.rules ?? []).find(q => q.kind === 'threat_short');
 // Round 34: the rate is 0.42, so the guard needs a gain of 0.029; the $230 Skywarden 2-0-1 adds 0.2568 and the rule binds.
 const d34 = fixture.decisions[0];
 assert.equal(threat(floorRulesV6(d34.state, d34.candidates, {paths})).binding, true);
 // A share that needs more (0.58) than any affordable answer adds: no binding, the answers only go first.
 const held = floorRulesV6(d34.state, d34.candidates, {paths}, {threatOptions: {...THREAT_OPTIONS_R21, camoBindShare: 1}});
 const rule = threat(held);
 assert.deepEqual([rule.binding, rule.camo_bind_held], [undefined, {gain: 0.2568, need: 0.58}]);
 assert.equal(held.candidates[0].id, 'upgrade:21512:p1');
 assert.ok(held.candidates.length > 1, 'the other options stay after the answers');
 // An answer without a known cost doesn't count as affordable.
 const short = threatShort(d34.state, paths, R21);
 const noCost = {id: 'x', details: {kind: 'place', camo_gain: 0.5, threat: ['camo_capacity']}};
 assert.deepEqual(camoBindWeak(d34.state, [noCost], short, CAMO_BIND_GAP_SHARE), {gain: 0, need: 0.029});
 assert.equal(camoBindWeak(d34.state, [{...noCost, details: {...noCost.details, cost: 200}}], short, CAMO_BIND_GAP_SHARE), null);
 assert.equal(camoBindWeak(d34.state, [noCost], threatShort(d34.state, paths, R20) ?? short, 0), null, 'share 0: no guard');
 // Round 36 with round 40 in view: when the guard holds camo_capacity back it doesn't take precedence over moab_short.
 const d36 = fixture.decisions[2];
 const back = floorRulesV6(d36.state, d36.candidates, {paths}, {threatOptions: {...THREAT_OPTIONS_R21, camoBindShare: 2}});
 assert.equal(threat(back), undefined);
 assert.equal(back.constraint.rules.find(q => q.kind === 'moab_short').binding, true);
 assert.deepEqual(back.candidates.map(c => c.id), floorRulesV6(d36.state, d36.candidates, {paths}, {capacityNearer: false}).candidates.map(c => c.id));
});
