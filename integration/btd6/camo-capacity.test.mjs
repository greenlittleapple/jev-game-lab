// threat_short's camo_capacity kind (threat.mjs THREAT_KINDS_V3): trigger, ranking, no saving, the order of kinds, and the
// survival-rule behaviour in the plan policies (survival_first, the tower cap's exception).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THREAT_KINDS_V2, THREAT_KINDS_V3, THREAT_BURST_AHEAD, CAMO_CAPACITY_AT, threatShort, applyThreatShort, answerPool, threatOrder} from './threat.mjs';
import {camoCheck} from './estimate.mjs';
import {floorRulesV4} from './policy-v4.mjs';
import {floorRulesV6, JEV_POLICY_V6} from './policy-v6.mjs';
import {constrainV1} from './rules-v1.mjs';
import {btd6Game, claudeGameV1, playbookGameV5} from './game.mjs';
import {loadPlaybook} from './playbook-v5.mjs';
import {buildCandidates} from './candidates.mjs';
import {camoCapacityReplay, formatCamoCapacity, harvest} from './threat-replay.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths} from './fixtures/index.mjs';

// Two camo Darts (0-2-2) and a Lead-popping Bomb Shooter (0-2-4) on Monkey Meadow: in rounds 50 to 56 their camo margin is
// 0.06 to 0.46 (rounds 51, 53 and 56 have camo bloons; 52, 54 and 55 none).
const T = (id, base_id, tiers, x, y, next_upgrades = []) => ({id, base_id, tiers, x, y, next_upgrades});
const DART_UPS = [{path: 1, cost: 340, id: 'Triple Shot'}, {path: 2, cost: 500, id: 'Crossbow'}];
const towers = ({ups = DART_UPS, bomb = true} = {}) => [T(1, 'DartMonkey', [0, 2, 2], -62, -2, ups), T(2, 'DartMonkey', [0, 2, 2], -26, -44, ups),
 ...(bomb ? [T(3, 'BombShooter', [0, 2, 4], -38, -2)] : [])];
function at(round, {cash = 1000, list = towers()} = {}) {
 const s = v0Round6({cash, lives: 100, starting_lives: 100, max_lives: 100, auto_start: true, towers: list, round: {index: round - 1, active: true, before_first_wave: false}});
 s.match = {...s.match, mode: 'Standard', mode_name: 'Standard', end_round: 80, start_round: 3};
 return s;
}
const catalog = v0Catalog.filter(t => ['DartMonkey', 'WizardMonkey', 'BombShooter', 'NinjaMonkey'].includes(t.id));
const context = {catalog, freeSpots: [{id: 'A', x: 4, y: 70}], paths};
const options = state => buildCandidates(state, context);
const ids = list => list.map(c => c.id);
const threatRule = r => r.constraint?.rules?.find(x => x.kind === 'threat_short');
const run = (state, extra = {}) => { const all = options(state); return applyThreatShort(state, all, {paths, kinds: THREAT_KINDS_V3, ...THREAT_BURST_AHEAD, all, pool: () => answerPool(state, context), ...extra}); };

test('trigger: a camo round within 3 rounds whose camo margin is below 1.0; not in V2 kinds', () => {
 assert.equal(CAMO_CAPACITY_AT, 1.0);
 assert.deepEqual(THREAT_KINDS_V3, ['lead', 'camo', 'camo_lead', 'camo_capacity', 'burst']);
 const s = at(53);
 const short = threatShort(s, paths, {kinds: THREAT_KINDS_V3});
 assert.equal(short.rounds.camo_capacity, 53);
 assert.equal(short.ratios.camo_capacity, camoCheck(s.towers, 53, {lives: 100, paths}).ratio);
 assert.ok(short.ratios.camo_capacity < 1);
 // From round 54 the next camo round is 56 (54 and 55 have none).
 assert.equal(threatShort(at(54), paths, {kinds: THREAT_KINDS_V3}).rounds.camo_capacity, 56);
 // V2 kinds don't check it.
 assert.ok(!('camo_capacity' in (threatShort(s, paths, {kinds: THREAT_KINDS_V2})?.rounds ?? {})));
 // Enough camo pops (four Ninjas 4-0-2 at the Darts' positions): no camo_capacity.
 const strong = [1, 2, 3, 4].map(i => T(10 + i, 'NinjaMonkey', [4, 0, 2], -62 + 10 * i, -2));
 assert.ok(camoCheck(strong, 53, {lives: 100, paths}).ratio >= 1);
 assert.ok(!('camo_capacity' in (threatShort(at(53, {list: [...towers(), ...strong]}), paths, {kinds: THREAT_KINDS_V3})?.rounds ?? {})));
});

