import {test} from 'node:test';
import assert from 'node:assert/strict';
// Policy btd6-jev-v6 (the tower cap) and majority wait, which btd6-playbook-v5 and btd6-claude-v1 share; from
// v5 revision 4 and claude-v1 revision 3 they count only on-plan purchases (game.mjs planMajorityWait).
import {decide, majorityWait as coreMajorityWait, newStrategyStatus} from '../../core/hierarchical.mjs';
import {btd6Game, claudeGameV1, playbookGameV5, MAJORITY_WAIT, planMajorityWait} from './game.mjs';
import {adoptPlanV1, requestStampV1, CLAUDE_V1_REVISION} from './plan-v1.mjs';
import {constrainV1} from './rules-v1.mjs';
import {V5_REVISION, loadPlaybook} from './playbook-v5.mjs';
import {buildCandidates} from './candidates.mjs';
import {floorRulesV4, groupOptionsV4} from './policy-v4.mjs';
import {JEV_POLICY_V6, TOWER_CAP, floorRulesV6, cappedTowers} from './policy-v6.mjs';
import {runConfig} from './session.mjs';
import {nearTies, scoreRun} from './progress.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths, meadowSpots, meadowSpot} from './fixtures/index.mjs';

const tower = (id, base_id, spot, tiers, next_upgrades = [], extra = {}) => ({id, base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y, next_upgrades, ...extra});
// policy-v4.test.mjs's round-40 build (9 towers) plus three 0-0-0 Dart Monkeys: 12 towers.
const build = ({upgrades = true} = {}) => {
 const up = list => upgrades ? list : [];
 return [
  tower(1, 'MortarMonkey', 'S01', [0, 3, 2], up([{path: 1, cost: 1100, id: 'Artillery Battery'}])), tower(2, 'DartMonkey', 'S02', [2, 3, 0]),
  tower(3, 'WizardMonkey', 'S12', [1, 0, 0], up([{path: 0, cost: 450, id: 'Fireball'}])), tower(4, 'BombShooter', 'S07', [0, 2, 3]),
  tower(5, 'DartMonkey', 'S03', [2, 3, 0]), tower(6, 'MortarMonkey', 'S06', [0, 3, 2], up([{path: 1, cost: 1100, id: 'Artillery Battery'}])),
  tower(7, 'NinjaMonkey', 'S09', [0, 1, 0], up([{path: 0, cost: 300, id: 'Ninja Discipline'}])),
  tower(8, 'SniperMonkey', 'S05', [2, 2, 0], up([{path: 0, cost: 1300, id: 'Deadly Precision'}])), tower(9, 'DartMonkey', 'S11', [3, 2, 0]),
  tower(10, 'DartMonkey', 'S02', [0, 0, 0]), tower(11, 'DartMonkey', 'S03', [0, 0, 0]), tower(12, 'DartMonkey', 'S11', [0, 0, 0]),
 ];
};
const freeSpots = meadowSpots.filter(s => ['S04', 'S08', 'S10'].includes(s.id));
function between(round, {cash = 1500, towers = build()} = {}) {
 const s = v0Round6({cash, lives: 32, starting_lives: 100, max_lives: 100, auto_start: true, towers, round: {index: round - 1, active: false, before_first_wave: false}});
 s.match = {...s.match, mode: 'Standard', mode_name: 'Standard', end_round: 80, start_round: 3};
 return s;
}
const options = state => buildCandidates(state, {catalog: v0Catalog, freeSpots, paths});
const context = {paths, catalog: v0Catalog, leaks: [], pressure: null};
const kinds = list => list.map(c => c.details?.kind);
const places = list => list.filter(c => c.details?.kind === 'place').map(c => c.details.tower);

