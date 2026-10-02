// threat_short (threat.mjs): Lead and camo readiness under auto-start, its gating per policy, the tower cap's exception,
// survival_first in the plan policies, and the log replay (threat-replay.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THREAT_LEAD_ROUNDS, THREAT_KINDS, THREAT_KINDS_V2, THREAT_BURST_ROUNDS, THREAT_BURST_AHEAD, threatShort, applyThreatShort, answerPool, threatOrder} from './threat.mjs';
import {floorRulesV4, groupOptionsV4} from './policy-v4.mjs';
import {floorRulesV6, applyTowerCap, V6_REVISION, JEV_POLICY_V6, TOWER_CAP} from './policy-v6.mjs';
import {constrainV1, SURVIVAL_RULES} from './rules-v1.mjs';
import {btd6Game, claudeGameV1, playbookGameV5} from './game.mjs';
import {CLAUDE_V1_REVISION} from './plan-v1.mjs';
import {V5_REVISION, loadPlaybook} from './playbook-v5.mjs';
import {buildCandidates} from './candidates.mjs';
import {replayRun, harvest} from './threat-replay.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths} from './fixtures/index.mjs';

// The claude-v1 revision 4 loss (2026-09-30 20:45 UTC) at rounds 25 to 28: Darts 0-2-2, Wizards 1-0-0 (no Lead) and a
// Ninja 0-1-0, at the logged positions. Upgrade costs are the Hard costs the logs show (Wizard x-1-x $325).
const T = (id, base_id, tiers, x, y, next_upgrades = []) => ({id, base_id, tiers, x, y, next_upgrades});
const WIZARD_UPS = [{path: 0, cost: 485, id: 'Fireball'}, {path: 1, cost: 325, id: 'Guided Magic'}, {path: 2, cost: 325, id: 'Intense Magic'}];
const DART_UPS = [{path: 0, cost: 215, id: 'Razor Sharp Shots'}];
const lossTowers = () => [T(392, 'DartMonkey', [0, 2, 2], -26, -44), T(2006, 'DartMonkey', [0, 2, 2], -74, 40), T(4451, 'DartMonkey', [0, 2, 2], -62, -2, DART_UPS),
 T(7910, 'WizardMonkey', [1, 0, 0], -38, -2, WIZARD_UPS), T(9751, 'WizardMonkey', [1, 0, 0], -32, 34, WIZARD_UPS), T(13921, 'NinjaMonkey', [0, 1, 0], -74, -2)];
function at(round, {cash = 280, towers = lossTowers()} = {}) {
 const s = v0Round6({cash, lives: 79, starting_lives: 100, max_lives: 100, auto_start: true, towers, round: {index: round - 1, active: true, before_first_wave: false}});
 s.match = {...s.match, mode: 'Standard', mode_name: 'Standard', end_round: 80, start_round: 3};
 return s;
}
// Only the Dart Monkey and Wizard in the catalog, so the pool's cheapest answer is the Wizard upgrade.
const catalog = v0Catalog.filter(t => ['DartMonkey', 'WizardMonkey'].includes(t.id));
const freeSpots = [{id: 'A', x: 4, y: 70}, {id: 'B', x: 58, y: -8}];
const context = {catalog, freeSpots, paths};
const options = state => buildCandidates(state, context);
const ids = list => list.map(c => c.id);
const threatRule = r => r.constraint?.rules?.find(x => x.kind === 'threat_short');

test('threatShort: the first Lead round (28) is due from round 25, not at 24; a Lead popper ends it', () => {
 assert.equal(THREAT_LEAD_ROUNDS, 3);
 assert.equal(threatShort(at(24), paths), null);
 for (const r of [25, 27, 28]) assert.deepEqual(threatShort(at(r), paths), {round: 28, missing: ['lead'], rounds: {lead: 28}}, `round ${r}`);
 const fixed = lossTowers().map(t => t.id === 7910 ? {...t, tiers: [1, 1, 0]} : t);
 assert.equal(threatShort(at(26, {towers: fixed}), paths), null, 'Wizard 1-1-0 pops Lead');
});

