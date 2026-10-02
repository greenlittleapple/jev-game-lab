// Graded speed replay: runs the graded controller (speed.mjs gradedSpeed) over each logged run's states and
// reports the level it would have played each round at, against the lives lost and the logged time.
//   npm run btd6:speed-replay                          (every run in .private/btd6/runs, the variants below)
//   npm run btd6:speed-replay -- --variant proposed --rounds    (and the per-round levels of the lost rounds)
//   npm run btd6:speed-replay -- --dir <folder> --json
//   npm run btd6:speed-replay -- --floor 3 [--since <ISO time>] [--mode CHIMPS]   (logged time with a speed floor)
// States: every decision state, plus a state at each round start (a speed_round record, with the towers and lives
// of the last decision). Danger signals from the logs: lives lost this round (lives_lost) and v4's moab_short, both
// as the session computes them; bloon positions aren't in the decision states, so bloons_past and moab_outrun
// are left out. The runner's buying (speed.mjs buyingNow) comes from the decision records.
// Time: between two states the game ran at the logged speed (the last executed speed_set), so the game time is
// the real time times that speed, and the replayed time is that game time over the replayed level.
// Hard rounds: by default leave-one-out, so a run is replayed with the round data and the other runs' lost rounds only.
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defenceMargins, gradedSpeed, gradeFor, buyingNow, BUYING_MS, MIN_SPEED, GRADE_AT_CAMO} from './speed.mjs';
import {moabShort} from './policy-v4.mjs';
import {setMoabCalibration} from './moab.mjs';
import {setPopsCalibration} from './estimate.mjs';
import {roundsOf} from './pops-calibration.mjs';
import {buildHardRounds, currentEra, hardRoundsFor, withoutLogs} from './hard-rounds.mjs';
import {pathsFor} from './moab-replay.mjs';
import {readRuns} from './rules-audit.mjs';
import {loadCalibration, setupKey} from './moab-calibration.mjs';

// Variants: speedCaps options, whether the hard list is used, and the buying cap. 'current' is graded:10 before
// the hard-round list (no_moab_estimate from round 40, no end or buying cap).
export const VARIANTS = {
 current: {hard: false, buying: false, options: {noMoabCap: true, endRounds: 0}},
 proposed: {hard: true, buying: true, options: {}},
 'no buying cap': {hard: true, buying: false, options: {}},
 'no lead': {hard: true, buying: true, options: {hardLead: 0}},
 'hard at 5': {hard: true, buying: true, options: {hardSpeed: 5}},
 'no end cap': {hard: true, buying: true, options: {endRounds: 0}},
 'end 3': {hard: true, buying: true, options: {endRounds: 3}},
 'end 10': {hard: true, buying: true, options: {endRounds: 10}},
 'round data only': {hard: true, logs: false, buying: true, options: {}},
 'logs in 2+ runs or 20+ lives': {hard: true, minRuns: 2, minLives: 20, buying: true, options: {}},
 'lead at 3': {hard: true, buying: true, options: {hardLeadSpeed: 3}},
 'with no_moab_estimate': {hard: true, buying: true, options: {noMoabCap: true}},
 'current-era logs only (no round data)': {hard: true, logRuns: 'current', data: false, buying: true, options: {}},
 'current-era logs': {hard: true, logRuns: 'current', buying: true, options: {}},
 'moab_short at 3': {hard: true, buying: true, options: {moabShortSpeed: 3}},
 'current-era logs + moab_short at 3': {hard: true, logRuns: 'current', buying: true, options: {moabShortSpeed: 3}},
 // The climb back after a drop and the buying cap's length, on graded:10+moab3 (the line above); run them with --fine.
 'hold 1 s': {hard: true, logRuns: 'current', buying: true, options: {moabShortSpeed: 3, jumpHoldMs: 1000}},
 'hold 2 s': {hard: true, logRuns: 'current', buying: true, options: {moabShortSpeed: 3, jumpHoldMs: 2000}},
 'hold 4 s': {hard: true, logRuns: 'current', buying: true, options: {moabShortSpeed: 3, jumpHoldMs: 4000}},
 'step 2 s': {hard: true, logRuns: 'current', buying: true, options: {moabShortSpeed: 3, stepUpMs: 2000}},
 'buying 0 s': {hard: true, logRuns: 'current', buying: false, options: {moabShortSpeed: 3}},
 'buying 1.5 s': {hard: true, logRuns: 'current', buying: true, buyingMs: 1500, options: {moabShortSpeed: 3}},
 // --camo-margin (label graded:10+moab3+camo): the camo margin in defenceMargins, graded on GRADE_AT_CAMO.
 'moab_short at 3 + camo margin': {hard: true, buying: true, camo: true, options: {moabShortSpeed: 3, gradeAt: GRADE_AT_CAMO}},
 'current-era logs + moab_short at 3 + camo margin': {hard: true, logRuns: 'current', buying: true, camo: true, options: {moabShortSpeed: 3, gradeAt: GRADE_AT_CAMO}},
};

