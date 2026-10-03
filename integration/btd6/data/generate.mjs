// Builds rounds.json and towers.json in this folder from a local clone of the BTD6 Mod Helper
// game-data export (https://github.com/Btd6ModHelper/btd6-game-data). The clone is not committed.
//   node integration/btd6/data/generate.mjs <path to btd6-game-data clone>
//   node integration/btd6/data/generate.mjs <clone> --candidate   (towers-candidate.json and rounds-candidate.json only, for
//     pops-study --fixes: the Purple field and the camo and Purple peaks)
//   node integration/btd6/data/generate.mjs <clone> --camo-timing   (camo-timing.json only, for camo-replay.mjs --models)
// The committed files were made from commit f818c39 ("56.0"). Both files record the commit they came from.
//
// rounds.json, rounds 1 to 100 of Rounds/DefaultRoundSet (the game's round index + 1):
//   bloons: count per bloon type as the export names it (e.g. "GreenRegrowCamo", "MoabFortified")
//   camo, regrow, fortified: how many of the round's bloons have that property
//   rbe: red bloon equivalent, the layers to pop (base health and children, below); camo and regrow
//        don't change it. Rounds 81+ use the same health, though the game makes ceramics and MOAB-class
//        bloons tougher there, so their RBE is a lower bound.
//   seconds: when the last bloon is sent, from the round start (the export's group end, in frames at 60/s)
//   first: bloon types and properties seen for the first time in the round set
//   camo_lead: how many of the round's bloons are both Camo and Lead (a tower must see camo and pop Lead with
//        one attack to pop their Lead layer)
//   moab_groups: the round's MOAB-class groups as [bloon, count, start, end], start and end in seconds from the round
//        start (frames / 60); the bloons of a group are spread evenly from its start to its end, as for peak. moab.mjs
//        moabCheck takes the most MOAB-class health due within any stretch of time from them (btd6-jev-v6 revision 19).
//        Only rounds with MOAB-class bloons have it.
//   camo_rbe: the RBE of the round's camo bloons (each bloon's full RBE, by its name in the export; graded speed's
//        camo margin, speed.mjs defenceMargins with camo)
//   peak: the most RBE sent within any PEAK_SECONDS of the round (bloons of a group spread evenly from its start to
//        its end), MOAB-class left out as in hard-rounds.mjs. Round 78 sends 72 camo Ceramics in 1.2 s near its end:
//        7,488 of the 8,870 RBE of its densest 10 s (estimate.mjs roundCheck, burst).
// towers.json, per base tower and upgrade tiers ("000" to "502"), and per Quincy level:
//   [pops per second, pops lead (1/0), sees camo (1/0), range, MOAB damage per second, camo and lead (1/0)]
//   pops per second, a rough upper figure: for each attack's weapon, projectiles per shot x
//   min(pierce, PIERCE_CAP) x damage / attack interval (see MIN_RATE), plus the same for projectiles it creates on
//   contact, expiry or damage (a bomb's explosion, a Sniper's shrapnel). A tower whose stance swaps weapons counts one
//   weapon per attack (stanceWeapons: the Skywarden), and children sent out in a full ring that fly further than their
//   explosion's radius count at RING_SHARE of their number (ringShare: the Bomb Shooter's clusters). Abilities, buffs
//   from other towers, bonus damage to MOAB-class or other tags, and slowing effects are left out. data/towers-v4.json
//   is the table from before on-damage projectiles, the stance and the ring share (btd6-jev-v4 keeps it).
//   pops lead: some damaging projectile isn't immune to Lead (BloonProperties bit 1).
//   sees camo: some attack has no active FilterInvisibleModel, or targets the track (Spike Factory) with
//   projectiles that have none. Camo granted by a Monkey Village isn't included.
//   camo and lead: one attack both sees camo and has a damaging projectile that pops Lead, so the tower can pop a
//   camo Lead bloon's Lead layer (a tower with a camo attack and a separate Lead-popping one can't).
//   MOAB damage per second (policy btd6-jev-v4), against one MOAB: for each attack's weapon, projectiles per
//   shot x the damage one projectile deals to a MOAB / attack interval. Pierce doesn't multiply it: a
//   projectile hits a given bloon once. The damage is the DamageModel's plus its DamageModifierForTagModel
//   bonuses for the "Moabs" or "Moab" tag (x multiplier + addition). Projectiles created on contact or
//   expiry count one hit per creation (an explosion hits the MOAB once; shrapnel and frags fly off); a
//   shot spread over half a turn or more (the Tack Shooter's ring) counts one projectile.
//   Projectiles or attacks filtered away from MOABs (FilterOutTagModel "Moabs", FilterMoabModel flip, a
//   FilterWithTagsModel without "Moabs") deal 0. Damage over time added to the bloon (a Mortar's Burny
//   Stuff) adds its damage / interval once per tower, since the effect doesn't stack. Abilities, buffs and
//   bonuses for BFB, ZOMG, DDT or BAD tags are left out.
// towers-ddt.json, per base tower and upgrade tiers and per Quincy level (moab.mjs DDT-capable MOAB damage, from
// btd6-jev-v6 revision 13): [hits a DDT (1/0)]. A DDT is Camo, Lead and Black (the export's Bloons/Ddt: bloonProperties
// 3, the Camo variants isCamo). 1 when one attack both sees camo (as for towers.json's sees camo) and has a projectile,
// or one it creates on contact or expiry, that hits MOAB-class bloons and whose DamageModel is immune to neither Lead
// (BloonProperties bit 1) nor Black (bit 2). Every DamageModel in the export carries immuneBloonProperties, so the field
// is known for every tower in the table. Camo granted by a Monkey Village isn't included.
//   node integration/btd6/data/generate.mjs <clone> --ddt   (towers-ddt.json only)
// towers-ddt-support.json (moab.mjs setDdtSupport, offline, default off): per base tower and tiers and per Quincy level, the
// facts the DDT-capable figure needs once support effects count (ddtSupportValue). Fields:
//   pops: some attack that can target MOAB-class bloons has a projectile (or one it creates on contact or expiry) that hits
//     them with damage immune to neither Lead nor Black (DamageModel.immuneBloonProperties & 3), whatever its camo detection.
//     Projectiles with a FilterOutTagModel for the "Ddt" tag (the Druid's 3-x-x vines, the Super Monkey's Storm Blast) don't
//     count.
//   hits: as pops with any damage, and with the "Ddt" filter-outs lifted: what a Monkey Intelligence Bureau's
//     DamageTypeSupportModel (immuneBloonProperties 0) and SupportRemoveFilterOutTagModel ("Village:DdtDamageModifier",
//     which names no tag; taken here to lift the "Ddt" filter-outs) make DDT-capable.
//   camo: the tower detects camo itself: some damaging attack sees camo (as towers.json's sees camo), or the tower has an
//     OverrideCamoDetectionModel with detectCamo (Wizard x-x-2 and up, Super Monkey x-x-2 and up).
//   camo_pops: one attack both sees camo (with the override) and pops (as pops): the tower hits a camo DDT on its own.
//   camo_hits: one attack both sees camo and hits (as hits): the tower hits a camo DDT under an MIB.
//   decamo: whether an attack strips camo from a camo DDT: 1 on its own, 2 only under an MIB, 0 never. The attack must see
//     camo (with the override) and target MOAB-class bloons, and some projectile in its tree must hit MOAB-class bloons,
//     have no active FilterInvisibleModel, and carry a RemoveBloonModifiersModel with cleanseCamo (and no
//     bloonTagExplicitList that leaves out "Ddt", no bloonTagExcludeList with it). With cleanseOnlyIfDamaged that projectile
//     must damage the DDT itself: 1 when it pops Lead and Black, 2 when its damage can't (Counter-Espionage's shuriken:
//     damage 1, immune to Lead), none without damage. A tower-level CamoBlockZoneModel (Skywarden 4-x-x) counts as 1.
//   decamo_kind: "range" (around the tower), "point" (around the attack's selected point: an attack with
//     TargetSelectedPointModel, the Mortar's Signal Flare and the Engineer's Cleansing Foam), "submerge" (the Sub's
//     submerged attack, only while it targets Submerge), "zone" (CamoBlockZoneModel), or "" with decamo 0.
//   decamo_radius: for range and submerge, the smaller of the attack's range and the tower's (the Sub's submerged attack
//     has range 2,000 and a pulse of radius 52); for point, the cleansing projectile's radius (Signal Flare 52); for zone,
//     the tower's range. The zone model has no radius field, so that radius is an assumption. moab.mjs doesn't use the zone: the
//     CHIMPS logs show it doesn't remove a DDT's camo (moab.mjs ddtSupport).
//   radar: a VisibilitySupportModel (Monkey Village x-2-x and up: Radar Scanner) grants camo detection to towers in range.
//   mib: a DamageTypeSupportModel whose immuneBloonProperties leaves out Lead and Black (Monkey Village x-3-x and up: MIB)
//     lets towers in range pop them.
//   support_radius: the support models' radius (customRadius when isCustomRadius, else the tower's range; -1 for
//     isGlobal); 0 without either. Neither applies to the village itself (appliesToOwningTower false in the export).
//   node integration/btd6/data/generate.mjs <clone> --ddt-support   (towers-ddt-support.json only)
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PIERCE_CAP = 10;
// Pops one hit can make on a bloon that isn't MOAB-class: a Ceramic's RBE (bloonRbe('Ceramic'), 104). The Druid's
// Jungle vine (0-3-x and up) grabs one bloon and destroys it, which the export writes as pierce 9999999 and damage
// 9999999. Counted as is (pierce at PIERCE_CAP) it gave 38,461,546 pops a second; in log 2026-10-02T18-17-19 a 0-3-2
// Druid measured 96 to 1,985 pops a round against estimates of 0.28 to 1.7 billion.
export const KILL_CAP = 104;
export const PEAK_SECONDS = 10;
const MIN_RATE = 0.1;
const here = dirname(fileURLToPath(import.meta.url));

