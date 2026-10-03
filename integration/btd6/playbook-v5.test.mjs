// Policy btd6-playbook-v5: the playbook schema and checks, conditions, entry selection, the near-tie break,
// the scorecard's near-tie column, the spot catalog's count and spread, and a dry run on the simulated game
// that runs out of catalog spots.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runLog} from '../../core/runner.mjs';
import {readSeries, scoreRuns, table} from '../../core/scorecard.mjs';
import {PLAYBOOK_POLICY_V5, REQUIRED_THREATS, CONDITIONS, validatePlaybook, loadPlaybook, findPlaybook, phaseAt, resolvePlaybook,
 playbookRanks, tieBreakV5, playbookTowers} from './playbook-v5.mjs';
import {activeHold, planTargets, onPlanPurchases} from './plan-v1.mjs';
import {popsCalibration} from './estimate.mjs';
import {constrainV1, IDLE_MARGIN} from './rules-v1.mjs';
import {buildCandidates} from './candidates.mjs';
import {groupOptionsV4} from './policy-v4.mjs';
import {createSession, runConfig, runSession, teeLog} from './session.mjs';
import {computeSpotCatalog, selectSpots} from './spot-catalog.mjs';
import {nearTrackPoints, trackDistance, gridPoints, pathBounds} from './spots.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {parseSetup} from './lifecycle.mjs';
import {runOf, scoreRun, SCORE_COLUMNS, nearTies} from './progress.mjs';
import {v0Round6, v0Catalog, meadowPaths as paths, meadowSpots, meadowSpot} from './fixtures/index.mjs';

const dir = fileURLToPath(new URL('./playbooks/', import.meta.url));
const FILE = join(dir, 'monkey-meadow-hard-standard.json');
const playbook = await loadPlaybook(FILE);
const clone = () => structuredClone(playbook);

const tower = (id, base_id, spot, tiers, next_upgrades = []) => ({id, base_id, tiers, x: meadowSpot(spot).x, y: meadowSpot(spot).y, next_upgrades});
const up = (path, cost) => ({path, cost, id: `u${path}`});
function at(round, {cash = 1500, towers = [], lives = 100, active = false} = {}) {
 const s = v0Round6({cash, lives, starting_lives: 100, max_lives: 100, auto_start: true, towers, round: {index: round - 1, active, before_first_wave: false}});
 s.match = {...s.match, mode: 'Standard', mode_name: 'Standard', end_round: 80, start_round: 3};
 return s;
}
const allSpots = () => meadowSpots;
const context = (extra = {}) => ({lead: 2, catalog: v0Catalog, paths, leaks: [], freeSpots: allSpots(), freeSpotsFor: allSpots, ...extra});
const options = (state, freeSpots = allSpots()) => buildCandidates(state, {catalog: v0Catalog, freeSpots, paths});

test('the Monkey Meadow Hard Standard playbook is valid, covers rounds 3 to 80 and answers every required threat', async () => {
 assert.deepEqual(validatePlaybook(playbook), []);
 assert.equal(playbook.playbook_version, '1.1.0');
 assert.equal(phaseAt(playbook, 3).id, 'opening');
 assert.equal(phaseAt(playbook, 80).id, 'zomg');
 const answered = new Set(playbook.phases.flatMap(p => p.threats.map(t => t.threat)));
 for (const t of REQUIRED_THREATS) assert.ok(answered.has(t), t);
 assert.deepEqual(playbookTowers(playbook), ['Quincy', 'DartMonkey', 'BombShooter', 'SniperMonkey', 'NinjaMonkey']);
 const found = await findPlaybook(dir, parseSetup('MonkeyMeadow/Hard/Standard'));
 assert.equal(found.playbook.id, playbook.id);
 await assert.rejects(findPlaybook(dir, parseSetup('MonkeyMeadow/Hard/CHIMPS')), /No playbook .* Tutorial Hard Clicks/);
});

