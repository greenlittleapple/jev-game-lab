import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ROUND_DATA, TOWER_DATA, roundFacts, roundCheck, neededPps, towerEstimate, margin, bloonList} from './estimate.mjs';
import {bloonRbe, parseBloon} from './data/generate.mjs';
import {THREATS} from './rounds.mjs';
import {BASE_TOWERS} from './towers.mjs';

test('rounds.json: rounds 1 to 100 from the recorded source, RBE and flags consistent with the bloon counts', () => {
 assert.match(ROUND_DATA.source, /^Btd6ModHelper\/btd6-game-data f818c39 /);
 assert.deepEqual(Object.keys(ROUND_DATA.rounds).map(Number), Array.from({length: 100}, (_, i) => i + 1));
 for (const [r, f] of Object.entries(ROUND_DATA.rounds)) {
  const entries = Object.entries(f.bloons);
  assert.ok(entries.length && entries.every(([, n]) => Number.isInteger(n) && n > 0), `round ${r} counts`);
  assert.equal(f.rbe, entries.reduce((n, [b, c]) => n + bloonRbe(b) * c, 0), `round ${r} RBE`);
  for (const k of ['camo', 'regrow', 'fortified']) assert.equal(f[k], entries.filter(([b]) => parseBloon(b)[k]).reduce((n, [, c]) => n + c, 0), `round ${r} ${k}`);
  assert.ok(f.seconds >= 0, `round ${r} seconds`);
 }
});

test('rounds.json: first appearances agree with the threat table in rounds.mjs', () => {
 const first = Object.fromEntries(Object.entries(ROUND_DATA.rounds).flatMap(([r, f]) => f.first.map(k => [k.toLowerCase(), Number(r)])));
 for (const t of THREATS.filter(t => !['camo_lead', 'fortified_moab'].includes(t.id))) assert.equal(first[t.id], t.round, t.id);
 assert.equal(first.green, 6);
});

test('known rounds: RBE and composition', () => {
 assert.equal(roundFacts(6).rbe, 57);
 assert.equal(bloonList(6), '4 Green, 15 Red, 15 Blue');
 assert.deepEqual([roundFacts(40).rbe, roundFacts(60).rbe, roundFacts(80).rbe, roundFacts(100).rbe], [616, 3164, 16656, 55760], 'one MOAB, BFB, ZOMG, BAD');
 assert.deepEqual(roundFacts(28).bloons, {Lead: 6});
 assert.equal(roundFacts(28).rbe, 138);
 assert.equal(roundFacts(24).camo, 1);
 assert.equal(roundFacts(45).fortified, 4);
 assert.equal(bloonRbe('LeadFortified'), 26);
 assert.equal(bloonRbe('CeramicFortified'), 114);
});

test('towers.json: every tower in towers.mjs but the Sheriff has its 64 upgrade combinations, Quincy 20 levels', () => {
 assert.match(TOWER_DATA.source, /f818c39/);
 for (const id of Object.keys(BASE_TOWERS).filter(id => !['Quincy', 'Sheriff'].includes(id))) {
  const rows = TOWER_DATA.towers[id];
  assert.equal(Object.keys(rows).length, 64, id);
  for (const row of Object.values(rows)) assert.ok(row.length === 6 && row[0] >= 0 && [0, 1].includes(row[1]) && [0, 1].includes(row[2]) && row[3] > 0 && row[4] >= 0 && [0, 1].includes(row[5]), id);
 }
 assert.deepEqual(Object.keys(TOWER_DATA.towers.Quincy).map(Number), Array.from({length: 20}, (_, i) => i + 1));
 assert.deepEqual(towerEstimate({base_id: 'DartMonkey', tiers: [0, 0, 0]}), {pps: 2.1, lead: false, camo: false, range: 32, moab: 1.1, camoLead: false});
 assert.equal(towerEstimate({base_id: 'DartMonkey', tiers: [0, 0, 2]}).camo, true, 'Enhanced Eyesight');
 assert.equal(towerEstimate({base_id: 'BombShooter', tiers: [0, 0, 0]}).lead, true);
 assert.equal(towerEstimate({base_id: 'Quincy', name: 'Quincy 3', is_hero: true, tiers: [0, 0, 0]}).pps, TOWER_DATA.towers.Quincy[3][0]);
 assert.equal(towerEstimate({base_id: 'BananaFarm', tiers: [0, 0, 0]}).pps, 0);
 assert.deepEqual(towerEstimate({base_id: 'Skywarden', tiers: [0, 0, 0]}), {pps: 2.6, lead: false, camo: false, range: 48, moab: 1.3, camoLead: false});
 assert.equal(towerEstimate({base_id: 'Sheriff', tiers: [0, 0, 0]}), null, 'no entry: the equipped weapon is not in the export');
});

