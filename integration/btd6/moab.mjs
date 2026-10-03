// MOAB readiness for policy btd6-jev-v4 (docs/ARCHITECTURE.md, "Policy btd6-jev-v4"): the damage per second
// the towers deal to one MOAB-class bloon, against what the next MOAB-class round needs.
//
// A MOAB-class bloon has one shell that only single hits wear down: the pops estimate (estimate.mjs) counts
// pierce and splash, which don't help against it. The check here asks whether the towers kill each
// MOAB-class bloon, and the MOAB-class bloons inside it, before the exit (KILL_BY). What the last shell
// releases (four Ceramics from a MOAB) is left to the pops estimate.
//  - Tower damage: towers.json's moab_dps (data/generate.mjs: damage per projectile with its bonus for the
//    "Moabs" tag, one hit per projectile, / attack interval), times the share of the first POP_BY of the
//    track the tower reaches (1 for towers that reach the whole track, towers.mjs AIM; for the Dartling,
//    Mortar and Heli, 0 while unaimed and the track around their aim point once aimed, aim.mjs).
//  - Calibration: moabDps is that estimate times a factor per setup (moab-calibration.mjs), set once per
//    session with setMoabCalibration. The first live strategist match cleared MOAB-class rounds with the
//    estimate far below what they need, so the factor corrects a known underestimate. moabDpsRaw is the
//    estimate without it, for measuring the factor.
//  - Needed: the health of the round's toughest MOAB-class bloon (with the MOAB-class bloons it releases)
//    over the time it takes to cross the whole track (KILL_BY) at its speed, times the margin for the lives
//    left (estimate.mjs margin). There is no term for the round's total MOAB-class health: the damage figure
//    is for one bloon, while splash and several towers hit the group, and that term fired in rounds cleared
//    with nothing lost (moab-replay.mjs; docs/PLAN.md). The bloons inside count at the outer bloon's speed:
//    counting them at their own speed, one after another, asks 333 for the round-80 ZOMG, which a live match
//    cleared at about 150 (splash hits the released bloons together). Until 2026-09-30 the window was the
//    first half of the track, the result was also divided by estimate.mjs EFFICIENCY (0.8) (about 2.9
//    times the rate to kill before the exit), and a total-health term could set it; the calibration factor
//    already corrects the damage side, and logged rounds were cleared well below both (moab-replay.mjs).
// Health is the base health (data/generate.mjs BLOONS; Fortified doubles the shell). Hard adds no health
// multiplier in the game data (Mods/Hard.json changes cash, lives, costs, speed and the rounds only).
// Rounds 81 and later make MOAB-class bloons tougher; that isn't modelled, so their health is a lower bound.
// DDT-capable damage (btd6-jev-v6 revision 13, btd6-playbook-v5 revision 17, btd6-claude-v1 revision 16; setDdtCheck): a DDT
// is Camo, Lead and Black, so it takes the MOAB damage of the towers that can hit it only (hitsDdt, data/towers-ddt.json:
// an attack that sees camo with damage that pops Lead and Black). A DDT, and the DDTs inside a BAD, count at that damage;
// the rest of a bloon at every tower's. The check still takes the toughest need: the bloon with the highest need for
// its own damage figure. Series 1g match 2 (CHIMPS, revision 11) measured 116 per second on round 90's DDTs against an
// estimate of 110 that counted every tower, while the MOAB rounds around it measured 172 to 246; it lost at round 93 to
// camo DDTs. Earlier revisions and btd6-jev-v4 count every tower's damage (setDdtCheck(false), the default).
// Deadline-based need in rounds with DDTs (btd6-jev-v6 revision 20, btd6-playbook-v5 revision 24, btd6-claude-v1 revision 23;
// setDdtNeed): each MOAB-class bloon must die within its kill window (windowSeconds at its speed) after it spawns. Spawns come
// from rounds.json moab_groups (data/generate.mjs; a group's bloons spread evenly from its start to its end; moabSpawns). For
// every interval [a, b] from one bloon's spawn a to another's deadline b (its spawn plus its window), b > a, the demand is the
// health of the bloons that spawn at or after a and fall due by b, kept as a DDT part and the rest (moabDeadlines); the need is
// that demand over b - a, times the lives margin. With the DDT check the figure is blendedDps of the two parts (all of it when
// there is no DDT part), and the toughest interval has the highest need for its figure (ties: the higher need). One bloon on its
// own gives the per-bloon need, so the need is never lower than the per-bloon one. Before the margin: round 90 about 217 (3
// camo DDTs in 1.5 s; per bloon 66), round 93 about 398, round 95 about 500 for its 30 DDTs over 20 s with its 50 Fortified
// MOABs. Rounds without DDTs (and so Hard Standard, which ends at round 80), a DDT round without timing, earlier revisions and
// btd6-jev-v4 keep the per-bloon need (setDdtNeed(false), the default). The same revisions turn on the support-effects DDT figure
// (setDdtSupport, DDT_SUPPORT_FROM), so the need sits on a figure that tracks measured DDT damage (docs/PLAN.md).
import DDT_DATA from './data/towers-ddt.json' with {type: 'json'};
import DDT_SUPPORT from './data/towers-ddt-support.json' with {type: 'json'};
import {roundFacts, towerEstimate, margin, heroLevel} from './estimate.mjs';
import {BLOONS, parseBloon} from './data/generate.mjs';
import {aimOf} from './towers.mjs';
import {aimStatus} from './aim.mjs';
import {reach, pathLength, coverage} from './spots.mjs';

