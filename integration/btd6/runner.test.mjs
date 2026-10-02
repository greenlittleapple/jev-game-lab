import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBtd6Runner} from './runner.mjs';
import {normalizeState} from './state.mjs';
import {runLog} from '../../core/runner.mjs';
import {fileChannel} from '../../core/strategy-channel.mjs';
import {newStrategyStatus} from '../../core/hierarchical.mjs';
import {rawPreRound, rawRound21, catalog, paths, openingPlan} from './fixtures/index.mjs';
import {pickSpots, gridPoints, pathBounds} from './spots.mjs';
import {MOD_HELPER_PIN} from './pins.mjs';
import {advanceToMenu} from './lifecycle.mjs';

const spots = pickSpots(gridPoints(pathBounds(paths, 20), 10), paths, {radius: 40, count: 8, minSeparation: 20});
const health = async () => ({version: '0.3.0', mod_helper: {name: 'BloonsTD6 Mod Helper', ...MOD_HELPER_PIN, file: 'Btd6ModHelper.dll'}});

// A bridge that applies commands to an in-memory state and checks the expectations they carry.
// validFor(tower, point) narrows where a tower can be placed (all free points by default).
function fakeBridge(raw, {validFor = () => true} = {}) {
 const game = structuredClone(raw), ledger = new Map(), sent = [], checked = [];
 let nextId = 100;
 const hash = () => JSON.stringify(game.towers.map(t => [t.id, t.tiers]));
 return {
  sent, checked, health,
  state: async () => normalizeState({...structuredClone(game), towers_hash: hash()}),
  catalog: async () => ({towers: structuredClone(catalog)}),
  placementCheck: async (tower, points) => {
   checked.push(tower);
   return {tower, results: points.map(p => ({valid: validFor(tower, p) && !game.towers.some(t => Math.hypot(t.x - p.x, t.y - p.y) < 8)}))};
  },
  command: async command => {
   sent.push(command);
   let result;
   if (command.expect?.match_id !== game.match.id || command.expect?.towers_hash !== hash()) result = {status: 'rejected', reason: 'stale'};
   else if (command.action === 'place_tower') {
    const id = nextId++;
    game.towers.push({id, base_id: command.tower, tiers: [0, 0, 0], x: command.x, y: command.y, next_upgrades: []});
    game.cash -= catalog.find(t => t.id === command.tower)?.cost ?? 0; // towers outside the fixture (a test's own shop) cost nothing here
    result = {status: 'executed', tower_id: id};
   } else if (command.action === 'start_round') { game.round = {...game.round, active: true, before_first_wave: false}; result = {status: 'executed'}; }
   else result = {status: 'rejected', reason: 'unsupported'};
   ledger.set(command.command_id, {command_id: command.command_id, ...result});
   return ledger.get(command.command_id);
  },
  commandResult: async id => ledger.get(id) ?? null,
 };
}

async function setup(t, raw) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const bridge = fakeBridge(raw);
 const channel = fileChannel(join(dir, 'strategy'));
 const strategist = {channel, status: newStrategyStatus({enabled: true})};
 const asked = [];
 const ask = async question => { asked.push(question); return {model: 'jev-test', answers: {move: {type: 'choice', choice: question.questions.move.criteria.start_round ? 'start_round' : 'wait', confidence: 0.9}}, usage: {input_tokens: 10}}; };
 const log = runLog(join(dir, 'run.jsonl'));
 let clock = 0;
 const {runner} = createBtd6Runner({bridge, ask, strategist, log, catalog, paths, spots, minIntervalMs: 0, pollMs: 5, now: () => (clock += 10)});
 runner.resume();
 return {runner, bridge, channel, strategist, asked, log};
}

