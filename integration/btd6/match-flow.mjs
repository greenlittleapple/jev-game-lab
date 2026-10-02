// Starting and leaving matches through the bridge (start_match and go_home). The bridge makes the
// final checks on the game thread; these give the operator a clear reason before anything is sent.
import {DEFAULT_RULESET} from './rulesets.mjs';
import {STARTUP_POPUP_KINDS} from './popups.mjs';

// The single-player setups start_match loads, as [mode ID, difficulty]; the bridge has the same list
// (CommandParser.StartSetups). Co-op, races, boss events, Odyssey, Contested Territory and daily
// challenges are other game types, which start_match never sets up.
export const START_SETUPS = [['Standard', 'Easy'], ['Standard', 'Medium'], ['Standard', 'Hard'], ['Impoppable', 'Hard'], ['Clicks', 'Hard']];
// Names the operator may type for the game's IDs.
export const MAP_ALIASES = {MonkeyMeadow: 'Tutorial'};
export const MODE_ALIASES = {CHIMPS: 'Clicks'};
const ID = /^[A-Za-z0-9]{1,40}$/;

// {map, difficulty, mode, hero} in the game's IDs; the hero defaults to the ruleset's (Quincy).
export function startSetup(map, difficulty, mode, hero = DEFAULT_RULESET.hero) {
 const setup = {map: MAP_ALIASES[map] ?? map, difficulty, mode: MODE_ALIASES[mode] ?? mode, hero};
 if (!ID.test(setup.map ?? '')) throw Error('The map must be a map ID such as Tutorial (Monkey Meadow).');
 if (!START_SETUPS.some(([m, d]) => m === setup.mode && d === setup.difficulty))
  throw Error(`Use one of: ${START_SETUPS.map(([m, d]) => `${d} ${m === 'Clicks' ? 'CHIMPS' : m}`).join(', ')} (difficulty, then mode).`);
 if (!ID.test(setup.hero ?? '')) throw Error('The hero must be a hero ID such as Quincy.');
 return setup;
}

// replaceSaved: replace a saved game on the map (the bridge refuses by default).
export function startMatchCommand(state, setup, commandId, {replaceSaved = false} = {}) {
 if (state.in_game) throw Error('A match is open. Leave it first with "home --confirm".');
 if (state.loading) throw Error('A match is loading.');
 if (state.popup && STARTUP_POPUP_KINDS.includes(state.popup.kind))
  throw Error(`The game is still on a startup screen (${state.popup.kind}, ${state.popup.class ?? 'unknown class'}). Step to the main menu first with "advance --confirm".`);
 if (state.popup) throw Error(`A screen is open over the menu (${state.popup.kind}, ${state.popup.class ?? 'unknown class'}). Dismiss it first.`);
 if (!state.main_menu) throw Error(`The game isn't on the main menu (current menu: ${state.menu ?? 'unknown'}).`);
 return {command_id: commandId, action: 'start_match', ...setup, ...(replaceSaved ? {replace_saved: true} : {})};
}

// From a match, or from its victory or defeat screen. Other screens are dealt with first.
export function goHomeCommand(state, commandId) {
 if (!state.in_game) throw Error('Not in a match.');
 if (state.match.coop) throw Error('The bridge acts only in single-player matches.');
 if (state.popup && !['victory', 'defeat'].includes(state.popup.kind))
  throw Error(`A screen is open (${state.popup.kind}, ${state.popup.class ?? 'unknown class'}). Deal with it first.`);
 return {command_id: commandId, action: 'go_home', expect: {match_id: state.match.id}};
}
