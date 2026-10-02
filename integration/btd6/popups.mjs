// Screens that stop play or block the main menu. The bridge reports one in state.popup ({kind, scope,
// class, buttons, options}). An allowlisted kind is dismissed as a forced transition: no Jev call,
// logged like any dispatch, not counted as a decision. Anything else stops the runner for the operator.
// mode_rules_notice: the rules dialog a mode opens at the start of a match (CHIMPS), closed with OK.
// tutorial_notice (bridge 0.3.5; bloon introductions 0.3.6): a one-time tip with a title the bridge knows
// ("Upgrade Your Monkeys!", "Regrow Bloons", ...; gameplay hints such as "Change Targeting" since 0.3.9,
// and the "Monkey Knowledge" notice at rank 30 since 0.3.10; OK never opens the knowledge menu),
// closed with OK. Other single-OK dialogs stay unknown and
// stop the runner; over a match, it resumes once that screen has closed (runner.mjs resumeAfterScreen).
// hero_unlock_notice and tower_unlock_notice (bridge 0.3.8): the splash after a free hero or tower unlock
// at a rank-up, closed with Continue. Its button animates in; until it is enabled the bridge refuses the
// press as button_unavailable and the runner tries again at its next step. A splash with any other
// button, or for an ID the game doesn't list, stays unknown.
export const MATCH_POPUP_KINDS = ['level_up', 'xp_notice', 'tower_unlock_choice', 'victory', 'defeat', 'mode_rules_notice', 'tutorial_notice',
 'hero_unlock_notice', 'tower_unlock_notice'];
// Over the main menu: the daily rewards screen (closed with Back, the reward left unclaimed), the
// update notice (OK), and store_ad (bridge 0.3.10): a store or DLC ad such as StoreLegendsPopup, closed
// with its CloseButton only. It has Try and Purchase buttons, which are never pressed; the bridge
// accepts no other button for it. Stepped past like the other menu screens, both while advancing to
// the menu (lifecycle.mjs advanceToMenu) and between runs (the runner's forced step).
// At startup (scope "startup"): the title screen (Start) and the game's Modded Client notice
// (Continue; never Close Game or Log Out).
export const STARTUP_POPUP_KINDS = ['title_screen', 'modded_client_notice'];
export const MENU_POPUP_KINDS = ['daily_rewards', 'update_notice', 'store_ad', ...STARTUP_POPUP_KINDS];
export const POPUP_KINDS = [...MATCH_POPUP_KINDS, ...MENU_POPUP_KINDS];

// The button pressed on each kind. A rank-up tower pick takes the first option offered (recorded in
// the log). After a defeat: Restart while the series has runs to go, otherwise Home (afterDefeat).
// Never Continue or Retry for Monkey Money, never Freeplay, never a reward claim; the bridge refuses
// those as well.
export function popupButton(kind, {afterDefeat = 'home'} = {}) {
 if (kind === 'defeat') return ['home', 'restart'].includes(afterDefeat) ? afterDefeat : null;
 return {level_up: 'continue', xp_notice: 'continue', tower_unlock_choice: 'pick_first', victory: 'home', daily_rewards: 'back', update_notice: 'ok', store_ad: 'close',
  title_screen: 'start', modded_client_notice: 'continue', mode_rules_notice: 'ok', tutorial_notice: 'ok',
  hero_unlock_notice: 'continue', tower_unlock_notice: 'continue'}[kind] ?? null;
}

export function popupCandidate(state, options = {}) {
 const p = state.popup;
 if (!p || !POPUP_KINDS.includes(p.kind) || !p.class) return null;
 const button = popupButton(p.kind, options);
 if (!button) return null;
 const pick = p.kind === 'tower_unlock_choice' ? p.options?.[0] ?? null : null;
 return {
  id: `dismiss:${p.kind}:${button}`, label: `${p.class}: ${button}${pick ? ` (${pick})` : ''}`,
  command: {action: 'dismiss_popup', popup: p.kind, button, popup_class: p.class},
  details: {kind: 'dismiss_popup', popup: p.kind, popup_class: p.class, button, ...(pick ? {picks: pick} : {})},
 };
}

// Why the runner has to stop for the operator, or null.
export function popupProblem(state, options = {}) {
 const p = state.popup;
 if (!p || popupCandidate(state, options)) return null;
 const buttons = (p.buttons ?? []).map(b => b.name + (b.label ? ` "${b.label}"` : '')).join(', ') || 'none';
 const text = [p.title, p.text].filter(Boolean).join(': ');
 return `A screen the runner doesn't handle is open (${p.class ?? 'unknown class'}, kind ${p.kind}${p.menu_name ? `, menu ${p.menu_name}` : ''}; buttons: ${buttons}${text ? `; text: ${text}` : ''}). ${state.in_game ? 'Deal with it in the game; the runner resumes once it has closed.' : 'Deal with it in the game, then resume.'}`;
}

// The dismiss_popup command for the open screen, for the operator CLI: the button must be the one
// the bridge allows for that kind, and the expect block carries what the state showed.
export function dismissCommand(state, kind, button, commandId) {
 const p = state.popup;
 if (!p) throw Error('No screen is open.');
 if (p.kind !== kind) throw Error(`The open screen is ${p.kind} (${p.class ?? 'unknown class'}), not ${kind}.`);
 if (!POPUP_KINDS.includes(kind)) throw Error(`The bridge doesn't dismiss ${kind} screens.`);
 const overMatch = MATCH_POPUP_KINDS.includes(kind);
 if (overMatch && !state.in_game) throw Error('The screen is over a match, but no match is open.');
 return {command_id: commandId, action: 'dismiss_popup', popup: kind, button,
  expect: {...(overMatch ? {match_id: state.match.id, towers_hash: state.towers_hash ?? null} : {}), popup_class: p.class}};
}
