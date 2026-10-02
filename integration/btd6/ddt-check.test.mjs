import {test} from 'node:test';
import assert from 'node:assert/strict';
import {towerEstimate} from './estimate.mjs';
import {moabCheck, moabDps, hitsDdt, setDdtCheck, ddtCheckFor, blendedDps, windowSeconds, innerDdtHealth, MOAB_SPEED, DEFAULT_TRACK_LENGTH} from './moab.mjs';
import {moabOutrun} from './speed.mjs';
import {withMoab} from './policy-v4.mjs';

// No paths: every tower here reaches the whole first half (share 1), and the calibration factor is 1.
const T = (base_id, tiers, id = 0) => ({id, base_id, tiers, level: 1, x: 0, y: 0});
const nonCamo = T('SuperMonkey', [2, 0, 0], 1);   // pops Lead and Black, no camo
const camoOnly = T('DartMonkey', [0, 1, 4], 2);   // camo, no Lead
const camoLead = T('MonkeyAce', [1, 4, 0], 3);    // camo and Lead; its bombs are immune to Black
const druid = T('Druid', [4, 0, 0], 4);           // camo, Lead and Black
const sniper = T('SniperMonkey', [1, 1, 0], 5);   // camo, Lead and Black
const mixed = [nonCamo, camoOnly, camoLead, druid, sniper];
const withDdt = fn => { setDdtCheck(true); try { return fn(); } finally { setDdtCheck(false); } };

test('towers-ddt.json: only an attack that sees camo and pops Lead and Black hits a DDT', () => {
 const e = t => towerEstimate(t);
 assert.ok(e(nonCamo).lead && !e(nonCamo).camo && !hitsDdt(nonCamo));
 assert.ok(e(camoOnly).camo && !e(camoOnly).lead && !hitsDdt(camoOnly));
 assert.ok(e(camoLead).camoLead && !hitsDdt(camoLead));
 assert.ok(e(druid).camoLead && hitsDdt(druid) && hitsDdt(sniper));
 assert.equal(hitsDdt({base_id: 'Sheriff', tiers: [0, 0, 0]}), false, 'no row: not counted');
 assert.ok(mixed.every(t => e(t).moab > 0));
});

test('a DDT round counts only the camo, Lead and Black towers', () => {
 const all = moabDps(mixed), ddt = moabDps(mixed, [], {ddt: true});
 assert.equal(ddt, moabDps([druid, sniper]));
 assert.ok(all > 10 * ddt);
 const old = moabCheck(mixed, 90);
 const now = withDdt(() => moabCheck(mixed, 90));
 assert.equal(old.dps, all);
 assert.equal(now.dps, ddt);
 assert.equal(now.ddt_dps, ddt);
 assert.equal(now.all_dps, all);
 assert.equal(now.needs_dps, old.needs_dps, 'the need is unchanged');
 assert.equal(now.ratio, +(ddt / now.needs_dps).toFixed(2));
 assert.equal(old.enough, true);
 assert.equal(now.enough, false);
 assert.equal(moabCheck(mixed, 90, {ddt: true}).dps, ddt, 'the option overrides the session setting');
 assert.equal(withDdt(() => moabCheck([nonCamo, camoOnly, camoLead], 90)).ratio, 0, 'no DDT-capable tower');
});

test('a BAD round: the shell and ZOMGs at every tower, its three DDTs at the DDT-capable figure', () => {
 const all = moabDps(mixed), ddt = moabDps(mixed, [], {ddt: true});
 assert.equal(innerDdtHealth('Bad'), 1200);
 const c = withDdt(() => moabCheck(mixed, 100));
 assert.equal(c.hp_each, 41200);
 assert.equal(c.dps, +(41200 / (40000 / all + 1200 / ddt)).toFixed(1));
 assert.ok(c.dps < all && c.dps > ddt);
 assert.equal(moabCheck(mixed, 100).dps, all, 'off: every tower');
 assert.equal(blendedDps(100, 0, 10, 0), 10);
 assert.equal(blendedDps(100, 50, 10, 0), 0);
});

