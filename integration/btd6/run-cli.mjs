// Runs one match with a Jev-only policy, from launch or the main menu to the end of the match.
//   npm run btd6:run -- --policy jev-v4 --confirm                 (Monkey Meadow, Hard Standard: the default setup)
//   npm run btd6:run -- --setup MonkeyMeadow/Hard/CHIMPS --policy jev-v4 --confirm
//   npm run btd6:run -- --policy jev-v4 --dry-run                 (simulated game and Jev)
// --policy: jev-v6 (btd6-jev-v6, policy-v6.mjs), jev-v4 (btd6-jev-v4, policy-v4.mjs), jev-v3 (btd6-jev-v3, policy-v3.mjs), jev-v2 (btd6-jev-v2, policy-v2.mjs), jev-v1 (btd6-jev-v1,
// policy-v1.mjs), or jev / jev-v0 for the v0 baseline (btd6-jev-v0). --setup defaults to MonkeyMeadow/Hard/Standard.
// Options: --speed graded[:<max>] | adaptive[:<cruise>/<pressure>] | <1-10>. The default, graded:10, plays at
// 10, 5, 3 or 1 by the defence's margin for the round and drops to 1 on danger (speed.mjs; max 3 to 10).
// adaptive:5/1 plays at 5 and drops to normal speed while something needs resolving (pressure 1 or 3, cruise
// 3 to 10). A number is a fixed speed: 1 normal speed, 3 the game's fast-forward, more than 3 fast-forward with
// that time scale. Needs bridge 0.3.4 (graded's MOAB check needs 0.3.11). --between-rounds turns auto-start
// off for the match (bridge 0.3.11): purchases while no round runs, each round started by the runner, and
// purchases during a round only in an emergency; auto-start is restored at the end. --no-status (no status page),
// --status-port <port> (default 4318, or BTD6_STATUS_PORT).
// --policy claude-v1 (btd6-claude-v1, plan-v1.mjs) is v4 with a Claude strategist: requests go to the file channel
// in .private/btd6/strategy (STRATEGY_DIR overrides it) and a Claude Code session answers them with
// npm run btd6:strategy -- wait | show | answer (docs/BTD6-STRATEGIST.md). --opening-timeout <seconds> (default 300)
// is how long the opening plan is waited for before the first round. In a dry run a scripted strategist answers
// (fake-strategist.mjs) unless --no-fake-strategist is given, which leaves the requests to a session.
// --policy playbook-v5 (btd6-playbook-v5, playbook-v5.mjs) is v4 with a playbook prepared ahead of time: the plan
// for each round range and its branches are applied by code, with no Claude call. The playbook is the file in
// integration/btd6/playbooks/ for the setup, or --playbook <file>. --tie-margin <p> (default 0.05, 0 off): when
// Jev's top two options are within p, the one the playbook ranks higher is taken.
// --ruleset btd6-open-v2 (default: without the Dartling Gunner, Mortar and Heli, which need aiming) or btd6-open-v3 (the
// runner aims them; bridge 0.3.12). --no-shots: no screenshots (by default saved under .private/btd6/shots/<run>/, shots.mjs).
// --moab-factor <x> and --pops-factor <x> pin the MOAB damage and pops calibration factors for the run (a series runs
// with the same pinned factors, docs/PLAN.md). Without them the setup's stored factor applies (moab-calibration.mjs,
// pops-calibration.mjs), which moves as measured runs are added. Measures are recorded either way.
// --moab-short-speed 3|5 (graded speed only, at most its maximum): while moab_short is the only danger signal, graded
// speed plays at most at that level instead of 1; the speed label gets "+moab<n>" (graded:10+moab3).
// --min-speed 1|3 (graded speed only; default 1): graded speed's floor. With 3 nothing in the graded controller plays
// below 3x (margin grades, danger signals, moab_short, consult slowdowns, the start); the label gets "+min3".
// .env: TYPESAFE_API_KEY, MAX_DECISIONS and MAX_INPUT_TOKENS are required for a live run.
// BTD6_BRIDGE_PORT (default 15527) picks the bridge, for a second game copy on its own port: the run takes
// runner-<port>.lock instead of runner.lock, its log is <time>-<policy>-port<port>.jsonl, and bridge_port goes in
// session_start, run_start and the series entry, its screenshots go under shots/port<port>/, and its calibration
// entries are keyed <match>-port<port> (ports.mjs). Give each copy its own STRATEGY_DIR (required for a strategist
// policy on another port) and BTD6_STATUS_PORT.
// Logs: .private/btd6/runs/<time>-<policy>.jsonl and .private/btd6/series.jsonl (a dry run writes
// under .private/btd6/dry-run/ instead). The spot catalog comes from .private/btd6/spots/<map>.json
// (npm run btd6:spots).
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, relative} from 'node:path';
import {acquireOperatorLock, runLog} from '../../core/runner.mjs';
import {describeEarned, describeWrites} from './profile.mjs';
import {jevClient} from '../../core/jev.mjs';
import {bridgeClient} from './bridge-client.mjs';
import {isDefaultPort, portSuffix, runLogName, runnerLockName} from './ports.mjs';
import {createSession, runConfig, runSession, teeLog} from './session.mjs';
import {computeSpotCatalog, loadSpotCatalog} from './spot-catalog.mjs';
import {startStatusServer} from './status-server.mjs';
import {fakeGame, fakeJev} from './fake-bridge.mjs';
import {fileChannel} from '../../core/strategy-channel.mjs';
import {newStrategyStatus} from '../../core/hierarchical.mjs';
import {scriptedStrategist, simplePlan} from './fake-strategist.mjs';
import {findPlaybook, loadPlaybook} from './playbook-v5.mjs';
import {loadCalibration, recordCalibration, runFactor as moabRunFactor} from './moab-calibration.mjs';
import {loadPopsCalibration, recordPopsCalibration, pinCalibration} from './pops-calibration.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let config;
try { config = runConfig(process.argv.slice(2), process.env); }
catch (error) {
 console.error(error.message);
 console.error('Usage: npm run btd6:run -- --policy playbook-v5|claude-v1|jev-v6|jev-v4|jev-v3|jev-v2|jev-v1|jev [--setup <map>/<difficulty>/<mode>] [--speed graded[:<max>] | adaptive[:<cruise>/<pressure>] | <1-10>] [--between-rounds] [--ruleset btd6-open-v2|btd6-open-v3] [--moab-factor <x>] [--pops-factor <x>] [--moab-short-speed 1|3|5] [--camo-margin] [--min-speed 1|3] [--zero-leak] [--no-shots] (--confirm | --dry-run) [--no-status] [--status-port <port>]');
 console.error('claude-v1 only: [--opening-timeout <seconds>] [--no-fake-strategist] (dry run).');
 console.error('playbook-v5 only: [--playbook <file>] [--tie-margin <0-0.5>].');
 console.error('--setup defaults to MonkeyMeadow/Hard/Standard; CHIMPS is MonkeyMeadow/Hard/CHIMPS.');
 console.error('jev-v6, playbook-v5 and claude-v1 only: [--zero-leak] (the policy and graded speed play as if the match had one life).');
 process.exit(2);
}