test('an affordable answer: waiting goes and the Lead-adding purchases come first, cheapest first', () => {
 const state = at(26, {cash: 400});
 const r = floorRulesV4(state, options(state), context, {threatShort: true});
 assert.ok(!ids(r.candidates).includes('wait'));
 assert.deepEqual(ids(r.candidates.slice(0, 2)), ['upgrade:7910:p2', 'upgrade:9751:p2']);
 assert.deepEqual(r.candidates[0].details.threat, ['lead']);
 const rule = threatRule(r);
 assert.deepEqual({...rule, removed: undefined}, {kind: 'threat_short', removed: undefined, round: 28, missing: ['lead'], rounds: {lead: 28}, adders: 2, first: 'upgrade:7910:p2'});
 assert.ok(rule.removed >= 0);
 // Other purchases stay, after the answers.
 assert.ok(ids(r.candidates).includes('place:DartMonkey@A'));
 // The grouped question ranks the answer's group first.
 const groups = groupOptionsV4(state, r.candidates, {catalog, paths, max: 2});
 assert.ok(groups[0].members.some(m => m.details.threat?.length));
});

test('no answer affordable: the rule saves for the cheapest, keeping only "Wait"; not under leak pressure', () => {
 const state = at(25, {cash: 280});
 const all = options(state);
 assert.ok(all.some(c => c.id === 'place:DartMonkey@A'), 'a $200 Dart Monkey is on offer');
 const r = floorRulesV4(state, all, context, {threatShort: true});
 assert.deepEqual(ids(r.candidates), ['wait']);
 assert.deepEqual(threatRule(r), {kind: 'threat_short', removed: all.length - 1, round: 28, missing: ['lead'], rounds: {lead: 28}, adders: 0, saving: 325, for: 'upgrade:7910:p2', cash: 280, restored: ['wait']});
 // no_wait_behind had removed "Wait" (the pops verdict); saving puts it back.
 assert.equal(r.constraint.rules.find(x => x.kind === 'no_wait_behind')?.kind, 'no_wait_behind');
 // Leak pressure needs pops now: no saving.
 const pressed = floorRulesV4(state, all, {...context, pressure: {active: true, reason: 'lives_lost'}}, {threatShort: true});
 assert.equal(threatRule(pressed), undefined);
 // "Wait" removed by another rule comes back.
 const noWait = applyThreatShort(state, all.filter(c => c.id !== 'wait'), {paths, all, pool: answerPool(state, context)});
 assert.deepEqual(ids(noWait.candidates), ['wait']);
 assert.deepEqual(noWait.rule.restored, ['wait']);
 // Without a catalog there is no pool and no saving.
 assert.equal(applyThreatShort(state, all, {paths}).rule, null);
});

test('gating: v4 unchanged; v6 revision 2 and later, v5 revision 6 and later and claude-v1 revision 5 and later run threat_short', async () => {
 const state = at(26, {cash: 400});
 const before = floorRulesV4(state, options(state), context);
 assert.deepEqual(before, floorRulesV4(state, options(state), context, {threatShort: false}));
 assert.equal(threatRule(before), undefined);
 assert.equal(threatRule(btd6Game(() => context, {policy: 'btd6-jev-v4'}).rules(state, options(state))), undefined, 'v4');
 assert.ok(threatRule(btd6Game(() => context, {policy: JEV_POLICY_V6}).rules(state, options(state))), 'v6');
 assert.equal(threatRule(floorRulesV6(state, options(state), context, {threatShort: false})), undefined, 'v6 revision 1');
 assert.ok(threatRule(claudeGameV1(() => context).rules(state, options(state))), 'claude-v1');
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 assert.ok(threatRule(playbookGameV5(() => context, {playbook}).rules(state, options(state))), 'v5');
 assert.deepEqual([V6_REVISION, V5_REVISION, CLAUDE_V1_REVISION], [19, 23, 22]);
});

// Round 78 (Monkey Meadow Hard Standard): the defence of the v6 revision 2 loss (log 21-12-37) at round 75, reduced to
// its main towers at their logged positions.
const burstTowers = () => [T(392, 'DartMonkey', [0, 2, 4], -62, -2), T(415, 'BombShooter', [0, 2, 4], -38, -2), T(29767, 'WizardMonkey', [4, 2, 0], -26, -44),
 T(34072, 'SniperMonkey', [4, 2, 0], -62, 28), T(52199, 'WizardMonkey', [3, 2, 0], -74, 40, [{path: 2, cost: 325, id: 'Intense Magic'}])];