test('playbook checks: schema, phase coverage, threat answers against the tower table, and branch references', () => {
 const errors = edit => { const pb = clone(); edit(pb); return validatePlaybook(pb).join('\n'); };
 assert.match(errors(pb => { pb.extra = 1; }), /playbook.extra is not allowed/);
 assert.match(errors(pb => { pb.playbook_version = '1.0'; }), /playbook_version must match/);
 assert.match(errors(pb => { pb.phases[1].build[0].spot = 'S01'; }), /spot is not allowed/);
 assert.match(errors(pb => { pb.phases[1].from_round = 25; }), /must follow the previous phase \(24\)/);
 assert.match(errors(pb => { pb.phases.at(-1).to_round = 79; }), /before the setup's final round 80/);
 assert.match(errors(pb => { pb.phases[0].build[0].tiers = '0-2-0'; }), /DartMonkey 0-2-0 does not detect camo \(camo\)/);
 assert.match(errors(pb => { pb.phases[0].build[1].tower = 'NinjaMonkey'; }), /NinjaMonkey 0-2-2 is not in data\/towers.json|does not pop lead/);
 assert.match(errors(pb => { pb.phases[3].threats = pb.phases[3].threats.filter(t => t.threat !== 'ddt'); }), /no phase answers the threat ddt/);
 assert.match(errors(pb => { pb.phases[0].build[0].tiers = '3-3-0'; }), /crosspath/);
 assert.match(errors(pb => { pb.phases[0].build[0].tower = 'Quincy'; }), /Quincy is not a tower/);
 assert.match(errors(pb => { pb.phases[1].cash_hold[0].for = ['ninja']; }), /for ninja is not a target of this phase/);
 assert.match(errors(pb => { pb.branches[0].override.focus = ['nosuch']; }), /focus nosuch is not a target/);
 assert.match(errors(pb => { pb.branches[0].when = {}; }), /needs at least one condition/);
 assert.match(errors(pb => { pb.branches[0].when.weather = 'rain'; }), /when.weather is not allowed/);
 assert.match(errors(pb => { pb.branches[1].id = pb.branches[0].id; }), /is used twice/);
});

test('conditions: round range, MOAB damage short, lives lost, no free spot, cash above the next purchase', () => {
 const plan = resolvePlaybook(playbook, at(5), [], context());
 assert.equal(CONDITIONS.rounds([30, 40], at(35)).holds, true);
 assert.equal(CONDITIONS.rounds([30, 40], at(41)).holds, false);
 // Round 40 has the first MOAB: no towers means short from 8 rounds before, but not from 3.
 const short = CONDITIONS.moab_short({within: 8}, at(33), plan, [], context());
 assert.deepEqual([short.holds, short.fact.round], [true, 40]);
 assert.equal(CONDITIONS.moab_short({within: 3}, at(33), plan, [], context()).holds, false);
 const leaks = [{round: 20, lives_lost: 3}, {round: 21, lives_lost: 2}];
 assert.deepEqual(CONDITIONS.lives_lost({rounds: 3, at_least: 5}, at(22), plan, [], context({leaks})), {holds: true, fact: 5});
 assert.deepEqual(CONDITIONS.lives_lost({rounds: 3, at_least: 5}, at(24), plan, [], context({leaks})), {holds: false, fact: 0});
 // The darts are due from round 3 and need two towers.
 assert.deepEqual(CONDITIONS.no_free_spot(true, at(5), plan, [], context({freeSpotsFor: () => []})), {holds: true, fact: 'darts'});
 assert.equal(CONDITIONS.no_free_spot(true, at(5), plan, [], context()).holds, false);
 const rich = at(5, {cash: 5000}), poor = at(5, {cash: 1000});
 assert.deepEqual(CONDITIONS.cash_above({margin: 3000}, rich, plan, options(rich), context()), {holds: true, fact: 200});
 assert.equal(CONDITIONS.cash_above({margin: 3000}, poor, plan, options(poor), context()).holds, false);
});

test('entry selection: the phase for the round, then the branches whose conditions hold, recorded per decision', () => {
 const darts = [tower(1, 'DartMonkey', 'S01', [0, 2, 2]), tower(2, 'DartMonkey', 'S02', [0, 2, 2])];
 const opening = resolvePlaybook(playbook, at(10, {towers: darts}), [], context());
 assert.deepEqual(opening.record, {playbook: playbook.id, version: '1.1.0', revision: 26, phase: 'opening', branches: [], due: ['hero'], hold: null});

 // Round 36 with no MOAB damage: moab_first puts the Bomb Shooter first (priority 0, due now).
 const r36 = at(36, {towers: darts, cash: 500});
 const moab = resolvePlaybook(playbook, r36, options(r36), context());
 assert.equal(moab.record.phase, 'first_moab');
 assert.deepEqual(moab.record.branches.map(b => b.id), ['moab_first']);
 assert.equal(moab.record.branches[0].facts.moab_short.round, 40);
 assert.equal(moab.build.find(b => b.id === 'bomb').priority, 0);
 assert.equal(moab.record.due[0], 'bomb');
 assert.equal(moab.record.hold, 1100);

 // Leaks lift the holds and add a Sniper that covers the whole track.
 const leak = resolvePlaybook(playbook, r36, options(r36), context({leaks: [{round: 35, lives_lost: 6}]}));
 assert.deepEqual(leak.record.branches.map(b => b.id), ['moab_first', 'leak_fix']);
 assert.deepEqual(leak.cash_hold, []);
 assert.equal(leak.record.hold, null);
 assert.ok(leak.build.some(b => b.id === 'leakfix' && b.tower === 'SniperMonkey'));

 // No free spot for the next Dart: the target is dropped for now.
 const full = resolvePlaybook(playbook, at(5), [], context({freeSpotsFor: t => t === 'DartMonkey' ? [] : allSpots()}));
 assert.deepEqual(full.record.branches.map(b => b.id), ['no_spot']);
 assert.deepEqual(full.record.deferred, ['darts']);
 assert.ok(!full.build.some(b => b.id === 'darts'));

 // Surplus cash brings later targets forward by 8 rounds; the phase's own plan is unchanged.
 const r20 = at(20, {towers: darts, cash: 9000});
 const surplus = resolvePlaybook(playbook, r20, options(r20), context());
 assert.deepEqual(surplus.record.branches.map(b => b.id), ['surplus']);
 assert.equal(surplus.build.find(b => b.id === 'bomb').round_from, 8);
 assert.equal(playbook.phases[0].build[1].round_from, 16);
});

test('tie-break: a near tie goes to the option the playbook ranks higher; otherwise Jev\'s choice stays', () => {
 const s = at(5, {cash: 800});
 const plan = resolvePlaybook(playbook, s, options(s), context());
 const opts = options(s);
 const answer = (choice, probabilities) => ({type: 'choice', choice, probabilities});
 const near = answer('place:BoomerangMonkey@S03', {'place:BoomerangMonkey@S03': 0.41, 'place:DartMonkey@S01': 0.39, wait: 0.2});
 const tb = tieBreakV5(s, opts, near, plan, {context: context()});
 assert.deepEqual(tb, {choice: 'place:DartMonkey@S01', record: {margin: 0.02, top: ['place:BoomerangMonkey@S03', 'place:DartMonkey@S01'],
  ranks: [null, 1], jev: 'place:BoomerangMonkey@S03', chosen: 'place:DartMonkey@S01', switched: true}});
 // Not near: no tie-break. Neither ranked: none. Margin 0: off.
 assert.equal(tieBreakV5(s, opts, answer('place:BoomerangMonkey@S03', {'place:BoomerangMonkey@S03': 0.6, 'place:DartMonkey@S01': 0.3}), plan, {context: context()}), null);
 assert.equal(tieBreakV5(s, opts, answer('place:BoomerangMonkey@S03', {'place:BoomerangMonkey@S03': 0.4, 'place:BoomerangMonkey@S04': 0.38}), plan, {context: context()}), null);
 assert.equal(tieBreakV5(s, opts, near, plan, {margin: 0, context: context()}), null);
 // Jev's choice already ranked higher: kept, and the record says so.
 const kept = tieBreakV5(s, opts, answer('place:DartMonkey@S01', {'place:DartMonkey@S01': 0.41, 'place:BoomerangMonkey@S03': 0.40}), plan, {context: context()});
 assert.equal(kept.record.switched, false);
 // Groups rank as their best member.
 const groups = groupOptionsV4(s, opts, {catalog: v0Catalog, paths});
 const ranks = playbookRanks(plan, s, groups, context());
 const dartGroup = groups.find(g => g.members.some(m => m.details?.tower === 'DartMonkey'));
 assert.equal(ranks.get(dartGroup.id), 1);
});

test('near-tie column: the share of Jev decisions with a top-two margin under 0.10, with the playbook\'s tie-breaks', () => {
 const d = (margin, extra = {}) => ({kind: 'decision', decisionSource: 'jev', outcome: 'executed', answer: {probabilities: {a: 0.5 + margin / 2, b: 0.5 - margin / 2}}, ...extra});
 const decisions = [d(0.02), d(0.3), d(0.08, {tie_break: [{switched: true}]}), d(0.5, {group_answer: {probabilities: {x: 0.52, y: 0.48}}}),
  {kind: 'decision', decisionSource: 'rules', outcome: 'executed'}, {kind: 'decision', decisionSource: 'jev', answer: {probabilities: {a: 1}}}];
 assert.deepEqual(nearTies(decisions), {near: 3, of: 4, tie_breaks: {considered: 1, switched: 1}});
 const column = SCORE_COLUMNS.find(([h]) => h === 'Near ties')[1];
 assert.equal(column({near_ties: nearTies(decisions)}), '75% (3/4), tie-breaks 1/1 switched');
 assert.equal(column({near_ties: {near: 0, of: 0, tie_breaks: {considered: 0, switched: 0}}}), '-');
});

test('run config: playbook-v5 takes a playbook file and a tie margin; other policies refuse them', () => {
 const env = {TYPESAFE_API_KEY: 'k', MAX_DECISIONS: '10', MAX_INPUT_TOKENS: '10'};
 const c = runConfig(['--policy', 'playbook-v5', '--confirm'], env);
 assert.deepEqual([c.policy, c.playbookFile, c.tieMargin, c.strategist], [PLAYBOOK_POLICY_V5, null, 0.05, false]);
 assert.equal(runConfig(['--policy', 'playbook-v5', '--dry-run', '--playbook', 'x.json', '--tie-margin', '0'], env).tieMargin, 0);
 assert.throws(() => runConfig(['--policy', 'playbook-v5', '--dry-run', '--tie-margin', '0.9'], env), /--tie-margin must be 0 to 0.5/);
 assert.throws(() => runConfig(['--policy', 'jev-v4', '--dry-run', '--playbook', 'x.json'], env), /are for --policy playbook-v5/);
});

test('spot catalog: 30 spots by default, spread along the track, and the count is configurable', async () => {
 const grid = gridPoints(pathBounds(paths, 30), 6).filter(p => trackDistance(p, paths) >= 12);
 const towers = [{id: 'DartMonkey', range: 32}];
 const part = s => Math.min(9, Math.floor((s.from + s.to) / 2 * 10));
 const spread = selectSpots({DartMonkey: grid}, towers, paths);
 const clustered = selectSpots({DartMonkey: grid}, towers, paths, {spread: 0});
 assert.equal(spread.length, 30);
 assert.ok(new Set(spread.map(part)).size > new Set(clustered.map(part)).size, 'spread covers more parts of the track');
 assert.ok(new Set(spread.map(part)).size >= 9);
 for (const s of spread) assert.ok(spread.every(o => o === s || Math.hypot(o.x - s.x, o.y - s.y) >= 12));
 assert.equal(selectSpots({DartMonkey: grid}, towers, paths, {count: 12}).length, 12);
 // Places beside the track, for the runner's fallback.
 const near = nearTrackPoints(paths);
 assert.ok(near.length > 50);
 assert.ok(near.every(p => { const d = trackDistance(p, paths); return d >= 8 && d <= 28; }));
});

async function read(file) { return (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)); }

