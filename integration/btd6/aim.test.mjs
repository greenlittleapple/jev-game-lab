// Aiming the towers whose attack needs a point or the cursor (aim.mjs): the aim point on Monkey Meadow, the
// commands in order, the estimates' credit before and after, and the runner's forced aiming step.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AIM_TOLERANCE, POINT_TOWERS, aimPoint, aimStatus, aimStep, aimTarget, densePoints} from './aim.mjs';
import {reachFactor, roundCheck} from './estimate.mjs';
import {towerMoab} from './moab.mjs';
import {coverage, pathLength} from './spots.mjs';
import {meadowPaths} from './fixtures/index.mjs';
import {aimCandidate, createBtd6Runner, describeState, AIM_ATTEMPTS} from './runner.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {runLog} from '../../core/runner.mjs';
import {RULESETS} from './rulesets.mjs';
import {MOD_HELPER_PIN} from './pins.mjs';

const at = (x, y) => ({x, y});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const total = meadowPaths.reduce((n, p) => n + pathLength(p), 0);
const lengthNear = (p, r) => coverage(p, r, meadowPaths).share * total;

test('the aim point on Monkey Meadow is the playfield track point with the most track within the radius', () => {
 const r = POINT_TOWERS.MortarMonkey.radius;
 const p = aimPoint(meadowPaths, r);
 assert.ok(p, 'a point');
 assert.ok(Math.abs(p.x) <= 140 && Math.abs(p.y) <= 110, 'inside the playfield, not the off-screen entrance');
 // No sampled track point has more track near it than the chosen one (beyond sampling noise).
 const best = Math.max(...densePoints(meadowPaths, r).map(q => q.length));
 assert.ok(p.length >= best - 0.5);
 assert.ok(lengthNear(p, r) > 2 * r, `the track bends near it: ${lengthNear(p, r).toFixed(1)} units within ${r}, more than a straight pass`);
 // A point on a straight stretch has less.
 const straight = densePoints(meadowPaths, r).at(-1);
 assert.ok(straight.length < p.length);
 // Ties go to the point nearest the tower.
 const far = aimPoint(meadowPaths, r, {from: at(130, 100)}), near = aimPoint(meadowPaths, r, {from: at(-130, -100)});
 assert.ok(far.length >= best - 0.5 && near.length >= best - 0.5);
 assert.equal(aimPoint([], r), null);
 // maxDistance limits the points to those near the tower.
 const limited = aimPoint(meadowPaths, r, {from: at(0, 0), maxDistance: 40});
 assert.ok(dist(limited, at(0, 0)) <= 40);
});

const placed = (base_id, extra = {}) => ({id: 7, base_id, tiers: [0, 0, 0], x: -26, y: -44, ...extra});

test('aiming commands: the mode first, then the point; the Heli takes Pursuit when offered; other towers are left alone', () => {
 const dartling = placed('DartlingGunner', {targeting: 'Normal', target_modes: ['Normal', 'Locked'], target_point: null});
 const first = aimStep(dartling, meadowPaths);
 assert.deepEqual([first.action, first.tower_id, first.mode], ['set_targeting', 7, 'Locked']);
 const point = aimStep({...dartling, targeting: 'Locked'}, meadowPaths);
 assert.equal(point.action, 'set_target_point');
 assert.deepEqual({x: point.x, y: point.y}, aimTarget(dartling, meadowPaths).point);
 assert.equal(aimStep({...dartling, targeting: 'Locked', target_point: {x: point.x + 1, y: point.y}}, meadowPaths), null, `within ${AIM_TOLERANCE} units counts as aimed`);
 const mortar = placed('MortarMonkey', {targeting: 'TargetSelectedPoint', target_modes: ['TargetSelectedPoint'], target_point: {x: 0, y: 0}});
 assert.equal(aimStep(mortar, meadowPaths).action, 'set_target_point', 'a reticle elsewhere is moved');
 const heli = placed('HeliPilot', {targeting: 'FollowTouch', target_modes: ['FollowTouch', 'LockInPlace', 'PatrolPoints']});
 assert.deepEqual([aimStep(heli, meadowPaths).mode, aimTarget(heli, meadowPaths).point != null], ['LockInPlace', true], 'without Pursuit, Lock In Place at the point');
 const pursuit = {...heli, tiers: [2, 0, 0], target_modes: [...heli.target_modes, 'Pursuit']};
 assert.deepEqual(aimTarget(pursuit, meadowPaths), {mode: 'Pursuit', point: null});
 assert.equal(aimStep({...pursuit, targeting: 'Pursuit'}, meadowPaths), null);
 assert.equal(aimStep(placed('MonkeyAce', {targeting: 'Circle', target_modes: ['Circle', 'FigureEight']}), meadowPaths), null, 'the Ace keeps its circle');
 assert.equal(aimStep(placed('DartMonkey', {targeting: 'First', target_modes: ['First', 'Last']}), meadowPaths), null);
 assert.equal(aimStep(placed('DartlingGunner', {targeting: 'Normal'}), meadowPaths), null, 'a bridge before 0.3.12 reports no modes: nothing to send');
});

