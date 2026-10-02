// threat_short's lead_capacity kind (threat.mjs THREAT_KINDS_V4; btd6-jev-v6 revision 12, btd6-playbook-v5 revision 16,
// btd6-claude-v1 revision 15): the Lead margin, its answers, binding with one life (and under the tower cap), order only
// with more lives, rounds without Leads, DDT and camo Lead rounds, and the round-28 loss of CHIMPS series 1g match 1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {THREAT_KINDS_V3, THREAT_KINDS_V4, THREAT_BURST_AHEAD, THREAT_KEEP, LEAD_CAPACITY_AT, LEAD_CAPACITY_AT_R12, LEAD_CAPACITY_AT_R17, threatShort, applyThreatShort, answerPool, threatOrder, leadPerDollar} from './threat.mjs';
import {leadCheck, leadRbe, roundCheck} from './estimate.mjs';
import {setDdtCheck, setMoabCalibration} from './moab.mjs';
import {floorRulesV6, TOWER_CAP, JEV_POLICY_V6} from './policy-v6.mjs';
import {btd6Game, claudeGameV1, playbookGameV5} from './game.mjs';
import {loadPlaybook} from './playbook-v5.mjs';
import {buildCandidates} from './candidates.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths} from './fixtures/index.mjs';

// Two Darts (no Lead), a Wizard 0-0-0 (no Lead) and a Bomb Shooter 0-0-0 (pops Lead) on Monkey Meadow. Round 28's 6 Leads
// (138 RBE) against the Bomb Shooter alone: Lead margin 0.34 with one life.
const T = (id, base_id, tiers, x, y, next_upgrades = []) => ({id, base_id, tiers, x, y, next_upgrades});
const base = () => [T(1, 'DartMonkey', [2, 0, 0], -62, -2), T(2, 'DartMonkey', [2, 0, 0], -26, -44), T(3, 'WizardMonkey', [0, 0, 0], -38, -2, [{path: 1, cost: 300, id: 'Fireball'}]),
 T(4, 'BombShooter', [0, 0, 0], -74, 40, [{path: 0, cost: 250, id: 'Bigger Bombs'}, {path: 1, cost: 200, id: 'Faster Reload'}])];
function at(round, {cash = 2000, lives = 1, list = base()} = {}) {
 const s = v0Round6({cash, lives, starting_lives: lives, max_lives: lives, auto_start: true, towers: list, round: {index: round - 1, active: true, before_first_wave: false}});
 s.match = {...s.match, mode: 'Clicks', mode_name: 'CHIMPS', end_round: 100, start_round: 6};
 return s;
}
const catalog = v0Catalog.filter(t => ['DartMonkey', 'WizardMonkey', 'BombShooter', 'NinjaMonkey'].includes(t.id));
const context = {catalog, freeSpots: [{id: 'A', x: 4, y: 70}], paths};
const options = state => buildCandidates(state, context);
const ids = list => list.map(c => c.id);
const threatRule = r => r.constraint?.rules?.find(x => x.kind === 'threat_short');
const run = (state, extra = {}) => { const all = options(state); return applyThreatShort(state, all, {paths, kinds: THREAT_KINDS_V4, ...THREAT_BURST_AHEAD, all, pool: () => answerPool(state, context), binding: true, ...extra}); };
const leadAnswers = list => list.filter(c => c.details.threat?.includes('lead_capacity'));

test('Lead RBE: every non-MOAB Lead variant, full RBE with children; DDTs only with ddt (revisions 12 to 14)', () => {
 assert.equal(leadRbe(28), 138, '6 Leads at 23');
 assert.equal(leadRbe(45), 4 * 26, 'Fortified Leads: 4 health plus two Blacks');
 assert.equal(leadRbe(59), 50 * 23, 'camo Leads');
 assert.equal(leadRbe(93), 0, 'DDTs only: no Lead RBE');
 assert.equal(leadRbe(93, {ddt: true}), 6 * 816, 'revision 14: DDTs, 400 plus four Ceramics');
 assert.equal(leadRbe(90), 50 * 26, 'mixed: only the 50 Leads');
 assert.equal(leadRbe(90, {ddt: true}), 50 * 26 + 3 * 816);
 for (const r of [28, 45, 59]) assert.equal(leadRbe(r, {ddt: true}), leadRbe(r), `round ${r}: no DDTs, the same either way`);
 assert.equal(leadRbe(27), 0);
 assert.equal(leadCheck([], 27), null, 'no Lead bloons: no margin');
});

