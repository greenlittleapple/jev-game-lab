// MOAB requirement replay: recomputes moab.mjs moabCheck for the logged decision states, with the requirement as it
// was before 2026-09-30 (each shell broken in the first half of the track, / estimate.mjs EFFICIENCY) and the current
// one (every MOAB-class bloon dead before the exit), both at one calibration factor. For each round: whether the
// logged decisions had v4's moab_short rule, whether the replayed check is short before and after, and the lives lost.
//   npm run btd6:moab-replay -- --factor 1.34                    (every run in .private/btd6/runs)
//   npm run btd6:moab-replay -- --factor 1.34 --runs jev-v6 --rounds 60-80
//   npm run btd6:moab-replay -- --dir <folder> --json
// Without --factor, each run uses its setup's stored factor from .private/btd6/calibration (--calibration <folder>).
// Paths: Monkey Meadow's track from fixtures/monkey-meadow.json for map Tutorial; other maps use the default length.
// A state is short when some MOAB-class round from its round to MOAB_LEAD_ROUNDS after it has damage below what it
// needs (policy-v4.mjs moabShort). The logged rule also needed an affordable purchase that adds MOAB damage, which
// the replay doesn't recheck, so "rule" counts only states that had the rule in the log.
// DDT replay (--ddt; moab.mjs DDT-capable damage, btd6-jev-v6 revision 13), counts only:
//   npm run btd6:moab-replay -- --ddt                     (Hard Standard and CHIMPS logs from --since, default 2026-09-30T10-00)
//  - for each moab_measure record whose types include a DDT: the measured damage per second, the logged estimate
//    (uncalibrated, as the meter logs it) and that times the record's factor, the DDT-capable estimate from the round's
//    first logged decision state (uncalibrated and times the same factor), and the lives lost that round;
//  - for CHIMPS logs, the rounds where some decision state has a due round short (policy-v4.mjs moabShort) with the DDT
//    check and not without it, at the run's factor (run_start calibration): those due rounds, and whether every such state
//    was already short without the check (for another round), so that only "no" rows are new moab_short flags.
// With support effects (--support; moab.mjs setDdtSupport, offline), CHIMPS logs only, --since default 2026-10-01T20-00:
//   npm run btd6:moab-replay -- --ddt --support --dir <runs folder> --calibration <calibration folder>
//  - for each moab_measure record whose types include a DDT: the measured damage per second, the DDT-capable estimate and
//    the support-effects estimate, each from the round's first logged decision state and times the record's factor, the
//    towers the support effects added (id: effects), and the lives lost that round;
//  - for DDT-only rounds (every type a DDT) and all DDT rounds: the median, minimum and maximum of measured / estimate for
//    each figure (records with an estimate of 0 left out and counted), and the Spearman rank correlation of measured with
//    each estimate (average ranks for ties).
import {readFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {margin, roundFacts} from './estimate.mjs';
import {moabBloons, moabCheck, moabDps, moabDpsRaw, moabDue, setMoabCalibration, trackLength, ddtSupport, MOAB_SPEED, MOAB_LEAD_ROUNDS} from './moab.mjs';
import {mapPaths} from './spot-catalog.mjs';
import {roundsOf} from './pops-calibration.mjs';
import {readRuns} from './rules-audit.mjs';
import {loadCalibration} from './moab-calibration.mjs';

const MEADOW = JSON.parse(readFileSync(new URL('./fixtures/monkey-meadow.json', import.meta.url), 'utf8'));
export const pathsFor = map => map === MEADOW.map ? mapPaths(MEADOW) : [];

// The requirement before 2026-09-30: toughest bloon's health over the time to cross the first half of the track,
// or the round's total over its sending time plus that crossing; x margin(lives, round) / 0.8.
export function needsBefore(round, {lives = 1, paths = []} = {}) {
 const list = moabBloons(round);
 if (!list.length) return null;
 const window = speed => 0.5 * trackLength(paths) / (MOAB_SPEED * speed);
 const toughest = Math.max(...list.map(b => b.hp / window(b.speed)));
 const hp = list.reduce((n, b) => n + b.hp * b.count, 0);
 const spread = hp / (roundFacts(round).seconds + Math.min(...list.map(b => window(b.speed))));
 return +(Math.max(toughest, spread) * margin(lives, round) / 0.8).toFixed(1);
}

// The due MOAB-class rounds for one state: [{round, dps, before, after}].
function dueChecks(state, paths) {
 const now = state.round.number, end = Math.min(state.match?.end_round ?? 100, now + MOAB_LEAD_ROUNDS), dps = moabDps(state.towers, paths);
 const out = [];
 for (let r = now; r <= end; r++) {
  const c = moabCheck(state.towers, r, {lives: state.lives, paths});
  if (c) out.push({round: r, dps, before: needsBefore(r, {lives: state.lives, paths}), after: c.needs_dps});
 }
 return out;
}

// One run's rounds with a MOAB-class round due: [{round, lost, leaked, rule, rule_before, rule_after, any_before,
// any_after, short_before, short_after, target, dps, before, after, measured}]. rule_*: some state that had the logged
// rule is short; any_*: some decision state is short (graded speed's moab_short signal); short_*: the due rounds some
// state was short for. target/dps/before/after: the round's first decision state, for the round itself when it
// sends MOAB-class bloons, else the weakest due round.
// The calibration factor must be set (setMoabCalibration) before.
export function replayRun(records, {paths = []} = {}) {
 const rounds = roundsOf(records), lost = new Map(rounds.map(r => [r.round, r.lost]));
 const measured = new Map(records.filter(r => r.kind === 'moab_measure').map(r => [r.round, r.measured_dps]));
 const rows = new Map();
 for (const rec of records) {
  if (rec.kind !== 'decision' || !rec.state?.in_game || !rec.state.round || !Array.isArray(rec.state.towers)) continue;
  const due = dueChecks(rec.state, paths);
  if (!due.length) continue;
  const n = rec.state.round.number, rule = (rec.constraint?.rules ?? []).some(x => x.kind === 'moab_short');
  const forBefore = due.filter(d => d.dps < d.before).map(d => d.round), forAfter = due.filter(d => d.dps < d.after).map(d => d.round);
  const shortBefore = forBefore.length > 0, shortAfter = forAfter.length > 0;
  if (!rows.has(n)) {
   const own = due.find(d => d.round === n) ?? [...due].sort((a, b) => a.dps / a.after - b.dps / b.after)[0];
   rows.set(n, {round: n, lost: lost.get(n) ?? 0, leaked: (lost.get(n) ?? 0) > 0 || (lost.get(n + 1) ?? 0) > 0,
    rule: false, rule_before: false, rule_after: false, any_before: false, any_after: false, short_before: new Set(), short_after: new Set(),
    target: own.round, dps: own.dps, before: own.before, after: own.after, measured: measured.get(n) ?? null});
  }
  const row = rows.get(n);
  row.any_before ||= shortBefore; row.any_after ||= shortAfter;
  for (const r of forBefore) row.short_before.add(r);
  for (const r of forAfter) row.short_after.add(r);
  if (rule) { row.rule = true; row.rule_before ||= shortBefore; row.rule_after ||= shortAfter; }
 }
 return [...rows.values()].sort((a, b) => a.round - b.round)
  .map(r => ({...r, short_before: [...r.short_before].sort((a, b) => a - b), short_after: [...r.short_after].sort((a, b) => a - b)}));
}

// Totals over runs ([{name, rows}]): rounds and rounds with lives lost (this round or the next) per flag.
export function totals(runs) {
 const out = {};
 for (const k of ['rule', 'rule_before', 'rule_after', 'any_before', 'any_after']) {
  const hit = runs.flatMap(r => r.rows).filter(row => row[k]);
  out[k] = {rounds: hit.length, leaked: hit.filter(row => row.leaked).length};
 }
 return out;
}

const yes = v => v ? 'yes' : '-', list = v => v.length ? v.join(' ') : '-';
export function formatReplay(runs, {from = 1, to = Infinity} = {}) {
 const t = totals(runs), line = k => `${t[k].rounds} rounds, ${t[k].leaked} with lives lost that round or the next`;
 const out = [`MOAB requirement replay over ${runs.length} run${runs.length === 1 ? '' : 's'}.`,
  `Logged moab_short rule: ${line('rule')}.`,
  `Those states replayed, before: ${line('rule_before')}; after: ${line('rule_after')}.`,
  `Every decision state, before: ${line('any_before')}; after: ${line('any_after')}.`];
 for (const {name, factor, rows} of runs) {
  const shown = rows.filter(r => r.round >= from && r.round <= to && (r.rule || r.any_before || r.any_after));
  if (!shown.length) continue;
  out.push('', `${name} (factor ${factor})`, 'round | target | dps | measured | needs before | needs after | rule logged | short for, before | short for, after | lives lost');
  for (const r of shown) out.push([r.round, r.target, r.dps, r.measured ?? '-', r.before, r.after, yes(r.rule), list(r.short_before), list(r.short_after), r.lost].join(' | '));
 }
 return out.join('\n');
}

// One run's DDT replay: {measures: [{round, types, measured, logged, logged_x, ddt, ddt_x, old, lost}], short: [{round,
// due, old_short, lost}]}; old_short: some state of the round with newly short due rounds was short without the check. old: the old estimate recomputed from the same state (uncalibrated), to check the state matches the meter's.
// chimps: also the moab_short rounds. Restores the calibration factor to 1. support: each measure also has support (the
// support-effects estimate, uncalibrated), support_x and effects (moab.mjs ddtSupport, the towers counted through a support).
export function ddtReplay(records, {paths = [], chimps = false, support = false} = {}) {
 const lost = new Map(roundsOf(records).map(r => [r.round, r.lost]));
 const decisions = records.filter(r => r.kind === 'decision' && r.state?.in_game && r.state.round && Array.isArray(r.state.towers));
 const first = new Map();
 for (const d of decisions) if (!first.has(d.state.round.number)) first.set(d.state.round.number, d.state);
 const r1 = v => +v.toFixed(1);
 const measures = records.filter(r => r.kind === 'moab_measure' && (r.types ?? []).some(t => /^Ddt/.test(t))).map(m => {
  const state = first.get(m.round), f = m.factor ?? 1;
  const ddt = state ? moabDpsRaw(state.towers, paths, {ddt: true, support: false}) : null;
  const row = {round: m.round, types: m.types, measured: m.measured_dps, logged: m.estimated_dps, logged_x: r1(m.estimated_dps * f), factor: f,
   ddt, ddt_x: ddt == null ? null : r1(ddt * f), old: state ? moabDpsRaw(state.towers, paths) : null, lost: lost.get(m.round) ?? 0};
  if (!support) return row;
  const sup = state ? moabDpsRaw(state.towers, paths, {ddt: true, support: true}) : null;
  const effects = state ? supportEffects(state.towers, paths) : [];
  return {...row, support: sup, support_x: sup == null ? null : r1(sup * f), effects};
 });
 const short = new Map();
 if (chimps) {
  setMoabCalibration(records.find(r => r.kind === 'run_start')?.calibration?.moab?.factor ?? 1);
  try {
   for (const {state} of decisions) {
    const opts = {lives: state.lives, paths, end: state.match?.end_round ?? 100};
    const was = moabDue(state.towers, state.round.number, {...opts, ddt: false}).filter(c => !c.enough).map(c => c.round);
    const now = moabDue(state.towers, state.round.number, {...opts, ddt: true}).filter(c => !c.enough && !was.includes(c.round)).map(c => c.round);
    if (!now.length) continue;
    const n = state.round.number, row = short.get(n) ?? {round: n, due: new Set(), old_short: false, lost: lost.get(n) ?? 0};
    for (const r of now) row.due.add(r);
    row.old_short ||= was.length > 0;
    short.set(n, row);
   }
  } finally { setMoabCalibration(1); }
 }
 return {measures, short: [...short.values()].sort((a, b) => a.round - b.round).map(r => ({...r, due: [...r.due].sort((a, b) => a - b)}))};
}

// The support effects that added towers to the DDT-capable figure, one string per supporting tower:
// "decamo by 79244 (WizardMonkey 023): 415 26524", the towers after the colon being the ones it added.
export function supportEffects(towers, paths = []) {
 const byId = new Map(towers.map(t => [t.id, t])), groups = new Map();
 for (const [id, v] of ddtSupport(towers, paths)) {
  if (!v.counts || v.via.includes('own')) continue;
  for (const via of v.via) { const list = groups.get(via) ?? []; list.push(id); groups.set(via, list); }
 }
 return [...groups].map(([via, ids]) => { const [kind, sid] = via.split(':'), s = byId.get(Number(sid)) ?? byId.get(sid);
  return `${kind} by ${sid}${s ? ` (${s.base_id} ${(s.tiers ?? []).join('')})` : ''}: ${ids.join(' ')}`; });
}
// Average ranks (ties share the mean rank).
const ranks = v => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = Array(v.length);
 for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; }
 return r; };
