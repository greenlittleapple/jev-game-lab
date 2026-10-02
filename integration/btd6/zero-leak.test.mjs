// Zero-leak mode (zero-leak.mjs, --zero-leak): with 100 lives the policy decides exactly as with one life; the run log,
// the strategist and the lives Jev's question shows stay real.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLog} from '../../core/runner.mjs';
import {setEarlyMargin} from './estimate.mjs';
import {setDdtCheck, setMoabCalibration, setMoabDdtLead, moabDdtLeadFor, MOAB_LEAD_ROUNDS} from './moab.mjs';
import {buildCandidates} from './candidates.mjs';
import {btd6Game, claudeGameV1, playbookGameV5} from './game.mjs';
import {loadPlaybook} from './playbook-v5.mjs';
import {defenceMargins} from './speed.mjs';
import {zeroLeakGame, zeroLeakView, zeroLeakFor, ZERO_LEAK_LIVES} from './zero-leak.mjs';
import {createSession, runConfig, runSession, teeLog} from './session.mjs';
import {computeSpotCatalog} from './spot-catalog.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {parseSetup} from './lifecycle.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths, meadowSpots as spots, meadowSpot} from './fixtures/index.mjs';

const ids = list => list.map(c => c.id);
// The session's settings for v6, v5 and claude-v1 (session.mjs runSession), with run 1j's pinned MOAB factor.
const settings = fn => {
 setEarlyMargin(true); setDdtCheck(true); setMoabDdtLead(moabDdtLeadFor('btd6-jev-v6')); setMoabCalibration(1.27);
 try { return fn(); } finally { setEarlyMargin(false); setDdtCheck(false); setMoabDdtLead(MOAB_LEAD_ROUNDS); setMoabCalibration(1); }
};
const withLives = (state, lives) => ({...state, lives, starting_lives: lives, max_lives: lives});
const v6 = () => btd6Game(() => ({paths}), {policy: 'btd6-jev-v6'});

// Hard Standard as the game starts it: round 3 (start_round 3, end_round 80), $650, no towers. round: 1 or 2 are the
// rounds before it, which Hard Standard on this map doesn't play; checked so a start there isn't blocked either.
const hardStandard = ({round = 3, towers = [], cash = 650, lives = 100} = {}) => {
 const base = v0Round6();
 return v0Round6({cash, lives, starting_lives: 100, max_lives: 100, towers, match: {...base.match, mode: 'Standard'},
  round: {index: round - 1, active: false, before_first_wave: true}});
};
const options = state => {
 const used = new Set(state.towers.map(t => `${t.x},${t.y}`));
 return buildCandidates(state, {catalog: v0Catalog, freeSpots: spots.filter(s => !used.has(`${s.x},${s.y}`)), paths});
};

// Logged CHIMPS decisions (fixtures): moab-bind-r40 (rounds 36 to 39, before the first MOAB round) and
// lead-capacity-r95 (rounds 92 to 94, a late state whose towers deal no DDT-capable damage before round 95's DDTs).
function logged(name) {
 const f = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
 const towers = new Map(f.towers.map(t => [t.id, t]));
 // Every eighth decision keeps the test quick (each runs the rules several times).
 return f.decisions.filter((d, i) => i % 8 === 0).map(d => ({round: d.round, fixture: name,
  state: {in_game: true, match: f.match, round: {index: d.round - 1, number: d.round, active: true, before_first_wave: false}, cash: d.cash, lives: 1, starting_lives: 1, max_lives: 1,
   towers: f.tower_sets[d.towers].split(' ').map(s => { const [id, tiers] = s.split(':'); return {...towers.get(Number(id)), tiers: tiers.split('-').map(Number)}; })},
  options: d.candidates.map(i => f.options[i])}));
}

