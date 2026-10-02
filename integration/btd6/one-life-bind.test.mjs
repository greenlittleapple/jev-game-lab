// The one-life binding under the tower cap (btd6-jev-v6 revision 11, btd6-playbook-v5 revision 15, btd6-claude-v1
// revision 14; policy-v6.mjs applyTowerCap bindUnderCap). Revision 10 ran the binding first and the cap second: in CHIMPS
// series 1f match 1 the binding kept only Ninja placements, the cap removed them and "Wait" was left alone.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {floorRulesV6, applyTowerCap, TOWER_CAP} from './policy-v6.mjs';
import {withBindAnswers, THREAT_KEEP} from './threat.mjs';
import {EARLY_KEEP} from './early.mjs';
import {btd6Game, claudeGameV1, playbookGameV5} from './game.mjs';
import {adoptPlanV1, requestStampV1} from './plan-v1.mjs';
import {loadPlaybook} from './playbook-v5.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths, meadowSpots, meadowSpot} from './fixtures/index.mjs';
import {rebuild} from './threat-replay.mjs';

const ids = list => list.map(c => c.id);
const buys = list => list.filter(c => c.details?.kind === 'place' || c.details?.kind === 'upgrade');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/one-life-bind-r48.json', import.meta.url), 'utf8'));
// No track: the logged threat_short record is reproduced (see the fixture's source note).
const logged = {paths: []};

test('round 48 of CHIMPS series 1f match 1: revision 10 leaves only "Wait", revision 11 the camo upgrade answer', () => {
 const {state, candidates} = fixture;
 const old = floorRulesV6(state, candidates, logged, {bindUnderCap: false});
 assert.deepEqual(ids(old.candidates), ['wait']);
 const [threat, cap] = old.constraint.rules;
 assert.deepEqual([threat.kind, threat.binding_kind, threat.kept.every(id => id.startsWith('place:NinjaMonkey@'))], ['threat_short', 'camo_capacity', true]);
 assert.deepEqual([cap.kind, cap.wait_restored, cap.one_life_removed], ['tower_cap', true, 4]);
 const neu = floorRulesV6(state, candidates, logged);
 assert.deepEqual(ids(neu.candidates), ['upgrade:108924:p2']);
 assert.equal(threat.adders, 5);
 assert.equal(threat.first_camo_gain, 0.035);
 assert.ok(buys(neu.candidates).length > 0, 'a purchase is left');
 assert.ok(neu.candidates.every(c => c.details.threat?.includes('camo_capacity')), 'only camo capacity answers');
 const rule = neu.constraint.rules.at(-1);
 assert.deepEqual(rule, {kind: 'tower_cap', removed: 4, towers: 17, cap: TOWER_CAP, one_life_removed: 4,
  cap_binding: {rule: 'threat_short', kind: 'camo_capacity', allowed: 1, keep: THREAT_KEEP, best: rule.cap_binding.best, kept: ['upgrade:108924:p2']}});
 assert.equal(JSON.stringify(neu.constraint).includes('"answers"'), false, 'the answers are not logged');
 // The policy itself (btd6Game) runs revision 11.
 assert.deepEqual(ids(btd6Game(() => logged, {policy: 'btd6-jev-v6'}).rules(state, candidates).candidates), ['upgrade:108924:p2']);
});

// Synthetic options: 14 towers (cap in force), one life.
const towers = n => Array.from({length: n}, (_, i) => ({id: i + 1, base_id: 'DartMonkey', tiers: [0, 0, 0]}));
const st = ({n = 14, lives = 1, cash = 2000} = {}) => ({in_game: true, cash, lives, towers: towers(n), round: {number: 50}});
const wait = {id: 'wait', details: {kind: 'wait'}};
const place = (tower, spot, cost, extra = {}) => ({id: `place:${tower}@${spot}`, details: {kind: 'place', tower, spot, cost, ...extra}});
const up = (tower, path, cost, extra = {}) => ({id: `upgrade:${tower}:p${path}`, details: {kind: 'upgrade', tower_id: tower, path, cost, ...extra}});
const camoPer = c => c.details.camo_gain / c.details.cost;
// A threat_short binding record on camo capacity with its answers (threat.mjs applyThreatShort), kept as revision 10 kept them.
function camoBinding(answers, kept) {
 const rule = {kind: 'threat_short', missing: ['camo_capacity'], binding: true, binding_kind: 'camo_capacity', keep: THREAT_KEEP, kept: ids(kept)};
 return withBindAnswers(rule, {list: answers, value: camoPer, keep: THREAT_KEEP});
}
const ninja = (spot, gain = 0.035) => place('NinjaMonkey', spot, 430, {threat: ['camo_capacity'], camo_gain: gain});
const camoUp = (tower, cost, gain, path = 2) => up(tower, path, cost, {threat: ['camo_capacity'], camo_gain: gain});

