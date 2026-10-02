import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readRunEvents, readSeries, scoreRuns, table} from './scorecard.mjs';

test('logs are streamed, filtered by kind and grouped by run with the series file joined', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-score-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const line = e => JSON.stringify(e) + '\n';
 await writeFile(join(dir, 'b.jsonl'), line({kind: 'decision', time: '2', run: 'r1'}) + line({kind: 'dispatch', time: '3', run: 'r1'}));
 await writeFile(join(dir, 'a.jsonl'), line({kind: 'decision', time: '1', run: 'r1'}) + line({kind: 'run_end', time: '4', run: 'r2'}));
 await writeFile(join(dir, 'series.jsonl'), line({run: 'r1', seed: 'S1', label: 'v0', mode: 'jev'}));
 const events = await readRunEvents(dir);
 assert.deepEqual(events.map(e => e.time), ['1', '4', '2'], 'files in name order, dispatch records skipped');
 const rows = scoreRuns(events, await readSeries(join(dir, 'series.jsonl')), {runOf: e => e.run, score: run => ({count: run.events.length, series_label: run.series?.label ?? null})});
 assert.deepEqual(rows, [
  {run: 'r1', started: '1', seed: 'S1', label: 'v0', series_mode: 'jev', count: 2, series_label: 'v0'},
  {run: 'r2', started: '4', seed: null, label: null, series_mode: null, count: 1, series_label: null}]);
 assert.equal(table(rows, [['Run', r => r.run], ['Events', r => r.count]]), 'Run | Events\nr1 | 2\nr2 | 1');
 assert.deepEqual(await readRunEvents(join(dir, 'missing')), []);
});
