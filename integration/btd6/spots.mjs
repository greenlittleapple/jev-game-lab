// Placement spots: positions the game's own placement check accepted, described by how much of
// the track a tower there would cover. Pure geometry over the path polylines the bridge exports
// (GET /api/v1/map); validity comes from POST /api/v1/placement-check.

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Parameter interval [t0, t1] of segment p0 -> p1 that lies inside the circle (c, r), or null.
function insideInterval(p0, p1, c, r) {
 const dx = p1.x - p0.x, dy = p1.y - p0.y, fx = p0.x - c.x, fy = p0.y - c.y;
 const a = dx * dx + dy * dy, b = fx * dx + fy * dy, k = fx * fx + fy * fy - r * r;
 if (a === 0) return k <= 0 ? [0, 1] : null;
 const disc = b * b - a * k;
 if (disc < 0) return null;
 const s = Math.sqrt(disc), t0 = Math.max(0, (-b - s) / a), t1 = Math.min(1, (-b + s) / a);
 return t1 > t0 ? [t0, t1] : null;
}

export const pathLength = points => points.slice(1).reduce((n, p, i) => n + dist(points[i], p), 0);

// Share of the total track length within `radius` of `point`, and where along the track the
// covered part starts and ends (0 = entrance, 1 = exit; the widest span over all paths).
export function coverage(point, radius, paths) {
 let total = 0, covered = 0, from = null, to = null;
 for (const path of paths) {
  const length = pathLength(path);
  if (!length) continue;
  let along = 0;
  for (let i = 1; i < path.length; i++) {
   const p0 = path[i - 1], p1 = path[i], seg = dist(p0, p1);
   const inside = insideInterval(p0, p1, point, radius);
   if (inside) {
    covered += (inside[1] - inside[0]) * seg;
    const start = (along + inside[0] * seg) / length, end = (along + inside[1] * seg) / length;
    from = from == null ? start : Math.min(from, start);
    to = to == null ? end : Math.max(to, end);
   }
   along += seg;
  }
  total += length;
 }
 return {share: total ? covered / total : 0, from, to};
}

// Distance from a point to the nearest part of the track.
export function trackDistance(point, paths) {
 let best = Infinity;
 for (const path of paths) for (let i = 1; i < path.length; i++) {
  const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len)) : 0;
  best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
 }
 return best;
}

// Grid points in a band beside the track (minDist to maxDist from it), inside bounds: where the runner
// looks for a place once every catalog spot is taken (runner.mjs).
export function nearTrackPoints(paths, {bounds, step = 8, minDist = 8, maxDist = 28} = {}) {
 const box = pathBounds(paths, maxDist);
 const clip = bounds ? {minX: Math.max(box.minX, bounds.minX), maxX: Math.min(box.maxX, bounds.maxX), minY: Math.max(box.minY, bounds.minY), maxY: Math.min(box.maxY, bounds.maxY)} : box;
 if (clip.minX > clip.maxX || clip.minY > clip.maxY) return [];
 return gridPoints(clip, step).filter(p => { const d = trackDistance(p, paths); return d >= minDist && d <= maxDist; });
}

export function pathBounds(paths, margin = 0) {
 const all = paths.flat();
 return {minX: Math.min(...all.map(p => p.x)) - margin, maxX: Math.max(...all.map(p => p.x)) + margin,
  minY: Math.min(...all.map(p => p.y)) - margin, maxY: Math.max(...all.map(p => p.y)) + margin};
}

export function gridPoints({minX, maxX, minY, maxY}, step) {
 const points = [];
 for (let x = minX; x <= maxX + 1e-9; x += step) for (let y = minY; y <= maxY + 1e-9; y += step) points.push({x: +x.toFixed(2), y: +y.toFixed(2)});
 return points;
}

