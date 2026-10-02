// How towers.json's pops per second is derived for a tower (data/generate.mjs towerValue), next to the export's fields
// the derivation leaves out, and the measured pops for the same tier keys (pops-study.mjs). Data only.
//   npm run btd6:pops-derive -- --game-data <btd6-game-data clone> SniperMonkey:320 BombShooter:024
//   npm run btd6:pops-derive -- --game-data <clone> --weapons Skywarden   (each tier's attacks, weapons and stance model)
//   npm run btd6:pops-derive -- --placement WizardMonkey [--json]   (zero-pop against popping tower-rounds: position, range,
//     reach, distance to the path, and whether the round's logged furthest bloon reached the tower's stretch)
//   npm run btd6:pops-derive -- --game-data <clone> --examples 1 --json SniperMonkey:320    (examples per kind; default 2)
// The derivation (generate.mjs): per AttackModel, per weapon, emission count x pops per shot / rate (a rate under
// MIN_RATE next to a slower weapon takes that weapon's rate). Pops per shot of a projectile: min(pierce, PIERCE_CAP) x
// DamageModel.damage, plus emission count x the same for each projectile created by a CreateProjectileOn... or
// CreateDistanceProjectileOn... behaviour or an EmitOnDamageModel, to depth 3. Everything else in the tree is listed as not counted here.
import {readFileSync, readdirSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PIERCE_CAP, towerValue} from './data/generate.mjs';
import {readRuns} from './rules-audit.mjs';
import {studyRun, factorTable} from './pops-study.mjs';
import {bloonList, reachFactor, towerEstimate, TOWER_DATA} from './estimate.mjs';
import {coverage} from './spots.mjs';

const MIN_RATE = 0.1, CREATES = /Create(Distance)?ProjectileOn|EmitOnDamageModel/;
const typeOf = o => typeof o?.$type === 'string' ? o.$type.split(',')[0].split('.').pop() : null;
const emitted = e => e?.count ?? e?.Count ?? e?.projectileCount ?? 1;
const COSMETIC = /Display|Effect|Sound|Shadow|Animation|Asset|Prefab|Vector|Rotate|Target.*Prio|CheckTargets|Filter|Travel|Age|Instant|Emission|Track|Zone|Retarget|Hide|Ignore|Upgrade|Blank|Tower(Expire|Sell)|Footprint|Create(Sound|Effect)|Spin|Scale|Fade|Arc/;
const r1 = v => v == null ? v : +(+v).toFixed(2);

// Projectiles inside an object (not through counted children): [{name, pierce, damage, immune, count}].
function nestedProjectiles(o, out = [], depth = 0) {
 if (!o || typeof o !== 'object' || depth > 8) return out;
 if (Array.isArray(o)) { for (const x of o) nestedProjectiles(x, out, depth); return out; }
 if (typeOf(o) === 'ProjectileModel') {
  const d = (o.behaviors ?? []).find(b => typeOf(b) === 'DamageModel');
  out.push({name: o.name ?? o.id, pierce: o.pierce, damage: d?.damage ?? 0, immune: d?.immuneBloonProperties ?? null});
 }
 for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && !/display/i.test(k)) nestedProjectiles(v, out, depth + 1);
 return out;
}

// A projectile's counted tree: rows [{depth, name, count, pierce, pierce_used, damage, immune, pops_per_shot}], and what it leaves out.
function projectileTree(p, rows, left, depth = 0, count = 1, via = 'weapon') {
 if (!p || depth > 3) return 0;
 const dmg = (p.behaviors ?? []).find(b => typeOf(b) === 'DamageModel');
 const own = dmg && dmg.damage > 0 ? Math.min(p.pierce ?? 1, PIERCE_CAP) * dmg.damage : 0;
 const row = {depth, via, name: p.name ?? p.id, count, pierce: p.pierce, pierce_used: Math.min(p.pierce ?? 1, PIERCE_CAP), damage: dmg?.damage ?? 0,
  immune: dmg?.immuneBloonProperties ?? null, max_damage: dmg?.maxDamage || null, own_pops: own, pops_per_shot: 0};
 rows.push(row);
 let pops = own;
 for (const b of p.behaviors ?? []) {
  const t = typeOf(b);
  if (b?.projectile && CREATES.test(b.$type)) pops += emitted(b.emission) * projectileTree(b.projectile, rows, left, depth + 1, emitted(b.emission), t);
  else if (t === 'DamageModifierForTagModel') left.push({at: row.name, kind: t, tag: b.tag ?? b.tags, multiplier: b.damageMultiplier, add: b.damageAddative});
  else if (t !== 'DamageModel' && nestedProjectiles(b).length) left.push({at: row.name, kind: t, count: emitted(b.emission), projectiles: nestedProjectiles(b)});
  else if (t && !COSMETIC.test(t) && t !== 'DamageModel') left.push({at: row.name, kind: t});
 }
 row.pops_per_shot = r1(pops);
 return pops;
}

