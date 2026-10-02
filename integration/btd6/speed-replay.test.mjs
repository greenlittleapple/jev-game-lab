import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replaySpeed, replayStates, summarize, formatSummary, formatCauses, hardFor, speedCauses, VARIANTS} from './speed-replay.mjs';
import {setMoabCalibration} from './moab.mjs';
import {setPopsCalibration} from './estimate.mjs';

const at = s => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const state = (round, lives = 100) => ({in_game: true, match: {id: 'm', result: null, end_round: 80}, round: {number: round, lives_lost: 0}, lives, towers: []});

test('replayStates: decision states, a state at each round start from speed_round, and the logged speed', () => {
 setMoabCalibration(1); setPopsCalibration(1);
 const records = [
  {time: at(0), kind: 'speed_set', speed: 10, status: 'executed'},
  {time: at(1), kind: 'decision', state: state(10), chosen: {id: 'wait'}, outcome: 'held'},
  {time: at(5), kind: 'speed_round', round: 10, seconds: {10: 4}},
  {time: at(6), kind: 'speed_set', speed: 3, status: 'refused'},
  {time: at(9), kind: 'decision', state: state(13), chosen: {id: 'wait'}, outcome: 'held'},
 ];
 const s = replayStates(records);
 assert.deepEqual(s.map(e => [e.state.round.number, e.at - Date.parse(at(0)), e.speed]), [[10, 1000, 10], [11, 5000, 10], [12, 9000, 10], [13, 9000, 10]]);
 assert.equal(s[1].state.towers, s[0].state.towers, 'a round-start state has the towers of the last decision');
 assert.equal(s[0].margins.margin, 0, 'no towers, no margin');
});

test('replaySpeed: the level per round, the level a lost round was played at, and the time at the replayed level', () => {
 // Margin 4 everywhere; round 51 is hard. The run was logged at 10x throughout and lost 30 lives in round 51.
 const margins = round => ({round, pops: 4, moab: null, margin: 4});
 const seq = [[49, 0, 100], [49, 4, 100], [50, 8, 100], [51, 12, 100], [51, 14, 70], [52, 20, 70], [52, 30, 70]];
 const states = seq.map(([round, s, lives]) => ({at: Date.parse(at(s)), state: state(round, lives), margins: margins(round), short: false, speed: 10, decision: null}));
 const records = seq.map(([round, s, lives]) => ({time: at(s), kind: 'decision', state: state(round, lives)}));
 const hard = {rounds: new Map([[51, ['camo_layered:15']]])};
 const r = replaySpeed(records, states, {hard, options: {endRounds: 0}});
 const row = n => r.rounds.find(x => x.round === n);
 assert.equal(r.timed, true);
 // Round 51 starts at 3 (the hard round) and drops to 1 when the lives go; round 52 climbs back one level.
 assert.deepEqual([49, 50, 51, 52].map(n => row(n).level), [10, 5, 1, 3]);
 // 2 s at 10x logged (20 game s) replayed at 3, then 6 s (60 game s) at 1.
 assert.deepEqual(row(51), {round: 51, lost: 30, level: 1, start: 3, entered: 5, played: 3, logged_at_loss: 10, caps: ['hard_round', 'cooldown'],
  game_s: 80, logged_s: 8, replay_s: 66.7});
 // Round 49: 8 s at 10x logged (80 game s) replayed at 10.
 assert.deepEqual([row(49).game_s, row(49).replay_s], [80, 8]);
 assert.deepEqual(row(52).caps, ['cooldown'], 'the rounds after a danger drop are capped');
 const without = replaySpeed(records, states, {hard: null, options: {endRounds: 0}});
 assert.equal(without.rounds.find(x => x.round === 51).played, 10, 'without the list, round 51 is played at 10');
 const sum = summarize([{name: '2026-09-30T09-01-37-043Z-btd6-playbook-v5.jsonl', ...without}]);
 assert.deepEqual([sum.lost_rounds, sum.lost_at_max], [1, ['09-01-37 r51']]);
 assert.match(formatSummary('current', sum), /at 10x: 09-01-37 r51/);
 assert.deepEqual(summarize([{name: 'x', ...r}]).lost_by_level, {3: 1});
});

test('hardFor: leave-one-out drops the replayed run\'s own lost rounds', () => {
 const setup = {map: 'Tutorial', difficulty: 'Hard', mode: 'Standard'};
 const log = (name, round) => ({name, records: [{kind: 'session_start', time: at(0), setup},
  {kind: 'decision', state: {in_game: true, round: {number: round}, lives: 100}}, {kind: 'decision', state: {in_game: true, round: {number: round}, lives: 90}}]});
 const all = [log('a', 33), log('b', 35)];
 const list = hardFor(all, 'a', setup);
 assert.equal(list.rounds.has(33), false);
 assert.deepEqual(list.rounds.get(35), ['lost:1/10']);
 assert.equal(hardFor(all, 'a', setup, {leaveOneOut: false}).rounds.has(33), true);
 assert.equal(hardFor(all, 'a', setup, {logs: false}).rounds.has(35), false);
 assert.ok(VARIANTS.proposed && VARIANTS.current);
});