// The states to replay, in order: [{at (ms), state, margins, short (v4's moab_short), speed (the logged speed then, or
// null before the first executed speed_set), decision (the decision record, for decision states)}]. The margins and
// moab_short don't depend on the variant, so they are computed once. The calibrations must be set before
// (setMoabCalibration, setPopsCalibration).
// logged: the danger signals of the last executed speed_set the controller made (not the keeper's round_start or resend),
// which hold until its next one. speedPoints: also a state (the last one again) at each such speed_set, so the game time
// and the logged danger change where the log has them (the fine replay, replaySpeed's tickMs). camo: defenceMargins' camo margin (--camo-margin).
export function replayStates(records, {paths = [], speedPoints = false, camo = false} = {}) {
 const out = [];
 let last = null, speed = null, logged = [];
 const push = (state, at, decision = null) => {
  out.push({at, state, margins: defenceMargins(state, paths, {camo}), short: Array.isArray(state.towers) && Boolean(moabShort(state, paths)), speed, logged, decision});
  last = state;
 };
 const synthetic = n => ({...last, round: {...last.round, number: n, lives_lost: 0}});
 for (const rec of records) {
  const at = Date.parse(rec.time);
  if (rec.kind === 'speed_set' && rec.status === 'executed') {
   speed = rec.speed;
   if (/^(round_start|resend)/.test(rec.reason ?? '')) continue;
   logged = rec.danger ?? [];
   if (speedPoints && last) push(synthetic(last.round.number), at);
   continue;
  }
  // A speed_round record is logged when the next round starts.
  if (rec.kind === 'speed_round') { if (last && rec.round + 1 > last.round.number) push(synthetic(rec.round + 1), at); continue; }
  if (rec.kind !== 'decision' || !rec.state?.in_game || !rec.state.round || rec.state.match?.result) continue;
  if (last) for (let n = last.round.number + 1; n < rec.state.round.number; n++) push(synthetic(n), at);
  push(rec.state, at, rec);
 }
 return out;
}