test('an ordinary MOAB round is unchanged', () => {
 for (const r of [40, 63, 80, 88]) assert.deepEqual(withDdt(() => moabCheck(mixed, r)), moabCheck(mixed, r), `round ${r}`);
 assert.equal(ddtCheckFor('btd6-jev-v6'), true);
 assert.equal(ddtCheckFor('btd6-jev-v6', 12), false);
 assert.equal(ddtCheckFor('btd6-playbook-v5', 17), true);
 assert.equal(ddtCheckFor('btd6-claude-v1', 15), false);
 assert.equal(ddtCheckFor('btd6-jev-v4'), false);
});

test('a mixed round (round 93: Fortified BFBs and camo DDTs): the toughest need for its own figure decides', () => {
 const old = moabCheck(mixed, 93), now = withDdt(() => moabCheck(mixed, 93));
 assert.equal(now.bloons, '10 Fortified BFB, 6 DDT');
 assert.equal(now.hp_each, 400, 'the DDT decides');
 assert.equal(now.dps, moabDps(mixed, [], {ddt: true}));
 assert.equal(now.needs_dps, old.needs_dps);
 // With every tower able to hit a DDT the check is the old one.
 assert.deepEqual(withDdt(() => moabCheck([druid, sniper], 93)), {...moabCheck([druid, sniper], 93), ddt_dps: moabDps([druid, sniper]), all_dps: moabDps([druid, sniper])});
 // The BFB's need per damage is what the DDT's is compared with.
 const bfb = 2200 / windowSeconds(0.25), ddtNeed = 400 / windowSeconds(2.64);
 assert.ok(ddtNeed / now.dps > bfb / now.all_dps);
});

test('moab_outrun counts a DDT on the track at the DDT-capable figure', () => {
 const state = {in_game: true, round: {number: 90}, lives: 1, towers: mixed,
  bloons: {count: 1, moab_class: 1, furthest: 0.1, moabs: [{type: 'DdtCamo', progress: 0.1, health: 300, max_health: 400}]}};
 assert.equal(moabOutrun(state), null, 'off: every tower kills it in time');
 const hit = withDdt(() => moabOutrun(state));
 assert.equal(hit.type, 'DdtCamo');
 assert.equal(hit.ddt_dps, moabDps(mixed, [], {ddt: true}));
 assert.equal(hit.kill_s, +(300 / hit.ddt_dps).toFixed(1));
 assert.equal(hit.exit_s, +(0.9 * DEFAULT_TRACK_LENGTH / (MOAB_SPEED * 2.64)).toFixed(1));
 const moab = {...state, bloons: {...state.bloons, moabs: [{type: 'Moab', progress: 0.1, health: 200, max_health: 200}]}};
 assert.deepEqual(withDdt(() => moabOutrun(moab)), moabOutrun(moab), 'a MOAB: unchanged');
});

test('the MOAB gains for a DDT round count only DDT-capable damage', () => {
 const state = {in_game: true, round: {number: 89}, lives: 1, match: {end_round: 100}, towers: [nonCamo, druid]};
 const up = (t, tiers_after, cost) => ({id: `u${t.id}`, details: {kind: 'upgrade', tower_id: t.id, tiers_after, cost}});
 const options = [up(nonCamo, '3-0-0', 1000), up(druid, '5-0-0', 1000)];
 const gain = list => Object.fromEntries(list.map(c => [c.id, c.details.moab]));
 const old = gain(withMoab(state, options)), now = gain(withDdt(() => withMoab(state, options)));
 assert.ok(old.u1 > 0, 'off: the Super Monkey adds MOAB damage');
 assert.equal(now.u1, 0, 'on: it adds none against round 90 DDTs');
 assert.equal(now.u4, old.u4);
 // Away from a DDT round the gains are the old ones.
 const early = {...state, round: {number: 60}};
 assert.deepEqual(gain(withDdt(() => withMoab(early, options))), gain(withMoab(early, options)));
});