test('margin: Lead-capable towers with reach against the Lead RBE times the lives margin; due below the threshold within 3 rounds; not in V3 kinds', () => {
 // 1.0 in revisions 12 to 16 and from revision 18; 0.5 in revision 17 (moab-ddt.test.mjs).
 assert.deepEqual([LEAD_CAPACITY_AT, LEAD_CAPACITY_AT_R12, LEAD_CAPACITY_AT_R17], [1.0, 1.0, 0.5]);
 assert.deepEqual(THREAT_KINDS_V4, ['lead', 'camo', 'camo_lead', 'camo_capacity', 'lead_capacity', 'burst']);
 const s = at(25), m = leadCheck(s.towers, 28, {lives: 1, paths});
 assert.deepEqual([m.rbe, m.needs, m.ratio], [138, 207, 0.34]);
 // Without the Bomb Shooter the Lead-capable capacity is 0; the Darts and Wizard don't count.
 assert.equal(leadCheck(base().slice(0, 3), 28, {lives: 1, paths}).can_pop, 0);
 const short = threatShort(s, paths, {kinds: THREAT_KINDS_V4});
 assert.deepEqual([short.rounds.lead_capacity, short.ratios.lead_capacity, short.can_pop.lead_capacity, short.needs.lead_capacity], [28, 0.34, m.can_pop, 207]);
 // The yes-or-no Lead check passes (one Lead popper), so V3 kinds see nothing missing for Lead.
 assert.equal(roundCheck(s.towers, 28, {lives: 1, paths, useReach: true}).lead, true);
 assert.ok(!('lead_capacity' in (threatShort(s, paths, {kinds: THREAT_KINDS_V3})?.rounds ?? {})));
 // Round 24: round 28 is 4 rounds ahead, outside the lead.
 assert.ok(!('lead_capacity' in (threatShort(at(24), paths, {kinds: THREAT_KINDS_V4})?.rounds ?? {})));
 // More lives, a smaller margin factor (1.15): a higher ratio.
 assert.ok(leadCheck(s.towers, 28, {lives: 100, paths}).ratio > m.ratio);
 // Enough Lead pops (six Bomb Shooters 0-2-0): not due.
 const strong = [1, 2, 3, 4, 5, 6].map(i => T(20 + i, 'BombShooter', [0, 2, 0], -74 + 8 * i, 40));
 assert.ok(leadCheck(strong, 28, {lives: 1, paths}).ratio >= 1);
 assert.ok(!('lead_capacity' in (threatShort(at(25, {list: [...base(), ...strong]}), paths, {kinds: THREAT_KINDS_V4})?.rounds ?? {})));
});

test('round 28 is the same with or without DDTs (revision 14 against 15)', () => {
 const s = at(25), opts = {paths, kinds: THREAT_KINDS_V4, ...THREAT_BURST_AHEAD};
 assert.deepEqual(leadCheck(s.towers, 28, {lives: 1, paths, ddt: true}), leadCheck(s.towers, 28, {lives: 1, paths}));
 assert.deepEqual(threatShort(s, paths, {...opts, leadDdt: true}), threatShort(s, paths, opts));
 const a = run(s), b = run(s, {leadDdt: true});
 assert.deepEqual([ids(a.candidates), a.rule], [ids(b.candidates), b.rule]);
});

test('no flag for rounds without Leads', () => {
 for (const r of [20, 51]) assert.ok(!('lead_capacity' in (threatShort(at(r), paths, {kinds: THREAT_KINDS_V4})?.rounds ?? {})), `round ${r}`);
 assert.equal(threatShort(at(20, {list: base().slice(0, 3)}), paths, {kinds: ['lead_capacity']}), null);
});