// The first group answer at round 43 of the v4 run lost at round 51 (2026-09-30 09:26 UTC).
const ROUND_43 = {'place:MonkeyAce': 0.19, 'place:DartMonkey': 0.01, wait: 0.45, 'upgrade:74880': 0.03, 'place:EngineerMonkey': 0.02, 'upgrade:86052': 0.05,
 'place:Mermonkey': 0.01, 'place:BeastHandler': 0, 'place:WizardMonkey': 0.03, 'place:BombShooter': 0.07, 'upgrade:154295': 0.04, 'place:Alchemist': 0.01,
 'upgrade:110931': 0.03, 'upgrade:119880': 0.04, 'place:Druid': 0.01, 'place:BoomerangMonkey': 0.01};
const majorityWait = (options, answer, {stage}) => coreMajorityWait(options, answer, {stage, ...MAJORITY_WAIT});
const groupsOf = probabilities => Object.keys(probabilities).map(id => ({id, label: id, details: {kind: ['wait', 'start_round'].includes(id) ? id : id.split(':')[0] + '_group'}, members: []}));

test('majority wait: a plurality "Wait" (0.45 against 0.19, 0.07, ...) goes to the most probable purchase group', () => {
 const groups = groupsOf(ROUND_43);
 const r = majorityWait(groups, {type: 'choice', choice: 'wait', probabilities: ROUND_43}, {stage: 'group'});
 assert.deepEqual(r, {choice: 'place:MonkeyAce', record: {kind: 'majority_wait', p_wait: 0.45, p_buy: 0.55, chosen_group: 'place:MonkeyAce', p_chosen: 0.19}});
 const flat = majorityWait(groups, {type: 'choice', choice: 'wait', probabilities: ROUND_43}, {stage: 'flat'});
 assert.equal(flat.record.chosen, 'place:MonkeyAce');
 assert.equal(majorityWait(groups, {type: 'choice', choice: 'wait', probabilities: ROUND_43}, {stage: 'member'}), null, 'no wait in the move question for a group');
});

test('majority wait: starting the next round is a pass, not a purchase', () => {
 const passes = {wait: 0.45, start_round: 0.3, 'place:MonkeyAce': 0.15, 'upgrade:86052': 0.1};
 assert.equal(majorityWait(groupsOf(passes), {type: 'choice', choice: 'wait', probabilities: passes}, {stage: 'group'}), null, 'purchases 0.25: the wait stands, and start_round never replaces it');
 const buy = {wait: 0.3, start_round: 0.1, 'place:MonkeyAce': 0.35, 'upgrade:86052': 0.25};
 assert.equal(majorityWait(groupsOf(buy), {type: 'choice', choice: 'wait', probabilities: buy}, {stage: 'group'}).choice, 'place:MonkeyAce');
});

test('majority wait: "Wait" with at least 0.5, a purchase, or no probabilities stays as Jev chose', () => {
 const p = {...ROUND_43, wait: 0.6, 'place:MonkeyAce': 0.04};
 assert.equal(majorityWait(groupsOf(p), {type: 'choice', choice: 'wait', probabilities: p}, {stage: 'group'}), null);
 const even = {...ROUND_43, wait: 0.5, 'place:MonkeyAce': 0.14};
 assert.equal(majorityWait(groupsOf(even), {type: 'choice', choice: 'wait', probabilities: even}, {stage: 'group'}), null, 'purchases at exactly half keep the wait');
 assert.equal(majorityWait(groupsOf(ROUND_43), {type: 'choice', choice: 'place:MonkeyAce', probabilities: ROUND_43}, {stage: 'group'}), null);
 assert.equal(majorityWait(groupsOf(ROUND_43), {type: 'choice', choice: 'wait', probabilities: {}}, {stage: 'group'}), null);
});

