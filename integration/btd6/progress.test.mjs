import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreRun, runOf, chartMilestones} from './progress.mjs';
import {scoreRuns} from '../../core/scorecard.mjs';
import {describeState} from './runner.mjs';
import {round21} from './fixtures/index.mjs';

const at = (round, lives, cash = 500) => describeState({...round21(), round: {...round21().round, number: round}, lives, cash});
const decision = (state, extra = {}) => ({kind: 'decision', outcome: 'executed', time: `t${state.round.number}`, policy: 'btd6-strategist-v0', decisionSource: 'jev',
 usage: {input_tokens: 1000}, chosen: {command: {action: 'place_tower'}}, state, ...extra});

test('a run is scored by the round reached, lives, leaks, sources and strategist timing', () => {
 const events = [
  {kind: 'run_start', time: 't20', match_id: round21().match.id, ruleset: {id: 'btd6-open-v1', name: 'btd6-open', version: 1}, unlock_all: true},
  decision(at(21, 98)),
  {kind: 'strategy_request', time: 't21', match_id: round21().match.id},
  decision(at(22, 98), {decisionSource: 'plan', usage: null, chosen: {command: {action: 'upgrade_tower'}}, constraint: {rules: [{kind: 'planned_step'}]}}),
  {kind: 'strategy_adopted', time: 't23', match_id: round21().match.id, latency_ms: 64000, late: true},
  decision(at(24, 91)), decision(at(25, 85)),
  {kind: 'run_end', time: 't26', match_id: round21().match.id, result: 'defeat', state: at(26, 0, 130)},
 ];
 const [row] = scoreRuns(events, [], {runOf, score: scoreRun});
 assert.equal(row.run, round21().match.id);
 assert.equal(row.setup, 'Tutorial Hard Standard');
 assert.deepEqual([row.ruleset, row.unlock_all], ['btd6-open-v1', true]);
 assert.equal(row.result, 'lost');
 assert.equal(row.round_reached, 26);
 assert.equal(row.final_round, 80);
 assert.deepEqual(row.leak_rounds, [{round: 24, lives: 7}, {round: 25, lives: 6}, {round: 26, lives: 85}]);
 assert.deepEqual([row.placed, row.upgrades, row.moves], [3, 1, 4]);
 assert.deepEqual(row.sources, {jev: 3, plan: 1, rules: 0, single_option: 0});
 assert.equal(row.input_tokens, 3000);
 assert.deepEqual(row.strategist, {requests: 1, answers: 1, late: 1, median_latency_s: 64});
 assert.deepEqual(row.rules, {planned_step: {fired: 1}});
});

test('a win counts as the final round; milestones follow the setup', () => {
 const events = [decision(at(79, 100)), {kind: 'run_end', time: 't', match_id: round21().match.id, result: 'victory', state: at(80, 100)}];
 const [row] = scoreRuns(events, [], {runOf, score: scoreRun});
 assert.deepEqual([row.result, row.round_reached], ['won', 80]);
 assert.deepEqual(chartMilestones({start: 3, end: 80}).map(m => `${m.label} ${m.value}`), ['Camo 24', 'MOAB 40', 'BFB 60', 'ZOMG 80']);
});

test('a queued placement counts once its command settles as executed', () => {
 const id = round21().match.id;
 const events = [
  decision(at(21, 98), {outcome: 'queued', command_id: 'c1', result: {command_id: 'c1', status: 'queued'}}),
  {kind: 'dispatch', outcome: 'executed', match_id: id, command_id: 'c1', result: {command_id: 'c1', status: 'executed', tower_id: 5}},
  decision(at(22, 98), {outcome: 'queued', command_id: 'c2', result: {command_id: 'c2', status: 'queued'}}),
  {kind: 'dispatch', outcome: 'game_rejected', match_id: id, command_id: 'c2', result: {command_id: 'c2', status: 'rejected'}},
 ];
 const score = scoreRun({events});
 assert.equal(score.placed, 1);
 assert.equal(score.moves, 1);
 assert.equal(score.sources.jev, 1);
});