// Health and children per bloon type; Fortified doubles the health of Lead (x4), Ceramic and MOAB-class.
export const BLOONS = {
 Red: [1, []], Blue: [1, ['Red']], Green: [1, ['Blue']], Yellow: [1, ['Green']], Pink: [1, ['Yellow']],
 Black: [1, ['Pink', 'Pink']], White: [1, ['Pink', 'Pink']], Purple: [1, ['Pink', 'Pink']],
 Lead: [1, ['Black', 'Black']], Zebra: [1, ['Black', 'White']], Rainbow: [1, ['Zebra', 'Zebra']],
 Ceramic: [10, ['Rainbow', 'Rainbow']], Moab: [200, Array(4).fill('Ceramic')], Bfb: [700, Array(4).fill('Moab')],
 Zomg: [4000, Array(4).fill('Bfb')], Ddt: [400, Array(4).fill('Ceramic')], Bad: [20000, ['Zomg', 'Zomg', 'Ddt', 'Ddt', 'Ddt']],
};
const fortifiedHealth = (base, hp) => base === 'Lead' ? 4 : hp * 2;
export function parseBloon(name) {
 const base = Object.keys(BLOONS).find(b => name.startsWith(b));
 if (!base) throw Error(`Unknown bloon ${name}`);
 const rest = name.slice(base.length);
 return {base, camo: rest.includes('Camo'), regrow: rest.includes('Regrow'), fortified: rest.includes('Fortified')};
}
const MOAB_CLASS = /^(Moab|Bfb|Zomg|Ddt|Bad)/;
// The most of events' value ([seconds, value], sorted) within any window of the given length.
export function densest(events, seconds = PEAK_SECONDS) {
 let best = 0, sum = 0, j = 0;
 for (let i = 0; i < events.length; i++) {
  sum += events[i][1];
  while (events[i][0] - events[j][0] > seconds) sum -= events[j++][1];
  best = Math.max(best, sum);
 }
 return best;
}
// A round's peak (above) from its groups ({bloon, count, start, end} in frames).
export function roundPeak(groups, seconds = PEAK_SECONDS) {
 const events = [];
 for (const g of groups) {
  if (MOAB_CLASS.test(g.bloon)) continue;
  const rbe = bloonRbe(g.bloon);
  for (let i = 0; i < g.count; i++) events.push([(g.start + (g.count > 1 ? (g.end - g.start) * i / (g.count - 1) : 0)) / 60, rbe]);
 }
 return densest(events.sort((a, b) => a[0] - b[0]), seconds);
}
const rbeOf = (base, fortified = false) => {
 const [hp, children] = BLOONS[base];
 return (fortified ? fortifiedHealth(base, hp) : hp) + children.reduce((n, c) => n + rbeOf(c), 0);
};
export const bloonRbe = name => { const b = parseBloon(name); return rbeOf(b.base, b.fortified); };