test('the estimates give an unaimed point tower nothing and an aimed one the track around its point', () => {
 const p = aimPoint(meadowPaths, POINT_TOWERS.MortarMonkey.radius, {from: at(-26, -44)});
 const mortar = extra => ({id: 3, base_id: 'MortarMonkey', tiers: [0, 3, 2], x: -26, y: -44, target_modes: ['TargetSelectedPoint'], ...extra});
 const unaimed = mortar({targeting: 'TargetSelectedPoint', target_point: null});
 const aimed = mortar({targeting: 'TargetSelectedPoint', target_point: {x: p.x, y: p.y}});
 const offTrack = mortar({targeting: 'TargetSelectedPoint', target_point: {x: 130, y: 100}});
 assert.deepEqual(aimStatus(unaimed, meadowPaths), {kind: 'unaimed'});
 assert.equal(reachFactor(unaimed, 30, meadowPaths).factor, 0);
 const f = reachFactor(aimed, 30, meadowPaths);
 assert.deepEqual([f.aim, f.factor, f.point], ['point', 1, {x: p.x, y: p.y}], 'at the densest point the blast covers a full pass');
 assert.ok(reachFactor(offTrack, 30, meadowPaths).factor < 0.5, 'aimed away from the track, little');
 // MOAB damage: the first half of the track within the blast radius of the point.
 assert.equal(towerMoab(unaimed, meadowPaths).share, 0);
 assert.ok(towerMoab(aimed, meadowPaths).share > 0);
 // Pops: an unaimed Dartling adds nothing, even without reach (v2's estimate).
 const dartling = {id: 4, base_id: 'DartlingGunner', tiers: [0, 2, 0], x: -26, y: -44, targeting: 'Normal', target_modes: ['Normal', 'Locked']};
 const dart = {id: 5, base_id: 'DartMonkey', tiers: [0, 0, 0], x: -26, y: -44};
 assert.equal(roundCheck([dart, dartling], 20, {lives: 100}).can_pop, roundCheck([dart], 20, {lives: 100}).can_pop);
 assert.ok(roundCheck([dart, {...dartling, targeting: 'Locked', target_point: {x: p.x, y: p.y}}], 20, {lives: 100, paths: meadowPaths, useReach: true}).can_pop
  > roundCheck([dart], 20, {lives: 100, paths: meadowPaths, useReach: true}).can_pop);
 // A Heli on Pursuit reaches the whole track.
 assert.equal(reachFactor({id: 6, base_id: 'HeliPilot', tiers: [2, 0, 0], x: 0, y: 0, targeting: 'Pursuit'}, 22, meadowPaths).factor, 1);
 // describeState reports the aim.
 const s = describeState({in_game: true, match: {id: 'm'}, round: {number: 5}, cash: 1, lives: 1, towers: [aimed]});
 assert.deepEqual([s.towers[0].targeting, s.towers[0].target_point], ['TargetSelectedPoint', {x: Math.round(p.x), y: Math.round(p.y)}]);
});