test('towers.json: the Skywarden rows from the 56.0 export', () => {
 const S = TOWER_DATA.towers.Skywarden;
 // Two dart weapons swapped by the focus stance, so one counts: 4 pierce, 1 damage, 1.55 s: 4 / 1.55 = 2.6 pops per
 // second (5.2 with both, towers-v4.json). MOAB damage still counts both.
 assert.deepEqual(S['000'], [2.6, 0, 0, 48, 1.3, 0]);
 assert.deepEqual(S['100'], [2.6, 0, 0, 58, 1.3, 0], 'range 58 from the first top-path tier');
 assert.deepEqual(S['200'].slice(1, 3), [0, 1], 'sees camo from 2-0-0');
 assert.deepEqual(S['500'], [12.9, 0, 1, 58, 6.5, 0]);
 assert.deepEqual(S['005'], [15.5, 0, 0, 48, 5.2, 0]);
 // The middle path's gust (CreateDistanceProjectileOnExhaustFractionModel) counts once per shot; without it
 // 0-3-0 read as 0 pops.
 assert.deepEqual(S['030'], [2.6, 1, 0, 48, 2.6, 0]);
 assert.deepEqual(S['050'], [2.6, 1, 0, 48, 6.5, 0]);
});

test('floor at rounds 6, 10, 20, 28 and 40 with one life: layers needed and the pops per second that meets them', () => {
 assert.deepEqual([1, 5, 10, 100].map(margin), [1.5, 1.3, 1.3, 1.15]);
 const floor = [6, 10, 20, 28, 40].map(r => ({round: r, needs: roundCheck([], r).needs, pps: +neededPps(r).toFixed(1)}));
 assert.deepEqual(floor, [
  {round: 6, needs: 86, pps: 4.0},
  {round: 10, needs: 306, pps: 6.8},
  {round: 20, needs: 99, pps: 9.4},
  {round: 28, needs: 207, pps: 19.9},
  {round: 40, needs: 924, pps: 128.3},
 ]);
 const T = (base_id, tiers) => ({base_id, tiers, x: 0, y: 0});
 assert.equal(roundCheck([T('DartMonkey', [0, 0, 1])], 6).enough, false, 'the v1 run: one Dart 0-0-1');
 assert.equal(roundCheck([T('DartMonkey', [0, 0, 1]), T('DartMonkey', [0, 0, 0])], 6).enough, true);
 assert.equal(roundCheck([T('DartMonkey', [0, 2, 0]), T('DartMonkey', [0, 2, 0]), T('DartMonkey', [0, 2, 0]), T('DartMonkey', [0, 2, 0]), T('DartMonkey', [0, 2, 0]), T('DartMonkey', [0, 2, 0]), T('DartMonkey', [0, 2, 0])], 28).lead, false);
 assert.equal(roundCheck([T('DartMonkey', [0, 0, 0])], 6, {lives: 100}).needs, Math.ceil(57 * 1.15));
});

test('towers.mjs: missingTowerData lists non-hero towers without a towers.json entry; the data version is a content hash', async () => {
 const {missingTowerData, TOWER_DATA_VERSION, towerDataInfo} = await import('./towers.mjs');
 const shop = [{id: 'DartMonkey'}, {id: 'Skywarden'}, {id: 'Sheriff'}, {id: 'Quincy', is_hero: true}, {id: 'Gwendolin', is_hero: true}, {id: 'NewTower', is_hero: false}];
 assert.deepEqual(missingTowerData(shop), ['Sheriff', 'NewTower']);
 assert.deepEqual(missingTowerData(shop, {DartMonkey: {}}), ['Skywarden', 'Sheriff', 'NewTower']);
 assert.deepEqual(missingTowerData([{id: 'toString'}]), ['toString'], 'own entries only');
 assert.match(TOWER_DATA_VERSION, /^[0-9a-f]{12}$/);
 assert.deepEqual(towerDataInfo(), {source: TOWER_DATA.source, version: TOWER_DATA_VERSION});
});

