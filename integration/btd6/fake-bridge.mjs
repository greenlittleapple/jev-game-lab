// A simulated game behind the bridge's HTTP API, for --dry-run and the tests: no game and no TypeSafe
// call. It follows the live behaviour recorded in docs/BTD6-VERIFICATION.md where it matters to the
// runner: the startup screens (Continue on the Modded Client notice is refused as button_unavailable
// the first time), start_match with --replace-saved, the CHIMPS rules dialog, placements and upgrades
// answered "queued" and settled before the next request, the displayed round = index + 1, state reads that
// fail while loading, victory and defeat screens, and go_home. Combat is a stand-in: a round is lost
// when the towers' total worth is below required(round).
// The saved profile (/api/v1/profile) is fixtures/profile.json and changes only when a test edits game.profile.
// set_speed sets fast_forward and multiplier (3 when none is given) and is recorded in game.speeds
// ({round, speed}, the displayed round and the speed it set); resetSpeedOnRound turns fast-forward off at each
// round start, to test the runner's re-apply. set_auto_start (0.3.11) sets auto_start and is recorded in
// game.autoStarts ({round, enabled}); it is accepted after the result, as the bridge accepts it.
// bloonProgress(tick, ticksPerRound, round): the furthest bloon's progress while a round runs.
// Targeting (0.3.12): each tower reports its targeting, target_modes (fakeModes) and target_point; set_targeting
// and set_target_point change them and are recorded in game.aims. GET /api/v1/screenshot answers a tiny PNG
// (TINY_PNG), at most one per second of game.clock() (429 otherwise), counted in game.shots.
import {bridgeClient} from './bridge-client.mjs';
import {roundRange} from './rounds.mjs';
import {MOD_HELPER_PIN} from './pins.mjs';
import catalogFixture from './fixtures/catalog.json' with {type: 'json'};
import trackFixture from './fixtures/track.json' with {type: 'json'};
import profileFixture from './fixtures/profile.json' with {type: 'json'};

const json = (status, data) => ({ok: status >= 200 && status < 300, status, json: async () => data});
// A 1x1 PNG.
export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = bytes => ({ok: true, status: 200, json: async () => { throw Error('not JSON'); }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)});
// The target types the game data lists for a tower (aim.mjs), first the default.
export function fakeModes(t) {
 if (t.base_id === 'DartlingGunner') return ['Normal', 'Locked'];
 if (t.base_id === 'MortarMonkey') return ['TargetSelectedPoint'];
 if (t.base_id === 'HeliPilot') return ['FollowTouch', 'LockInPlace', 'PatrolPoints', ...(t.tiers[0] >= 2 ? ['Pursuit'] : [])];
 if (t.base_id === 'MonkeyAce') return ['Circle', 'FigureInfinite', 'FigureEight'];
 return ['First', 'Last', 'Close', 'Strong'];
}

