// Pops estimate study: measured over estimated pops per tower type from the pops_round records (pops.mjs), and how
// well each candidate pops margin separates rounds that lost lives from clean rounds. Data only; it changes no decision.
//   npm run btd6:pops-study                        (every run in .private/btd6/runs with pops_round records)
//   npm run btd6:pops-study -- --from 20 --json
//   npm run btd6:pops-study -- --verdicts [--tables current,candidate] [--json]   (enough and threat_short burst shares per policy and round band)
//   npm run btd6:pops-study -- --thresholds [--table candidate]   (GRADE_AT_CAMO: thresholds for the camo margin with the same clean-round shares)
//   npm run btd6:pops-study -- --fixes          (the candidate estimate's variants, estimate-candidate.mjs; nothing fitted)
// Tower-rounds: pops_round records merged per round (a round number that flickers at a round's end writes two records
// for it; the towers' pops are summed, the estimate is the first record's). est_reach is taken as logged, with the
// Monkey Ace at 0.1 of it in records written before its share (towers.mjs GLOBAL_SHARE) was applied. Tower-rounds
// with no estimate or an estimate of 0 (unaimed, no reach) are left out of the fits.
// Supply rules (FITS), each giving a factor per group (tower type, or type and path, groupKey):
//  - leak: rounds that lost lives with measured pops at least 0.5 of the RBE (pops-calibration.mjs MIN_POPS_SHARE);
//    the median of the towers' pops / est_reach.
//  - tight: rounds whose estimate, with the factors, is at most TIGHT x the RBE, or that lost lives; pops over
//    est_reach summed over the group, refitted TIGHT_PASSES times from factor 1.
//  - rel: every round with pops; a tower's pops against its est_reach times the round's measured / estimated pops
//    (so a round's supply scales every tower alike and cancels), summed over the group.
// A group with fewer than MIN_GROUP tower-rounds uses its type's factor, then the factor over all towers ('*').
// Margins: at each round's first decision state (pops-calibration.mjs roundsOf), as roundCheck with reach and factor
// 1, each tower's effective pops per second times its group factor. whole: the round's ratio (defenceMargins' pops,
// 0 when camo or Lead is missing); burst: the densest PEAK_SECONDS against its RBE (burstCheck); min: the smaller;
// graded: whole against moabCheck's ratio, the smaller (defenceMargins' margin). Fitted factors are given fitted on
// every run (in-sample) and on the other runs only (leave one run out).
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRuns} from './rules-audit.mjs';
import {roundsOf} from './pops-calibration.mjs';
import {pathsFor} from './moab-replay.mjs';
import {currentEra} from './hard-rounds.mjs';
import {roundCheck, effectivePps, towerEstimate, roundFacts, roundSeconds, EFFICIENCY, margin, PEAK_SECONDS, DWELL_SECONDS, BURST_FACTOR} from './estimate.mjs';
import {aimStatus} from './aim.mjs';
import {moabCheck} from './moab.mjs';
import {candidateCheck} from './estimate-candidate.mjs';
import {setTowerTable} from './towers.mjs';
import {defenceMargins, GRADE_AT} from './speed.mjs';
import {setMoabCalibration} from './moab.mjs';
import {setPopsCalibration} from './estimate.mjs';
import {loadCalibration} from './moab-calibration.mjs';
import {threatShort, THREAT_KINDS_V2} from './threat.mjs';