// Share of the track, from the entrance, over which a tower's MOAB damage counts (towerMoab). The calibration
// factor (moab-calibration.mjs) is measured against this figure, so it stays at the first half.
export const POP_BY = 0.5;
// Share of the track by which the requirement has each MOAB-class bloon and those inside it dead: the exit.
export const KILL_BY = 1;
// A MOAB's speed on Hard, in map units per second of game time. Measured once live (bridge 0.3.7, run of
// 2026-09-30 05:48 UTC, round 40 at speed 3): the MOAB's progress went from 0.616 to 0.832 of Monkey
// Meadow's 1,276-unit track in 1.15 s of real time, which is about 80 units per second of game time and
// 16 s for the whole track. One reading; not checked on other maps or difficulties.
export const MOAB_SPEED = 80;
// Speed relative to a MOAB (MOAB 1, BFB 0.25, ZOMG 0.18, DDT 2.64, BAD 0.18).
export const RELATIVE_SPEED = {Moab: 1, Bfb: 0.25, Zomg: 0.18, Ddt: 2.64, Bad: 0.18};
// Monkey Meadow's track length (fixtures/monkey-meadow.json), used when no map paths are known.
export const DEFAULT_TRACK_LENGTH = 1276;
// Rounds before a MOAB-class round from which the v4 floor requires MOAB damage.
export const MOAB_LEAD_ROUNDS = 4;
// Rounds before a round with DDTs (a DDT, or the DDTs inside a BAD) from which moab_short requires DDT-capable damage
// (btd6-jev-v6 revision 17, btd6-playbook-v5 revision 21, btd6-claude-v1 revision 20; setMoabDdtLead). The round-90 losses
// of CHIMPS series 1h (DDT-capable figure 0.14 to 0.31 of the need at round 89) had nothing affordable that hit DDTs in the
// last rounds before it; MOAB rounds without DDTs keep MOAB_LEAD_ROUNDS.
export const MOAB_DDT_LEAD_ROUNDS = 10;

