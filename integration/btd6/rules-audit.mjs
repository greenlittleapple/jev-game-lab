// Rule audit: for each floor or plan rule and each playbook branch, the rounds it fired in and how many of those
// rounds lost lives (in that round or the next), per policy and by round band. A rule that fires mostly in rounds
// that lose nothing is a candidate for a miscalibrated estimate (docs/PLAN.md: run after every series).
//   npm run btd6:rules-audit                          (every run in .private/btd6/runs)
//   npm run btd6:rules-audit -- --runs playbook-v5    (runs whose file name contains the text; comma-separated for several)
//   npm run btd6:rules-audit -- --dir <folder> --json
//   npm run btd6:rules-audit -- --replay-threat         (adds "threat_short (replay)": the rounds where threat.mjs's rule,
//                                                        rebuilt on the logged states by threat-replay.mjs, fires or saves)
// Rounds and lives come from the decision states (pops-calibration.mjs roundsOf): lives lost in a round are the
// drop across its states and to the next round's first state. A round with no decision isn't seen.
import {readdirSync, readFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {roundsOf} from './pops-calibration.mjs';
import {replayRuns} from './threat-replay.mjs';

export const BANDS = [['before 40', 1, 39], ['40 to 59', 40, 59], ['60+', 60, Infinity]];
const bandOf = n => BANDS.find(([, lo, hi]) => n >= lo && n <= hi)[0];

// The rules and branches of one decision: floor and plan rule kinds, and "branch:<id>" for playbook branches.
export function firedIn(record) {
 const out = new Set((record.constraint?.rules ?? []).map(r => r.kind));
 for (const b of record.plan?.branches ?? []) out.add(`branch:${b.id}`);
 return out;
}

// One run's rows: [{round, rules: Set, leaked}]. leaked: lives lost in the round or the next.
// extra: Map(round -> Set of rule kinds) added to the logged ones (a replayed rule).
export function auditRun(records, extra = null) {
 const rounds = roundsOf(records), lost = new Map(rounds.map(r => [r.round, r.lost]));
 const rules = new Map();
 for (const r of records) {
  if (r.kind !== 'decision' || !r.state?.round) continue;
  const n = r.state.round.number;
  if (!rules.has(n)) rules.set(n, new Set());
  for (const k of firedIn(r)) rules.get(n).add(k);
 }
 for (const [n, kinds] of extra ?? []) { if (!rules.has(n)) rules.set(n, new Set()); for (const k of kinds) rules.get(n).add(k); }
 return rounds.map(r => ({round: r.round, rules: rules.get(r.round) ?? new Set(), leaked: (lost.get(r.round) ?? 0) > 0 || (lost.get(r.round + 1) ?? 0) > 0}));
}

const policyOf = records => (records.find(r => r.kind === 'run_start' || r.kind === 'session_start')?.policy ?? records.find(r => r.kind === 'decision')?.policy ?? 'unknown').replace(/^btd6-/, '');

// runs: [{name, records}]. Returns {runs, rules: {rule: {fired, leaked, bands: {band: {fired, leaked}}, policies: {policy: {fired, leaked}}}}}.
// replay(name, records): extra rule kinds per round for auditRun, or null.
export function audit(runs, {replay = null} = {}) {
 const rules = {};
 let counted = 0;
 for (const {name, records} of runs) {
  const rows = auditRun(records, replay?.(name, records));
  if (!rows.length) continue;
  counted++;
  const policy = policyOf(records);
  for (const row of rows) for (const k of row.rules) {
   const s = rules[k] ??= {fired: 0, leaked: 0, bands: {}, policies: {}};
   const add = x => { x.fired++; if (row.leaked) x.leaked++; };
   add(s); add(s.bands[bandOf(row.round)] ??= {fired: 0, leaked: 0}); add(s.policies[policy] ??= {fired: 0, leaked: 0});
  }
 }
 return {runs: counted, rules};
}

const share = x => x?.fired ? `${Math.round(100 * (1 - x.leaked / x.fired))}%` : '-';
const cell = x => x?.fired ? `${x.fired} (${share(x)})` : '-';
export function formatAudit({runs, rules}) {
 const sorted = Object.entries(rules).sort((a, b) => b[1].fired - a[1].fired);
 const lines = [`Rule audit over ${runs} run${runs === 1 ? '' : 's'}. Rounds fired, rounds with lives lost in that round or the next, and the share without a leak.`, '',
  ['rule', 'rounds fired', 'with lives lost', 'without a leak', ...BANDS.map(([b]) => `${b}: fired (no leak)`)].join(' | ')];
 for (const [k, s] of sorted) lines.push([k, s.fired, s.leaked, share(s), ...BANDS.map(([b]) => cell(s.bands[b]))].join(' | '));
 lines.push('', 'By policy: rounds fired (share without a leak)');
 const policies = [...new Set(sorted.flatMap(([, s]) => Object.keys(s.policies)))].sort();
 lines.push(['rule', ...policies].join(' | '));
 for (const [k, s] of sorted) lines.push([k, ...policies.map(p => cell(s.policies[p]))].join(' | '));
 return lines.join('\n');
}

// The replayed threat_short per run and round (threat-replay.mjs), for audit's replay option.
export function threatReplay(runs) {
 const byName = new Map(replayRuns(runs).map((r, i) => [runs[i].name, r.rows]));
 return name => {
  const out = new Map();
  for (const row of byName.get(name) ?? []) if (row.fired || row.saving != null) out.set(row.round, new Set(['threat_short (replay)']));
  return out;
 };
}

export function readRuns(dir, filter = null) {
 const parts = filter ? filter.split(',').map(s => s.trim()).filter(Boolean) : null;
 return readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!parts || parts.some(p => f.includes(p)))).sort()
  .map(name => ({name, records: readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } })}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const dir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs'));
 let runs;
 try { runs = readRuns(dir, flag('--runs')); } catch (error) { console.error(`Can't read the run logs in ${dir}: ${error.message}`); process.exit(2); }
 if (!runs.length) { console.error('No run logs match.'); process.exit(1); }
 const replay = argv.includes('--replay-threat') ? threatReplay(runs) : null;
 const result = audit(runs, {replay});
 console.log(argv.includes('--json') ? JSON.stringify(result, null, 1) : formatAudit(result));
}