test('revision 3 kinds: burst due from round 75 for round 78; purchases that raise it go first, most pops per dollar, no saving', () => {
 assert.deepEqual(THREAT_KINDS, ['lead', 'camo']);
 assert.deepEqual(THREAT_KINDS_V2, ['lead', 'camo', 'camo_lead', 'burst']);
 const state = at(75, {cash: 1000, towers: burstTowers()});
 assert.equal(threatShort(state, paths), null, 'Lead and camo only: nothing due');
 const short = threatShort(state, paths, {kinds: THREAT_KINDS_V2});
 assert.deepEqual(short.missing, ['burst']);
 assert.ok(short.rounds.burst >= 75 && short.rounds.burst <= 78);
 const r = floorRulesV6(state, options(state), context);
 const rule = threatRule(r);
 assert.deepEqual(rule.missing, ['burst']);
 assert.ok(!ids(r.candidates).includes('wait'));
 const adders = r.candidates.filter(c => c.details.threat?.length);
 assert.ok(adders.length >= 2 && adders.every(c => c.details.threat.includes('burst')));
 const perDollar = c => c.details.pops / c.details.cost;
 for (let i = 1; i < adders.length; i++) assert.ok(perDollar(adders[i - 1]) >= perDollar(adders[i]), 'most pops per dollar first');
 // Revision 2's kinds leave the state alone.
 assert.equal(threatRule(floorRulesV6(state, options(state), context, {threatKinds: THREAT_KINDS})), undefined);
 // Nothing affordable: no saving for burst alone.
 const broke = at(75, {cash: 0, towers: burstTowers()});
 assert.equal(applyThreatShort(broke, options(broke), {paths, kinds: THREAT_KINDS_V2, pool: answerPool(broke, context)}).rule, null);
});

test('revision 3 kinds: camo Lead (round 59) needs one tower that does both; a Monkey Ace does not count', () => {
 // The v6 revision 2 loss at round 59 (log 22-11-44): Lead from a Bomb Shooter, camo from a Dart Monkey 0-2-4, and a Monkey
 // Ace 4-2-0 whose Pineapple drops see camo and pop Lead.
 const towers = [T(1, 'BombShooter', [0, 2, 4], -38, -2), T(2, 'DartMonkey', [0, 2, 4], -62, -2), T(3, 'MonkeyAce', [4, 2, 0], -32, 34)];
 const state = at(56, {cash: 2000, towers});
 assert.equal(threatShort(state, paths), null, 'Lead and camo each covered');
 const short = threatShort(state, paths, {kinds: ['camo_lead']});
 assert.deepEqual(short, {round: 59, missing: ['camo_lead'], rounds: {camo_lead: 59}});
 const sniperCatalog = v0Catalog.filter(t => t.id === 'SniperMonkey');
 const withSniper = at(56, {cash: 2000, towers: [...towers, T(4, 'SniperMonkey', [1, 1, 0], -62, 28)]});
 assert.equal(threatShort(withSniper, paths, {kinds: ['camo_lead']}), null, 'a Sniper 1-1-0 does both');
 // Saving applies: the cheapest answer in the pool is a Sniper placement or upgrade.
 const pool = answerPool(state, {catalog: sniperCatalog, freeSpots, paths});
 assert.ok(pool.some(c => c.details.kind === 'place' && c.details.tower === 'SniperMonkey'));
});

test('plan policies: threat_short is a survival rule, so the plan filters step aside', () => {
 assert.ok(SURVIVAL_RULES.includes('threat_short'));
 const state = at(26, {cash: 400});
 const floor = floorRulesV4(state, options(state), context, {threatShort: true});
 // A plan whose due target is a Dart Monkey placement: without survival_first, off_plan would drop the Wizard upgrades.
 const plan = {summary: '', hero: {tower: 'none', round_from: 3}, build: [{id: 'darts', tower: 'DartMonkey', tiers: '0-0-0', count: 9, round_from: 3, round_by: 30, priority: 1}],
  cash_hold: [], threats: [], note: ''};
 const r = constrainV1(state, floor.candidates, plan, {...context, lead: 4}, {floor: floor.constraint, all: options(state), towerCap: true});
 assert.deepEqual(r.constraint.rules[0], {kind: 'survival_first', removed: 0, floor: ['threat_short']});
 assert.equal(r.candidates[0].id, 'upgrade:7910:p2');
});