const LABEL = {Moab: 'MOAB', Bfb: 'BFB', Zomg: 'ZOMG', Ddt: 'DDT', Bad: 'BAD'};
export const isMoabClass = base => base in RELATIVE_SPEED;
// Health of a MOAB-class bloon's shell and of the MOAB-class bloons inside it (not the Ceramics).
function moabHealth(base, fortified = false) {
 const [hp, children] = BLOONS[base];
 return (fortified ? hp * 2 : hp) + children.filter(isMoabClass).reduce((n, c) => n + moabHealth(c), 0);
}
// Health of the MOAB-class bloons inside one (a BFB's four MOABs: 800), which have to be popped after its shell.
export const innerMoabHealth = base => moabHealth(base) - BLOONS[base][0];
// Health of the DDTs inside one (a BAD's three: 1,200).
export const innerDdtHealth = base => BLOONS[base][1].filter(isMoabClass).reduce((n, c) => n + (c === 'Ddt' ? moabHealth(c) : innerDdtHealth(c)), 0);
// The DDT part of a moabBloons entry's health: all of a DDT's, the inner DDTs' for the rest.
const ddtPart = b => b.base === 'Ddt' ? b.hp : innerDdtHealth(b.base);
// The MOAB-class bloons a round sends: [{name, base, count, hp, speed}].
export function moabBloons(round) {
 return Object.entries(roundFacts(round)?.bloons ?? {}).map(([name, count]) => ({name, count, ...parseBloon(name)}))
  .filter(b => isMoabClass(b.base)).map(b => ({name: b.name, base: b.base, count: b.count, hp: moabHealth(b.base, b.fortified), speed: RELATIVE_SPEED[b.base]}));
}
// e.g. "2 MOAB, 1 Fortified MOAB"
export const moabList = round => moabBloons(round).map(b => `${b.count} ${b.name.includes('Fortified') ? 'Fortified ' : ''}${LABEL[b.base]}`).join(', ');

// The first round from `from` to `end` that sends MOAB-class bloons, or null.
export function nextMoabRound(from, end = 100) {
 for (let r = Math.max(1, from); r <= end; r++) if (moabBloons(r).length) return r;
 return null;
}

