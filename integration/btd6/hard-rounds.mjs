// Hard rounds for graded speed (speed.mjs speedCaps, hard_round): rounds that play at most at HARD_SPEED, with
// the round before each. Two sources, kept in data/hard-rounds.json with their provenance:
//  - round data (data/rounds.json, standard round set), MOAB-class bloons left out since moab.mjs checks those:
//    rbe_record: the round's RBE is at least rbe_record times the largest of any earlier round; burst: its RBE per
//    second of sending time is at least burst times the highest of any earlier round, with at least burst_min_rbe;
//    camo_layered: at least camo_layered camo Ceramics and Rainbows; first: the first
//    Camo, Lead, Fortified, MOAB, BFB, ZOMG, DDT or BAD round.
//  - the run logs (.private/btd6/runs): rounds in which some run of the setup lost lives, with the number of
//    runs and the most lives one of them lost (lost:<runs>/<lives>).
// The pops and MOAB estimates don't flag these: round 51 (15 camo Ceramics) cost 38 to 105 lives at 10x with a
// pops margin of 4, and round 78 (150 Rainbows, 147 Ceramics) 68 and 97.
//   npm run btd6:hard-rounds                 (prints the list from the round data and every run log)
//   npm run btd6:hard-rounds -- --write      (and writes data/hard-rounds.json)
//   npm run btd6:hard-rounds -- --current-era (log rounds only from runs of the current code, currentEra)
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bloonRbe, parseBloon} from './data/generate.mjs';
import {roundsOf} from './pops-calibration.mjs';
import {setupKey} from './moab-calibration.mjs';

// Chosen to flag rounds 49 (rbe_record), 51 (camo_layered) and 78 (both) on Monkey Meadow Hard Standard. Against only
// the 3 rounds before, the RBE rule also flagged most rounds after a MOAB-only round (54, 59, 69, 70, 74).
export const THRESHOLDS = {rbe_record: 1.5, burst: 2.0, burst_min_rbe: 500, camo_layered: 15};
const MOAB_CLASS = /^(Moab|Bfb|Zomg|Ddt|Bad)/, LAYERED = /^(Ceramic|Rainbow)/;
const FIRSTS = {Camo: 'camo', Lead: 'lead', Fortified: 'fortified', Moab: 'moab', Bfb: 'bfb', Zomg: 'zomg', Ddt: 'ddt', Bad: 'bad'};
const DATA_FILE = new URL('./data/hard-rounds.json', import.meta.url);
const ROUNDS = JSON.parse(readFileSync(new URL('./data/rounds.json', import.meta.url), 'utf8'));

// A round's bloons without the MOAB class: {rbe, density, camoLayered}.
export function bloonFacts(round) {
 if (!round) return null;
 let rbe = 0, camoLayered = 0;
 for (const [name, count] of Object.entries(round.bloons ?? {})) {
  if (MOAB_CLASS.test(name)) continue;
  rbe += bloonRbe(name) * count;
  if (LAYERED.test(name) && parseBloon(name).camo) camoLayered += count;
 }
 return {rbe, density: rbe / Math.max(1, round.seconds ?? 0), camoLayered};
}

// The round data's flags: {round: [reason]}, for rounds 1 to endRound.
export function roundDataFlags(rounds = ROUNDS.rounds, {endRound = 100, t = THRESHOLDS} = {}) {
 const out = {};
 const add = (n, reason) => (out[n] ??= []).push(reason);
 let rbeBefore = 0, densityBefore = 0;
 for (let n = 1; n <= endRound; n++) {
  const f = bloonFacts(rounds[n]);
  if (!f) continue;
  if (rbeBefore > 0 && f.rbe >= t.rbe_record * rbeBefore) add(n, `rbe_record:${(f.rbe / rbeBefore).toFixed(2)}`);
  if (densityBefore > 0 && f.rbe >= t.burst_min_rbe && f.density >= t.burst * densityBefore) add(n, `burst:${(f.density / densityBefore).toFixed(2)}`);
  rbeBefore = Math.max(rbeBefore, f.rbe); densityBefore = Math.max(densityBefore, f.density);
  if (f.camoLayered >= t.camo_layered) add(n, `camo_layered:${f.camoLayered}`);
  for (const b of rounds[n].first ?? []) if (FIRSTS[b]) add(n, `first:${FIRSTS[b]}`);
 }
 return out;
}

// Rounds with lives lost in the runs of each setup: {setup key: {round: {runs, lives: [per run]}}}. runs: [{records}].
export function logFlags(runs) {
 const out = {};
 for (const {records} of runs) {
  const setup = records.find(r => r.kind === 'session_start')?.setup;
  if (!setup?.map) continue;
  const byRound = (out[setupKey(setup)] ??= {});
  for (const r of roundsOf(records)) if (r.lost > 0) {
   const x = (byRound[r.round] ??= {runs: 0, lives: []});
   x.runs++; x.lives.push(r.lost);
  }
 }
 return out;
}

// lost:<runs>/<most lives lost in one run>.
const lostReason = x => `lost:${x.runs}/${Math.max(...x.lives)}`;

// End rounds by difficulty (Standard mode), for the round-data flags of a setup.
const END_ROUND = {Easy: 40, Medium: 60, Hard: 80, Impoppable: 100};