test('before the first round: the opening plan is waited for, its first step is placed without Jev, then the round starts', async t => {
 const {runner, bridge, channel, strategist, asked, log} = await setup(t, rawPreRound());
 const stepping = runner.step();
 let request = null;
 while (!(request = await channel.pending())) await new Promise(r => setTimeout(r, 5));
 assert.equal(request.reason, 'match_start');
 assert.equal(request.brief.timing.plan_from_round, 3);
 assert.deepEqual(request.brief.spots.map(s => s.id), spots.map(s => s.id));
 await channel.answer(request.id, openingPlan());
 assert.equal(await stepping, 'executed');
 assert.equal(asked.length, 0, 'the planned step needed no Jev call');
 assert.equal(bridge.sent[0].action, 'place_tower');
 assert.deepEqual([bridge.sent[0].x, bridge.sent[0].y], [spots[0].x, spots[0].y]);
 assert.equal(bridge.sent[0].expect.match_id, rawPreRound().match.id);
 assert.deepEqual(strategist.status.stepTowers, {s1: 100}, 'the tower made for step s1 is remembered');
 assert.equal(await runner.step(), 'executed');
 assert.equal(bridge.sent[1].action, 'start_round');
 assert.equal(asked.length, 1, 'with darts allowed outside the build order, Jev chose to start the round');
 const logged = (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 assert.ok(logged.every(e => e.match_id === rawPreRound().match.id), 'every record names its match');
 assert.deepEqual(logged.filter(e => e.kind === 'decision').map(e => [e.decisionSource, e.outcome]), [['plan', 'executed'], ['jev', 'executed']]);
});

test('each match is recorded once with its ruleset and unlock_all; a match that does not meet the ruleset is not played', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-series-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const read = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 const run = async raw => {
  const log = runLog(join(dir, `${raw.match.id}.jsonl`)), series = runLog(join(dir, 'series.jsonl'));
  const {runner} = createBtd6Runner({bridge: fakeBridge(raw), ask: async () => { throw Error('no Jev call expected'); }, log, series,
   catalog, paths, spots, minIntervalMs: 0, now: () => 0});
  runner.resume();
  return {runner, log};
 };
 const ok = await run({...rawRound21(), cash: 0, towers: []});
 await ok.runner.step();
 await ok.runner.step();
 const [start] = (await read(ok.log.file)).filter(e => e.kind === 'run_start');
 assert.deepEqual([start.match_id, start.ruleset.id, start.unlock_all, start.setup.mode_name], [rawRound21().match.id, 'btd6-open-v2', true, 'Standard']);
 const entries = await read(join(dir, 'series.jsonl'));
 assert.equal(entries.length, 1, 'recorded once per match');
 assert.deepEqual([entries[0].run, entries[0].ruleset.id, entries[0].unlock_all], [rawRound21().match.id, 'btd6-open-v2', true]);
 const previous = process.env.BTD6_REQUIRE_ALL_UNLOCKS;
 process.env.BTD6_REQUIRE_ALL_UNLOCKS = '1';
 t.after(() => { if (previous === undefined) delete process.env.BTD6_REQUIRE_ALL_UNLOCKS; else process.env.BTD6_REQUIRE_ALL_UNLOCKS = previous; });
 const off = await run({...rawRound21(), match: {...rawRound21().match, id: 'account-unlocks'}, unlock_all: false});
 assert.equal(await off.runner.step(), 'cancelled');
 assert.equal(off.runner.status.mode, 'paused');
 assert.match(off.runner.status.message, /BTD6_REQUIRE_ALL_UNLOCKS is set/);
});

test('an allowlisted screen is dismissed as a forced transition; an unknown one stops the runner', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-popup-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const sent = [];
 let popup = {kind: 'level_up', class: 'LevelUpScreen', buttons: [{name: 'ContinueButton', interactable: true}], options: []};
 const game = {...rawRound21(), paused: true, ready: false};
 const bridge = {
  health,
  state: async () => normalizeState({...structuredClone(game), popup: popup && structuredClone(popup)}),
  placementCheck: async (tower, points) => ({tower, results: points.map(() => ({valid: true}))}),
  command: async command => { sent.push(command); popup = null; return {command_id: command.command_id, status: 'executed'}; },
  commandResult: async () => null,
 };
 const log = runLog(join(dir, 'run.jsonl'));
 const {runner} = createBtd6Runner({bridge, ask: async () => { throw Error('no Jev call expected'); }, log, catalog, paths, spots, minIntervalMs: 0, now: () => 0});
 runner.resume();
 assert.equal(await runner.step(), 'executed');
 assert.deepEqual(sent[0].expect.popup_class, 'LevelUpScreen');
 assert.deepEqual([sent[0].action, sent[0].popup, sent[0].button], ['dismiss_popup', 'level_up', 'continue']);
 assert.equal(sent[0].popup_class, undefined, 'the screen class travels in the expect block');
 assert.equal(runner.status.decisions, 0, 'a forced transition is not a decision');
 const logged = (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 assert.deepEqual(logged.filter(e => e.kind === 'dispatch').map(e => e.outcome), ['pending']);
 assert.equal(logged.find(e => e.kind === 'decision').decisionSource, 'forced');
 popup = {kind: 'unknown', class: 'PauseScreen', buttons: [{name: 'ResumeButton', interactable: true}], options: []};
 assert.equal(await runner.step(), 'cancelled');
 assert.equal(runner.status.mode, 'paused');
 assert.match(runner.status.message, /PauseScreen/);
 assert.equal(sent.length, 1, 'nothing is pressed on an unknown screen');
});