// Candidate round facts (--candidate, rounds-candidate.json) from a round's groups: camo_rbe (the RBE of its camo
// bloons, by name), camo_peak (the most of it within PEAK_SECONDS, MOAB-class left out as in peak), purple (Purple
// layers: one per Purple bloon) and purple_peak.
export function roundExtras(groups, seconds = PEAK_SECONDS) {
 const camo = [], purple = [];
 let camoRbe = 0, purples = 0;
 for (const g of groups) {
  const b = parseBloon(g.bloon), rbe = bloonRbe(g.bloon);
  if (b.camo) camoRbe += rbe * g.count;
  if (b.base === 'Purple') purples += g.count;
  if (MOAB_CLASS.test(g.bloon)) continue;
  for (let i = 0; i < g.count; i++) {
   const at = (g.start + (g.count > 1 ? (g.end - g.start) * i / (g.count - 1) : 0)) / 60;
   if (b.camo) camo.push([at, rbe]);
   if (b.base === 'Purple') purple.push([at, 1]);
  }
 }
 const peak = list => densest(list.sort((a, b) => a[0] - b[0]), seconds);
 return {camo_rbe: camoRbe, camo_peak: peak(camo), purple: purples, purple_peak: peak(purple)};
}

// The spawn stretch of a round's camo bloons (camo-timing.json, camo-replay.mjs --models): {start, end} in seconds from the
// round start, the first camo group's start and the last one's end (groups as in roundPeak; camo by name, as camo_rbe);
// null in a round without camo bloons.
export function camoTiming(groups) {
 const camo = groups.filter(g => g.count > 0 && parseBloon(g.bloon).camo);
 if (!camo.length) return null;
 return {start: +(Math.min(...camo.map(g => g.start)) / 60).toFixed(2), end: +(Math.max(...camo.map(g => g.end)) / 60).toFixed(2)};
}