test('dry run: the playbook in force per decision, near ties broken, and places beside the track once the catalog is full', {timeout: 60000}, async t => {
 const tmp = await mkdtemp(join(tmpdir(), 'jev-playbook-run-'));
 t.after(() => rm(tmp, {recursive: true, force: true}));
 const fake = fakeGame({required: () => 0, endRound: 30});
 const usage = {requests: 0, inputTokens: 0}, limits = {maxDecisions: 5000, maxRequests: 5000, maxInputTokens: 1e9};
 const s = createSession({policy: PLAYBOOK_POLICY_V5, setup: parseSetup('MonkeyMeadow/Hard/Standard'), limits, usage});
 const file = runLog(join(tmp, 'run.jsonl')), series = runLog(join(tmp, 'series.jsonl'));
 // Only two catalog spots, so they are taken early and the runner has to look beside the track.
 const outcome = await runSession({bridge: fake.bridge, ask: fakeJev({usage, limits, margin: 0.02}), log: teeLog(file, s), series, session: s, setup: s.setup, limits, usage,
  loadSpots: async () => (await computeSpotCatalog(fake.bridge)).spots.slice(0, 2), timings: {pollMs: 0, pausedPollMs: 0, minIntervalMs: 0, lifecyclePollMs: 0, homeAfterResultMs: 50},
  sleep: async () => {}, dryRun: true, policy: PLAYBOOK_POLICY_V5, playbook, tieMargin: 0.05, speed: 3,
  popsCalibration: {factor: 1.3, from_round: 60, source: 'pinned', basis: 'outcome_bounds', runs: 0, stored: {factor: 1.08, source: 'interim'}}});
 assert.equal(outcome.result, 'victory');
 const events = await read(file.file);
 assert.deepEqual(events.find(e => e.kind === 'session_start').playbook, {id: playbook.id, version: '1.1.0'});
 assert.deepEqual(events.find(e => e.kind === 'run_start').playbook, {id: playbook.id, version: '1.1.0'});
 assert.equal(events.find(e => e.kind === 'run_start').policy_revision, 26, 'revision 26: reachable DDT saving targets and same-round capacity answers');
 const decisions = events.filter(e => e.kind === 'decision' && e.decisionSource !== 'forced');
 assert.ok(decisions.length > 10);
 assert.ok(decisions.every(e => e.plan?.playbook === playbook.id && e.plan.version === '1.1.0' && e.plan.revision === 26 && ['opening', 'first_moab'].includes(e.plan.phase)), 'each decision names the playbook entries in force');
 assert.ok(decisions.some(e => e.constraint?.rules?.some(r => r.kind === 'off_plan')));
 assert.ok(decisions.some(e => e.tie_break?.some(b => b.switched)), 'a near tie went to the playbook\'s option');
 assert.equal(usage.requests > 0, true);
 // Fallback: once the two catalog spots were taken, placements went to places beside the track.
 const fallback = events.filter(e => e.kind === 'spot_fallback');
 assert.ok(fallback.length && fallback[0].valid > 0 && fallback[0].spots[0] === 'F01');
 const settled = new Set(events.filter(e => e.kind === 'dispatch' && e.outcome === 'executed').map(e => e.command_id));
 assert.ok(decisions.some(e => /^place:.*@F\d\d$/.test(e.chosen.id) && (e.outcome === 'executed' || settled.has(e.command_id ?? e.result?.command_id))), 'a tower was placed beside the track');
 const [entry] = await read(series.file);
 assert.deepEqual([entry.policy, entry.mode, entry.label, entry.playbook.version], [PLAYBOOK_POLICY_V5, 'playbook', PLAYBOOK_POLICY_V5, '1.1.0']);
 const [score] = scoreRuns(events, await readSeries(series.file), {runOf, score: scoreRun});
 assert.equal(score.near_ties.near, score.near_ties.of);
 assert.ok(score.near_ties.tie_breaks.switched > 0);
 assert.match(table([score], SCORE_COLUMNS), /btd6-playbook-v5 \(playbook 1\.1\.0\)/);
 // Adherence: the Darts' round (14) passed and was reported once, and the scorecard shows the measure.
 const targets = events.filter(e => e.kind === 'plan_target');
 assert.ok(targets.some(e => e.id === 'darts' && e.round_by === 14));
 assert.equal(new Set(targets.map(e => `${e.id}@${e.round_by}`)).size, targets.length);
 assert.equal(score.plan_adherence.targets.of, targets.length);
 assert.match(table([score], SCORE_COLUMNS), /targets \d+\/\d+ on time/);
 assert.equal(events.find(e => e.kind === 'session_start').calibration.moab.source, 'default');
 // A pinned pops factor is recorded in session_start and run_start, and put back when the session ends.
 for (const kind of ['session_start', 'run_start'])
  assert.deepEqual(events.find(e => e.kind === kind).calibration.pops, {factor: 1.3, from_round: 60, source: 'pinned', basis: 'outcome_bounds', stored: {factor: 1.08, source: 'interim'}});
 assert.deepEqual(popsCalibration(), {factor: 1, from_round: 1});
});

