// Game speed for runs (bridge 0.3.4, set_speed). A speed is one number: 1 is normal speed (fast-forward
// off), 3 is fast-forward at the game's own rate, and any other value from 1 to 10 is fast-forward with
// that time scale (the bridge's multiplier). A run's --speed is a fixed speed or adaptive (below).
import {readFileSync} from 'node:fs';
import {camoCheck, roundCheck, roundFacts} from './estimate.mjs';
import {MOAB_SPEED, RELATIVE_SPEED, innerMoabHealth, innerDdtHealth, isMoabClass, moabCheck, moabDps, ddtCheckOn, trackLength} from './moab.mjs';
import {parseBloon} from './data/generate.mjs';

export const GAME_FAST_FORWARD = 3;
export const MIN_SPEED = 1, MAX_SPEED = 10;
// Jev-only runs play at the game's fast-forward.
export const JEV_SPEED = GAME_FAST_FORWARD;

// Seconds after a round starts in which a change to the speed is taken as the game's reset, not a person's.
export const ROUND_RESET_MS = 3000;
// A target the game hasn't taken yet is sent again at most this often (speedKeeper).
export const RESEND_MS = 500;

export function parseSpeed(raw) {
 const speed = Number(raw);
 if (raw == null || raw === '' || !Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED)
  throw Error(`The speed must be a number from ${MIN_SPEED} to ${MAX_SPEED} (1 is normal speed, 3 the game's fast-forward).`);
 return speed;
}

// The set_speed command for a match. At 1 and 3 the multiplier is left out, so the bridge returns the
// fast-forward time scale to the game's default.
export function speedCommand(state, speed, commandId) {
 if (!state?.in_game) throw Error('Not in a match.');
 const fast = speed > MIN_SPEED;
 return {command_id: commandId, action: 'set_speed', fast_forward: fast, ...(fast && speed !== GAME_FAST_FORWARD ? {multiplier: speed} : {}),
  expect: {match_id: state.match.id}};
}

// The speed a state shows, or null when it doesn't say (not in a match, or a bridge before 0.3.4 without a multiplier).
export function observedSpeed(state) {
 if (!state?.in_game || typeof state.fast_forward !== 'boolean') return null;
 if (!state.fast_forward) return MIN_SPEED;
 return Number.isFinite(state.multiplier) ? state.multiplier : GAME_FAST_FORWARD;
}

// Keeps a run at its speed without fighting a person. observe(state) returns {reapply} when the speed
// differs from the target at a round start (or within ROUND_RESET_MS of it), once per round, and
// {warning} when it changed during a round: from then on the runner leaves the speed alone. After a
// set_speed is sent, applied() lets the next readings catch up without counting as a change.
// Pending target: from a retarget (or the start, or a round-start reapply) until a set_speed for it executes,
// the target is pending. While it is pending and the game shows another speed, observe() returns {resend} once
// no screen is open over the match and the game isn't paused, at most every RESEND_MS, so a set_speed refused
// with game_paused (a Level Up screen at a round start) or failed is sent again once the game can take it.
// A pending target is the runner's own, so the speed not matching it is never taken as a person's change.
// (2026-09-30, run 08-39-43: 10 -> 5 was refused at round 49 behind a Level Up screen, nothing resent it, and
// the round played at 10x until leak pressure forced 1x; lives went from 98 to 32.)
export function speedKeeper(target, {now = Date.now, resetMs = ROUND_RESET_MS, resendMs = RESEND_MS} = {}) {
 const k = {target, match: null, round: null, roundAt: 0, seen: null, settling: false, reappliedRound: null, yielded: false, pending: target != null, sentAt: -Infinity};
 k.applied = () => { k.settling = true; k.pending = false; };
 // Called when a set_speed is sent, whatever its result.
 k.sent = () => { k.sentAt = now(); };
 // A new target (adaptive or graded speed); the set_speed that follows calls applied() once it executes.
 k.retarget = speed => { k.target = speed; k.pending = true; };
 k.observe = s => {
  const speed = observedSpeed(s);
  const target = k.target;
  if (target == null || speed == null || s.match.result) return {};
  if (s.match.id !== k.match) Object.assign(k, {match: s.match.id, round: s.round.number, roundAt: now(), seen: speed, reappliedRound: null, yielded: false});
  const roundStarted = s.round.number !== k.round;
  if (roundStarted) Object.assign(k, {round: s.round.number, roundAt: now()});
  const previous = k.seen;
  k.seen = speed;
  if (k.settling) {
   if (speed === target) k.settling = false;
   else if (!roundStarted) return {};
  }
  if (k.yielded) return {};
  if (speed === target) { k.pending = false; return {}; }
  if (k.pending) {
   if (s.popup || s.paused || now() - k.sentAt < resendMs) return {};
   return {resend: true, observed: speed};
  }
  const nearRoundStart = now() - k.roundAt <= resetMs;
  if (speed !== previous && !nearRoundStart && !k.settling) {
   k.yielded = true;
   return {warning: `The game speed changed from ${previous} to ${speed} during round ${s.round.number}; the runner had set ${target}. The runner leaves it as it is.`};
  }
  if ((roundStarted || nearRoundStart) && k.reappliedRound !== s.round.number) {
   k.reappliedRound = s.round.number;
   k.pending = true;
   return {reapply: true, observed: speed};
  }
  return {};
 };
 return k;
}