// Up to `count` valid points with the most track coverage at `radius`, at least `minSeparation`
// apart so two spots don't name the same place. IDs follow coverage order (S01 covers the most).
// spread: the number of equal parts of the track (by the middle of the covered stretch); with more than
// one, picking goes round the parts, best coverage first in each, so the spots don't cluster where the
// track bends back on itself. prefix: the ID prefix.
export function pickSpots(validPoints, paths, {radius, count = 12, minSeparation = 12, spread = 0, prefix = 'S'} = {}) {
 if (!(radius > 0)) throw Error('pickSpots needs a positive radius');
 const scored = validPoints.map(p => ({x: p.x, y: p.y, ...coverage(p, radius, paths)})).filter(p => p.share > 0)
  .sort((a, b) => b.share - a.share || a.x - b.x || a.y - b.y);
 const picked = [];
 const fits = p => picked.every(q => dist(p, q) >= minSeparation);
 if (spread > 1) {
  const part = p => Math.min(spread - 1, Math.floor((p.from + p.to) / 2 * spread));
  const perPart = new Array(spread).fill(0), taken = new Set();
  for (let cap = 1; picked.length < count && cap <= count; cap++) {
   for (const p of scored) {
    if (picked.length >= count) break;
    if (taken.has(p) || perPart[part(p)] >= cap || !fits(p)) continue;
    picked.push(p); taken.add(p); perPart[part(p)]++;
   }
  }
  picked.sort((a, b) => b.share - a.share || a.x - b.x || a.y - b.y);
 } else {
  for (const p of scored) {
   if (picked.length >= count) break;
   if (fits(p)) picked.push(p);
  }
 }
 return picked.map((p, i) => ({id: `${prefix}${String(i + 1).padStart(2, '0')}`, x: p.x, y: p.y, radius,
  share: +p.share.toFixed(3), from: +p.from.toFixed(3), to: +p.to.toFixed(3)}));
}

const pct = v => `${Math.round(100 * v)}%`;
// e.g. "covers 22% of the track, from 10% to 45% of the way to the exit"
export function describeCoverage({share, from, to}) {
 if (!share) return 'covers none of the track';
 return `covers ${pct(share)} of the track, from ${pct(from)} to ${pct(to)} of the way to the exit`;
}

// Share of the track past this point (0 = entrance, 1 = exit) that counts as the late part, where a
// bloon is close to leaking. The same scale as the bridge's bloon progress (Bloon.PercThroughMap()).
export const LATE_TRACK = 0.6;
const DIRECTION_BINS = 360;

// coverage() plus what policy btd6-jev-v3 reads: late (share of the late part of the track, past
// `lateFrom`, that lies in range), length (track length in range, in map units) and directions (share of
// the directions around the point in which the track lies within range, 0 to 1; a tower that fires in
// fixed directions hits the track only along those).
export function reach(point, radius, paths, {lateFrom = LATE_TRACK} = {}) {
 const base = coverage(point, radius, paths);
 let total = 0, length = 0, lateCovered = 0;
 const bins = new Uint8Array(DIRECTION_BINS);
 const angle = p => Math.atan2(p.y - point.y, p.x - point.x);
 const mark = (a0, a1) => {
  // The shorter arc between the two angles: a straight segment subtends less than half a turn.
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const from = d >= 0 ? a0 : a0 + d, span = Math.abs(d);
  const first = Math.floor(((from / (2 * Math.PI)) % 1 + 1) % 1 * DIRECTION_BINS);
  const count = Math.max(1, Math.ceil(span / (2 * Math.PI) * DIRECTION_BINS));
  for (let i = 0; i < count; i++) bins[(first + i) % DIRECTION_BINS] = 1;
 };
 for (const path of paths) {
  const pathLen = pathLength(path);
  if (!pathLen) continue;
  let along = 0;
  for (let i = 1; i < path.length; i++) {
   const p0 = path[i - 1], p1 = path[i], seg = dist(p0, p1);
   const inside = insideInterval(p0, p1, point, radius);
   if (inside && seg > 0) {
    const [t0, t1] = inside;
    length += (t1 - t0) * seg;
    // The part of [t0, t1] past lateFrom along this path.
    const s0 = (along + t0 * seg) / pathLen, s1 = (along + t1 * seg) / pathLen;
    if (s1 > lateFrom) lateCovered += (s1 - Math.max(s0, lateFrom)) * pathLen;
    const at = t => ({x: p0.x + t * (p1.x - p0.x), y: p0.y + t * (p1.y - p0.y)});
    mark(angle(at(t0)), angle(at(t1)));
   }
   along += seg;
  }
  total += pathLen;
 }
 const lateTotal = total * (1 - lateFrom);
 return {...base, late: lateTotal > 0 ? Math.min(1, lateCovered / lateTotal) : 0, length,
  directions: length > 0 ? bins.reduce((n, b) => n + b, 0) / DIRECTION_BINS : 0};
}