test('a v6 decision: the group override continues into that group\'s move question and is recorded', async () => {
 const state = between(20, {towers: build().slice(0, 9)});
 const kept = floorRulesV6(state, options(state), context).candidates;
 assert.ok(kinds(kept).includes('wait'), 'v4 keeps "Wait" here');
 const groups = groupOptionsV4(state, kept, {catalog: v0Catalog, paths});
 assert.ok(groups?.length > 2, 'two-stage question');
 const target = groups.find(g => g.details.kind === 'place_group' && g.members.length > 1).id;
 const asked = [];
 const ask = async q => {
  const offered = Object.keys(q.questions.move.criteria);
  asked.push(offered);
  const probabilities = Object.fromEntries(offered.map(id => [id, id === 'wait' ? 0.45 : id === target ? 0.2 : 0.35 / (offered.length - 2)]));
  const choice = offered.includes('wait') ? 'wait' : offered[0];
  return {model: 'jev-test', answers: {move: {type: 'choice', choice, confidence: 0.5, probabilities}}, usage: {input_tokens: 1, output_tokens: 1}};
 };
 const game = btd6Game(() => context, {policy: JEV_POLICY_V6});
 const r = await decide({state, candidates: options(state), game, ask});
 assert.equal(asked.length, 2, 'group question, then the move question');
 assert.ok(r.choice.id.startsWith(target + '@'), r.choice.id);
 assert.deepEqual(r.tieBreaks, [{stage: 'group', kind: 'majority_wait', p_wait: 0.45, p_buy: 0.55, chosen_group: target, p_chosen: 0.2}]);
});

test('tower cap: with 12 towers (not counting the hero) only upgrades, the hero and waiting are offered', () => {
 const state = between(20);
 assert.equal(cappedTowers(state), TOWER_CAP);
 const v4 = floorRulesV4(state, options(state), context).candidates;
 assert.ok(places(v4).includes('SniperMonkey'));
 const {candidates, constraint} = floorRulesV6(state, options(state), context);
 assert.deepEqual([...new Set(places(candidates))], ['Quincy']);
 assert.ok(kinds(candidates).includes('upgrade') && kinds(candidates).includes('wait'));
 assert.deepEqual(constraint.rules.at(-1), {kind: 'tower_cap', removed: places(v4).length - places(candidates).length, towers: 12, cap: 12});
 // A placed hero doesn't count: 11 towers and Quincy leave placements open.
 const withHero = between(20, {towers: [...build().slice(0, 11), tower(13, 'Quincy', 'S04', [0, 0, 0], [], {is_hero: true})]});
 assert.equal(cappedTowers(withHero), 11);
 assert.ok(places(floorRulesV6(withHero, options(withHero), context).candidates).includes('SniperMonkey'));
});

test('tower cap exception: a survival rule removed "Wait" and no upgrade is affordable, so placements stay', () => {
 // Round 36: moab_short (the round-40 MOAB) removes "Wait"; with no upgrades on offer, placements come back.
 const bare = between(36, {towers: build({upgrades: false})});
 const v4 = floorRulesV4(bare, options(bare), context);
 assert.ok(v4.constraint.rules.some(r => r.kind === 'moab_short') && !kinds(v4.candidates).includes('wait'));
 const {candidates, constraint} = floorRulesV6(bare, options(bare), context);
 assert.deepEqual(candidates, v4.candidates);
 const last = constraint.rules.at(-1);
 assert.deepEqual([last.kind, last.towers, last.cap], ['tower_cap_exception', 12, 12]);
 assert.ok(last.survival.includes('moab_short'));
 // With an affordable upgrade the cap holds.
 const upgradable = between(36);
 const capped = floorRulesV6(upgradable, options(upgradable), context);
 assert.equal(capped.constraint.rules.at(-1).kind, 'tower_cap');
 assert.deepEqual([...new Set(places(capped.candidates))], ['Quincy']);
 assert.ok(!kinds(capped.candidates).includes('wait'));
});

test('majority_wait overrides are counted under Rules, not as playbook tie-breaks', () => {
 const decisions = [{kind: 'decision', decisionSource: 'jev', tie_break: [{stage: 'group', kind: 'majority_wait', p_wait: 0.45, chosen_group: 'place:MonkeyAce'}],
  group_answer: {probabilities: {wait: 0.45, 'place:MonkeyAce': 0.19}}}];
 assert.deepEqual(nearTies(decisions).tie_breaks, {considered: 0, switched: 0});
 const events = [{kind: 'run_start'}, ...decisions.map(d => ({...d, outcome: 'executed'}))];
 assert.deepEqual(scoreRun({events}).rules, {majority_wait: {fired: 1}});
});

