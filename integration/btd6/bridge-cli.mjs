// Operator tool for the live spikes (docs/BTD6-SPIKE-PLAN.md). Read commands only observe; commands
// that change the game need --confirm.
//   npm run btd6:bridge -- health | state | map | catalog | profile | check <tower> <x> <y>
//        profile: the saved profile's counts, unlocked towers and heroes, and acquired upgrades (read directly,
//        not through the game's unlock checks; --json prints the whole /profile answer)
//   npm run btd6:bridge -- start <map> <difficulty> <mode> [--hero <id>] [--replace-saved] --confirm
//        --replace-saved replaces a saved game on the map (logged with its summary); without it one is refused
//        e.g. start MonkeyMeadow Hard CHIMPS --confirm (map and mode IDs also work: Tutorial, Clicks)
//   npm run btd6:bridge -- advance --confirm     (from launch to the main menu: title screen Start, Modded Client
//        Continue, daily rewards Back, update notice OK; stops at any other screen)
//   npm run btd6:bridge -- home --confirm        (leave the match, or press Home on its victory or defeat screen)
//   npm run btd6:bridge -- place <tower> <x> <y> --confirm
//   npm run btd6:bridge -- upgrade <tower-id> <path 1-3> --confirm   (top, middle, bottom; "state" lists each tower's next upgrades)
//   npm run btd6:bridge -- dismiss <kind> <button> --confirm   (a screen over the match or the main menu)
//   npm run btd6:bridge -- speed <1-10> --confirm   (bridge 0.3.4: 1 normal speed, 3 the game's fast-forward,
//        other values fast-forward with that time scale; in a match)
//   npm run btd6:bridge -- start-round --confirm  (start the next round; refused while one runs)
//   npm run btd6:bridge -- auto-start on|off --confirm   (bridge 0.3.11: the match's auto-start setting)
//   npm run btd6:bridge -- target <tower-id> <mode> --confirm        (bridge 0.3.12: the tower's targeting, one of the
//        target_modes "state" lists, e.g. First, Strong, Locked, Pursuit)
//   npm run btd6:bridge -- target-point <tower-id> <x> <y> --confirm (bridge 0.3.12: the point for the tower's current
//        targeting: a Mortar's reticle, a Dartling's Locked point, a Heli's Lock In Place position)
//   npm run btd6:bridge -- screenshot [file] [--width <px>]   (bridge 0.3.12: a PNG of the game's frame, by default
//        .private/btd6/shots/<time>.png; reads only)
//   npm run btd6:bridge -- result <command-id>
// Commands write a dispatch record to .private/btd6/spike/dispatch.jsonl (or BTD6_DISPATCH_LOG) before
// sending, and are never retried: after an error, look the command up with "result".
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {bridgeClient, DEFAULT_PORT} from './bridge-client.mjs';
import {dismissCommand} from './popups.mjs';
import {dispatchOnce, waitForState, advanceToMenu} from './lifecycle.mjs';
import {startSetup, startMatchCommand, goHomeCommand} from './match-flow.mjs';
import {modHelperProblem} from './pins.mjs';
import {runLog} from '../../core/runner.mjs';
import {profileSummary} from './profile.mjs';
import {observedSpeed, parseSpeed, speedCommand} from './speed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bridge = bridgeClient({port: Number(process.env.BTD6_BRIDGE_PORT ?? DEFAULT_PORT)});
const argv = process.argv.slice(2);
const confirmed = argv.includes('--confirm');
const replaceSaved = argv.includes('--replace-saved');
const asJson = argv.includes('--json');
const heroAt = argv.indexOf('--hero'), widthAt = argv.indexOf('--width');
const hero = heroAt >= 0 ? argv[heroAt + 1] : undefined;
const width = widthAt >= 0 ? Number(argv[widthAt + 1]) : 960;
// Options with a value: the option and its value are not positional arguments.
const valued = new Set([heroAt, widthAt].filter(i => i >= 0).flatMap(i => [i, i + 1]));
const [command, ...args] = argv.filter((a, i) => a !== '--confirm' && a !== '--replace-saved' && a !== '--json' && !valued.has(i));
const print = value => console.log(JSON.stringify(value, null, 1));
const summary = s => s.in_game ? {
 match: s.match.id, setup: `${s.match.map} ${s.match.difficulty} ${s.match.mode_name} (mode ID ${s.match.mode})`, game_type: s.match.game_type, coop: s.match.coop,
 account_flagged: s.match.account_flagged, flag_risk_mode: s.match.flag_risk_mode,
 round: s.round.number, round_index: s.round.index, round_active: s.round.active, before_first_wave: s.round.before_first_wave,
 cash: s.cash, lives: `${s.lives}/${s.starting_lives}`, max_lives: s.max_lives, unlock_all: s.unlock_all, towers: s.towers.map(t => `#${t.id} ${t.base_id} ${t.tiers.join('-')} at (${t.x.toFixed(1)}, ${t.y.toFixed(1)})`
  + (t.targeting ? `; targeting ${t.targeting}${t.target_point ? ` at (${t.target_point.x.toFixed(1)}, ${t.target_point.y.toFixed(1)})` : ''}${t.target_modes?.length ? ` of ${t.target_modes.join('/')}` : ''}` : '')
  + (t.next_upgrades?.length ? `; next: ${t.next_upgrades.map(u => `${u.path + 1}: ${u.id} $${u.cost}${u.unlocked === false ? ' (locked)' : ''}`).join(', ')}` : '')),
 sub_towers: s.sub_towers ?? null, ready: s.ready, paused: s.paused, fast_forward: s.fast_forward, multiplier: s.multiplier ?? null, speed: observedSpeed(s), auto_start: s.auto_start, towers_hash: s.towers_hash,
 popup: screen(s.popup), menu: s.menu ?? null,
} : {screen: s.screen, main_menu: s.main_menu ?? null, loading: s.loading ?? null, menu: s.menu ?? null, popup: screen(s.popup),
 bridge_version: s.bridge_version, game_version: s.game_version, unlock_all: s.unlock_all};