test('upgrades first under the cap: the binding chooses among affordable upgrade answers within the keep factor of the best of them', () => {
 const n1 = ninja('S23'), n2 = ninja('S24');
 const a = camoUp(3, 300, 0.03), b = camoUp(4, 300, 0.025), c = camoUp(5, 300, 0.02), dear = camoUp(6, 2500, 0.5);
 const answers = [n1, n2, a, dear, b, c];
 const rule = camoBinding(answers, [n1, n2]);
 const all = [wait, n1, n2, a, b, c, dear, place('DartMonkey', 'S30', 200)];
 const r = applyTowerCap(st(), all, [n1, n2], [rule]);
 // b is 0.83 of a, c 0.67; the $2,500 upgrade is not affordable.
 assert.deepEqual(ids(r.candidates), [a.id, b.id]);
 assert.deepEqual(r.rule, {kind: 'tower_cap', removed: 2, towers: 14, cap: TOWER_CAP, one_life_removed: 2,
  cap_binding: {rule: 'threat_short', kind: 'camo_capacity', allowed: 3, keep: THREAT_KEEP, best: 0.0001, kept: [a.id, b.id]}});
 // Revision 10 (bindUnderCap: false): the placements go and "Wait" comes back.
 assert.deepEqual(ids(applyTowerCap(st(), all, [n1, n2], [rule], {}, {bindUnderCap: false}).candidates), ['wait']);
 // A burst binding the same way.
 const bp = place('BombShooter', 'S23', 500, {threat: ['burst'], burst_gain: 0.05}), bu = up(7, 1, 400, {threat: ['burst'], burst_gain: 0.02});
 const burst = withBindAnswers({kind: 'threat_short', missing: ['burst'], binding: true, binding_kind: 'burst', keep: THREAT_KEEP, kept: [bp.id]},
  {list: [bp, bu], value: c => c.details.burst_gain / c.details.cost, keep: THREAT_KEEP});
 assert.deepEqual(ids(applyTowerCap(st(), [wait, bp, bu], [bp], [burst]).candidates), [bu.id]);
});

test('placement pass: with no upgrade answer the binding\'s placement answers pass the cap, as in revision 9', () => {
 const n1 = ninja('S23'), n2 = ninja('S24'), other = place('DartMonkey', 'S30', 200);
 const dear = camoUp(6, 2500, 0.5);
 const rule = camoBinding([n1, n2, dear], [n1, n2]);
 const r = applyTowerCap(st(), [wait, n1, n2, other, dear], [n1, n2], [rule]);
 assert.deepEqual(ids(r.candidates), [n1.id, n2.id]);
 assert.deepEqual(r.rule, {kind: 'tower_cap_exception', towers: 14, cap: TOWER_CAP, survival: ['threat_short'], removed: 0, placement_pass: true});
 assert.equal(r.rule.one_life_removed, undefined);
});

