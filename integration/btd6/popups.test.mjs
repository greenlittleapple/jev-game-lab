import {test} from 'node:test';
import assert from 'node:assert/strict';
import {popupCandidate, popupProblem, popupButton, dismissCommand} from './popups.mjs';
import {round21} from './fixtures/index.mjs';

const withPopup = popup => ({...round21(), popup: {buttons: [], options: [], ...popup}});

test('allowlisted screens get a fixed button, pressed through a dismiss_popup command', () => {
 assert.deepEqual(popupCandidate(withPopup({kind: 'level_up', class: 'LevelUpScreen'})).command,
  {action: 'dismiss_popup', popup: 'level_up', button: 'continue', popup_class: 'LevelUpScreen'});
 assert.equal(popupCandidate(withPopup({kind: 'xp_notice', class: 'LevelUpKnowledgeScreen'})).command.button, 'continue');
 const pick = popupCandidate(withPopup({kind: 'tower_unlock_choice', class: 'TowerGiftBoxScreen', options: ['BoomerangMonkey', 'BombShooter']}));
 assert.equal(pick.command.button, 'pick_first');
 assert.equal(pick.details.picks, 'BoomerangMonkey', 'the first option, recorded in the decision log');
 assert.equal(popupCandidate(withPopup({kind: 'victory', class: 'VictoryScreen'})).command.button, 'home');
 assert.equal(popupCandidate(withPopup({kind: 'defeat', class: 'DefeatScreen'})).command.button, 'home');
 assert.equal(popupCandidate(withPopup({kind: 'defeat', class: 'DefeatScreen'}), {afterDefeat: 'restart'}).command.button, 'restart');
 assert.equal(popupButton('defeat', {afterDefeat: 'continue'}), null, 'Continue for Monkey Money is never chosen');
});

