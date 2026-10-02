import test from 'node:test';
import assert from 'node:assert/strict';
import {camoStudy, selectRuns, formatCamo} from './camo-replay.mjs';
import {roundFacts} from './estimate.mjs';

const start = (ruleset = 'btd6-open-v3', bridge = '0.3.15') => [
 {kind: 'session_start', setup: {map: 'Nowhere', difficulty: 'Hard'}, calibration: {pops: {factor: 1, from_round: 60}, moab: {factor: 1}}},
 {kind: 'run_start', policy: 'btd6-jev-v6', policy_revision: 4, ruleset: {id: ruleset}, bridge_version: bridge, setup: {map: 'Nowhere'}},
];
const ninja = tiers => ({id: 1, base_id: 'NinjaMonkey', tiers, x: 0, y: 0});
const decision = (round, lives, tiers, {chosen = {id: 'wait', label: 'Wait', command: null}, outcome = 'held', cash = 5000} = {}) => ({kind: 'decision',
 state: {in_game: true, round: {number: round}, lives, cash, towers: [ninja(tiers)], match: {map: 'Nowhere', difficulty: 'Hard', end_round: 80}},
 options: ['wait', 'upgrade:1:p1'], chosen, outcome});
const upgrade = {id: 'upgrade:1:p1', label: 'Upgrade NinjaMonkey #1 to 1-0-0 ($300)', command: {action: 'upgrade_tower', tower_id: 1, path: 0}};
const records = [...start(), decision(53, 100, [0, 0, 0]), decision(54, 100, [0, 0, 0], {chosen: upgrade, outcome: 'executed'}),
 decision(55, 100, [1, 0, 0]), decision(56, 100, [1, 0, 0]), decision(57, 50, [1, 0, 0])];

test('camo study: the round-56 loss, its look-ahead flag, the affordable answer and the purchases before it', () => {
 assert.ok(roundFacts(56).camo_rbe > 0);
 const runs = [{name: '2026-10-01T06-56-00-000Z-btd6-jev-v6.jsonl', records}];
 const s = camoStudy(runs, {thresholds: [1.0], focus: {runs: ['2026-10-01T06-56'], from: 50, to: 56, round: 56}});
 const lost = s.lostRounds.find(x => x.round === 56);
 assert.equal(lost.lost, 50);
 assert.equal(lost.camo_round, true);
 assert.ok(lost.camo < 1);
 const t = s.thresholds[0];
 assert.ok(t.decisions >= 4);
 assert.equal(t.lost_over_5, 1);
 assert.deepEqual(t.focus, [{run: runs[0].name, flagged: true, from_round: 53}]);
 // At round 53 the Ninja's first upgrade raises camo pops and was on offer; its cost comes from the round-54 purchase.
 const r53 = t.rows.find(r => r.round === 53);
 assert.equal(r53.flagged, 53);
 assert.equal(r53.best.id, 'upgrade:1:p1');
 assert.equal(r53.best.cost, 300);
 assert.equal(t.answers.median_cost, 300);
 // The purchase in round 54 raised round 56's camo capacity.
 assert.deepEqual(s.purchases[0].list.map(x => [x.round, x.cost, x.raises_camo]), [[54, 300, true]]);
 assert.match(formatCamo(s), /Camo margin in clean camo rounds/);
});

test('camo study: runs before the cut-off or the current era are left out', () => {
 const runs = [{name: '2026-09-30T19-00-00-000Z-a.jsonl', records}, {name: '2026-10-01T01-00-00-000Z-b.jsonl', records: [...start('btd6-open-v1'), ...records.slice(2)]},
  {name: '2026-10-01T02-00-00-000Z-c.jsonl', records}];
 assert.deepEqual(selectRuns(runs).map(r => r.name), ['2026-10-01T02-00-00-000Z-c.jsonl']);
});

test('Lead study: Lead rounds bucketed by Lead margin with leaks, Hard Standard and CHIMPS only; flags for CHIMPS v6', async () => {
 const {leadStudy, formatLead} = await import('./camo-replay.mjs');
 const bomb = {id: 2, base_id: 'BombShooter', tiers: [0, 0, 0], x: 0, y: 0};
 const at = (round, lives, mode, towers) => ({kind: 'decision', state: {in_game: true, round: {number: round}, lives, cash: 0, towers,
  match: {map: 'Nowhere', difficulty: 'Hard', mode, end_round: 80}}, options: ['wait'], chosen: {id: 'wait'}, outcome: 'held'});
 // CHIMPS: round 28 with no Lead popper (margin 0), lost; Hard Standard: round 28 with a Bomb Shooter, clean; round 27 has no Leads.
 const chimps = [...start(), at(25, 1, 'Clicks', [ninja([0, 0, 0])]), at(27, 1, 'Clicks', [ninja([0, 0, 0])]), at(28, 1, 'Clicks', [ninja([0, 0, 0])]), at(29, 0, 'Clicks', [ninja([0, 0, 0])])];
 const standard = [...start(), at(28, 100, 'Standard', [bomb]), at(29, 100, 'Standard', [bomb])];
 const medium = [...start(), {...at(28, 100, 'Standard', []), state: {...at(28, 100, 'Standard', []).state, match: {map: 'Nowhere', difficulty: 'Medium', mode: 'Standard'}}}];
 const s = leadStudy([{name: 'c', records: chimps}, {name: 's', records: standard}, {name: 'm', records: medium}]);
 assert.deepEqual(s.by_setup, {'Hard Standard': 1, CHIMPS: 1});
 const row = (k, b) => s.buckets[k].find(x => x.bucket === b);
 assert.deepEqual([row('CHIMPS', '<0.5').rounds, row('CHIMPS', '<0.5').leak_rounds, row('CHIMPS', '<0.5').leak_runs], [1, 1, 1]);
 assert.equal(s.buckets['Hard Standard'].reduce((n, b) => n + b.rounds, 0), 1);
 assert.equal(s.buckets['Hard Standard'].reduce((n, b) => n + b.leak_rounds, 0), 0);
 assert.equal(s.buckets.all.reduce((n, b) => n + b.rounds, 0), 2);
 // Flags: every decision of the CHIMPS v6 run has a Lead round within the lead (28, then 30 from round 29).
 assert.deepEqual(s.flags.map(f => [f.run, f.decisions, f.flagged, f.rounds]), [['c', 4, 4, [25, 27, 28, 29]]]);
 assert.ok(formatLead(s).includes('CHIMPS btd6-jev-v6 logs'));
});
