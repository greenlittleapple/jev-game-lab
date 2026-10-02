// Steps outside the decision loop, shared by the operator CLI (bridge-cli.mjs) and the runner's
// command-line entry (run-cli.mjs): sending one lifecycle command with its dispatch record, waiting
// for a state, and stepping from launch to the main menu.
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {dismissCommand, popupButton, popupProblem, MENU_POPUP_KINDS} from './popups.mjs';
import {startSetup} from './match-flow.mjs';

// One command, once: the dispatch record is written (and synced) before it is sent, and the command
// is never resent. log is a core/runner.mjs runLog.
export async function dispatchOnce(bridge, log, command) {
 await log.append({kind: 'dispatch', outcome: 'pending', command});
 let result;
 try { result = await bridge.command(command); }
 catch (error) {
  await log.append({kind: 'dispatch', outcome: 'uncertain', command_id: command.command_id, message: error.message});
  throw Error(`${error.message}. The command may still have run: check the game and run "npm run btd6:bridge -- result ${command.command_id}". Don't resend it.`);
 }
 await log.append({kind: 'dispatch', outcome: result.status, command_id: command.command_id, result});
 return result;
}

// Reads the state until done(state) holds. Reads fail while the game is loading, so errors are retried.
export async function waitForState(bridge, done, what, {timeoutMs = 60_000, pollMs = 1000, sleep = delay, now = Date.now} = {}) {
 for (const end = now() + timeoutMs; ; await sleep(pollMs)) {
  const state = await bridge.state().catch(() => null);
  if (state && done(state)) return state;
  if (now() > end) throw Error(`No ${what} after ${Math.round(timeoutMs / 1000)} s; check the game, then run "npm run btd6:bridge -- state".`);
 }
}

// From launch to the main menu: one allowlisted press per screen (title screen Start, Modded Client
// Continue, daily rewards Back, update notice OK, store ad Close), each waiting for that screen to go. Any other
// screen stops it. Returns the main-menu state (or a match's state, if one is open).
// dispatch(command) sends one command with its dispatch record (dispatchOnce).
export async function advanceToMenu(bridge, dispatch, {timeoutMs = 180_000, pollMs = 1000, retryMs = 2000, sleep = delay, now = Date.now, newId = randomUUID} = {}) {
 let presses = 0;
 for (const end = now() + timeoutMs; ;) {
  const state = await bridge.state().catch(() => null);
  if (state?.in_game || (state?.main_menu && !state.popup && !state.loading)) return state;
  if (now() > end) throw Error(`Not on the main menu after ${Math.round(timeoutMs / 1000)} s (screen ${state?.popup?.kind ?? state?.menu ?? 'unknown'}).`);
  const p = state?.popup;
  if (!p || state.loading) { await sleep(pollMs); continue; }
  if (!MENU_POPUP_KINDS.includes(p.kind) || !popupButton(p.kind)) throw Error(popupProblem(state) ?? `The ${p.kind} screen isn't stepped past automatically.`);
  if (++presses > 20) throw Error('Stopped after 20 presses; check the game.');
  const result = await dispatch(dismissCommand(state, p.kind, popupButton(p.kind), newId()));
  // A button still animating in is refused as button_unavailable; try again shortly.
  if (result.reason === 'button_unavailable') { await sleep(retryMs); continue; }
  if (result.status !== 'executed') throw Error(`${p.kind} was not dismissed (${result.reason ?? result.status}).`);
  await waitForState(bridge, s => s.popup?.class !== p.class || s.popup?.kind !== p.kind, `change from ${p.kind}`, {timeoutMs: 30_000, pollMs, sleep, now}).catch(() => {});
 }
}

// "MonkeyMeadow/Hard/CHIMPS" -> {map: 'Tutorial', difficulty: 'Hard', mode: 'Clicks', hero: 'Quincy'}
export function parseSetup(text) {
 const parts = String(text ?? '').split('/');
 if (parts.length !== 3) throw Error('--setup is <map>/<difficulty>/<mode>, e.g. MonkeyMeadow/Hard/CHIMPS.');
 return startSetup(...parts);
}