export const trackLength = paths => paths.length ? paths.reduce((n, p) => n + pathLength(p), 0) : DEFAULT_TRACK_LENGTH;
// Share of the first POP_BY of the track a tower reaches with this range (1 without paths: unknown).
// A point tower (aim.mjs) counts 0 while unaimed, and once aimed the first POP_BY of the track within its aim
// radius of the point (a Heli on Pursuit: 1).
export function earlyShare(t, range, paths) {
 const status = aimStatus(t, paths);
 if (status.kind === 'unaimed') return 0;
 if (!paths.length || status.kind === 'global' || aimOf(t.base_id) === 'global') return 1;
 const center = status.kind === 'point' ? status.point : t;
 if (status.kind === 'point') range = status.radius;
 if (!(range > 0) || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return 0;
 const r = reach(center, range, paths, {lateFrom: POP_BY});
 const total = trackLength(paths), late = r.late * total * (1 - POP_BY);
 return Math.max(0, Math.min(1, (r.length - late) / (total * POP_BY)));
}
// earlyShare by paths list, then tower and range: the track geometry is most of moabCheck's time, and the replays and the
// MOAB gains ask it for the same towers many times. Only for a paths list with track (the default [] is new each call).
const shareCache = new WeakMap();
function cachedShare(t, range, paths) {
 if (!paths.length) return earlyShare(t, range, paths);
 let byTower = shareCache.get(paths);
 if (!byTower || byTower.size > 20000) shareCache.set(paths, byTower = new Map());
 const key = `${JSON.stringify(t)}|${range}`;
 if (!byTower.has(key)) byTower.set(key, earlyShare(t, range, paths));
 return byTower.get(key);
}
// One tower's MOAB damage per second over the first POP_BY of the track: {dps, share, effective}.
export function towerMoab(t, paths = []) {
 const e = towerEstimate(t);
 if (!e || !(e.moab > 0)) return {dps: 0, share: 0, effective: 0};
 const share = cachedShare(t, e.range, paths);
 return {dps: e.moab, share: +share.toFixed(3), effective: +(e.moab * share).toFixed(2)};
}
// Whether a tower can hit a DDT (data/towers-ddt.json); false for a tower or tiers the table doesn't have, which also
// have no MOAB damage in towers.json.
export function hitsDdt(t) {
 const row = DDT_DATA.towers[t.base_id]?.[t.is_hero || t.base_id === 'Quincy' ? heroLevel(t) : (t.tiers ?? [0, 0, 0]).join('')];
 return row?.[0] === 1;
}
// DDT-capable damage with support effects (setDdtSupport; default off, on from btd6-jev-v6 revision 20). data/towers-ddt-support.json
// (data/generate.mjs ddtSupportValue) gives each tower's facts. With it on, a tower counts against a DDT when it:
//  - hits a camo DDT on its own (hitsDdt, or the support table's camo_pops, which adds the Wizard's OverrideCamoDetectionModel:
//    Wizard x-x-4 and x-x-5); or
//  - is under an MIB (Monkey Village x-3-x and up) whose support radius covers its position and has an attack that sees camo
//    with any MOAB damage (camo_hits); or
//  - pops Lead and Black (pops, or hits under an MIB) and sees the DDT through a Radar Scanner (Monkey Village x-2-x and up)
//    covering its position, or through a camo remover active upstream (ddtSupport, decamoSpan).
// A support covers a tower when the distance between them is at most the support radius (the village's range); a village
// doesn't cover itself. A camo remover is active with decamo 1, or 2 under an MIB. Its coverage of the track: its radius around
// the tower (range; submerge only while the tower targets Submerge), around its aim point (point: aim.mjs aimStatus; an
// Engineer's Cleansing Foam has no aim the runner sets, so it counts only once the state carries a target_point). The camo is gone from where its coverage begins (coverage().from) if that is within the first KILL_BY of
// the track. A tower sees decamoed DDTs when that start is at or before the start of its own coverage (its range around it, or
// its aim radius around its point), or when it reaches the whole track (global towers). Without map paths every active remover
// counts. The Skywarden 4-x-x camo-block zone (decamo_kind "zone") isn't a remover: CHIMPS matches with Skywardens and no Shimmer
// logged only "DdtCamo" in their DDT moab_measure types, while every match with a Shimmer Wizard logged decamoed "Ddt".
// Each tower's share is earlyShare as before.
// Not modelled: the Mermonkey's Trance Totem (x-x-4 and up; a subtower), the Engineer's foam sentries (subtowers),
// the Sub's Advanced Intel (FilterInvisibleSubIntelModel), abilities (ActivateVisibilitySupportZoneModel, ChangeDamageTypeModel,
// ActivateDamageModifierSupportZoneModel), heroes other than Quincy, other villages' buffs (range, rate, the x-0-x damage
// modifiers), whether a decamoed DDT's children regain camo, and the time a remover takes to reach each DDT (a remover is
// taken to strip every DDT at its coverage start).
const SUPPORT_FIELDS = DDT_SUPPORT.fields;
export function ddtSupportRow(t) {
 const row = DDT_SUPPORT.towers[t.base_id]?.[t.is_hero || t.base_id === 'Quincy' ? heroLevel(t) : (t.tiers ?? [0, 0, 0]).join('')];
 return row ? Object.fromEntries(SUPPORT_FIELDS.map((f, i) => [f, row[i]])) : null;
}
const at = t => Number.isFinite(t?.x) && Number.isFinite(t?.y);
const covers = (village, radius, t) => village !== t && village.id !== t.id && (radius < 0 || (at(village) && at(t) && Math.hypot(village.x - t.x, village.y - t.y) <= radius));
// A tower's coverage of the track for the support figure: {from, to} (progress 0 to 1), {global: true}, or null (none).
function towerSpan(t, paths) {
 const status = aimStatus(t, paths);
 if (status.kind === 'unaimed') return null;
 if (!paths.length || status.kind === 'global' || aimOf(t.base_id) === 'global') return {global: true};
 const center = status.kind === 'point' ? status.point : t, range = status.kind === 'point' ? status.radius : towerEstimate(t)?.range;
 if (!(range > 0) || !at(center)) return null;
 const c = coverage(center, range, paths);
 return c.from == null ? null : {from: c.from, to: c.to};
}
// A camo remover's coverage: {from, to}, {global: true} without paths, or null.
function decamoSpan(t, row, paths) {
 if (row.decamo_kind === 'submerge' && 'targeting' in t && t.targeting !== 'Submerge') return null;
 if (!paths.length) return {global: true};
 let center = t;
 if (row.decamo_kind === 'point') {
  const status = aimStatus(t, paths);
  center = status.kind === 'point' ? status.point : t.target_point;
 }
 if (!at(center) || !(row.decamo_radius > 0)) return null;
 const c = coverage(center, row.decamo_radius, paths);
 return c.from == null || c.from > KILL_BY ? null : {from: c.from, to: c.to};
}
// Per tower id, whether it counts against a DDT with support effects and through what: Map id -> {counts, via: [strings]}.
// via: 'own', 'mib:<village id>', 'radar:<village id>', 'decamo:<remover id>'.
export function ddtSupport(towers, paths = []) {
 const rows = new Map(towers.map(t => [t, ddtSupportRow(t)]));
 const villages = kind => towers.filter(v => rows.get(v)?.[kind]);
 const under = (kind, t) => villages(kind).filter(v => covers(v, rows.get(v).support_radius, t));
 const mibOf = new Map(towers.map(t => [t, under('mib', t)]));
 const removers = towers.map(r => ({r, row: rows.get(r)})).filter(({r, row}) => row && row.decamo_kind !== 'zone' && (row.decamo === 1 || (row.decamo === 2 && mibOf.get(r).length)))
  .map(({r, row}) => ({r, span: decamoSpan(r, row, paths)})).filter(x => x.span);
 const out = new Map();
 for (const t of towers) {
  const row = rows.get(t), mib = mibOf.get(t), via = [];
  if (hitsDdt(t) || row?.camo_pops) via.push('own');
  else if (row) {
   const pops = row.pops || (mib.length && row.hits);
   if (mib.length && row.camo_hits) via.push(...mib.map(v => `mib:${v.id}`));
   else if (pops) {
    const radar = under('radar', t);
    if (radar.length) via.push(...radar.map(v => `radar:${v.id}`));
    else {
     const span = towerSpan(t, paths);
     const seen = span && removers.filter(({span: s}) => span.global || s.global || s.from <= span.from);
     if (seen?.length) via.push(...seen.map(({r}) => `decamo:${r.id}`));
    }
    if (via.length && !row.pops) via.push(...mib.map(v => `mib:${v.id}`));
   }
  }
  out.set(t.id ?? t, {counts: via.length > 0, via});
 }
 return out;
}
let ddtSupportOn_ = false;
// Support effects in the DDT-capable figure, set once per session like setDdtCheck: on for the policies and revisions in
// DDT_SUPPORT_FROM (session.mjs, dashboard.mjs). Off by default.
export const DDT_SUPPORT_FROM = {'btd6-jev-v6': 20, 'btd6-playbook-v5': 24, 'btd6-claude-v1': 23};
export function setDdtSupport(on = false) { ddtSupportOn_ = !!on; }
export const ddtSupportOn = () => ddtSupportOn_;
export const ddtSupportFor = (policy, revision = null) => Object.hasOwn(DDT_SUPPORT_FROM, policy) && (revision == null || revision >= DDT_SUPPORT_FROM[policy]);
// ddt: only the towers that can hit a DDT (support, default setDdtSupport: with support effects).
export function moabDpsRaw(towers, paths = [], {ddt = false, support = ddtSupportOn_} = {}) {
 const sup = ddt && support ? ddtSupport(towers, paths) : null;
 return +towers.filter(t => !ddt || (sup ? sup.get(t.id ?? t).counts : hitsDdt(t))).reduce((n, t) => n + towerMoab(t, paths).effective, 0).toFixed(1);
}
// The whole-track table figure (no reach share), for the calibration log.
export const moabDpsTable = towers => +towers.reduce((n, t) => n + (towerEstimate(t)?.moab ?? 0), 0).toFixed(1);
let calibration = 1;
// The factor applied to every MOAB damage estimate in this process (1 by default; the session sets it).
export function setMoabCalibration(factor = 1) {
 if (!(factor > 0 && factor <= 10)) throw Error('The MOAB calibration factor must be above 0 and at most 10.');
 calibration = factor;
}
export const moabCalibration = () => calibration;
export const moabDps = (towers, paths = [], {ddt = false, support = ddtSupportOn_} = {}) => +(moabDpsRaw(towers, paths, {ddt, support}) * calibration).toFixed(1);
let ddtCheck = false;
// DDT-capable damage in moabCheck and the figures that read it (speed.mjs moabOutrun, policy-v4.mjs withMoab), set once
// per session like the calibration: on for the policies and revisions in DDT_CHECK_FROM (session.mjs, dashboard.mjs).
export const DDT_CHECK_FROM = {'btd6-jev-v6': 13, 'btd6-playbook-v5': 17, 'btd6-claude-v1': 16};
export function setDdtCheck(on = false) { ddtCheck = !!on; }
export const ddtCheckOn = () => ddtCheck;
// Whether a policy uses it: at the current code (revision null) or from its first revision.
export const ddtCheckFor = (policy, revision = null) => Object.hasOwn(DDT_CHECK_FROM, policy) && (revision == null || revision >= DDT_CHECK_FROM[policy]);
let ddtLead = MOAB_LEAD_ROUNDS;
// moabDue's lead for rounds with DDTs (MOAB_DDT_LEAD_ROUNDS from the revisions in MOAB_DDT_LEAD_FROM, MOAB_LEAD_ROUNDS before
// them and for btd6-jev-v4), set once per session like the DDT check (session.mjs, dashboard.mjs). The graded speed's
// moab_short signal keeps MOAB_LEAD_ROUNDS (session.mjs, dashboard.mjs pass ddtLead), so the speed isn't held down for the
// 10 rounds before each DDT round.
export const MOAB_DDT_LEAD_FROM = {'btd6-jev-v6': 17, 'btd6-playbook-v5': 21, 'btd6-claude-v1': 20};
export function setMoabDdtLead(rounds = MOAB_LEAD_ROUNDS) { ddtLead = rounds; }
export const moabDdtLead = () => ddtLead;
export const moabDdtLeadFor = (policy, revision = null) => Object.hasOwn(MOAB_DDT_LEAD_FROM, policy) && (revision == null || revision >= MOAB_DDT_LEAD_FROM[policy]) ? MOAB_DDT_LEAD_ROUNDS : MOAB_LEAD_ROUNDS;
// Whether a round has DDTs (a DDT, or the DDTs inside a BAD).
export const hasDdtRound = round => moabBloons(round).some(b => ddtPart(b) > 0);
// Damage per second against a bloon with `all` health that the towers' whole figure (dps) pops and `ddt` that only the
// DDT-capable figure (ddtDps) pops; 0 when a part with health has no damage.
export function blendedDps(all, ddt, dps, ddtDps) {
 if ((all > 0 && !(dps > 0)) || (ddt > 0 && !(ddtDps > 0))) return 0;
 const seconds = (all > 0 ? all / dps : 0) + (ddt > 0 ? ddt / ddtDps : 0);
 return seconds > 0 ? (all + ddt) / seconds : dps;
}

// Seconds a bloon of this relative speed takes to cross the first KILL_BY of the track.
export const windowSeconds = (speed, paths = []) => KILL_BY * trackLength(paths) / (MOAB_SPEED * speed);

let ddtNeed = false;
// The deadline-based need in rounds with DDTs (header), set once per session like the DDT check: on for the policies and
// revisions in DDT_NEED_FROM (session.mjs, dashboard.mjs).
export const DDT_NEED_FROM = {'btd6-jev-v6': 20, 'btd6-playbook-v5': 24, 'btd6-claude-v1': 23};
export function setDdtNeed(on = false) { ddtNeed = !!on; }
export const ddtNeedOn = () => ddtNeed;
export const ddtNeedFor = (policy, revision = null) => Object.hasOwn(DDT_NEED_FROM, policy) && (revision == null || revision >= DDT_NEED_FROM[policy]);
// Each MOAB-class bloon a round sends, from rounds.json moab_groups: [{t, window, hp, ddt}] (t: its spawn in seconds from the
// round start, window: its windowSeconds, hp: its health as moabHealth, ddt: its DDT part), or null when the round has no timing.
export function moabSpawns(round, paths = []) {
 const groups = roundFacts(round)?.moab_groups;
 if (!groups?.length) return null;
 const out = [];
 for (const [name, count, start, end] of groups) {
  const b = parseBloon(name);
  if (!isMoabClass(b.base)) continue;
  const hp = moabHealth(b.base, b.fortified), window = windowSeconds(RELATIVE_SPEED[b.base], paths), ddt = ddtPart({base: b.base, hp});
  for (let i = 0; i < count; i++) out.push({t: start + (count > 1 ? (end - start) * i / (count - 1) : 0), window, hp, ddt});
 }
 return out.length ? out : null;
}
// The intervals that could set a round's deadline need, from its spawns: [{seconds, other, ddt, count, top}]. Each runs from a
// spawn a to a deadline b (a spawn's t plus its window), b > a, and holds the spawns with t >= a and t + window <= b (other:
// their non-DDT health, ddt: their DDT health, count, top: the largest one's health). An interval that another as short or
// shorter with at least as much of both parts dominates is left out. null for no spawns.
export function deadlinesOf(spawns) {
 if (!spawns?.length) return null;
 const starts = [...new Set(spawns.map(s => s.t))];
 const ends = [...new Map(spawns.map(s => [s.t + "|" + s.window, s])).values()];
 const all = [];
 for (const a of starts) for (const e of ends) {
  // The length as (e.t - a) + e.window, so a bloon's own interval is exactly its window.
  const seconds = (e.t - a) + e.window;
  if (!(seconds > 0)) continue;
  const due = e.t + e.window;
  let other = 0, ddt = 0, count = 0, top = 0;
  for (const s of spawns) if (s.t >= a && ((s.t === e.t && s.window === e.window) || s.t + s.window <= due)) { other += s.hp - s.ddt; ddt += s.ddt; count++; top = Math.max(top, s.hp); }
  if (count) all.push({seconds, other, ddt, count, top});
 }
 all.sort((x, y) => x.seconds - y.seconds || (y.other + y.ddt) - (x.other + x.ddt));
 const out = [];
 for (const c of all) if (!out.some(k => k.seconds <= c.seconds && k.other >= c.other && k.ddt >= c.ddt)) out.push(c);
 return out;
}
const deadlineCache = new Map();
// deadlinesOf a round's spawns, cached per round and track length (null without timing).
export function moabDeadlines(round, paths = []) {
 const key = round + ":" + trackLength(paths);
 if (!deadlineCache.has(key)) deadlineCache.set(key, deadlinesOf(moabSpawns(round, paths)));
 return deadlineCache.get(key);
}

// The defence against one round's MOAB-class bloons, or null when the round has none. The toughest bloon is the one
// with the highest need for its damage figure (ties: the higher need); dps is that figure. ddt (default: setDdtCheck):
// DDTs count at the DDT-capable damage, and the record adds ddt_dps and all_dps (every tower's) in a round with DDTs.
// need (default: setDdtNeed): in a round with DDTs and timing, the deadline-based need (header); the record then adds count
// (bloons in the toughest interval) and hp_window (their health), seconds is the interval's length and hp_each its largest
// bloon's health.
export function moabCheck(towers, round, {lives = 1, paths = [], ddt = ddtCheck, need = ddtNeed} = {}) {
 const list = moabBloons(round);
 if (!list.length) return null;
 const all = moabDps(towers, paths);
 const hasDdt = ddt && list.some(b => ddtPart(b) > 0);
 const ddtDps = hasDdt ? moabDps(towers, paths, {ddt: true}) : all;
 const deadlines = need && hasDdtRound(round) ? moabDeadlines(round, paths) : null;
 if (deadlines?.length) {
  const each = deadlines.map(c => {
   const hp = c.other + c.ddt, n = hp / c.seconds;
   const dps = hasDdt && c.ddt > 0 ? +blendedDps(c.other, c.ddt, all, ddtDps).toFixed(1) : all;
   return {...c, hp, need: n, dps, per: dps > 0 ? n / dps : Infinity};
  });
  const toughest = each.reduce((a, b) => b.per > a.per || (b.per === a.per && b.need > a.need) ? b : a);
  const needs = +(toughest.need * margin(lives, round)).toFixed(1), dps = toughest.dps;
  return {round, bloons: moabList(round), hp: list.reduce((n, b) => n + b.hp * b.count, 0), hp_each: toughest.top, count: toughest.count,
   hp_window: toughest.hp, seconds: +toughest.seconds.toFixed(1), dps, needs_dps: needs, ratio: needs ? +(dps / needs).toFixed(2) : Infinity,
   enough: dps >= needs, ...(hasDdt ? {ddt_dps: ddtDps, all_dps: all} : {})};
 }
 const each = list.map(b => {
  const seconds = windowSeconds(b.speed, paths), part = hasDdt ? ddtPart(b) : 0;
  return {...b, seconds, need: b.hp / seconds, dps: part ? +blendedDps(b.hp - part, part, all, ddtDps).toFixed(1) : all};
 });
 const per = b => b.need / b.dps;
 const toughest = each.reduce((a, b) => per(b) > per(a) || (per(b) === per(a) && b.need > a.need) ? b : a);
 const hp = each.reduce((n, b) => n + b.hp * b.count, 0);
 const needs = +(toughest.need * margin(lives, round)).toFixed(1);
 const dps = toughest.dps;
 return {round, bloons: moabList(round), hp, hp_each: toughest.hp, seconds: +toughest.seconds.toFixed(1), dps, needs_dps: needs,
  ratio: needs ? +(dps / needs).toFixed(2) : Infinity, enough: dps >= needs, ...(hasDdt ? {ddt_dps: ddtDps, all_dps: all} : {})};
}

// The MOAB-class rounds within MOAB_LEAD_ROUNDS of `now` (inclusive), and rounds with DDTs within ddtLead (setMoabDdtLead
// by default), with their checks; the weakest first. ddt and need as for moabCheck.
export function moabDue(towers, now, {lives = 1, paths = [], end = 100, lead = MOAB_LEAD_ROUNDS, ddtLead: dl = ddtLead, ddt = ddtCheck, need = ddtNeed} = {}) {
 const out = [];
 for (let r = now; r <= Math.min(end, now + Math.max(lead, dl)); r++) {
  if (r > now + lead && !hasDdtRound(r)) continue;
  const c = moabCheck(towers, r, {lives, paths, ddt, need}); if (c) out.push(c);
 }
 return out.sort((a, b) => a.ratio - b.ratio);
}