test('invariant: with one life the cap never leaves "Wait" alone while a binding has an answer among the options', () => {
 const pool = [ninja('S23'), ninja('S24', 0.03), camoUp(3, 300, 0.01), camoUp(4, 2500, 0.2), camoUp(5, 900, 0.012)];
 let cases = 0;
 for (let mask = 1; mask < 1 << pool.length; mask++) {
  const answers = pool.filter((_, i) => mask & (1 << i));
  for (const cash of [250, 1000, 3000]) {
   const state = st({cash});
   const offered = answers.filter(c => c.details.cost <= cash);
   if (!offered.length) continue;
   // Revision 10's keep: within the keep factor of the first (best) offered answer.
   const sorted = [...offered].sort((x, y) => camoPer(y) - camoPer(x));
   const kept = sorted.filter(c => camoPer(c) >= camoPer(sorted[0]) * THREAT_KEEP);
   const r = applyTowerCap(state, [wait, ...offered], kept, [camoBinding(sorted, kept)]);
   const left = r ? r.candidates : kept;
   assert.ok(buys(left).length > 0 && left.every(c => sorted.includes(c)), `mask ${mask} cash ${cash}: ${ids(left)}`);
   cases++;
  }
 }
 assert.ok(cases > 40);
});

test('unchanged: check kinds, more than one life, fewer than 12 towers, and Hard Standard', () => {
 const n1 = ninja('S23'), a = camoUp(3, 300, 0.01), other = place('DartMonkey', 'S30', 200);
 const rule = camoBinding([n1, a], [n1]);
 const same = (state, all, kept, rules) => assert.deepEqual(applyTowerCap(state, all, kept, rules), applyTowerCap(state, all, kept, rules, {}, {bindUnderCap: false}));
 // A check-kind binding (camo): its placements pass through ONE_LIFE_PASS as in revision 10; no answers are recorded for it.
 const camoPlace = place('WizardMonkey', 'S23', 400, {threat: ['camo']});
 const check = {kind: 'threat_short', missing: ['camo'], binding: true, binding_kind: 'check', kept: [camoPlace.id]};
 same(st(), [wait, camoPlace, other], [camoPlace], [check]);
 assert.deepEqual(ids(applyTowerCap(st(), [wait, camoPlace, other], [camoPlace], [check]).candidates), [camoPlace.id]);
 // Two lives: the earlier exception (the placement passes).
 same(st({lives: 2}), [wait, n1, a, other], [n1], [rule]);
 assert.deepEqual(ids(applyTowerCap(st({lives: 2}), [wait, n1, a, other], [n1], [rule]).candidates), [n1.id]);
 // Fewer than 12 towers: the cap does not apply.
 assert.equal(applyTowerCap(st({n: 11}), [wait, n1, a, other], [n1], [rule]), null);
 // The round-48 state with Hard Standard's lives: the same options in revisions 10 and 11.
 const hard = {...fixture.state, lives: 100, starting_lives: 100, max_lives: 100};
 assert.deepEqual(ids(floorRulesV6(hard, fixture.candidates, logged).candidates), ids(floorRulesV6(hard, fixture.candidates, logged, {bindUnderCap: false}).candidates));
});

test('early_short binding under the cap: upgrade answers within EARLY_KEEP of the best of them, Lead and camo answers still first', () => {
 const p1 = place('DartMonkey', 'S23', 200, {early: 0.004}), u1 = up(3, 1, 300, {early: 0.002}), u2 = up(4, 1, 250, {early: 0.0017}), u3 = up(5, 1, 250, {early: 0.001});
 const lead = place('BombShooter', 'S24', 500, {threat: ['lead'], early: 0.001});
 const answers = [p1, u1, u2, u3];
 const kept = [lead, p1];
 const early = withBindAnswers({kind: 'early_short', binding: true, keep: EARLY_KEEP, kept: ids(kept)},
  {list: answers, value: c => c.details.early, keep: EARLY_KEEP, always: [lead]});
 const floor = [{kind: 'threat_short', missing: ['lead']}, early];
 const r = applyTowerCap(st(), [wait, ...answers, lead], kept, floor);
 assert.deepEqual(ids(r.candidates), [lead.id, u1.id, u2.id]);
 assert.equal(r.rule.cap_binding.kind, 'early_short');
 // Revision 10: the early placement capped, the Lead placement passes.
 assert.deepEqual(ids(applyTowerCap(st(), [wait, ...answers, lead], kept, floor, {}, {bindUnderCap: false}).candidates), [lead.id]);
 // Only placement answers: they pass.
 const only = withBindAnswers({kind: 'early_short', binding: true, keep: EARLY_KEEP, kept: [p1.id]}, {list: [p1], value: c => c.details.early, keep: EARLY_KEEP});
 const pass = applyTowerCap(st(), [wait, p1], [p1], [only]);
 assert.deepEqual([ids(pass.candidates), pass.rule.kind, pass.rule.placement_pass], [[p1.id], 'tower_cap_exception', true]);
});

