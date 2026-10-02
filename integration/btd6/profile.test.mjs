import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {profileDiff, profileGuard, profileSnapshot, profileStatus, profileSummary, screensFromEvents} from './profile.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/profile.json', import.meta.url), 'utf8'));
const memoryLog = () => { const entries = []; return {entries, append: async e => { entries.push(e); return e; }}; };

test('XP, rank and knowledge points may change; a new tower, hero or upgrade is a profile write', () => {
 const start = profileSnapshot(fixture());
 const played = profileSnapshot({...fixture(), rank: 4, xp: 2100, knowledge_points: 1, tower_xp: {DartMonkey: 400, BoomerangMonkey: 40, NinjaMonkey: 20}});
 const normal = profileDiff(start, played);
 assert.equal(normal.profile_write, false);
 assert.deepEqual(normal.writes, {towers: [], heroes: [], upgrades: []});
 assert.deepEqual([normal.changes.rank, normal.changes.xp, normal.changes.knowledge_points], [1, 850, 1]);
 assert.deepEqual(normal.changes.tower_xp, [{tower: 'DartMonkey', gained: 89.5}, {tower: 'NinjaMonkey', gained: 20}]);

 const p = fixture();
 const written = profileDiff(start, profileSnapshot({...p, unlocked_towers: [...p.unlocked_towers, 'SuperMonkey'], unlocked_heroes: ['Quincy', 'Gwendolin'],
  acquired_upgrades: ['Sharp Shots', 'Long Range Darts', 'Razor Sharp Shots', 'Razor Sharp Shots'], acquired_knowledge: ['BigBloonSabotage']}));
 assert.equal(written.profile_write, true);
 assert.deepEqual(written.writes, {towers: ['SuperMonkey'], heroes: ['Gwendolin'], upgrades: ['Razor Sharp Shots']});
 assert.deepEqual(written.changes.new_knowledge, ['BigBloonSabotage'], 'knowledge is recorded but not flagged');

 const removed = profileDiff(start, profileSnapshot({...p, unlocked_towers: ['DartMonkey']}));
 assert.equal(removed.profile_write, false, 'only additions count as unlock writes');
});

test('the guard logs start and end snapshots, a warning on a write, and the series line; a missing /profile leaves the run unchecked', async () => {
 let current = fixture();
 const log = memoryLog(), series = memoryLog();
 const guard = profileGuard({read: async () => structuredClone(current), log, series});
 assert.deepEqual((await guard.start('m1')).unlocked_towers, ['BoomerangMonkey', 'DartMonkey', 'TackShooter']);
 current = {...current, unlocked_heroes: ['Quincy', 'Obyn']};
 const check = await guard.end('m1');
 assert.deepEqual(check.writes.heroes, ['Obyn']);
 assert.equal(await guard.end('m1'), null, 'checked once');
 assert.deepEqual(log.entries.map(e => e.kind), ['profile_snapshot', 'profile_snapshot', 'profile_check', 'warning']);
 assert.match(log.entries[3].message, /heroes: Obyn/);
 assert.deepEqual([series.entries[0].run, series.entries[0].kind, series.entries[0].profile_write], ['m1', 'profile_check', true]);
 assert.equal(profileStatus(log.entries), 'WRITE (heroes: Obyn)');

 const old = memoryLog();
 const unchecked = profileGuard({read: async () => { throw Error('Bridge /api/v1/profile: HTTP 404 (Not found)'); }, log: old});
 assert.equal(await unchecked.start('m2'), null);
 assert.equal((await unchecked.end('m2')).status, 'unchecked');
 assert.equal(profileStatus(old.entries), 'unchecked');
 assert.equal(profileStatus([]), 'unchecked');
 assert.equal(profileStatus([{kind: 'profile_check', status: 'checked', profile_write: false, writes: {}}]), 'unchanged');
});

// A won Hard Standard run (2026-09-30): the account went from rank 18 to 26 through normal XP, and the
// runner dismissed the rank-ups and Striker Jones's free unlock splash (rank 21) as forced steps.
const rankupRun = () => JSON.parse(readFileSync(new URL('./fixtures/profile-rankup-run.json', import.meta.url), 'utf8'));

test('replay: a hero unlocked at a rank-up the run passed through is earned, not a write', () => {
 const run = rankupRun();
 const screens = screensFromEvents(run.events);
 assert.ok(screens.some(s => s.kind === 'level_up') && screens.some(s => s.kind === 'hero_unlock_notice'));
 const check = profileDiff(profileSnapshot(run.start), profileSnapshot(run.end), screens);
 assert.equal(check.profile_write, false);
 assert.deepEqual(check.writes, {towers: [], heroes: [], upgrades: []});
 assert.deepEqual(check.earned, {towers: [], heroes: ['StrikerJones']});
 assert.deepEqual(check.earned_by, {StrikerJones: 'rank-up'});
 assert.deepEqual([check.changes.rank_from, check.changes.rank_to], [18, 26]);

 // The scorecard re-reads a check logged before earned unlocks were known from the run's snapshots and screens.
 const old = {kind: 'profile_check', status: 'checked', profile_write: true, writes: {towers: [], heroes: ['StrikerJones'], upgrades: []}};
 const events = [{kind: 'profile_snapshot', at: 'start', profile: run.start}, ...run.events, {kind: 'profile_snapshot', at: 'end', profile: run.end}, old];
 assert.equal(profileStatus(events), 'earned (by rank-up: StrikerJones)');
 assert.equal(profileStatus([{kind: 'profile_check', status: 'checked', ...check}]), 'earned (by rank-up: StrikerJones)');
});