function screen(p) {
 if (!p) return null;
 return `${p.kind} ${p.class ?? '?'}${p.scope ? ` over the ${p.scope}` : ''} [${(p.buttons ?? []).map(b => b.name + (b.interactable ? '' : ' (off)')).join(', ')}]${p.options?.length ? ` options: ${p.options.join(', ')}` : ''}`;
}
// One command, once: the dispatch record goes to disk before it is sent (lifecycle.mjs).
const dispatchFile = process.env.BTD6_DISPATCH_LOG ? resolve(process.env.BTD6_DISPATCH_LOG) : resolve(root, '.private/btd6/spike/dispatch.jsonl');
async function dispatch(request) {
 await mkdir(dirname(dispatchFile), {recursive: true});
 const result = await dispatchOnce(bridge, runLog(dispatchFile), request);
 print(result);
 return result;
}
async function matchState() {
 const state = await bridge.state();
 if (!state.in_game) throw Error('Not in a match.');
 if (state.match.coop || state.match.game_type !== 'Standard' || state.match.flag_risk_mode) throw Error('The bridge acts only in standard single-player matches.');
 return state;
}
const waitFor = (done, what, seconds) => waitForState(bridge, done, what, {timeoutMs: seconds * 1000});
const point = (x, y) => { const p = {x: Number(x), y: Number(y)}; if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error('x and y must be numbers'); return p; };