test('v5 and claude-v1: an on-plan (exempt) placement answer counts as allowed under the cap', async () => {
 const spots = meadowSpots.filter(s => ['S04', 'S08', 'S10'].includes(s.id));
 const tower = (id, base_id, spot, tiers) => ({id, base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y, next_upgrades: []});
 const built = [tower(7, 'NinjaMonkey', 'S09', [0, 1, 0]), ...Array.from({length: 11}, (_, i) => tower(20 + i, 'DartMonkey', 'S02', [0, 0, 0]))];
 const state = v0Round6({cash: 1500, lives: 1, starting_lives: 1, max_lives: 1, auto_start: true, towers: built, round: {index: 55, active: false, before_first_wave: false}});
 state.match = {...state.match, mode: 'Clicks', mode_name: 'CHIMPS', end_round: 100, start_round: 6};
 const plan = adoptPlanV1({summary: 'Ninja next.', hero: {tower: 'none', round_from: 3}, threats: [], note: '', cash_hold: [],
  build: [{id: 'ninja', tower: 'NinjaMonkey', tiers: '2-1-0', count: 2, round_from: 50, round_by: 60, priority: 1}]},
  {reason: 'match_start', stamp: requestStampV1(state, {key: 'k'}, {lead: 4, catalog: v0Catalog, freeSpots: spots})}, {request_id: 'r1'});
 const bomb = place('BombShooter', 'S04', 500, {threat: ['camo_capacity'], camo_gain: 0.05});
 const ninjaOnPlan = place('NinjaMonkey', 'S08', 400, {threat: ['camo_capacity'], camo_gain: 0.03});
 const slow = camoUp(20, 300, 0.005, 1);
 const rule = camoBinding([bomb, ninjaOnPlan, slow], [bomb]);
 const floor = {kind: 'rules', rules: [rule]};
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 const facts = () => ({paths, catalog: v0Catalog, leaks: [], pressure: null, lead: 4, freeSpots: spots});
 for (const [name, game] of [['v5', playbookGameV5(facts, {playbook})], ['claude-v1', claudeGameV1(facts)]]) {
  const r = game.constrain(state, [bomb], plan, null, {floor, all: [wait, bomb, ninjaOnPlan, slow]});
  assert.deepEqual(ids(r.candidates), [ninjaOnPlan.id], name);
  const cap = r.constraint.rules.at(-1);
  assert.deepEqual([cap.kind, cap.cap_binding.allowed, cap.cap_binding.kept], ['tower_cap', 2, [ninjaOnPlan.id]], name);
 }
});

// Burst stand-aside under the cap (btd6-jev-v6 revision 14, btd6-playbook-v5 revision 18, btd6-claude-v1 revision 17;
// applyTowerCap burstStandAside). In CHIMPS series 1g match 3 revision 11 passed 15 burst placements under the cap.
const burstFx = JSON.parse(readFileSync(new URL('./fixtures/burst-stand-aside-r73.json', import.meta.url), 'utf8'));
const burstLookup = {spots: new Map(Object.entries(burstFx.spots)), costs: new Map(Object.entries(burstFx.costs))};