// {pps (recomputed), table (towers.json), attacks: [{name, range, weapons: [{name, rate, rate_used, count, pops_per_shot, pps, projectiles, left_out}]}], tower_left_out}.
export function deriveTower(model) {
 const attacks = [], towerLeft = [];
 let pps = 0;
 for (const a of model.behaviors ?? []) {
  const t = typeOf(a);
  if (t !== 'AttackModel' && t !== 'AttackAirUnitModel') { if (t && !COSMETIC.test(t)) towerLeft.push({kind: t, name: a.name, projectiles: nestedProjectiles(a).length || undefined}); continue; }
  const main = (a.weapons ?? []).find(w => w.rate >= MIN_RATE)?.rate, weapons = [];
  for (const w of a.weapons ?? []) {
   const rate = w.rate >= MIN_RATE || !main ? w.rate : main, rows = [], left = [];
   const perShot = projectileTree(w.projectile, rows, left);
   for (const b of w.behaviors ?? []) { const bt = typeOf(b); if (bt && !COSMETIC.test(bt)) left.push({at: 'weapon', kind: bt, interval: b.interval, projectiles: nestedProjectiles(b)}); }
   const wp = rate > 0 ? emitted(w.emission) * perShot / rate : 0;
   pps += wp;
   weapons.push({name: w.name, rate: w.rate, rate_used: rate, emission: typeOf(w.emission), count: emitted(w.emission), pops_per_shot: r1(perShot), pps: r1(wp), projectiles: rows, left_out: left});
  }
  attacks.push({name: a.name, range: a.range, weapons});
 }
 return {pps: r1(pps), table: towerValue(model)[0], attacks, tower_left_out: towerLeft};
}

// Logged tower-rounds of a type and tier key, by pops / est_reach, for examples: [{run, round, rbe, lost, pops, est_reach, round_pops, round_est, bloons}].
export function towerRounds(runs, type, tiers) {
 const out = [];
 for (const run of runs) for (const r of run.rounds) if (r.pr) for (const t of r.pr.towers)
  if (t.type === type && t.tiers === tiers && t.er > 0) out.push({run: run.name, round: r.round, rbe: r.pr.rbe, lost: r.lost, pops: t.pops, est_reach: r1(t.er), ratio: r1(t.pops / t.er),
   round_pops: r.pr.pops, round_est: r1(r.pr.est), bloons: bloonList(r.round)});
 return out;
}