// The file's content: provenance, thresholds, and per setup the rounds with their reasons.
// Runs of the current code (the replay's current-era option, --current-era): run_start's ruleset btd6-open-v2 or
// later and bridge 0.3.13 or later. Earlier runs (v0 to v4 on ruleset v1, bridges to 0.3.12) played with bugs
// fixed since: the dropped MOAB list, unaimed Mortars, the old spot catalog.
export const CURRENT_ERA = {ruleset: 2, bridge: [0, 3, 13]};
const version = v => String(v ?? '').split('.').map(Number);
const atLeast = (v, min) => { const a = version(v); for (let i = 0; i < min.length; i++) if ((a[i] ?? 0) !== min[i]) return (a[i] ?? 0) > min[i]; return true; };
export function currentEra(records) {
 const start = records.find(r => r.kind === 'run_start');
 const ruleset = /^btd6-open-v(\d+)$/.exec(start?.ruleset?.id ?? '')?.[1];
 return Number(ruleset) >= CURRENT_ERA.ruleset && atLeast(start?.bridge_version, CURRENT_ERA.bridge);
}

// logRuns: which runs the log part comes from ('all', or 'current' for currentEra).
export function buildHardRounds(runs, {rounds = ROUNDS.rounds, source = ROUNDS.source, t = THRESHOLDS, logRuns = 'all'} = {}) {
 const used = logRuns === 'current' ? runs.filter(r => currentEra(r.records)) : runs;
 const logged = logFlags(used), setups = {};
 const listFor = (endRound, lost = {}) => {
  const list = roundDataFlags(rounds, {endRound, t});
  for (const [n, x] of Object.entries(lost)) if (Number(n) <= endRound) (list[n] ??= []).push(lostReason(x));
  return Object.fromEntries(Object.entries(list).sort((a, b) => a[0] - b[0]));
 };
 for (const [key, lost] of Object.entries(logged)) {
  const [, difficulty, mode] = key.split('/');
  // Round data applies to the standard round set; other modes (Clicks and the rest) keep only their logs.
  const endRound = mode === 'Standard' ? END_ROUND[difficulty] ?? 100 : 100;
  setups[key] = {end_round: endRound, rounds: mode === 'Standard' ? listFor(endRound, lost)
   : Object.fromEntries(Object.entries(lost).map(([n, x]) => [n, [lostReason(x)]]))};
 }
 const times = used.map(r => r.records.find(x => x.kind === 'session_start')?.time).filter(Boolean).sort();
 return {generated_by: 'integration/btd6/hard-rounds.mjs', round_data: source, thresholds: t,
  logs: {runs: used.filter(r => r.records.some(x => x.kind === 'session_start' && x.setup?.map)).length, from: times[0] ?? null, to: times.at(-1) ?? null,
   ...(logRuns === 'current' ? {only: `ruleset btd6-open-v${CURRENT_ERA.ruleset} or later, bridge ${CURRENT_ERA.bridge.join('.')} or later`} : {})},
  default: {rounds: listFor(100)}, setups};
}

let loaded = null;
const loadFile = () => loaded ??= JSON.parse(readFileSync(DATA_FILE, 'utf8'));

// The hard rounds for a setup: {rounds: Map(round -> [reason]), source}. A setup without an entry gets the
// round-data flags only. file: the parsed data (tests).
export function hardRoundsFor(setup, {file = loadFile()} = {}) {
 const entry = setup?.map ? file.setups?.[setupKey(setup)] : null;
 const rounds = (entry ?? file.default)?.rounds ?? {};
 return {rounds: new Map(Object.entries(rounds).map(([n, reasons]) => [Number(n), reasons])), source: entry ? setupKey(setup) : 'default'};
}

// A list with only the log rounds lost in at least minRuns runs or with at least minLives lost in one (the
// replay's variants); by default without any.
export function withoutLogs(list, {minRuns = Infinity, minLives = Infinity} = {}) {
 const out = new Map();
 for (const [n, reasons] of list.rounds) {
  const kept = reasons.filter(r => {
   if (!r.startsWith('lost:')) return true;
   const [runs, lives] = r.slice(5).split('/').map(Number);
   return runs >= minRuns || lives >= minLives;
  });
  if (kept.length) out.set(n, kept);
 }
 return {...list, rounds: out};
}

export function formatHardRounds(file) {
 const line = (n, reasons) => `  ${n}: ${reasons.join(', ')}`;
 const out = [`Hard rounds (round data ${file.round_data}; ${file.logs.runs} run logs, ${file.logs.from ?? '-'} to ${file.logs.to ?? '-'}).`,
  `Thresholds: ${Object.entries(file.thresholds).map(([k, v]) => `${k} ${v}`).join(', ')}.`];
 for (const [key, s] of Object.entries(file.setups)) {
  out.push('', `${key} (to round ${s.end_round}):`);
  for (const [n, reasons] of Object.entries(s.rounds)) out.push(line(n, reasons));
 }
 return out.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const {readRuns} = await import('./rules-audit.mjs');
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const dir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs'));
 let runs;
 try { runs = readRuns(dir); } catch (error) { console.error(`Can't read the run logs in ${dir}: ${error.message}`); process.exit(2); }
 const file = buildHardRounds(runs, {logRuns: argv.includes('--current-era') ? 'current' : 'all'});
 console.log(formatHardRounds(file));
 if (argv.includes('--write')) { writeFileSync(DATA_FILE, JSON.stringify(file, null, 1) + '\n'); console.log(`\nWrote ${fileURLToPath(DATA_FILE)}.`); }
}
