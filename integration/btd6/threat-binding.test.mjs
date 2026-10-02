// threat_short binding with one life (threat.mjs bindAnswers; btd6-jev-v6 revision 9, btd6-playbook-v5 revision 13,
// btd6-claude-v1 revision 12). CHIMPS series 1d lost at round 24 (log T20-01): from round 21 a $215 camo answer was
// affordable, the rule only removed waiting, and Jev bought Wizard and Dart placements.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THREAT_KINDS_V2, THREAT_KEEP, applyThreatShort, answerPool, burstPerDollar} from './threat.mjs';
import {floorRulesV6} from './policy-v6.mjs';
import {btd6Game} from './game.mjs';
import {buildCandidates} from './candidates.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths} from './fixtures/index.mjs';

const T = (id, base_id, tiers, x, y, next_upgrades = []) => ({id, base_id, tiers, x, y, next_upgrades});
const WIZARD_UPS = [{path: 0, cost: 485, id: 'Fireball'}, {path: 1, cost: 325, id: 'Guided Magic'}, {path: 2, cost: 325, id: 'Intense Magic'}];
function at(round, {cash, lives = 1, towers} = {}) {
 const one = lives <= 1, mode = one ? 'CHIMPS' : 'Standard';
 const s = v0Round6({cash, lives, starting_lives: one ? 1 : 100, max_lives: one ? 1 : 100, auto_start: true, towers, round: {index: round - 1, active: true, before_first_wave: false}});
 s.match = {...s.match, mode, mode_name: mode, end_round: one ? 100 : 80, start_round: one ? 6 : 3};
 return s;
}
const catalog = v0Catalog.filter(t => ['DartMonkey', 'WizardMonkey'].includes(t.id));
const freeSpots = [{id: 'A', x: 4, y: 70}, {id: 'B', x: 58, y: -8}];
const context = {catalog, freeSpots, paths};
const options = state => buildCandidates(state, context);
const ids = list => list.map(c => c.id);
const threatRule = r => r.constraint?.rules?.find(x => x.kind === 'threat_short');
const isPass = id => id === 'wait' || id === 'start_round';
const CHECK_KINDS = ['lead', 'camo', 'camo_lead'];

// The T20-01 defence at round 21: no tower sees camo; the Dart at 392 (1-0-1) gets camo from its x-x-2 ($215).
const camoTowers = () => [T(392, 'DartMonkey', [1, 0, 1], -26, -44, [{path: 2, cost: 215, id: 'Enhanced Eyesight'}]), T(415, 'DartMonkey', [3, 2, 0], -74, 40),
 T(438, 'DartMonkey', [1, 0, 1], -62, -2), T(5244, 'DartMonkey', [1, 1, 0], -38, -2), T(11090, 'WizardMonkey', [1, 0, 0], -32, 34, WIZARD_UPS),
 T(11893, 'WizardMonkey', [0, 1, 0], -26, -8), T(13927, 'WizardMonkey', [0, 0, 0], 58, -8)];
// The claude-v1 revision 4 Lead loss defence (threat.test.mjs): no Lead popper; the Wizards' x-1-x ($325) pops Lead.
const leadTowers = () => [T(392, 'DartMonkey', [0, 2, 2], -26, -44), T(2006, 'DartMonkey', [0, 2, 2], -74, 40), T(4451, 'DartMonkey', [0, 2, 2], -62, -2, [{path: 0, cost: 215, id: 'Razor Sharp Shots'}]),
 T(7910, 'WizardMonkey', [1, 0, 0], -38, -2, WIZARD_UPS), T(9751, 'WizardMonkey', [1, 0, 0], -32, 34, WIZARD_UPS), T(13921, 'NinjaMonkey', [0, 1, 0], -74, -2)];
const burstTowers = () => [T(392, 'DartMonkey', [0, 2, 4], -62, -2), T(415, 'BombShooter', [0, 2, 4], -38, -2), T(29767, 'WizardMonkey', [4, 2, 0], -26, -44),
 T(34072, 'SniperMonkey', [4, 2, 0], -62, 28), T(52199, 'WizardMonkey', [3, 2, 0], -74, 40, [{path: 2, cost: 325, id: 'Intense Magic'}])];