test('DDT and camo Lead rounds: DDTs are left to the MOAB check (revision 15); camo Leads count; the camo Lead check still comes first', () => {
 // Round 91: the next Lead-bloon round is 93, DDTs only. No Lead RBE, no lead_capacity flag.
 assert.equal(leadCheck(base(), 93, {lives: 1, paths}), null);
 assert.ok(!('lead_capacity' in (threatShort(at(91), paths, {kinds: THREAT_KINDS_V4})?.rounds ?? {})), 'DDTs only: no flag');
 assert.equal(applyThreatShort(at(91), options(at(91)), {paths, kinds: ['lead_capacity'], binding: true}).rule, null);
 // Revision 14 (leadDdt) still counts the DDTs: due at 93 with their full RBE.
 const ddt = threatShort(at(91), paths, {kinds: THREAT_KINDS_V4, leadDdt: true});
 const m93 = leadCheck(base(), 93, {lives: 1, paths, ddt: true});
 assert.deepEqual([ddt.rounds.lead_capacity, ddt.ratios.lead_capacity, ddt.needs.lead_capacity], [93, m93.ratio, Math.ceil(6 * 816 * 1.5)]);
 assert.ok(run(at(91), {leadDdt: true}).rule.lead_capacity, 'revision 14: the rule fires on the DDT round');
 // Round 88: round 90 has 50 camo regrow fortified Leads and 3 camo DDTs; only the Leads' 1,300 RBE counts.
 const mixed = threatShort(at(88), paths, {kinds: THREAT_KINDS_V4}), old = threatShort(at(88), paths, {kinds: THREAT_KINDS_V4, leadDdt: true});
 assert.deepEqual([mixed.rounds.lead_capacity, mixed.needs.lead_capacity], [90, leadCheck(base(), 90, {lives: 1, paths}).needs]);
 assert.equal(leadCheck(base(), 90, {lives: 1, paths}).rbe, 1300);
 assert.equal(old.needs.lead_capacity, leadCheck(base(), 90, {lives: 1, paths, ddt: true}).needs);
 assert.ok(mixed.ratios.lead_capacity > old.ratios.lead_capacity, 'a smaller RBE: a higher margin');
 // Round 57: round 59's 50 camo Leads. No tower sees camo and pops Lead, so camo_lead is missing too, and its answers lead.
 const s = at(57);
 const short = threatShort(s, paths, {kinds: THREAT_KINDS_V4});
 assert.equal(short.rounds.lead_capacity, 59);
 assert.equal(short.needs.lead_capacity, Math.ceil(1150 * 1.5));
 assert.ok(short.missing.includes('camo_lead'));
 const {candidates, rule} = run(s);
 assert.equal(rule.binding_kind, 'check');
 assert.ok(candidates.every(c => c.details.threat.some(k => ['lead', 'camo', 'camo_lead'].includes(k))), 'check answers only');
});

test('answers: purchases that raise the Lead margin, highest Lead gain per dollar first; the record names the round, margin and threshold', () => {
 const s = at(25, {lives: 100});
 const {candidates, rule, unbound} = run(s);
 assert.equal(unbound, undefined, 'more than one life: no binding');
 assert.ok(!ids(candidates).includes('wait'), 'wait removed');
 const answers = leadAnswers(candidates);
 assert.ok(answers.length >= 2, ids(answers).join());
 assert.deepEqual(ids(candidates.slice(0, answers.length)), ids(answers), 'answers first');
 const perDollar = answers.map(leadPerDollar);
 assert.deepEqual(perDollar, [...perDollar].sort((a, b) => b - a));
 assert.ok(answers.every(c => c.details.lead_gain > 0));
 assert.deepEqual(rule.lead_capacity, {round: 28, lead_margin: leadCheck(s.towers, 28, {lives: 100, paths}).ratio, at: LEAD_CAPACITY_AT});
 assert.deepEqual([rule.first, rule.first_lead_gain, rule.first_cost], [answers[0].id, answers[0].details.lead_gain, answers[0].details.cost]);
 assert.ok(!('binding' in rule));
 // Order only: every other option stays.
 assert.equal(candidates.length, options(s).filter(c => c.details.kind !== 'wait').length);
});

