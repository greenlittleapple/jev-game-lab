import TOWER_DATA from './data/towers.json' with {type: 'json'};
import FROZEN_V4 from './data/towers-v4.json' with {type: 'json'};
import CANDIDATE from './data/towers-candidate.json' with {type: 'json'};
import {createHash} from 'node:crypto';

// What each base tower (no upgrades) can do, for the btd6-jev-v1 rules and questions (btd6-jev-v2 reads
// data/towers.json first and falls back to this table for towers missing there).
//   damage: pops bloons at all (Banana Farm and Monkey Village don't)
//   lead:   pops Lead bloons
//   camo:   can target and pop Camo bloons
// true or false only where the base tower's behaviour is well established; null means unknown, and
// towers missing from the table are unknown on every field. Upgrades change these (for example the
// Sniper's Full Metal Jacket pops lead, a Monkey Village upgrade grants camo detection) and are not
// modelled. v1 uses this table as is. data/towers.json (game data 56.0, used by v2) differs on two
// entries: the base Wizard Monkey's attack there is immune to Lead, and the base Glue Gunner pops nothing.
export const BASE_TOWERS = {
 Quincy: {damage: true, lead: false, camo: false},
 DartMonkey: {damage: true, lead: false, camo: false},
 BoomerangMonkey: {damage: true, lead: false, camo: false},
 BombShooter: {damage: true, lead: true, camo: false},
 TackShooter: {damage: true, lead: false, camo: false},
 IceMonkey: {damage: true, lead: null, camo: false},
 GlueGunner: {damage: true, lead: null, camo: false},
 Desperado: {damage: true, lead: null, camo: null},
 SniperMonkey: {damage: true, lead: false, camo: false},
 MonkeySub: {damage: true, lead: false, camo: null},
 MonkeyBuccaneer: {damage: true, lead: false, camo: false},
 MonkeyAce: {damage: true, lead: false, camo: null},
 HeliPilot: {damage: true, lead: false, camo: false},
 MortarMonkey: {damage: true, lead: true, camo: null},
 DartlingGunner: {damage: true, lead: false, camo: null},
 WizardMonkey: {damage: true, lead: true, camo: false},
 SuperMonkey: {damage: true, lead: false, camo: false},
 NinjaMonkey: {damage: true, lead: false, camo: true},
 Alchemist: {damage: true, lead: null, camo: false},
 Druid: {damage: true, lead: false, camo: false},
 Mermonkey: {damage: true, lead: null, camo: null},
 BananaFarm: {damage: false, lead: false, camo: false},
 SpikeFactory: {damage: true, lead: false, camo: true},
 MonkeyVillage: {damage: false, lead: false, camo: false},
 EngineerMonkey: {damage: true, lead: false, camo: false},
 BeastHandler: {damage: true, lead: null, camo: null},
 // From the game data export (56.0): the base Skywarden's darts are immune to Lead and filtered from Camo.
 Skywarden: {damage: true, lead: false, camo: false},
 // The Sheriff is the Frontier Legends hero (hero tower set, cost 0, no upgrades) with 11 swappable weapons;
 // the export doesn't say which is equipped. All 11 damage bloons and none targets Camo; 9 pop Lead and 2
 // don't, so lead is unknown. It has no entry in data/towers.json.
 Sheriff: {damage: true, lead: null, camo: false},
};

const UNKNOWN = {damage: null, lead: null, camo: null};
export const towerFacts = id => BASE_TOWERS[id] ?? UNKNOWN;

// The threats a base tower is known to handle, or null when the tower isn't in the table.
export function answers(id) {
 if (!(id in BASE_TOWERS)) return null;
 const f = BASE_TOWERS[id];
 return ['lead', 'camo'].filter(k => f[k] === true);
}