test('--policy jev-v6 selects btd6-jev-v6', () => {
 assert.equal(runConfig(['--dry-run', '--policy', 'jev-v6']).policy, 'btd6-jev-v6');
 assert.equal(runConfig(['--dry-run', '--policy', 'jev-v6', '--speed', '5']).speed.label, 5);
});

test('majority wait: any purchase for v6, on-plan purchases for v5 revision 4 and claude-v1 revision 3, off for v4', async () => {
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 const v6 = btd6Game(() => context, {policy: JEV_POLICY_V6}).majorityWait;
 assert.equal(v6, MAJORITY_WAIT);
 assert.equal(v6.eligible, undefined, 'v6 counts every purchase');
 for (const mw of [playbookGameV5(() => context, {playbook}).majorityWait, claudeGameV1(() => context).majorityWait]) {
  assert.equal(typeof mw.eligible, 'function');
  assert.deepEqual([mw.threshold, mw.isWait, mw.isPass], [MAJORITY_WAIT.threshold, MAJORITY_WAIT.isWait, MAJORITY_WAIT.isPass]);
 }
 assert.equal(btd6Game(() => context, {policy: 'btd6-jev-v4'}).majorityWait, undefined);
 assert.equal(MAJORITY_WAIT.threshold, 0.5);
 assert.deepEqual([V5_REVISION, CLAUDE_V1_REVISION, claudeGameV1(() => context).revision], [26, 25, 25]);
 // v5 and claude-v1 keep v4's floor rules; their tower cap follows the plan filters (game.constrain, tests below).
 const state = between(20);
 assert.ok(places(playbookGameV5(() => context, {playbook}).rules(state, options(state)).candidates).includes('SniperMonkey'));
});

test('claude-v1 revision 3: with nothing due (a hold for a later target), the wait stands although most probability is on purchases', async () => {
 // A $1,000 hold for a target due from round 60: purchases over $500 are removed before Jev is asked. Revision 2
 // took the most probable remaining purchase; none advances a due target, so revision 3 keeps the wait.
 const plan = {summary: 'Save for the Ninja.', hero: {tower: 'none', round_from: 3}, threats: [], note: '',
  build: [{id: 'later', tower: 'NinjaMonkey', tiers: '4-0-2', count: 1, round_from: 60, round_by: 70, priority: 1}],
  cash_hold: [{from_round: 15, to_round: 30, amount: 1000, for: ['later']}]};
 const state = between(20, {towers: build().slice(0, 9)});
 const adopted = adoptPlanV1(plan, {reason: 'match_start', stamp: requestStampV1(state, {key: 'k'}, {lead: 4, catalog: v0Catalog, freeSpots})}, {request_id: 'r1'});
 const status = {...newStrategyStatus({enabled: true}), plan: adopted};
 const channel = {current: async () => ({id: 'r1', key: `${adopted.match_id}:match_start`, priority: 4}), take: async () => null, post: async () => { throw Error('no request expected'); }};
 const game = claudeGameV1(() => ({...context, lead: 4, freeSpots}));
 const offered = [];
 const ask = async q => {
  const ids = Object.keys(q.questions.move.criteria);
  offered.push(ids);
  // "Wait" at 0.45; the rest spread over the purchases, most on the first one offered.
  const buys = ids.filter(id => id !== 'wait');
  const probabilities = Object.fromEntries(ids.map(id => [id, id === 'wait' ? 0.45 : id === buys[0] ? 0.2 : 0.35 / Math.max(1, buys.length - 1)]));
  return {model: 'jev-test', answers: {move: {type: 'choice', choice: ids.includes('wait') ? 'wait' : ids[0], confidence: 0.45, probabilities}}, usage: {input_tokens: 1, output_tokens: 1}};
 };
 const r = await decide({state, candidates: options(state), game, strategist: {channel, status}, ask});
 assert.ok(r.constraint.rules.some(x => x.kind === 'cash_hold'), 'the hold removed purchases');
 assert.ok(offered[0].includes('wait'), 'waiting was offered');
 assert.ok(offered[0].filter(id => id !== 'wait').length >= 2, 'purchases were offered');
 assert.equal(r.tieBreaks, undefined, 'no majority_wait override');
 assert.equal(r.choice.details.kind, 'wait');
 assert.equal(r.planInForce.revision, CLAUDE_V1_REVISION);
});