test('camo gap with one life: only the camo answers stay; a Wizard placement without camo is removed', () => {
 const state = at(22, {cash: 500, towers: camoTowers()});
 const all = options(state);
 assert.ok(all.some(c => c.id === 'place:WizardMonkey@A') && all.some(c => c.id === 'upgrade:392:p3'));
 const r = floorRulesV6(state, all, context);
 const rule = threatRule(r);
 assert.ok(rule?.missing.includes('camo'), JSON.stringify(r.constraint));
 assert.deepEqual([rule.binding, rule.binding_kind, rule.first], [true, 'check', 'upgrade:392:p3']);
 assert.ok(r.candidates.length > 0 && r.candidates.every(c => c.details.threat?.some(k => CHECK_KINDS.includes(k))), ids(r.candidates).join(' '));
 assert.ok(!ids(r.candidates).includes('place:WizardMonkey@A') && !ids(r.candidates).includes('place:DartMonkey@A'));
 assert.deepEqual(rule.kept, ids(r.candidates));
 assert.ok(rule.binding_removed > 0 && rule.removed === all.length - r.candidates.length);
 // The policy (v6) gives the same.
 assert.deepEqual(ids(btd6Game(() => context, {policy: 'btd6-jev-v6'}).rules(state, all).candidates), ids(r.candidates));
});

test('the same states with lives 2 or more are unchanged from revision 8', () => {
 for (const [state, label] of [[at(22, {cash: 500, towers: camoTowers(), lives: 2}), 'camo, 2 lives'], [at(22, {cash: 500, towers: camoTowers(), lives: 79}), 'camo, Hard Standard'],
  [at(26, {cash: 400, towers: leadTowers(), lives: 79}), 'Lead, Hard Standard']]) {
  const now = floorRulesV6(state, options(state), context), old = floorRulesV6(state, options(state), context, {threatBinding: false});
  assert.deepEqual(ids(now.candidates), ids(old.candidates), label);
  assert.deepEqual(threatRule(now), threatRule(old), label);
  assert.equal(threatRule(now).binding, undefined, label);
  assert.ok(now.candidates.some(c => !c.details?.threat?.some(k => CHECK_KINDS.includes(k)) && !isPass(c.id)), `${label}: purchases that add no Lead or camo stay`);
 }
});

test('a Lead gap binds: only the Lead answers stay, cheapest first', () => {
 const state = at(26, {cash: 400, towers: leadTowers()});
 const r = floorRulesV6(state, options(state), context);
 const rule = threatRule(r);
 assert.ok(rule.missing.includes('lead'), rule.missing.join(' '));
 assert.deepEqual([rule.binding, rule.binding_kind], [true, 'check']);
 assert.deepEqual(ids(r.candidates), ['upgrade:7910:p2', 'upgrade:9751:p2']);
});

test('burst answers keep the 0.8 band of the best gain per dollar', () => {
 assert.equal(THREAT_KEEP, 0.8);
 const state = at(75, {cash: 1000, towers: burstTowers()});
 const all = options(state);
 const free = applyThreatShort(state, all, {paths, kinds: THREAT_KINDS_V2, burstLead: 3, burstGain: true});
 const bound = applyThreatShort(state, all, {paths, kinds: THREAT_KINDS_V2, burstLead: 3, burstGain: true, binding: true});
 assert.deepEqual(bound.rule.missing, ['burst']);
 assert.deepEqual([bound.rule.binding, bound.rule.binding_kind, bound.rule.keep], [true, 'burst', THREAT_KEEP]);
 const adders = free.candidates.filter(c => c.details.threat?.length);
 const best = burstPerDollar(adders[0]);
 const band = adders.filter(c => burstPerDollar(c) >= best * THREAT_KEEP);
 assert.ok(band.length < adders.length, 'some answers fall below the band');
 assert.deepEqual(ids(bound.candidates), ids(band));
 assert.deepEqual(bound.unbound.candidates, free.candidates, 'the unbound order is kept for early_short');
});

test('nothing affordable: saving as before, binding or not', () => {
 const state = at(25, {cash: 180, towers: leadTowers()});
 const all = options(state);
 const now = floorRulesV6(state, all, context), old = floorRulesV6(state, all, context, {threatBinding: false});
 assert.deepEqual(ids(now.candidates), ['wait']);
 assert.deepEqual(threatRule(now), threatRule(old));
 assert.equal(threatRule(now).saving, 325);
 // A camo gap with $189 (round 21 of T20-01): saving for the $215 Dart x-x-2.
 const camo = at(21, {cash: 189, towers: camoTowers()});
 const r = floorRulesV6(camo, options(camo), context);
 assert.deepEqual([threatRule(r).saving, threatRule(r).for, threatRule(r).binding], [215, 'upgrade:392:p3', undefined]);
 // Burst alone never saves.
 const broke = at(75, {cash: 0, towers: burstTowers()});
 assert.equal(applyThreatShort(broke, options(broke), {paths, kinds: THREAT_KINDS_V2, binding: true, pool: answerPool(broke, context)}).rule, null);
});

test('v4 is unaffected', () => {
 for (const state of [at(22, {cash: 500, towers: camoTowers()}), at(26, {cash: 400, towers: leadTowers()})]) {
  const r = btd6Game(() => context, {policy: 'btd6-jev-v4'}).rules(state, options(state));
  assert.equal(threatRule(r), undefined);
  assert.ok(r.candidates.some(c => c.id === 'place:DartMonkey@A'));
 }
});