test('tower cap: a placement that adds the missing property stays only when no upgrade adds it', () => {
 const filler = Array.from({length: 7}, (_, i) => T(100 + i, 'DartMonkey', [0, 0, 0], 100, -100 + 10 * i));
 const bomb = {id: 'place:BombShooter@A', command: {action: 'place_tower', tower: 'BombShooter', x: 4, y: 70}, details: {kind: 'place', tower: 'BombShooter', cost: 525, threat: ['lead']}};
 const dart = {id: 'place:DartMonkey@A', command: {action: 'place_tower', tower: 'DartMonkey', x: 4, y: 70}, details: {kind: 'place', tower: 'DartMonkey', cost: 200}};
 const wizUp = {id: 'upgrade:7910:p2', details: {kind: 'upgrade', tower_id: 7910, cost: 325, threat: ['lead']}};
 const dartUp = {id: 'upgrade:4451:p1', details: {kind: 'upgrade', tower_id: 4451, cost: 215}};
 const wait = {id: 'wait', details: {kind: 'wait'}};
 const state = at(26, {cash: 600, towers: [...lossTowers(), ...filler]});
 const rules = [{kind: 'threat_short', removed: 1, round: 28, missing: ['lead']}];
 // No upgrade adds Lead: the Bomb Shooter stays, the Dart Monkey is capped.
 const a = applyTowerCap(state, [wait, bomb, dart, dartUp], [bomb, dart, dartUp], rules, context);
 assert.deepEqual(ids(a.candidates), ['place:BombShooter@A', 'upgrade:4451:p1']);
 assert.deepEqual(a.rule, {kind: 'tower_cap_exception', towers: 13, cap: TOWER_CAP, survival: ['threat_short'], removed: 1});
 // An upgrade adds Lead: both placements are capped.
 const b = applyTowerCap(state, [wait, bomb, dart, wizUp], [wizUp, bomb, dart], rules, context);
 assert.deepEqual(ids(b.candidates), ['upgrade:7910:p2']);
 assert.equal(b.rule.kind, 'tower_cap');
});

test('replay: rebuilt from a log, the rule saves while no answer is affordable and puts it first once it is', () => {
 const state = (cash, round = 25) => ({...at(round, {cash}), towers: lossTowers().map(({next_upgrades, ...t}) => t)});
 const decision = (cash, chosen, extra = {}) => ({kind: 'decision', outcome: 'queued', state: state(cash), options: ['wait', 'place:DartMonkey@S20', ...(cash >= 325 ? ['upgrade:7910:p2'] : [])],
  chosen, ...extra});
 const records = [
  decision(280, {id: 'place:DartMonkey@S20', label: 'Place Dart Monkey at S20 ($215)', command: {action: 'place_tower', tower: 'DartMonkey', x: 4, y: 70}}),
  decision(400, {id: 'upgrade:7910:p2', label: 'Upgrade WizardMonkey #7910 to 1-1-0 ($325)', command: {action: 'upgrade_tower', tower_id: 7910, path: 1}}),
 ];
 const rows = replayRun(records, harvest([{records}]), {paths});
 assert.deepEqual(rows.map(r => [r.round, r.fired, r.saving, r.saving_for, r.cash_if_saved]), [[25, false, 325, 'upgrade:7910:p2', 280], [25, true, null, null, 615]]);
 assert.equal(rows[1].first, 'upgrade:7910:p2');
 assert.equal(rows[1].chosen_adds, true);
});

test('revision 3 kinds: a burst gap alone yields to moab_short', () => {
 const state = at(75, {cash: 1000, towers: burstTowers()});
 const all = options(state);
 assert.ok(applyThreatShort(state, all, {paths, kinds: THREAT_KINDS_V2}).rule);
 assert.equal(applyThreatShort(state, all, {paths, kinds: THREAT_KINDS_V2, moabFirst: true}).rule, null);
});