// Distance from a point to the nearest point of the paths.
export function pathDistance(p, paths) {
 let best = Infinity;
 for (const path of paths) for (let i = 1; i < path.length; i++) {
  const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
 }
 return best;
}
// The furthest bloon's progress logged in each round (leak_pressure's furthest, logged only from LEAK_PROGRESS on): Map(round -> max).
export function furthestByRound(records) {
 const out = new Map();
 for (const r of records) {
  const n = r.state?.round?.number;
  for (const x of r.constraint?.rules ?? []) if (x.kind === 'leak_pressure' && Number.isFinite(x.furthest) && n != null) out.set(n, Math.max(out.get(n) ?? 0, x.furthest));
 }
 return out;
}
// Each tower-round of a type in rounds where the towers popped something: {run, round, id, tiers, pops, est_reach, x, y, range,
// factor (reachFactor), share, from, to (coverage of the paths, 0 entrance to 1 exit), distance (to the nearest path point),
// furthest (the round's logged furthest progress, or null), reached (furthest at or past from), lost}.
export function placementRows(logs, type) {
 const out = [];
 for (const {name, records} of logs) {
  const run = studyRun({name, records});
  if (!run.measured) continue;
  const furthest = furthestByRound(records);
  for (const r of run.rounds) {
   if (!r.pr || !(r.pr.pops > 0)) continue;
   for (const t of r.pr.towers.filter(x => x.type === type && x.id != null)) {
    const st = r.states.map(s => s.towers?.find(x => x.id === t.id)).find(x => x && Number.isFinite(x.x));
    if (!st) { out.push({run: name, round: r.round, id: t.id, tiers: t.tiers, pops: t.pops, est_reach: t.er, x: null}); continue; }
    const range = towerEstimate(st)?.range ?? null, rf = range ? reachFactor(st, range, run.paths) : null, c = range ? coverage(st, range, run.paths) : null;
    const f = furthest.get(r.round) ?? null;
    out.push({run: name, round: r.round, id: t.id, tiers: t.tiers, pops: t.pops, est_reach: t.er, x: st.x, y: st.y, range, factor: rf?.factor ?? null,
     share: c ? +c.share.toFixed(3) : null, from: c?.from == null ? null : +c.from.toFixed(3), to: c?.to == null ? null : +c.to.toFixed(3),
     distance: +pathDistance(st, run.paths).toFixed(1), furthest: f, reached: f == null || c?.from == null ? null : f >= c.from, lost: r.lost});
   }
  }
 }
 return out;
}
const median = list => { const v = list.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
// Zero-pop against popping tower-rounds: counts, medians and shares.
export function placementSummary(rows) {
 const group = list => ({tower_rounds: list.length, towers: new Set(list.map(x => `${x.run}:${x.id}`)).size, no_position: list.filter(x => x.x == null).length,
  distance: median(list.map(x => x.distance)), range: median(list.map(x => x.range)), factor: median(list.map(x => x.factor)), factor_zero: list.filter(x => x.factor === 0).length,
  share: median(list.map(x => x.share)), from: median(list.map(x => x.from)), out_of_range: list.filter(x => x.distance != null && x.range != null && x.distance > x.range).length,
  furthest_logged: list.filter(x => x.furthest != null).length, reached: list.filter(x => x.reached === true).length, not_reached: list.filter(x => x.reached === false).length, lost_lives: list.filter(x => x.lost > 0).length});
 // By where the tower's stretch of track starts (from): tower-rounds with zero pops and with pops, and the pops / est_reach sum.
 const byFrom = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1.01]].map(([lo, hi]) => { const l = rows.filter(x => x.from != null && x.from >= lo && x.from < hi);
  return {from: `${lo}-${Math.min(hi, 1)}`, zero: l.filter(x => x.pops <= 0).length, popped: l.filter(x => x.pops > 0).length, measured_over_est: l.length ? +(l.reduce((n, x) => n + x.pops, 0) / l.reduce((n, x) => n + (x.est_reach ?? 0), 0)).toFixed(2) : null}; });
 // By tier key: tower-rounds, and pops / est_reach summed over clean rounds and over rounds that lost lives.
 const ratio = l => { const e = l.reduce((n, x) => n + (x.est_reach ?? 0), 0); return e ? +(l.reduce((n, x) => n + x.pops, 0) / e).toFixed(2) : null; };
 const byTiers = Object.entries(Object.groupBy(rows, x => x.tiers)).sort((a, b) => b[1].length - a[1].length).map(([tiers, l]) => ({tiers, tower_rounds: l.length,
  towers: new Set(l.map(x => `${x.run}:${x.id}`)).size, clean: l.filter(x => !x.lost).length, clean_ratio: ratio(l.filter(x => !x.lost)), leak: l.filter(x => x.lost > 0).length, leak_ratio: ratio(l.filter(x => x.lost > 0)),
  zero_share: +(l.filter(x => x.pops <= 0).length / l.length).toFixed(2)}));
 return {zero: group(rows.filter(x => x.pops <= 0)), popped: group(rows.filter(x => x.pops > 0)), by_from: byFrom, by_tiers: byTiers};
}

// Each tier file of a tower: its attacks' weapon names, and the stance model if any (ToggleFocusStanceModel: swapWeapon,
// range and rate multipliers). {tiers: {attacks: [[weapon names]], stance}} grouped by layout: [{layout, tiers: [...]}].
export function weaponLayouts(dir, id) {
 const out = new Map();
 for (const file of readdirSync(join(dir, 'Towers', id)).filter(f => f.endsWith('.json')).sort()) {
  const m = JSON.parse(readFileSync(join(dir, 'Towers', id, file), 'utf8')), tiers = /-(\d{3})\.json$/.exec(file)?.[1] ?? '000';
  const attacks = (m.behaviors ?? []).filter(b => ['AttackModel', 'AttackAirUnitModel'].includes(typeOf(b))).map(a => (a.weapons ?? []).map(w => w.name?.replace('WeaponModel_', '') ?? '?').join('+'));
  const st = (m.behaviors ?? []).find(b => typeOf(b) === 'ToggleFocusStanceModel');
  const layout = `${attacks.join(' | ')}${st ? `; stance swapWeapon ${st.swapWeapon}, range x${st.rangeMultiplier}, rate x${st.rateMultiplier}` : ''}`;
  if (!out.has(layout)) out.set(layout, []);
  out.get(layout).push(tiers);
 }
 return [...out].map(([layout, tiers]) => ({layout, tiers}));
}