test('rounds 73 to 75 of CHIMPS series 1g match 3: revision 13 passes a burst placement, revision 14 leaves only upgrades', () => {
 assert.equal(burstFx.decisions.length, 10);
 const left = [];
 for (const d of burstFx.decisions) {
  const {candidates, skipped} = rebuild(d, burstLookup);
  assert.equal(skipped, 0);
  const old = floorRulesV6(d.state, candidates, logged, {burstStandAside: false});
  const oldCap = old.constraint.rules.at(-1);
  assert.deepEqual([old.constraint.rules.find(q => q.kind === 'threat_short').binding_kind, oldCap.kind, oldCap.placement_pass], ['burst', 'tower_cap_exception', true]);
  assert.ok(old.candidates.some(c => c.details.kind === 'place'), `round ${d.state.round.number}: revision 13 passes a placement`);
  const neu = floorRulesV6(d.state, candidates, logged);
  const cap = neu.constraint.rules.at(-1);
  assert.deepEqual([cap.kind, cap.burst_stand_aside, cap.placement_pass], ['tower_cap', true, undefined]);
  assert.equal(neu.candidates.some(c => c.details.kind === 'place'), false, `round ${d.state.round.number}: no placement`);
  // What the cap allows: affordable upgrades (none of them a burst answer), so "Wait" does not come back.
  assert.ok(neu.candidates.every(c => c.details.kind === 'upgrade' && c.details.cost <= d.state.cash));
  left.push(neu.candidates.length);
 }
 assert.deepEqual(left, [4, 2, 4, 3, 8, 14, 12, 5, 7, 17]);
});

const burstUp = (tower, cost, gain) => up(tower, 1, cost, {threat: ['burst'], burst_gain: gain});
const burstPlace = (tower, spot, cost, gain) => place(tower, spot, cost, {threat: ['burst'], burst_gain: gain});
const burstPer = c => c.details.burst_gain / c.details.cost;
// A threat_short binding record on burst, with its answers and its order-only options (unbound).
function burstBinding(answers, kept, unbound) {
 const rule = {kind: 'threat_short', missing: ['burst'], binding: true, binding_kind: 'burst', keep: THREAT_KEEP, kept: ids(kept)};
 return withBindAnswers(rule, {list: answers, value: burstPer, keep: THREAT_KEEP, unbound});
}

test('burst with no affordable upgrade answer: the binding steps aside, the cap removes placements, upgrades or "Wait" stay', () => {
 const bp = burstPlace('BombShooter', 'S23', 500, 0.01), sky = burstPlace('Skywarden', 'S24', 220, 0.004), dear = burstUp(7, 2500, 0.2);
 const other = up(8, 2, 300), extra = place('DartMonkey', 'S30', 200);
 const rule = burstBinding([bp, sky, dear], [bp, sky], [bp, sky, other, extra]);
 const r = applyTowerCap(st(), [wait, bp, sky, dear, other, extra], [bp, sky], [rule]);
 assert.deepEqual(ids(r.candidates), [other.id]);
 assert.deepEqual(r.rule, {kind: 'tower_cap', removed: 3, towers: 14, cap: TOWER_CAP, one_life_removed: 2, burst_stand_aside: true});
 // Nothing affordable but placements: "Wait" comes back.
 const bare = burstBinding([bp, sky, dear], [bp, sky], [bp, sky, extra]);
 const w = applyTowerCap(st(), [wait, bp, sky, dear, extra], [bp, sky], [bare]);
 assert.deepEqual([ids(w.candidates), w.rule.wait_restored, w.rule.burst_stand_aside], [['wait'], true, true]);
 // Revision 13 (burstStandAside: false): the placement pass.
 const old = applyTowerCap(st(), [wait, bp, sky, dear, other, extra], [bp, sky], [rule], {}, {burstStandAside: false});
 assert.deepEqual([ids(old.candidates), old.rule.placement_pass], [[bp.id, sky.id], true]);
 // Without the order-only options on the record, the bound options are capped.
 const plain = burstBinding([bp, sky, dear], [bp, sky], undefined);
 assert.deepEqual(ids(applyTowerCap(st(), [wait, bp, sky, dear], [bp, sky], [plain]).candidates), ['wait']);
});

test('burst with an affordable upgrade answer: the binding still binds (revision 11)', () => {
 const bp = burstPlace('BombShooter', 'S23', 500, 0.05), bu = burstUp(7, 400, 0.02), other = up(8, 2, 300);
 const rule = burstBinding([bp, bu], [bp], [bp, bu, other]);
 const r = applyTowerCap(st(), [wait, bp, bu, other], [bp], [rule]);
 assert.deepEqual(ids(r.candidates), [bu.id]);
 assert.equal(r.rule.burst_stand_aside, undefined);
 assert.equal(r.rule.cap_binding.kind, 'burst');
 assert.deepEqual(r, applyTowerCap(st(), [wait, bp, bu, other], [bp], [rule], {}, {burstStandAside: false}));
});