// How a base tower's attack meets the track, for policy btd6-jev-v3's reach factor (estimate.mjs):
//   radial: fires in fixed directions around itself whatever the bloons do (the Tack Shooter's 8 tacks),
//           so only the tacks flying toward the track can hit;
//   global: attacks are not limited to the range circle in data/towers.json (the Sniper shoots anywhere;
//           the Ace flies a pattern over the map), so they are treated as reaching the whole track;
//   point: the attack goes where a player-set point or the cursor says (Dartling, Mortar, Heli). aim.mjs
//           says whether the tower is aimed and where; unaimed, it counts for nothing.
// Towers not listed aim at bloons inside their range.
export const AIM = {
 TackShooter: 'radial', SniperMonkey: 'global', MonkeyAce: 'global',
 MortarMonkey: 'point', HeliPilot: 'point', DartlingGunner: 'point',
};
export const aimOf = id => AIM[id] ?? 'aimed';

// Measured share of a global tower's table rate that pops bloons on the track (estimate.mjs reachFactor). The Monkey
// Ace flies a fixed pattern and fires at what lies under it, so most of its shots miss the track: in the run logs of
// bridge 0.3.13 and later its measured pops were a median 0.04 of est_reach over 637 tower-rounds that cleared and
// 0.05 over 12 in rounds that lost lives (90th percentile 0.11 and 0.12), where the defence had bloons to spare. 0.1
// is at the top of that range. Before this (policies btd6-jev-v6 revision 2, btd6-playbook-v5 revision 6,
// btd6-claude-v1 revision 5 and earlier) the factor was 1. The Sniper, also global, measured above its table rate
// (median 2.1) and is left at 1.
export const GLOBAL_SHARE = {MonkeyAce: 0.1};
export const globalShare = id => GLOBAL_SHARE[id] ?? 1;

// data/towers.json's content version: the first 12 hex digits of the SHA-256 of its parsed content (so line
// endings don't change it). Recorded in run_start, since the estimates change when the table does.
const versionOf = table => createHash('sha256').update(JSON.stringify(table)).digest('hex').slice(0, 12);
export const TOWER_DATA_VERSION = versionOf(TOWER_DATA);
// The table the estimates read (estimate.mjs towerEstimate), set once per session like the calibrations:
//  - 'current': data/towers.json, a hero's level from its first tier (the state carries Quincy 7 as [7, 0, 0]).
//  - 'v4': data/towers-v4.json, the table from before EmitOnDamageModel projectiles were counted (Sniper shrapnel,
//    Desperado), with a hero's level from its level or name only, as before. btd6-jev-v4 is the frozen baseline,
//    so its sessions use this one (session.mjs); every other policy uses 'current'.
export const TOWER_TABLES = {current: {data: TOWER_DATA, version: TOWER_DATA_VERSION, heroTiers: true}, v4: {data: FROZEN_V4, version: versionOf(FROZEN_V4), heroTiers: false},
 // For the studies only (pops-study.mjs, no session sets it): towers-candidate.json (generate.mjs --candidate).
 candidate: {data: CANDIDATE, version: versionOf(CANDIDATE), heroTiers: true}};
let activeTable = 'current';
export function setTowerTable(name = 'current') {
 if (!Object.hasOwn(TOWER_TABLES, name)) throw Error(`No tower table ${name}; the tables are ${Object.keys(TOWER_TABLES).join(', ')}.`);
 activeTable = name;
}
export const towerTable = () => ({name: activeTable, ...TOWER_TABLES[activeTable]});
export const towerDataInfo = () => ({source: TOWER_TABLES[activeTable].data.source, version: TOWER_TABLES[activeTable].version, ...(activeTable === 'current' ? {} : {table: activeTable})});

// The catalog's non-hero towers that data/towers.json has no entry for. Every estimate would count such a
// tower as 0 (pops, MOAB damage, camo, lead, coverage), so the runner leaves them out of the candidates in
// every policy and records them in run_start as no_data. Heroes are not listed: Quincy has levels in the
// table, and the benchmark uses no other hero.
export const missingTowerData = (catalog, towers = TOWER_DATA.towers) =>
 catalog.filter(t => !t.is_hero && !Object.hasOwn(towers, t.id)).map(t => t.id);
