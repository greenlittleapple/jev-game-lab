import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startSetup, startMatchCommand, goHomeCommand} from './match-flow.mjs';
import {round21} from './fixtures/index.mjs';

const mainMenu = {in_game: false, screen: 'menu', main_menu: true, loading: false, menu: 'MainMenu', popup: null, towers: []};

test('start setups: the allowlisted single-player modes, with the game\'s IDs and the ruleset\'s hero', () => {
 assert.deepEqual(startSetup('MonkeyMeadow', 'Hard', 'CHIMPS'), {map: 'Tutorial', difficulty: 'Hard', mode: 'Clicks', hero: 'Quincy'});
 assert.deepEqual(startSetup('Tutorial', 'Medium', 'Standard', 'Gwendolin'), {map: 'Tutorial', difficulty: 'Medium', mode: 'Standard', hero: 'Gwendolin'});
 assert.equal(startSetup('Tutorial', 'Hard', 'Impoppable').mode, 'Impoppable');
 for (const [difficulty, mode] of [['Medium', 'CHIMPS'], ['Hard', 'Apopalypse'], ['Medium', 'Coop'], ['Easy', 'Impoppable'], ['Hard', 'Race']])
  assert.throws(() => startSetup('Tutorial', difficulty, mode), /Use one of/, `${difficulty} ${mode}`);
 assert.throws(() => startSetup('../Tutorial', 'Hard', 'CHIMPS'), /map ID/);
});

test('start_match is sent only from the main menu with nothing open over it', () => {
 const setup = startSetup('MonkeyMeadow', 'Hard', 'CHIMPS');
 assert.deepEqual(startMatchCommand(mainMenu, setup, 'id-1'),
  {command_id: 'id-1', action: 'start_match', map: 'Tutorial', difficulty: 'Hard', mode: 'Clicks', hero: 'Quincy'});
 assert.equal(startMatchCommand(mainMenu, setup, 'id-7', {replaceSaved: true}).replace_saved, true);
 assert.equal('replace_saved' in startMatchCommand(mainMenu, setup, 'id-8'), false, 'off unless asked for');
 assert.throws(() => startMatchCommand(round21(), setup, 'id-2'), /match is open/);
 assert.throws(() => startMatchCommand({...mainMenu, loading: true}, setup, 'id-3'), /loading/);
 assert.throws(() => startMatchCommand({...mainMenu, main_menu: false, menu: null, popup: {kind: 'title_screen', scope: 'startup', class: 'TitleScreen'}}, setup, 'id-6'),
  /startup screen \(title_screen, TitleScreen\).*advance --confirm/);
 assert.throws(() => startMatchCommand({...mainMenu, popup: {kind: 'daily_rewards', class: 'DailyRewardsScreen'}}, setup, 'id-4'), /Dismiss it first/);
 assert.throws(() => startMatchCommand({...mainMenu, main_menu: false, menu: 'MapSelectScreen'}, setup, 'id-5'), /MapSelectScreen/);
});

test('go_home names the match, from play or from its victory or defeat screen', () => {
 const state = round21();
 assert.deepEqual(goHomeCommand(state, 'id-1'), {command_id: 'id-1', action: 'go_home', expect: {match_id: state.match.id}});
 assert.equal(goHomeCommand({...state, popup: {kind: 'defeat', class: 'DefeatScreen'}}, 'id-2').action, 'go_home');
 assert.throws(() => goHomeCommand({...state, popup: {kind: 'level_up', class: 'LevelUpScreen'}}, 'id-3'), /Deal with it first/);
 assert.throws(() => goHomeCommand(mainMenu, 'id-4'), /Not in a match/);
});
