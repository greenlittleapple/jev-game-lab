import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bloonFacts, buildHardRounds, hardRoundsFor, logFlags, roundDataFlags, withoutLogs, THRESHOLDS} from './hard-rounds.mjs';
import {roundFacts} from './estimate.mjs';

const meadow = {map: 'Tutorial', difficulty: 'Hard', mode: 'Standard'};

test('round data: rounds 49, 51 and 78 are flagged, and the others the thresholds flag to round 80', () => {
 const flags = roundDataFlags(undefined, {endRound: 80});
 assert.deepEqual(flags[49], ['rbe_record:1.73']);
 assert.deepEqual(flags[51], ['camo_layered:15']);
 assert.deepEqual(flags[78], ['rbe_record:1.56', 'camo_layered:72']);
 assert.deepEqual(Object.keys(flags).map(Number), [2, 4, 10, 24, 27, 28, 40, 43, 45, 49, 51, 56, 60, 62, 63, 74, 76, 78, 80]);
 assert.deepEqual([flags[24], flags[28], flags[40], flags[45], flags[60], flags[80]].map(f => f.join()), ['first:camo', 'first:lead', 'first:moab', 'first:fortified', 'first:bfb', 'first:zomg']);
 // MOAB-class bloons are left out: round 40 (one MOAB) has no bloon RBE.
 assert.equal(bloonFacts(roundFacts(40)).rbe, 0);
 assert.equal(bloonFacts(roundFacts(51)).camoLayered, 15);
 assert.ok(!flags[54] && !flags[59], 'rounds after a MOAB-only round are not flagged for RBE');
 assert.equal(THRESHOLDS.rbe_record, 1.5);
});

const run = (setup, livesByRound) => ({records: [{kind: 'session_start', time: '2026-01-01T00:00:00Z', setup},
 ...Object.entries(livesByRound).flatMap(([round, [first, last]]) => [
  {kind: 'decision', state: {in_game: true, round: {number: Number(round)}, lives: first}},
  {kind: 'decision', state: {in_game: true, round: {number: Number(round)}, lives: last}}])]});

test('logs: rounds with lives lost per setup, with the runs and the most lives one lost', () => {
 const runs = [run(meadow, {30: [100, 100], 31: [100, 70]}), run(meadow, {31: [90, 86]}), run({...meadow, mode: 'Clicks'}, {6: [150, 147]})];
 assert.deepEqual(logFlags(runs), {'Tutorial/Hard/Standard': {31: {runs: 2, lives: [30, 4]}}, 'Tutorial/Hard/Clicks': {6: {runs: 1, lives: [3]}}});
 const file = buildHardRounds(runs);
 assert.deepEqual(file.setups['Tutorial/Hard/Standard'].rounds[31], ['lost:2/30']);
 assert.deepEqual(file.setups['Tutorial/Hard/Standard'].rounds[51], ['camo_layered:15']);
 assert.equal(file.setups['Tutorial/Hard/Standard'].end_round, 80);
 assert.deepEqual(file.setups['Tutorial/Hard/Clicks'].rounds, {6: ['lost:1/3']}, 'other modes keep only their logs');
 assert.equal(file.logs.runs, 3);
 const list = hardRoundsFor(meadow, {file});
 assert.equal(list.source, 'Tutorial/Hard/Standard');
 assert.deepEqual(withoutLogs(list).rounds.has(31), false);
 assert.deepEqual(withoutLogs(list, {minRuns: 2}).rounds.get(31), ['lost:2/30']);
 assert.deepEqual(withoutLogs(list, {minRuns: 3, minLives: 30}).rounds.get(31), ['lost:2/30']);
 assert.equal(withoutLogs(list, {minRuns: 3, minLives: 31}).rounds.has(31), false);
 assert.equal(hardRoundsFor({map: 'Elsewhere', difficulty: 'Hard', mode: 'Standard'}, {file}).source, 'default');
});

test('the committed list for Monkey Meadow Hard Standard has rounds 49, 51 and 78', () => {
 const list = hardRoundsFor(meadow);
 assert.equal(list.source, 'Tutorial/Hard/Standard');
 for (const n of [49, 51, 78]) assert.ok(list.rounds.has(n), `round ${n}`);
 assert.ok(list.rounds.get(51).some(r => r.startsWith('lost:')));
});

test('current era: ruleset btd6-open-v2 or later and bridge 0.3.13 or later; the log part can come from those runs only', async () => {
 const {currentEra} = await import('./hard-rounds.mjs');
 const era = (ruleset, bridge) => currentEra([{kind: 'run_start', ruleset: {id: ruleset}, bridge_version: bridge}]);
 assert.deepEqual([era('btd6-open-v3', '0.3.14'), era('btd6-open-v2', '0.3.13'), era('btd6-open-v2', '0.3.12'), era('btd6-open-v1', '0.3.14'), era('btd6-open-v2', '0.4.0')],
  [true, true, false, false, true]);
 assert.equal(currentEra([]), false);
 const withStart = (r, ruleset, bridge) => ({records: [...r.records, {kind: 'run_start', ruleset: {id: ruleset}, bridge_version: bridge}]});
 const runs = [withStart(run(meadow, {31: [100, 70]}), 'btd6-open-v1', '0.3.9'), withStart(run(meadow, {33: [100, 90]}), 'btd6-open-v3', '0.3.14')];
 const file = buildHardRounds(runs, {logRuns: 'current'});
 const rounds = file.setups['Tutorial/Hard/Standard'].rounds;
 assert.equal(rounds[31], undefined);
 assert.deepEqual(rounds[33], ['lost:1/10']);
 assert.equal(file.logs.runs, 1);
 assert.match(file.logs.only, /btd6-open-v2 or later, bridge 0.3.13 or later/);
});
