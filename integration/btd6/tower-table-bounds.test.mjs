import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EFFICIENCY, roundSeconds, roundFacts} from './estimate.mjs';
import {TOWER_TABLES} from './towers.mjs';
import {KILL_CAP} from './data/generate.mjs';

// Guards against an impossible estimate in the tower table, such as the Druid's Jungle vine counted at 38 million
// pops a second (generate.mjs KILL_CAP). Each tower and tiers row's estimate for rounds 10, 40 and 80 (pops per
// second x the round's time x EFFICIENCY, as estimate.mjs roundCheck counts it) must stay under two bounds:
//  - RELATIVE_BOUND times the median estimate of the rows at its tier level (the highest tier on any path). The
//    highest real ratio in the table is about 62 (the Spike Factory 5-2-0 at 9,857 pops a second against a tier-5
//    median of 154); the vine error was 240,000 to 2,200,000.
//  - PPS_BOUND pops a second, twice the table's highest real rate (that Spike Factory). At that rate one tower would
//    pop round 98's 249,168 RBE, the most of any round, in about 12 s.
// The frozen v4 table (btd6-jev-v4's baseline) keeps its old rows, the vine error included, and isn't checked.
const RELATIVE_BOUND = 100, PPS_BOUND = 20000, ROUNDS = [10, 40, 80];

const rowsOf = data => Object.entries(data.towers).flatMap(([id, table]) => Object.entries(table).map(([key, row]) =>
 ({id, key, pps: row[0], level: id === 'Quincy' ? 'hero' : Math.max(...key.split('').map(Number))})));
const median = values => { const v = [...values].sort((a, b) => a - b); return v[v.length >> 1]; };

for (const name of ['current', 'candidate']) test(`${name} tower table: no tower or tiers estimate is absurd at rounds ${ROUNDS.join(', ')}`, () => {
 const rows = rowsOf(TOWER_TABLES[name].data), bad = [];
 for (const round of ROUNDS) {
  assert.ok(roundFacts(round));
  const est = r => r.pps * roundSeconds(round) * EFFICIENCY;
  const medians = {};
  for (const level of new Set(rows.map(r => r.level))) medians[level] = median(rows.filter(r => r.level === level).map(est));
  for (const r of rows) {
   if (!Number.isFinite(r.pps) || r.pps < 0) bad.push(`${r.id} ${r.key}: pops per second ${r.pps}`);
   else if (r.pps > PPS_BOUND) bad.push(`${r.id} ${r.key}: ${r.pps} pops a second`);
   else if (est(r) > RELATIVE_BOUND * medians[r.level]) bad.push(`${r.id} ${r.key} round ${round}: ${Math.round(est(r))}, over ${RELATIVE_BOUND} x median ${Math.round(medians[r.level])}`);
  }
 }
 assert.deepEqual([...new Set(bad)], []);
});

test('Druid Jungle vine: one bloon a grab, at most a Ceramic', () => {
 assert.equal(KILL_CAP, 104);
 const druid = TOWER_TABLES.current.data.towers.Druid;
 // 0-2-3 has no vine; 0-3-2 adds the vine (one grab every 2.6 s, KILL_CAP pops) and its thorns.
 assert.equal(druid['023'][0], 7.3);
 assert.ok(druid['032'][0] > druid['023'][0] + KILL_CAP / 2.6 - 0.1 && druid['032'][0] < 60, `${druid['032'][0]}`);
 for (const key of ['030', '031', '032', '040', '050', '130', '150', '250']) assert.ok(druid[key][0] < 400, `${key}: ${druid[key][0]}`);
});