async function rounds(dir) {
 const seen = new Set(), out = {};
 for (let r = 1; r <= 100; r++) {
  const groups = JSON.parse(await readFile(join(dir, 'Rounds/DefaultRoundSet', `${r}.json`), 'utf8')).groups;
  const bloons = {}, first = [];
  let camo = 0, regrow = 0, fortified = 0, camoLead = 0, rbe = 0, end = 0;
  for (const g of groups) {
   bloons[g.bloon] = (bloons[g.bloon] ?? 0) + g.count;
   const b = parseBloon(g.bloon);
   camo += b.camo ? g.count : 0; camoLead += b.camo && b.base === 'Lead' ? g.count : 0; regrow += b.regrow ? g.count : 0; fortified += b.fortified ? g.count : 0;
   rbe += bloonRbe(g.bloon) * g.count;
   end = Math.max(end, g.end);
   for (const key of [b.base, ...['camo', 'regrow', 'fortified'].filter(k => b[k]).map(k => k[0].toUpperCase() + k.slice(1))])
    if (!seen.has(key)) { seen.add(key); first.push(key); }
  }
  const moabGroups = groups.filter(g => MOAB_CLASS.test(g.bloon)).map(g => [g.bloon, g.count, +(g.start / 60).toFixed(2), +(g.end / 60).toFixed(2)]);
  out[r] = {bloons, rbe, seconds: +(end / 60).toFixed(1), camo, regrow, fortified, first, camo_lead: camoLead, peak: roundPeak(groups), camo_rbe: roundExtras(groups).camo_rbe,
   ...(moabGroups.length ? {moab_groups: moabGroups} : {})};
 }
 return out;
}

// Towers whose tier files are read; the IDs match towers.mjs BASE_TOWERS. The Sheriff (Frontier Legends hero, 11
// swappable weapons, the equipped one not in the export) is left out: no single figure can be derived for it.
const TOWERS = ['DartMonkey', 'BoomerangMonkey', 'BombShooter', 'TackShooter', 'IceMonkey', 'GlueGunner', 'Desperado', 'SniperMonkey',
 'MonkeySub', 'MonkeyBuccaneer', 'MonkeyAce', 'HeliPilot', 'MortarMonkey', 'DartlingGunner', 'WizardMonkey', 'SuperMonkey', 'NinjaMonkey',
 'Alchemist', 'Druid', 'Mermonkey', 'BananaFarm', 'SpikeFactory', 'MonkeyVillage', 'EngineerMonkey', 'BeastHandler', 'Skywarden'];
// Behaviours that create a projectile on contact, expiry or a share of its travel, or when the projectile damages a
// bloon (EmitOnDamageModel: the Sniper's Shrapnel Shot, the Desperado's). CreateDistanceProjectileOn... (only the
// Skywarden's middle path uses it) creates one whose pierce and radius grow with the distance flown; it counts as one
// projectile per creation, like the others. towers-v4.json is the table from before EmitOnDamageModel was counted.
const CREATES = /Create(Distance)?ProjectileOn|EmitOnDamageModel/;
// MOAB damage leaves EmitOnDamageModel projectiles out: they fly off the bloon hit, so they don't hit the same MOAB again.
const MOAB_CREATES = /Create(Distance)?ProjectileOn/;
const isType = (o, name) => typeof o?.$type === 'string' && o.$type.split(',')[0].endsWith(`.${name}`);
const emitted = e => e?.count ?? e?.Count ?? e?.projectileCount ?? 1;

// Children sent out in a full ring (ArcEmissionModel, 360 degrees, not turned
// with the projectile) that fly further than their explosion's radius before exploding land on a ring around the
// hit. On a straight track through the hit, an explosion of radius R at distance d and angle a to the track reaches
// the track's centre line only if d x |sin a| <= R. For the Bomb Shooter's 8 clusters (d 22 to 40, R 15) that is 2 of
// the 8 directions when one lies along the track and 4 when the ring is turned 22.5 degrees, so they count at
// RING_SHARE of their number, the upper end.
export const RING_SHARE = 0.5;
// How far a projectile flies before it ends: RandomRangeTravelStraitModel's minRange, else speed x lifespan.
const travelOf = p => {
 const r = (p.behaviors ?? []).find(b => isType(b, 'RandomRangeTravelStraitModel'));
 if (r) return r.minRange ?? null;
 const t = (p.behaviors ?? []).find(b => isType(b, 'TravelStraitModel') || isType(b, 'TravelStraitSlowdownModel'));
 return t && t.speed > 0 && t.lifespan > 0 ? t.speed * t.lifespan : null;
};
// The radius of the damaging projectile a projectile creates when it ends (its explosion), or null.
const explosionOf = p => (p.behaviors ?? []).filter(b => b?.projectile && /CreateProjectileOnExhaust/.test(b.$type))
 .map(b => b.projectile).find(c => (c.behaviors ?? []).some(x => isType(x, 'DamageModel') && x.damage > 0))?.radius ?? null;