// One run: {rounds: [{round, lost, level (the level for most of the round's game time), start (level after the
// round's first state), entered (level in force before it, from the round before), played (highest level in force
// from the round's first state to the first lives lost; the controller drops at the first read of a round, so the
// level it entered at doesn't count), logged_at_loss
// (logged speed then), caps, game_s, logged_s, replay_s}], timed: whether the log has speed_set records}.
// states: replayStates(records).
// tickMs (the fine replay): the controller's clock is the replayed time, it is also observed every tickMs of it between
// states (the session reads every 250 ms), and the logged danger signals are added to those from the states.
export const FINE_TICK_MS = 250;
export function replaySpeed(records, states, {calibrated = true, hard = null, buying = true, options = {}, max = 10, buyingMs = BUYING_MS, tickMs = null} = {}) {
 const lost = new Map(roundsOf(records).map(r => [r.round, r.lost]));
 let t = 0;
 const control = gradedSpeed({max, now: () => t, calibrated, hard, options});
 const rounds = new Map();
 const row = n => {
  if (!rounds.has(n)) rounds.set(n, {round: n, lost: lost.get(n) ?? 0, start: null, played: null, logged_at_loss: null, lossSeen: false, caps: new Set(),
   byLevel: {}, game_s: 0, logged_s: 0, replay_s: 0, livesAtStart: null});
  return rounds.get(n);
 };
 let lastDecision = null, lastDecisionAt = -Infinity, prev = null, prevDanger = [], clock = states[0]?.at ?? 0;
 for (const e of states) {
  const {state, at} = e;
  t = at;
  const n = state.round.number, r = row(n);
  // The time since the last state ran at the logged speed and at the level then in force.
  if (prev && control.speed != null && prev.speed != null) {
   const dt = (at - prev.at) / 1000, p = rounds.get(prev.state.round.number);
   p.logged_s += dt;
   let game = dt * prev.speed;
   while (game > 1e-9) {
    const part = tickMs ? Math.min(game, tickMs / 1000 * control.speed) : game;
    p.game_s += part; p.replay_s += part / control.speed; clock += part / control.speed * 1000;
    p.byLevel[control.speed] = (p.byLevel[control.speed] ?? 0) + part;
    game -= part;
    if (!tickMs || game <= 1e-9) break;
    t = clock;
    control.observe(prev.state, {margins: prev.margins, danger: prevDanger, buying: buying && buyingNow(lastDecision, lastDecisionAt, t, {buyingMs})});
    for (const c of control.caps) p.caps.add(c);
    if (!p.lossSeen) p.played = Math.max(p.played ?? 0, control.speed);
   }
  } else if (prev) clock += at - prev.at;
  if (tickMs) t = clock;
  const entering = control.speed;
  r.livesAtStart ??= state.lives;
  const livesLost = Math.max(state.round.lives_lost ?? 0, r.livesAtStart - state.lives);
  const danger = [...new Set([...(livesLost > 0 ? ['lives_lost'] : []), ...(e.short ? ['moab_short'] : []), ...(tickMs ? e.logged ?? [] : [])])];
  prevDanger = danger;
  control.observe(state, {margins: e.margins, danger, buying: buying && buyingNow(lastDecision, lastDecisionAt, t, {buyingMs})});
  for (const c of control.caps) r.caps.add(c);
  if (r.start == null) Object.assign(r, {start: control.speed, entered: entering, played: control.speed});
  if (livesLost > 0 && !r.lossSeen) { r.lossSeen = true; r.played = Math.max(r.played, entering ?? 0); r.logged_at_loss = prev?.speed ?? null; }
  else if (!r.lossSeen) r.played = Math.max(r.played, control.speed);
  if (e.decision) { lastDecision = e.decision; lastDecisionAt = t; }
  prev = e;
 }
 const out = [...rounds.values()].sort((a, b) => a.round - b.round).map(r => {
  const level = Object.entries(r.byLevel).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {round: r.round, lost: r.lost, level: level == null ? r.start : Number(level), start: r.start, entered: r.entered ?? null, played: r.played, logged_at_loss: r.logged_at_loss,
   caps: [...r.caps], game_s: +r.game_s.toFixed(1), logged_s: +r.logged_s.toFixed(1), replay_s: +r.replay_s.toFixed(1)};
 });
 return {rounds: out, timed: states.some(e => e.speed != null)};
}