try {
 if (command === 'health' || command === 'hello') {
  const health = await bridge.health();
  print(health);
  const pin = modHelperProblem(health);
  if (pin) console.error(`Warning: ${pin}`);
 }
 else if (command === 'state') print(summary(await bridge.state()));
 else if (command === 'map') print(await bridge.map());
 else if (command === 'catalog') print(await bridge.catalog());
 else if (command === 'profile' && args.length === 0) { const p = await bridge.profile(); print(asJson ? p : profileSummary(p)); }
 else if (command === 'check' && args.length === 3) print(await bridge.placementCheck(args[0], [point(args[1], args[2])]));
 else if (command === 'result' && args.length === 1) print(await bridge.commandResult(args[0]) ?? {status: 'unknown', note: 'The bridge has no record of this command ID.'});
 else if (command === 'start' && args.length === 3 && confirmed && (heroAt < 0 || hero)) {
  const setup = startSetup(args[0], args[1], args[2], hero);
  const [state, health] = await Promise.all([bridge.state(), bridge.health()]);
  const pin = modHelperProblem(health);
  if (pin) console.error(`Warning: ${pin}`);
  const result = await dispatch(startMatchCommand(state, setup, randomUUID(), {replaceSaved}));
  if (result.status === 'executed') print(summary(await waitFor(s => s.in_game && s.match.map === setup.map, 'match', 120)));
 } else if (command === 'advance' && args.length === 0 && confirmed) {
  print(summary(await advanceToMenu(bridge, dispatch)));
 } else if (command === 'home' && args.length === 0 && confirmed) {
  const result = await dispatch(goHomeCommand(await bridge.state(), randomUUID()));
  if (result.status === 'executed') print(summary(await waitFor(s => !s.in_game && !s.loading, 'main menu', 60)));
 } else if (command === 'place' && args.length === 3 && confirmed) {
  const state = await matchState();
  const {x, y} = point(args[1], args[2]);
  await dispatch({command_id: randomUUID(), action: 'place_tower', tower: args[0], x, y, expect: {match_id: state.match.id, towers_hash: state.towers_hash ?? null}});
 } else if (command === 'upgrade' && args.length === 2 && confirmed) {
  const state = await matchState();
  const [id, path] = [Number(args[0]), Number(args[1])];
  const tower = state.towers.find(t => t.id === id);
  if (!tower) throw Error(`No tower #${args[0]} in the match.`);
  if (![1, 2, 3].includes(path)) throw Error('The path is 1, 2 or 3 (top, middle, bottom).');
  const next = tower.next_upgrades.find(u => u.path === path - 1);
  if (!next) throw Error(`Path ${path} of #${id} ${tower.base_id} has no further upgrade.`);
  console.error(`Upgrading #${id} ${tower.base_id} on path ${path}: ${next.id}, $${next.cost}${next.unlocked === false ? ' (locked on this account)' : ''}.`);
  await dispatch({command_id: randomUUID(), action: 'upgrade_tower', tower_id: id, path: path - 1, expect: {match_id: state.match.id, towers_hash: state.towers_hash ?? null, tiers: tower.tiers}});
 } else if (command === 'start-round' && args.length === 0 && confirmed) {
  const state = await matchState();
  if (state.round.active) throw Error(`Round ${state.round.number} is running.`);
  const result = await dispatch({command_id: randomUUID(), action: 'start_round', expect: {match_id: state.match.id, towers_hash: state.towers_hash ?? null}});
  if (result.status === 'executed') { const s = await bridge.state(); print({round: s.round?.number ?? null, active: s.round?.active ?? null}); }
 } else if (command === 'speed' && args.length === 1 && confirmed) {
  const speed = parseSpeed(args[0]);
  const result = await dispatch(speedCommand(await matchState(), speed, randomUUID()));
  if (result.status === 'executed') { const s = await bridge.state(); print({speed: observedSpeed(s), fast_forward: s.fast_forward ?? null, multiplier: s.multiplier ?? null}); }
 } else if (command === 'auto-start' && args.length === 1 && ['on', 'off'].includes(args[0]) && confirmed) {
  const state = await matchState();
  const result = await dispatch({command_id: randomUUID(), action: 'set_auto_start', enabled: args[0] === 'on', expect: {match_id: state.match.id}});
  if (result.status === 'executed') print({auto_start: (await bridge.state()).auto_start ?? null});
 } else if (command === 'target' && args.length === 2 && confirmed) {
  const state = await matchState();
  const tower = state.towers.find(t => t.id === Number(args[0]));
  if (!tower) throw Error(`No tower #${args[0]} in the match.`);
  if (tower.target_modes?.length && !tower.target_modes.includes(args[1])) throw Error(`#${tower.id} ${tower.base_id} offers ${tower.target_modes.join(', ')}.`);
  await dispatch({command_id: randomUUID(), action: 'set_targeting', tower_id: tower.id, mode: args[1], expect: {match_id: state.match.id, towers_hash: state.towers_hash ?? null}});
 } else if (command === 'target-point' && args.length === 3 && confirmed) {
  const state = await matchState();
  const tower = state.towers.find(t => t.id === Number(args[0]));
  if (!tower) throw Error(`No tower #${args[0]} in the match.`);
  const {x, y} = point(args[1], args[2]);
  await dispatch({command_id: randomUUID(), action: 'set_target_point', tower_id: tower.id, x, y, expect: {match_id: state.match.id, towers_hash: state.towers_hash ?? null}});
 } else if (command === 'screenshot' && args.length <= 1) {
  const file = args[0] ? resolve(args[0]) : resolve(root, '.private/btd6/shots', `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  const png = await bridge.screenshot(width);
  await mkdir(dirname(file), {recursive: true});
  await writeFile(file, png);
  console.log(`Saved ${png.length} bytes to ${file}`);
 } else if (command === 'dismiss' && args.length === 2 && confirmed) {
  const state = await bridge.state();
  if (state.in_game && (state.match.coop || state.match.game_type !== 'Standard' || state.match.flag_risk_mode))
   throw Error('The bridge acts only in standard single-player matches.');
  await dispatch(dismissCommand(state, args[0], args[1], randomUUID()));
 } else {
  console.error('Usage: bridge-cli health | state | map | catalog | profile [--json] | check <tower> <x> <y> | start <map> <difficulty> <mode> [--hero <id>] [--replace-saved] --confirm'
   + ' | advance --confirm | home --confirm | place <tower> <x> <y> --confirm | upgrade <tower-id> <path 1-3> --confirm | dismiss <kind> <button> --confirm | start-round --confirm | speed <1-10> --confirm | auto-start on|off --confirm'
   + ' | target <tower-id> <mode> --confirm | target-point <tower-id> <x> <y> --confirm | screenshot [file] [--width <px>] | result <command-id>');
  process.exitCode = 2;
 }
} catch (error) { console.error(error.message); process.exitCode = 1; }