// Adaptive speed: the runner plays at a cruise speed and drops to a pressure speed while something needs
// resolving, the way a person uses fast-forward. --speed adaptive[:cruise/pressure]; pressure is 1
// (fast-forward off) or 3, cruise 3 to 10. The game is never paused.
// The default mode is graded (below).
export const DEFAULT_SPEED_MODE = 'graded:10';
export const PRESSURE_SPEEDS = [MIN_SPEED, GAME_FAST_FORWARD];
export const MIN_CRUISE = GAME_FAST_FORWARD;
// The furthest bloon's share of the path past which the runner slows down.
export const SLOW_PROGRESS = 0.5;
// Strategist consults (triggers-v1.mjs) that slow the game while their request is open.
export const SLOW_CONSULTS = ['threat_ahead', 'big_leak', 'moab_window'];

// A --speed value as a mode: {mode: 'fixed', speed, label} or {mode: 'adaptive', cruise, pressure, label}.
// The label is what run_start and series.jsonl record: the number for a fixed speed, "adaptive:5/1" otherwise.
export function parseSpeedMode(raw) {
 if (typeof raw === 'string' && raw.startsWith('graded')) {
  const m = /^graded(?::(\d+(?:\.\d+)?))?$/.exec(raw);
  if (!m) throw Error('Graded speed is written graded or graded:<max>, for example graded:10.');
  const max = m[1] == null ? MAX_SPEED : Number(m[1]);
  if (!(max >= GAME_FAST_FORWARD && max <= MAX_SPEED)) throw Error(`The graded maximum must be from ${GAME_FAST_FORWARD} to ${MAX_SPEED}; got ${max}.`);
  return {mode: 'graded', max, levels: gradedLevels(max), label: `graded:${max}`};
 }
 if (typeof raw === 'string' && raw.startsWith('adaptive')) {
  const m = /^adaptive(?::(\d+(?:\.\d+)?)\/(\d+))?$/.exec(raw);
  if (!m) throw Error('Adaptive speed is written adaptive or adaptive:<cruise>/<pressure>, for example adaptive:5/1.');
  const cruise = m[1] == null ? 5 : Number(m[1]), pressure = m[2] == null ? 1 : Number(m[2]);
  if (!PRESSURE_SPEEDS.includes(pressure)) throw Error(`The pressure speed must be 1 (fast-forward off) or 3; got ${pressure}.`);
  if (!(cruise >= MIN_CRUISE && cruise <= MAX_SPEED)) throw Error(`The cruise speed must be from ${MIN_CRUISE} to ${MAX_SPEED}; got ${cruise}.`);
  return {mode: 'adaptive', cruise, pressure, label: `adaptive:${cruise}/${pressure}`};
 }
 const speed = parseSpeed(raw);
 return {mode: 'fixed', speed, label: speed};
}

