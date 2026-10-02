// Towers whose attack depends on a point the player sets, or on the mouse cursor, and how the runner aims
// them (bridge 0.3.12: set_targeting, set_target_point; the state's targeting, target_modes and
// target_point per tower).
//
// Target types from the game data (data/towers.json's source export, TowerModel.targetTypes; * = takes a point):
//  - DartlingGunner: Normal (fires toward the cursor, the game's default), Locked* (toward a set point);
//    tier 4-5 on the third path adds TargetIndependant. With nothing moving the mouse, Normal fires at
//    wherever the cursor sits.
//  - MortarMonkey: TargetSelectedPoint* only (the reticle). Its model has startWithClosestTrackPoint off, so
//    where the reticle starts is not a track point the runner chose.
//  - HeliPilot: FollowTouch (follows the cursor, the default), LockInPlace*, PatrolPoints*, and Pursuit
//    from tier 2 on the top path.
//  - MonkeyAce: Circle (default), FigureInfinite, FigureEight; Centered* from tier 2 on the bottom path. The
//    default circle flies over most of a small map, so the Ace is left as it is.
//  - SpikeFactory: Track (default) and, from tier 2 on the bottom path, TargetSelectedPoint* among others;
//    the default places spikes on the track by itself, so it is left as it is.
//  - Skywarden: First, Last, Close, Strong; from tier 2 on the middle path also TargetSelectedPoint*. First
//    stays the default and aims at bloons, so it needs no point or cursor and is left as it is.
//  - Sheriff (no data in towers.json, so never a candidate): First, Last, Close, Strong.
//  - Every other tower in the ruleset: First, Last, Close, Strong (plus Submerge, Elite and similar
//    specials that need no point).
// How the runner aims (runner.mjs, a forced step with no Jev call, after each placement or upgrade):
//  - Dartling: Locked, at the densest track point (aimPoint);
//  - Mortar: the reticle at the densest track point;
//  - Heli: Pursuit where the tower offers it, otherwise LockInPlace at the densest track point.
// The densest point: sampled along the track every SAMPLE_STEP units inside the playfield bounds, the one
// with the most track length within the tower's AIM radius (a Mortar's blast, a Dartling's spread, a Heli's
// range); ties go to the point nearest the tower, then the earliest along the track.
import {coverage, pathLength} from './spots.mjs';

export const POINT_TOWERS = {
 DartlingGunner: {modes: ['Locked'], cursor: 'Normal', radius: 12},
 MortarMonkey: {modes: ['TargetSelectedPoint'], radius: 12},
 HeliPilot: {modes: ['Pursuit', 'LockInPlace'], cursor: 'FollowTouch', radius: 22, global: ['Pursuit']},
};
// Modes that take a point (the game's isActionable target types for these towers).
export const POINT_MODES = ['Locked', 'TargetSelectedPoint', 'LockInPlace', 'PatrolPoints', 'Centered'];
export const isPointTower = id => id in POINT_TOWERS;
export const SAMPLE_STEP = 4;
// A point already this close to the chosen one counts as aimed.
export const AIM_TOLERANCE = 3;
const DEFAULT_BOUNDS = {minX: -140, maxX: 140, minY: -110, maxY: 110};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Points every `step` units along each path, with their progress (0 entrance, 1 exit), inside bounds.
export function trackSamples(paths, {step = SAMPLE_STEP, bounds = DEFAULT_BOUNDS} = {}) {
 const out = [];
 for (const path of paths) {
  const total = pathLength(path);
  if (!total) continue;
  let along = 0, next = 0;
  for (let i = 1; i < path.length; i++) {
   const a = path[i - 1], b = path[i], seg = dist(a, b);
   while (seg > 0 && next <= along + seg) {
    const t = (next - along) / seg, p = {x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y)};
    if (!bounds || (p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY))
     out.push({x: +p.x.toFixed(1), y: +p.y.toFixed(1), progress: next / total});
    next += step;
   }
   along += seg;
  }
 }
 return out;
}