test('mid-round the strategist is asked without stopping play', async t => {
 const {runner, bridge, channel, asked} = await setup(t, rawRound21());
 assert.equal(await runner.step(), 'held', 'Jev chose to wait while the request is open');
 const request = await channel.pending();
 assert.equal(request.reason, 'match_start');
 assert.equal(request.brief.timing.plan_from_round, 21 + request.brief.timing.lead_rounds);
 assert.equal(asked.length, 1);
 assert.equal(bridge.sent.length, 0);
});

test('a Mod Helper other than the pinned build stops the runner before anything is sent', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-pin-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const bridge = {...fakeBridge(rawRound21()), health: async () => ({version: '0.3.0', mod_helper: {version: '3.7.0', sha256: 'ab'.repeat(32)}})};
 const {runner} = createBtd6Runner({bridge, ask: async () => { throw Error('no Jev call expected'); }, log: runLog(join(dir, 'run.jsonl')),
  catalog, paths, spots, minIntervalMs: 0, now: () => 0});
 runner.resume();
 assert.equal(await runner.step(), 'cancelled');
 assert.equal(runner.status.mode, 'paused');
 assert.match(runner.status.message, /Mod Helper 3\.7\.0 .*not the pinned 3\.6\.8/);
 assert.equal(bridge.sent.length, 0);
});

test('spots are checked for each tower once per tower layout, and the shop comes from the bridge', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-spots-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 // The Boomerang fits only left of x = 0, as a water tower fits only on water.
 const bridge = fakeBridge({...rawRound21(), towers: []}, {validFor: (tower, p) => tower !== 'BoomerangMonkey' || p.x < 0});
 const log = runLog(join(dir, 'run.jsonl'));
 const wait = async () => ({model: 'jev-test', answers: {move: {type: 'choice', choice: 'wait', confidence: 0.9}}, usage: {input_tokens: 10}});
 const {runner, spotsFor, context} = createBtd6Runner({bridge, ask: wait, log, paths, spots, minIntervalMs: 0, now: () => 0});
 runner.resume();
 await runner.step();
 assert.deepEqual([...bridge.checked].sort(), ['BombShooter', 'BoomerangMonkey', 'DartMonkey', 'Quincy'], 'each affordable tower once; the locked, unplaceable and non-ruleset ones not at all');
 assert.ok(context().catalog.some(t => t.id === 'BombShooter') && !context().catalog.some(t => t.id === 'Gwendolin'), 'the ruleset filters the bridge\'s shop');
 assert.ok(spotsFor('BoomerangMonkey').length > 0 && spotsFor('BoomerangMonkey').every(s => s.x < 0));
 assert.ok(spotsFor('DartMonkey').some(s => s.x >= 0));
 const [decision] = (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l)).filter(e => e.kind === 'decision');
 const boomerangSpots = decision.options.filter(id => id.startsWith('place:BoomerangMonkey@')).map(id => spots.find(s => s.id === id.split('@')[1]));
 assert.ok(boomerangSpots.length > 0 && boomerangSpots.every(s => s.x < 0), 'Boomerang options use the Boomerang\'s own spots');
 await runner.step();
 assert.equal(bridge.checked.length, 4, 'the same tower layout is not checked again');
});