test('an unknown screen, or one without a class, stops the runner for the operator', () => {
 const unknown = withPopup({kind: 'unknown', class: 'PauseScreen', buttons: [{name: 'ResumeButton', interactable: true}]});
 assert.equal(popupCandidate(unknown), null);
 assert.match(popupProblem(unknown), /PauseScreen, kind unknown; buttons: ResumeButton/);
 assert.match(popupProblem(withPopup({kind: 'level_up', class: null})), /doesn't handle/);
 assert.equal(popupProblem(withPopup({kind: 'defeat', class: 'DefeatScreen'}), {afterDefeat: 'continue'}) !== null, true);
 assert.equal(popupProblem(round21()), null, 'no screen, no problem');
});

test('screens over the main menu: Back on the daily rewards (nothing claimed), OK on the update notice', () => {
 const menu = popup => ({in_game: false, screen: 'menu', towers: [], popup: {scope: 'menu', buttons: [], options: [], ...popup}});
 assert.deepEqual(popupCandidate(menu({kind: 'daily_rewards', class: 'DailyRewardsScreen'})).command,
  {action: 'dismiss_popup', popup: 'daily_rewards', button: 'back', popup_class: 'DailyRewardsScreen'});
 assert.equal(popupCandidate(menu({kind: 'update_notice', class: 'UpdateAnnouncementScreen'})).command.button, 'ok');
 assert.match(popupProblem(menu({kind: 'unknown', class: 'DataConsentPopupBody', buttons: [{name: 'AcceptButton'}]})), /DataConsentPopupBody/);
});

test('startup screens: Start on the title screen, Continue on the Modded Client notice', () => {
 const startup = popup => ({in_game: false, screen: 'menu', main_menu: false, towers: [], popup: {scope: 'startup', buttons: [], options: [], ...popup}});
 assert.deepEqual(popupCandidate(startup({kind: 'title_screen', class: 'TitleScreen'})).command,
  {action: 'dismiss_popup', popup: 'title_screen', button: 'start', popup_class: 'TitleScreen'});
 assert.equal(popupCandidate(startup({kind: 'modded_client_notice', class: 'ModdingPopup'})).command.button, 'continue');
 assert.deepEqual(dismissCommand(startup({kind: 'modded_client_notice', class: 'ModdingPopup'}), 'modded_client_notice', 'continue', 'id-9').expect, {popup_class: 'ModdingPopup'});
});

test('the CHIMPS rules dialog is closed with OK and names its match', () => {
 const state = withPopup({kind: 'mode_rules_notice', class: 'Popup'});
 assert.equal(popupCandidate(state).command.button, 'ok');
 assert.equal(dismissCommand(state, 'mode_rules_notice', 'ok', 'id-10').expect.match_id, state.match.id);
});

test('an unknown screen is described with its menu, text and button labels', () => {
 const problem = popupProblem({in_game: false, towers: [], popup: {kind: 'unknown', scope: 'menu', class: 'Popup', menu_name: 'MainMenu',
  title: 'Notice', text: 'Something changed', buttons: [{name: 'OkButton', label: 'Okay'}]}});
 assert.match(problem, /menu MainMenu; buttons: OkButton "Okay"; text: Notice: Something changed/);
});

test('the operator\'s dismiss command carries the match only for a screen over a match', () => {
 const levelUp = withPopup({kind: 'level_up', class: 'LevelUpScreen'});
 assert.deepEqual(dismissCommand(levelUp, 'level_up', 'continue', 'id-1').expect,
  {match_id: levelUp.match.id, towers_hash: levelUp.towers_hash ?? null, popup_class: 'LevelUpScreen'});
 const rewards = {in_game: false, towers: [], popup: {kind: 'daily_rewards', scope: 'menu', class: 'DailyRewardsScreen'}};
 assert.deepEqual(dismissCommand(rewards, 'daily_rewards', 'back', 'id-2'),
  {command_id: 'id-2', action: 'dismiss_popup', popup: 'daily_rewards', button: 'back', expect: {popup_class: 'DailyRewardsScreen'}});
 assert.throws(() => dismissCommand(rewards, 'level_up', 'continue', 'id-3'), /open screen is daily_rewards/);
 assert.throws(() => dismissCommand({...rewards, popup: null}, 'daily_rewards', 'back', 'id-4'), /No screen is open/);
});

test('a known one-time tip is closed with OK; any other single-OK dialog over a match still stops the runner', () => {
 const ok = [{name: 'OKButton', label: 'OK', interactable: true}];
 const tip = withPopup({kind: 'tutorial_notice', class: 'Popup', title: 'Upgrade Your Monkeys!', buttons: ok});
 assert.deepEqual(popupCandidate(tip).command, {action: 'dismiss_popup', popup: 'tutorial_notice', button: 'ok', popup_class: 'Popup'});
 assert.equal(dismissCommand(tip, 'tutorial_notice', 'ok', 'id-11').expect.match_id, tip.match.id);
 const other = withPopup({kind: 'unknown', class: 'Popup', title: 'Some New Tip', text: 'Click here to learn more.', buttons: ok});
 assert.equal(popupCandidate(other), null);
 assert.match(popupProblem(other), /Popup, kind unknown; buttons: OKButton "OK"; text: Some New Tip: Click here to learn more\./);
});

test('a free hero unlock splash is closed with Continue; the same splash left unknown by the bridge stops the runner', () => {
 const click = [{name: 'Click', label: null, interactable: false}];
 const splash = {scope: 'match', source: 'menu', class: 'HeroPurchaseSplash', full_class: 'Assets.Scripts.Unity.UI_New.Main.HeroSelect.HeroPurchaseSplash',
  menu_name: 'GwendolinUnlockUI', buttons: click};
 const known = withPopup({...splash, kind: 'hero_unlock_notice'});
 assert.deepEqual(popupCandidate(known).command, {action: 'dismiss_popup', popup: 'hero_unlock_notice', button: 'continue', popup_class: 'HeroPurchaseSplash'});
 assert.equal(popupProblem(known), null, 'offered while the button still animates in; the bridge refuses until it is enabled');
 assert.equal(dismissCommand(known, 'hero_unlock_notice', 'continue', 'id-12').expect.match_id, known.match.id);
 const tower = withPopup({kind: 'tower_unlock_notice', scope: 'match', source: 'menu', class: 'GiftboxUnlockSplash', menu_name: 'DartlingGunnerUnlockUI',
  buttons: [{name: 'ClickArea', interactable: true}]});
 assert.equal(popupCandidate(tower).command.button, 'continue');
 const unknown = withPopup({...splash, kind: 'unknown', buttons: [...click, {name: 'BuyButton', label: '$1.99', interactable: true}]});
 assert.equal(popupCandidate(unknown), null);
 assert.match(popupProblem(unknown), /HeroPurchaseSplash, kind unknown, menu GwendolinUnlockUI; buttons: Click, BuyButton "\$1\.99"/);
});

test('a store ad over the main menu is closed with Close only; the same class unclassified still stops the runner', () => {
 const buttons = [{name: 'ScrollFakeBtn', interactable: true}, {name: 'CloseButton', interactable: true},
  {name: 'TryButton', label: 'Try', interactable: true}, {name: 'PurchaseButton', label: 'Get Now', interactable: true}];
 const ad = kind => ({in_game: false, screen: 'menu', towers: [], popup: {kind, scope: 'menu', source: 'popup', class: 'StoreLegendsPopup', buttons, options: []}});
 const candidate = popupCandidate(ad('store_ad'));
 assert.deepEqual(candidate.command, {action: 'dismiss_popup', popup: 'store_ad', button: 'close', popup_class: 'StoreLegendsPopup'});
 assert.equal(popupProblem(ad('store_ad')), null);
 assert.equal(popupButton('store_ad'), 'close', 'never try or purchase');
 assert.deepEqual(dismissCommand(ad('store_ad'), 'store_ad', 'close', 'id-20').expect, {popup_class: 'StoreLegendsPopup'});
 // The bridge reports it as unknown when CloseButton is missing (DialogKinds.IsStoreAd): the runner stops.
 assert.equal(popupCandidate(ad('unknown')), null);
 assert.match(popupProblem(ad('unknown')), /StoreLegendsPopup, kind unknown; buttons: ScrollFakeBtn, CloseButton, TryButton "Try", PurchaseButton "Get Now"/);
});
