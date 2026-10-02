// Version charts for BTD6, one per setup (Hard Standard, CHIMPS): renders
// docs/images/btd6-progress-<setup>-{light,dark}.svg and the README tables between
// <!-- btd6-progress:start --> and <!-- btd6-progress:end --> from docs/progress/btd6.json.
// With --refresh it first updates each listed run's setup, result, round, lives, tokens and speed from the private logs;
// a run recorded as "stopped" (it ended without a result) stays stopped while its log has no result, and a run's
// issues (known bugs that affected it, from the top-level issues list) are kept.
// With --add it first lists the logged runs that aren't in the file yet (progress.mjs addRuns), then refreshes.
//   npm run btd6:progress [-- --refresh | --add]
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {THEMES, progressSvg, progressTable, compactJson} from '../../core/progress-chart.mjs';
import {readRunEvents, readSeries, scoreRuns} from '../../core/scorecard.mjs';
import {runOf, scoreRun, setupViews, refreshRun, addRuns} from './progress.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataFile = resolve(root, 'docs/progress/btd6.json'), outDir = resolve(root, 'docs/images');
const data = JSON.parse(await readFile(dataFile, 'utf8'));
const add = process.argv.includes('--add');
if (add || process.argv.includes('--refresh')) {
 const dir = process.env.BTD6_LOG_DIR ?? resolve(root, '.private/btd6/runs');
 const events = await readRunEvents(dir, ['run_start', 'decision', 'dispatch', 'run_end', 'strategy_request', 'strategy_adopted', 'profile_snapshot', 'profile_screen', 'profile_check']);
 const scored = new Map(scoreRuns(events, await readSeries(resolve(dir, '../series.jsonl')), {runOf, score: scoreRun}).map(s => [s.run, s]));
 if (add) {
  const {added, skipped, unmatched} = addRuns(data, scored.values());
  for (const a of added) console.log(`Added ${a.run} to ${a.version}`);
  if (skipped.length) console.log(`Skipped ${skipped.length} run(s) with no moves: ${skipped.join(', ')}`);
  for (const u of unmatched) console.log(`Not added: ${u.run} (${u.policy !== undefined ? `policy ${u.policy}` : `setup ${u.setup}`}): ${u.reason}`);
  if (!added.length) console.log('No runs to add.');
 }
 for (const r of data.versions.flatMap(v => v.runs)) refreshRun(data, r, scored.get(r.run));
 await writeFile(dataFile, compactJson(data));
}
for (const r of data.versions.flatMap(v => v.runs)) if (!data.setups.some(s => s.id === r.setup)) throw Error(`Run ${r.run} has no known setup.`);
for (const n of data.notes ?? []) if (typeof n !== 'string' && !(n.setups?.length && n.setups.every(id => data.setups.some(s => s.id === id)))) throw Error(`Note "${n.text}" needs setups from the setups list.`);
for (const r of data.versions.flatMap(v => v.runs)) for (const id of r.issues ?? []) if (!(data.issues ?? []).some(i => i.id === id)) throw Error(`Run ${r.run} names issue ${id}, which is not in issues.`);
await mkdir(outDir, {recursive: true});
const views = setupViews(data);
for (const {setup, view} of views) for (const [mode, theme] of Object.entries(THEMES))
 await writeFile(resolve(outDir, `btd6-progress-${setup.id}-${mode}.svg`), progressSvg(view, theme));
const section = ({setup, view}) => [`### ${setup.label}`, '',
 '<picture>', `  <source media="(prefers-color-scheme: dark)" srcset="docs/images/btd6-progress-${setup.id}-dark.svg">`,
 `  <img alt="Round reached by each BTD6 run on ${setup.label}, by version" src="docs/images/btd6-progress-${setup.id}-light.svg">`, '</picture>', '',
 view.versions.length ? progressTable(view) : 'No runs yet.'].join('\n');
const readmeFile = resolve(root, 'README.md'), readme = await readFile(readmeFile, 'utf8');
const updated = readme.replace(/<!-- btd6-progress:start -->[\s\S]*?<!-- btd6-progress:end -->/,
 () => `<!-- btd6-progress:start -->\n\n${views.map(section).join('\n\n')}\n\n<!-- btd6-progress:end -->`);
if (updated !== readme) await writeFile(readmeFile, updated);
console.log(`Wrote the BTD6 progress charts (${views.map(v => v.setup.id).join(', ')}) to ${outDir}`);
