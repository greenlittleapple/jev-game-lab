// The match's spot catalog, computed once per map from the live track and the game's placement check
// (npm run btd6:spots) and saved under .private/btd6/spots/<map>.json for the runner. Spot IDs (S01
// covers the most track for the reference tower) stay fixed, so plans and logs can name them. Which
// spots are free is still checked live per tower during a match (runner.mjs).
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {coverage, gridPoints, pickSpots} from './spots.mjs';
import {allowedCatalog, rulesetId, RULESETS} from './rulesets.mjs';
// The catalog serves every ruleset, so it checks every tower btd6-open-v1 allows (v2 leaves some out; v3 adds none).
export const CATALOG_RULESET = RULESETS['btd6-open-v1'];

export const CATALOG_VERSION = 1;
// The first spike's grid (docs/BTD6-VERIFICATION.md): the track runs off-screen at both ends, and the
// game's own playfield bounds aren't confirmed yet.
export const DEFAULT_BOUNDS = {minX: -140, maxX: 140, minY: -110, maxY: 110};
export const DEFAULT_STEP = 6;
export const REFERENCE_TOWER = 'DartMonkey';
// Reference spots in a catalog (--count), and the parts of the track they are spread over. The first
// catalogs had 12, all taken by round 50 of a Hard Standard match, after which no tower could be placed.
export const DEFAULT_SPOT_COUNT = 30;
export const SPREAD_PARTS = 10;

// GET /api/v1/map -> [[{x, y}]]: the active paths (all of them if none is marked active).
export function mapPaths(map) {
 const all = (map?.paths ?? []).filter(p => p.points?.length > 1);
 const active = all.filter(p => p.active !== false);
 return (active.length ? active : all).map(p => p.points.map(([x, y]) => ({x, y})));
}

// Identifies the track, so a catalog made for another map or game version isn't used.
export const pathsHash = paths => createHash('sha256').update(JSON.stringify(paths.map(p => p.map(q => [+q.x.toFixed(1), +q.y.toFixed(1)])))).digest('hex').slice(0, 16);

const key = p => `${p.x},${p.y}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// validByTower: {tower ID: [{x, y}] valid grid points}. towers: catalog entries with range.
// Picks the reference tower's best `count` spots at its range, spread over `spread` parts of the track
// (spots.mjs pickSpots), then adds, for each tower with fewer than `perTower` valid spots among them
// (larger footprints, other terrain), its own best spots at its own range, up to `maxSpots` in all
// (count + 10 by default). IDs follow coverage at the reference range.
export function selectSpots(validByTower, towers, paths, {reference = REFERENCE_TOWER, count = DEFAULT_SPOT_COUNT, spread = SPREAD_PARTS, perTower = 4, maxSpots = count + 10, minSeparation = 12} = {}) {
 const ref = towers.find(t => t.id === reference);
 if (!ref) throw Error(`The reference tower ${reference} isn't in the catalog.`);
 const valid = Object.fromEntries(Object.entries(validByTower).map(([id, points]) => [id, new Set(points.map(key))]));
 const chosen = pickSpots(validByTower[reference] ?? [], paths, {radius: ref.range, count, minSeparation, spread}).map(s => ({x: s.x, y: s.y}));
 for (const tower of [...towers].sort((a, b) => a.id.localeCompare(b.id))) {
  if (tower.id === reference || !(tower.range > 0) || !validByTower[tower.id]?.length) continue;
  let own = chosen.filter(p => valid[tower.id].has(key(p))).length;
  for (const s of pickSpots(validByTower[tower.id], paths, {radius: tower.range, count: 40, minSeparation})) {
   if (own >= perTower || chosen.length >= maxSpots) break;
   if (chosen.every(p => dist(p, s) >= minSeparation)) { chosen.push({x: s.x, y: s.y}); own++; }
  }
 }
 return chosen.map(p => ({...p, ...coverage(p, ref.range, paths)}))
  .sort((a, b) => b.share - a.share || a.x - b.x || a.y - b.y)
  .map((p, i) => ({id: `S${String(i + 1).padStart(2, '0')}`, x: p.x, y: p.y, radius: ref.range,
   share: +p.share.toFixed(3), from: p.from == null ? null : +p.from.toFixed(3), to: p.to == null ? null : +p.to.toFixed(3)}));
}