// Revision 2 (the first two graded runs lost at rounds 51 and 56): a hold for complete targets lapses, and
// waiting goes while an on-plan purchase is affordable above the holds for other targets.
const revPlan = holds => ({summary: 's', hero: {tower: 'none', round_from: 3}, threats: [], cash_hold: holds,
 build: [{id: 'bomb', tower: 'BombShooter', tiers: '0-4-2', count: 1, round_from: 36, round_by: 43, priority: 1},
  {id: 'ninja', tower: 'NinjaMonkey', tiers: '4-0-2', count: 1, round_from: 44, round_by: 50, priority: 2}]});
const revState = (cash, towers = []) => ({in_game: true, match: {id: 'm', result: null}, round: {number: 45, active: false}, cash, lives: 100, popup: null,
 towers: [{id: 1, base_id: 'BombShooter', tiers: [0, 4, 2], x: 0, y: 0}, ...towers]});
const wait = {id: 'wait', label: 'Wait', command: null, details: {kind: 'wait'}};
const placeNinja = cash => ({id: 'place:NinjaMonkey@S01', command: {action: 'place_tower', tower: 'NinjaMonkey', x: 0, y: 0},
 details: {kind: 'place', tower: 'NinjaMonkey', spot: 'S01', cost: 500, cash_after: cash - 500}});
