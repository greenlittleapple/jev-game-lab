// Early ratios (data/early-ratios.json, read by early.mjs for the early_short rule): per base tower type, the measured
// pops over the estimate with reach (pops_round est_reach) in rounds EARLY_FROM to EARLY_TO of current-era Hard Standard
// runs (hard-rounds.mjs currentEra). Tower-rounds are pops-study.mjs's (pops_round records merged per round; the Monkey
// Ace's est_reach at its measured share in records written before it); those with no estimate or an estimate of 0 are
// left out. A type with fewer than MIN_TOWER_ROUNDS tower-rounds, and a type never seen, use the ratio over all types ('*').
//   npm run btd6:early-ratios [-- --dir <run logs>] [--write]
import {writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergePopsRounds} from './pops-study.mjs';
import {currentEra} from './hard-rounds.mjs';
import {codeProvenance} from './provenance.mjs';

export const EARLY_FROM = 3, EARLY_TO = 10, MIN_TOWER_ROUNDS = 30;
export const DATA_FILE = new URL('./data/early-ratios.json', import.meta.url);

const setupOf = records => records.find(r => r.kind === 'session_start')?.setup ?? records.find(r => r.kind === 'run_start')?.setup ?? null;
const r3 = v => +v.toFixed(3);

// runs: [{name, records}]. source: the commit recorded in the file.
export function buildEarlyRatios(runs, {source = null} = {}) {
 const used = runs.filter(r => { const s = setupOf(r.records); return s?.difficulty === 'Hard' && s?.mode === 'Standard' && currentEra(r.records); });
 const sums = new Map(), all = {pops: 0, est: 0, n: 0};
 let counted = 0;
 for (const run of used) {
  let any = false;
  for (const x of mergePopsRounds(run.records).values()) {
   if (!(x.round >= EARLY_FROM && x.round <= EARLY_TO)) continue;
   for (const t of x.towers) {
    if (!(t.er > 0) || !Number.isFinite(t.pops)) continue;
    const s = sums.get(t.type) ?? {pops: 0, est: 0, n: 0};
    s.pops += t.pops; s.est += t.er; s.n += 1; sums.set(t.type, s);
    all.pops += t.pops; all.est += t.er; all.n += 1; any = true;
   }
  }
  if (any) counted += 1;
 }
 const overall = all.est > 0 ? r3(all.pops / all.est) : 1;
 const types = Object.fromEntries([...sums.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([type, s]) => [type, {
  ratio: s.n >= MIN_TOWER_ROUNDS ? r3(s.pops / s.est) : overall, measured: r3(s.pops / s.est), tower_rounds: s.n, pops: Math.round(s.pops), est_reach: Math.round(s.est),
  ...(s.n >= MIN_TOWER_ROUNDS ? {} : {uses: '*'})}]));
 const times = used.map(r => r.records.find(x => x.kind === 'session_start')?.time).filter(Boolean).sort();
 return {generated_by: 'integration/btd6/early-ratios.mjs', source_commit: source,
  logs: {setup: 'Hard Standard', only: 'current era (hard-rounds.mjs currentEra)', rounds: [EARLY_FROM, EARLY_TO], runs: used.length, runs_with_towers: counted, from: times[0] ?? null, to: times.at(-1) ?? null},
  min_tower_rounds: MIN_TOWER_ROUNDS, all: {ratio: overall, tower_rounds: all.n, pops: Math.round(all.pops), est_reach: Math.round(all.est)}, types};
}

export function formatEarlyRatios(file) {
 const l = file.logs, out = [`Early ratios, ${l.setup}, rounds ${l.rounds[0]}-${l.rounds[1]}, ${l.runs} runs (${l.from} to ${l.to}), source ${file.source_commit}`,
  `all types: ${file.all.ratio} over ${file.all.tower_rounds} tower-rounds`, 'type | ratio used | measured/est_reach | tower-rounds'];
 for (const [type, t] of Object.entries(file.types)) out.push(`${type} | ${t.ratio}${t.uses ? ' (all types)' : ''} | ${t.measured} | ${t.tower_rounds}`);
 return out.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const {readRuns} = await import('./rules-audit.mjs');
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const dir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs'));
 let runs;
 try { runs = readRuns(dir); } catch (error) { console.error(`Can't read the run logs in ${dir}: ${error.message}`); process.exit(2); }
 const file = buildEarlyRatios(runs, {source: codeProvenance().lab_commit});
 console.log(formatEarlyRatios(file));
 if (argv.includes('--write')) { writeFileSync(DATA_FILE, JSON.stringify(file, null, 1) + '\n'); console.log(`\nWrote ${fileURLToPath(DATA_FILE)}.`); }
}