// A session's speed option as a mode: null (leave the speed alone), a number, a --speed string, or a mode.
export function speedMode(value) {
 if (value == null) return null;
 if (typeof value === 'object') return value;
 return parseSpeedMode(String(value));
}

// Between-rounds mode (--between-rounds): auto-start off, purchases while no round runs, each round started
// by the runner. Its runs are their own series, so the mode's label carries it: "graded:10+between-rounds".
export const BETWEEN_ROUNDS_SUFFIX = '+between-rounds';
export const withBetweenRounds = mode => ({...mode, betweenRounds: true, label: `${mode.label}${BETWEEN_ROUNDS_SUFFIX}`});

// Threat rounds from data/rounds.json (standard round set): the first Camo, Purple, Lead and Fortified
// rounds, and every round with a MOAB-class bloon. {round: [ids]}.
const MOAB_CLASS = /^(Moab|Bfb|Zomg|Ddt|Bad)/;
const FIRST_THREATS = {Camo: 'camo', Purple: 'purple', Lead: 'lead', Fortified: 'fortified'};
const ROUND_DATA = JSON.parse(readFileSync(new URL('./data/rounds.json', import.meta.url), 'utf8')).rounds;
export const THREAT_ROUNDS = Object.fromEntries(Object.entries(ROUND_DATA).map(([round, r]) =>
 [round, [...(r.first ?? []).map(b => FIRST_THREATS[b]).filter(Boolean), ...(Object.keys(r.bloons).some(b => MOAB_CLASS.test(b)) ? ['moab_class'] : [])]])
 .filter(([, ids]) => ids.length));

// The slow-down triggers active in a state, as names; empty when none. context: {livesLost: lives lost this
// round, pressure: v3's leak pressure (policy-v3.mjs pressureTracker status), moabShort: v4's moab_short
// (policy-v4.mjs) is active, consult: the reason of the open strategist request, or null}.
export function speedTriggers(state, {livesLost = 0, pressure = null, moabShort = false, consult = null} = {}) {
 if (!state?.in_game || state.match.result) return [];
 const b = state.bloons ?? {};
 const out = [];
 if (livesLost > 0) out.push('lives_lost');
 if ((b.count ?? 0) > 0 && (b.furthest ?? 0) > SLOW_PROGRESS) out.push('bloons_past_half');
 if ((b.moab_class ?? 0) > 0) out.push('moab_present');
 const threats = THREAT_ROUNDS[state.round.number];
 if (threats) out.push(`threat_round:${threats.join('+')}`);
 if (pressure?.active) out.push('leak_pressure');
 if (moabShort) out.push('moab_short');
 if (consult && SLOW_CONSULTS.includes(consult)) out.push(`consult:${consult}`);
 return out;
}

// The adaptive controller. observe(state, triggers) returns {speed, reason} when the speed should change,
// else null. It starts at cruise. Any trigger slows it to pressure, which lasts at least to the end of the
// round; a round that ends with no lives lost and no trigger active brings it back to cruise. It changes at
// most once per round in each direction, except that lives being lost always slow it down.
export function adaptiveSpeed({cruise, pressure}) {
 const c = {speed: cruise, match: null, round: null, active: false, closed: null, lastLives: null, lostInRound: 0, slowedIn: null, spedIn: null};
 c.observe = (s, triggers = []) => {
  if (!s?.in_game || s.match.result) return null;
  if (s.match.id !== c.match) Object.assign(c, {match: s.match.id, speed: cruise, round: s.round.number, active: Boolean(s.round.active), closed: null,
   lastLives: s.lives, lostInRound: 0, slowedIn: null, spedIn: null});
  const losing = c.lastLives != null && s.lives < c.lastLives;
  if (losing) c.lostInRound += c.lastLives - s.lives;
  c.lastLives = s.lives;
  // A round ends when it stops running or the round number moves on (automatic start); once per round.
  const moved = s.round.number !== c.round, stopped = c.active && !s.round.active;
  const ended = (moved || stopped) && c.closed !== c.round ? c.round : null;
  const lostInEnded = c.lostInRound;
  if (ended != null) Object.assign(c, {closed: ended, lostInRound: 0});
  Object.assign(c, {round: s.round.number, active: Boolean(s.round.active)});
  if (cruise === pressure) return null;
  if (c.speed === pressure) {
   if (ended == null || lostInEnded > 0 || triggers.length || c.spedIn === ended) return null;
   Object.assign(c, {speed: cruise, spedIn: ended});
   return {speed: cruise, reason: `round ${ended} ended with no lives lost and no trigger active`};
  }
  if (!triggers.length || (c.slowedIn === c.round && !losing)) return null;
  Object.assign(c, {speed: pressure, slowedIn: c.round});
  return {speed: pressure, reason: triggers.join(', ')};
 };
 return c;
}