test('the runner aims a placed Dartling as a forced step: Locked, then the point, logged, with no Jev call', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-aim-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = fakeGame();
 const g = fake.game;
 Object.assign(g, {screen: 'in_game', popup: null, match: {id: 'aim-1', map: 'Tutorial', mode: 'Standard', difficulty: 'Hard', end: 80, result: null, auto_start: true,
  fast_forward: false, multiplier: 3, round: {index: 9, active: false, before_first_wave: false}, cash: 0, lives: 100, starting_lives: 100,
  towers: [{id: 50, base_id: 'DartlingGunner', tiers: [0, 0, 0], x: -80, y: 30, is_hero: false, worth: 850}]}});
 const paths = (await fake.bridge.map()).paths.map(p => p.points.map(([x, y]) => ({x, y})));
 const log = runLog(join(dir, 'run.jsonl'));
 const usage = {requests: 0, inputTokens: 0};
 let asked = 0;
 const ask = async payload => { asked++; return fakeJev({usage})(payload); };
 const aims = [], records = [];
 const {runner} = createBtd6Runner({bridge: {...fake.bridge, health: async () => ({version: '0.3.12', mod_helper: {name: 'BloonsTD6 Mod Helper', ...MOD_HELPER_PIN}})},
  ask, log, usage, limits: {}, paths, spots: [], ruleset: RULESETS['btd6-open-v3'], minIntervalMs: 0, matchId: 'aim-1', onAim: (s, d) => aims.push(d), onAimRecord: (s, d) => records.push([s.match.id, d.tower_id, d.action])});
 runner.resume();
 assert.equal(await runner.step(), 'executed');
 assert.equal(await runner.step(), 'executed');
 const target = aimTarget({...g.match.towers[0], target_modes: ['Normal', 'Locked']}, paths);
 assert.deepEqual(g.aims.map(a => a.action), ['set_targeting', 'set_target_point']);
 assert.deepEqual([g.match.towers[0].targeting, g.match.towers[0].target_point], ['Locked', target.point]);
 assert.equal(asked, 0, 'no Jev call');
 assert.equal(runner.status.decisions, 0, 'forced steps are not counted as decisions');
 assert.deepEqual(aims.map(a => a.tower_id), [50], 'one shot request, once the aim is complete');
 assert.deepEqual(records, [['aim-1', 50, 'set_targeting'], ['aim-1', 50, 'set_target_point']], 'onAimRecord after each aim record (pops.mjs aim_check)');
 const events = (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 const decisions = events.filter(e => e.kind === 'decision');
 assert.deepEqual(decisions.map(e => [e.decisionSource, e.chosen.command.action, e.outcome]), [['forced', 'set_targeting', 'executed'], ['forced', 'set_target_point', 'executed']]);
 assert.deepEqual(events.filter(e => e.kind === 'aim').map(e => [e.tower_id, e.action, e.mode]), [[50, 'set_targeting', 'Locked'], [50, 'set_target_point', 'Locked']]);
 // Aimed: the next step offers the normal options again.
 const state = await fake.bridge.state();
 assert.equal(aimCandidate(state, paths), null);
});

test('a refused aiming command is sent at most AIM_ATTEMPTS times per match', () => {
 const state = {in_game: true, match: {id: 'm', result: null}, round: {number: 5}, popup: null,
  towers: [placed('DartlingGunner', {targeting: 'Normal', target_modes: ['Normal', 'Locked']})]};
 const attempts = new Map();
 const c = aimCandidate(state, meadowPaths, attempts);
 assert.equal(c.details.kind, 'aim_tower');
 attempts.set(c.details.key, AIM_ATTEMPTS);
 assert.equal(aimCandidate(state, meadowPaths, attempts), null);
 assert.equal(aimCandidate({...state, popup: {kind: 'level_up'}}, meadowPaths), null, 'a screen comes first');
});
