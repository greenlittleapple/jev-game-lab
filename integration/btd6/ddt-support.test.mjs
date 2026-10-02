// DDT-capable figure with support effects (moab.mjs setDdtSupport, offline, default off) and its table
// (data/towers-ddt-support.json, data/generate.mjs ddtSupportValue).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ddtSupport, ddtSupportRow, ddtSupportOn, setDdtSupport, moabDpsRaw, moabCheck, hitsDdt} from './moab.mjs';
import {ddtSupportValue, DDT_SUPPORT_FIELDS} from './data/generate.mjs';
import {spearman, ratioSummary, supportEffects} from './moab-replay.mjs';
import {meadowPaths as paths} from './fixtures/index.mjs';

const TABLE = JSON.parse(readFileSync(new URL('./data/towers-ddt-support.json', import.meta.url), 'utf8'));
const row = (base_id, tiers) => ddtSupportRow({base_id, tiers: [...tiers].map(Number)});

test('the table comes from the same export as towers.json and names its fields', () => {
 assert.match(TABLE.source, /^Btd6ModHelper\/btd6-game-data f818c39 /);
 assert.deepEqual(TABLE.fields, DDT_SUPPORT_FIELDS);
});

test('camo removers the export confirms', () => {
 // Shimmer (Wizard x-x-3 and up) strips camo on its own, around the tower.
 assert.deepEqual(['003', '024', '005'].map(t => { const r = row('WizardMonkey', t); return [r.decamo, r.decamo_kind, r.decamo_radius]; }),
  [[1, 'range', 60], [1, 'range', 60], [1, 'range', 80]]);
 assert.equal(row('WizardMonkey', '002').decamo, 0);
 // Counter-Espionage (Ninja x-2-x and up) strips camo only from bloons it damages; its shuriken can't pop Lead, so only under an MIB.
 assert.deepEqual(['020', '021'].map(t => { const r = row('NinjaMonkey', t); return [r.decamo, r.pops, r.hits]; }), [[2, 0, 1], [2, 0, 1]]);
 assert.equal(row('NinjaMonkey', '010').decamo, 0);
 // Signal Flare (Mortar x-x-3 and up) around its aim point; the Embrittlement Ice Monkey (4-x-x) around itself; the Ice
 // Monkey's 3-x-x cleanse has a MOAB filter-out, and the Mermonkey's x-x-3 trance doesn't hit MOAB-class bloons.
 assert.deepEqual([row('MortarMonkey', '003').decamo_kind, row('MortarMonkey', '003').decamo_radius], ['point', 52]);
 assert.deepEqual([row('IceMonkey', '300').decamo, row('IceMonkey', '400').decamo, row('IceMonkey', '400').decamo_radius], [0, 1, 25]);
 assert.equal(row('Mermonkey', '003').decamo, 0);
 assert.deepEqual([row('MonkeySub', '300').decamo_kind, row('EngineerMonkey', '030').decamo_kind, row('Skywarden', '402').decamo_kind], ['submerge', 'point', 'zone']);
});

test('villages: Radar Scanner and MIB', () => {
 const v = t => { const r = row('MonkeyVillage', t); return [r.radar, r.mib, r.support_radius]; };
 assert.deepEqual([v('010'), v('020'), v('030'), v('120'), v('230')], [[0, 0, 0], [1, 0, 40], [1, 1, 40], [1, 0, 48], [1, 1, 48]]);
 assert.equal(row('MonkeyVillage', '030').camo, 0);
});

test('own facts: a Boomerang x-x-2 pops Lead and Black without camo detection, a Dart only under an MIB', () => {
 assert.deepEqual(['pops', 'hits', 'camo', 'camo_pops'].map(k => row('BoomerangMonkey', '002')[k]), [1, 1, 0, 0]);
 assert.deepEqual(['pops', 'hits', 'camo'].map(k => row('DartMonkey', '000')[k]), [0, 1, 0]);
 // camo_pops matches towers-ddt.json except where OverrideCamoDetectionModel adds camo to a Lead-popping attack.
 for (const [id, rows] of Object.entries(TABLE.towers)) for (const tiers of Object.keys(rows)) {
  if (id === 'Quincy') continue;
  const t = {base_id: id, tiers: [...tiers].map(Number)}, r = ddtSupportRow(t);
  if (r.camo_pops !== (hitsDdt(t) ? 1 : 0)) assert.ok(id === 'WizardMonkey' && ['004', '005'].includes(tiers), `${id} ${tiers}`);
 }
});