// Time at each speed, per round and for the match. observe(state) returns the record of a round that just
// ended ({round, seconds: {speed: s}, slow_s}), else null. slowAt: the speed counted as slow (the pressure
// speed in adaptive mode; null for a fixed speed). totals() is what run_end records.
export function speedClock({now = Date.now, slowAt = null} = {}) {
 const k = {match: null, round: null, at: null, speed: null, perRound: {}, total: {}};
 const add = (map, speed, s) => { if (speed != null && s > 0) map[speed] = +((map[speed] ?? 0) + s).toFixed(1); };
 const slow = map => slowAt == null ? null : +Object.entries(map).filter(([speed]) => Number(speed) <= slowAt).reduce((n, [, s]) => n + s, 0).toFixed(1);
 k.observe = s => {
  if (!s?.in_game) return null;
  const t = now();
  if (s.match.id !== k.match) Object.assign(k, {match: s.match.id, round: s.round.number, at: t, speed: null, perRound: {}, total: {}});
  const seconds = (t - k.at) / 1000;
  add(k.perRound, k.speed, seconds);
  add(k.total, k.speed, seconds);
  k.at = t;
  k.speed = s.match.result ? null : observedSpeed(s);
  if (s.round.number === k.round) return null;
  const record = {round: k.round, seconds: k.perRound, slow_s: slow(k.perRound)};
  Object.assign(k, {round: s.round.number, perRound: {}});
  return record;
 };
 k.totals = () => ({total_s: +Object.values(k.total).reduce((n, s) => n + s, 0).toFixed(1), seconds: {...k.total}, slow_s: slow(k.total)});
 return k;
}

