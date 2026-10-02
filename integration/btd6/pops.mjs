// Measured pops (bridge 0.3.13: each tower's `pops`, the upgrade panel's count over the tower's life) against
// the runner's estimates, for later calibration. Logging only: nothing here changes a decision.
//  - pops_round: at each round's end, each tower's pops in that round (the count when the next round's number
//    is first seen, or at the match result, minus the count when the round's number was first seen; 0 at the
//    start for a tower placed during the round), next to the estimate for that tower and round (estimate.mjs:
//    towers.json's rate x the round's seconds x EFFICIENCY, `est` without and `est_reach` with the reach factor;
//    an unaimed point tower counts 0 in both), and the round's RBE. Round boundaries are those of the speed
//    clock (speed.mjs speedClock); the estimate uses the tower's tiers at the round's end. lives_lost: the lives
//    lost while the round was the current one (drops between reads), which pops-calibration.mjs needs: only a
//    round with lives lost measures the defence's capacity.
//  - aim_check: after each `aim` record, the tower's pops then and after AIM_CHECK_SECONDS of game time while a
//    round runs (real time between reads times the observed speed; paused reads don't count). A check still
//    open when the match ends, or whose tower is gone, is written with `complete: false`.
// A bridge older than 0.3.13 sends no pops: no records.
import {EFFICIENCY, effectivePps, roundFacts, roundSeconds, towerEstimate} from './estimate.mjs';
import {aimStatus} from './aim.mjs';
import {observedSpeed} from './speed.mjs';

export const AIM_CHECK_SECONDS = 10;

const hasPops = t => Number.isFinite(t.pops);

// Estimated pops for one tower over one round: {est, est_reach}, null values when towers.json lacks the tower.
export function towerRoundEstimate(t, round, paths = []) {
 const e = towerEstimate(t);
 if (!e) return {est: null, est_reach: null};
 const seconds = roundSeconds(round) * EFFICIENCY;
 if (aimStatus(t, paths).kind === 'unaimed') return {est: 0, est_reach: 0};
 return {est: Math.round(e.pps * seconds), est_reach: Math.round((effectivePps(t, paths) ?? 0) * seconds)};
}

export function popsTracker({paths = [], now = Date.now} = {}) {
 const k = {match: null, round: null, start: null, done: false, at: null, checks: [], lives: null, lost: 0};
 const snapshot = s => new Map(s.towers.filter(hasPops).map(t => [t.id, t.pops]));

 const roundRecord = (round, s, extra = {}) => {
  const towers = s.towers.filter(hasPops).map(t => {
   const pops = t.pops - (k.start.get(t.id) ?? 0);
   return {id: t.id, base_id: t.base_id, tiers: t.tiers, pops, ...towerRoundEstimate(t, round, paths)};
  });
  if (!towers.length) return null;
  const sum = key => towers.every(t => t[key] != null) ? towers.reduce((n, t) => n + t[key], 0) : null;
  return {kind: 'pops_round', round, rbe: roundFacts(round)?.rbe ?? null, pops: sum('pops'), est: sum('est'), est_reach: sum('est_reach'), lives_lost: k.lost, towers, ...extra};
 };
 const checkRecord = (c, pops, complete) => ({kind: 'aim_check', round: c.round, tower_id: c.tower_id, base_id: c.base_id, action: c.action,
  pops_at_aim: c.pops, pops_after: pops, gained: pops == null || c.pops == null ? null : pops - c.pops, game_seconds: +c.seconds.toFixed(1), complete});

 // Records to log for this state of the match.
 k.observe = s => {
  if (!s?.in_game) return [];
  const t = now(), out = [];
  if (s.match.id !== k.match) Object.assign(k, {match: s.match.id, round: s.round.number, start: snapshot(s), done: false, at: t, checks: [], lives: s.lives, lost: 0});
  // Lives lost since the last read belong to the round that was current then.
  if (!k.done && Number.isFinite(s.lives) && Number.isFinite(k.lives) && s.lives < k.lives) k.lost += k.lives - s.lives;
  if (Number.isFinite(s.lives)) k.lives = s.lives;
  // Aim checks: game time while a round runs.
  const dt = (t - k.at) / 1000;
  k.at = t;
  if (s.round.active && !s.paused && !s.match.result) for (const c of k.checks) c.seconds += dt * (observedSpeed(s) ?? 1);
  k.checks = k.checks.filter(c => {
   const tower = s.towers.find(x => x.id === c.tower_id);
   if (!tower) { out.push(checkRecord(c, null, false)); return false; }
   if (c.seconds >= AIM_CHECK_SECONDS) { out.push(checkRecord(c, tower.pops ?? null, true)); return false; }
   if (s.match.result) { out.push(checkRecord(c, tower.pops ?? null, false)); return false; }
   return true;
  });
  if (k.done) return out;
  if (s.match.result) {
   k.done = true;
   const r = roundRecord(k.round, s, {result: s.match.result});
   return r ? [...out, r] : out;
  }
  if (s.round.number !== k.round) {
   const r = roundRecord(k.round, s);
   if (r) out.push(r);
   Object.assign(k, {round: s.round.number, start: snapshot(s), lost: 0});
  }
  return out;
 };
 // After an `aim` record: s is the state the aim was decided on; d the aim step's details.
 k.aimed = (s, d) => {
  const tower = s?.in_game ? s.towers.find(x => x.id === d.tower_id) : null;
  if (!tower || !hasPops(tower)) return;
  k.checks.push({round: s.round.number, tower_id: d.tower_id, base_id: d.base_id, action: d.action, pops: tower.pops, seconds: 0});
 };
 // Checks still open when the session ends (no later state to measure against).
 k.finish = () => { const out = k.checks.map(c => checkRecord(c, null, false)); k.checks = []; return out; };
 return k;
}
