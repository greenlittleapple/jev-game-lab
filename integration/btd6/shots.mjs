// Screenshots of the game's own frame during a run (bridge 0.3.12, GET /api/v1/screenshot), so an operator can
// check afterwards what the runner saw, such as where a Dartling was firing. They are side actions: no Jev
// call, no command to the game. Saved as <dir>/<run>/<round>-<reason>.png, each with a `screenshot` record.
// When (observe, once per trigger):
//  - round_<n>: at the start of every SHOT_EVERY_ROUNDS-th round (10, 20, ...);
//  - leak: when lives are lost in a round, at most once per round;
//  - victory / defeat: when the victory or defeat screen is open;
//  - aim_<tower id>: after the runner finishes aiming a tower (request, from runner.mjs onAim).
// The bridge takes one shot per second; a shot that meets its limit, or any other error, waits in the queue
// and is tried again at the next observation, at most MAX_TRIES times, then logged as failed.
import {mkdir, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';

export const SHOT_EVERY_ROUNDS = 10;
export const SHOT_WIDTH = 960;
export const MAX_TRIES = 3;
const RETRY_MS = 1000;

// root: paths in the log are relative to it (the repository), so no user folder is written into a record.
export function shotKeeper({bridge, dir, log, root = dir, width = SHOT_WIDTH, now = Date.now}) {
 const k = {match: null, round: null, leakRound: null, lastLives: null, result: false, queue: [], lastTry: -Infinity, taken: []};
 const enqueue = (state, reason) => {
  if (!k.queue.some(q => q.reason === reason && q.match === state.match.id)) k.queue.push({match: state.match.id, round: state.round.number, reason, tries: 0});
 };
 k.request = (state, reason) => { if (state?.in_game) enqueue(state, reason); };
 // Queues what this state triggers, then takes the oldest queued shot if the bridge's limit allows.
 k.observe = async state => {
  if (state?.in_game) {
   if (state.match.id !== k.match) Object.assign(k, {match: state.match.id, round: null, leakRound: null, lastLives: null, result: false});
   const round = state.round.number;
   if (round !== k.round) {
    k.round = round;
    if (round % SHOT_EVERY_ROUNDS === 0 && !state.match.result) enqueue(state, `round_${round}`);
   }
   const lost = (state.round.lives_lost ?? 0) > 0 || (k.lastLives != null && state.lives < k.lastLives);
   if (lost && !state.match.result && k.leakRound !== round) { k.leakRound = round; enqueue(state, 'leak'); }
   k.lastLives = state.lives;
   if (!k.result && ['victory', 'defeat'].includes(state.popup?.kind)) { k.result = true; enqueue(state, state.popup.kind); }
  }
  if (!k.queue.length || now() - k.lastTry < RETRY_MS) return null;
  const shot = k.queue[0];
  k.lastTry = now();
  shot.tries++;
  try {
   const png = await bridge.screenshot(width);
   const file = join(dir, safe(shot.match), `${shot.round}-${shot.reason}.png`);
   await mkdir(join(dir, safe(shot.match)), {recursive: true});
   await writeFile(file, png);
   k.queue.shift();
   const record = {kind: 'screenshot', match_id: shot.match, round: shot.round, reason: shot.reason, path: relative(root, file).replaceAll('\\', '/'), bytes: png.length};
   k.taken.push(record);
   await log.append(record);
   return record;
  } catch (error) {
   if (shot.tries >= MAX_TRIES) {
    k.queue.shift();
    await log.append({kind: 'screenshot', match_id: shot.match, round: shot.round, reason: shot.reason, error: error.message});
   }
   return null;
  }
 };
 return k;
}
const safe = id => String(id).replace(/[^A-Za-z0-9_-]/g, '_');
