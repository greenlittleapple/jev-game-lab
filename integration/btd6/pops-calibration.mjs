// Calibration of the pops estimate (estimate.mjs roundCheck with reach, which btd6-jev-v3 and later use for the
// defence verdict short / enough / ahead and graded speed uses for its pops margin); the counterpart of
// moab-calibration.mjs. The factor multiplies can_pop (setPopsCalibration); the per-tower pops rates and the
// pops_round estimates (pops.mjs) stay uncalibrated, so they can be measured against.
//
// Two kinds of evidence:
//  - Outcome bounds (outcomeBounds, from the decision states any run log holds). A round that ended with no
//    lives lost had all its RBE popped, so the defence could pop at least the RBE: the estimate was low by at
//    least rbe / can_pop. can_pop is taken from the largest tower set seen in the round (the states of its
//    decisions and the first state of the next round), so the bound is the smallest the round supports. The
//    safety margin for lives is left out: clearing a round shows the RBE was popped, not the margin on top.
//    A round that lost lives while camo, lead and early reach were covered bounds the factor from above
//    (rbe / can_pop), since the defence could not pop the RBE; a leak can also come from towers idle out of
//    reach, so an upper bound is weaker evidence than a lower one.
//  - Measurement (runFactor, from bridge 0.3.13's pops_round records: each tower's measured pops in a round
//    next to est_reach, its uncalibrated estimate). Measured pops can't exceed the RBE on the track, so a
//    round the towers cleared only shows pops = RBE: the ratio pops / est_reach is then a lower bound, no
//    better than the outcome bound. Only a round that lost lives had bloons left over for the towers, so there
//    the measured pops are the defence's capacity and pops / est_reach measures the factor. runFactor takes
//    those rounds (lives lost, measured pops at least MIN_POPS_SHARE of the RBE so a round lost at once doesn't
//    count) and uses the lower bounds from cleared rounds as a floor.
// Both count pops over the whole round, however long it ran; the estimate's window (roundSeconds) is a guess,
// so the factor corrects the rate and the window together.
//
// Rounds: the factor applies from a setup's from_round on. In the 24 logged runs every lower bound above 1 came
// from round 60 or later; before round 60 the estimate was above the RBE in every cleared round (rbe / can_pop
// at most 0.87) and in every round that leaked (at most 0.7), so those leaks came from something other than the
// pop count and nothing supports a factor for the early rounds.
// Factor per setup: the median of the last KEEP_RUNS measured runs, kept within FACTOR_BOUNDS, in
// .private/btd6/calibration/pops-<setup>.json; without measured runs, the interim factor in
// data/pops-calibration.json, set from the outcome bounds of the logged runs (interimFactor).
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {withFileLock} from '../../core/runner.mjs';
import {join} from 'node:path';
import {roundCheck, roundFacts, towerEstimate} from './estimate.mjs';
import {towerFacts} from './towers.mjs';
import {setupKey} from './moab-calibration.mjs';
import DEFAULTS from './data/pops-calibration.json' with {type: 'json'};