test('the scorecard shows the policy and counts moves decided by the v1 floor rules', () => {
 const rules = {kind: 'rules', rules: [{kind: 'no_wait_undefended', removed: 1}], removed: 1};
 const events = [decision(at(21, 98), {policy: 'btd6-jev-v1'}), decision(at(21, 98), {policy: 'btd6-jev-v1', decisionSource: 'rules', constraint: rules})];
 const score = scoreRun({events});
 assert.equal(score.policy, 'btd6-jev-v1');
 assert.equal(score.sources.rules, 1);
 assert.deepEqual(score.rules, {no_wait_undefended: {fired: 1}});
});

test('the progress data keeps Hard Standard and CHIMPS as separate series, with lives left on Hard Standard', async () => {
 const {setupViews, setupOf} = await import('./progress.mjs');
 const {readFile} = await import('node:fs/promises');
 const data = JSON.parse(await readFile(new URL('../../docs/progress/btd6.json', import.meta.url), 'utf8'));
 assert.deepEqual(data.setups.map(s => s.id), ['hard-standard', 'chimps']);
 assert.ok(data.versions.flatMap(v => v.runs).every(r => data.setups.some(s => s.id === r.setup)), 'every run names its setup');
 assert.equal(setupOf(data, 'Tutorial Hard Standard'), 'hard-standard');
 assert.equal(setupOf(data, 'Tutorial Hard CHIMPS'), 'chimps');
 const withRun = {...data, versions: data.versions.map(v => v.name === 'v3' ? {...v, runs: [{run: 'h1', setup: 'hard-standard', seed: null, result: 'lost', value: 34, lives: 0}]} : v)};
 const [hard, chimps] = setupViews(withRun).map(x => x.view);
 assert.deepEqual([hard.max, chimps.max], [80, 100]);
 assert.deepEqual(hard.milestones.map(m => m.label), ['Camo', 'MOAB', 'BFB', 'ZOMG']);
 const names = hard.versions.map(v => v.name);
 for (const name of ['v3', 'v4', 'v4 graded', 'Claude v1 adaptive', 'Playbook v5 graded']) assert.ok(names.includes(name), name);
 assert.ok(!names.some(n => /^v[012]\b/.test(n)), 'CHIMPS-only versions stay out of the Hard Standard series');
 assert.ok(chimps.versions.every(v => v.runs.every(r => r.setup === 'chimps')));
 assert.equal(hard.runNote(hard.versions[0].runs[0]), '0 lives left');
 assert.equal(chimps.runNote, undefined, 'one-life CHIMPS shows no lives note');
});