// btd6-playbook-v5: the playbook for the setup, checked before anything else starts.
let playbook = null, playbookFile = null;
if ('playbookFile' in config) {
 try {
  if (config.playbookFile) { playbookFile = resolve(config.playbookFile); playbook = await loadPlaybook(playbookFile); }
  else ({file: playbookFile, playbook} = await findPlaybook(resolve(root, 'integration/btd6/playbooks'), config.setup));
 } catch (error) { console.error(error.message); process.exit(2); }
}

const base = resolve(root, config.dryRun ? '.private/btd6/dry-run' : '.private/btd6');
const runsDir = resolve(base, 'runs');
// The MOAB damage and pops calibrations for the setup: pinned on the command line, measured by earlier runs, or
// the interim factors.
const calibrationDir = resolve(base, 'calibration');
const storedMoab = await loadCalibration(calibrationDir, config.setup), storedPops = await loadPopsCalibration(calibrationDir, config.setup);
const moabCalibration = config.moabFactor != null ? pinCalibration(storedMoab, config.moabFactor) : storedMoab;
const popsCalibration = config.popsFactor != null ? pinCalibration(storedPops, config.popsFactor) : storedPops;
await mkdir(runsDir, {recursive: true});
const usage = {requests: 0, inputTokens: 0};
const {limits} = config;
const fake = config.dryRun ? fakeGame() : null;
// Bridge read retries go to the run log once it is open (it is opened below).
const readRetries = {log: null};
const bridge = fake ? fake.bridge : bridgeClient({port: config.bridgePort,
 onReadRetry: retry => readRetries.log?.append({kind: 'bridge_read_retry', ...retry})});
const ask = fake ? fakeJev({usage, limits}) : jevClient({apiKey: config.apiKey, usage, limits});
const loadSpots = fake
 ? async () => computeSpotCatalog(bridge)
 : async (map, paths) => loadSpotCatalog(resolve(root, '.private/btd6/spots'), map, paths);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const fileLog = runLog(resolve(runsDir, runLogName(stamp, config.policy, config.bridgePort)));