export const MIN_ROUNDS = 3, KEEP_RUNS = 5, FACTOR_BOUNDS = [1, 3], MIN_POPS_SHARE = 0.5;
const fileFor = (dir, setup) => join(dir, `pops-${setupKey(setup).replaceAll('/', '-')}.json`);
export const quantile = (list, q) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
const clamp = v => Math.min(FACTOR_BOUNDS[1], Math.max(FACTOR_BOUNDS[0], v));
const median = list => { const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Every damage-dealing tower has an estimate (a tower missing from towers.json counts 0 pops, which would
// inflate a bound).
const allKnown = towers => towers.every(t => towerEstimate(t) || towerFacts(t.base_id).damage === false);

// The rounds of one run's log: [{round, states, lost, cleared}] in order. lost: lives lost in the round (the
// drop across its states and to the next round's first state, and the round's own lives_lost); cleared: a
// later round was seen, or the match was won in it.
export function roundsOf(records) {
 const states = records.filter(r => r.state?.in_game && r.state.round && Number.isFinite(r.state.lives)).map(r => r.state);
 const byRound = new Map();
 for (const s of states) {
  const n = s.round.number;
  if (!byRound.has(n)) byRound.set(n, {round: n, states: [], first: s.lives, last: s.lives, lostHere: 0});
  const x = byRound.get(n);
  x.states.push(s); x.last = s.lives; x.lostHere = Math.max(x.lostHere, s.round.lives_lost ?? 0);
 }
 const won = records.some(r => r.kind === 'run_end' && /^(won|victory)$/i.test(String(r.result ?? '')));
 const numbers = [...byRound.keys()].sort((a, b) => a - b), top = numbers.at(-1);
 return numbers.map(n => {
  const x = byRound.get(n), next = byRound.get(n + 1);
  const lost = Math.max(x.first - x.last, x.lostHere) + (next ? Math.max(0, x.last - next.first) : 0);
  return {round: n, states: next ? [...x.states, next.states[0]] : x.states, lost, cleared: n < top || won};
 });
}

// Outcome bounds for one run: [{round, rbe, can_pop, bound, kind: 'lower' | 'upper', lost}]. can_pop is the
// uncalibrated estimate (factor 1), with the reach factor, for the largest tower set seen in the round.
export function outcomeBounds(records, {paths = []} = {}) {
 const out = [];
 for (const r of roundsOf(records)) {
  const facts = roundFacts(r.round);
  if (!facts?.rbe || !r.cleared && r.lost === 0) continue;
  let best = null;
  for (const s of r.states) {
   if (!allKnown(s.towers)) { best = null; break; }
   const c = roundCheck(s.towers, r.round, {lives: s.lives, paths, useReach: true, factor: 1});
   if (c && (!best || c.can_pop > best.can_pop)) best = c;
  }
  if (!best || !(best.can_pop > 0)) continue;
  const bound = +(facts.rbe / best.can_pop).toFixed(2);
  if (r.lost === 0) out.push({round: r.round, rbe: facts.rbe, can_pop: best.can_pop, bound, kind: 'lower', lost: 0});
  else if (best.camo !== false && best.lead !== false && best.early !== false) out.push({round: r.round, rbe: facts.rbe, can_pop: best.can_pop, bound, kind: 'upper', lost: r.lost});
 }
 return out;
}

// Lives lost per round ({round: lives}) from a run log's decision states, for pops_round records without
// lives_lost (bridge 0.3.13 runs before it was added).
export const lostByRound = records => Object.fromEntries(roundsOf(records).map(r => [r.round, r.lost]));

// One run's factor from its pops_round records (their lives_lost, else lost[round]), or null when
// fewer than MIN_ROUNDS rounds measure it. {rounds, factor, floor}: the median of the measuring rounds'
// ratios, raised to the 25th percentile of the cleared rounds' lower bounds when that is higher.
export function runFactor(records, lost = {}, {fromRound = 1} = {}) {
 const usable = records.filter(r => r.kind === 'pops_round' && r.round >= fromRound && r.pops != null && r.est_reach > 0 && r.rbe > 0);
 const lostIn = r => r.lives_lost ?? lost[r.round] ?? 0;
 const measuring = usable.filter(r => lostIn(r) > 0 && r.pops >= MIN_POPS_SHARE * r.rbe).map(r => r.pops / r.est_reach);
 if (measuring.length < MIN_ROUNDS) return null;
 const lower = usable.filter(r => !(lostIn(r) > 0)).map(r => r.rbe / r.est_reach);
 const floor = lower.length ? quantile(lower, 0.25) : 0;
 return {rounds: measuring.length, factor: +Math.max(median(measuring), floor).toFixed(2), floor: +floor.toFixed(2)};
}

// The interim entry for a setup (data/pops-calibration.json).
export const interimPops = setup => DEFAULTS.setups[setupKey(setup)] ?? DEFAULTS.default;
// The factor for a setup: {factor, from_round, source, runs, basis}. basis: 'pops_round' (measured) or the
// interim entry's basis_kind ('outcome_bounds').
export async function loadPopsCalibration(dir, setup) {
 const saved = JSON.parse(await readFile(fileFor(dir, setup), 'utf8').catch(() => 'null'));
 const interim = interimPops(setup);
 if (saved?.runs?.length) return {factor: saved.factor, from_round: saved.from_round ?? interim.from_round, source: `measured (${saved.runs.length} run${saved.runs.length === 1 ? '' : 's'})`, runs: saved.runs.length, basis: 'pops_round'};
 return {factor: interim.factor, from_round: interim.from_round, source: 'interim (data/pops-calibration.json)', runs: 0, basis: interim.basis_kind};
}

// Adds a run to the setup's file and returns {run, factor} (the run's own factor and the new setup factor), or
// null when the run doesn't qualify.
// fromRound: the setup's from_round (interim entry by default); the run's rounds before it are left out.
export async function recordPopsCalibration(dir, setup, run, records, lost = {}, {now = () => new Date(), fromRound = interimPops(setup).from_round} = {}) {
 const r = runFactor(records, lost, {fromRound});
 if (!r) return null;
 const file = fileFor(dir, setup);
 await mkdir(dir, {recursive: true});
 // Two runners can finish at once: the read-modify-write holds <file>.lock, and each writes its own temp file.
 return withFileLock(file, async () => {
 const saved = JSON.parse(await readFile(file, 'utf8').catch(() => 'null')) ?? {setup: setupKey(setup), runs: []};
 saved.from_round = fromRound;
 saved.runs = [...saved.runs.filter(x => x.run !== run), {run, time: now().toISOString(), ...r}].slice(-KEEP_RUNS);
 saved.factor = +clamp(median(saved.runs.map(x => x.factor))).toFixed(2);
 const temp = `${file}.${process.pid}.tmp`;
 await writeFile(temp, JSON.stringify(saved, null, 1) + '\n');
 await rename(temp, file);
 return {run: r, factor: saved.factor};
 });
}

// The interim factor from outcome bounds over many runs, for rounds from fromRound on: {factor, lower, upper,
// lower_q25, upper_q25}. The 25th percentile of the lower bounds above 1 (rounds where the estimate was below
// the RBE and the round was still cleared; a bound of 1 or less says nothing about a factor above 1), no
// higher than the 25th percentile of the upper bounds when there are at least MIN_ROUNDS of them, and within
// FACTOR_BOUNDS.
export function interimFactor(bounds, {fromRound = 1} = {}) {
 const lower = bounds.filter(b => b.round >= fromRound && b.kind === 'lower' && b.bound > 1).map(b => b.bound);
 const upper = bounds.filter(b => b.round >= fromRound && b.kind === 'upper').map(b => b.bound);
 if (lower.length < MIN_ROUNDS) return {factor: 1, lower: lower.length, upper: upper.length, lower_q25: null, upper_q25: null};
 const lo = quantile(lower, 0.25), hi = upper.length >= MIN_ROUNDS ? quantile(upper, 0.25) : Infinity;
 return {factor: +clamp(Math.min(lo, hi)).toFixed(2), lower: lower.length, upper: upper.length, lower_q25: +lo.toFixed(2), upper_q25: Number.isFinite(hi) ? +hi.toFixed(2) : null};
}

// A factor pinned for a series (btd6:run --moab-factor / --pops-factor): used as given, whatever the setup's file
// says; the loaded calibration is kept beside it (stored) and runs keeps its count, so graded speed's
// composition cap still follows the measured runs.
export const pinCalibration = (loaded, factor) => ({...loaded, factor, source: 'pinned', stored: {factor: loaded.factor, source: loaded.source}});