// Reads the live map and runs the placement check over the grid for each tower the ruleset allows
// (the bridge client sends at most 400 points per request). The match must have no towers, so the
// catalog describes the empty map. The placement check changes nothing in the game.
export async function computeSpotCatalog(bridge, {ruleset = CATALOG_RULESET, map = null, bounds = DEFAULT_BOUNDS, step = DEFAULT_STEP,
 reference = REFERENCE_TOWER, onTower = () => {}, now = () => new Date(), ...options} = {}) {
 const state = await bridge.state();
 if (!state.in_game) throw Error('Not in a match. Start one on the map first (npm run btd6:bridge -- start ...).');
 if (map && state.match.map !== map) throw Error(`The open match is on ${state.match.map}, not ${map}.`);
 if (state.towers.length) throw Error('The match already has towers; start a fresh match so the catalog describes the empty map.');
 const paths = mapPaths(await bridge.map());
 if (!paths.length) throw Error('The bridge returned no track paths.');
 const towers = allowedCatalog(ruleset, (await bridge.catalog()).towers ?? []).filter(t => t.in_inventory !== false);
 const grid = gridPoints(bounds, step);
 const validByTower = {};
 for (const tower of towers) {
  const {results} = await bridge.placementCheck(tower.id, grid);
  if (results.length !== grid.length) throw Error(`The placement check for ${tower.id} answered ${results.length} of ${grid.length} points.`);
  validByTower[tower.id] = grid.filter((_, i) => results[i]?.valid === true);
  onTower(tower.id, validByTower[tower.id].length, grid.length);
 }
 const spots = selectSpots(validByTower, towers, paths, {reference, ...options});
 return {
  version: CATALOG_VERSION, map: state.match.map, paths_hash: pathsHash(paths), created_at: now().toISOString(),
  bridge_version: state.bridge_version ?? null, game_version: state.game_version ?? null, ruleset: rulesetId(ruleset),
  grid: {...bounds, step, points: grid.length}, reference: {tower: reference, radius: towers.find(t => t.id === reference)?.range ?? null},
  selection: {count: options.count ?? DEFAULT_SPOT_COUNT, spread: options.spread ?? SPREAD_PARTS},
  spots,
  towers: towers.map(t => {
   const valid = new Set(validByTower[t.id].map(key));
   return {id: t.id, range: t.range, valid_points: validByTower[t.id].length, spots: spots.filter(s => valid.has(key(s))).map(s => s.id)};
  }),
 };
}

export const catalogFile = (dir, map) => join(dir, `${map}.json`);

export async function saveSpotCatalog(dir, catalog) {
 await mkdir(dir, {recursive: true});
 const file = catalogFile(dir, catalog.map), temp = `${file}.tmp`;
 await writeFile(temp, JSON.stringify(catalog, null, 1) + '\n');
 await rename(temp, file);
 return file;
}

// The saved catalog for a map, checked against the live track.
export async function loadSpotCatalog(dir, map, paths) {
 const file = catalogFile(dir, map);
 const text = await readFile(file, 'utf8').catch(() => null);
 if (text == null) throw Error(`No spot catalog for ${map}. Make one with: npm run btd6:spots -- --map ${map} --confirm`);
 const catalog = JSON.parse(text);
 if (catalog.version !== CATALOG_VERSION || catalog.map !== map) throw Error(`${file} isn't a version ${CATALOG_VERSION} catalog for ${map}; make it again.`);
 if (catalog.paths_hash !== pathsHash(paths)) throw Error(`${file} was made for a different track than the live one; make it again with btd6:spots.`);
 if (!catalog.spots?.length) throw Error(`${file} has no spots.`);
 return catalog;
}