const series = runLog(resolve(base, 'series.jsonl'));
const brief = e => {
 if (e.kind === 'phase') return e.message;
 if (e.kind === 'decision' && e.outcome !== 'held') return `round ${e.state?.round?.number ?? '-'}: ${e.chosen?.label} (${e.decisionSource}) ${e.outcome}${e.result?.reason ? ` (${e.result.reason})` : ''}`;
 if (e.kind === 'dispatch' && !['pending', 'executed', 'queued'].includes(e.outcome)) return `dispatch ${e.outcome}${e.result?.reason ? `: ${e.result.reason}` : e.message ? `: ${e.message}` : ''}`;
 if (e.kind === 'speed_set') return `Speed ${e.speed} (${e.reason}): ${e.status}${e.refused ? ` (${e.refused})` : ''}`;
 if (e.kind === 'auto_start_set') return `Auto-start ${e.enabled ? 'on' : 'off'} (${e.reason}): ${e.status}${e.refused ? ` (${e.refused})` : ''}`;
 if (e.kind === 'runner_paused') return `Paused: ${e.message}`;
 if (e.kind === 'runner_resumed') return 'Runner resumed after screen closed.';
 if (e.kind === 'run_end') return `Match ended: ${e.result}${e.speed_time ? ` after ${Math.round(e.speed_time.total_s / 6) / 10} min${e.speed_time.slow_s != null ? `, ${Math.round(e.speed_time.slow_s / 6) / 10} at the slow speed` : ''}` : ''}`;
 if (e.kind === 'profile_check') {
  if (e.status !== 'checked') return `Saved profile unchecked: ${e.reason}`;
  const earned = describeEarned(e);
  return `Saved profile: ${e.profile_write ? `unlocks were written (${describeWrites(e.writes)})` : 'no unlocks written'}${earned ? `; earned ${earned}` : ''}`;
 }
 if (e.kind === 'strategy_request') return `Strategist asked (${e.reason}${e.blocking ? ', waiting' : ''}): ${e.request_id}`;
 if (e.kind === 'strategy_adopted') return `Plan adopted (${e.reason}${e.late ? ', late' : ''}, ${Math.round((e.latency_ms ?? 0) / 1000)} s): ${e.plan?.summary ?? ''}`;
 if (e.kind === 'strategy_timeout') return `No opening plan after ${Math.round(e.waited_ms / 1000)} s; playing on without one.`;
 if (e.kind === 'moab_measure') return `Round ${e.round} MOAB damage: measured ${e.measured_dps}/s, estimated ${e.estimated_dps}/s (x${e.ratio ?? '-'})`;
 if (e.kind === 'spot_fallback') return `Catalog spots taken for ${e.tower}: ${e.spots.length} places beside the track (${e.valid} of ${e.checked} points valid).`;
 if (e.kind === 'aim') return `Aimed #${e.tower_id} ${e.base_id}: ${e.action === 'set_targeting' ? `targeting ${e.mode}` : `point (${e.point?.x}, ${e.point?.y})`}`;
 if (e.kind === 'screenshot') return e.error ? `Screenshot ${e.reason} failed: ${e.error}` : `Screenshot ${e.reason}: ${e.path}`;
 if (e.kind === 'warning') return `Warning: ${e.message}`;
 if (e.kind === 'error') return `Error: ${e.message}`;
 return null;
};
// btd6-claude-v1: the file channel the answering session reads. A stale request from an earlier run is
// replaced by this run's first request (its key names this match).
let strategist = null;
if (config.strategist) {
 // A second game copy needs its own channel; sharing one would hand one runner's plans to the other.
 if (!isDefaultPort(config.bridgePort) && !process.env.STRATEGY_DIR) { console.error(`Bridge port ${config.bridgePort}: set STRATEGY_DIR to this copy's own strategy directory.`); process.exit(2); }
 const channel = fileChannel(process.env.STRATEGY_DIR ?? resolve(base, 'strategy'));
 strategist = {status: newStrategyStatus({enabled: true}), channel: config.fakeStrategist
  ? scriptedStrategist(channel, {fallback: simplePlan, round: () => session.state?.round?.number ?? null}) : channel};
}
const session = createSession({policy: config.policy, setup: config.setup, limits, usage, onEvent: e => { const line = brief(e); if (line) console.log(line); }});
const log = teeLog(fileLog, session);
readRetries.log = log;

