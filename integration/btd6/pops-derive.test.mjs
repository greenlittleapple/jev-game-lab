import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveTower} from './pops-derive.mjs';

const T = name => `Il2CppAssets.Scripts.Models.${name}, Assembly-CSharp`;
const damage = (d, immune = 0) => ({$type: T('DamageModel'), damage: d, immuneBloonProperties: immune});

test('deriveTower: counted projectiles match towers.json, with what the derivation leaves out listed', () => {
 const child = {$type: T('ProjectileModel'), name: 'Explosion', pierce: 22, behaviors: [damage(2, 2)]};
 const shrapnel = {$type: T('ProjectileModel'), name: 'Shrapnel', pierce: 2, behaviors: [damage(4)]};
 const model = {range: 50, behaviors: [
  {$type: T('AttackModel'), name: 'Attack', range: 50, weapons: [{$type: T('WeaponModel'), name: 'Weapon', rate: 0.5, emission: {$type: T('SingleEmissionModel')}, behaviors: [],
   projectile: {$type: T('ProjectileModel'), name: 'Shot', pierce: 1, behaviors: [damage(20),
    {$type: T('CreateProjectileOnContactModel'), projectile: child, emission: {$type: T('SingleEmissionModel')}},
    {$type: T('EmitOnDamageModel'), projectile: shrapnel, emission: {$type: T('ArcEmissionModel'), count: 5}},
    {$type: T('DamageModifierForTagModel'), tag: 'Ceramic', damageMultiplier: 1, damageAddative: 50}]}}]},
  {$type: T('AbilityModel'), name: 'Ability'}]};
 const d = deriveTower(model);
 // (20 x 1 + 2 x min(22, 10) + 5 x 2 x 4) / 0.5
 assert.equal(d.pps, 160);
 assert.equal(d.table, 160);
 const w = d.attacks[0].weapons[0];
 assert.deepEqual(w.projectiles.map(p => [p.name, p.pierce_used, p.damage, p.own_pops]), [['Shot', 1, 20, 20], ['Explosion', 10, 2, 20], ['Shrapnel', 2, 4, 8]]);
 assert.deepEqual(w.left_out.map(l => l.kind), ['DamageModifierForTagModel']);
 assert.deepEqual(d.tower_left_out.map(l => l.kind), ['AbilityModel']);
});