// Track samples scored by the track length within `radius` (map units), densest first. Cached per paths
// array and radius, since the track doesn't change during a match.
const scoredCache = new WeakMap();
export function densePoints(paths, radius, options = {}) {
 const byRadius = scoredCache.get(paths) ?? new Map();
 scoredCache.set(paths, byRadius);
 const key = `${radius}|${options.step ?? SAMPLE_STEP}`;
 if (!byRadius.has(key)) {
  let total = 0;
  for (const p of paths) total += pathLength(p);
  byRadius.set(key, trackSamples(paths, options).map(p => ({...p, length: +(coverage(p, radius, paths).share * total).toFixed(1)}))
   .sort((a, b) => b.length - a.length || a.progress - b.progress));
 }
 return byRadius.get(key);
}

// The densest reachable track point for a tower at `from` ({x, y}; null: any), or null without paths.
// maxDistance: only points this close to the tower (null: any, as for the three towers here, whose target
// point isn't limited to their range).
export function aimPoint(paths, radius, {from = null, maxDistance = null, ...options} = {}) {
 if (!paths?.length) return null;
 const points = densePoints(paths, radius, options).filter(p => maxDistance == null || !from || dist(p, from) <= maxDistance);
 if (!points.length) return null;
 const best = points[0].length;
 // Lengths within half a unit count as ties (sampling noise).
 const ties = points.filter(p => p.length >= best - 0.5);
 const pick = from ? ties.reduce((a, b) => dist(b, from) < dist(a, from) - 1e-9 ? b : a) : ties[0];
 return {x: pick.x, y: pick.y, length: pick.length, progress: +pick.progress.toFixed(3)};
}

// What the runner sets for a placed tower: {mode, point} (point null for a mode without one), or null for a
// tower it doesn't aim, or when the bridge doesn't report the tower's modes (before 0.3.12).
export function aimTarget(t, paths) {
 const spec = POINT_TOWERS[t.base_id];
 if (!spec || !Array.isArray(t.target_modes)) return null;
 const mode = spec.modes.find(m => t.target_modes.includes(m));
 if (!mode) return null;
 if (!POINT_MODES.includes(mode)) return {mode, point: null};
 const point = aimPoint(paths, spec.radius, {from: t});
 return point ? {mode, point: {x: point.x, y: point.y}} : null;
}

// The next aiming command for a tower, or null when it is aimed (or can't be): set_targeting first, then
// set_target_point. Commands carry no expect (the runner adds it).
export function aimStep(t, paths) {
 const target = aimTarget(t, paths);
 if (!target) return null;
 if (t.targeting !== target.mode) return {action: 'set_targeting', tower_id: t.id, mode: target.mode, target};
 if (target.point && !(t.target_point && dist(t.target_point, target.point) <= AIM_TOLERANCE))
  return {action: 'set_target_point', tower_id: t.id, x: target.point.x, y: target.point.y, target};
 return null;
}

// How a tower's attack meets the track, for the estimates (estimate.mjs, moab.mjs):
//  {kind: 'none'}: not a point tower;
//  {kind: 'unaimed'}: a placed point tower (the state reports its targeting) left on the cursor, or on a
//    point mode with no point: no credit;
//  {kind: 'global'}: Heli on Pursuit, which follows the bloons over the whole track;
//  {kind: 'point', point, radius}: aimed at a point; its damage counts for the track within radius of it.
// A tower with no targeting field is one the estimate is only imagining (a purchase being weighed, or a
// fixture): it counts as aimed where the runner would aim it, at the densest point.
export function aimStatus(t, paths = []) {
 const spec = POINT_TOWERS[t.base_id];
 if (!spec) return {kind: 'none'};
 if (!('targeting' in t) || t.targeting === undefined) {
  const p = paths.length ? aimPoint(paths, spec.radius, {from: Number.isFinite(t.x) ? t : null}) : null;
  return p ? {kind: 'point', point: {x: p.x, y: p.y}, radius: spec.radius, planned: true} : {kind: 'global', planned: true};
 }
 if (spec.global?.includes(t.targeting)) return {kind: 'global'};
 if (spec.modes.includes(t.targeting) && POINT_MODES.includes(t.targeting) && t.target_point && Number.isFinite(t.target_point.x))
  return {kind: 'point', point: t.target_point, radius: spec.radius};
 return {kind: 'unaimed'};
}