test('the view: lives 1 in a match, the rest of the state and states outside a match unchanged', () => {
 const s = hardStandard();
 assert.equal(ZERO_LEAK_LIVES, 1);
 assert.deepEqual(zeroLeakView(s), {...s, lives: 1});
 assert.equal(s.lives, 100, 'the state itself is not changed');
 const menu = {in_game: false, screen: 'main_menu'};
 assert.equal(zeroLeakView(menu), menu);
 assert.deepEqual(['btd6-jev-v6', 'btd6-playbook-v5', 'btd6-claude-v1', 'btd6-jev-v4', 'btd6-jev-v3'].map(zeroLeakFor), [true, true, true, false, false]);
});

test('v6 with zero-leak and 100 lives returns what v6 returns with one life: Hard Standard rounds 1 to 3, a round-40 MOAB state, a late DDT-free state', () => settings(() => {
 const zl = zeroLeakGame(v6()), base = v6();
 const states = [1, 2, 3].map(round => ({round, state: withLives(hardStandard({round}), 1), options: options(hardStandard({round}))}))
  .concat(logged('moab-bind-r40'), logged('lead-capacity-r95'));
 assert.ok(states.some(x => x.round === 39) && states.some(x => x.round >= 92));
 const differs = new Set();
 for (const {state, options: opts} of states) {
  const one = base.rules(state, opts), hundred = zl.rules(withLives(state, 100), opts);
  assert.deepEqual(hundred, one, `round ${state.round.number} $${state.cash}`);
  assert.deepEqual(zl.group(withLives(state, 100), one.candidates), base.group(state, one.candidates));
  if (JSON.stringify(base.rules(withLives(state, 100), opts)) !== JSON.stringify(one)) differs.add(state.round.number <= 3 ? 'opening' : state.round.number < 80 ? 'r40' : 'r95');
 }
 // Without the flag 100 lives give other answers (the one-life rules don't run): the flag is what changes them.
 assert.deepEqual([...differs].sort(), ['opening', 'r40', 'r95']);
}));

test('the one-life rules run under zero-leak: early_short at round 3 and the round-40 MOAB binding', () => settings(() => {
 const zl = zeroLeakGame(v6()), base = v6();
 const open = hardStandard();
 const kinds = r => r.constraint?.rules?.map(q => q.kind) ?? [];
 assert.ok(kinds(zl.rules(open, options(open))).includes('early_short'));
 assert.ok(!kinds(base.rules(open, options(open))).includes('early_short'), 'not without the flag');
 const bound = logged('moab-bind-r40').filter(x => zl.rules(withLives(x.state, 100), x.options).constraint?.rules?.find(q => q.kind === 'moab_short')?.binding);
 assert.ok(bound.length > 0);
}));

test('the Hard Standard opening is not blocked: buying the kept options leads to the round start from rounds 1, 2 and 3 with $650', () => settings(() => {
 const zl = zeroLeakGame(v6());
 for (const round of [1, 2, 3]) {
  let state = hardStandard({round}), bought = 0, started = false;
  for (let i = 0; i < 20 && !started; i++) {
   const kept = zl.rules(state, options(state)).candidates;
   if (ids(kept).includes('start_round')) { started = true; break; }
   const c = kept.find(k => k.details?.kind === 'place');
   assert.ok(c, `round ${round}: a purchase or the start is kept (${ids(kept).join(' ')})`);
   const spot = meadowSpot(c.details.spot);
   state = {...state, cash: state.cash - c.details.cost, towers: [...state.towers, {id: i + 1, base_id: c.details.tower, tiers: [0, 0, 0], x: spot.x, y: spot.y, next_upgrades: []}]};
   bought++;
  }
  assert.ok(started, `round ${round}: the start is offered`);
  assert.ok(bought > 0 && state.cash < 200, `round ${round}: $${state.cash} left after ${bought} purchases`);
 }
}));

test('playbook-v5 and claude-v1 get the same view through the same adapter', async () => {
 const playbook = await loadPlaybook(new URL('./playbooks/monkey-meadow-hard-standard.json', import.meta.url));
 settings(() => {
 const games = [() => playbookGameV5(() => ({paths}), {playbook}), () => claudeGameV1(() => ({paths}))];
 for (const make of games) {
  const zl = zeroLeakGame(make()), base = make();
  for (const {state, options: opts} of [...logged('moab-bind-r40').slice(0, 5), {state: withLives(hardStandard(), 1), options: options(hardStandard())}]) {
   assert.deepEqual(zl.rules(withLives(state, 100), opts), base.rules(state, opts));
   if (base.plan) assert.deepEqual(zl.plan(withLives(state, 100), opts), base.plan(state, opts));
  }
 }
 });
});