test('revision 4 (v6), 8 (v5), 7 (claude-v1): burst is checked 3 rounds ahead, as in revision 3; the first answer’s gain is recorded', () => {
 assert.equal(THREAT_BURST_ROUNDS, 3);
 assert.deepEqual(THREAT_BURST_AHEAD, {burstLead: 3, burstGain: true});
 // These towers fall short of round 76's burst (ratio 0.72 on towers.json with the stance and ring corrections; 0.78
 // before) and clear rounds 68 to 75's.
 const neu = n => threatShort(at(n, {towers: burstTowers()}), paths, {kinds: THREAT_KINDS_V2, burstLead: THREAT_BURST_ROUNDS});
 const old = n => threatShort(at(n, {towers: burstTowers()}), paths, {kinds: THREAT_KINDS_V2});
 for (const n of [68, 72, 73, 75]) assert.deepEqual(neu(n), old(n), `round ${n}: the same window as revision 3`);
 assert.equal(neu(72), null, 'round 76 is 4 rounds after 72');
 assert.deepEqual([neu(73).rounds, neu(73).ratios], [{burst: 76}, {burst: 0.72}]);
 // The policies: v6's default floor flags round 76 at round 73 and records the first answer's gain; v4 runs no threat_short.
 const state = at(73, {cash: 1000, towers: burstTowers()});
 const rule = threatRule(floorRulesV6(state, options(state), context));
 assert.deepEqual([rule.rounds, rule.missing], [{burst: 76}, ['burst']]);
 assert.ok(rule.first_gain > 0 && rule.first_cost > 0);
 assert.equal(threatRule(floorRulesV6(at(72, {cash: 1000, towers: burstTowers()}), options(state), context)), undefined, 'nothing at round 72');
 assert.equal(threatRule(btd6Game(() => context, {policy: 'btd6-jev-v4'}).rules(state, options(state))), undefined, 'v4');
 assert.ok(threatRule(claudeGameV1(() => context).rules(state, options(state))), 'claude-v1 revision 7');
});

test('burst-only answers go highest burst-ratio gain per dollar first; Lead and camo answers keep cheapest first', () => {
 const c = (id, cost, pops, threat, burst_gain) => ({id, details: {kind: 'place', cost, pops, threat, ...(burst_gain != null ? {burst_gain} : {})}});
 // a: cheap, more pops per dollar, little burst gain; b: dear, twice the gain per dollar.
 const a = c('a', 200, 5, ['burst'], 0.002), b = c('b', 1000, 10, ['burst'], 0.02);
 assert.deepEqual(ids([a, b].sort(threatOrder)), ['b', 'a'], 'gain per dollar: 0.00002 against 0.00001');
 const a0 = c('a', 200, 5, ['burst']), b0 = c('b', 1000, 10, ['burst']);
 assert.deepEqual(ids([b0, a0].sort(threatOrder)), ['a', 'b'], 'without burst_gain (revision 3): pops per dollar');
 const lead = c('lead', 500, 1, ['lead']), leadDear = c('leadDear', 900, 50, ['lead', 'burst'], 0.5);
 assert.deepEqual(ids([b, leadDear, a, lead].sort(threatOrder)), ['lead', 'leadDear', 'b', 'a'], 'check answers first, cheapest first');
 // On real options: the rule records burst_gain only with burstGain, and orders by it.
 const state = at(75, {cash: 1000, towers: burstTowers()});
 const neu = applyThreatShort(state, options(state), {paths, kinds: THREAT_KINDS_V2, ...THREAT_BURST_AHEAD});
 const adders = neu.candidates.filter(x => x.details.threat?.length);
 assert.ok(adders.length >= 2 && adders.every(x => x.details.burst_gain > 0));
 for (let i = 1; i < adders.length; i++) assert.ok(adders[i - 1].details.burst_gain / adders[i - 1].details.cost >= adders[i].details.burst_gain / adders[i].details.cost);
 const old = applyThreatShort(state, options(state), {paths, kinds: THREAT_KINDS_V2});
 assert.ok(old.candidates.every(x => !('burst_gain' in x.details)), 'revision 3 records no gain');
 // Saving is unchanged: nothing affordable and only burst short, no saving.
 const broke = at(75, {cash: 0, towers: burstTowers()});
 assert.equal(applyThreatShort(broke, options(broke), {paths, kinds: THREAT_KINDS_V2, ...THREAT_BURST_AHEAD, pool: answerPool(broke, context)}).rule, null);
});