// Totals over runs ([{name, timed, rounds}]): lost rounds by the level they would have been played at, minutes
// (runs with speed_set records), and the share of game time and of rounds at each level.
export function summarize(runs) {
 const lostRounds = runs.flatMap(r => r.rounds.filter(x => x.lost > 0).map(x => ({run: r.name, ...x})));
 const timed = runs.filter(r => r.timed);
 const sum = (list, k) => list.reduce((n, x) => n + x[k], 0);
 const minutes = k => +(timed.reduce((n, r) => n + sum(r.rounds, k), 0) / 60).toFixed(1);
 const game = {}, count = {};
 for (const r of timed) for (const x of r.rounds) { game[x.level] = (game[x.level] ?? 0) + x.game_s; count[x.level] = (count[x.level] ?? 0) + 1; }
 const share = map => { const all = Object.values(map).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(map).sort((a, b) => b[0] - a[0]).map(([k, v]) => [k, +(v / all).toFixed(2)])); };
 const byPlayed = {};
 for (const x of lostRounds) byPlayed[x.played] = (byPlayed[x.played] ?? 0) + 1;
 return {runs: runs.length, timed_runs: timed.length, lost_rounds: lostRounds.length, lost_by_level: byPlayed,
  // The safety rule: rounds that lost more than 5 lives played above 3, and rounds that lost lives played at 5 or more.
  big_above_3: lostRounds.filter(x => x.lost > 5 && x.played > 3).map(x => `${x.run.slice(11, 19)} r${x.round}`),
  lost_at_5: lostRounds.filter(x => x.played >= 5).map(x => `${x.run.slice(11, 19)} r${x.round}`),
  lost_at_max: lostRounds.filter(x => x.played >= 10).map(x => `${x.run.slice(11, 19)} r${x.round}`),
  lost_entered_at_max: lostRounds.filter(x => x.entered >= 10 && x.played < 10).length,
  logged_min: minutes('logged_s'), replay_min: minutes('replay_s'), game_share: share(game), round_share: share(count)};
}

export function formatSummary(name, s) {
 const pct = m => Object.entries(m).map(([k, v]) => `${k}x ${Math.round(v * 100)}%`).join(', ');
 return [`${name}: lost rounds ${s.lost_rounds}, by level played ${Object.entries(s.lost_by_level).map(([k, v]) => `${k}x ${v}`).join(', ')}` +
  `${s.lost_at_max.length ? ` (at 10x: ${s.lost_at_max.join(', ')})` : ''}; entered at 10x from the round before: ${s.lost_entered_at_max}`,
  `  safety: rounds losing more than 5 lives played above 3: ${s.big_above_3.join(', ') || 'none'}; rounds losing lives at 5 or 10: ${s.lost_at_5.join(', ') || 'none'}`,
  `  minutes over ${s.timed_runs} timed runs: logged ${s.logged_min}, replayed ${s.replay_min}; game time ${pct(s.game_share)}; rounds ${pct(s.round_share)}`].join('\n');
}

