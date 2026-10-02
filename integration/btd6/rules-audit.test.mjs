// Rule audit: rounds a rule or branch fired in, and whether that round or the next lost lives, per policy and band.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {audit, auditRun, formatAudit, readRuns} from './rules-audit.mjs';

const decision = (round, lives, rules = [], branches = [], policy = 'btd6-jev-v4') => ({kind: 'decision', policy,
 state: {in_game: true, round: {number: round, lives_lost: 0}, lives, towers: []},
 constraint: rules.length ? {kind: 'rules', rules: rules.map(kind => ({kind}))} : null, ...(branches.length ? {plan: {branches: branches.map(id => ({id}))}} : {})});

test('a round counts as leaked when it or the next round lost lives', () => {
 const run = [decision(38, 100, ['no_wait_behind']), decision(39, 100, ['no_wait_behind']), decision(39, 100), decision(40, 100, ['moab_short'], ['moab_first']), decision(40, 90), decision(41, 90)];
 assert.deepEqual(auditRun(run).map(r => [r.round, [...r.rules], r.leaked]),
  [[38, ['no_wait_behind'], false], [39, ['no_wait_behind'], true], [40, ['moab_short', 'branch:moab_first'], true], [41, [], false]]);
});

test('totals per rule, band and policy, and the table', () => {
 const a = [decision(38, 100, ['no_wait_behind']), decision(39, 100, ['no_wait_behind']), decision(40, 100, ['moab_short']), decision(40, 90), decision(41, 90)];
 const b = [{kind: 'run_start', policy: 'btd6-playbook-v5'}, decision(65, 100, ['no_wait_behind'], [], 'btd6-playbook-v5'), decision(66, 100)];
 const result = audit([{name: 'a', records: a}, {name: 'b', records: b}, {name: 'empty', records: []}]);
 assert.equal(result.runs, 2);
 const nwb = result.rules.no_wait_behind;
 assert.deepEqual([nwb.fired, nwb.leaked], [3, 1]);
 assert.deepEqual(nwb.bands, {'before 40': {fired: 2, leaked: 1}, '60+': {fired: 1, leaked: 0}});
 assert.deepEqual(nwb.policies, {'jev-v4': {fired: 2, leaked: 1}, 'playbook-v5': {fired: 1, leaked: 0}});
 const text = formatAudit(result);
 assert.match(text, /no_wait_behind \| 3 \| 1 \| 67% \| 2 \(50%\) \| - \| 1 \(100%\)/);
 assert.match(text, /moab_short \| 1 \(0%\) \| -/);
});

test('--runs keeps the logs whose names contain one of the texts', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'rules-audit-'));
 try {
  for (const name of ['2026-09-30T01-btd6-jev-v4.jsonl', '2026-09-30T02-btd6-playbook-v5.jsonl', 'notes.txt'])
   await writeFile(join(dir, name), JSON.stringify(decision(10, 100)) + '\nnot json\n');
  assert.deepEqual(readRuns(dir).map(r => r.name), ['2026-09-30T01-btd6-jev-v4.jsonl', '2026-09-30T02-btd6-playbook-v5.jsonl']);
  assert.deepEqual(readRuns(dir, 'playbook-v5').map(r => r.name), ['2026-09-30T02-btd6-playbook-v5.jsonl']);
  assert.equal(readRuns(dir, 'T01, T02').length, 2);
  assert.equal(readRuns(dir)[0].records.length, 2, 'a bad line is read as an empty record');
 } finally { await rm(dir, {recursive: true, force: true}); }
});
