import {test} from 'node:test';
import assert from 'node:assert/strict';
import {towerEstimate, roundCheck} from './estimate.mjs';
import {moabBloons, moabList, moabCheck, moabDue, moabDps, towerMoab, nextMoabRound, windowSeconds, POP_BY, KILL_BY, MOAB_SPEED} from './moab.mjs';
import {meadowPaths as paths, meadowSpot} from './fixtures/index.mjs';

const at = (base_id, tiers, spot) => ({base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y});
// The best v3 run's towers when it lost round 40 (Hard Standard, 2026-09-30 05:48 UTC), at their spots.
export const round40Build = () => [
 at('MortarMonkey', [0, 3, 2], 'S01'), at('DartMonkey', [2, 3, 0], 'S02'), at('WizardMonkey', [1, 0, 0], 'S12'),
 at('BombShooter', [0, 2, 3], 'S07'), at('DartMonkey', [2, 3, 0], 'S03'), at('MortarMonkey', [0, 3, 2], 'S06'),
 at('NinjaMonkey', [0, 1, 0], 'S09'), at('SniperMonkey', [2, 2, 0], 'S05'), at('DartMonkey', [3, 2, 0], 'S11'),
];
const moab = (base_id, tiers) => towerEstimate({base_id, tiers}).moab;

test('MOAB damage per second from towers.json for known towers', () => {
 // Heavy Shells + Burny Stuff: 2 damage +1 against MOABs every 0.81 s, plus the burn's 4 every 1.25 s.
 assert.equal(moab('MortarMonkey', [0, 3, 2]), 6.9);
 // MOAB Mauler's bonus against MOABs; Really Big Bombs has none.
 assert.equal(moab('BombShooter', [0, 3, 0]), 19.4);
 assert.equal(moab('BombShooter', [3, 0, 0]), 2.7);
 // Deadly Precision against Large Calibre; Bouncing Bullet's bounces don't add against one MOAB.
 assert.equal(moab('SniperMonkey', [2, 2, 0]), 4.4);
 assert.equal(moab('SniperMonkey', [3, 2, 0]), 12.6);
 assert.equal(moab('SniperMonkey', [2, 3, 0]), 4.4);
 // Triple Shot: all three darts of the narrow spread count; the Tack Shooter's ring counts one tack.
 assert.equal(moab('DartMonkey', [2, 3, 0]), 6.3);
 assert.equal(moab('TackShooter', [0, 0, 0]), 0.9);
 assert.ok(towerEstimate({base_id: 'TackShooter', tiers: [0, 0, 0]}).pps > 7, 'pops per second still count all eight tacks');
 // Base Ice and Glue deal no MOAB damage; a farm deals none.
 assert.deepEqual([moab('IceMonkey', [0, 0, 0]), moab('GlueGunner', [0, 0, 0]), moab('BananaFarm', [0, 0, 0])], [0, 0, 0]);
});

test('MOAB-class health and speed per round', () => {
 assert.deepEqual(moabBloons(40), [{name: 'Moab', base: 'Moab', count: 1, hp: 200, speed: 1}]);
 assert.equal(moabList(62), '5 MOAB, 2 Fortified MOAB');
 assert.deepEqual(moabBloons(62).map(b => b.hp), [200, 400], 'Fortified doubles the shell');
 assert.equal(moabBloons(60)[0].hp, 1500, 'a BFB and its four MOABs');
 assert.equal(moabBloons(80)[0].hp, 10000, 'a ZOMG, its four BFBs and their MOABs');
 assert.equal(moabBloons(100)[0].hp, 41200, 'the BAD: two ZOMGs and three DDTs inside');
 assert.deepEqual(moabBloons(39), []);
 assert.deepEqual([nextMoabRound(3), nextMoabRound(41), nextMoabRound(3, 39)], [40, 50, null]);
 assert.equal(moabBloons(79).find(b => b.name === 'BfbFortified').hp, 2200, 'Fortified doubles the BFB shell only: 1,400 + 4 x 200');
 // Monkey Meadow: 1,276 units at 80 per second, the whole track in about 16 s; a BFB takes four times as long.
 assert.equal(+windowSeconds(1, paths).toFixed(1), 16);
 assert.equal(+windowSeconds(0.25, paths).toFixed(1), 63.8);
 // Damage counts over the first half of the track; the requirement runs to the exit.
 assert.deepEqual([POP_BY, KILL_BY, MOAB_SPEED], [0.5, 1, 80]);
});