test('over the main menu, an allowlisted screen is dismissed without a match; an unknown one stops the runner', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-menu-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const sent = [];
 let popup = {kind: 'daily_rewards', scope: 'menu', source: 'menu', class: 'DailyRewardsScreen', buttons: [{name: 'BackButton', interactable: true}], options: []};
 const bridge = {
  health,
  state: async () => normalizeState({api: 1, screen: 'menu', main_menu: !popup, loading: false, unlock_all: true, towers: [], popup: popup && structuredClone(popup)}),
  placementCheck: async () => { throw Error('no placement check on the menu'); },
  catalog: async () => { throw Error('no shop on the menu'); },
  command: async command => { sent.push(command); popup = null; return {command_id: command.command_id, status: 'executed', detail: 'closed without claiming'}; },
  commandResult: async () => null,
 };
 const {runner} = createBtd6Runner({bridge, ask: async () => { throw Error('no Jev call expected'); }, log: runLog(join(dir, 'run.jsonl')),
  paths, spots, minIntervalMs: 0, now: () => 0});
 runner.resume();
 assert.equal(await runner.step(), 'executed');
 assert.deepEqual([sent[0].action, sent[0].popup, sent[0].button], ['dismiss_popup', 'daily_rewards', 'back']);
 assert.deepEqual(sent[0].expect, {popup_class: 'DailyRewardsScreen'}, 'a screen over the menu carries no match');
 popup = {kind: 'unknown', scope: 'menu', source: 'popup', class: 'DataConsentPopupBody', buttons: [{name: 'AcceptButton', interactable: true}], options: []};
 assert.equal(await runner.step(), 'cancelled');
 assert.match(runner.status.message, /DataConsentPopupBody/);
 assert.equal(sent.length, 1, 'nothing is pressed on an unknown screen');
});

test('a store ad over the main menu between runs is closed as a forced step, never Try or Purchase', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-store-ad-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const sent = [];
 const buttons = [{name: 'ScrollFakeBtn', interactable: true}, {name: 'CloseButton', interactable: true},
  {name: 'TryButton', label: 'Try', interactable: true}, {name: 'PurchaseButton', label: 'Get Now', interactable: true}];
 let popup = {kind: 'store_ad', scope: 'menu', source: 'popup', class: 'StoreLegendsPopup', buttons, options: []};
 const bridge = {
  health,
  state: async () => normalizeState({api: 1, screen: 'menu', main_menu: !popup, loading: false, unlock_all: true, towers: [], popup: popup && structuredClone(popup)}),
  placementCheck: async () => { throw Error('no placement check on the menu'); },
  catalog: async () => { throw Error('no shop on the menu'); },
  command: async command => { sent.push(command); popup = null; return {command_id: command.command_id, status: 'executed', detail: 'persistent listeners: CloseClicked'}; },
  commandResult: async () => null,
 };
 const file = join(dir, 'run.jsonl');
 const {runner} = createBtd6Runner({bridge, ask: async () => { throw Error('no Jev call expected'); }, log: runLog(file),
  paths, spots, minIntervalMs: 0, now: () => 0});
 runner.resume();
 assert.equal(await runner.step(), 'executed');
 assert.equal(sent.length, 1);
 assert.deepEqual([sent[0].action, sent[0].popup, sent[0].button], ['dismiss_popup', 'store_ad', 'close']);
 assert.deepEqual(sent[0].expect, {popup_class: 'StoreLegendsPopup'}, 'a screen over the menu carries no match');
 const log = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
 assert.ok(log.some(e => e.kind === 'decision' && e.decisionSource === 'forced' && e.outcome === 'executed'), 'logged as a forced step');
 assert.equal(runner.status.decisions, 0, 'not counted as a decision');
 // Without a CloseButton the bridge reports the ad as unknown: nothing is pressed and the runner stops.
 popup = {kind: 'unknown', scope: 'menu', source: 'popup', class: 'StoreLegendsPopup',
  buttons: buttons.filter(b => b.name !== 'CloseButton'), options: []};
 assert.equal(await runner.step(), 'cancelled');
 assert.match(runner.status.message, /StoreLegendsPopup, kind unknown/);
 assert.equal(sent.length, 1, 'Try and Purchase are never pressed');
});

test('stepping to the main menu closes a store ad, retrying while its Close button is still disabled', async () => {
 const buttons = [{name: 'CloseButton', interactable: true}, {name: 'TryButton', interactable: true}, {name: 'PurchaseButton', interactable: true}];
 let popup = {kind: 'store_ad', scope: 'menu', source: 'popup', class: 'StoreLegendsPopup', buttons, options: []};
 const sent = [];
 let refusals = 1;
 const bridge = {state: async () => ({in_game: false, main_menu: !popup, loading: false, towers: [], popup})};
 const dispatch = async command => {
  sent.push(command);
  if (refusals-- > 0) return {command_id: command.command_id, status: 'rejected', reason: 'button_unavailable'};
  popup = null;
  return {command_id: command.command_id, status: 'executed'};
 };
 let id = 0;
 const state = await advanceToMenu(bridge, dispatch, {sleep: async () => {}, pollMs: 0, retryMs: 0, newId: () => `id-${++id}`});
 assert.equal(state.main_menu, true);
 assert.equal(sent.length, 2);
 assert.ok(sent.every(c => c.action === 'dismiss_popup' && c.popup === 'store_ad' && c.button === 'close' && c.expect.popup_class === 'StoreLegendsPopup'));
});