// ---- Plan-aware majority wait (v5 revision 4, claude-v1 revision 3) ----
// A plan with one target, 2-1-0 Ninjas (count 2; the Ninja at S09 is one), due from roundFrom.
function ninjaPlan(state, roundFrom) {
 const plan = {summary: 'Ninja next.', hero: {tower: 'none', round_from: 3}, threats: [], note: '', cash_hold: [],
  build: [{id: 'ninja', tower: 'NinjaMonkey', tiers: '2-1-0', count: 2, round_from: roundFrom, round_by: roundFrom + 5, priority: 1}]};
 return adoptPlanV1(plan, {reason: 'match_start', stamp: requestStampV1(state, {key: 'k'}, {lead: 4, catalog: v0Catalog, freeSpots})}, {request_id: 'r1'});
}
const opt = (id, details) => ({id, label: id, details});
const WAIT = opt('wait', {kind: 'wait'});
const BOMB = opt('place:BombShooter@S04', {kind: 'place', tower: 'BombShooter', spot: 'S04', cost: 500});
const NINJA_UP = opt('upgrade:7:1', {kind: 'upgrade', tower_id: 7, path: 1, cost: 300});
const NINJA_PLACE = opt('place:NinjaMonkey@S08', {kind: 'place', tower: 'NinjaMonkey', spot: 'S08', cost: 400});
const DART = opt('place:DartMonkey@S10', {kind: 'place', tower: 'DartMonkey', spot: 'S10', cost: 200});
const planWait = planMajorityWait(() => ({...context, lead: 4}));
function override(state, plan, options, probabilities, stage, mw = planWait) {
 const eligible = mw.eligible ? mw.eligible(state, options, plan, {stage}) : null;
 return coreMajorityWait(options, {type: 'choice', choice: 'wait', probabilities}, {stage, ...mw, eligible});
}

test('plan-aware majority wait: round 48 of the v5 revision 3 loss (nothing due, wait 0.26, place:BombShooter 0.40) keeps the wait', () => {
 const state = between(48), plan = ninjaPlan(state, 51);
 const group = (id, members) => ({id, label: id, details: {kind: id === 'wait' ? 'wait' : id.split(':')[0] + '_group'}, members});
 const groups = [group('wait', [WAIT]), group('place:BombShooter', [BOMB]), group('upgrade:NinjaMonkey', [NINJA_UP]), group('place:DartMonkey', [DART])];
 const p = {wait: 0.26, 'place:BombShooter': 0.40, 'upgrade:NinjaMonkey': 0.2, 'place:DartMonkey': 0.14};
 assert.equal(override(state, plan, groups, p, 'group'), null, 'no target is due, so no purchase is on-plan');
 assert.equal(override(state, null, groups, p, 'group'), null, 'no plan: the wait stands');
 assert.equal(override(state, plan, groups, p, 'group', MAJORITY_WAIT).choice, 'place:BombShooter', 'v6 behaviour is unchanged');
 // From round 51 the Ninja group is on-plan (a group counts when a member does), but 0.2 is not a majority.
 const r51 = between(51), plan51 = ninjaPlan(r51, 51);
 assert.equal(override(r51, plan51, groups, p, 'group'), null);
 const due = {...p, 'upgrade:NinjaMonkey': 0.55, 'place:BombShooter': 0.1, 'place:DartMonkey': 0.09};
 assert.deepEqual(override(r51, plan51, groups, due, 'group'),
  {choice: 'upgrade:NinjaMonkey', record: {kind: 'majority_wait', p_wait: 0.26, p_buy: 0.55, chosen_group: 'upgrade:NinjaMonkey', p_chosen: 0.55, on_plan: true}});
});