// required(round): the tower worth needed to clear a displayed round. endRound: the last round
// (default the mode's). ticksPerRound: state reads per round.
export function fakeGame({catalog = catalogFixture.towers.map(t => ({...t, unlocked: true})), paths = trackFixture.paths, required = r => 40 * (r - 5) ** 2,
 endRound = null, ticksPerRound = 3, savedGame = true, loadingReads = 2, resetSpeedOnRound = false, bloonProgress = (tick, ticks) => (tick + 1) / (ticks + 1),
 clock = () => Date.now()} = {}) {
 const g = {screen: 'startup', popup: popup('title_screen', 'TitleScreen', 'startup', ['start']), match: null, loading: 0, after: null,
  saved: savedGame, profile: structuredClone(profileFixture), pressedNotice: false, ledger: new Map(), queue: [], nextTower: 100, matches: 0, ticks: 0, requests: [], speeds: [], autoStarts: [], aims: [], shots: 0, lastShot: null, clock};

 function popup(kind, cls, scope, buttons) { return {kind, class: cls, scope, buttons: buttons.map(name => ({name, label: name, interactable: true}))}; }
 const hash = () => g.match ? (g.match.towers.length ? g.match.towers.map(t => `${t.id}:${t.tiers.join('')}`).join('|') : 'empty') : null;
 const worth = () => g.match.towers.reduce((n, t) => n + t.worth, 0);
 const nextUpgrades = t => [0, 1, 2].filter(p => t.tiers[p] < 5).map(p => ({path: p, id: `${t.base_id}-${p + 1}${t.tiers[p] + 1}`, cost: 150 * (t.tiers[p] + 1), unlocked: true}));

 function tick() {
  const m = g.match;
  if (!m || m.result || !m.round.active) return;
  m.cash += 10 * m.towers.length;
  // Pops (bridge 0.3.13): each tower gains a count that grows with its tiers while a round runs.
  for (const t of m.towers) t.pops = (t.pops ?? 0) + 5 * (1 + t.tiers.reduce((n, x) => n + x, 0));
  if (++g.ticks < ticksPerRound) return;
  g.ticks = 0;
  const shown = m.round.index + 1;
  if (worth() < required(shown)) {
   m.lives = 0; m.result = 'defeat'; m.round.active = false;
   g.popup = popup('defeat', 'DefeatScreen', 'match', ['home', 'restart']);
   return;
  }
  m.cash += 100 + shown;
  if (shown >= (endRound ?? m.end)) { m.result = 'victory'; m.round.active = false; g.popup = popup('victory', 'VictoryScreen', 'match', ['home']); return; }
  m.round.index++;
  m.round.active = m.auto_start;
  if (resetSpeedOnRound) m.fast_forward = false;
 }

 function state() {
  if (g.loading > 0) {
   if (--g.loading === 0) g.after();
   return json(503, {error: 'loading'});
  }
  tick();
  const base = {api: 1, bridge_version: '0.3.14', game_version: '56.3', unlock_all: true, popup: g.popup};
  if (!g.match) return json(200, {...base, screen: 'menu', main_menu: g.screen === 'menu', loading: false, menu: g.screen === 'menu' ? 'MainMenuUi' : null, ready: false});
  const m = g.match;
  return json(200, {...base, screen: 'in_game', ready: !g.popup && !m.result, paused: false, fast_forward: m.fast_forward, multiplier: m.multiplier, auto_start: m.auto_start, pending_actions: g.queue.length,
   match: {id: m.id, map: m.map, mode: m.mode, difficulty: m.difficulty, game_type: 'Standard', coop: false, sandbox: false, result: m.result},
   round: {index: m.round.index, active: m.round.active, before_first_wave: m.round.before_first_wave, lives_lost: 0},
   // A stand-in for the bloon summary: while a round runs, ten Red bloons, the furthest moving along with the round's reads.
   bloons: m.round.active ? {count: 10, by_type: {Red: 10}, other_types: 0, camo: 0, regrow: 0, fortified: 0, moab_class: 0,
    furthest: +bloonProgress(g.ticks, ticksPerRound, m.round.index + 1).toFixed(3), progress_p50: 0.2, progress_p75: 0.3, progress_p90: 0.4, moabs: [],
    nearest_exit: [{type: 'Red', camo: false, regrow: false, fortified: false, progress: +bloonProgress(g.ticks, ticksPerRound, m.round.index + 1).toFixed(3)}]}
    : {count: 0, by_type: {}, other_types: 0, camo: 0, regrow: 0, fortified: 0, moab_class: 0, furthest: null, progress_p50: null, progress_p75: null, progress_p90: null, moabs: [], nearest_exit: []},
   cash: m.cash, lives: m.lives, starting_lives: m.starting_lives, max_lives: m.starting_lives,
   towers: m.towers.map(t => ({id: t.id, base_id: t.base_id, tiers: [...t.tiers], x: t.x, y: t.y, is_hero: t.is_hero, pops: t.pops ?? 0, cash_earned: t.cash_earned ?? 0, targeting: t.targeting ?? fakeModes(t)[0], target_modes: fakeModes(t),
    target_point: t.target_point ?? null, next_upgrades: nextUpgrades(t)})),
   towers_hash: hash(), sub_towers: 0});
 }

 const nearTrack = p => paths.some(path => path.some((q, i) => i > 0 && segmentDistance(p, path[i - 1], q) < 10));
 const validAt = (tower, p) => Math.abs(p.x) <= 140 && Math.abs(p.y) <= 110 && !nearTrack(p) && !(g.match?.towers ?? []).some(t => Math.hypot(t.x - p.x, t.y - p.y) < 8)
  && !(tower === 'BombShooter' && p.y < -60);

 function load(after) { g.loading = loadingReads; g.after = after; }

 function command(c) {
  const done = (status, extra = {}) => { const r = {command_id: c.command_id, status, ...extra}; g.ledger.set(c.command_id, r); return json(200, r); };
  if (g.ledger.has(c.command_id)) return json(200, g.ledger.get(c.command_id));
  const m = g.match;
  if (c.action === 'dismiss_popup') {
   if (!g.popup || g.popup.kind !== c.popup || g.popup.class !== c.expect?.popup_class) return done('rejected', {reason: 'popup_mismatch'});
   const kind = g.popup.kind;
   if (kind === 'title_screen') g.popup = popup('modded_client_notice', 'ModdingPopup', 'startup', ['continue', 'close_game', 'log_out']);
   else if (kind === 'modded_client_notice') {
    if (!g.pressedNotice) { g.pressedNotice = true; return done('rejected', {reason: 'button_unavailable'}); }
    g.popup = null; g.screen = 'menu';
   } else if (kind === 'mode_rules_notice' || kind === 'tutorial_notice') g.popup = null;
   else if (kind === 'victory' || kind === 'defeat') { g.popup = null; load(() => { g.match = null; g.screen = 'menu'; }); }
   else g.popup = null;
   return done('executed');
  }
  if (c.action === 'start_match') {
   if (g.match || g.screen !== 'menu' || g.popup) return done('rejected', {reason: 'not_on_main_menu'});
   if (g.saved && !c.replace_saved) return done('rejected', {reason: 'saved_game_exists'});
   const range = roundRange(c.difficulty, c.mode);
   load(() => {
    g.matches++;
    g.match = {id: `dry-${g.matches}`, map: c.map, mode: c.mode, difficulty: c.difficulty, end: range.end, result: null, auto_start: true, fast_forward: false, multiplier: 3,
     round: {index: range.start - 1, active: false, before_first_wave: true}, cash: 650, lives: range.lives, starting_lives: range.lives, towers: []};
    if (c.mode === 'Clicks') g.popup = popup('mode_rules_notice', 'Popup', 'match', ['ok']);
   });
   return done('executed', {detail: `loading ${c.map} ${c.difficulty} ${c.mode} with ${c.hero}`});
  }
  if (!m) return done('rejected', {reason: 'not_in_match'});
  if (c.action === 'go_home') {
   if (c.expect?.match_id !== m.id) return done('rejected', {reason: 'stale'});
   g.popup = null; load(() => { g.match = null; g.screen = 'menu'; });
   return done('executed', {detail: 'quit to the main menu'});
  }
  if (c.action === 'set_speed') {
   if (c.expect?.match_id !== m.id) return done('rejected', {reason: 'stale_match'});
   if (typeof c.fast_forward !== 'boolean' || (c.multiplier != null && !(c.multiplier >= 1 && c.multiplier <= 10))) return done('rejected', {reason: 'bad_request'});
   Object.assign(m, {fast_forward: c.fast_forward, multiplier: c.multiplier ?? 3});
   g.speeds.push({round: m.round.index + 1, speed: c.fast_forward ? c.multiplier ?? 3 : 1});
   return done('executed');
  }
  if (c.action === 'set_auto_start') {
   if (c.expect?.match_id !== m.id) return done('rejected', {reason: 'stale_match'});
   if (typeof c.enabled !== 'boolean') return done('rejected', {reason: 'bad_request'});
   m.auto_start = c.enabled;
   g.autoStarts.push({round: m.round.index + 1, enabled: c.enabled});
   return done('executed');
  }
  if (c.expect?.match_id !== m.id || c.expect?.towers_hash !== hash()) return done('rejected', {reason: 'stale'});
  if (g.popup || m.result) return done('rejected', {reason: 'game_paused'});
  if (c.action === 'start_round') {
   if (m.round.active) return done('rejected', {reason: 'round_active'});
   Object.assign(m.round, {active: true, before_first_wave: false});
   return done('executed');
  }
  if (c.action === 'place_tower') {
   const tower = catalog.find(t => t.id === c.tower);
   if (!tower) return done('rejected', {reason: 'unknown_tower'});
   if (m.cash < tower.cost) return done('rejected', {reason: 'insufficient_cash'});
   if (!validAt(c.tower, c)) return done('rejected', {reason: 'invalid_position'});
   g.queue.push(() => {
    const id = g.nextTower++;
    m.cash -= tower.cost;
    m.towers.push({id, base_id: tower.id, tiers: [0, 0, 0], x: c.x, y: c.y, is_hero: Boolean(tower.is_hero), worth: tower.cost, pops: 0, cash_earned: 0});
    g.ledger.set(c.command_id, {command_id: c.command_id, status: 'executed', tower_id: id});
   });
   return done('queued', {detail: 'the game queued the placement'});
  }
  if (c.action === 'set_targeting' || c.action === 'set_target_point') {
   const t = m.towers.find(x => x.id === c.tower_id);
   if (!t) return done('rejected', {reason: 'unknown_tower'});
   if (c.action === 'set_targeting') {
    if (!fakeModes(t).includes(c.mode)) return done('rejected', {reason: 'mode_not_offered'});
    if ((t.targeting ?? fakeModes(t)[0]) !== c.mode) t.target_point = null;
    t.targeting = c.mode;
   } else {
    const mode = t.targeting ?? fakeModes(t)[0];
    if (!['Locked', 'TargetSelectedPoint', 'LockInPlace', 'PatrolPoints'].includes(mode)) return done('rejected', {reason: 'mode_takes_no_point'});
    t.target_point = {x: c.x, y: c.y};
   }
   g.aims.push({round: m.round.index + 1, tower_id: t.id, action: c.action, mode: c.mode ?? null, ...(c.action === 'set_target_point' ? {x: c.x, y: c.y} : {})});
   return done('executed', {tower_id: t.id, detail: `targeting ${t.targeting}`});
  }
  if (c.action === 'upgrade_tower') {
   const t = m.towers.find(x => x.id === c.tower_id), up = t && nextUpgrades(t).find(u => u.path === c.path);
   if (!up) return done('rejected', {reason: 'no_upgrade'});
   if (c.expect?.tiers && c.expect.tiers.join('-') !== t.tiers.join('-')) return done('rejected', {reason: 'stale_tiers'});
   g.upgradeTiers = [...(g.upgradeTiers ?? []), c.expect?.tiers ?? null];
   if (m.cash < up.cost) return done('rejected', {reason: 'insufficient_cash'});
   g.queue.push(() => {
    m.cash -= up.cost; t.tiers[c.path]++; t.worth += up.cost;
    g.ledger.set(c.command_id, {command_id: c.command_id, status: 'executed'});
   });
   return done('queued');
  }
  return done('rejected', {reason: 'unsupported'});
 }

 async function fetch(url, {method = 'GET', body} = {}) {
  // Commands the game queued settle on the next frame, before the next request is answered.
  for (const settle of g.queue.splice(0)) settle();
  const path = new URL(url).pathname, data = body ? JSON.parse(body) : null;
  g.requests.push({path, points: data?.points?.length ?? null});
  if (path === '/api/v1/health') return json(200, {name: 'Jev BTD6 Bridge', version: '0.3.14', api: 1, main_thread_pumping: true, ms_since_frame: 16,
   unlock_all: true, mod_helper: {name: 'BloonsTD6 Mod Helper', ...MOD_HELPER_PIN, file: 'Btd6ModHelper.dll'}});
  if (path === '/api/v1/state') return state();
  if (path === '/api/v1/profile') return json(200, structuredClone(g.profile));
  if (path === '/api/v1/screenshot') {
   const t = g.clock();
   if (g.lastShot != null && t - g.lastShot < 1000) return json(429, {error: `One screenshot per second; try again in ${1000 - (t - g.lastShot)} ms`});
   g.lastShot = t; g.shots++;
   return png(TINY_PNG);
  }
  if (path === '/api/v1/command' && method === 'POST') return command(data);
  if (path.startsWith('/api/v1/commands/')) {
   const record = g.ledger.get(decodeURIComponent(path.slice('/api/v1/commands/'.length)));
   return record ? json(200, record) : json(404, {error: 'unknown command'});
  }
  if (!g.match || g.loading) return json(409, {error: 'Not in a match'});
  if (path === '/api/v1/map') return json(200, {map: g.match.map, paths: paths.map((p, i) => ({id: String(i), active: true, points: p.map(q => [q.x, q.y])}))});
  if (path === '/api/v1/catalog') return json(200, {towers: catalog.map(t => ({...t}))});
  if (path === '/api/v1/placement-check' && method === 'POST') {
   if (!Array.isArray(data.points) || data.points.length > 400) return json(400, {error: 'points must be an array of at most 400 [x, y] pairs'});
   return json(200, {tower: data.tower, results: data.points.map(([x, y]) => ({x, y, valid: validAt(data.tower, {x, y})}))});
  }
  return json(404, {error: 'not found'});
 }

 return {game: g, fetch, bridge: bridgeClient({fetch})};
}

