// Per-run scorecard for BTD6 from the private run logs.
//   npm run btd6:scorecard [-- --json] [--since <ISO time>]
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {readRunEvents, readSeries, scoreRuns, table} from '../../core/scorecard.mjs';
import {runOf, scoreRun, SCORE_COLUMNS} from './progress.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = process.env.BTD6_LOG_DIR ?? resolve(root, '.private/btd6/runs');
const args = process.argv.slice(2), since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
const events = await readRunEvents(dir, ['run_start', 'decision', 'dispatch', 'run_end', 'strategy_request', 'strategy_adopted', 'profile_snapshot', 'profile_screen', 'profile_check', 'plan_target', 'moab_measure', 'pops_round', 'aim_check']);
const rows = scoreRuns(events, await readSeries(resolve(dir, '../series.jsonl')), {runOf, score: scoreRun})
 .filter(r => !since || r.started >= since);
console.log(args.includes('--json') ? JSON.stringify(rows, null, 1) : rows.length ? table(rows, SCORE_COLUMNS) : `No logged runs in ${dir}.`);