// Graded speed (--speed graded[:max], the default graded:10): the speed follows the defence's margin for
// the round being played or about to start, with a live safety net. The game is never paused.
//  - Predictive level, from the smaller of two margins: the v3 pops estimate against the round's RBE times
//    the margin for the lives left (estimate.mjs roundCheck with reach; a round with Camo or Lead that no
//    tower can pop counts as 0), and, in a MOAB-class round, the v4 MOAB damage per second against what the
//    round needs (moab.mjs moabCheck). A margin of at least 2.0 plays at max, 1.3 at 5, 1.0 at 3, below at 1.
//  - Cooldown: after a danger drop, at most CAPPED_SPEED for the rest of that round and the next COOLDOWN_ROUNDS
//    rounds; from round HIGH_SPEED_FROM_ROUND on, at most CAPPED_SPEED in a round without a MOAB estimate (speedCaps).
//  - Composition cap: while the setup's MOAB calibration is still the interim hypothesis (no measured run in
//    .private/btd6/calibration/), a round with MOAB-class bloons, or whose RBE is more than RBE_SPIKE times the
//    largest of the RBE_LOOKBACK rounds before it, plays at most at CAPPED_SPEED (compositionCap). A measured
//    calibration lifts it.
//  - Danger signals, each forcing 1: lives lost this round, the furthest bloon past the progress for the speed
//    being played (dangerProgress: 0.5 at 10, 0.6 at 5, 0.7 at 3 and below; a leak runs its course faster the
//    higher the speed, so the runner has to react earlier),
//    a MOAB-class bloon that would reach the exit before the towers kill it (moabOutrun), v3's leak
//    pressure, v4's moab_short, and for claude-v1 an open strategist consult (SLOW_CONSULTS).
//  - Drops are immediate. Speeding up goes one level at a time, at most once every STEP_UP_MS of real
//    time since the last change, and only while no danger signal is active.
export const GRADE_AT = [[2.0, 'max'], [1.3, 5], [1.0, 3]];
// With the camo margin (--camo-margin, label +camo): defenceMargins' pops part is the smaller of the round's margin and
// its camo margin (estimate.mjs camoCheck), on a lower scale. These thresholds keep the same shares of clean rounds at
// or above each level as GRADE_AT on the margin without it (pops-study.mjs --thresholds; docs/PLAN.md).
export const GRADE_AT_CAMO = [[1.82, 'max'], [1.17, 5], [0.88, 3]];
export const DANGER_PROGRESS = 0.7;
// The furthest-bloon threshold by the speed being played: [speed at or above, progress].
export const DANGER_PROGRESS_AT = [[10, 0.5], [5, 0.6]];
export const dangerProgress = speed => DANGER_PROGRESS_AT.find(([at]) => (speed ?? MIN_SPEED) >= at)?.[1] ?? DANGER_PROGRESS;
export const CAPPED_SPEED = 5, RBE_SPIKE = 1.5, RBE_LOOKBACK = 3;
const MOAB_BLOON = /^(Moab|Bfb|Zomg|Ddt|Bad)/;
// Why a round's speed is capped while the MOAB calibration is uncalibrated, or null: 'moab_class' (the round sends
// MOAB-class bloons) or 'rbe_spike' (its RBE is above RBE_SPIKE times the largest of the RBE_LOOKBACK rounds before).
export function compositionCap(round, {calibrated = false} = {}) {
 if (calibrated) return null;
 const r = roundFacts(round);
 if (!r) return null;
 if (Object.keys(r.bloons ?? {}).some(b => MOAB_BLOON.test(b))) return {speed: CAPPED_SPEED, reason: 'moab_class'};
 const before = [];
 for (let p = round - 1; p >= Math.max(1, round - RBE_LOOKBACK); p--) if (roundFacts(p)) before.push(roundFacts(p).rbe);
 if (before.length && r.rbe > RBE_SPIKE * Math.max(...before)) return {speed: CAPPED_SPEED, reason: 'rbe_spike'};
 return null;
}
// A MOAB-class bloon is in danger when time to kill x KILL_MARGIN exceeds its time to the exit.
export const KILL_MARGIN = 1.5;
export const STEP_UP_MS = 4000;
// Danger signals that also allow purchases during a round in between-rounds mode (the emergencies).
export const EMERGENCIES = ['lives_lost', 'bloons_past', 'moab_outrun', 'leak_pressure'];
// bloons_past_<p> names its threshold, so it matches by prefix.
export const isEmergency = d => EMERGENCIES.some(e => d === e || (e === 'bloons_past' && d.startsWith('bloons_past_')));

// The speeds graded mode uses, fastest first: max, then 5, 3 and 1 below it, none below the floor (minSpeed).
export const gradedLevels = (max, minSpeed = MIN_SPEED) => [max, ...[5, GAME_FAST_FORWARD, MIN_SPEED].filter(l => l < max && l >= minSpeed)];
// Graded speed's floor (--min-speed, label +min3): 1 (the default, no floor) or 3, the game's fast-forward.
export const MIN_SPEED_FLOORS = [MIN_SPEED, GAME_FAST_FORWARD];

// The level for a margin (null: unknown, played at 3).
export function gradeFor(margin, max, gradeAt = GRADE_AT) {
 if (margin == null || !Number.isFinite(margin)) return margin === Infinity ? max : Math.min(GAME_FAST_FORWARD, max);
 for (const [at, level] of gradeAt) if (margin >= at) return Math.min(level === 'max' ? max : level, max);
 return MIN_SPEED;
}

