import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setEarlyMargin} from './estimate.mjs';
import {buildCandidates} from './candidates.mjs';
import {floorRulesV6, applyTowerCap} from './policy-v6.mjs';
import {floorRulesV4, groupOptionsV4} from './policy-v4.mjs';
import {applyEarlyShort, earlyRatio, measuredRatio, EARLY_KEEP} from './early.mjs';
import {buildEarlyRatios, MIN_TOWER_ROUNDS} from './early-ratios.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths, meadowSpots as spots, meadowSpot} from './fixtures/index.mjs';

const on = fn => { setEarlyMargin(true); try { return fn(); } finally { setEarlyMargin(false); } };
const ids = list => list.map(c => c.id);
// CHIMPS prices: the Bomb Shooter at $405, its 0-0-1 upgrade at $215.
const catalog = v0Catalog.map(t => t.id === 'BombShooter' ? {...t, cost: 405} : t);
const bomb = () => ({id: 1, base_id: 'BombShooter', tiers: [0, 0, 0], x: meadowSpot('S03').x, y: meadowSpot('S03').y,
 next_upgrades: [{id: 'Extra Range', path: 1, cost: 215}, {id: 'Faster Reload', path: 2, cost: 215}]});
const chimps = (cash, towers, patch = {}) => v0Round6({cash, towers, lives: 1, starting_lives: 1, ...patch});
const options = state => buildCandidates(state, {catalog, freeSpots: spots.filter(s => !state.towers.some(t => t.x === s.x && t.y === s.y)), paths});
const first = (list, pred) => list.findIndex(pred);
const isPlace = tower => c => c.details?.kind === 'place' && c.details.tower === tower;
const rule = r => r.constraint?.rules?.find(x => x.kind === 'early_short');

test('early ratios: summed pops over summed est_reach per type, rounds 3-10 of current-era Hard Standard; small types use all types', () => {
 const run = (setup, towers, round = 5) => ({name: 'x', records: [
  {kind: 'session_start', time: '2026-09-30T00:00:00Z', setup},
  {kind: 'run_start', ruleset: {id: 'btd6-open-v3'}, bridge_version: '0.3.15'},
  {kind: 'pops_round', round, rbe: 50, towers}]});
 const hs = {map: 'Tutorial', difficulty: 'Hard', mode: 'Standard'};
 const runs = [];
 for (let i = 0; i < MIN_TOWER_ROUNDS; i++) runs.push(run(hs, [{id: 1, base_id: 'DartMonkey', tiers: [0, 0, 0], pops: 50, est_reach: 100}]));
 runs.push(run(hs, [{id: 2, base_id: 'BombShooter', tiers: [0, 0, 0], pops: 10, est_reach: 100}]));
 runs.push(run(hs, [{id: 3, base_id: 'SniperMonkey', tiers: [0, 0, 0], pops: 99, est_reach: 100}], 11), run({...hs, mode: 'Clicks'}, [{id: 4, base_id: 'SniperMonkey', tiers: [0, 0, 0], pops: 99, est_reach: 100}]));
 const file = buildEarlyRatios(runs, {source: 'abc'});
 assert.equal(file.types.DartMonkey.ratio, 0.5);
 assert.deepEqual([file.all.tower_rounds, file.all.ratio], [31, +(1510 / 3100).toFixed(3)]);
 assert.deepEqual([file.types.BombShooter.ratio, file.types.BombShooter.measured, file.types.BombShooter.uses], [file.all.ratio, 0.1, '*']);
 assert.equal(file.types.SniperMonkey, undefined, 'round 11 and CHIMPS left out');
 assert.equal(earlyRatio('SniperMonkey', file), file.all.ratio, 'a type never seen');
 assert.equal(file.source_commit, 'abc');
 const data = JSON.parse(readFileSync(new URL('./data/early-ratios.json', import.meta.url), 'utf8'));
 assert.ok(data.types.BombShooter.ratio < data.types.DartMonkey.ratio && data.source_commit && data.logs.from);
});

test('CHIMPS round 6 opening at $650, no towers: binding keeps only the Dart Monkey placements', () => {
 const state = chimps(650, []);
 const all = options(state);
 const out = on(() => floorRulesV6(state, all, {paths}));
 const r = rule(out);
 assert.ok(r, JSON.stringify(out.constraint));
 assert.deepEqual([r.round, r.binding, r.keep], [6, true, EARLY_KEEP]);
 const c = out.candidates;
 // Ratios today: Dart 0.476, Sniper 0.754, Bomb 0.218; per dollar the Dart placements are best and the others fall below 0.8 of them.
 assert.ok(c.length > 0 && c.every(isPlace('DartMonkey')), ids(c).join(' '));
 assert.deepEqual(r.kept, ids(c));
 for (const t of ['SniperMonkey', 'BombShooter', 'Mermonkey']) assert.ok(all.some(isPlace(t)) && !c.some(isPlace(t)), t);
 assert.ok(!ids(c).includes('start_round') && !ids(c).includes('wait'));
 assert.equal(r.removed, all.length - c.length - (all.length - on(() => floorRulesV6(state, all, {paths}, {earlyShort: false, threatBinding: false})).candidates.length));
 const threat = out.constraint.rules.find(x => x.kind === 'threat_short');
 assert.ok(!threat || (threat.binding === false && threat.deferred_to === 'early_short'), "early_short's set applies");
 // Order-only (revision 7) kept every purchase and ranked Mermonkey by the all-types ratio.
 const old = on(() => floorRulesV6(state, all, {paths}, {earlyBinding: false}));
 assert.equal(rule(old).binding, undefined);
 assert.ok(old.candidates.some(isPlace('Mermonkey')) && old.candidates.find(isPlace('Mermonkey')).details.early > 0);
 assert.equal(c.find(isPlace('Mermonkey')), undefined);
});