test('tower cap with one life: only Lead, camo and camo Lead answer placements pass (v6 revision 10)', () => {
 const towers = n => Array.from({length: n}, (_, i) => ({id: i + 1, base_id: 'DartMonkey', tiers: [0, 0, 0]}));
 const st = (n, lives = 1) => ({in_game: true, cash: 2000, lives, towers: towers(n), round: {number: 70}});
 const place = (tower, extra = {}) => ({id: `place:${tower}@A`, details: {kind: 'place', tower, cost: 500, ...extra}});
 const wait = {id: 'wait', details: {kind: 'wait'}};
 const burstPlace = place('BombShooter', {threat: ['burst'], burst_gain: 0.02});
 const burstUp = {id: 'upgrade:3:p1', details: {kind: 'upgrade', tower_id: 3, cost: 600, threat: ['burst'], burst_gain: 0.01}};
 const camoCapPlace = place('NinjaMonkey', {threat: ['camo_capacity'], camo_gain: 0.1});
 const camoPlace = place('WizardMonkey', {threat: ['camo']});
 const other = place('DartMonkey');
 const short = kinds => [{kind: 'threat_short', round: 72, missing: kinds}];
 // A burst answer placement goes, the burst upgrade answer stays.
 const a = applyTowerCap(st(12), [wait, burstPlace, burstUp], [burstPlace, burstUp], short(['burst']));
 assert.deepEqual([ids(a.candidates), a.rule.kind, a.rule.one_life_removed], [[burstUp.id], 'tower_cap', undefined]);
 // With no upgrade answer the placement would have passed before: now it is capped and "Wait" comes back.
 const b = applyTowerCap(st(14), [wait, camoCapPlace, other], [camoCapPlace], short(['camo_capacity']));
 assert.deepEqual(ids(b.candidates), ['wait']);
 assert.deepEqual(b.rule, {kind: 'tower_cap', removed: 1, towers: 14, cap: TOWER_CAP, wait_restored: true, one_life_removed: 1});
 // A placement that adds missing camo still passes; the camo capacity placement beside it is capped.
 const c = applyTowerCap(st(12), [wait, camoPlace, camoCapPlace, other], [camoPlace, camoCapPlace, other], short(['camo', 'camo_capacity']));
 assert.deepEqual(ids(c.candidates), [camoPlace.id]);
 assert.deepEqual(c.rule, {kind: 'tower_cap_exception', towers: 12, cap: TOWER_CAP, survival: ['threat_short'], removed: 2, one_life_removed: 1});
 // early_short answers: placements capped with one life.
 const early = place('DartMonkey', {early: 0.1});
 const d = applyTowerCap(st(12), [wait, early], [early], [{kind: 'early_short'}]);
 assert.deepEqual([ids(d.candidates), d.rule.one_life_removed], [['wait'], 1]);
 // Two lives, or oneLife: false (revision 9): the earlier exception.
 for (const [state, opts] of [[st(14, 2), {}], [st(14), {oneLife: false}]]) {
  const e = applyTowerCap(state, [wait, camoCapPlace, other], [camoCapPlace], short(['camo_capacity']), {}, opts);
  assert.deepEqual([ids(e.candidates), e.rule.kind, e.rule.one_life_removed], [[camoCapPlace.id], 'tower_cap_exception', undefined]);
 }
 // Below 12 towers the cap does not apply: placements stay.
 assert.equal(applyTowerCap(st(11), [wait, burstPlace, camoCapPlace], [burstPlace, camoCapPlace], short(['burst', 'camo_capacity'])), null);
 // Nothing left and no "Wait" to restore: the cap does not apply.
 assert.equal(applyTowerCap(st(12), [camoCapPlace], [camoCapPlace], short(['camo_capacity'])), null);
});