export const ringShare = (b, child) => {
 const e = b.emission;
 if (!isType(e, 'ArcEmissionModel') || !(e.angle >= 360) || e.useProjectileRotation) return 1;
 const travel = travelOf(child), radius = explosionOf(child);
 return travel != null && radius != null && travel > radius ? RING_SHARE : 1;
};

// Pops per shot of a projectile and whether any damaging part can pop lead (and Purple, BloonProperties bit 8).
// ring (candidate): children in a full ring count at ringShare.
function projectileValue(p, depth = 0, {ring = false} = {}) {
 if (!p || depth > 3) return {pops: 0, lead: false, purple: false};
 const dmg = (p.behaviors ?? []).find(b => isType(b, 'DamageModel'));
 // A projectile that hits only its target (CollideOnlyWithTargetModel) has pierce 1, whatever its pierce field says. A
 // projectile filtered away from MOAB-class bloons pops at most the largest bloon it can hit, a Ceramic (KILL_CAP).
 const pierce = (p.behaviors ?? []).some(b => isType(b, 'CollideOnlyWithTargetModel')) ? 1 : Math.min(p.pierce ?? 1, PIERCE_CAP);
 const damage = dmg && dmg.damage > 0 ? (hitsMoab(projectileFilters(p)) ? dmg.damage : Math.min(dmg.damage, KILL_CAP)) : 0;
 let pops = pierce * damage;
 let lead = Boolean(dmg && dmg.damage > 0 && !(dmg.immuneBloonProperties & 1)), purple = Boolean(dmg && dmg.damage > 0 && !(dmg.immuneBloonProperties & 8));
 for (const b of p.behaviors ?? []) if (b?.projectile && CREATES.test(b.$type)) {
  const child = projectileValue(b.projectile, depth + 1, {ring});
  pops += emitted(b.emission) * (ring ? ringShare(b, b.projectile) : 1) * child.pops; lead ||= child.lead; purple ||= child.purple;
 }
 return {pops, lead, purple};
}

const MOAB_TAGS = ['Moabs', 'Moab'];
// A projectile's filters sit on the projectile and in its ProjectileFilterModel behaviours.
const projectileFilters = p => [...(p.filters ?? []), ...(p.behaviors ?? []).filter(b => isType(b, 'ProjectileFilterModel')).flatMap(b => b.filters ?? [])];
// Projectiles per shot that can meet one MOAB: all of a narrow spread, one of a wide one (the Tack
// Shooter's ring of tacks).
const moabShots = e => isType(e, 'ArcEmissionModel') && e.angle >= 180 ? 1 : emitted(e);
const hitsMoab = filters => !(filters ?? []).some(f => (isType(f, 'FilterOutTagModel') && MOAB_TAGS.includes(f.tag))
 || (isType(f, 'FilterMoabModel') && f.flip) || (isType(f, 'FilterWithTagsModel') && f.inclusive && !(f.tags ?? []).some(t => MOAB_TAGS.includes(t))));
const moabBonus = (p, damage) => (p.behaviors ?? []).filter(b => isType(b, 'DamageModifierForTagModel'))
 .filter(b => { const tags = b.tags?.length ? b.tags : [b.tag]; return b.mustIncludeAllTags ? tags.every(t => MOAB_TAGS.includes(t)) : tags.some(t => MOAB_TAGS.includes(t)); })
 .reduce((d, b) => d * (b.damageMultiplier ?? 1) + (b.damageAddative ?? 0), damage);
// Damage one projectile deals to one MOAB, and the best damage-over-time rate it applies.
function moabHit(p, depth = 0) {
 if (!p || depth > 3 || !hitsMoab(projectileFilters(p))) return {hit: 0, dot: 0};
 const dmg = (p.behaviors ?? []).find(b => isType(b, 'DamageModel'));
 let hit = dmg && dmg.damage > 0 ? moabBonus(p, dmg.damage) : 0, dot = 0;
 for (const b of p.behaviors ?? []) {
  if (isType(b, 'AddBehaviorToBloonModel') && hitsMoab(b.filters))
   for (const d of (b.behaviors ?? []).filter(x => isType(x, 'DamageOverTimeModel'))) if (d.damage > 0 && d.interval > 0) dot = Math.max(dot, d.damage / d.interval);
  if (b?.projectile && MOAB_CREATES.test(b.$type)) {
   const child = moabHit(b.projectile, depth + 1);
   hit += Math.min(1, emitted(b.emission)) * child.hit; dot = Math.max(dot, child.dot);
  }
 }
 return {hit, dot};
}

export function moabValue(model) {
 let dps = 0, dot = 0;
 for (const a of model.behaviors ?? []) {
  if (!isType(a, 'AttackModel') && !isType(a, 'AttackAirUnitModel')) continue;
  if (!hitsMoab((a.behaviors ?? []).filter(b => isType(b, 'AttackFilterModel')).flatMap(b => b.filters ?? []))) continue;
  const main = (a.weapons ?? []).find(w => w.rate >= MIN_RATE)?.rate;
  for (const w of a.weapons ?? []) {
   const rate = w.rate >= MIN_RATE || !main ? w.rate : main;
   if (!(rate > 0)) continue;
   const v = moabHit(w.projectile);
   dps += moabShots(w.emission) * v.hit / rate; dot = Math.max(dot, v.dot);
  }
 }
 return +(dps + dot).toFixed(1);
}

