// CHIMPS cash income per round, measured from run logs, and the expected income before a round (policy-v4.mjs ddtReach,
// from btd6-jev-v6 revision 22, btd6-playbook-v5 revision 26 and btd6-claude-v1 revision 25).
//   npm run btd6:income -- <runs dir>                      (the same as node integration/btd6/income.mjs <runs dir>)
//   node integration/btd6/income.mjs <runs dir>            (prints the per-round counts and medians)
//   node integration/btd6/income.mjs <runs dir> --write    (also writes data/income-chimps.json)
//
// data/income-chimps.json: {mode, rounds: [first, last], min_logs, logs, income: {round: median cash}, samples: {round: logs},
// filled: [rounds taken from a neighbour average]}. Numbers only. The committed file: 67 CHIMPS logs up to 2026-10-03T03-59;
// rounds 6 to 93 have 10 to 55 logs each, round 94 has 9 and rounds 95 to 100 none, so 94 to 100 are filled from rounds 91 to 93.
//
// How a round's income is measured, per CHIMPS match (Hard, Clicks; not a dry run): every decision is taken while a round is
// active, so the window for round r runs from the first decision seen in round r to the first decision seen in round r + 1
// (both must be in the log). Its income is the cash at the second minus the cash at the first, plus the cost of the purchases
// executed in between (the chosen label's "($cost)" of each place_tower or upgrade_tower decision whose dispatch result is
// executed). CHIMPS has no end-of-round bonus and no selling, so this is the cash from popping. The window starts where the
// first decision falls, not exactly at the round start; the shift is the same for every round, so the sum over several rounds
// is close. A round with fewer than MIN_LOGS logs (thin) takes the average of the FILL_SIDE nearest well-measured rounds on each side
// (filled; on one side only past the last measured round, so rounds 94 to 100 average rounds 91 to 93).
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const INCOME_FIRST = 6, INCOME_LAST = 100, MIN_LOGS = 10, FILL_SIDE = 3;
const here = dirname(fileURLToPath(import.meta.url));
const costOf = label => { const m = /\(\$(\d+)\)\s*$/.exec(label ?? ''); return m ? Number(m[1]) : null; };
const PURCHASES = new Set(['place_tower', 'upgrade_tower']);

// One log's records: {round: income} per CHIMPS match in it (a list of maps).
export function matchIncome(records) {
 if (records.some(r => r.kind === 'session_start' && r.dry_run === true)) return [];
 const out = [];
 let match = null, pending = null;
 const close = () => { if (match) out.push(match.income); match = null; };
 for (const r of records) {
  if (r.kind === 'decision' && r.state?.in_game && r.state.round && r.state.match) {
   const m = r.state.match;
   if (m.mode !== 'Clicks' || m.difficulty !== 'Hard') continue;
   if (!match || match.id !== m.id) { close(); match = {id: m.id, income: {}, round: null, cash: null, spent: 0}; }
   const n = r.state.round.number;
   if (match.round == null) { match.round = n; match.cash = r.state.cash; match.spent = 0; }
   else if (n !== match.round) {
    if (n === match.round + 1) match.income[match.round] = Math.round(r.state.cash - match.cash + match.spent);
    match.round = n; match.cash = r.state.cash; match.spent = 0;
   }
   pending = PURCHASES.has(r.chosen?.command?.action) ? costOf(r.chosen.label) : null;
  } else if (r.kind === 'dispatch' && r.outcome === 'executed' && PURCHASES.has(r.result?.action)) {
   if (match && r.result.status === 'executed' && pending != null) match.spent += pending;
   pending = null;
  } else if (r.kind === 'run_end') close();
 }
 close();
 return out;
}

const median = list => { const s = [...list].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

// runs: [{name, records}] (rules-audit.mjs readRuns). Returns the table as written to data/income-chimps.json.
export function incomeTable(runs, {first = INCOME_FIRST, last = INCOME_LAST, minLogs = MIN_LOGS} = {}) {
 const samples = {};
 let logs = 0;
 for (const {records} of runs) {
  const matches = matchIncome(records);
  if (matches.length) logs++;
  for (const m of matches) for (const [n, v] of Object.entries(m)) (samples[n] ??= []).push(v);
 }
 const income = {}, count = {}, filled = [];
 for (let n = first; n <= last; n++) { count[n] = samples[n]?.length ?? 0; if (count[n] >= minLogs) income[n] = Math.round(median(samples[n])); }
 const measured = Object.keys(income).map(Number);
 for (let n = first; n <= last; n++) {
  if (measured.includes(n)) continue;
  const below = measured.filter(k => k < n).slice(-FILL_SIDE), above = measured.filter(k => k > n).slice(0, FILL_SIDE), near = [...below, ...above];
  if (near.length) { income[n] = Math.round(near.reduce((s, k) => s + income[k], 0) / near.length); filled.push(n); }
 }
 return {mode: 'CHIMPS', rounds: [first, last], min_logs: minLogs, logs, income, samples: count, filled};
}

let table = null;
const loadTable = () => table ??= JSON.parse(readFileSync(join(here, 'data/income-chimps.json'), 'utf8'));
// For tests: a table in place of the data file (null restores it).
export function setIncomeTable(t) { table = t; }
// The expected cash income of rounds from to to (inclusive; none when to < from), from the CHIMPS table. Rounds outside it count 0.
export function expectedIncome(from, to) {
 const {income} = loadTable();
 let sum = 0;
 for (let n = from; n <= to; n++) sum += income[n] ?? 0;
 return sum;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), dir = argv.find(a => !a.startsWith('--'));
 if (!dir) { console.error('Usage: node integration/btd6/income.mjs <runs dir> [--write]'); process.exit(2); }
 const {readRuns} = await import('./rules-audit.mjs');
 const t = incomeTable(readRuns(resolve(dir)));
 const counts = Object.values(t.samples);
 console.log(`logs ${t.logs}; logs per round: min ${Math.min(...counts)}, median ${median(counts)}, max ${Math.max(...counts)}; filled: ${t.filled.join(', ') || 'none'}`);
 const thin = Object.entries(t.samples).filter(([, c]) => c < 10).map(([n, c]) => `${n}:${c}`);
 console.log(`rounds with fewer than 10 logs: ${thin.join(' ') || 'none'}`);
 for (let n = t.rounds[0]; n <= t.rounds[1]; n += 10) console.log(Array.from({length: 10}, (_, i) => n + i).filter(k => k <= t.rounds[1]).map(k => `${k}:${t.income[k]}(${t.samples[k]})`).join(' '));
 if (argv.includes('--write')) writeFileSync(join(here, 'data/income-chimps.json'), JSON.stringify(t) + '\n');
}