test('the round-40 build: enough pops by the v3 estimate, short of MOAB damage', () => {
 const build = round40Build();
 assert.equal(roundCheck(build, 40, {lives: 32, paths, useReach: true}).enough, true, 'v3 counted round 40 as covered');
 const c = moabCheck(build, 40, {lives: 32, paths});
 assert.deepEqual(c, {round: 40, bloons: '1 MOAB', hp: 200, hp_each: 200, seconds: 16, dps: 8.4, needs_dps: 14.4, ratio: 0.58, enough: false});
 // 38.3 MOAB damage per second in towers.json, 8.4 over the first half of the track: the Sniper reaches it
 // all, the Darts and Ninja about a fifth, the Wizard and the Bomb Shooter none. The fixture towers have no
 // targeting field, so the Mortars count as aimed where the runner would aim them (aim.mjs: the densest track
 // point, here in the first half): the track within their 12-unit blast of it, 0.075 of the first half.
 assert.equal(+build.reduce((n, t) => n + towerMoab(t, paths).dps, 0).toFixed(1), 38.3);
 assert.deepEqual(build.map(t => towerMoab(t, paths).share), [0.075, 0.197, 0, 0, 0.179, 0.075, 0.19, 1, 0.119]);
 // Artillery Battery on both Mortars and Deadly Precision on the Sniper: 17.9 with the Mortars hitting one
 // point, enough for 14.4 (short of the 36 the first-half requirement asked); a Sniper 2-0-4 is enough too.
 const upgraded = build.map((t, i) => [0, 5].includes(i) ? {...t, tiers: [0, 4, 2]} : i === 7 ? {...t, tiers: [3, 2, 0]} : t);
 assert.deepEqual([moabCheck(upgraded, 40, {lives: 32, paths}).dps, moabCheck(upgraded, 40, {lives: 32, paths}).enough], [17.9, true]);
 const sniper = build.map((t, i) => i === 7 ? {...t, tiers: [2, 0, 4]} : t);
 assert.equal(moabCheck(sniper, 40, {lives: 32, paths}).enough, true);
});

test('the need grows with fewer lives, and later MOAB rounds need more', () => {
 const build = round40Build();
 assert.deepEqual([100, 10, 1].map(lives => moabCheck(build, 40, {lives, paths}).needs_dps), [14.4, 16.3, 18.8]);
 assert.deepEqual([50, 60, 80].map(r => moabCheck(build, r, {lives: 100, paths}).needs_dps), [14.4, 27, 129.7]);
 assert.equal(moabCheck(build, 41, {paths}), null);
 assert.deepEqual(moabDue(build, 35, {lives: 32, paths}), [], 'round 40 is 5 rounds away from round 35');
 assert.deepEqual(moabDue(build, 36, {lives: 32, paths}).map(c => c.round), [40]);
 assert.deepEqual(moabDue(build, 48, {lives: 32, paths, end: 80}).map(c => c.round), [50, 52]);
 assert.deepEqual(moabDue(build, 58, {lives: 32, paths, end: 80}).map(c => c.round).slice(0, 2), [62, 60], 'the weakest first');
});

test('the requirement: kill before the exit, times the margin for the lives, with no efficiency divisor', () => {
 const crossing = speed => 1276 / (80 * speed);
 // One MOAB (round 40): its health over the whole track at MOAB speed, x 1.15 with more than 10 lives.
 assert.equal(moabCheck([], 40, {lives: 100}).needs_dps, +(200 / crossing(1) * 1.15).toFixed(1));
 // One BFB (round 60): the BFB and its four MOABs over the BFB's crossing, x 1.3 with 10 lives or fewer.
 assert.equal(moabCheck([], 60, {lives: 10}).needs_dps, +(1500 / crossing(0.25) * 1.3).toFixed(1));
 // Round 75 (7 BFB, 3 Fortified MOAB): the toughest bloon decides, not the round's total. Its health is
 // 7 x 1,500 + 3 x 400 = 11,700, not doubled; the old 550 was that total over 22.6 + 8 s x 1.15 / 0.8. A
 // Fortified MOAB (400 over 16 s) needs more than a BFB (1,500 over 64 s).
 const c = moabCheck([], 75, {lives: 100});
 assert.equal(c.hp, 11700);
 assert.deepEqual([c.hp_each, c.needs_dps], [400, +(400 / crossing(1) * 1.15).toFixed(1)]);
 assert.equal(c.needs_dps, 28.8);
});

test('many MOAB-class bloons in a round need no more than the toughest one', () => {
 // v6 (2026-09-30) cleared rounds 64 (6 MOAB, 3 Fortified MOAB), 68, 73, 75 and 77 with nothing lost at 70 to
 // 77 calibrated, below the 108 to 349 a total-health term asked.
 assert.deepEqual([64, 68, 73, 75, 77].map(r => moabCheck([], r, {lives: 100}).needs_dps), [28.8, 27, 27, 28.8, 27]);
 // Round 99 (60 MOAB, 9 Fortified DDT): one Fortified DDT, 800 over 6 s.
 assert.equal(moabCheck([], 99, {lives: 100}).needs_dps, +(800 / (1276 / (80 * 2.64)) * 1.15).toFixed(1));
});