test('the progress data: every Hard Standard run by version, wins marked, no empty row for a version whose runs are all in speed series', async () => {
 const {setupViews} = await import('./progress.mjs');
 const {progressTable, progressSvg, THEMES, issueMarker} = await import('../../core/progress-chart.mjs');
 const {readFile} = await import('node:fs/promises');
 const data = JSON.parse(await readFile(new URL('../../docs/progress/btd6.json', import.meta.url), 'utf8'));
 const v = name => data.versions.find(x => x.name === name);
 assert.deepEqual(v('v3').runs.map(r => [r.result, r.value, r.lives, r.speed]), [['stopped', 16, 100, 1], ['stopped', 17, 51, 3], ['lost', 40, -9, 3],
  ['stopped', 10, 46, 3], ['stopped', 51, 40, 3], ['won', 80, 60, 3], ['lost', 75, -9, 5]]);
 assert.deepEqual(v('v4').runs.map(r => [r.result, r.value, r.speed]), [['lost', 31, 3], ['stopped', 20, 3], ['won', 80, 5],
  ['lost', 37, 'graded:10'], ['lost', 42, 'graded:10'], ['lost', 40, 'graded:10'], ['lost', 51, 5]]);
 assert.deepEqual([v('Claude v1').policy, v('Claude v1').group, v('Claude v1').runs.slice(0, 1).map(r => [r.result, r.lives, r.speed])], ['btd6-claude-v1', 'strategist', [['won', 96, 'adaptive:5/1']]]);
 assert.deepEqual([v('Playbook v5').policy, v('Playbook v5').group, v('Playbook v5').runs.slice(0, 3).map(r => r.value)], ['btd6-playbook-v5', 'playbook', [51, 56, 51]], 'revision 1');
 const hard = setupViews(data)[0].view;
 const rows = hard.versions.map(x => x.name);
 assert.ok(!rows.includes('Claude v1') && !rows.includes('Playbook v5'), 'no empty Claude v1 or Playbook v5 row: their runs are all in speed series');
 // Every row is "<version>[ r<revision>][ (<ruleset>)][ <speed series>]" and holds only runs of that kind.
 for (const row of hard.versions) for (const r of row.runs) assert.equal((r.revision ?? 1) > 1, / r\d+( |$)/.test(row.name), `${row.name}: ${r.run}`);
 const adaptive = hard.versions.find(x => x.name === 'Claude v1 adaptive').added;
 assert.ok(adaptive.startsWith('v4 plus a Claude strategist: ') && adaptive.endsWith('. Claude v1 with adaptive game speed (--speed adaptive)'), 'the series row starts with the version description');
 const table = progressTable(hard);
 assert.ok(table.includes('| v3 (`btd6-jev-v3`) | stopped at round 16 (100 lives left, speed 1)<sup>a,c</sup>, '), 'v3 row');
 assert.ok(table.includes('**won (round 80) (60 lives left, speed 3)**<sup>c</sup>, 75 (0 lives left, speed 5)<sup>c</sup> |'), 'v3 win and 5x loss');
 assert.ok(table.includes('| v4 (`btd6-jev-v4`) | 31 (0 lives left, speed 3)<sup>c</sup>, stopped at round 20 (67 lives left, speed 3)<sup>b,c</sup>, **won (round 80) (100 lives left, speed 5)** |'), 'v4 row');
 assert.ok(table.includes('**won (round 80) (96 lives left, speed adaptive:5/1)**<sup>f</sup>'), 'the strategist win');
 // Known issues: every tagged run names a listed issue; the table lists the markers it uses, with their fixes.
 const ids = data.issues.map(i => i.id);
 assert.equal(new Set(ids).size, ids.length, 'issue IDs are unique');
 for (const i of data.issues) assert.ok(i.label?.trim() && i.fixed?.trim(), `${i.id} has a label and a fix`);
 const allRuns = data.versions.flatMap(x => x.runs);
 for (const r of allRuns) for (const id of r.issues ?? []) assert.ok(ids.includes(id), `${r.run} names a listed issue (${id})`);
 const tagged = id => allRuns.filter(r => r.issues?.includes(id)).map(r => r.run).sort();
 for (const id of ids) assert.ok(tagged(id).length > 0, `${id} is used by at least one run`);
 assert.deepEqual(tagged('unknown-screen'), ['20260930T024959Z-1', '20260930T045438Z-1', '20260930T061331Z-3', '20260930T064116Z-1']);
 assert.deepEqual(tagged('stale-hold'), ['20260930T083944Z-2', '20260930T084943Z-4', '20260930T090138Z-6']);
 assert.equal(tagged('unaimed-towers').length, 12);
 assert.deepEqual(tagged('no-tower-data'), ['20260930T085518Z-5', '20260930T093057Z-5', '20260930T100711Z-3'], 'the runs that had Skywardens before the tower table had them');
 assert.deepEqual(tagged('majority-wait-spend'), ['20260930T100034Z-2']);
 assert.ok(table.includes("\n\n- <sup>a</sup> A screen the bridge didn't handle yet paused the runner, and the run was stopped. Fixed: bridge 0.3.5 to 0.3.10 handle these screens."));
 assert.ok(table.includes('\n- <sup>b</sup> Stopped by hand to restart the series at 5x speed.\n'), 'no fix for a stop that was not a bug');
 const hardIssues = new Set(hard.versions.flatMap(x => x.runs).flatMap(r => r.issues ?? []));
 assert.equal((table.match(/^- <sup>/gm) ?? []).length, hardIssues.size, 'one note per issue used on Hard Standard');
 assert.match(data.notes[0].text, /^Not listed: four records from a match-ID race/);
 const svg = progressSvg(hard, THEMES.light);
 assert.ok(svg.includes("Hollow dots: runs affected by a known issue (see the table notes)."));
 assert.match(svg, /Not listed: four records/);
 // Each note shows only on the charts of its setups: the race and store-ad records were Hard Standard starts.
 const chimps = setupViews(data).find(x => x.setup.id === 'chimps').view;
 assert.deepEqual([hard.notes.length, chimps.notes.length], [2, 1]);
 assert.doesNotMatch(progressSvg(chimps, THEMES.light), /Not listed: four records/);
 // One subtitle for every row: no single ruleset, since each row names its own.
 assert.ok(svg.includes("Monkey Meadow, Hard Standard (rounds 3 to 80, 100 lives); ruleset btd6-open-v1 unless the row names another"));
 // Hollow dots: finished runs with issues (stopped runs aren't plotted). v3 40, won 80, 75; v4 31; v4 graded 42; Claude v1 won 80;
 // v5 51, 56, 51; v5 r2 78; v5 r3 51; v6 78.
 const affected = hard.versions.flatMap(x => x.runs).filter(r => r.result !== 'stopped' && r.issues?.length).length;
 assert.equal((svg.match(/<circle [^>]*fill="#fcfcfb" stroke="/g) ?? []).length, affected, 'one hollow dot per finished run with a known issue');
 // In every setup, each run tagged with a known issue is drawn hollow (if finished) and marked with its letters in the table.
 for (const {setup, view} of setupViews(data)) {
  const runs = view.versions.flatMap(x => x.runs).filter(r => r.issues?.length);
  const setupSvg = progressSvg(view, THEMES.light), setupTable = progressTable(view);
  const finishedAffected = runs.filter(r => r.result !== 'stopped').length;
  assert.equal((setupSvg.match(/<circle [^>]*fill="#fcfcfb" stroke="/g) ?? []).length, finishedAffected, `${setup.id}: one hollow dot per finished affected run`);
  assert.equal(setupSvg.includes('Hollow dots: runs affected'), finishedAffected > 0, `${setup.id}: the hollow-dot legend shows when a run is affected`);
  const rowText = setupTable.split('\n').filter(l => l.startsWith('| ')).join('\n');
  assert.equal((rowText.match(/<sup>[a-z,]+<\/sup>/g) ?? []).length, runs.length, `${setup.id}: each affected run is marked in its table`);
  for (const r of runs) assert.ok(rowText.includes(`<sup>${r.issues.map(id => issueMarker(data, id)).join(',')}</sup>`), `${setup.id}: ${r.run} marked`);
 }
 for (const row of hard.versions) if (row.runs.some(r => r.result !== 'stopped')) assert.ok(svg.includes(`${row.name}: best round `), `summary lists ${row.name}`);
 const rowsWithWin = hard.versions.filter(x => x.runs.some(r => r.result === 'won')).length;
 assert.equal((svg.match(/✓ won/g) ?? []).length, rowsWithWin, 'each row whose best run won is marked');
 assert.ok(rowsWithWin >= 4);
 const groupColors = [...svg.matchAll(/<circle cx="30" cy="\d+" r="6" fill="(#[0-9a-f]+)"/g)].map(m => m[1]);
 assert.equal(new Set(groupColors).size, 3, 'each of the three groups has its own colour');
});

test('--add lists unlisted runs under the version with their policy, marks runs without a result stopped, and reports the rest', async () => {
 const {addRuns} = await import('./progress.mjs');
 const run = (id, policy, extra = []) => [{kind: 'run_start', time: `${id}-0`, match_id: id, speed: 5},
  ...(policy ? [decision(at(21, 98), {policy, match_id: id, time: `${id}-1`})] : []), ...extra];
 const events = [
  ...run('A', 'btd6-jev-v4', [{kind: 'run_end', time: 'A-2', match_id: 'A', result: 'defeat', state: at(30, 0)}]),
  ...run('B', 'btd6-jev-v4'),
  ...run('C', null),
  ...run('D', 'btd6-jev-v9'),
  ...run('E', 'btd6-jev-v4'),
 ];
 const scored = scoreRuns(events, [], {runOf, score: scoreRun});
 const data = {setups: [{id: 'hard-standard', match: 'Tutorial Hard Standard'}],
  versions: [{name: 'v4', policy: 'btd6-jev-v4', runs: [{run: 'E', setup: 'hard-standard', result: 'lost'}]}, {name: 'v5', policy: 'btd6-playbook-v5', runs: []}]};
 const out = addRuns(data, scored);
 assert.deepEqual(out.added, [{run: 'A', version: 'v4'}, {run: 'B', version: 'v4'}]);
 assert.deepEqual(out.skipped, ['C']);
 assert.deepEqual(out.unmatched, [{run: 'D', policy: 'btd6-jev-v9', reason: 'no version has this policy'}]);
 const [, a, b] = data.versions[0].runs;
 assert.deepEqual([a.run, a.setup, a.result, a.value, a.lives, a.speed, a.tokens], ['A', 'hard-standard', 'lost', 30, 0, 5, 1000]);
 assert.deepEqual([b.run, b.result, b.value], ['B', 'stopped', 21]);
 // A second pass adds nothing; a later refresh keeps B stopped until its log has a result.
 assert.deepEqual(addRuns(data, scored).added, []);
});

test('the scorecard\'s Pops column: measured pops against the estimate, and aim checks that rose', async () => {
 const {measuredPops, SCORE_COLUMNS} = await import('./progress.mjs');
 const events = [{kind: 'pops_round', pops: 50, est_reach: 100}, {kind: 'pops_round', pops: 300, est_reach: 100}, {kind: 'pops_round', pops: 80, est_reach: 100},
  {kind: 'pops_round', pops: 10, est_reach: 0}, {kind: 'aim_check', complete: true, gained: 40}, {kind: 'aim_check', complete: true, gained: 0}, {kind: 'aim_check', complete: false, gained: null}];
 const pops = measuredPops(events);
 assert.deepEqual(pops, {rounds: 3, median_ratio: 0.8, aim_checks: 2, aim_rose: 1});
 const column = SCORE_COLUMNS.find(([name]) => name === 'Pops')[1];
 assert.equal(column({pops}), 'x0.8 the estimate (3 rounds); aimed towers popping 1/2');
 assert.equal(column({pops: measuredPops([])}), '-');
});

test('a policy revision above 1 is its own series, named version, revision, ruleset, speed', async () => {
 const {speedSeries, withoutEmptyBase, refreshRun, addRuns} = await import('./progress.mjs');
 const v5 = {name: 'Playbook v5', policy: 'btd6-playbook-v5', group: 'playbook', added: 'v4 plus a playbook', runs: [
  {run: 'a', speed: 'graded:10'}, {run: 'b', speed: 'graded:10', revision: 2}, {run: 'c', speed: 5, revision: 2}, {run: 'd', speed: 'graded:10', revision: 2, ruleset: 'btd6-open-v3'}]};
 const rows = withoutEmptyBase(speedSeries([v5]));
 assert.deepEqual(rows.map(r => [r.name, r.runs.map(x => x.run).join('')]),
  [['Playbook v5 graded', 'a'], ['Playbook v5 r2', 'c'], ['Playbook v5 r2 graded', 'b'], ['Playbook v5 r2 (btd6-open-v3) graded', 'd']]);
 assert.deepEqual(rows.slice(1).map(r => r.added), ['Playbook v5 revision 2', 'Playbook v5 revision 2 with graded game speed (--speed graded)',
  'Playbook v5 revision 2 under ruleset btd6-open-v3 with graded game speed (--speed graded)']);
 assert.equal(rows[0].added, 'v4 plus a playbook. Playbook v5 with graded game speed (--speed graded)');
 // A run's revision comes from run_start's policy_revision; none is revision 1, stored only above 1. Issues are kept.
 const events = [{kind: 'run_start', time: 'R-0', match_id: 'R', speed: 'graded:10', policy_revision: 2, ruleset: {id: 'btd6-open-v2', name: 'btd6-open', version: 2}}, decision(at(21, 98), {policy: 'btd6-playbook-v5', match_id: 'R', time: 'R-1'}),
  {kind: 'run_start', time: 'S-0', match_id: 'S', speed: 'graded:10'}, decision(at(21, 98), {policy: 'btd6-playbook-v5', match_id: 'S', time: 'S-1'})];
 const scored = scoreRuns(events, [], {runOf, score: scoreRun});
 assert.deepEqual(scored.map(r => r.revision), [2, 1]);
 const data = {setups: [{id: 'hard-standard', match: 'Tutorial Hard Standard'}], versions: [{name: 'Playbook v5', policy: 'btd6-playbook-v5', runs: []}]};
 addRuns(data, scored);
 assert.deepEqual(data.versions[0].runs.map(r => [r.run, r.revision, r.ruleset]), [['R', 2, 'btd6-open-v2'], ['S', undefined, undefined]], 'btd6-open-v1 or none is not stored');
 const listed = {run: 'S', setup: 'hard-standard', result: 'lost', issues: ['stale-hold'], revision: 3};
 refreshRun(data, listed, scored[1]);
 assert.deepEqual([listed.revision, listed.issues], [undefined, ['stale-hold']]);
});

test('a row\'s win rate: the largest group of 5+ finished, untagged runs with the same speed and pinned factors', async () => {
 const {winRate, runCalibration, refreshRun, setupViews, RATE_MIN} = await import('./progress.mjs');
 const {progressTable, progressSvg, THEMES} = await import('../../core/progress-chart.mjs');
 assert.equal(RATE_MIN, 5);
 const cal = {moab: {factor: 1.27, source: 'pinned'}, pops: {factor: 1, from_round: 60, source: 'pinned'}};
 assert.deepEqual(runCalibration({calibration: cal}), {moab_factor: 1.27, pops_factor: 1, pinned: ['moab', 'pops']});
 assert.deepEqual(runCalibration({calibration: {...cal, moab: {factor: 0.8, source: 'measured (5 runs)'}}}).pinned, ['pops']);
 assert.equal(runCalibration({}), null, 'runs logged before calibration was recorded keep no factors');
 const data = {setups: [{id: 'hs', match: 'Tutorial Hard Standard'}]};
 const r = refreshRun(data, {run: 'a', issues: ['x']}, {setup: 'Tutorial Hard Standard', result: 'won', round_reached: 80, speed: 'graded:5', calibration: runCalibration({calibration: cal})});
 assert.deepEqual(Object.keys(r).slice(-4), ['moab_factor', 'pops_factor', 'pinned', 'issues']);
 assert.equal(refreshRun(data, r, {setup: 'Tutorial Hard Standard', result: 'won', round_reached: 80, calibration: null}).moab_factor, undefined);

 const run = (result, value, more = {}) => ({result, value, speed: 'graded:10+moab3+camo', moab_factor: 1.27, pops_factor: 1, pinned: ['moab', 'pops'], ...more});
 const five = [run('won', 80), run('won', 80), run('lost', 56), run('lost', 56), run('won', 80)];
 assert.deepEqual(winRate(five), {won: 3, of: 5, median: 80, speed: 'graded:10+moab3+camo', factors: 'MOAB x1.27 and pops x1 pinned'});
 assert.equal(winRate(five.slice(0, 4)), null, 'fewer than 5 runs');
 assert.equal(winRate([...five.slice(0, 4), run('won', 80, {issues: ['bug']})]), null, 'issue-tagged runs are left out');
 assert.equal(winRate([...five.slice(0, 4), run('stopped', 30)]), null, 'stopped runs are left out');
 assert.equal(winRate([...five.slice(0, 4), run('won', 80, {speed: 'graded:5'})]), null, 'a different speed label is another group');
 assert.equal(winRate([...five.slice(0, 4), run('won', 80, {moab_factor: 1.3})]), null, 'different factors are another group');
 assert.equal(winRate([...five.slice(0, 4), run('won', 80, {pinned: ['pops']})]), null, 'factors that were not pinned');
 assert.equal(winRate(five.map(r => ({...r, moab_factor: undefined}))), null, 'runs without factors');
 // The largest group wins; an even count takes the mean of the middle two.
 const six = [run('lost', 40, {speed: 5}), run('lost', 50, {speed: 5}), run('lost', 60, {speed: 5}), run('won', 80, {speed: 5}), run('lost', 70, {speed: 5}), run('lost', 75, {speed: 5})];
 assert.deepEqual(winRate([...five, ...six]), {won: 1, of: 6, median: 65, speed: '5', factors: 'MOAB x1.27 and pops x1 pinned'});

 // Today's data: v6 r4 3 of 5 with median round 80, Playbook v5 r8 1 of 5 with median round 78.
 const {readFile} = await import('node:fs/promises');
 const progress = JSON.parse(await readFile(new URL('../../docs/progress/btd6.json', import.meta.url), 'utf8'));
 const hard = setupViews(progress)[0].view, row = name => hard.versions.find(v => v.name === name);
 assert.deepEqual([row('v6 r4 (btd6-open-v3) graded').rate.won, row('v6 r4 (btd6-open-v3) graded').rate.of, row('v6 r4 (btd6-open-v3) graded').rate.median], [3, 5, 80]);
 assert.deepEqual([row('Playbook v5 r8 (btd6-open-v3) graded').rate.won, row('Playbook v5 r8 (btd6-open-v3) graded').rate.median], [1, 78]);
 assert.equal(row('v3').rate, null);
 const table = progressTable(hard).replace(/\r\n/g, '\n');
 assert.match(table, /\| v6 r4 \(btd6-open-v3\) graded \(`btd6-jev-v6`\) \| \*\*3 of 5 won\*\*, median round 80 \(graded:10\+moab3\+camo, MOAB x1\.27 and pops x1 pinned\): \*\*won/);
 assert.match(progressSvg(hard, THEMES.light), /5 runs · 3 of 5 won, median round 80/);
 const readme = (await readFile(new URL('../../README.md', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
 assert.ok(readme.includes(table), 'README.md has the current table (npm run btd6:progress)');
});

test('zero-leak runs (run_start zero_leak: true) are their own rows on their setup: --add and --refresh never mix them with normal runs', async () => {
 const {addRuns, refreshRun, setupViews} = await import('./progress.mjs');
 const {readFile} = await import('node:fs/promises');
 const run = (id, zero) => [{kind: 'run_start', time: `${id}-0`, match_id: id, speed: 'graded:10', ruleset: {id: 'btd6-open-v3'}, policy_revision: 18, ...(zero ? {zero_leak: true} : {})},
  decision(at(21, 98), {policy: 'btd6-jev-v6', match_id: id, time: `${id}-1`}), {kind: 'run_end', time: `${id}-2`, match_id: id, result: 'victory', state: at(80, 100)}];
 const scored = scoreRuns([...run('N', false), ...run('Z', true)], [], {runOf, score: scoreRun});
 assert.deepEqual(scored.map(s => [s.run, s.zero_leak ?? false]), [['N', false], ['Z', true]]);
 const setups = [{id: 'hard-standard', match: 'Tutorial Hard Standard', start: 3, end: 80, lives: 100}];
 const data = {game: 'BTD6', unit: 'round', groups: [], setups, versions: [{name: 'v6', policy: 'btd6-jev-v6', group: 'jev', runs: []}]};
 assert.deepEqual(addRuns(data, scored).added.map(a => a.run), ['N', 'Z']);
 assert.deepEqual(data.versions[0].runs.map(r => [r.run, r.setup, r.zero_leak ?? false]), [['N', 'hard-standard', false], ['Z', 'hard-standard', true]]);
 const rows = () => setupViews(data)[0].view.versions.map(v => [v.name, v.runs.map(r => r.run)]);
 assert.deepEqual(rows(), [['v6 r18 (btd6-open-v3) graded', ['N']], ['v6 r18 (btd6-open-v3) graded, zero-leak', ['Z']]]);
 // --refresh keeps the flag in step with the log: a run whose log has none loses it.
 refreshRun(data, data.versions[0].runs[1], scored[0]);
 assert.equal(data.versions[0].runs[1].zero_leak, undefined);
 // The recorded zero-leak runs. The count of live runs grows, so check placement and v6 r18's row rather than a total.
 const stored = JSON.parse(await readFile(new URL('../../docs/progress/btd6.json', import.meta.url), 'utf8'));
 const zero = stored.versions.flatMap(v => v.runs).filter(r => r.zero_leak);
 const views = setupViews(stored).map(x => x.view.versions), rowsAll = views.flat();
 assert.equal(rowsAll.filter(v => v.zeroLeak).reduce((n, v) => n + v.runs.length, 0), zero.length, 'every zero-leak run sits in a zero-leak row');
 assert.ok(rowsAll.every(v => v.runs.every(r => Boolean(r.zero_leak) === Boolean(v.zeroLeak))), 'no row mixes zero-leak and normal runs');
 // Each zero-leak row comes right after its version and revision's normal row, when that row exists.
 for (const versions of views) versions.forEach((v, i) => {
  if (!v.zeroLeak) return;
  const normal = v.name.replace(/, zero-leak$/, '');
  if (versions.some(w => w.name === normal)) assert.equal(versions[i - 1]?.name, normal, `${v.name} follows ${normal}`);
 });
 const hard = views[0], i = hard.findIndex(v => v.name === 'v6 r18 (btd6-open-v3) graded, zero-leak');
 assert.equal(hard[i - 1].name, 'v6 r18 (btd6-open-v3) graded');
 assert.ok(hard[i].runs.every(r => r.setup === 'hard-standard' && r.revision === 18 && r.result === 'won'));
 assert.deepEqual(hard[i].rate && [hard[i].runs.length, hard[i].rate.won, hard[i].rate.of, hard[i].rate.median], [20, 20, 20, 80]);
});