test('speedCauses: wall time lost against the maximum, split into the climb and the limit\'s cause', () => {
 setMoabCalibration(1); setPopsCalibration(1);
 const set = (s, speed, reason, extra = {}) => ({time: at(s), kind: 'speed_set', round: 10, speed, reason, status: 'executed', ...extra});
 const m = margin => ({round: 10, pops: margin, moab: null, margin});
 const records = [
  {time: at(0), kind: 'session_start', speed: 'graded:10+moab3', setup: {map: 'Tutorial'}},
  {time: at(0), kind: 'decision', state: state(10)},
  set(0, 10, 'match_start: start: margin 4', {margins: m(4)}),
  set(10, 1, 'drop: bloons_past_0.5, leak_pressure', {margins: m(4), danger: ['bloons_past_0.5', 'leak_pressure']}),
  set(30, 3, 'up: margin 4, cap 5: cooldown', {margins: m(4), danger: [], cap: ['cooldown']}),
  set(34, 3, 'round_start (the game reported 1)'),
  set(40, 5, 'up: margin 4, cap 5: cooldown', {margins: m(4), danger: [], cap: ['cooldown']}),
  set(60, 3, 'drop: margin 1.1', {margins: m(1.1), danger: []}),
  {time: at(70), kind: 'decision', state: state(10, 90)},
  {time: at(70), kind: 'run_end'},
 ];
 const c = speedCauses(records);
 const r = x => +x.toFixed(4);
 assert.deepEqual([c.max, c.label, r(c.minutes)], [10, 'graded:10+moab3', r(70 / 60)]);
 // 10 s at 3 below the cooldown's 5: the climb is 10 (1 - 3/5) s; the round_start record changes nothing.
 assert.equal(r(c.climb), r(4 / 60));
 // leak_pressure: 20 s at 1 (18 s lost); cooldown: 6 s of game time at 3 and 100 at 5, lost against 10; margin below 1.3: 10 s at 3.
 assert.deepEqual(Object.fromEntries(Object.entries(c.causes).map(([k, v]) => [k, r(v * 60)])), {leak_pressure: 18, cooldown: 13, 'margin_below_1.3': 7});
 assert.deepEqual(c.drops, [{round: 10, from: 10, danger: ['bloons_past_0.5', 'leak_pressure'], lost: 10}]);
 assert.match(formatCauses([{name: '2026-09-30T23-22-56-685Z-btd6-jev-v6.jsonl', c}]), /leak_pressure from 10x: 0 \/ 0 \/ 1/);
 assert.equal(speedCauses([{kind: 'session_start', speed: 5}]), null, 'only graded runs');
});

test('fine replay: a state at each speed_set with its logged danger, and observations between states on the replayed clock', () => {
 setMoabCalibration(1); setPopsCalibration(1);
 const records = [
  {time: at(0), kind: 'speed_set', speed: 10, reason: 'match_start', status: 'executed'},
  {time: at(1), kind: 'decision', state: state(10), chosen: {id: 'wait'}, outcome: 'held'},
  {time: at(2), kind: 'speed_set', speed: 1, reason: 'drop: leak_pressure', danger: ['leak_pressure'], status: 'executed'},
  {time: at(12), kind: 'speed_set', speed: 3, reason: 'up: margin 4', danger: [], status: 'executed'},
  {time: at(13), kind: 'speed_set', speed: 3, reason: 'round_start (the game reported 1)', status: 'executed'},
  {time: at(42), kind: 'decision', state: state(10), chosen: {id: 'wait'}, outcome: 'held'},
 ];
 const s = replayStates(records, {speedPoints: true});
 assert.deepEqual(s.map(e => [e.at - Date.parse(at(0)), e.speed, e.logged]), [[1000, 10, []], [2000, 1, ['leak_pressure']], [12000, 3, []], [42000, 3, []]]);
 assert.equal(replayStates(records).length, 2, 'without speedPoints, only the decision states');
 const margins = {round: 10, pops: 4, moab: null, margin: 4};
 for (const e of s) e.margins = margins;
 const coarse = replaySpeed(records, s, {hard: null, options: {endRounds: 0}});
 const fine = replaySpeed(records, s, {hard: null, options: {endRounds: 0}, tickMs: 250});
 // The coarse replay doesn't see the logged danger and stays at 10 (11 s). The fine one drops to 1 for the 10 game seconds of
 // leak pressure, steps up to 3 when it clears, and to 5 (the cooldown cap) 4 s of replayed time later: 1 + 10 + 4 + 78 / 5 s.
 const row = r => r.rounds[0];
 assert.equal(row(coarse).replay_s, 11);
 assert.ok(Math.abs(row(fine).replay_s - 30.6) <= 0.2, `fine replay ${row(fine).replay_s}`);
 assert.equal(row(fine).game_s, 10 + 10 + 90);
});