// Lead and Black (BloonProperties bits 1 and 2): the properties of a DDT that a projectile must not be immune to.
const DDT_PROPERTIES = 3;
const hiddenBy = filters => (filters ?? []).some(f => isType(f, 'FilterInvisibleModel') && f.isActive);
// Whether an attack sees camo: no active FilterInvisibleModel on the attack, or it targets the track (Spike Factory) with
// projectiles that have none.
const seesCamo = a => !hiddenBy((a.behaviors ?? []).filter(b => isType(b, 'AttackFilterModel')).flatMap(b => b.filters ?? []))
 || ((a.behaviors ?? []).some(b => isType(b, 'TargetTrackModel')) && (a.weapons ?? []).some(w => !hiddenBy(w.projectile?.filters)));
// Whether a projectile, or one it creates on contact or expiry, hits a MOAB-class bloon with damage that pops Lead and Black.
function popsDdt(p, depth = 0) {
 if (!p || depth > 3 || !hitsMoab(projectileFilters(p))) return false;
 const dmg = (p.behaviors ?? []).find(b => isType(b, 'DamageModel'));
 if (dmg && dmg.damage > 0 && !((dmg.immuneBloonProperties ?? 0) & DDT_PROPERTIES)) return true;
 return (p.behaviors ?? []).some(b => b?.projectile && MOAB_CREATES.test(b.$type) && popsDdt(b.projectile, depth + 1));
}
// towers-ddt.json's row: [1] when one attack sees camo and has a weapon whose projectile popsDdt, else [0].
export function ddtValue(model) {
 for (const a of model.behaviors ?? []) {
  if (!isType(a, 'AttackModel') && !isType(a, 'AttackAirUnitModel')) continue;
  if (!hitsMoab((a.behaviors ?? []).filter(b => isType(b, 'AttackFilterModel')).flatMap(b => b.filters ?? []))) continue;
  if (seesCamo(a) && (a.weapons ?? []).some(w => popsDdt(w.projectile))) return [1];
 }
 return [0];
}