test('plan-aware majority wait: a due target with its upgrade at 0.55 and wait 0.3 takes the upgrade', () => {
 const state = between(48), plan = ninjaPlan(state, 45);
 assert.deepEqual(override(state, plan, [WAIT, BOMB, NINJA_UP], {wait: 0.3, [BOMB.id]: 0.15, [NINJA_UP.id]: 0.55}, 'flat'),
  {choice: NINJA_UP.id, record: {kind: 'majority_wait', p_wait: 0.3, p_buy: 0.55, chosen: NINJA_UP.id, p_chosen: 0.55, on_plan: true}});
});

test('plan-aware majority wait: with an off-plan purchase the most probable, the most probable on-plan one replaces the wait only above 0.5', () => {
 const state = between(48), plan = ninjaPlan(state, 45), options = [WAIT, BOMB, NINJA_UP, NINJA_PLACE];
 // On-plan 0.27 + 0.26 = 0.53: the Ninja upgrade, although the Bomb Shooter (0.30) is more probable.
 const over = {wait: 0.17, [BOMB.id]: 0.3, [NINJA_UP.id]: 0.27, [NINJA_PLACE.id]: 0.26};
 const r = override(state, plan, options, over, 'flat');
 assert.equal(r.choice, NINJA_UP.id);
 assert.equal(r.record.p_buy, 0.53);
 // On-plan 0.3 + 0.2 = 0.5, not above half: the wait stands, although purchases total 0.8.
 assert.equal(override(state, plan, options, {wait: 0.2, [BOMB.id]: 0.3, [NINJA_UP.id]: 0.3, [NINJA_PLACE.id]: 0.2}, 'flat'), null);
 assert.equal(override(state, plan, options, over, 'flat', MAJORITY_WAIT).choice, BOMB.id, 'v6 takes the Bomb Shooter');
});

test('claude-v1 revision 3 decision: a purchase for a due target replaces the wait through core decide', async () => {
 const state = between(20, {towers: build().slice(0, 9)});
 const adopted = ninjaPlan(state, 15);
 const status = {...newStrategyStatus({enabled: true}), plan: adopted};
 const channel = {current: async () => ({id: 'r1', key: `${adopted.match_id}:match_start`, priority: 4}), take: async () => null, post: async () => { throw Error('no request expected'); }};
 const game = claudeGameV1(() => ({...context, lead: 4, freeSpots}));
 const ask = async q => {
  const ids = Object.keys(q.questions.move.criteria), buys = ids.filter(id => id !== 'wait');
  const probabilities = Object.fromEntries(ids.map(id => [id, id === 'wait' ? 0.3 : 0.7 / buys.length]));
  return {model: 'jev-test', answers: {move: {type: 'choice', choice: ids.includes('wait') ? 'wait' : ids[0], confidence: 0.3, probabilities}}, usage: {input_tokens: 1, output_tokens: 1}};
 };
 const r = await decide({state, candidates: options(state), game, strategist: {channel, status}, ask});
 assert.equal(r.tieBreaks?.at(-1)?.kind, 'majority_wait', JSON.stringify(r.tieBreaks));
 assert.equal(r.tieBreaks.at(-1).on_plan, true);
 const d = r.choice.details;
 assert.ok(d.kind === 'upgrade' ? d.tower_id === 7 : d.tower === 'NinjaMonkey', r.choice.id);
});