test('answers: purchases that raise the camo margin go first, highest gain per dollar; waiting is removed; the record names the round, margin and threshold', () => {
 const s = at(53);
 const {candidates, rule} = run(s);
 assert.ok(!ids(candidates).includes('wait'));
 const answers = candidates.filter(c => c.details.threat?.includes('camo_capacity'));
 assert.ok(answers.length >= 2);
 assert.deepEqual(ids(candidates.slice(0, answers.length)), ids(answers), 'answers first');
 const perDollar = answers.map(c => c.details.camo_gain / c.details.cost);
 assert.deepEqual(perDollar, [...perDollar].sort((a, b) => b - a), 'highest camo gain per dollar first');
 // A burst-only answer comes after the camo answers, whatever its burst gain.
 assert.ok(candidates.slice(answers.length).some(c => c.details.threat?.length && !c.details.threat.includes('camo_capacity')));
 assert.deepEqual(rule.camo_capacity, {round: 53, camo_margin: 0.46, at: 1});
 assert.equal(rule.first, answers[0].id);
 assert.deepEqual([rule.first_camo_gain, rule.first_cost], [answers[0].details.camo_gain, answers[0].details.cost]);
});

test('no saving: with no camo answer affordable the options stay as they are', () => {
 const s = at(53, {cash: 150});
 const all = options(s);
 const {candidates, rule} = run(s);
 assert.ok(!candidates.some(c => c.details.threat?.includes('camo_capacity')));
 assert.equal(rule, null);
 assert.deepEqual(ids(candidates), ids(all));
 assert.ok(ids(candidates).includes('wait'));
 // camo_capacity alone (burst left out) is a rate kind too.
 assert.equal(applyThreatShort(s, all, {paths, kinds: ['lead', 'camo', 'camo_lead', 'camo_capacity'], all, pool: () => answerPool(s, context)}).rule, null);
 // And while moab_short puts MOAB damage first, a camo_capacity gap alone leaves the options.
 assert.equal(run(at(53), {moabFirst: true}).rule, null);
});

test('order of kinds: Lead first, then camo Lead, then camo capacity, then burst', () => {
 // Round 42, no Lead popper: Lead is due at 45 and camo capacity at 42; the Bomb Shooter placement (Lead) goes before the
 // cheaper camo answers. (Rounds 42 to 45 have no MOAB-class round due, so moab_short stays quiet.)
 const s = at(42, {list: towers({bomb: false})});
 const {candidates, rule} = run(s);
 assert.ok(rule.missing.includes('lead') && rule.missing.includes('camo_capacity'), rule.missing.join());
 assert.ok(candidates[0].details.threat.includes('lead'), candidates[0].id);
 const firstCamo = candidates.findIndex(c => c.details.threat?.includes('camo_capacity') && !c.details.threat.includes('lead'));
 const firstBurst = candidates.findIndex(c => c.details.threat?.length && c.details.threat.every(k => k === 'burst'));
 assert.ok(firstCamo > 0 && (firstBurst < 0 || firstCamo < firstBurst));
 // threatOrder on tagged purchases: camo Lead before camo capacity before burst, whatever the cost.
 const c = (id, threat, cost, extra = {}) => ({id, details: {kind: 'place', cost, threat, ...extra}});
 const list = [c('burst', ['burst'], 100, {burst_gain: 0.5}), c('cap', ['camo_capacity'], 900, {camo_gain: 0.1}), c('cl', ['camo_lead'], 2000)];
 assert.deepEqual(ids([...list].sort(threatOrder)), ['cl', 'cap', 'burst']);
});

