import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidateCheck, candidateEstimate, roundExtras} from './estimate-candidate.mjs';
import {roundCheck} from './estimate.mjs';
import {towerValue, roundExtras as extrasOf} from './data/generate.mjs';

const T = name => `Il2CppAssets.Scripts.Models.${name}, Assembly-CSharp`;
const shot = {$type: T('ProjectileModel'), pierce: 1, behaviors: [{$type: T('DamageModel'), damage: 20, immuneBloonProperties: 0},
 {$type: T('EmitOnDamageModel'), projectile: {$type: T('ProjectileModel'), pierce: 2, behaviors: [{$type: T('DamageModel'), damage: 4, immuneBloonProperties: 8}]}, emission: {$type: T('ArcEmissionModel'), count: 5}}]};
const model = {range: 20, behaviors: [{$type: T('AttackModel'), weapons: [{$type: T('WeaponModel'), rate: 2, emission: {}, projectile: shot}]}]};

test('towerValue: EmitOnDamageModel projectiles count in pops per second, not in MOAB damage; purple adds the Purple field', () => {
 // (20 + 5 x 2 x 4) / 2; MOAB damage 20 / 2 (the shrapnel flies off the bloon hit)
 assert.deepEqual(towerValue(model), [30, 1, 1, 20, 10, 1]);
 assert.deepEqual(towerValue(model, {purple: true}), [30, 1, 1, 20, 10, 1, 1]);
});

test('roundExtras: camo RBE and peak by name, Purple layers', () => {
 const x = extrasOf([{bloon: 'CeramicCamo', count: 2, start: 0, end: 60}, {bloon: 'Purple', count: 3, start: 0, end: 0}, {bloon: 'Red', count: 5, start: 0, end: 0}]);
 assert.deepEqual(x, {camo_rbe: 208, camo_peak: 208, purple: 3, purple_peak: 3});
 assert.equal(roundExtras(78).camo_rbe, 7488);
});

test('candidateCheck: with no option it is roundCheck; the camo margin counts only camo towers', () => {
 const towers = [{id: 1, base_id: 'DartMonkey', tiers: [0, 0, 0], x: 0, y: 0}, {id: 2, base_id: 'NinjaMonkey', tiers: [0, 0, 0], x: 0, y: 0}];
 const base = roundCheck(towers, 24, {lives: 100, useReach: true, factor: 1}), c = candidateCheck(towers, 24, {lives: 100});
 assert.equal(+c.ratio.toFixed(2), base.ratio);
 assert.equal(c.camo, null);
 const camo = candidateCheck(towers, 24, {lives: 100, camo: true});
 assert.ok(candidateEstimate(towers[1]).camo && !candidateEstimate(towers[0]).camo);
 assert.ok(camo.camo > 0 && camo.ratio === Math.min(camo.whole, camo.camo));
});

test('towerValue corrections: one weapon under a swapping stance, ring children at RING_SHARE', async () => {
 const {RING_SHARE} = await import('./data/generate.mjs');
 const dart = name => ({$type: T('WeaponModel'), name, rate: 1, emission: {}, projectile: {$type: T('ProjectileModel'), pierce: 4, behaviors: [{$type: T('DamageModel'), damage: 1, immuneBloonProperties: 0}]}});
 const stance = swapWeapon => ({range: 48, behaviors: [{$type: T('ToggleFocusStanceModel'), swapWeapon}, {$type: T('AttackModel'), weapons: [dart('WeaponModel_MainWeapon'), dart('WeaponModel_LongWeapon')]}]});
 assert.equal(towerValue(stance(true))[0], 4, 'on by default');
 assert.equal(towerValue(stance(true), {stance: false})[0], 8);
 assert.equal(towerValue(stance(false))[0], 8, 'no swap: both weapons');
 const explosion = {$type: T('ProjectileModel'), pierce: 8, radius: 15, behaviors: [{$type: T('DamageModel'), damage: 2, immuneBloonProperties: 2}]};
 const cluster = minRange => ({$type: T('ProjectileModel'), pierce: 1, radius: 5, behaviors: [{$type: T('RandomRangeTravelStraitModel'), minRange, maxRange: 40},
  {$type: T('CreateProjectileOnExhaustFractionModel'), projectile: explosion, emission: {$type: T('SingleEmissionModel')}}]});
 const bomb = minRange => ({range: 58, behaviors: [{$type: T('AttackModel'), weapons: [{$type: T('WeaponModel'), rate: 1, emission: {}, projectile: {$type: T('ProjectileModel'), pierce: 1, behaviors: [
  {$type: T('CreateProjectileOnContactModel'), projectile: cluster(minRange), emission: {$type: T('ArcEmissionModel'), angle: 360, count: 8, useProjectileRotation: false}}]}}]}]});
 // 8 clusters x 8 pierce x 2 damage
 assert.equal(towerValue(bomb(22), {ring: false})[0], 128);
 assert.equal(towerValue(bomb(22))[0], 128 * RING_SHARE, 'on by default');
 assert.equal(towerValue(bomb(10))[0], 128, 'flying less than the explosion radius: counted in full');
});