test('the question uses the view for its estimates and shows the real lives; triggers, brief and stamp keep the real state', () => settings(() => {
 const base = v6(), zl = zeroLeakGame(base);
 const state = hardStandard(), opts = options(state);
 const q = zl.question(state, opts, null, null, {stage: 'flat'}), one = base.question(withLives(state, 1), opts, null, null, {stage: 'flat'});
 assert.equal(q.state.match.lives, 100);
 assert.deepEqual({...q, state: {...q.state, match: {...q.state.match, lives: 1}}}, one);
 assert.equal(q.state.defence.margin, 3.0, 'the early one-life margin');
 for (const hook of ['trigger', 'brief', 'stamp', 'isLate', 'isForced']) assert.equal(zl[hook], base[hook], hook);
 // Graded speed's margins (session.mjs) read the view too.
 assert.deepEqual(defenceMargins(zeroLeakView(state), paths), defenceMargins(withLives(state, 1), paths));
}));

test('--zero-leak: v6, playbook-v5 and claude-v1 only; off by default', () => {
 const env = {};
 assert.equal(runConfig(['--policy', 'jev-v6', '--dry-run'], env).zeroLeak, false);
 for (const p of ['jev-v6', 'playbook-v5', 'claude-v1']) assert.equal(runConfig(['--policy', p, '--dry-run', '--zero-leak'], env).zeroLeak, true, p);
 assert.throws(() => runConfig(['--policy', 'jev-v4', '--dry-run', '--zero-leak'], env), /--zero-leak is for --policy jev-v6, playbook-v5, claude-v1/);
});

async function dryRun(t, zeroLeak) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-btd6-zero-leak-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const fake = fakeGame({ticksPerRound: 2});
 const usage = {requests: 0, inputTokens: 0}, limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9};
 const s = createSession({policy: 'btd6-jev-v6', setup: parseSetup('MonkeyMeadow/Hard/Standard'), limits, usage});
 const file = runLog(join(dir, 'run.jsonl')), series = runLog(join(dir, 'series.jsonl'));
 const outcome = await runSession({bridge: fake.bridge, ask: fakeJev({usage, limits}), log: teeLog(file, s), series, session: s, setup: s.setup, policy: 'btd6-jev-v6',
  limits, usage, loadSpots: async () => (await computeSpotCatalog(fake.bridge)).spots, sleep: async () => {}, dryRun: true, speed: 'graded:10', zeroLeak, provenance: null,
  timings: {pollMs: 0, pausedPollMs: 0, minIntervalMs: 0, lifecyclePollMs: 0, homeAfterResultMs: 50}});
 const read = async f => (await readFile(f, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
 return {outcome, events: await read(file.file), series: await read(series.file)};
}

test('a zero-leak dry run records zero_leak: true in session_start, run_start and the series entry; a normal run records nothing', {timeout: 120000}, async t => {
 const zl = await dryRun(t, true);
 assert.equal(zl.outcome.reason, 'ended');
 assert.equal(zl.events.find(e => e.kind === 'session_start').zero_leak, true);
 assert.equal(zl.events.find(e => e.kind === 'run_start').zero_leak, true);
 assert.equal(zl.series[0].zero_leak, true);
 // The run log keeps the real lives.
 assert.equal(zl.events.find(e => e.kind === 'decision').state.lives, 100);
 const normal = await dryRun(t, false);
 assert.ok(!('zero_leak' in normal.events.find(e => e.kind === 'run_start')));
 assert.ok(!('zero_leak' in normal.events.find(e => e.kind === 'session_start')));
 assert.ok(!('zero_leak' in normal.series[0]));
 assert.equal(normal.events.find(e => e.kind === 'run_start').policy_revision, zl.events.find(e => e.kind === 'run_start').policy_revision, 'no revision change');
});