const upgradeNinja = cash => ({id: 'upgrade:2:p1', command: {action: 'upgrade_tower', tower_id: 2, path: 0},
 details: {kind: 'upgrade', tower_id: 2, path: 1, cost: 2000, cash_after: cash - 2000}});

test('v5 revision 2: a hold whose targets are all complete no longer applies', () => {
 const plan = revPlan([{from_round: 44, to_round: 50, amount: 3500, for: ['bomb']}]);
 assert.equal(activeHold(plan, 45).amount, 3500, 'without the state, as before');
 assert.equal(activeHold(plan, 45, revState(1000)), null, 'the Bomb Shooter is 0-4-2: the hold is done');
 const unfinished = revState(1000);
 unfinished.towers[0].tiers = [0, 3, 2];
 assert.equal(activeHold(plan, 45, unfinished).amount, 3500);
 // The run-1 case: Jev kept waiting because the $3,500 hold removed the Ninja; now the Ninja stays.
 const {candidates, constraint} = constrainV1(revState(1090), [wait, placeNinja(1090)], plan, {}, {idleCash: true});
 assert.ok(!(constraint?.rules ?? []).some(r => r.kind === 'cash_hold'));
 assert.deepEqual(candidates.map(c => c.id), ['place:NinjaMonkey@S01'], 'and waiting goes (idle_cash)');
});