function segmentDistance(p, a, b) {
 const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
 const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
 return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Stands in for Jev: upgrades once three towers stand, otherwise places the first tower offered,
// otherwise starts the round or waits. Counts requests and input tokens like core/jev.mjs. margin: the gap
// between the choice's probability and the next option's (the last option offered); 0.3 by default, small
// values make near ties.
export function fakeJev({usage = {requests: 0, inputTokens: 0}, limits = {}, margin = 0.3} = {}) {
 return async payload => {
  if (usage.requests >= (limits.maxRequests ?? Infinity) || usage.inputTokens >= (limits.maxInputTokens ?? Infinity)) throw Error('Session limit reached.');
  const ids = Object.keys(payload.questions.move.criteria);
  const towers = payload.state.towers?.length ?? 0;
  const choice = (towers >= 3 && ids.find(id => id.startsWith('upgrade:'))) || ids.find(id => id.startsWith('place:')) || ids.find(id => id === 'start_round') || ids[0];
  const input_tokens = Math.ceil(JSON.stringify(payload).length / 4);
  usage.requests++;
  usage.inputTokens += input_tokens;
  const other = [...ids].reverse().find(id => id !== choice);
  const probabilities = other ? {[choice]: +(0.5 + margin / 2).toFixed(3), [other]: +(0.5 - margin / 2).toFixed(3)} : {[choice]: 1};
  return {model: 'dry-run', answers: {move: {type: 'choice', choice, confidence: 1, probabilities}}, usage: {input_tokens, output_tokens: 0}};
 };
}