test('a known tip is closed as a forced step; an unknown single-OK dialog pauses with its text in the message and the log', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-tip-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const sent = [];
 const ok = [{name: 'OKButton', label: 'OK', interactable: true}];
 const tipText = 'You have permanently unlocked Monkey Upgrades but still need to apply them to your Monkeys each game. Click a Monkey now to apply upgrades.';
 let popup = {kind: 'tutorial_notice', scope: 'match', source: 'popup', class: 'Popup', title: 'Upgrade Your Monkeys!', text: tipText, buttons: ok, options: []};
 const game = {...rawRound21(), paused: true, ready: false};
 const bridge = {
  health,
  state: async () => normalizeState({...structuredClone(game), popup: popup && structuredClone(popup)}),
  placementCheck: async (tower, points) => ({tower, results: points.map(() => ({valid: true}))}),
  command: async command => { sent.push(command); popup = null; return {command_id: command.command_id, status: 'executed'}; },
  commandResult: async () => null,
 };
 const log = runLog(join(dir, 'run.jsonl'));
 const {runner, resumeAfterScreen} = createBtd6Runner({bridge, ask: async () => { throw Error('no Jev call expected'); }, log, catalog, paths, spots, minIntervalMs: 0, now: () => 0});
 runner.resume();
 assert.equal(await runner.step(), 'executed');
 assert.deepEqual([sent[0].action, sent[0].popup, sent[0].button, sent[0].expect.popup_class], ['dismiss_popup', 'tutorial_notice', 'ok', 'Popup']);
 assert.equal(runner.status.decisions, 0, 'a forced step is not a decision');
 const read = async () => (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 assert.equal((await read()).find(e => e.kind === 'decision').decisionSource, 'forced');
 popup = {kind: 'unknown', scope: 'match', source: 'popup', class: 'Popup', title: 'Some New Tip', text: 'A tip the bridge has not seen.', buttons: ok, options: []};
 assert.equal(await runner.step(), 'cancelled');
 assert.equal(runner.status.mode, 'paused');
 assert.match(runner.status.message, /Popup, kind unknown; buttons: OKButton "OK"; text: Some New Tip: A tip the bridge has not seen\./);
 assert.equal(sent.length, 1, 'nothing is pressed on an unknown single-OK dialog');
 const unhandled = (await read()).find(e => e.kind === 'popup_unhandled');
 assert.deepEqual([unhandled.popup.title, unhandled.popup.text], ['Some New Tip', 'A tip the bridge has not seen.']);

 // The runner resumes by itself once that screen has closed over the same match, and not before.
 assert.match(runner.status.message, /the runner resumes once it has closed/);
 assert.equal(await resumeAfterScreen(), false, 'the screen is still open');
 assert.equal(await resumeAfterScreen({held: true}), false, 'not while the operator holds the run');
 popup = null;
 assert.equal(await resumeAfterScreen({held: true}), false, 'not while the operator holds the run, even after the screen closed');
 assert.equal(runner.status.mode, 'paused');
 assert.equal(await resumeAfterScreen(), true);
 assert.equal(runner.status.mode, 'running');
 const resumed = (await read()).find(e => e.kind === 'runner_resumed');
 assert.equal(resumed.message, 'resumed after screen closed');
 assert.match(resumed.paused_for, /Some New Tip/);
 assert.equal(await resumeAfterScreen(), false, 'only once per pause');

 // A manual pause needs an explicit resume, even with no screen open.
 runner.pause('Paused by the operator.');
 assert.equal(await resumeAfterScreen(), false);
 assert.equal(runner.status.mode, 'paused');
 runner.resume();

 // An unknown screen, then a manual pause on top: the operator's pause wins.
 popup = {kind: 'unknown', scope: 'match', source: 'popup', class: 'Popup', title: 'Another Tip', text: 'Text.', buttons: ok, options: []};
 assert.equal(await runner.step(), 'cancelled');
 runner.pause('Paused by the operator.');
 popup = null;
 assert.equal(await resumeAfterScreen(), false);
 assert.equal(runner.status.mode, 'paused');
 runner.resume();

 // An unknown screen that closes onto another match does not resume the runner.
 popup = {kind: 'unknown', scope: 'match', source: 'popup', class: 'Popup', title: 'Another Tip', text: 'Text.', buttons: ok, options: []};
 assert.equal(await runner.step(), 'cancelled');
 popup = null;
 const matchBefore = game.match.id;
 game.match.id = 'another-match';
 assert.equal(await resumeAfterScreen(), false);
 assert.equal(runner.status.mode, 'paused');
 game.match.id = matchBefore;
 assert.equal(await resumeAfterScreen(), true, 'back on the paused match with no screen open');
 assert.equal((await read()).filter(e => e.kind === 'runner_resumed').length, 2);
});