test('v5 revision 2: waiting goes while an on-plan purchase is affordable above the holds for other targets (idle_cash)', () => {
 const ninjaHold = revPlan([{from_round: 44, to_round: 55, amount: 6000, for: ['ninja']}]);
 const withNinja = revState(843, [{id: 2, base_id: 'NinjaMonkey', tiers: [2, 0, 2], x: 5, y: 5}]);
 // Run 2, rounds 52 to 55: the upgrade advances the target the $6,000 hold is for, so that hold doesn't block it.
 const r = constrainV1(withNinja, [wait, upgradeNinja(2500)], ninjaHold, {}, {idleCash: true});
 assert.deepEqual(r.candidates.map(c => c.id), ['upgrade:2:p1']);
 assert.deepEqual(r.constraint.rules.find(x => x.kind === 'idle_cash'), {kind: 'idle_cash', removed: 1, cash: 843, affordable: 'upgrade:2:p1', target: 'ninja', ids: ['wait']});
 // A hold for another target stays in force: waiting stays while the purchase would dip below it plus the margin.
 const other = revPlan([{from_round: 44, to_round: 55, amount: 3000, for: ['snipers']}]);
 other.build.push({id: 'snipers', tower: 'SniperMonkey', tiers: '0-2-4', count: 1, round_from: 60, round_by: 62, priority: 3});
 assert.ok(constrainV1(revState(3000), [wait, placeNinja(3000)], other, {}, {idleCash: true}).candidates.some(c => c.id === 'wait'));
 assert.deepEqual(constrainV1(revState(3000 + 500 + IDLE_MARGIN), [wait, placeNinja(3000 + 500 + IDLE_MARGIN)], other, {}, {idleCash: true}).candidates.map(c => c.id),
  ['place:NinjaMonkey@S01'], 'at the hold plus the margin, it goes');
 // claude-v1 keeps waiting (idleCash off).
 assert.ok(constrainV1(withNinja, [wait, upgradeNinja(2500)], ninjaHold, {}).candidates.some(c => c.id === 'wait'));
});

