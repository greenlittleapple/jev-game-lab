// Calibration of the MOAB damage estimate (moab.mjs) from live play. The first strategist match cleared
// every MOAB-class round with the estimate far below what the rounds need (the ZOMG at 112 against 324), so
// the estimate is too low; this measures by how much, per setup, and supplies the factor the session applies
// (setMoabCalibration).
//
// Measurement (bridge 0.3.11, bloons.moabs with health): the lead MOAB-class bloon (furthest along) is
// followed from read to read by its type, progress and health; its health drop over the game seconds
// between reads (wall time times the game speed) is the damage the towers dealt it. A bloon that is gone at
// the next read without lives lost popped: its remaining health counts, over the whole interval. A leak
// drops the interval. Per round, `moab_measure` compares the measured damage per second with:
//  - estimated_dps: moab.mjs's uncalibrated estimate (towers.json's MOAB damage times the share of the
//    first half of the track each tower reaches), the figure the factor corrects;
//  - table_dps: towers.json's MOAB damage with no reach share (what the first-half requirement removes).
// What neither counts: Quincy, abilities, and high-tier effects missing from towers.json (Sticky Bomb's
// burst, Cripple MOAB and crits, Archmage's extra attacks). The measured figure is damage on the lead
// bloon wherever it is on the track, so it is not limited to the first half either.
//
// Factor: per run, the 25th percentile of the per-round ratios (measured / estimated) over rounds with at
// least MIN_SECONDS of measurement, when at least MIN_ROUNDS rounds qualify (a low quantile, so a few rounds
// where towers had the lead bloon to themselves don't raise it). Per setup, the median of the last KEEP_RUNS
// runs, kept within FACTOR_BOUNDS, in .private/btd6/calibration/. Without measured runs, the interim factor in
// data/moab-calibration.json.
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {withFileLock} from '../../core/runner.mjs';
import {join} from 'node:path';
import {parseBloon} from './data/generate.mjs';
import {isMoabClass, moabDpsRaw, moabDpsTable} from './moab.mjs';
import {observedSpeed} from './speed.mjs';
import DEFAULTS from './data/moab-calibration.json' with {type: 'json'};

export const MIN_SECONDS = 2, MIN_ROUNDS = 3, KEEP_RUNS = 5, FACTOR_BOUNDS = [0.5, 5];
export const setupKey = setup => `${setup.map}/${setup.difficulty}/${setup.mode}`;
const fileFor = (dir, setup) => join(dir, `moab-${setupKey(setup).replaceAll('/', '-')}.json`);
const quantile = (list, q) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
const clamp = v => Math.min(FACTOR_BOUNDS[1], Math.max(FACTOR_BOUNDS[0], v));

function leadMoab(state) {
 const list = (state.bloons?.moabs ?? []).filter(b => { try { return isMoabClass(parseBloon(b.type).base); } catch { return false; } });
 return list.sort((a, b) => b.progress - a.progress)[0] ?? null;
}

// Follows the lead MOAB-class bloon through a match. observe(state) returns the finished rounds' records
// (usually none): {round, types, damage, seconds, measured_dps, estimated_dps, table_dps, ratio, samples}.
export function moabMeter({paths = [], now = Date.now} = {}) {
 let acc = null, track = null;
 const finish = () => {
  const out = [];
  if (acc && acc.seconds >= MIN_SECONDS && acc.damage > 0) {
   const measured = acc.damage / acc.seconds;
   out.push({round: acc.round, types: [...acc.types], damage: Math.round(acc.damage), seconds: +acc.seconds.toFixed(1), measured_dps: +measured.toFixed(1),
    estimated_dps: acc.estimated, table_dps: acc.table, ratio: acc.estimated > 0 ? +(measured / acc.estimated).toFixed(2) : null, samples: acc.samples});
  }
  acc = null; track = null;
  return out;
 };
 return {observe(state) {
  if (!state?.in_game || state.match.result) return finish();
  const out = acc && state.round.number !== acc.round ? finish() : [];
  const t = now(), lead = state.round.active ? leadMoab(state) : null;
  if (track && acc) {
   const dt = (t - track.at) / 1000 * (observedSpeed(state) ?? 1);
   const same = lead && lead.type === track.type && lead.progress >= track.progress - 0.002 && lead.health <= track.health + 0.5;
   if (dt > 0 && same) { acc.damage += track.health - lead.health; acc.seconds += dt; acc.samples++; }
   else if (dt > 0 && !same && !(state.lives < track.lives)) { acc.damage += track.health; acc.seconds += dt; acc.samples++; }
  }
  if (lead) {
   acc ??= {round: state.round.number, damage: 0, seconds: 0, samples: 0, types: new Set(), estimated: moabDpsRaw(state.towers, paths), table: moabDpsTable(state.towers)};
   acc.types.add(lead.type);
   track = {type: lead.type, progress: lead.progress, health: lead.health, at: t, lives: state.lives};
  } else {
   track = null;
   if (!state.round.active && acc) out.push(...finish());
  }
  return out;
 }, finish};
}

// The factor for a setup: {factor, source, runs}.
export async function loadCalibration(dir, setup) {
 const saved = JSON.parse(await readFile(fileFor(dir, setup), 'utf8').catch(() => 'null'));
 if (saved?.runs?.length) return {factor: saved.factor, source: `measured (${saved.runs.length} run${saved.runs.length === 1 ? '' : 's'})`, runs: saved.runs.length};
 const interim = DEFAULTS.setups[setupKey(setup)] ?? DEFAULTS.default;
 return {factor: interim.factor, source: 'interim hypothesis (data/moab-calibration.json)', runs: 0};
}

// One run's factor from its moab_measure records, or null when too few rounds qualify.
export function runFactor(records) {
 const ratios = records.filter(r => r.ratio != null && r.seconds >= MIN_SECONDS).map(r => r.ratio);
 return ratios.length >= MIN_ROUNDS ? {rounds: ratios.length, factor: +quantile(ratios, 0.25).toFixed(2)} : null;
}

// Adds a run to the setup's file and returns the new setup factor, or null when the run doesn't qualify.
export async function recordCalibration(dir, setup, run, records, {now = () => new Date()} = {}) {
 const r = runFactor(records);
 if (!r) return null;
 const file = fileFor(dir, setup);
 await mkdir(dir, {recursive: true});
 // Two runners can finish at once: the read-modify-write holds <file>.lock, and each writes its own temp file.
 return withFileLock(file, async () => {
 const saved = JSON.parse(await readFile(file, 'utf8').catch(() => 'null')) ?? {setup: setupKey(setup), runs: []};
 saved.runs = [...saved.runs.filter(x => x.run !== run), {run, time: now().toISOString(), ...r}].slice(-KEEP_RUNS);
 const factors = saved.runs.map(x => x.factor).sort((a, b) => a - b), m = factors.length >> 1;
 saved.factor = +clamp(factors.length % 2 ? factors[m] : (factors[m - 1] + factors[m]) / 2).toFixed(2);
 const temp = `${file}.${process.pid}.tmp`;
 await writeFile(temp, JSON.stringify(saved, null, 1) + '\n');
 await rename(temp, file);
 return saved.factor;
 });
}