// Where a graded run's time below its maximum went, from its executed speed_set records (--causes). Between two records
// the game ran at the logged speed s; the limit L is what the controller allowed then (the drop's target, or for a step
// up the margin's level and the caps). The wall time lost against the maximum splits into the climb, dt(1 - s/L), and
// the limit's cause, dt(s/L)(1 - L/max). Causes: the danger signals of a drop (leak_pressure when it is among them,
// else the first), the caps that set L, or margin. Records the keeper sends (round_start, resend) don't change it.
export const CAP_SPEEDS = {hard_round: 3, end_rounds: 3, hard_round_next: 5, cooldown: 5, buying: 5, moab_class: 5, rbe_spike: 5, no_moab_estimate: 5};
const marginCause = limit => `margin_${['below_1.0', '', 'below_1.3'][limit - 1] ?? 'below_2.0'}`;
const dangerCause = d => d.includes('leak_pressure') ? 'leak_pressure' : d.includes('lives_lost') ? 'lives_lost' : d[0].startsWith('bloons_past') ? 'bloons_past' : d[0];
export function speedCauses(records) {
 const start = records.find(r => r.kind === 'session_start');
 const max = Number(/^graded:(\d+)/.exec(start?.speed ?? '')?.[1]);
 if (!max) return null;
 const moabShort = Number(/\+moab(\d)/.exec(start.speed)?.[1] ?? 1), floor = Number(/\+min(\d)/.exec(start.speed)?.[1] ?? MIN_SPEED);
 const end = records.find(r => r.kind === 'run_end') ?? records.at(-1);
 const sets = records.filter(r => r.kind === 'speed_set' && r.status === 'executed' && !/^(round_start|resend)/.test(r.reason ?? ''));
 const lost = new Map(roundsOf(records).map(r => [r.round, r.lost]));
 const out = {max, label: start.speed, minutes: 0, at: {}, climb: 0, causes: {}, drops: []};
 const add = (map, k, v) => { map[k] = (map[k] ?? 0) + v; };
 sets.forEach((r, i) => {
  const dt = (Date.parse(sets[i + 1]?.time ?? end.time) - Date.parse(r.time)) / 1000;
  if (!(dt > 0)) return;
  const s = r.speed, danger = r.danger ?? [], hard = danger.filter(d => d !== 'moab_short');
  const grade = gradeFor(r.margins?.margin ?? null, max), capAt = Math.min(...(r.cap ?? []).map(c => CAP_SPEEDS[c] ?? max), max);
  let limit, cause;
  if (hard.length) [limit, cause] = [floor, dangerCause(hard)];
  else if (/^drop/.test(r.reason) || /^(match_start|start)/.test(r.reason)) [limit, cause] = [s, danger.length ? 'moab_short' : r.cap?.length ? r.cap.join('+') : r.margins?.margin == null ? 'margin_unknown' : marginCause(s)];
  else {
   limit = Math.max(floor, Math.min(grade, capAt, danger.length ? moabShort : max));
   cause = danger.length && moabShort <= Math.min(grade, capAt) ? 'moab_short' : capAt < grade ? r.cap.join('+') : r.margins?.margin == null ? 'margin_unknown' : marginCause(grade);
  }
  limit = Math.max(limit, s);
  if (/^drop/.test(r.reason) && hard.length) out.drops.push({round: r.round, from: sets[i - 1]?.speed ?? null, danger: hard, lost: lost.get(r.round) ?? 0});
  out.minutes += dt / 60;
  add(out.at, s, dt / 60);
  out.climb += dt * (1 - s / limit) / 60;
  if (limit < max) add(out.causes, cause, dt * (s / limit) * (1 - limit / max) / 60);
 });
 return out;
}

// A speed floor on a logged match (--floor <n>, --min-speed's estimate): the match's time at each observed speed (run_end
// speed_time.seconds, the session's speedClock), with every speed below the floor played at the floor instead and the game
// time of each stretch unchanged, so t seconds at speed s < floor become t * s / floor. Levels at or above the floor keep
// their time. Returns {label, mode, result, minutes, floor_minutes, seconds (as logged), game_share: {speed: share of game time}}, or null
// without speed_time.
export function floorEstimate(records, floor) {
 const start = records.find(r => r.kind === 'session_start'), end = records.find(r => r.kind === 'run_end');
 const seconds = end?.speed_time?.seconds;
 if (!seconds) return null;
 const at = Object.entries(seconds).map(([speed, t]) => [Number(speed), t]);
 const game = at.reduce((n, [speed, t]) => n + speed * t, 0);
 return {label: start?.speed ?? null, mode: start?.setup?.mode ?? null, result: end.result ?? null,
  minutes: at.reduce((n, [, t]) => n + t, 0) / 60, floor_minutes: at.reduce((n, [speed, t]) => n + (speed < floor ? t * speed / floor : t), 0) / 60,
  seconds, game_share: Object.fromEntries(at.map(([speed, t]) => [speed, game > 0 ? speed * t / game : 0]))};
}

// The --floor report: per match, the logged minutes against the minutes with the floor; for all of them, the shares of real
// and game time at each logged speed.
export function formatFloor(runs, floor) {
 const f = x => x.toFixed(1), p = x => `${(100 * x).toFixed(0)}%`, lines = [], real = {}, game = {};
 let minutes = 0, floored = 0;
 for (const {name, e} of runs) {
  minutes += e.minutes; floored += e.floor_minutes;
  for (const [speed, t] of Object.entries(e.seconds)) { real[speed] = (real[speed] ?? 0) + t; game[speed] = (game[speed] ?? 0) + t * Number(speed); }
  lines.push(`${name.slice(0, 19)} ${e.mode} ${e.result}: ${f(e.minutes)} min logged, ${f(e.floor_minutes)} min with floor ${floor}`);
 }
 const n = runs.length || 1, sum = map => Object.values(map).reduce((x, y) => x + y, 0) || 1;
 const shares = map => Object.entries(map).sort((x, y) => x[0] - y[0]).map(([speed, t]) => `${speed}x ${p(t / sum(map))}`).join(', ');
 lines.push('', `${runs.length} matches: ${f(minutes)} min logged (${f(minutes / n)} per match), ${f(floored)} min with floor ${floor} (${f(floored / n)} per match${minutes > 0 ? `, ${p(1 - floored / minutes)} less` : ""})`,
  `real time: ${shares(real)}`, `game time: ${shares(game)}`);
 return lines.join('\n');
}