// Round 42 (camo margin 0.36; no MOAB-class round due within 4 rounds, so moab_short doesn't set it aside).
test('plan policies: camo_capacity is a survival rule; the tower cap lets an answering placement through only when no upgrade answers', async () => {
 const s = at(42);
 const floor = floorRulesV4(s, options(s), context, {threatShort: true, threatKinds: THREAT_KINDS_V3, threatOptions: THREAT_BURST_AHEAD});
 assert.ok(threatRule(floor).missing.includes('camo_capacity'));
 const plan = {summary: '', hero: {tower: 'none', round_from: 3}, build: [{id: 'wiz', tower: 'WizardMonkey', tiers: '0-0-0', count: 9, round_from: 3, round_by: 60, priority: 1}],
  cash_hold: [], threats: [], note: ''};
 const r = constrainV1(s, floor.candidates, plan, {...context, lead: 4}, {floor: floor.constraint, all: options(s), towerCap: true});
 assert.deepEqual(r.constraint.rules[0], {kind: 'survival_first', removed: 0, floor: ['threat_short']});
 assert.equal(r.candidates[0].id, floor.candidates[0].id);
 // The three policies run it.
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 for (const [name, game] of [['v6', btd6Game(() => context, {policy: JEV_POLICY_V6})], ['claude-v1', claudeGameV1(() => context)], ['v5', playbookGameV5(() => context, {playbook})]])
  assert.ok(threatRule(game.rules(s, options(s)))?.camo_capacity, name);
 // Tower cap (13 towers): with Dart upgrades that answer, placements are capped.
 const filler = Array.from({length: 10}, (_, i) => T(100 + i, 'WizardMonkey', [0, 0, 0], 100, -100 + 10 * i));
 const capped = at(42, {list: [...towers(), ...filler]});
 const a = floorRulesV6(capped, options(capped), context);
 assert.equal(a.constraint.rules.at(-1).kind, 'tower_cap');
 assert.ok(!a.candidates.some(c => c.details.kind === 'place'));
 // No upgrade answers (none offered): placements that answer stay (here every placement adds burst, which is also due),
 // and the Ninja, the one that sees camo, goes first.
 const bare = at(42, {list: [...towers({ups: []}), ...filler]});
 const b = floorRulesV6(bare, options(bare), context);
 assert.deepEqual(b.constraint.rules.at(-1).survival, ['threat_short']);
 assert.equal(b.constraint.rules.at(-1).kind, 'tower_cap_exception');
 const placed = b.candidates.filter(c => c.details.kind === 'place');
 assert.ok(placed.length && placed.every(c => c.details.threat?.length));
 assert.deepEqual(ids(placed.filter(c => c.details.threat.includes('camo_capacity'))), ['place:NinjaMonkey@A']);
 assert.equal(b.candidates[0].id, 'place:NinjaMonkey@A');
 assert.ok(b.candidates[0].details.threat.includes('camo_capacity'));
});

test('replay (data only): the decisions where camo_capacity decides, against the series 6 rule, with the first answer and cost', () => {
 const s = at(42);
 const records = [{kind: 'run_start', policy: JEV_POLICY_V6, policy_revision: 4},
  {kind: 'decision', state: s, options: ['wait', 'upgrade:1:p2', 'upgrade:2:p3'], chosen: {id: 'wait', label: 'Wait'}},
  {kind: 'decision', state: s, options: ['wait'], chosen: {id: 'upgrade:1:p2', label: 'Upgrade DartMonkey #1 to 0-3-2 ($340)', command: {action: 'upgrade_tower', tower_id: 1, path: 1}}},
  {kind: 'decision', state: s, options: ['wait'], chosen: {id: 'upgrade:2:p3', label: 'Upgrade DartMonkey #2 to 0-2-3 ($500)', command: {action: 'upgrade_tower', tower_id: 2, path: 2}}}];
 const lookup = harvest([{records}]);
 const {flagged, suppressed, rows} = camoCapacityReplay(records, lookup, {paths});
 assert.deepEqual([flagged, suppressed], [3, 0]);
 assert.equal(rows.length, 1);
 const [row] = rows;
 assert.deepEqual([row.round, row.due, row.camo_margin, row.change, row.answers, row.old, row.chosen], [42, 42, 0.36, 'same', 2, 'first upgrade:2:p3', 'wait'], 'burst also short: the old rule removed "Wait" too, with the same first answer');
 assert.ok(['upgrade:1:p2', 'upgrade:2:p3'].includes(row.first.id) && row.first.cost > 0 && row.first.camo_gain > 0);
 assert.deepEqual(row.after_cap, row.first, 'three towers: no cap');
 assert.match(formatCamoCapacity([{name: 'r', policy: 'btd6-jev-v6 r4', flagged, suppressed, rows}]), /btd6-jev-v6 r4 \| 1 \| 3 \| 0 \| 1 \| 0/);
});