export const MIN_POPS_SHARE = 0.5, TIGHT = 1.5, TIGHT_PASSES = 4, MIN_GROUP = 3, THRESHOLDS = [2.0, 1.3, 1.0], CLEAN_SHARES = [0.7, 0.9, 0.95];
const median = list => { const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = v => v == null || !Number.isFinite(v) ? v : +v.toFixed(2);

// Path of a tower's tiers: '000', or the top path's index and 'hi' (tier 3 or more) or 'lo'; heroes 'h'.
export const pathOf = tiers => { if (!/^\d{3}$/.test(tiers)) return 'h'; const a = [...tiers].map(Number), m = Math.max(...a); return m === 0 ? '000' : `${a.indexOf(m)}${m >= 3 ? 'hi' : 'lo'}`; };
export const groupKey = (t, g) => g === 'type' ? t.type : g === 'path' ? `${t.type}:${pathOf(t.tiers)}` : `${t.type}:${t.tiers}`;
const stateTower = t => ({type: t.base_id, tiers: t.is_hero || t.base_id === 'Quincy' ? 'h' : (t.tiers ?? [0, 0, 0]).join('')});
const factorOf = (f, t, g) => f ? f.get(groupKey(t, g)) ?? f.get(groupKey(t, 'type')) ?? f.get('*') ?? 1 : 1;

// pops_round records merged per round: Map(round -> {round, rbe, pops, est (sum of est_reach), towers: [{type, tiers, pops, er}]}).
export function mergePopsRounds(records) {
 const out = new Map();
 const tower = t => ({id: t.id, type: t.base_id, tiers: t.is_hero || t.base_id === 'Quincy' ? 'h' : (t.tiers ?? []).join(''), pops: t.pops,
  er: t.base_id === 'MonkeyAce' && t.est_reach != null && t.est_reach === t.est ? t.est_reach * 0.1 : t.est_reach});
 for (const r of records.filter(r => r.kind === 'pops_round')) {
  const x = out.get(r.round);
  if (!x) { out.set(r.round, {round: r.round, rbe: r.rbe, towers: new Map(r.towers.map(t => [t.id, tower(t)]))}); continue; }
  for (const t of r.towers) { const y = x.towers.get(t.id); if (y) y.pops += t.pops; else x.towers.set(t.id, tower(t)); }
 }
 for (const x of out.values()) { x.towers = [...x.towers.values()]; x.pops = x.towers.reduce((n, t) => n + t.pops, 0); x.est = x.towers.reduce((n, t) => n + (t.er ?? 0), 0); }
 return out;
}

// One run: {name, era ('current' | 'earlier'), policy, paths, rounds: [{round, lost, state, pr}]}.
export function studyRun({name, records}) {
 const start = records.find(r => r.kind === 'run_start') ?? {}, session = records.find(r => r.kind === 'session_start');
 const pr = mergePopsRounds(records), paths = pathsFor(session?.setup?.map ?? start.setup?.map);
 return {name, era: currentEra(records) ? 'current' : 'earlier', policy: `${start.policy ?? '?'}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`, paths, measured: pr.size > 0,
  rounds: roundsOf(records).map(r => ({round: r.round, lost: r.lost, state: r.states[0], states: r.states, pr: pr.get(r.round)}))};
}

// Tower-rounds of runs usable for fitting: [{run, round, lost, rbe, pops, est, towers}].
const fitRounds = runs => runs.flatMap(run => run.rounds.filter(r => r.pr && r.pr.rbe > 0 && r.pr.est > 0).map(r => ({run: run.name, round: r.round, lost: r.lost, ...r.pr})));
function sumFactors(rounds, g, weight) {
 const acc = new Map();
 let P = 0, Q = 0;
 for (const r of rounds) {
  const w = weight(r);
  if (w == null) continue;
  for (const t of r.towers) {
   if (!(t.er > 0)) continue;
   P += t.pops; Q += t.er * w;
   for (const k of new Set([groupKey(t, g), groupKey(t, 'type')])) { const a = acc.get(k) ?? [0, 0, 0]; a[0] += t.pops; a[1] += t.er * w; a[2]++; acc.set(k, a); }
  }
 }
 const f = new Map([...acc].filter(([, [, q, n]]) => n >= MIN_GROUP && q > 0).map(([k, [p, q]]) => [k, p / q]));
 f.set('*', Q ? P / Q : 1);
 return f;
}
export const FITS = {
 leak(runs, g) {
  const acc = new Map();
  for (const r of fitRounds(runs).filter(r => r.lost > 0 && r.pops >= MIN_POPS_SHARE * r.rbe)) for (const t of r.towers) if (t.er > 0)
   for (const k of ['*', ...new Set([groupKey(t, g), groupKey(t, 'type')])]) { if (!acc.has(k)) acc.set(k, []); acc.get(k).push(t.pops / t.er); }
  return new Map([...acc].filter(([k, v]) => k === '*' || v.length >= MIN_GROUP).map(([k, v]) => [k, median(v)]));
 },
 tight(runs, g) {
  const all = fitRounds(runs);
  let f = null;
  for (let i = 0; i < TIGHT_PASSES; i++) {
   const est = r => r.towers.reduce((n, t) => n + (t.er ?? 0) * factorOf(f, t, g), 0);
   f = sumFactors(all.filter(r => r.lost > 0 || est(r) <= TIGHT * r.rbe), g, () => 1);
  }
  return f;
 },
 rel: (runs, g) => sumFactors(fitRounds(runs), g, r => r.pops > 0 ? r.pops / r.est : null),
};

// Measured over estimated per group, under each supply rule: [{group, tower_rounds, runs, all_median, all_sum, leak, leak_n, tight, rel}].
export function factorTable(runs, g = 'type') {
 const rounds = fitRounds(runs), rows = new Map();
 for (const r of rounds) for (const t of r.towers) {
  if (!(t.er > 0)) continue;
  const k = groupKey(t, g);
  if (!rows.has(k)) rows.set(k, {ratios: [], p: 0, q: 0, runs: new Set(), leak: 0});
  const x = rows.get(k);
  x.ratios.push(t.pops / t.er); x.p += t.pops; x.q += t.er; x.runs.add(r.run);
  if (r.lost > 0 && r.pops >= MIN_POPS_SHARE * r.rbe) x.leak++;
 }
 const fits = Object.fromEntries(Object.entries(FITS).map(([n, fit]) => [n, fit(runs, g)]));
 return [...rows].sort((a, b) => b[1].ratios.length - a[1].ratios.length).map(([k, x]) => ({group: k, tower_rounds: x.ratios.length, runs: x.runs.size,
  all_median: r2(median(x.ratios)), all_sum: r2(x.p / x.q), leak: r2(fits.leak.get(k) ?? null), leak_n: x.leak, tight: r2(fits.tight.get(k) ?? null), rel: r2(fits.rel.get(k) ?? null)}));
}

// Margins for a state under factors (null: the current estimate): {whole, burst, min, graded, base}. fixes: the
// candidate estimate's options (estimate-candidate.mjs: camo, purple; table: towers.mjs setTowerTable), used instead of factors.
export function marginsFor(state, round, paths, factors = null, g = 'type', fixes = null) {
 const c = roundCheck(state.towers, round, {lives: state.lives, paths, useReach: true, factor: 1});
 if (!c) return null;
 if (fixes) {
  setTowerTable(fixes.table ?? 'current');
  const x = candidateCheck(state.towers, round, {lives: state.lives, paths, ...fixes}), covered = c.camo !== false && c.lead !== false;
  const whole = covered ? x.ratio : 0, burst = covered ? x.burst ?? x.ratio : 0, m = moabCheck(state.towers, round, {lives: state.lives, paths});
  setTowerTable('current');
  return {whole, burst, min: Math.min(whole, burst), graded: m ? Math.min(whole, m.ratio) : whole, base: c.ratio};
 }
 let pps = 0;
 for (const t of state.towers) {
  if (aimStatus(t, paths).kind === 'unaimed' || !(towerEstimate(t)?.pps > 0)) continue;
  pps += (effectivePps(t, paths) ?? 0) * factorOf(factors, stateTower(t), g);
 }
 const r = roundFacts(round), L = margin(state.lives, round), covered = c.camo !== false && c.lead !== false;
 const whole = covered ? pps * roundSeconds(round) * EFFICIENCY / Math.ceil(r.rbe * L) : 0;
 const burst = !covered ? 0 : r.peak > 0 ? pps * (PEAK_SECONDS + DWELL_SECONDS) * EFFICIENCY * BURST_FACTOR / Math.ceil(r.peak * L) : null;
 const m = moabCheck(state.towers, round, {lives: state.lives, paths});
 return {whole, burst, min: Math.min(whole, burst ?? Infinity), graded: m ? Math.min(whole, m.ratio) : whole, base: c.ratio};
}

// The candidates: the current estimate, and each fit by type and by path.
export const CANDIDATES = [{name: 'current', fit: null, g: 'type'}, ...Object.keys(FITS).flatMap(fit => ['type', 'path'].map(g => ({name: `${fit}/${g}`, fit, g})))];

// The candidate estimate's variants (pops-study --fixes): the table from before on-damage projectiles were counted
// (towers-v4.json), towers.json (Fix 1), and towers.json with the camo margin (Fix 2) and the Purple margin.
export const FIXES = [{name: 'before fix 1 (towers-v4.json)', fixes: {table: 'v4'}}, {name: 'towers.json', fixes: {}}, {name: 'fix 2 (camo margin) on towers-v4.json', fixes: {table: 'v4', camo: true}},
 {name: 'fixes 1 and 2', fixes: {camo: true}}, {name: 'fixes 1 and 2, purple margin', fixes: {camo: true, purple: true}}];

// Rows [{run, round, lost, whole, burst, min, graded}] for one candidate over runs (from round `from`); loo: factors fitted
// without the run itself. fitRuns: the runs the factors are fitted on (by default the evaluated runs).
export function candidateRows(runs, cand, {loo = true, from = 1, fitRuns = runs} = {}) {
 const all = cand.fit ? FITS[cand.fit](fitRuns, cand.g) : null, rows = [];
 for (const run of runs) {
  const f = !cand.fit ? null : loo && fitRuns.includes(run) ? FITS[cand.fit](fitRuns.filter(x => x !== run), cand.g) : all;
  for (const r of run.rounds) {
   if (!r.state || r.round < from) continue;
   const m = marginsFor(r.state, r.round, run.paths, f, cand.g, cand.fixes ?? null);
   if (m) rows.push({run: run.name, round: r.round, lost: r.lost, ...m});
  }
 }
 return rows;
}

// Separation at thresholds for one margin column: leak rounds (lives lost; and more than 5) below each threshold, clean
// rounds at or above it, with counts; the thresholds at which CLEAN_SHARES of the clean rounds are at or above, and the
// leak rounds below those; and the within-round AUC (the share of same-round pairs where the leak round's margin is
// below the clean round's; 0.5 is no separation).
export function separation(rows, col) {
 const val = r => r[col] ?? r.whole;
 const leak = rows.filter(r => r.lost > 0).map(val), big = rows.filter(r => r.lost > 5).map(val), clean = rows.filter(r => !r.lost).map(val);
 const below = (a, t) => a.filter(v => v < t).length, atOrAbove = (a, t) => a.filter(v => v >= t).length;
 const at = t => ({threshold: r2(t), leak_below: below(leak, t), big_below: below(big, t), clean_at_or_above: atOrAbove(clean, t)});
 const sorted = [...clean].sort((a, b) => b - a);
 let pairs = 0, score = 0;
 for (const rs of Map.groupBy(rows, r => r.round).values()) {
  const L = rs.filter(r => r.lost > 0), C = rs.filter(r => !r.lost);
  for (const a of L) for (const b of C) { pairs++; score += val(a) < val(b) ? 1 : val(a) === val(b) ? 0.5 : 0; }
 }
 return {counts: {leak: leak.length, big: big.length, clean: clean.length}, graded: THRESHOLDS.map(at),
  matched: CLEAN_SHARES.map(q => ({clean_share: q, ...at(sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0)})), within_round_auc: pairs ? +(score / pairs).toFixed(3) : null, pairs};
}

// Graded margins (speed.mjs defenceMargins, MOAB part included) at each round's first decision state, each run at the
// calibration factors it was played with (session_start; else the setup's stored MOAB factor), as speed-replay.mjs
// does: [{run, round, lost, margin}]. table: towers.mjs setTowerTable; camo: defenceMargins' camo option.
export async function gradedRows(logs, {table = 'current', camo = false, calibrationDir} = {}) {
 const rows = [];
 setTowerTable(table);
 try {
  for (const {name, records} of logs) {
   const start = records.find(r => r.kind === 'session_start'), run = studyRun({name, records});
   if (!start?.setup) continue;
   const cal = start.calibration ?? {}, stored = calibrationDir ? await loadCalibration(calibrationDir, start.setup) : {factor: 1};
   setMoabCalibration(cal.moab?.factor ?? stored.factor);
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   for (const r of run.rounds) {
    if (!r.state) continue;
    const m = defenceMargins(r.state, run.paths, {camo});
    if (m.margin != null) rows.push({run: name, round: r.round, lost: r.lost, margin: m.margin});
   }
  }
 } finally { setTowerTable('current'); setMoabCalibration(1); setPopsCalibration(1); }
 return rows;
}
// Verdicts on every logged decision state under two tower tables: per policy and round band, the states, the share whose
// roundCheck verdict (reach, the run's played calibration) is enough, and the share where threat_short (THREAT_KINDS_V2,
// the default lead) has burst missing. {[policy]: {[band]: {states, [table]: {enough, burst}}}}.
export const BANDS = [[1, 39], [40, 59], [60, 80]];
export async function verdictShift(logs, {tables = ['current', 'candidate'], calibrationDir} = {}) {
 const out = {};
 try {
  for (const {name, records} of logs) {
   const start = records.find(r => r.kind === 'session_start'), runStart = records.find(r => r.kind === 'run_start');
   if (!start?.setup) continue;
   const policy = `${runStart?.policy ?? start.policy ?? '?'}`, paths = pathsFor(start.setup.map);
   const cal = start.calibration ?? {}, stored = calibrationDir ? await loadCalibration(calibrationDir, start.setup) : {factor: 1};
   setMoabCalibration(cal.moab?.factor ?? stored.factor);
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   for (const r of records) {
    const s = r.kind === 'decision' && r.state?.in_game && !r.state.match?.result ? r.state : null;
    if (!s?.round || !Array.isArray(s.towers)) continue;
    const band = BANDS.find(([a, b]) => s.round.number >= a && s.round.number <= b);
    if (!band) continue;
    const x = ((out[policy] ??= {})[band.join('-')] ??= {states: 0});
    x.states++;
    for (const t of tables) {
     setTowerTable(t);
     const c = roundCheck(s.towers, s.round.number, {lives: s.lives, paths, useReach: true}), short = threatShort(s, paths, {kinds: THREAT_KINDS_V2});
     const y = (x[t] ??= {enough: 0, burst: 0});
     if (c?.enough) y.enough++;
     if (short?.missing.includes('burst')) y.burst++;
    }
    setTowerTable('current');
   }
  }
 } finally { setTowerTable('current'); setMoabCalibration(1); setPopsCalibration(1); }
 return out;
}

// Thresholds for a new margin that keep the shares of clean rounds at or above each of the base thresholds: for each
// threshold, the share of the base rows' clean rounds at or above it, then the new rows' clean margin at that share
// (the largest value with at least that share at or above it). [{base, share, threshold}].
export function matchThresholds(baseRows, newRows, thresholds = GRADE_AT.map(([at]) => at)) {
 const clean = rows => rows.filter(r => !r.lost).map(r => r.margin).sort((a, b) => b - a);
 const base = clean(baseRows), next = clean(newRows);
 return thresholds.map(t => {
  const share = base.filter(v => v >= t).length / base.length;
  return {base: t, share: +share.toFixed(4), threshold: next[Math.max(0, Math.ceil(share * next.length) - 1)]};
 });
}

// Margins at the start of a round in every run that reached it: [{run, policy, era, lost, [candidate]: {whole, burst}}].
export function roundTable(allRuns, fitRuns, round) {
 const out = new Map();
 for (const cand of CANDIDATES) for (const row of candidateRows(allRuns, cand, {fitRuns, from: round}).filter(r => r.round === round)) {
  const run = allRuns.find(r => r.name === row.run);
  if (!out.has(row.run)) out.set(row.run, {run: row.run, policy: run.policy, era: run.era, measured: run.measured, lost: row.lost});
  out.get(row.run)[cand.name] = {whole: r2(row.whole), burst: r2(row.burst)};
 }
 return [...out.values()];
}

const pct = (n, d) => d ? `${Math.round(100 * n / d)}% (${n}/${d})` : '-';
function formatSeparation(name, s) {
 const c = s.counts;
 return [`${name}: within-round AUC ${s.within_round_auc} (${s.pairs} pairs)`,
  ...[['graded', s.graded], ['matched', s.matched]].map(([k, list]) => `  ${k === 'graded' ? 'thresholds' : 'clean-share thresholds'}: ` + list.map(x =>
   `${x.threshold}${x.clean_share ? ` [${x.clean_share * 100}% clean]` : ''}: lost lives below ${pct(x.leak_below, c.leak)}, lost >5 below ${pct(x.big_below, c.big)}, clean at or above ${pct(x.clean_at_or_above, c.clean)}`).join('; '))].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const dir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs')), from = Number(flag('--from') ?? 1), round = Number(flag('--round') ?? 78);
 let logs;
 try { logs = readRuns(dir, flag('--runs')); } catch (error) { console.error(`Can't read the run logs in ${dir}: ${error.message}`); process.exit(2); }
 const all = logs.filter(r => r.records.some(x => x.kind === 'decision' && x.state?.in_game)).map(studyRun), runs = all.filter(r => r.measured);
 if (!runs.length) { console.error('No run logs with pops_round records.'); process.exit(1); }
 if (argv.includes('--verdicts')) {
  // roundCheck's enough and threat_short's burst on every logged decision state, towers.json against towers-candidate.json.
  const calibrationDir = resolve(flag('--calibration') ?? join(root, '.private/btd6/calibration'));
  const tables = (flag('--tables') ?? 'current,candidate').split(','), v = await verdictShift(logs, {tables, calibrationDir});
  if (argv.includes('--json')) { console.log(JSON.stringify(v, null, 1)); process.exit(0); }
  const pct = (n, d) => d ? `${Math.round(100 * n / d)}%` : '-';
  console.log(`policy | rounds | states | ${tables.map(t => `${t}: enough, burst`).join(' | ')}`);
  for (const [policy, bands] of Object.entries(v)) for (const [band, x] of Object.entries(bands))
   console.log([policy, band, x.states, ...tables.map(t => `${pct(x[t].enough, x.states)}, ${pct(x[t].burst, x.states)}`)].join(' | '));
  process.exit(0);
 }
 if (argv.includes('--thresholds')) {
  // GRADE_AT_CAMO: the camo margin on a table (--table: current, i.e. towers.json, by default; candidate for
  // towers-candidate.json) against the margin series 5 played with (towers-v4.json, no camo).
  const calibrationDir = resolve(flag('--calibration') ?? join(root, '.private/btd6/calibration')), table = flag('--table') ?? 'current';
  const measured = logs.filter(r => r.records.some(x => x.kind === 'pops_round'));
  const base = await gradedRows(measured, {table: 'v4', calibrationDir}), fix1 = await gradedRows(measured, {table, calibrationDir}), camo = await gradedRows(measured, {table, camo: true, calibrationDir});
  const out = {table, rounds: base.length, clean: base.filter(r => !r.lost).length, against_v4: matchThresholds(base, camo), against_fix1: matchThresholds(fix1, camo), fix1_against_v4: matchThresholds(base, fix1)};
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
 }
 if (argv.includes('--fixes')) {
  // Nothing is fitted, so there is no leave-one-out; the same rows serve every round range.
  const result = {};
  for (const cand of FIXES) {
   const rows = candidateRows(runs, cand, {loo: false}), r78 = candidateRows(all, cand, {loo: false, from: round}).filter(x => x.round === round);
   result[cand.name] = {all: {whole: separation(rows, 'whole'), burst: separation(rows, 'burst')}, from30: {whole: separation(rows.filter(x => x.round >= 30), 'whole'), burst: separation(rows.filter(x => x.round >= 30), 'burst')},
    round: r78.map(x => { const run = all.find(y => y.name === x.run); return {run: x.run, policy: run.policy, era: run.era, lost: x.lost, whole: r2(x.whole), burst: r2(x.burst)}; })};
  }
  if (argv.includes('--json')) { console.log(JSON.stringify(result, null, 1)); process.exit(0); }
  for (const [name, x] of Object.entries(result)) {
   console.log(`\n== ${name}`);
   for (const span of ['all', 'from30']) for (const col of ['whole', 'burst']) console.log(formatSeparation(`${span === 'all' ? 'all rounds' : 'from round 30'} ${col}`, x[span][col]));
   console.log(`  round ${round} start (run | policy | era | lives lost | whole / burst): ` + x.round.map(y => `${y.run.slice(11, 19)} ${y.policy} ${y.era} ${y.lost}: ${y.whole}/${y.burst}`).join('; '));
  }
  process.exit(0);
 }
 const fitted = fitRounds(runs);
 const result = {
  data: {runs: runs.length, rounds: runs.reduce((n, r) => n + r.rounds.filter(x => x.state && x.round >= from).length, 0), fit_rounds: fitted.length,
   leak_fit_rounds: fitted.filter(r => r.lost > 0 && r.pops >= MIN_POPS_SHARE * r.rbe).length, tower_rounds: fitted.reduce((n, r) => n + r.towers.filter(t => t.er > 0).length, 0),
   tower_rounds_left_out: fitted.reduce((n, r) => n + r.towers.filter(t => !(t.er > 0)).length, 0)},
  factors: {type: factorTable(runs, 'type'), path: factorTable(runs, 'path')},
  separation: {},
  round: {round, runs: roundTable(all, runs, round)},
 };
 for (const cand of CANDIDATES) for (const loo of cand.fit ? [true, false] : [false]) {
  const rows = candidateRows(runs, cand, {loo, from});
  for (const col of ['whole', 'burst', 'min', 'graded']) result.separation[`${cand.name}${cand.fit ? (loo ? ' (leave one run out)' : ' (in-sample)') : ''} ${col}`] = separation(rows, col);
 }
 if (argv.includes('--json')) { console.log(JSON.stringify(result, null, 1)); process.exit(0); }
 const d = result.data;
 console.log(`Pops study over ${d.runs} runs with pops_round records: ${d.rounds} rounds with a first state from round ${from}; ${d.fit_rounds} measured rounds, ${d.leak_fit_rounds} of them lost lives with pops at least ${MIN_POPS_SHARE} of the RBE; ${d.tower_rounds} tower-rounds (${d.tower_rounds_left_out} without an estimate above 0 left out).`);
 for (const g of ['type', 'path']) {
  console.log('', `Measured / est_reach by ${g}: group | tower-rounds | runs | all: median, sum | leak rounds: median (tower-rounds) | tight | rel`);
  for (const x of result.factors[g]) console.log([x.group, x.tower_rounds, x.runs, `${x.all_median}, ${x.all_sum}`, `${x.leak ?? '-'} (${x.leak_n})`, x.tight ?? '-', x.rel ?? '-'].join(' | '));
 }
 console.log('');
 for (const [k, s] of Object.entries(result.separation)) console.log(formatSeparation(k, s));
 const names = CANDIDATES.map(c => c.name);
 console.log('', `Round ${round} start: run | policy | era | lives lost | ${names.map(n => `${n} whole/burst`).join(' | ')}`);
 for (const x of result.round.runs) console.log([x.run.slice(11, 19), x.policy, x.era + (x.measured ? '' : ' (no pops_round)'), x.lost, ...names.map(n => x[n] ? `${x[n].whole}/${x[n].burst}` : '-')].join(' | '));
}