// Playbook 1.1.0: the jugg target (two Dart Monkeys 4-0-2 in rounds 62 to 74). Each tower counts toward the first target it
// can still reach (plan-v1.mjs planTargets): the two 0-3-2 Darts stay with darts (they can't reach 4-0-2), and new Darts count
// toward jugg, whose placements and path-1 upgrades are on plan; both zomg holds are also for jugg.
test('playbook 1.1.0: the 0-3-2 Darts stay with darts, new Darts count toward jugg', () => {
 const zomg = playbook.phases.find(p => p.id === 'zomg');
 assert.deepEqual(zomg.build.map(b => b.id).slice(0, 2), ['darts', 'jugg']);
 assert.deepEqual(zomg.cash_hold.map(h => h.for), [['ninja2', 'jugg'], ['snipers', 'jugg']]);
 const plan = {summary: zomg.summary, hero: {tower: 'none', round_from: 3}, build: zomg.build, cash_hold: zomg.cash_hold, threats: zomg.threats, note: ''};
 const T = (id, tiers, next_upgrades = []) => ({id, base_id: 'DartMonkey', tiers, x: -62 + id, y: -2, next_upgrades});
 const state = v0Round6({cash: 3000, round: {index: 61, active: true, before_first_wave: false},
  towers: [T(1, [0, 3, 2]), T(2, [0, 3, 2]), T(3, [0, 0, 0], [{path: 0, cost: 180, id: 'Sharp Shots'}]), T(4, [2, 0, 2])]});
 const byId = Object.fromEntries(planTargets(plan, state).map(t => [t.item.id, t.towers.map(x => x.id)]));
 assert.deepEqual(byId.darts, [1, 2]);
 assert.deepEqual(byId.jugg, [4, 3], 'the 2-0-2 Dart (closer to 4-0-2) first, then the new one');
 // A new Dart placement and the new Dart's path-1 upgrade advance jugg.
 const candidates = [{id: 'place:DartMonkey@A', details: {kind: 'place', tower: 'DartMonkey', cost: 200}},
  {id: 'upgrade:3:p1', details: {kind: 'upgrade', tower_id: 3, path: 1, cost: 180}}];
 const on = onPlanPurchases(plan, {...state, towers: state.towers.slice(0, 3)}, candidates, {catalog: v0Catalog});
 assert.deepEqual([on.get('place:DartMonkey@A')?.target, on.get('upgrade:3:p1')?.target], ['jugg', 'jugg']);
});