test('camo_capacity and lead_capacity keep the placement pass', () => {
 const n1 = ninja('S23'), other = up(8, 2, 300), dear = camoUp(6, 2500, 0.5);
 const camo = withBindAnswers({kind: 'threat_short', missing: ['camo_capacity'], binding: true, binding_kind: 'camo_capacity', keep: THREAT_KEEP, kept: [n1.id]},
  {list: [n1, dear], value: camoPer, keep: THREAT_KEEP, unbound: [n1, other]});
 const lp = place('BombShooter', 'S24', 500, {threat: ['lead_capacity'], lead_gain: 0.2});
 const lead = withBindAnswers({kind: 'threat_short', missing: ['lead_capacity'], binding: true, binding_kind: 'lead_capacity', keep: THREAT_KEEP, kept: [lp.id]},
  {list: [lp], value: c => c.details.lead_gain / c.details.cost, keep: THREAT_KEEP, unbound: [lp, other]});
 for (const [rule, p] of [[camo, n1], [lead, lp]]) {
  const r = applyTowerCap(st(), [wait, p, other], [p], [rule]);
  assert.deepEqual([ids(r.candidates), r.rule.placement_pass, r.rule.burst_stand_aside], [[p.id], true, undefined], rule.binding_kind);
  assert.deepEqual(r, applyTowerCap(st(), [wait, p, other], [p], [rule], {}, {burstStandAside: false}));
 }
});

test('invariant with the stand-aside: "Wait" is left alone only after the burst binding stood aside, never while a binding is in force', () => {
 const pool = [burstPlace('BombShooter', 'S23', 500, 0.01), burstPlace('Skywarden', 'S24', 220, 0.006), burstUp(3, 300, 0.004), burstUp(4, 2500, 0.2), burstUp(5, 900, 0.01)];
 const others = [up(9, 2, 400), place('DartMonkey', 'S30', 200)];
 let cases = 0, aside = 0;
 for (let mask = 1; mask < 1 << pool.length; mask++) {
  const answers = pool.filter((_, i) => mask & (1 << i));
  for (const cash of [250, 1000, 3000]) {
   const state = st({cash});
   const offered = answers.filter(c => c.details.cost <= cash), rest = others.filter(c => c.details.cost <= cash);
   if (!offered.length) continue;
   const sorted = [...offered].sort((x, y) => burstPer(y) - burstPer(x));
   const kept = sorted.filter(c => burstPer(c) >= burstPer(sorted[0]) * THREAT_KEEP);
   const r = applyTowerCap(state, [wait, ...offered, ...rest], kept, [burstBinding(sorted, kept, [...sorted, ...rest])]);
   const left = r ? r.candidates : kept;
   if (r?.rule.burst_stand_aside) {
    aside++;
    assert.equal(left.some(c => c.details.kind === 'place'), false);
    assert.ok(left.every(c => c.id === 'wait' || c.details.kind === 'upgrade'));
   } else assert.ok(buys(left).length > 0 && left.every(c => sorted.includes(c)), `mask ${mask} cash ${cash}: ${ids(left)}`);
   cases++;
  }
 }
 assert.ok(cases > 40 && aside > 5, `${cases} cases, ${aside} stand-asides`);
});

test('burst stand-aside unchanged: more than one life and fewer than 12 towers', () => {
 const bp = burstPlace('BombShooter', 'S23', 500, 0.01), dear = burstUp(7, 2500, 0.2), other = up(8, 2, 300);
 const rule = burstBinding([bp, dear], [bp], [bp, other]);
 const all = [wait, bp, dear, other];
 for (const state of [st({lives: 2}), st({n: 11})]) assert.deepEqual(applyTowerCap(state, all, [bp], [rule]), applyTowerCap(state, all, [bp], [rule], {}, {burstStandAside: false}));
 assert.deepEqual(ids(applyTowerCap(st({lives: 2}), all, [bp], [rule]).candidates), [bp.id]);
 assert.equal(applyTowerCap(st({n: 11}), all, [bp], [rule]), null);
});