test('measured types only: the Ace and Mermonkey have no measured ratio', () => {
 assert.equal(measuredRatio('DartMonkey'), earlyRatio('DartMonkey'));
 assert.equal(measuredRatio('MonkeyAce'), null, 'fewer than 30 tower-rounds');
 assert.equal(measuredRatio('Mermonkey'), null, 'no data');
});

test('one Sniper 0-0-0 and $270: the Sniper upgrade is removed when a Dart placement is better per dollar', () => {
 const sniper = {id: 1, base_id: 'SniperMonkey', tiers: [0, 0, 0], x: meadowSpot('S03').x, y: meadowSpot('S03').y,
  next_upgrades: [{id: 'Full Metal Jacket', path: 0, cost: 300}, {id: 'Night Vision Goggles', path: 1, cost: 250}, {id: 'Fast Firing', path: 2, cost: 200}]};
 const state = chimps(270, [sniper]);
 const all = options(state);
 const old = on(() => applyEarlyShort(state, all, {paths, binding: false}));
 const up = old.candidates.filter(x => x.details?.kind === 'upgrade' && x.details.early > 0);
 const dart = old.candidates.find(isPlace('DartMonkey'));
 assert.ok(up.length && up.every(u => u.details.early < dart.details.early * EARLY_KEEP), ids(up).join(' '));
 const out = on(() => floorRulesV6(state, all, {paths}));
 const c = out.candidates;
 assert.ok(!c.some(x => x.details?.kind === 'upgrade'), ids(c).join(' '));
 assert.ok(c.length && c.every(isPlace('DartMonkey')));
 assert.equal(rule(out).first, c[0].id);
});

test('a Lead gap keeps its answer, first, even below 0.8 of the best', () => {
 const state = chimps(650, []);
 const all = options(state).map(x => x.id === 'place:BombShooter@S03' ? {...x, details: {...x.details, threat: ['lead']}} : x);
 assert.ok(all.some(x => x.details?.threat));
 const r = on(() => applyEarlyShort(state, all, {paths}));
 assert.equal(r.candidates[0].id, 'place:BombShooter@S03');
 assert.equal(r.rule.kept_threat, 1);
 assert.ok(r.candidates.slice(1).every(isPlace('DartMonkey')));
 assert.ok(!r.candidates.some(x => x.details?.kind === 'place' && x.details.tower === 'BombShooter' && x.id !== 'place:BombShooter@S03'));
});

test('nothing affordable leaves "Start round"', () => {
 const state = chimps(0, [bomb()]);
 assert.equal(options(state).filter(x => x.details?.cost <= state.cash && x.details.cost > 0).length, 0);
 const out = on(() => floorRulesV6(state, options(state), {paths}));
 assert.equal(rule(out), undefined);
 assert.ok(ids(out.candidates).includes('start_round'));
 const direct = on(() => applyEarlyShort(state, options(state), {paths}));
 assert.equal(direct.rule, null);
});

test('inactive at 2+ lives, at round 11, and for v4', () => {
 const two = chimps(650, [], {lives: 2});
 assert.equal(rule(on(() => floorRulesV6(two, options(two), {paths}))), undefined, '2 lives');
 const r11 = chimps(650, [], {round: {...v0Round6().round, number: 11, index: 10}});
 assert.equal(on(() => applyEarlyShort(r11, options(r11), {paths})).rule, null, 'round 11');
 const state = chimps(650, []);
 assert.equal(rule(on(() => floorRulesV4(state, options(state), {paths}))), undefined, 'v4');
 assert.equal(rule(on(() => floorRulesV6(state, options(state), {paths}, {earlyShort: false}))), undefined, 'v6 revision 6');
 assert.equal(rule(floorRulesV6(state, options(state), {paths})), undefined, 'without the early margin');
});

test('tower cap: an answering placement passes only when no upgrade answers', () => {
 const place = {id: 'place:DartMonkey@S01', details: {kind: 'place', tower: 'DartMonkey', cost: 200, early: 0.1}};
 const other = {id: 'place:BombShooter@S02', details: {kind: 'place', tower: 'BombShooter', cost: 405}};
 const upgrade = {id: 'upgrade:1:p1', details: {kind: 'upgrade', tower_id: 1, cost: 215, early: 0.05}};
 const towers = Array.from({length: 12}, (_, i) => ({id: i + 1, base_id: 'DartMonkey', tiers: [0, 0, 0]}));
 const state = {in_game: true, cash: 1000, towers, round: {number: 6}};
 const floor = [{kind: 'early_short'}];
 const a = applyTowerCap(state, [place, other], [place, other], floor);
 assert.deepEqual([ids(a.candidates), a.rule.kind, a.rule.survival], [[place.id], 'tower_cap_exception', ['early_short']]);
 const b = applyTowerCap(state, [place, other, upgrade], [place, other, upgrade], floor);
 assert.deepEqual([ids(b.candidates), b.rule.kind], [[upgrade.id], 'tower_cap']);
});