// Spearman's rank correlation (Pearson on average ranks), or null under 3 pairs or with no spread.
export function spearman(a, b) {
 if (a.length < 3) return null;
 const ra = ranks(a), rb = ranks(b), mean = x => x.reduce((n, y) => n + y, 0) / x.length, ma = mean(ra), mb = mean(rb);
 let num = 0, da = 0, db = 0;
 for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
 return da && db ? +(num / Math.sqrt(da * db)).toFixed(2) : null;
}
const median = v => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
// Summary of measured against one estimate field over rows: {n, zero, median, min, max, spearman}.
export function ratioSummary(rows, key) {
 const used = rows.filter(r => r[key] != null && r.measured != null), pos = used.filter(r => r[key] > 0), q = pos.map(r => r.measured / r[key]);
 const r2 = v => v == null ? null : +v.toFixed(2);
 return {n: used.length, zero: used.length - pos.length, median: r2(median(q)), min: r2(q.length ? Math.min(...q) : null), max: r2(q.length ? Math.max(...q) : null),
  spearman: spearman(used.map(r => r.measured), used.map(r => r[key]))};
}
export const ddtOnly = m => m.types.every(t => /^Ddt/.test(t));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const dir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs'));
 const calibration = resolve(flag('--calibration') ?? join(root, '.private/btd6/calibration'));
 const pinned = flag('--factor') == null ? null : Number(flag('--factor'));
 const [from, to] = (flag('--rounds') ?? '1-1000').split('-').map(Number);
 let logs;
 try { logs = readRuns(dir, flag('--runs')); } catch (error) { console.error(`Can't read the run logs in ${dir}: ${error.message}`); process.exit(2); }
 if (argv.includes('--ddt') && argv.includes('--support')) {
  const since = flag('--since') ?? '2026-10-01T20-00', out = [], all = [];
  for (const {name, records} of logs) {
   const setup = records.find(r => r.kind === 'session_start')?.setup;
   if (name < since || setup?.difficulty !== 'Hard' || setup.mode !== 'Clicks') continue;
   for (const m of ddtReplay(records, {paths: pathsFor(setup.map), support: true}).measures) {
    all.push(m);
    out.push([name.slice(0, 19), m.round, m.types.join('+'), m.measured, m.ddt_x ?? '-', m.support_x ?? '-', m.effects.length ? m.effects.join('; ') : '-', m.lost].join(' | '));
   }
  }
  const line = (label, rows) => ['ddt_x', 'support_x'].map(k => { const s = ratioSummary(rows, k);
   return `${label}, ${k === 'ddt_x' ? 'DDT-capable' : 'support effects'}: ${s.n} records (${s.zero} with estimate 0 left out of the ratios), measured/estimate median ${s.median}, min ${s.min}, max ${s.max}; Spearman ${s.spearman}`; });
  console.log(['DDT rounds, CHIMPS (moab_measure with a DDT): run | round | types | measured | DDT-capable x factor | support effects x factor | added by support (tower: effects) | lives lost', ...out,
   '', ...line('DDT-only rounds', all.filter(ddtOnly)), ...line('All DDT rounds', all)].join('\n'));
  process.exit(0);
 }
 if (argv.includes('--ddt')) {
  const since = flag('--since') ?? '2026-09-30T10-00', out = [], shorts = [];
  for (const {name, records} of logs) {
   const setup = records.find(r => r.kind === 'session_start')?.setup;
   if (name < since || setup?.difficulty !== 'Hard' || !['Standard', 'Clicks'].includes(setup.mode)) continue;
   const chimps = setup.mode === 'Clicks', r = ddtReplay(records, {paths: pathsFor(setup.map), chimps});
   for (const m of r.measures) out.push([name.slice(0, 19), chimps ? 'CHIMPS' : 'Standard', m.round, m.types.join('+'), m.measured, m.logged, m.logged_x, m.old ?? '-', m.ddt ?? '-', m.ddt_x ?? '-', m.lost].join(' | '));
   for (const s of r.short) shorts.push([name.slice(0, 19), s.round, s.due.join(' '), s.old_short ? 'yes' : 'no', s.lost].join(' | '));
  }
  console.log(['DDT rounds (moab_measure with a DDT): run | mode | round | types | measured | logged estimate | x factor | old recomputed | DDT-capable | x factor | lives lost', ...out,
   '', 'CHIMPS: rounds with due rounds short with the DDT check and not without: run | round | those due rounds | already short without it | lives lost', ...(shorts.length ? shorts : ['none'])].join('\n'));
  process.exit(0);
 }
 const runs = [];
 for (const {name, records} of logs) {
  const setup = records.find(r => r.kind === 'session_start')?.setup;
  if (!setup?.map) continue;
  const factor = pinned ?? (await loadCalibration(calibration, setup)).factor;
  setMoabCalibration(factor);
  const rows = replayRun(records, {paths: pathsFor(setup.map)});
  if (rows.length) runs.push({name, factor, rows});
 }
 if (!runs.length) { console.error('No run logs with MOAB-class rounds due.'); process.exit(1); }
 console.log(argv.includes('--json') ? JSON.stringify({totals: totals(runs), runs}, null, 1) : formatReplay(runs, {from, to}));
}