const loadModel = (dir, key) => { const [id, tiers] = key.split(':'); return JSON.parse(readFileSync(join(dir, 'Towers', id, `${id}${tiers && tiers !== '000' ? `-${tiers}` : ''}.json`), 'utf8')); };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const data = resolve(flag('--game-data') ?? join(root, '.private/btd6-game-data')), runsDir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs'));
 const keys = argv.filter((a, i) => /^[A-Za-z]+:\d{3}$/.test(a) && !['--game-data', '--dir', '--examples'].includes(argv[i - 1]));
 if (!keys.length && !argv.includes('--placement') && !argv.includes('--weapons')) { console.error('Give tower keys, e.g. SniperMonkey:320.'); process.exit(2); }
 if (argv.includes('--weapons')) {
  for (const x of weaponLayouts(data, flag('--weapons'))) console.log(`${x.layout}: ${x.tiers.join(' ')}`);
  process.exit(0);
 }
 if (argv.includes('--placement')) {
  const type = flag('--placement'), rows = placementRows(readRuns(runsDir), type), sum = placementSummary(rows);
  if (argv.includes('--json')) { console.log(JSON.stringify({summary: sum, rows}, null, 1)); process.exit(0); }
  console.log(`${type} tower-rounds in rounds where the towers popped something (positions from the round's decision states):`);
  for (const [k, g] of Object.entries(sum)) console.log(` ${k}: ${JSON.stringify(g)}`);
  process.exit(0);
 }
 const runs = readRuns(runsDir).filter(r => r.records.some(x => x.kind === 'pops_round')).map(studyRun);
 const table = new Map(factorTable(runs, 'tiers').map(x => [x.group, x])), n = Number(flag('--examples') ?? 2);
 const out = keys.map(key => {
  const [type, tiers] = key.split(':'), list = towerRounds(runs, type, tiers);
  // Examples: the tower-rounds of the rounds that lost most lives, and of clean rounds 50 to 70 with the largest estimate.
  const leak = list.filter(x => x.lost > 5).sort((a, b) => b.lost - a.lost || b.est_reach - a.est_reach), clean = list.filter(x => !x.lost && x.round >= 50 && x.round <= 70).sort((a, b) => b.est_reach - a.est_reach);
  let derived = null;
  try { derived = deriveTower(loadModel(data, key)); } catch (error) { derived = {error: error.message}; }
  return {key, towers_json: TOWER_DATA.towers[type]?.[tiers] ?? null, derived, measured: table.get(key) ?? null, examples: [...leak.slice(0, n), ...clean.slice(0, n)]};
 });
 if (argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
 for (const x of out) {
  console.log(`\n== ${x.key}: towers.json [pps, lead, camo, range, moab_dps, camo_lead] ${JSON.stringify(x.towers_json)}; recomputed pps ${x.derived.pps ?? x.derived.error}`);
  for (const a of x.derived.attacks ?? []) for (const w of a.weapons) {
   console.log(` ${a.name} (range ${r1(a.range)}) / ${w.name}: rate ${w.rate}${w.rate_used !== w.rate ? ` (used ${w.rate_used})` : ''}, ${w.emission ?? 'no emission'} x${w.count}, pops per shot ${w.pops_per_shot}, pps ${w.pps}`);
   for (const p of w.projectiles) console.log(`  ${'  '.repeat(p.depth)}${p.name}${p.depth ? ` (${p.via}, x${p.count})` : ''}: pierce ${p.pierce} (used ${p.pierce_used}), damage ${p.damage}, immune ${p.immune}${p.max_damage ? `, maxDamage ${p.max_damage}` : ''} -> ${p.own_pops} own, ${p.pops_per_shot} with children`);
   for (const l of w.left_out) console.log(`   not counted at ${l.at}: ${l.kind}${l.tag ? ` ${l.tag} x${l.multiplier} +${l.add}` : ''}${l.interval ? ` interval ${l.interval}` : ''}${l.projectiles?.length ? ` -> ${l.projectiles.map(p => `${p.name} pierce ${p.pierce} damage ${p.damage}`).join('; ')}${l.count > 1 ? ` (x${l.count})` : ''}` : ''}`);
  }
  for (const l of x.derived.tower_left_out ?? []) console.log(`  tower behaviour not counted: ${l.kind} ${l.name ?? ''}${l.projectiles ? ` (${l.projectiles} projectiles)` : ''}`);
  const m = x.measured;
  console.log(m ? ` measured / est_reach: ${m.tower_rounds} tower-rounds in ${m.runs} runs; all median ${m.all_median}, sum ${m.all_sum}; leak rounds median ${m.leak ?? '-'} (${m.leak_n}); tight ${m.tight ?? '-'}; rel ${m.rel ?? '-'}` : ' measured: none');
  for (const e of x.examples) console.log(`  e.g. ${e.run.slice(11, 19)} round ${e.round} (RBE ${e.rbe}, lost ${e.lost}; round pops ${e.round_pops} / est ${e.round_est}): pops ${e.pops}, est_reach ${e.est_reach} (${e.ratio}); ${e.bloons}`);
 }
}