// The defence's margins for the round being played or about to start: {round, pops, moab, margin}. pops is
// null past the round data; moab is null in a round without MOAB-class bloons; margin is the smaller. camo
// (--camo-margin): pops is also no more than the camo margin (estimate.mjs camoCheck), returned as camo.
export function defenceMargins(state, paths = [], {camo = false} = {}) {
 const round = state.round.number, lives = state.lives;
 const c = roundCheck(state.towers, round, {lives, paths, useReach: true});
 const cm = camo && c ? camoCheck(state.towers, round, {lives, paths}) : null;
 const pops = c ? (c.camo === false || c.lead === false ? 0 : cm ? Math.min(c.ratio, cm.ratio) : c.ratio) : null;
 const m = moabCheck(state.towers, round, {lives, paths});
 const moab = m ? m.ratio : null;
 const known = [pops, moab].filter(v => v != null);
 return {round, pops, moab, margin: known.length ? Math.min(...known) : null, ...(camo ? {camo: cm?.ratio ?? null} : {})};
}

// The first MOAB-class bloon on the track (bridge 0.3.11 bloons.moabs, furthest first) that would reach the
// exit before the towers kill it, or null. The towers are taken to kill the bloons in order, so a bloon's
// time to kill counts the health left in it and in every bloon ahead of it, with the MOAB-class bloons inside
// each, at the towers' MOAB damage per second (moab.mjs moabDps, over the first half of the track). Time to
// exit is its track left at its speed (moab.mjs MOAB_SPEED and RELATIVE_SPEED). Both are in game seconds.
// With the DDT check (moab.mjs setDdtCheck, from btd6-jev-v6 revision 13), a DDT's health and the DDTs inside a BAD count
// at the DDT-capable damage (ddt_dps in the record when any did).
export function moabOutrun(state, paths = []) {
 const list = state.bloons?.moabs;
 if (!Array.isArray(list) || !list.length) return null;
 const dps = moabDps(state.towers, paths), length = trackLength(paths), ddt = ddtCheckOn();
 let ddtDps = null, health = 0, ddtHealth = 0;
 for (const b of [...list].sort((x, y) => y.progress - x.progress)) {
  let base;
  try { base = parseBloon(b.type).base; } catch { continue; }
  if (!isMoabClass(base)) continue;
  const own = Math.max(0, b.health ?? 0) + innerMoabHealth(base), part = !ddt ? 0 : base === 'Ddt' ? own : innerDdtHealth(base);
  health += own - part; ddtHealth += part;
  if (part > 0 && ddtDps == null) ddtDps = moabDps(state.towers, paths, {ddt: true});
  const exit = Math.max(0, 1 - b.progress) * length / (MOAB_SPEED * RELATIVE_SPEED[base]);
  const kill = (health > 0 ? (dps > 0 ? health / dps : Infinity) : 0) + (ddtHealth > 0 ? (ddtDps > 0 ? ddtHealth / ddtDps : Infinity) : 0)
   || (dps > 0 ? 0 : Infinity);
  if (kill * KILL_MARGIN > exit) return {type: b.type, progress: b.progress, exit_s: +exit.toFixed(1), kill_s: Number.isFinite(kill) ? +kill.toFixed(1) : null, dps, ...(ddtDps != null ? {ddt_dps: ddtDps} : {})};
 }
 return null;
}

// The danger signals active in a state, as names; empty when none. context as for speedTriggers, plus paths.
export function dangerSignals(state, {livesLost = 0, pressure = null, moabShort = false, consult = null, paths = []} = {}) {
 if (!state?.in_game || state.match.result) return [];
 const b = state.bloons ?? {};
 const out = [];
 if (livesLost > 0) out.push('lives_lost');
 const past = dangerProgress(observedSpeed(state));
 if ((b.count ?? 0) > 0 && (b.furthest ?? 0) > past) out.push(`bloons_past_${past}`);
 if (moabOutrun(state, paths)) out.push('moab_outrun');
 if (pressure?.active) out.push('leak_pressure');
 if (moabShort) out.push('moab_short');
 if (consult && SLOW_CONSULTS.includes(consult)) out.push(`consult:${consult}`);
 return out;
}

const marginText = m => m ? `margin ${m.margin ?? 'unknown'} for round ${m.round} (pops ${m.pops ?? '-'}, moab ${m.moab ?? '-'})` : 'no margin';

