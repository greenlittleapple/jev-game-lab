// Per-run scorecard over the private JSONL run logs. The game supplies how to find a run's ID in
// an event and how to score one run; this module streams the logs, groups events by run and joins
// the series file (seed, label and mode recorded when each run was started).
// Adapted from integration/sts2/scorecard.mjs in jev-spire-strategist, which scored STS2 directly.
import {readFile, readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';

// Streamed: run logs outgrow the largest string readFile can return. Lines are filtered on the
// compact "kind" field before parsing.
export async function readRunEvents(dir, kinds = ['decision', 'run_end']) {
 const needles = kinds.map(k => `"kind":"${k}"`);
 const events = [];
 const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.jsonl')).sort();
 for (const file of files)
  for await (const line of createInterface({input: createReadStream(resolve(dir, file)), crlfDelay: Infinity}))
   if (needles.some(n => line.includes(n))) events.push(JSON.parse(line));
 return events;
}

export async function readSeries(file) {
 return (await readFile(file, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

// runOf(event) -> run ID or null; score({id, first, last, events}) -> one row.
export function scoreRuns(events, series, {runOf, score}) {
 // Later entries for a run (with a kind, such as profile_check) don't replace the one written at its start.
 const started = new Map(series.filter(r => !r.kind).map(r => [r.run, r]));
 const runs = new Map();
 for (const event of events) {
  const id = runOf(event);
  if (!id) continue;
  const run = runs.get(id) ?? {id, first: event.time, last: event.time, events: []};
  run.last = event.time;
  run.events.push(event);
  runs.set(id, run);
 }
 return [...runs.values()].map(run => {
  const s = started.get(run.id);
  return {run: run.id, started: run.first, seed: s?.seed ?? null, label: s?.label ?? null, series_mode: s?.mode ?? null, ...score({...run, series: s ?? null})};
 });
}

// columns: [[header, row => text], ...]
export function table(rows, columns) {
 return [columns.map(([h]) => h).join(' | '), ...rows.map(row => columns.map(([, cell]) => String(cell(row) ?? '-')).join(' | '))].join('\n');
}