let release = null, status = null, exitCode = 0;
const lockFile = resolve(base, runnerLockName(config.bridgePort));
process.on('SIGINT', () => {
 if (session.stopRequested) process.exit(130);
 session.stopRequested = true;
 console.log('Stopping after the current step (Ctrl+C again to quit at once).');
});
try {
 release = await acquireOperatorLock(lockFile);
 console.log(`${config.dryRun ? 'Dry run (simulated game and Jev)' : 'Live run'}: ${config.setup.map} ${config.setup.difficulty} ${config.setup.mode}, policy ${config.policy}, ruleset ${config.ruleset.name}-v${config.ruleset.version}, speed ${config.speed.label}, `
  + (playbook ? `playbook ${playbook.id} ${playbook.playbook_version} (${relative(root, playbookFile)}), tie margin ${config.tieMargin}, ` : '')
  + (strategist ? `strategist channel ${strategist.channel.dir}${config.fakeStrategist ? ' (scripted answers)' : ''}, opening timeout ${config.openingTimeoutMs / 1000} s, ` : '')
  + `MOAB calibration x${moabCalibration.factor} (${moabCalibration.source}), pops calibration x${popsCalibration.factor} from round ${popsCalibration.from_round} (${popsCalibration.source}), `
  + `limits ${limits.maxDecisions} decisions and ${limits.maxInputTokens} input tokens${config.dryRun ? '' : ', TypeSafe key set'}, bridge port ${config.bridgePort}, lock ${relative(root, lockFile)}. Log: ${fileLog.file}`);
 if (config.status) {
  status = await startStatusServer(session, {port: config.statusPort});
  console.log(`Status page: ${status.url}`);
 }
 const outcome = await runSession({bridge, ask, log, series, session, setup: config.setup, policy: config.policy, limits, usage, loadSpots, dryRun: config.dryRun, speed: config.speed, strategist, openingTimeoutMs: config.openingTimeoutMs, playbook, tieMargin: config.tieMargin, moabCalibration, popsCalibration,
  ruleset: config.ruleset, shots: config.shots ? {dir: isDefaultPort(config.bridgePort) ? resolve(base, 'shots') : resolve(base, 'shots', `port${config.bridgePort}`), root} : null,
  bridgePort: config.bridgePort, zeroLeak: config.zeroLeak,
  timings: config.dryRun ? {pollMs: 20, pausedPollMs: 100, minIntervalMs: 0, lifecyclePollMs: 20, homeAfterResultMs: 2000} : {}});
 console.log(`Finished (${outcome.reason}): ${outcome.message}`);
 console.log(`Decisions ${session.runner?.status.decisions ?? 0}, actions ${session.runner?.status.actions ?? 0}, Jev requests ${usage.requests}, input tokens ${usage.inputTokens}.`);
 // This run's own factors go into the setup's files and the log, pinned or not; a pinned factor only decides
 // what the session applied.
 if (outcome.moabMeasures?.length) {
  const factor = await recordCalibration(calibrationDir, config.setup, outcome.matchId + portSuffix(config.bridgePort), outcome.moabMeasures);
  await log.append({kind: 'calibration_recorded', calibration: 'moab', rounds: outcome.moabMeasures.length, run: moabRunFactor(outcome.moabMeasures), setup_factor: factor, applied: moabCalibration.factor, source: moabCalibration.source});
  console.log(`MOAB damage measured in ${outcome.moabMeasures.length} rounds; ${factor == null ? 'too few for a calibration' : `calibration for this setup now x${factor}`}.`);
 }
 if (outcome.popsMeasures?.length) {
  const recorded = await recordPopsCalibration(calibrationDir, config.setup, outcome.matchId + portSuffix(config.bridgePort), outcome.popsMeasures);
  await log.append({kind: 'calibration_recorded', calibration: 'pops', rounds: outcome.popsMeasures.length, run: recorded?.run ?? null, setup_factor: recorded?.factor ?? null, applied: popsCalibration.factor, source: popsCalibration.source});
  console.log(`Pops measured in ${outcome.popsMeasures.length} rounds; ${recorded ? `run factor x${recorded.run.factor} from ${recorded.run.rounds} rounds with lives lost, calibration for this setup now x${recorded.factor}` : 'too few rounds with lives lost for a calibration'}.`);
 }
 if (strategist) console.log(`Strategist requests ${strategist.status.requests}, answers ${strategist.status.answers}, late ${strategist.status.late}.`);
 if (outcome.reason !== 'ended') exitCode = 1;
} catch (error) {
 console.error(error.message);
 await log.append({kind: 'error', message: error.message}).catch(() => {});
 exitCode = 1;
} finally {
 await status?.close();
 await release?.();
}
process.exit(exitCode);