// The graded controller. observe(state, {margins, danger}) returns {speed, reason} when the speed should
// change, else null. margins: defenceMargins(state); danger: dangerSignals(state). The first observation
// of a match sets the level; after that, drops are immediate and speed-ups go one level at a time.
// calibrated: the setup has a measured MOAB calibration, which lifts the composition cap (compositionCap).
// The caps on a round's speed, each {speed, reason}; empty when none applies:
//  - moab_class / rbe_spike: compositionCap, while the MOAB calibration is interim;
//  - cooldown: for the COOLDOWN_ROUNDS rounds after one with a danger drop (and the rest of that round);
//  - no_moab_estimate: from HIGH_SPEED_FROM_ROUND on, a round without a MOAB estimate (no MOAB-class bloons) plays
//    at most at CAPPED_SPEED, since the pops estimate alone was 4.05 in round 51 of the third graded v5 run when 10x
//    lost 104 lives in about 2 s. Only with noMoabCap; graded speed has used the hard-round list instead since 2026-09-30 (speed-replay.mjs).
//  - hard_round: a round on the setup's hard-round list (hard-rounds.mjs) plays at most at HARD_SPEED;
//    hard_round_next: the HARD_LEAD rounds before one at most at HARD_LEAD_SPEED, so the round never starts at 10
//    (a set_speed refused at a round start is resent, speedKeeper) and purchases before it come at most 7 game
//    seconds apart. In the replay (speed-replay.mjs) a lead at 3 lost no fewer rounds than at 5 and took 6% longer.
//  - end_rounds: the last END_ROUNDS rounds of the match (to match.end_round) play at most at HARD_SPEED.
//  - buying: while the runner is buying (the last decision, less than BUYING_MS ago, was a purchase), at most at
//    BUYING_SPEED. After a purchase the next decision comes about 1.4 s later at any speed, which is 14 game
//    seconds at 10x; half the rounds played at 10x ended with a purchase still the last decision, against a quarter at 5x.
// dangerRound: the last round with a danger drop in this match, or null.
export const COOLDOWN_ROUNDS = 3, HIGH_SPEED_FROM_ROUND = 40;
export const HARD_SPEED = GAME_FAST_FORWARD, HARD_LEAD = 1, HARD_LEAD_SPEED = 5, END_ROUNDS = 6, BUYING_SPEED = 5, BUYING_MS = 3000;
// hard: {rounds: Map(round -> reasons)} (hard-rounds.mjs hardRoundsFor), or null for none.
export function speedCaps(round, {calibrated = false, dangerRound = null, margins = null, hard = null, endRound = null, buying = false, noMoabCap = false,
 hardLead = HARD_LEAD, hardSpeed = HARD_SPEED, hardLeadSpeed = HARD_LEAD_SPEED, endRounds = END_ROUNDS} = {}) {
 const caps = [];
 const comp = compositionCap(round, {calibrated});
 if (comp) caps.push(comp);
 if (dangerRound != null && round >= dangerRound && round <= dangerRound + COOLDOWN_ROUNDS) caps.push({speed: CAPPED_SPEED, reason: 'cooldown'});
 if (noMoabCap && round >= HIGH_SPEED_FROM_ROUND && margins?.moab == null) caps.push({speed: CAPPED_SPEED, reason: 'no_moab_estimate'});
 if (hard?.rounds?.has(round)) caps.push({speed: hardSpeed, reason: 'hard_round'});
 else if (hard?.rounds && Array.from({length: hardLead}, (_, i) => round + 1 + i).some(n => hard.rounds.has(n))) caps.push({speed: Math.max(hardLeadSpeed, hardSpeed), reason: 'hard_round_next'});
 if (endRound != null && round > endRound - endRounds) caps.push({speed: hardSpeed, reason: 'end_rounds'});
 if (buying) caps.push({speed: BUYING_SPEED, reason: 'buying'});
 return caps;
}