// At $150 no Lead answer is affordable; the cheapest in the pool is the Bomb Shooter's 0-1-0 ($200).
const LEAD_KINDS = ['lead', 'camo', 'camo_lead', 'lead_capacity'];
test('saving with one life: only the pass options while the cheapest Lead-capacity answer is out of reach', () => {
 const s = at(25, {cash: 150});
 const {candidates, rule} = run(s, {kinds: LEAD_KINDS});
 assert.deepEqual(ids(candidates), ['wait']);
 assert.deepEqual([rule.kind, rule.missing, rule.adders, rule.saving, rule.for, rule.cash], ['threat_short', ['lead_capacity'], 0, 200, 'upgrade:4:p2', 150]);
 assert.deepEqual(rule.lead_capacity, {round: 28, lead_margin: 0.34, at: LEAD_CAPACITY_AT});
 // The policy: v6's floor saves the same way; revision 11 (V3 kinds) doesn't.
 const floor = floorRulesV6(s, options(s), context);
 assert.deepEqual(ids(floor.candidates), ['wait']);
 assert.equal(threatRule(floor).for, 'upgrade:4:p2');
 assert.equal(threatRule(floorRulesV6(s, options(s), context, {threatKinds: THREAT_KINDS_V3})), undefined);
});

test('no saving with more lives, nor for camo capacity or burst with one life', () => {
 const s = at(25, {cash: 150, lives: 100});
 const {candidates, rule} = run(s, {kinds: LEAD_KINDS});
 assert.equal(rule, null);
 assert.deepEqual(ids(candidates), ids(options(s)));
 // One life, V3 kinds (camo capacity and burst, both rate kinds): burst is due but doesn't save.
 const one = at(25, {cash: 150});
 assert.ok(threatShort(one, paths, {kinds: THREAT_KINDS_V3}).missing.includes('burst'));
 assert.equal(run(one, {kinds: THREAT_KINDS_V3}).rule, null);
 // With more lives, moab_short's MOAB-damage order still sets a Lead-capacity gap aside.
 assert.equal(run(at(25, {lives: 100}), {kinds: LEAD_KINDS, moabFirst: true}).rule, null);
});

test('hand-off: once a Lead-capacity answer is affordable the saving stops and the binding keeps it', () => {
 const s = at(25, {cash: 210});
 const {candidates, rule} = run(s, {kinds: LEAD_KINDS});
 assert.equal(rule.saving, undefined);
 assert.deepEqual([rule.binding, rule.binding_kind, rule.first], [true, 'lead_capacity', 'upgrade:4:p2']);
 assert.deepEqual(ids(candidates), ['upgrade:4:p2']);
});

test('survival rules override the saving as they do the check kinds\' saving', () => {
 // A missing Lead check (no Lead popper) and a Lead-capacity gap each save at $150 ...
 const noLead = at(25, {cash: 150, list: base().slice(0, 3)});
 assert.equal(run(noLead, {kinds: LEAD_KINDS}).rule.saving != null, true);
 const s = at(25, {cash: 150});
 assert.equal(run(s, {kinds: LEAD_KINDS}).rule.saving, 200);
 // ... and under leak pressure neither saves.
 for (const state of [noLead, s]) {
  assert.equal(run(state, {kinds: LEAD_KINDS, pressure: {active: true}}).rule, null);
  assert.equal(threatRule(floorRulesV6(state, options(state), {...context, pressure: {active: true}})), undefined);
 }
 // moab_short's MOAB-damage order doesn't set the Lead check's saving aside (the next test covers Lead capacity).
 assert.equal(run(noLead, {kinds: LEAD_KINDS, moabFirst: true}).rule.saving != null, true);
});