// ---- The tower cap in the plan policies (v5 revision 5, claude-v1 revision 4) ----
// The v5 revision 4 run lost at round 76 (2026-09-30 19:42 UTC): in rounds 56-57 leak_pressure and survival_first
// set the plan filters aside and Jev placed 19 Bomb Shooters with $6,481 in hand.
const LEAK = {kind: 'rules', rules: [{kind: 'leak_pressure', removed: 1}], removed: 1};
const capRules = r => (r.constraint?.rules ?? []).filter(x => x.kind.startsWith('tower_cap'));
async function planArms(state, plan) {
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 const facts = () => ({...context, lead: 4, freeSpots});
 return [['v5', playbookGameV5(facts, {playbook})], ['claude-v1', claudeGameV1(facts)]]
  .map(([name, game]) => [name, (candidates, all) => game.constrain(state, candidates, plan, null, {floor: LEAK, all})]);
}

test('plan tower cap: round 56 (survival_first, 12 towers, an affordable upgrade) removes the Bomb Shooter placements', async () => {
 const state = between(56, {cash: 6481});
 const plan = ninjaPlan(state, 60);
 const bomb2 = opt('place:BombShooter@S10', {kind: 'place', tower: 'BombShooter', spot: 'S10', cost: 500});
 for (const [name, constrain] of await planArms(state, plan)) {
  const r = constrain([BOMB, bomb2, NINJA_UP], [WAIT, BOMB, bomb2, NINJA_UP]);
  assert.deepEqual(r.candidates.map(c => c.id), [NINJA_UP.id], name);
  assert.equal(r.constraint.rules[0].kind, 'survival_first', name);
  assert.deepEqual(capRules(r), [{kind: 'tower_cap', removed: 2, towers: 12, cap: TOWER_CAP}], name);
 }
});

test('plan tower cap: a placement for a due target that needs a new tower stays at 12 towers', async () => {
 const state = between(56, {cash: 6481});
 const plan = ninjaPlan(state, 50); // 2-1-0 Ninjas, count 2, due: one Ninja stands, so a second placement is on-plan
 for (const [name, constrain] of await planArms(state, plan)) {
  const r = constrain([BOMB, NINJA_PLACE, NINJA_UP], [WAIT, BOMB, NINJA_PLACE, NINJA_UP]);
  assert.deepEqual(r.candidates.map(c => c.id), [NINJA_PLACE.id, NINJA_UP.id], name);
  assert.deepEqual(capRules(r), [{kind: 'tower_cap', removed: 1, towers: 12, cap: TOWER_CAP}], name);
 }
 // Without survival the plan filters already keep only on-plan purchases; the cap has nothing left to remove.
 const r = constrainV1(state, [WAIT, BOMB, NINJA_PLACE], plan, {...context, lead: 4}, {all: [WAIT, BOMB, NINJA_PLACE], towerCap: true});
 assert.ok(r.candidates.includes(NINJA_PLACE));
 assert.deepEqual(capRules(r), []);
});

test('plan tower cap: exception when survival removed waiting and no upgrade is affordable', async () => {
 const state = between(56, {cash: 600});
 const plan = ninjaPlan(state, 60);
 const dear = opt('upgrade:1:1', {kind: 'upgrade', tower_id: 1, path: 1, cost: 1100});
 for (const [name, constrain] of await planArms(state, plan)) {
  const r = constrain([BOMB, DART, dear], [WAIT, BOMB, DART, dear]);
  assert.deepEqual(r.candidates.map(c => c.id), [BOMB.id, DART.id, dear.id], name);
  assert.deepEqual(capRules(r), [{kind: 'tower_cap_exception', towers: 12, cap: TOWER_CAP, survival: ['leak_pressure']}], name);
 }
 // Below the cap nothing is recorded; without towerCap (revision 4 and 3 behaviour) nothing is removed.
 const few = between(56, {cash: 6481, towers: build().slice(0, 11)});
 assert.deepEqual(capRules(constrainV1(few, [BOMB, NINJA_UP], plan, context, {floor: LEAK, all: [WAIT, BOMB, NINJA_UP], towerCap: true})), []);
 const off = constrainV1(state, [BOMB, NINJA_UP], plan, context, {floor: LEAK, all: [WAIT, BOMB, NINJA_UP]});
 assert.deepEqual(off.candidates, [BOMB, NINJA_UP]);
});