// Whether the runner is buying at time t (ms): the last decision record ({chosen, outcome}, core/runner.mjs), seen at
// time seenAt, was a purchase that went to the game less than BUYING_MS before.
export const isPurchase = d => /^(place|upgrade):/.test(d?.chosen?.id ?? '') && ['queued', 'executed'].includes(d?.outcome);
export const buyingNow = (last, seenAt, t, {buyingMs = BUYING_MS} = {}) => isPurchase(last) && t - seenAt < buyingMs;

// hard: the setup's hard rounds (speedCaps); options: the other speedCaps settings (the replay tries variants), and
// moabShortSpeed: the level when moab_short is the only danger signal (1 by default; the replay tries 3); gradeAt: the thresholds (GRADE_AT by default;
// GRADE_AT_CAMO with the camo margin); jumpHoldMs: speed up straight to the allowed level once no danger signal forcing 1 has shown, and the speed hasn't
// changed, for that long, instead of one level per stepUpMs (null by default; the replay tries it); stepUpMs: the step's delay.
// minSpeed: the floor (--min-speed; 1 by default). With 3, every level the controller sets is at least 3: a margin grade
// below it, the hard danger signals and consult slowdowns (which force 1 without it), moab_short and the start.
// Levels above the floor and the caps above it work as without it.
export function gradedSpeed({max, now = Date.now, stepUpMs = STEP_UP_MS, calibrated = false, hard = null, options = {}}) {
 const soft = options.moabShortSpeed > MIN_SPEED ? ['moab_short'] : [];
 const floor = Math.min(options.minSpeed ?? MIN_SPEED, max);
 const levels = gradedLevels(max, floor), jump = options.jumpHoldMs ?? null, step = options.stepUpMs ?? stepUpMs;
 const c = {speed: null, match: null, changedAt: -Infinity, dangerAt: -Infinity, dangerRound: null, caps: []};
 const set = (speed, reason, cap) => { Object.assign(c, {speed, changedAt: now()}); return {speed, reason, ...(cap.length ? {cap} : {})}; };
 c.observe = (s, {margins = null, danger = [], buying = false} = {}) => {
  if (!s?.in_game || s.match.result) return null;
  if (s.match.id !== c.match) Object.assign(c, {match: s.match.id, speed: null, changedAt: -Infinity, dangerAt: -Infinity, dangerRound: null});
  if (danger.length) c.dangerRound = s.round.number;
  const caps = speedCaps(s.round.number, {calibrated, dangerRound: c.dangerRound, margins, hard, endRound: s.match.end_round ?? null, buying, ...options});
  c.caps = caps.map(x => x.reason);
  const graded = gradeFor(margins?.margin ?? null, max, options.gradeAt);
  const limit = Math.max(floor, Math.min(graded, ...caps.map(x => x.speed)));
  // The caps that lower this round's speed, recorded in speed_set.
  const cap = limit < graded ? caps.filter(x => x.speed === limit).map(x => x.reason) : [];
  // Danger that forces the floor (1 without --min-speed), and moab_short alone when moabShortSpeed is set (at most that level).
  const hardDanger = danger.filter(d => !soft.includes(d));
  if (hardDanger.length) c.dangerAt = now();
  const target = Math.max(floor, hardDanger.length ? MIN_SPEED : danger.length ? Math.min(limit, options.moabShortSpeed) : limit);
  const lifted = floor > MIN_SPEED && target === floor && (hardDanger.length > 0 || graded < floor || (danger.length > 0 && options.moabShortSpeed < floor));
  const why = (danger.length ? danger.join(', ') : marginText(margins) + (cap.length ? `, cap ${limit}: ${cap.join('+')}` : '')) + (lifted ? `, floor ${floor}` : '');
  if (c.speed == null) return set(target, `start: ${why}`, danger.length ? [] : cap);
  if (target < c.speed) return set(target, `drop: ${why}`, danger.length ? [] : cap);
  if (target > c.speed && !hardDanger.length) {
   if (jump != null && now() - c.changedAt >= jump && now() - c.dangerAt >= jump) return set(target, `up: ${why}`, cap);
   if (jump == null && now() - c.changedAt >= step) return set(levels[levels.indexOf(c.speed) - 1] ?? target, `up: ${why}`, cap);
  }
  return null;
 };
 return c;
}