// moabFirst is how floorRulesV4 passes moab_short firing (an affordable MOAB-damage answer) to threat_short.
test('one life with moab_short firing: a Lead-capacity gap is set aside as camo capacity is, with or without an affordable answer', () => {
 const kinds = ['lead', 'camo', 'camo_lead', 'camo_capacity', 'lead_capacity'];
 const affordable = at(25), none = at(25, {cash: 150});
 // Without moab_short: the binding at $2,000, the saving at $150.
 assert.equal(run(affordable, {kinds}).rule.binding_kind, 'lead_capacity');
 assert.equal(run(none, {kinds}).rule.saving, 200);
 // With it: no rule, the options as they are, for Lead capacity as for camo capacity.
 for (const s of [affordable, none]) {
  const {candidates, rule} = run(s, {kinds, moabFirst: true});
  assert.equal(rule, null);
  assert.deepEqual(ids(candidates), ids(options(s)));
 }
 // With a check kind also missing, the rule acts for the check kind only: no answers and no saving for Lead capacity.
 const noLead = at(25, {cash: 150, list: base().slice(0, 3)});
 const r = run(noLead, {kinds, moabFirst: true}).rule;
 assert.ok(r.missing.includes('lead') && r.missing.includes('lead_capacity'));
 assert.equal(r.saving != null, true);
});

test('order of kinds: check kinds, then camo capacity, then Lead capacity, then burst', () => {
 const c = (id, threat, cost, extra = {}) => ({id, details: {kind: 'place', cost, threat, ...extra}});
 const list = [c('burst', ['burst'], 100, {burst_gain: 0.9}), c('lead', ['lead_capacity'], 50, {lead_gain: 0.9}), c('camo', ['camo_capacity'], 900, {camo_gain: 0.1}),
  c('lead2', ['lead_capacity'], 100, {lead_gain: 0.9}), c('check', ['lead'], 2000)];
 assert.deepEqual(ids([...list].sort(threatOrder)), ['check', 'camo', 'lead', 'lead2', 'burst']);
});

test('one life: binds to the Lead answers within THREAT_KEEP of the best Lead gain per dollar', () => {
 const s = at(25);
 const {candidates, rule, unbound} = run(s);
 assert.deepEqual([rule.binding, rule.binding_kind, rule.keep], [true, 'lead_capacity', THREAT_KEEP]);
 const answers = leadAnswers(unbound.candidates), best = leadPerDollar(answers[0]);
 assert.deepEqual(ids(candidates), ids(answers.filter(a => leadPerDollar(a) >= best * THREAT_KEEP)));
 assert.ok(candidates.length < answers.length, 'a weaker Lead answer is cut');
 assert.deepEqual(rule.kept, ids(candidates));
 assert.equal(JSON.stringify(rule).includes('"answers"'), false, 'the answers are not logged');
 // The policies run it: v6 binds; claude-v1 and v5 record it.
 assert.deepEqual(ids(floorRulesV6(s, options(s), context).candidates), ids(candidates));
 assert.equal(threatRule(floorRulesV6(s, options(s), context, {threatKinds: THREAT_KINDS_V3}))?.lead_capacity, undefined, 'revision 11');
});

test('one life under the tower cap: the binding chooses among the upgrade answers the cap allows', async () => {
 // 13 towers. The one Lead upgrade on offer (the Bomb Shooter's 0-1-0 at $600) is under THREAT_KEEP of the Bomb Shooter
 // placement's Lead gain per dollar, so the binding keeps the placement alone, which the cap removes.
 const filler = Array.from({length: 9}, (_, i) => T(100 + i, 'WizardMonkey', [0, 0, 0], 100, -100 + 10 * i));
 const list = [...base().slice(0, 2), T(3, 'WizardMonkey', [0, 0, 0], -38, -2), T(4, 'BombShooter', [0, 0, 0], -74, 40, [{path: 1, cost: 600, id: 'Faster Reload'}])];
 const s = at(25, {list: [...list, ...filler]});
 assert.ok(s.towers.length >= TOWER_CAP);
 const r = floorRulesV6(s, options(s), context);
 const threat = threatRule(r), cap = r.constraint.rules.at(-1);
 assert.deepEqual(threat.kept, ['place:BombShooter@A']);
 assert.equal(threat.binding_kind, 'lead_capacity');
 assert.equal(cap.kind, 'tower_cap');
 assert.equal(cap.cap_binding.kind, 'lead_capacity');
 assert.ok(r.candidates.length > 0 && r.candidates.every(c => c.details.kind === 'upgrade' && c.details.threat?.includes('lead_capacity')), ids(r.candidates).join());
 assert.deepEqual(cap.cap_binding.kept, ids(r.candidates));
 // Revision 10's cap (bindUnderCap false) removes the binding's placement and leaves "Wait".
 assert.deepEqual(ids(floorRulesV6(s, options(s), context, {bindUnderCap: false}).candidates), ['wait']);
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 for (const [name, game] of [['v6', btd6Game(() => context, {policy: JEV_POLICY_V6})], ['claude-v1', claudeGameV1(() => context)], ['v5', playbookGameV5(() => context, {playbook})]])
  assert.equal(threatRule(game.rules(at(25), options(at(25))))?.lead_capacity?.round, 28, name);
});