// towers-ddt-support.json (see the header).
export const DDT_SUPPORT_FIELDS = ['pops', 'hits', 'camo', 'camo_pops', 'camo_hits', 'decamo', 'decamo_kind', 'decamo_radius', 'radar', 'mib', 'support_radius'];
const outOfDdt = filters => (filters ?? []).some(f => isType(f, 'FilterOutTagModel') && f.tag === 'Ddt');
// Damage a projectile tree deals to a DDT: lb, some part hits it with damage that pops Lead and Black; any, some part
// damages it at all. mib: the "Ddt" filter-outs lifted.
function ddtDamage(p, {mib = false} = {}, depth = 0) {
 const filters = p ? projectileFilters(p) : [];
 if (!p || depth > 3 || !hitsMoab(filters) || (!mib && outOfDdt(filters))) return {lb: false, any: false};
 const dmg = (p.behaviors ?? []).find(b => isType(b, 'DamageModel'));
 let any = Boolean(dmg && dmg.damage > 0), lb = any && !((dmg.immuneBloonProperties ?? 0) & DDT_PROPERTIES);
 for (const b of p.behaviors ?? []) if (b?.projectile && MOAB_CREATES.test(b.$type)) {
  const c = ddtDamage(b.projectile, {mib}, depth + 1); lb ||= c.lb; any ||= c.any;
 }
 return {lb, any};
}
// The projectiles of a tree that strip camo from a camo DDT: [{p, level}] (level 1 on its own, 2 only under an MIB).
function cleansers(p, depth = 0, out = []) {
 if (!p || depth > 3) return out;
 const filters = projectileFilters(p);
 const r = (p.behaviors ?? []).find(b => isType(b, 'RemoveBloonModifiersModel') && b.cleanseCamo);
 const listed = r && (!(r.bloonTagExplicitList ?? []).length || r.bloonTagExplicitList.includes('Ddt')) && !(r.bloonTagExcludeList ?? []).includes('Ddt');
 if (listed && hitsMoab(filters) && !hiddenBy(filters)) {
  if (!r.cleanseOnlyIfDamaged) out.push({p, level: 1});
  else {
   const dmg = (p.behaviors ?? []).find(b => isType(b, 'DamageModel')), any = Boolean(dmg && dmg.damage > 0);
   if (any) out.push({p, level: (dmg.immuneBloonProperties ?? 0) & DDT_PROPERTIES ? 2 : 1});
  }
 }
 for (const b of p.behaviors ?? []) if (b?.projectile && MOAB_CREATES.test(b.$type)) cleansers(b.projectile, depth + 1, out);
 return out;
}
const supportRadius = (b, model) => b.isGlobal ? -1 : b.isCustomRadius ? b.customRadius : model.range ?? 0;
export function ddtSupportValue(model) {
 const override = (model.behaviors ?? []).some(b => isType(b, 'OverrideCamoDetectionModel') && b.detectCamo);
 const attacks = (model.behaviors ?? []).filter(a => isType(a, 'AttackModel') || isType(a, 'AttackAirUnitModel'));
 const moabAttacks = attacks.filter(a => hitsMoab((a.behaviors ?? []).filter(b => isType(b, 'AttackFilterModel')).flatMap(b => b.filters ?? [])));
 const sees = a => override || seesCamo(a);
 const lb = a => (a.weapons ?? []).some(w => ddtDamage(w.projectile).lb), any = a => (a.weapons ?? []).some(w => ddtDamage(w.projectile, {mib: true}).any);
 const damaging = a => (a.weapons ?? []).some(w => projectileValue(w.projectile).pops > 0);
 const pops = moabAttacks.some(lb), hits = moabAttacks.some(any), camo = override || attacks.some(a => seesCamo(a) && damaging(a));
 const camoPops = moabAttacks.some(a => sees(a) && lb(a)), camoHits = moabAttacks.some(a => sees(a) && any(a));
 let decamo = 0, kind = '', radius = 0;
 const submerges = (model.behaviors ?? []).some(b => isType(b, 'SubmergeModel'));
 for (const a of moabAttacks) {
  if (!sees(a)) continue;
  const point = (a.behaviors ?? []).some(b => isType(b, 'TargetSelectedPointModel'));
  for (const w of a.weapons ?? []) for (const c of cleansers(w.projectile)) {
   const k = point ? 'point' : submerges && /Submerge/.test(a.name ?? '') ? 'submerge' : 'range';
   const r = k === 'point' ? c.p.radius ?? 0 : Math.min(a.range ?? Infinity, model.range ?? Infinity);
   if (!decamo || c.level < decamo || (c.level === decamo && r > radius)) { decamo = c.level; kind = k; radius = r; }
  }
 }
 if (!decamo && (model.behaviors ?? []).some(b => isType(b, 'CamoBlockZoneModel') && !b.isDisabled)) { decamo = 1; kind = 'zone'; radius = model.range ?? 0; }
 const radarModel = (model.behaviors ?? []).find(b => isType(b, 'VisibilitySupportModel'));
 const mibModel = (model.behaviors ?? []).find(b => isType(b, 'DamageTypeSupportModel') && !((b.immuneBloonProperties ?? 0) & DDT_PROPERTIES));
 const support = radarModel ?? mibModel;
 const b = v => v ? 1 : 0;
 return [b(pops), b(hits), b(camo), b(camoPops), b(camoHits), decamo, kind, +radius.toFixed(1), b(radarModel), b(mibModel), support ? +supportRadius(support, model).toFixed(1) : 0];
}

// A tower with a ToggleFocusStanceModel whose swapWeapon is true fires one of
// its attack's weapons at a time, swapping on a stance change. The export names no default stance; the weapon counted
// is MainWeapon (the first, and the other is LongWeapon, which fits the stance's range x1.35), else the first.
const stanceWeapons = (model, a) => {
 const swap = (model.behaviors ?? []).some(b => isType(b, 'ToggleFocusStanceModel') && b.swapWeapon === true);
 const list = a.weapons ?? [];
 if (!swap || list.length < 2) return list;
 return [list.find(w => /MainWeapon/.test(w.name ?? '')) ?? list[0]];
};

// purple (towers-candidate.json, for the studies): add a 7th field, pops Purple (1/0). stance, ring: the corrections above
// (on by default; off reproduces the table with on-damage projectiles only). MOAB damage (moabValue) uses neither.
export function towerValue(model, {purple: withPurple = false, stance = true, ring = true} = {}) {
 let pops = 0, lead = false, camo = false, camoLead = false, purple = false, range = model.range ?? 0;
 for (const a of model.behaviors ?? []) {
  if (!isType(a, 'AttackModel') && !isType(a, 'AttackAirUnitModel')) continue;
  let attackPops = 0, attackLead = false;
  const main = (a.weapons ?? []).find(w => w.rate >= MIN_RATE)?.rate;
  for (const w of stance ? stanceWeapons(model, a) : a.weapons ?? []) {
   // An interval under MIN_RATE next to a slower weapon (the Buccaneer's second dart has 0.05) is taken to
   // be fired by another behaviour, once per shot of that weapon. Alone (the Super Monkey), it is used as is.
   const rate = w.rate >= MIN_RATE || !main ? w.rate : main;
   if (!(rate > 0)) continue;
   const v = projectileValue(w.projectile, 0, {ring});
   attackPops += emitted(w.emission) * v.pops / rate; attackLead ||= v.lead && v.pops > 0; purple ||= v.purple && v.pops > 0;
  }
  if (attackPops > 0) {
   pops += attackPops; lead ||= attackLead;
   if (seesCamo(a)) { camo = true; camoLead ||= attackLead; }
  }
 }
 const row = [+pops.toFixed(1), lead ? 1 : 0, camo ? 1 : 0, +range.toFixed(1), moabValue(model), camoLead ? 1 : 0];
 return withPurple ? [...row, purple ? 1 : 0] : row;
}

