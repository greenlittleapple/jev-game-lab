import {test} from 'node:test';
import assert from 'node:assert/strict';
import {progressSvg, progressTable, compactJson, THEMES} from './progress-chart.mjs';

const data = {game: 'Test <game>', unit: 'round', max: 80, milestones: [{value: 40, label: 'MOAB'}, {value: 80, label: 'ZOMG'}],
 groups: [{id: 'jev', label: 'Jev only'}, {id: 'strategist', label: 'Jev + Claude strategist'}],
 versions: [
  {name: 'Jev v0', policy: 'btd6-jev-v0', group: 'jev', added: 'Baseline', runs: [{run: 'm1', seed: null, result: 'lost', value: 34}]},
  {name: 'Strategist v0', policy: 'btd6-strategist-v0', group: 'strategist', added: 'Plans', runs: [{run: 'm2', seed: 'A', result: 'won', value: 80}, {run: 'm3', seed: 'B', result: 'in progress', value: 50}]},
 ], notes: []};

test('the chart escapes text, plots finished runs only and marks wins', () => {
 const svg = progressSvg(data, THEMES.light);
 assert.match(svg, /Test &lt;game&gt;/);
 assert.match(svg, />80<\/tspan><tspan fill="#006300"> ✓ won</);
 assert.equal(svg.match(/<circle [^>]*r="4.5"/g).length, 1, 'one lost run; the run in progress is not plotted');
 assert.doesNotMatch(svg, /NaN|undefined/);
});

test('an empty data file renders without errors', () => {
 const svg = progressSvg({...data, versions: []}, THEMES.dark);
 assert.match(svg, /No runs yet\./);
 assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
});

test('the table lists every run and the compact JSON round-trips', () => {
 assert.equal(progressTable(data), ['| Version | Final round of each run | What it added |', '|---|---|---|',
  '| Jev v0 (`btd6-jev-v0`) | 34 | Baseline |',
  '| Strategist v0 (`btd6-strategist-v0`) | **A: won (round 80)**, B: in progress (round 50) | Plans |'].join('\n'));
 assert.deepEqual(JSON.parse(compactJson(data)), data);
 assert.match(compactJson(data), /\n {4}\{"run": "m1", "seed": null, "result": "lost", "value": 34\},?\n/);
});

test('a run note (BTD6: lives left) follows the value in the chart and the table', () => {
 const noted = {...data, runNote: r => r.lives == null ? null : `${r.lives} lives`,
  versions: [{...data.versions[0], runs: [{run: 'm1', seed: null, result: 'lost', value: 34, lives: 0}, {run: 'm4', seed: null, result: 'lost', value: 30, lives: 12}]}]};
 assert.ok(progressSvg(noted, THEMES.light).includes('>34</tspan><tspan fill="#898781" font-weight="400"> · 0 lives</tspan>'));
 assert.ok(progressTable(noted).includes('| 34 (0 lives), 30 (12 lives) |'));
});