test('rounds.json peak and camo_lead: round 78 sends 8,870 RBE in its densest 10 s; round 59 has 50 camo Leads', async () => {
 const {densest, roundPeak, PEAK_SECONDS} = await import('./data/generate.mjs');
 assert.equal(PEAK_SECONDS, 10);
 assert.equal(densest([[0, 5], [4, 5], [10, 5], [10.5, 5], [30, 1]]), 15, 'within 10 s: 0, 4 and 10; then 4, 10 and 10.5');
 // MOAB-class left out; a group's bloons spread evenly over its frames (60 per second).
 assert.equal(roundPeak([{bloon: 'Red', count: 10, start: 0, end: 540}, {bloon: 'Moab', count: 1, start: 0, end: 0}]), 10);
 assert.equal(roundPeak([{bloon: 'Red', count: 3, start: 0, end: 1200}]), 2, 'one each at 0, 10 and 20 s');
 assert.equal(roundFacts(78).peak, 8870);
 assert.equal(roundFacts(59).camo_lead, 50);
 assert.equal(roundFacts(78).camo_lead, 0);
 for (const [n, r] of Object.entries(ROUND_DATA.rounds)) assert.ok(r.peak >= 0 && r.peak <= r.rbe, `round ${n}`);
});

test('camo_lead: camo Lead bloons need one tower that sees camo and pops Lead, not a Monkey Ace; part of enough', () => {
 assert.equal(towerEstimate({base_id: 'SniperMonkey', tiers: [1, 1, 0]}).camoLead, true);
 assert.equal(towerEstimate({base_id: 'BombShooter', tiers: [0, 2, 4]}).camoLead, false);
 // Necromancer (x-0-4): camo from one attack, Lead from another.
 assert.deepEqual(TOWER_DATA.towers.WizardMonkey['004'].slice(1, 3).concat(TOWER_DATA.towers.WizardMonkey['004'][5]), [1, 1, 0]);
 const split = [{base_id: 'BombShooter', tiers: [4, 2, 0]}, {base_id: 'DartMonkey', tiers: [0, 2, 4]}];
 const c = roundCheck(split, 59, {lives: 100});
 assert.deepEqual([c.camo, c.lead, c.camo_lead, c.enough], [true, true, false, false]);
 assert.equal(roundCheck([...split, {base_id: 'MonkeyAce', tiers: [4, 2, 0]}], 59, {lives: 100}).camo_lead, false, 'the Ace does not count');
 assert.equal(roundCheck([...split, {base_id: 'SniperMonkey', tiers: [1, 1, 0]}], 59, {lives: 100}).camo_lead, true);
 assert.equal(roundCheck(split, 58, {lives: 100}).camo_lead, null, 'no camo Leads');
});

test('Monkey Ace: counted at its measured share of the table rate with reach; burst for round 78', async () => {
 const {GLOBAL_SHARE} = await import('./towers.mjs');
 const {effectivePps, BURST_FACTOR, PEAK_SECONDS, DWELL_SECONDS, EFFICIENCY} = await import('./estimate.mjs');
 assert.deepEqual(GLOBAL_SHARE, {MonkeyAce: 0.1});
 const ace = {base_id: 'MonkeyAce', tiers: [0, 3, 2], x: 0, y: 0};
 assert.equal(effectivePps(ace, [[{x: 0, y: 0}, {x: 10, y: 0}]]), +(TOWER_DATA.towers.MonkeyAce['032'][0] * 0.1).toFixed(2));
 assert.equal(effectivePps({...ace, base_id: 'SniperMonkey', tiers: [0, 0, 0]}, [[{x: 0, y: 0}, {x: 10, y: 0}]]), TOWER_DATA.towers.SniperMonkey['000'][0]);
 // Burst: pops over the densest 10 s plus the dwell, times BURST_FACTOR, against the window's RBE x margin.
 assert.equal(BURST_FACTOR, 0.8);
 const towers = [{base_id: 'BombShooter', tiers: [0, 2, 4]}];
 const c = roundCheck(towers, 78, {lives: 100});
 const pps = TOWER_DATA.towers.BombShooter['024'][0];
 assert.deepEqual(c.burst_facts, {rbe: 8870, can_pop: Math.round(pps * (PEAK_SECONDS + DWELL_SECONDS) * EFFICIENCY * BURST_FACTOR), needs: Math.ceil(8870 * 1.15),
  ratio: +(Math.round(pps * 18 * 0.8 * 0.8) / Math.ceil(8870 * 1.15)).toFixed(2)});
 assert.equal(c.burst, false);
 assert.equal(c.enough, false);
 // Not part of enough: a round with a burst short and pops otherwise enough stays enough.
 const m = roundCheck([...Array(4).fill({base_id: 'BombShooter', tiers: [0, 2, 4]}), {base_id: 'DartMonkey', tiers: [0, 0, 2]}], 78, {lives: 100});
 assert.deepEqual([m.ratio >= 1, m.burst, m.enough], [true, false, true]);
 assert.equal(roundCheck(towers, 60, {lives: 100}).burst, null, 'round 60: one BFB, no peak');
});