// value: the row for one tower model (towerValue, or ddtValue for towers-ddt.json).
async function towers(dir, opts = {}, value = towerValue) {
 const out = {};
 for (const id of TOWERS) {
  out[id] = {};
  for (const file of (await readdir(join(dir, 'Towers', id))).sort()) {
   const m = file.match(new RegExp(`^${id}(?:-([0-5]{3}))?\\.json$`));
   if (!m) continue;
   out[id][m[1] ?? '000'] = value(JSON.parse(await readFile(join(dir, 'Towers', id, file), 'utf8')), opts);
  }
  out[id] = Object.fromEntries(Object.entries(out[id]).sort(([a], [b]) => a.localeCompare(b)));
 }
 out.Quincy = {};
 for (let level = 1; level <= 20; level++)
  out.Quincy[level] = value(JSON.parse(await readFile(join(dir, 'Towers/Quincy', level === 1 ? 'Quincy.json' : `Quincy ${level}.json`), 'utf8')), opts);
 return out;
}

// One line per round or tower, so diffs stay readable.
const lines = (head, key, table) => `{\n${Object.entries(head).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n ${JSON.stringify(key)}: {\n${
 Object.entries(table).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n }\n}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
 const dir = process.argv[2];
 if (!dir) { console.error('Usage: node integration/btd6/data/generate.mjs <btd6-game-data clone>'); process.exit(2); }
 const commit = execFileSync('git', ['-C', dir, 'log', '-1', '--abbrev=7', '--format=%h %s'], {encoding: 'utf8'}).trim();
 const source = `Btd6ModHelper/btd6-game-data ${commit}`;
 const writeDdt = async () => writeFile(join(here, 'towers-ddt.json'), lines({source, fields: ['ddt']}, 'towers', await towers(dir, {}, ddtValue)));
 const writeDdtSupport = async () => writeFile(join(here, 'towers-ddt-support.json'), lines({source, fields: DDT_SUPPORT_FIELDS}, 'towers', await towers(dir, {}, ddtSupportValue)));
 if (process.argv.includes('--ddt-support')) {
  await writeDdtSupport();
  console.log(`Wrote towers-ddt-support.json from ${source}`);
  process.exit(0);
 }
 if (process.argv.includes('--ddt')) {
  await writeDdt();
  console.log(`Wrote towers-ddt.json from ${source}`);
  process.exit(0);
 }
 if (process.argv.includes('--camo-timing')) {
  const timing = {};
  for (let r = 1; r <= 100; r++) { const t = camoTiming(JSON.parse(await readFile(join(dir, 'Rounds/DefaultRoundSet', `${r}.json`), 'utf8')).groups); if (t) timing[r] = t; }
  await writeFile(join(here, 'camo-timing.json'), lines({source, round_set: 'DefaultRoundSet', fields: ['start', 'end']}, 'rounds', timing));
  console.log(`Wrote camo-timing.json from ${source}`);
  process.exit(0);
 }
 if (process.argv.includes('--candidate')) {
  const extras = {};
  for (let r = 1; r <= 100; r++) extras[r] = roundExtras(JSON.parse(await readFile(join(dir, 'Rounds/DefaultRoundSet', `${r}.json`), 'utf8')).groups);
  await writeFile(join(here, 'rounds-candidate.json'), lines({source, round_set: 'DefaultRoundSet', fields: ['camo_rbe', 'camo_peak', 'purple', 'purple_peak']}, 'rounds', extras));
  await writeFile(join(here, 'towers-candidate.json'), lines({source, pierce_cap: PIERCE_CAP, ring_share: RING_SHARE, fields: ['pops_per_second', 'lead', 'camo', 'range', 'moab_dps', 'camo_lead', 'purple']}, 'towers', await towers(dir, {purple: true})));
  console.log(`Wrote rounds-candidate.json and towers-candidate.json from ${source}`);
  process.exit(0);
 }
 await writeFile(join(here, 'rounds.json'), lines({source, round_set: 'DefaultRoundSet'}, 'rounds', await rounds(dir)));
 await writeFile(join(here, 'towers.json'), lines({source, pierce_cap: PIERCE_CAP, ring_share: RING_SHARE, fields: ['pops_per_second', 'lead', 'camo', 'range', 'moab_dps', 'camo_lead']}, 'towers', await towers(dir)));
 await writeDdt();
 await writeDdtSupport();
 console.log(`Wrote rounds.json, towers.json, towers-ddt.json and towers-ddt-support.json from ${source}`);
}