// CHIMPS series 1g match 1 (v6 revision 11), every decision of rounds 25 to 27, with the saving pool the logs show.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/lead-capacity-r28.json', import.meta.url), 'utf8'));
const floorOf = (d, extra = {}) => floorRulesV6(d.state, d.candidates, {paths: [], pool: d.pool, ...(d.pressure ? {pressure: {active: true}} : {})}, extra);
test('round 28 of CHIMPS series 1g match 1: revision 12 flags lead_capacity and saves for the Wizard\'s 0-1-0; revision 11 is unchanged', () => {
 const {decisions} = fixture;
 assert.equal(decisions.length, 17);
 const upgraded = decisions.findIndex(d => d.chosen === 'upgrade:14885:p2');
 assert.equal(upgraded, 3);
 const margins = decisions.map(({state}) => threatShort(state, [], {kinds: THREAT_KINDS_V4, ...THREAT_BURST_AHEAD})?.ratios?.lead_capacity);
 // Before the Wizard's 1-1-0 no tower pops Lead (margin 0); after it 80 of the 207 needed (0.39), unchanged to round 27.
 assert.deepEqual(margins, decisions.map((d, i) => i <= upgraded ? 0 : 0.39));
 const kinds = r => (r.constraint?.rules ?? []).map(q => q.kind);
 for (const d of decisions) {
  assert.equal(threatShort(d.state, [], {kinds: THREAT_KINDS_V4, ...THREAT_BURST_AHEAD}).rounds.lead_capacity, 28);
  assert.ok(!('lead_capacity' in (threatShort(d.state, [], {kinds: THREAT_KINDS_V3, ...THREAT_BURST_AHEAD})?.rounds ?? {})));
  // Revision 11 reproduces the logged rules.
  assert.deepEqual(kinds(floorOf(d, {threatKinds: THREAT_KINDS_V3})), d.logged_rules, `round ${d.round} $${Math.floor(d.state.cash)}`);
 }
 // Through round 25's upgrade the Lead check decides, as in revision 11 (saving for a Wizard's 0-1-0, then buying the Wizard's 1-1-0).
 for (const d of decisions.slice(0, upgraded + 1)) assert.deepEqual(ids(floorOf(d).candidates), ids(floorOf(d, {threatKinds: THREAT_KINDS_V3}).candidates));
 assert.deepEqual(threatRule(floorOf(decisions[upgraded])).lead_capacity, {round: 28, lead_margin: 0, at: LEAD_CAPACITY_AT});
 // After it no logged option raises the Lead margin, and revision 12 saves for the cheapest answer, the other Wizards' 0-1-0 ($325).
 const blocked = [];
 for (const d of decisions.slice(upgraded + 1)) {
  const r = floorOf(d), rule = threatRule(r);
  assert.deepEqual([ids(r.candidates), rule.saving, rule.for, rule.missing], [['wait'], 325, 'upgrade:14100:p2', ['lead_capacity']], `round ${d.round} $${Math.floor(d.state.cash)}`);
  if (d.chosen !== 'wait') blocked.push(`${d.chosen} $${d.chosen_cost}`);
 }
 assert.deepEqual(blocked, ['place:GlueGunner@S06 $245', 'place:WizardMonkey@S09 $270', 'place:Skywarden@S18 $220', 'upgrade:24715:p3 $160']);
});