test('ddtSupportValue on a synthetic model', () => {
 const T = n => `Il2CppAssets.Scripts.Models.Towers.${n}, Assembly-CSharp`;
 const projectile = (cleanse, immune) => ({$type: T('Projectiles.ProjectileModel'), behaviors: [
  {$type: T('Projectiles.Behaviors.DamageModel'), damage: 1, immuneBloonProperties: immune},
  {$type: T('Projectiles.Behaviors.RemoveBloonModifiersModel'), cleanseCamo: true, ...cleanse}]});
 const model = (p, extra = []) => ({range: 30, behaviors: [{$type: T('Behaviors.Attack.AttackModel'), name: 'A', range: 30, behaviors: [],
  weapons: [{rate: 1, projectile: p}]}, ...extra]});
 const v = m => Object.fromEntries(DDT_SUPPORT_FIELDS.map((f, i) => [f, ddtSupportValue(m)[i]]));
 assert.deepEqual([v(model(projectile({}, 0))).decamo, v(model(projectile({}, 0))).decamo_radius], [1, 30]);
 assert.equal(v(model(projectile({cleanseOnlyIfDamaged: true}, 1))).decamo, 2);
 assert.equal(v(model(projectile({cleanseOnlyIfDamaged: true}, 0))).decamo, 1);
 const village = {range: 40, behaviors: [{$type: T('Behaviors.VisibilitySupportModel'), isCustomRadius: true, customRadius: 25}]};
 assert.deepEqual([v(village).radar, v(village).mib, v(village).support_radius], [1, 0, 25]);
});

// A small defence on Monkey Meadow: a Shimmer Wizard (0-2-4) upstream, a Boomerang 0-0-2 downstream of it and one near the
// entrance, upstream of the Wizard's coverage.
const wizard = {id: 1, base_id: 'WizardMonkey', tiers: [0, 2, 4], x: -26, y: -44};
const downstream = {id: 2, base_id: 'BoomerangMonkey', tiers: [0, 0, 2], x: 40, y: 0};
const upstream = {id: 3, base_id: 'BoomerangMonkey', tiers: [0, 0, 2], x: -120, y: -20};

test('off by default: the figure is the DDT-capable one', () => {
 assert.equal(ddtSupportOn(), false);
 const towers = [wizard, downstream, upstream];
 const plain = moabDpsRaw(towers, paths, {ddt: true});
 assert.equal(plain, moabDpsRaw([wizard], paths, {ddt: true}));
 assert.equal(plain, moabDpsRaw(towers, paths, {ddt: true, support: false}));
 assert.deepEqual(moabCheck(towers, 90, {paths, ddt: true}), moabCheck(towers, 90, {paths, ddt: true, support: false}));
});

test('a camo remover upstream adds the towers downstream that pop Lead and Black', () => {
 const towers = [wizard, downstream, upstream], s = ddtSupport(towers, paths);
 assert.deepEqual([s.get(1), s.get(2), s.get(3)], [{counts: true, via: ['own']}, {counts: true, via: ['decamo:1']}, {counts: false, via: []}]);
 const withSupport = moabDpsRaw(towers, paths, {ddt: true, support: true});
 assert.equal(withSupport, moabDpsRaw([wizard, downstream], paths, {ddt: false}));
 assert.ok(withSupport > moabDpsRaw(towers, paths, {ddt: true}));
 setDdtSupport(true);
 try { assert.equal(moabDpsRaw(towers, paths, {ddt: true}), withSupport); } finally { setDdtSupport(false); }
 assert.deepEqual(supportEffects(towers, paths), ['decamo by 1 (WizardMonkey 024): 2']);
});

test('the Skywarden camo-block zone is not a camo remover', () => {
 const sky = {id: 8, base_id: 'Skywarden', tiers: [4, 0, 2], x: -26, y: -44};
 assert.deepEqual(ddtSupport([sky, downstream], paths).get(2), {counts: false, via: []});
});

test('an MIB village: radar and Lead popping for towers in range, and Counter-Espionage under it', () => {
 const village = {id: 4, base_id: 'MonkeyVillage', tiers: [0, 3, 0], x: 40, y: 30};
 const dart = {id: 5, base_id: 'DartMonkey', tiers: [0, 0, 0], x: 45, y: 10};
 const farDart = {id: 6, base_id: 'DartMonkey', tiers: [0, 0, 0], x: -26, y: -2};
 const ninja = {id: 7, base_id: 'NinjaMonkey', tiers: [0, 2, 1], x: 60, y: 40};
 let s = ddtSupport([village, dart, farDart], paths);
 assert.deepEqual([s.get(5), s.get(6).counts, s.get(4).counts], [{counts: true, via: ['radar:4', 'mib:4']}, false, false]);
 // Ninja 0-2-1 sees camo and hits under the MIB.
 s = ddtSupport([village, ninja, upstream], paths);
 assert.deepEqual(s.get(7), {counts: true, via: ['mib:4']});
 // Without the MIB the Ninja neither hits nor strips camo.
 s = ddtSupport([ninja, downstream], paths);
 assert.deepEqual([s.get(7).counts, s.get(2).counts], [false, false]);
});

test('summaries: Spearman with ties and ratios that leave out estimates of 0', () => {
 assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
 assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
 assert.equal(spearman([1, 2, 3], [5, 5, 6]), 0.87);
 assert.equal(spearman([1, 2], [1, 2]), null);
 const s = ratioSummary([{measured: 10, e: 5}, {measured: 30, e: 10}, {measured: 8, e: 0}, {measured: 4, e: 4}], 'e');
 assert.deepEqual(s, {n: 4, zero: 1, median: 2, min: 1, max: 3, spearman: 0.8});
});
