import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeState, fingerprint, livesPercent, towerLabel} from './state.mjs';
import {describeState} from './runner.mjs';
import {modeName, upcomingThreats} from './rounds.mjs';
import {rawRound21, rawPreRound} from './fixtures/index.mjs';

test('a bridge state is checked and gains the displayed round and the mode round range', () => {
 const s = normalizeState(rawRound21());
 assert.equal(s.in_game, true);
 assert.equal(s.round.number, 21, 'index 20 is round 21');
 assert.deepEqual([s.match.start_round, s.match.end_round], [3, 80], 'Hard Standard runs from round 3 to 80');
 assert.equal(livesPercent(s), 98);
 assert.equal(towerLabel(s.towers[0]), 'DartMonkey 0-2-0');
 assert.equal(normalizeState({...rawPreRound(), match: {...rawPreRound().match, mode: 'Clicks'}}).match.end_round, 100, 'CHIMPS runs to round 100');
});

test('mode names and threats', () => {
 assert.deepEqual([modeName('Hard', 'Standard'), modeName('Hard', 'Hard'), modeName('Hard', 'Clicks'), modeName('Hard', 'HalfCash')], ['Standard', 'Standard', 'CHIMPS', 'HalfCash']);
 assert.equal(normalizeState({...rawRound21(), match: {...rawRound21().match, mode: 'Hard'}}).match.mode_name, 'Standard');
 assert.deepEqual(upcomingThreats(20, {within: 8}).map(t => t.id), ['white', 'camo', 'purple', 'zebra', 'lead']);
 assert.deepEqual(upcomingThreats(20, {within: 8, consultOnly: true}).map(t => t.id), ['camo', 'purple', 'lead']);
});

test('lives percentages use the starting lives, not the game\'s cap on lives', () => {
 const s = normalizeState(rawRound21());
 assert.deepEqual([s.starting_lives, s.max_lives, livesPercent(s)], [100, 5000, 98]);
 const medium = normalizeState({...rawRound21(), starting_lives: undefined, match: {...rawRound21().match, difficulty: 'Medium'}});
 assert.equal(medium.starting_lives, 150, 'without the bridge value, the mode\'s starting lives');
});

test('menus and malformed states', () => {
 assert.deepEqual(normalizeState({api: 1, screen: 'menu', match: null}), {api: 1, screen: 'menu', match: null, in_game: false, towers: []});
 assert.throws(() => normalizeState({api: 2, screen: 'menu'}), /API 2 is not supported/);
 assert.throws(() => normalizeState({...rawRound21(), cash: 'lots'}), /cash must be a number/);
 const bad = rawRound21(); bad.towers[0].tiers = [0, 2];
 assert.throws(() => normalizeState(bad), /tiers must be three integers/);
});

test('the fingerprint follows the match, round and towers, not cash or lives', () => {
 const s = normalizeState(rawRound21());
 assert.equal(fingerprint(s), fingerprint({...s, cash: 5, lives: 1}));
 assert.notEqual(fingerprint(s), fingerprint({...s, round: {...s.round, number: 22}}));
 assert.notEqual(fingerprint(s), fingerprint({...s, towers_hash: 'other'}));
 const unhashed = {...s, towers_hash: undefined};
 assert.notEqual(fingerprint(unhashed), fingerprint({...unhashed, towers: [{...s.towers[0], tiers: [1, 2, 0]}, s.towers[1]]}));
});

test('bridge 0.3.3 bloon summary and lives lost this round are read; older bridges give null', () => {
 const bloons = {count: 12, by_type: {Red: 10, GreenRegrowCamo: 1, MoabFortified: 1}, other_types: 0, camo: 1, regrow: 1, fortified: 1, moab_class: 1,
  furthest: 1, progress_p50: 0.5, progress_p75: 0.8, progress_p90: 0.95};
 const raw = rawRound21();
 const s = normalizeState({...raw, round: {...raw.round, lives_lost: 3}, bloons});
 assert.deepEqual(s.bloons, {...bloons, moabs: [], nearest_exit: []}, 'a bridge before 0.3.11 sends no moabs, before 0.3.15 no nearest_exit');
 assert.equal(s.round.lives_lost, 3);
 const old = normalizeState(rawRound21());
 assert.equal(old.bloons, null);
 assert.equal(old.round.lives_lost, null);
 assert.throws(() => normalizeState({...raw, bloons: {...bloons, furthest: 1.4}}), /bloons.furthest/);
 assert.throws(() => normalizeState({...raw, bloons: {...bloons, count: -1}}), /bloons.count/);
 assert.equal(normalizeState({...raw, bloons: {count: 0, by_type: {}, furthest: null}}).bloons.furthest, null);
});

test('bridge 0.3.15: the five bloons nearest the exit are read, and each logged state keeps the count, furthest and those five', () => {
 const raw = rawRound21();
 const nearest = [{type: 'CeramicCamo', camo: true, regrow: false, fortified: false, progress: 0.97}, {type: 'RainbowRegrow', camo: false, regrow: true, fortified: false, progress: 0.9},
  {type: 'Purple', camo: false, regrow: false, fortified: false, progress: 0.88}, {type: 'CeramicFortified', camo: false, regrow: false, fortified: true, progress: 0.8},
  {type: 'Ceramic', camo: false, regrow: false, fortified: false, progress: 0.75}];
 const bloons = {count: 140, by_type: {Ceramic: 60, CeramicCamo: 40, Rainbow: 40}, other_types: 0, camo: 40, regrow: 3, fortified: 1, moab_class: 0,
  furthest: 0.97, progress_p50: 0.4, progress_p75: 0.6, progress_p90: 0.8, moabs: [], nearest_exit: nearest};
 const s = normalizeState({...raw, bloons});
 assert.deepEqual(s.bloons.nearest_exit, nearest);
 const logged = describeState(s);
 assert.deepEqual(logged.bloons, {count: 140, furthest: 0.97, nearest_exit: nearest});
 assert.ok(JSON.stringify(logged.bloons).length < 600, 'small: no by_type, quantiles or MOAB list');
 assert.deepEqual(describeState(normalizeState({...raw, bloons: {count: 0, by_type: {}, furthest: null}})).bloons, {count: 0, furthest: null, nearest_exit: []}, 'an older bridge: no list');
 assert.equal('bloons' in describeState(normalizeState(rawRound21())), false, 'no summary (before 0.3.3): no bloons field');
 assert.throws(() => normalizeState({...raw, bloons: {...bloons, nearest_exit: 'x'}}), /nearest_exit/);
});