// Revision 15: CHIMPS series 1h match 2 (v6 revision 14) saved for a $405 Bomb Shooter at 71 decisions in rounds 92 to 95
// because round 95's Lead RBE counted its 30 camo DDTs (fixtures/lead-capacity-r95.json, compact form).
const r95 = JSON.parse(readFileSync(new URL('./fixtures/lead-capacity-r95.json', import.meta.url), 'utf8'));
const r95Towers = new Map(r95.towers.map(t => [t.id, t]));
const r95State = d => ({in_game: true, match: r95.match, round: {index: d.round - 1, number: d.round, active: true, before_first_wave: false}, cash: d.cash, lives: d.lives, starting_lives: 1, max_lives: 1,
 towers: r95.tower_sets[d.towers].split(' ').map(s => { const [id, tiers] = s.split(':'); return {...r95Towers.get(Number(id)), tiers: tiers.split('-').map(Number)}; })});
test('round 95 of CHIMPS series 1h match 2: revision 14 reproduces the logged Lead margins and saving; revision 15 neither flags nor saves', () => {
 setDdtCheck(true); setMoabCalibration(1.27);
 try {
  const {decisions} = r95;
  assert.equal(decisions.length, 129);
  const first95 = r95State(decisions.find(d => d.round === 95)), first90 = r95State(decisions.find(d => d.round === 90));
  // Round 95: Lead RBE 30,980 with the DDTs (24,480 of it), 6,500 without; the same towers give 0.85 and 4.04.
  assert.deepEqual([leadRbe(95, {ddt: true}), leadRbe(95)], [30980, 6500]);
  assert.deepEqual([leadCheck(first95.towers, 95, {lives: 1, paths, ddt: true}).ratio, leadCheck(first95.towers, 95, {lives: 1, paths}).ratio], [0.85, 4.04]);
  // Round 90: 3,748 with its 3 DDTs, 1,300 without; 2.35 and 6.77, so neither revision flags it.
  assert.deepEqual([leadRbe(90, {ddt: true}), leadRbe(90)], [3748, 1300]);
  assert.deepEqual([leadCheck(first90.towers, 90, {lives: 1, paths, ddt: true}).ratio, leadCheck(first90.towers, 90, {lives: 1, paths}).ratio], [2.35, 6.77]);
  const count = {r14: {due: 0, saving: 0}, r15: {due: 0, saving: 0}};
  for (const d of decisions) {
   const state = r95State(d), candidates = d.candidates.map(i => r95.options[i]), pool = d.pool.map(i => r95.options[i]);
   for (const [key, leadDdt] of [['r14', true], ['r15', false]]) {
    if ('lead_capacity' in (threatShort(state, paths, {kinds: THREAT_KINDS_V4, ...THREAT_BURST_AHEAD, leadDdt, leadAt: LEAD_CAPACITY_AT_R12})?.rounds ?? {})) count[key].due++;
    const rule = threatRule(floorRulesV6(state, candidates, {paths, pool, ...(d.pressure ? {pressure: {active: true}} : {})}, {threatOptions: {...THREAT_BURST_AHEAD, leadDdt, leadAt: LEAD_CAPACITY_AT_R12}}));
    if (rule?.saving != null) count[key].saving++;
    if (key === 'r14') {
     assert.equal(rule?.lead_capacity?.lead_margin ?? null, d.logged?.lead_margin ?? null, `round ${d.round} $${d.cash}: logged Lead margin`);
     assert.equal(rule?.saving ?? null, d.logged?.saving ?? null, `round ${d.round} $${d.cash}: logged saving`);
     if (rule?.saving != null) assert.match(rule.for, /^place:BombShooter@/);
    } else assert.ok(!('lead_capacity' in (rule?.rounds ?? {})), `round ${d.round}: revision 15 no lead_capacity`);
   }
  }
  // Revision 14: due at every decision of rounds 92 to 95 (125), saving at 71. Revision 15: neither.
  assert.deepEqual(count, {r14: {due: 125, saving: 71}, r15: {due: 0, saving: 0}});
 } finally { setDdtCheck(false); setMoabCalibration(1); }
});