// The --causes report: per run and per speed label, minutes lost per cause, and the danger drops by the speed they came from
// and whether the round then lost lives.
export function formatCauses(runs) {
 const f = x => x.toFixed(2), lines = [], groups = {};
 const top = map => Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f(v)}`).join(', ');
 for (const {name, c} of runs) {
  const g = groups[c.label] ??= {n: 0, minutes: 0, climb: 0, causes: {}, at: {}, drops: []};
  g.n++; g.minutes += c.minutes; g.climb += c.climb; g.drops.push(...c.drops);
  for (const [k, v] of Object.entries(c.causes)) g.causes[k] = (g.causes[k] ?? 0) + v;
  for (const [k, v] of Object.entries(c.at)) g.at[k] = (g.at[k] ?? 0) + v;
  lines.push(`${name.slice(0, 19)} ${c.label}: ${f(c.minutes)} min, lost against ${c.max}x: climb ${f(c.climb)}, ${top(c.causes)}`);
 }
 for (const [label, g] of Object.entries(groups)) {
  const out = {};
  for (const d of g.drops) for (const k of new Set(d.danger.map(x => x.startsWith('bloons_past') ? 'bloons_past' : x))) {
   const key = `${k} from ${d.from}x`;
   out[key] ??= {none: 0, '1-5': 0, '>5': 0};
   out[key][d.lost > 5 ? '>5' : d.lost > 0 ? '1-5' : 'none']++;
  }
  lines.push('', `${label}: ${g.n} runs, ${f(g.minutes)} min (${Object.entries(g.at).map(([k, v]) => `${k}x ${f(v)}`).join(', ')})`,
   `  per match, minutes lost against the maximum: climb ${f(g.climb / g.n)}, ${top(Object.fromEntries(Object.entries(g.causes).map(([k, v]) => [k, v / g.n])))}`,
   `  danger drops (${g.drops.length}) by signal and speed before, rounds then losing no lives / 1-5 / more than 5:`,
   ...Object.entries(out).sort().map(([k, v]) => `   ${k}: ${v.none} / ${v['1-5']} / ${v['>5']}`));
 }
 return lines.join('\n');
}

// The hard list for one run: the round data and the lost rounds of the other runs (leave-one-out), or of every run.
// logRuns: 'all', or 'current' for the log rounds of current-era runs only (hard-rounds.mjs currentEra).
// data: false keeps only the log rounds.
export function hardFor(all, name, setup, {logs = true, data = true, minRuns = 1, minLives = Infinity, leaveOneOut = true, logRuns = 'all'} = {}) {
 const file = buildHardRounds(all.filter(r => !leaveOneOut || r.name !== name), {logRuns});
 const list = hardRoundsFor(setup, {file});
 const kept = !logs ? withoutLogs(list) : minRuns > 1 ? withoutLogs(list, {minRuns, minLives}) : list;
 if (data) return kept;
 const rounds = new Map([...kept.rounds].map(([n, r]) => [n, r.filter(x => x.startsWith('lost:'))]).filter(([, r]) => r.length));
 return {...kept, rounds};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const dir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs'));
 const calibrationDir = resolve(flag('--calibration') ?? join(root, '.private/btd6/calibration'));
 let logs;
 try { logs = readRuns(dir, flag('--runs')); } catch (error) { console.error(`Can't read the run logs in ${dir}: ${error.message}`); process.exit(2); }
 const all = logs.filter(r => r.records.some(x => x.kind === 'session_start' && x.setup?.map));
 if (argv.includes('--floor')) {
  // --floor <n> [--since <ISO time>] [--mode <setup mode>]: floorEstimate over the matches with a run_end.
  const floor = Number(flag('--floor')), since = flag('--since') ? Date.parse(flag('--since')) : -Infinity, mode = flag('--mode');
  const runs = all.filter(r => Date.parse(r.records.find(x => x.kind === 'session_start').time) >= since)
   .map(r => ({name: r.name, e: floorEstimate(r.records, floor)})).filter(r => r.e && (!mode || r.e.mode === mode));
  console.log(formatFloor(runs, floor));
  process.exit(0);
 }
 if (argv.includes('--causes')) {
  const runs = all.filter(r => !argv.includes('--current-era') || currentEra(r.records)).map(r => ({name: r.name, c: speedCauses(r.records)})).filter(r => r.c);
  console.log(formatCauses(runs));
  process.exit(0);
 }
 const names = flag('--variant') ? flag('--variant').split(',') : Object.keys(VARIANTS);
 for (const variant of names) if (!VARIANTS[variant]) { console.error(`No variant ${variant}; the variants are ${Object.keys(VARIANTS).join(', ')}.`); process.exit(2); }
 // Each run at the factors it was played with (session_start), or the setup's stored ones.
 const prepared = [], fine = argv.includes('--fine');
 for (const {name, records} of all) {
  const start = records.find(r => r.kind === 'session_start');
  if (!records.some(r => r.kind === 'decision' && r.state?.in_game)) continue;
  const cal = start.calibration ?? {}, stored = await loadCalibration(calibrationDir, start.setup);
  setMoabCalibration(cal.moab?.factor ?? stored.factor);
  setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
  if (argv.includes('--current-era') && !currentEra(records)) continue;
  const paths = pathsFor(start.setup.map), camo = names.some(n => VARIANTS[n].camo);
  prepared.push({name, records, start, stored, states: replayStates(records, {paths, speedPoints: fine}), ...(camo ? {camoStates: replayStates(records, {paths, speedPoints: fine, camo: true})} : {})});
 }
 const results = {};
 for (const variant of names) {
  const v = VARIANTS[variant];
  const runs = [];
  for (const {name, records, start, stored, states: plain, camoStates} of prepared) {
   const states = v.camo ? camoStates : plain;
   const hard = v.hard ? hardFor(all, name, start.setup, {logs: v.logs !== false, data: v.data !== false, minRuns: v.minRuns ?? 1, minLives: v.minLives ?? Infinity, logRuns: v.logRuns ?? 'all', leaveOneOut: !argv.includes('--all-logs')}) : null;
   const r = replaySpeed(records, states, {calibrated: argv.includes('--interim') ? false : stored.runs > 0, hard, buying: v.buying, buyingMs: v.buyingMs ?? BUYING_MS, options: v.options, tickMs: fine ? FINE_TICK_MS : null});
   runs.push({name, setup: setupKey(start.setup), ...r});
  }
  results[variant] = {summary: summarize(runs), runs};
 }
 if (argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
 else {
  console.log(`Graded speed replay over ${Object.values(results)[0]?.runs.length ?? 0} runs${argv.includes('--all-logs') ? '' : ' (hard rounds leave-one-out)'}.`);
  for (const [variant, {summary}] of Object.entries(results)) console.log(formatSummary(variant, summary));
  if (argv.includes('--rounds')) for (const [variant, {runs}] of Object.entries(results)) {
   console.log('', `${variant}: rounds with lives lost`, 'run | round | lives | logged speed at loss | level played | level for most of the round | caps');
   for (const r of runs) for (const x of r.rounds.filter(x => x.lost > 0))
    console.log([r.name.slice(11, 19), x.round, x.lost, x.logged_at_loss ?? '-', x.played, x.level, x.caps.join('+') || '-'].join(' | '));
  }
 }
}