test('an unlock with no matching screen or rank, and any new upgrade, stay writes', () => {
 const run = rankupRun();
 const start = profileSnapshot(run.start), screens = screensFromEvents(run.events);
 // No rank-up screen logged: the same rank change doesn't explain the hero.
 const noScreen = profileDiff(start, profileSnapshot(run.end), screens.filter(s => s.kind !== 'level_up' && s.kind !== 'hero_unlock_notice'));
 assert.deepEqual([noScreen.profile_write, noScreen.writes.heroes], [true, ['StrikerJones']]);
 // A rank-up that doesn't reach the hero's unlock rank, or a hero with no unlock rank.
 const short = profileDiff(start, profileSnapshot({...run.end, rank: 20}), screens);
 assert.deepEqual(short.writes.heroes, ['StrikerJones']);
 const other = profileDiff(start, profileSnapshot({...run.end, unlocked_heroes: [...run.end.unlocked_heroes, 'Adora']}), screens);
 assert.deepEqual([other.writes.heroes, other.earned.heroes], [['Adora'], ['StrikerJones']]);
 assert.equal(profileStatus([{kind: 'profile_check', status: 'checked', ...other}]), 'WRITE (heroes: Adora); earned (by rank-up: StrikerJones)');
 // Towers need their splash or pick; upgrades are never explained.
 const extra = profileDiff(start, profileSnapshot({...run.end, unlocked_towers: [...run.end.unlocked_towers, 'SuperMonkey'],
  acquired_upgrades: [...run.end.acquired_upgrades, 'Razor Sharp Shots']}), screens);
 assert.deepEqual(extra.writes, {towers: ['SuperMonkey'], heroes: [], upgrades: ['Razor Sharp Shots']});
 const picked = profileDiff(start, profileSnapshot({...run.end, unlocked_towers: [...run.end.unlocked_towers, 'SuperMonkey', 'Mermonkey']}),
  [...screens, {kind: 'tower_unlock_choice', id: 'SuperMonkey'}, {kind: 'tower_unlock_notice', id: 'Mermonkey'}]);
 assert.deepEqual([picked.writes.towers, picked.earned.towers], [[], ['Mermonkey', 'SuperMonkey']]);
 assert.deepEqual(picked.earned_by, {StrikerJones: 'rank-up', SuperMonkey: 'tower pick', Mermonkey: 'unlock screen'});
});

test('the guard records rank-up and unlock screens once per opening and uses them at the end', async () => {
 const run = rankupRun();
 let current = run.start;
 const log = memoryLog();
 const guard = profileGuard({read: async () => structuredClone(current), log});
 await guard.start('m1');
 const splash = {kind: 'hero_unlock_notice', class: 'HeroPurchaseSplash', menu_name: 'StrikerJonesUnlockUI'};
 for (const popup of [null, splash, splash, null, {kind: 'victory', class: 'VictoryScreen'}]) await guard.screen('m1', popup);
 assert.deepEqual(log.entries.filter(e => e.kind === 'profile_screen').map(e => [e.popup, e.unlocked]), [['hero_unlock_notice', 'StrikerJones']]);
 current = run.end;
 const check = await guard.end('m1');
 assert.deepEqual([check.profile_write, check.earned_by], [false, {StrikerJones: 'unlock screen'}]);
 assert.deepEqual(log.entries.map(e => e.kind), ['profile_snapshot', 'profile_screen', 'profile_snapshot', 'profile_check', 'note']);
 assert.equal(profileStatus(log.entries), 'earned (by unlock screen: StrikerJones)');
});

test('profileSummary gives counts and the unlocked and acquired lists', () => {
 const s = profileSummary(fixture());
 assert.deepEqual(s.counts, {unlocked_towers: 3, unlocked_heroes: 1, acquired_upgrades: 2, acquired_knowledge: 0, towers_with_xp: 2});
 assert.equal(s.unlock_all, true);
 assert.deepEqual(s.unlocked_heroes, ['Quincy']);
 assert.equal(s.tower_xp, undefined, 'tower XP stays in --json');
});

test('bridge-cli profile prints the summary from the bridge', async t => {
 const server = createServer((req, res) => {
  const found = req.url === '/api/v1/profile';
  res.writeHead(found ? 200 : 404, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(found ? fixture() : {error: 'Not found'}));
 });
 await new Promise(done => server.listen(0, '127.0.0.1', done));
 t.after(() => server.close());
 const cli = fileURLToPath(new URL('./bridge-cli.mjs', import.meta.url));
 const run = args => promisify(execFile)(process.execPath, [cli, ...args], {env: {...process.env, BTD6_BRIDGE_PORT: String(server.address().port)}});
 const summary = JSON.parse((await run(['profile'])).stdout);
 assert.deepEqual(summary, {...profileSummary(fixture())});
 assert.equal(summary.counts.acquired_upgrades, 2);
 assert.deepEqual(summary.unlocked_towers, ['BoomerangMonkey', 'DartMonkey', 'TackShooter']);
 const full = JSON.parse((await run(['profile', '--json'])).stdout);
 assert.deepEqual(full.tower_xp, {BoomerangMonkey: 40, DartMonkey: 310.5});
});