test('a restart is a new match for a series runner; a runner bound to one match pauses on another ID without a run_start', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-matchid-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const read = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 const setup = async (name, matchId) => {
  const game = {...rawRound21(), cash: 0, towers: []};
  const bridge = {health, state: async () => normalizeState(structuredClone(game)),
   placementCheck: async (tower, points) => ({tower, results: points.map(() => ({valid: true}))}),
   command: async () => { throw Error('no command expected'); }, commandResult: async () => null};
  const log = runLog(join(dir, `${name}.jsonl`));
  const {runner} = createBtd6Runner({bridge, ask: async () => { throw Error('no Jev call expected'); }, log, catalog, paths, spots, minIntervalMs: 0, now: () => 0, matchId});
  runner.resume();
  return {game, runner, log};
 };
 const first = rawRound21().match.id;
 const series = await setup('series', null);
 await series.runner.step();
 series.game.match = {...series.game.match, id: `${first}-restart`};
 await series.runner.step();
 assert.deepEqual((await read(series.log.file)).filter(e => e.kind === 'run_start').map(e => e.match_id), [first, `${first}-restart`]);
 const bound = await setup('bound', first);
 await bound.runner.step();
 bound.game.match = {...bound.game.match, id: `${first}-other`};
 assert.equal(await bound.runner.step(), 'cancelled');
 assert.equal(bound.runner.status.message, 'Another match is open.');
 assert.deepEqual((await read(bound.log.file)).filter(e => e.kind === 'run_start').map(e => e.match_id), [first]);
});

test('a hero unlock splash is continued as a forced step, retried while its button animates in; one with a purchase button pauses', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-hero-splash-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const sent = [];
 const splash = {scope: 'match', source: 'menu', class: 'HeroPurchaseSplash', full_class: 'Assets.Scripts.Unity.UI_New.Main.HeroSelect.HeroPurchaseSplash',
  menu_name: 'GwendolinUnlockUI', title: null, text: null, options: []};
 let popup = {...splash, kind: 'hero_unlock_notice', buttons: [{name: 'Click', label: null, interactable: false}]};
 let enabled = false;
 const game = {...rawRound21(), paused: true};
 const bridge = {
  health,
  state: async () => normalizeState({...structuredClone(game), popup: popup && structuredClone(popup)}),
  placementCheck: async (tower, points) => ({tower, results: points.map(() => ({valid: true}))}),
  command: async command => {
   sent.push(command);
   if (!enabled) return {command_id: command.command_id, status: 'rejected', reason: 'button_unavailable'};
   popup = null;
   return {command_id: command.command_id, status: 'executed', detail: 'GwendolinUnlockUI'};
  },
  commandResult: async () => null,
 };
 const log = runLog(join(dir, 'run.jsonl'));
 const {runner} = createBtd6Runner({bridge, ask: async () => { throw Error('no Jev call expected'); }, log, catalog, paths, spots, minIntervalMs: 0, now: () => 0});
 runner.resume();
 assert.equal(await runner.step(), 'rejected', 'the button is still animating in');
 assert.equal(runner.status.mode, 'running', 'a refused press does not stop the runner');
 enabled = true;
 assert.equal(await runner.step(), 'executed');
 assert.equal(sent.length, 2);
 assert.deepEqual([sent[1].action, sent[1].popup, sent[1].button, sent[1].expect.popup_class], ['dismiss_popup', 'hero_unlock_notice', 'continue', 'HeroPurchaseSplash']);
 assert.equal(sent[1].expect.match_id, game.match.id);
 assert.equal(runner.status.decisions, 0, 'forced steps are not decisions');
 const read = async () => (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 assert.ok((await read()).filter(e => e.kind === 'decision').every(e => e.decisionSource === 'forced'));

 // The bridge leaves a splash with a purchase button unknown: nothing is pressed and the runner pauses.
 popup = {...splash, kind: 'unknown', buttons: [{name: 'Click', interactable: true}, {name: 'BuyButton', label: 'Buy', interactable: true}]};
 assert.equal(await runner.step(), 'cancelled');
 assert.equal(runner.status.mode, 'paused');
 assert.match(runner.status.message, /HeroPurchaseSplash, kind unknown, menu GwendolinUnlockUI/);
 assert.equal(sent.length, 2);
});

// A placement the game queues shows in the state only a few reads later (the live bridge settles it a frame or more later).
test('after a queued purchase the runner decides again only once the state shows it, and logs a timeout', async t => {
 const {QUEUED_WAIT_MS} = await import('./runner.mjs');
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-queued-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const run = async ({appliesAfter, steps = 6}) => {
  const bridge = fakeBridge({...rawRound21(), cash: 5000});
  const command = bridge.command;
  let reads = 0, applyAt = Infinity, pendingTower = null, prior = null;
  const state = bridge.state;
  bridge.state = async () => {
   reads++;
   const s = await state();
   // Until applyAt, the placed tower is hidden: the state from before the purchase.
   if (pendingTower != null && reads < applyAt) return {...s, towers: s.towers.filter(x => x.id !== pendingTower), towers_hash: prior};
   return s;
  };
  bridge.command = async c => {
   if (c.action === 'place_tower') prior = (await state()).towers_hash;
   const r = await command(c);
   if (c.action !== 'place_tower' || r.status !== 'executed') return r;
   pendingTower = r.tower_id; applyAt = reads + appliesAfter;
   return {...r, status: 'queued'};
  };
  bridge.commandResult = async id => ({command_id: id, status: 'executed'});
  let clock = 0;
  const log = runLog(join(dir, `run-${appliesAfter}.jsonl`));
  const place = async (_q, options) => options.find(o => o.id.startsWith('place:')) ?? options[0];
  const {runner} = createBtd6Runner({bridge, ask: async question => ({model: 'jev-test', usage: {input_tokens: 1},
   answers: {move: {type: 'choice', choice: Object.keys(question.questions.move.criteria).find(id => id.startsWith('place:')) ?? 'wait', confidence: 0.9}}}),
   log, catalog, paths, spots, minIntervalMs: 0, now: () => (clock += 100)});
  runner.resume();
  const outcomes = [];
  for (let i = 0; i < steps; i++) outcomes.push(await runner.step());
  const events = (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  return {outcomes, events, sent: bridge.sent};
 };
 // Shown after 3 reads: the steps in between are not due, then the next purchase goes out with the new hash.
 const shown = await run({appliesAfter: 3});
 assert.equal(shown.outcomes[0], 'queued');
 assert.ok(shown.outcomes.slice(1).includes('not_due'), shown.outcomes.join(','));
 assert.ok(!shown.events.some(e => e.kind === 'queued_wait_timeout'));
 assert.ok(!shown.events.some(e => e.outcome === 'game_rejected' || e.outcome === 'stale_rejected'));
 // Never shown: after QUEUED_WAIT_MS the runner logs a timeout and decides again.
 const never = await run({appliesAfter: 1000, steps: 30});
 const timeout = never.events.find(e => e.kind === 'queued_wait_timeout');
 assert.ok(timeout && timeout.action === 'place_tower' && timeout.waited_ms >= QUEUED_WAIT_MS, never.outcomes.join(','));
});

test('no fallback search for a tower the spot catalog found unplaceable on the map; the record names whose counts it has', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-unplaceable-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 // The Boomerang fits nowhere, as a Monkey Sub on a map without water; the Bomb Shooter's catalog spots are taken.
 const run = async unplaceable => {
  const bridge = fakeBridge({...rawRound21(), towers: []}, {validFor: tower => tower !== 'BoomerangMonkey' && tower !== 'BombShooter'});
  const log = runLog(join(dir, `run-${unplaceable.length}.jsonl`));
  const wait = async () => ({model: 'jev-test', answers: {move: {type: 'choice', choice: 'wait', confidence: 0.9}}, usage: {input_tokens: 10}});
  const {runner} = createBtd6Runner({bridge, ask: wait, log, paths, spots, minIntervalMs: 0, now: () => 0, unplaceable});
  runner.resume();
  await runner.step();
  const events = (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  return {checked: bridge.checked, fallback: events.filter(e => e.kind === 'spot_fallback')};
 };
 const without = await run([]), with_ = await run(['BoomerangMonkey']);
 const count = (list, tower) => list.filter(x => x === tower).length;
 assert.equal(count(without.checked, 'BoomerangMonkey'), 2, 'catalog spots, then the fallback points');
 assert.equal(count(with_.checked, 'BoomerangMonkey'), 1, 'catalog spots only');
 assert.equal(count(with_.checked, 'BombShooter'), 2, 'a tower that may fit elsewhere still gets the fallback search');
 assert.deepEqual(with_.fallback.map(e => [e.tower, e.counts_for]), [['BombShooter', 'DartMonkey']]);
});

test('towers without data in towers.json are left out of the candidates in every policy, recorded in run_start with a warning', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-nodata-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const read = async file => (await readFile(file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 // A fake shop: the fixture's towers, the Skywarden (in the table now), and two towers with no entry, one free.
 const shop = [...catalog, {id: 'Skywarden', name: 'Skywarden', cost: 205, range: 48, is_hero: false, unlocked: true},
  {id: 'Sheriff', name: 'Sheriff', cost: 0, range: 50, is_hero: false, unlocked: true},
  {id: 'NewTower', name: 'NewTower', cost: 100, range: 40, is_hero: false, unlocked: true}];
 // Jev picks the first option offered, whatever the policy's grouping.
 const wait = async q => ({model: 'jev-test', answers: {move: {type: 'choice', choice: Object.keys(q.questions.move.criteria)[0], confidence: 0.9}}, usage: {input_tokens: 10}});
 for (const jevPolicy of ['btd6-jev-v0', 'btd6-jev-v1', 'btd6-jev-v2', 'btd6-jev-v3', 'btd6-jev-v4', 'btd6-jev-v6']) {
  const log = runLog(join(dir, `${jevPolicy}.jsonl`));
  const bridge = {...fakeBridge({...rawRound21(), towers: []}), catalog: async () => ({towers: structuredClone(shop)})};
  const {runner, context} = createBtd6Runner({bridge, ask: wait, log, paths, spots, jevPolicy, minIntervalMs: 0, now: () => 0});
  runner.resume();
  await runner.step();
  await runner.step();
  const ids = context().catalog.map(t => t.id);
  assert.ok(ids.includes('Skywarden') && ids.includes('DartMonkey'), jevPolicy);
  assert.ok(!ids.includes('Sheriff') && !ids.includes('NewTower'), `${jevPolicy}: no_data towers are not offered`);
  const records = await read(log.file);
  const [start] = records.filter(e => e.kind === 'run_start');
  assert.deepEqual(start.no_data, ['Sheriff', 'NewTower'], jevPolicy);
  assert.match(start.tower_data.version, /^[0-9a-f]{12}$/);
  assert.match(start.tower_data.source, /f818c39/);
  assert.deepEqual(records.filter(e => e.kind === 'warning').map(e => e.message),
   ['No tower data (data/towers.json) for Sheriff, NewTower; left out of the candidates.'], `${jevPolicy}: one warning`);
  const offered = records.filter(e => e.kind === 'decision').flatMap(e => [...(e.options ?? []), JSON.stringify(e.command ?? null)]);
  assert.equal(records.filter(e => e.kind === 'error').length, 0, jevPolicy);
  assert.ok(offered.length && !offered.some(o => /Sheriff|NewTower/.test(o)), `${jevPolicy}: never in a decision`);
 }
 // With the real shop (fixture) nothing is missing: an empty list and no warning.
 const log = runLog(join(dir, 'covered.jsonl'));
 const {runner} = createBtd6Runner({bridge: fakeBridge({...rawRound21(), towers: []}), ask: wait, log, paths, spots, minIntervalMs: 0, now: () => 0});
 runner.resume();
 await runner.step();
 const records = await read(log.file);
 assert.deepEqual(records.find(e => e.kind === 'run_start').no_data, []);
 assert.equal(records.filter(e => e.kind === 'warning').length, 0);
});
