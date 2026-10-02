// Repository check: the bridge mod reads the game and acts only through the ordinary tower and round
// commands, allowlisted screen buttons, and starting or leaving single-player matches. It must not
// write the player profile (it may read the selected hero and saved games), use the debug unlock
// flags, change gameplay (cash, lives, rounds, powers, continues), set up another game type
// (co-op, races, boss events, Odyssey, Contested Territory, daily challenges), claim rewards, or
// spend Monkey Money or enter Freeplay. The saved unlock and XP fields are read only by ProfileReader.cs.
// Game speed is changed only by GameSpeed.cs (set_speed): fast-forward and its time scale. Auto-start is
// changed only there too (set_auto_start, 0.3.11), through the match's own toggle.
// Comments and strings are ignored.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const bridge = fileURLToPath(new URL('../integration/btd6-bridge/', import.meta.url));
const FORBIDDEN = [
 // Profile writes
 'AddTowerXP', 'AcquireUpgrade', 'AcquireKnowledge', 'UnlockTower', 'UnlockHero', 'UnlockTowerSkin', 'AddMonkeyMoney',
 'GetPlayerProfile', 'SaveProfile',
 'SetSavedMap', 'RemoveSavedMap', 'RemoveCtSavedMaps',
 // Debug unlocks
 'debugUnlockAll',
 // Gameplay changes
 'AddCash', 'SetCash', 'AddHealth', 'SetHealth', 'SetMaxHealth', 'AddMaxHealth', 'SetSandboxHealth', 'SetRound', 'SetEndRound',
 'SpawnBloons', 'ActivatePower', 'ActivateInstaTower', 'ActivateEditorPower', 'Continue(', 'SetFastForward', 'TimeHelper',
 'SetToReplaySpeed', 'replayTimeScaleMultiplier', 'OverrideMaxSimulationStepsPerUpdate', 'timeScale',
 'SetAutoPlay', 'SellTower', 'CanAcquireUpgrade', 'IsUpgradeLocked', 'UpgradeTowerParagon',
 // Monkey Money, Freeplay, purchases and blunt popup hiding
 'ContinueClick', 'RunContinue', 'RetryForMMClicked', 'RetryLastRound', 'OnConfirmRetry', 'FreeplayClick', 'OnGetNowButton',
 'BuyRacePass', 'OnDebugForceUnlock', 'OnDebugReset', 'HideAllPopups', 'Claim', 'Purchase', 'Buy',
 // Startup screens: never close the game, log out or link an account
 'CloseGame', 'ShowLogoutPopup', 'OnIvePlayedBeforeButtonClicked', 'ShowNewLiNKAccount',
 // Game types other than a single-player standard game
 'SetupRace', 'SetupOdyssey', 'SetupBoss', 'SetupDailyChallenge', 'SetupContestedTerritory', 'SetupCouchCoop',
 'SetupRogueGame', 'SetupFrontierGame', 'SetupQuest', 'SetupTutorial', 'SetupMapEditor', 'SetupGameEditor', 'Btd6CoopGame',
];
// Writes to profile fields the bridge reads, and co-op flags turned on.
const FORBIDDEN_WRITES = [/\b(?:primaryHero|savedMaps)\s*=(?!=)/, /\.Data\s*=(?!=)/, /selected(?:Coop|Couch)Mode\s*=\s*true/];

// Calls that match a forbidden name but are allowed: Continue on the Modded Client notice (ModdingPopup),
// which only closes the notice, unlike the Monkey Money continue after a defeat; and the cast to the free
// hero unlock splash (HeroPurchaseSplash, 0.3.8), whose only call is MenuClicked.
const ALLOWED_CALLS = ['modding.Continue()', 'TryCast<HeroPurchaseSplash>()'];

// The saved unlock and XP fields may be read only by ProfileReader.cs (GET /api/v1/profile), which may
// enumerate them and read KonFuze values but never add, remove, assign or write.
const PROFILE_FIELDS = /\b(?:unlockedTowers|unlockedHeroes|acquiredUpgrades|acquiredKnowledge|towerXp|knowledgePoints|veteranXp|veteranRank)\b|\.(?:xp|rank)\b/;
const PROFILE_READER = 'ProfileReader.cs';
// set_speed: the fast-forward toggle and Mod Helper's fast-forward time scale, and nothing else about time;
// set_auto_start: the match's auto-start toggle.
const GAME_SPEED = 'GameSpeed.cs', SPEED_CALLS = ['bridge.SetFastForward(', 'TimeHelper.OverrideFastForwardTimeScale', 'bridge.SetAutoPlay('];
const PROFILE_WRITES = /(?<!\blist)\.(?:Add|Remove|RemoveWhere|Clear|UnionWith|ExceptWith|IntersectWith|SymmetricExceptWith|TryAdd)\s*\(|\.(?:Write|WriteRemoved|SetHoney|ReplenishPool|SwapPooledBuffer|ReturnToPool)\s*\(|\bValue\w*\s*[-+*\/]?=(?!=)|\bprofile\.\w+\s*[-+]?=(?!=)/;

const strip = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

test('the bridge never writes the profile or changes gameplay', async () => {
 const found = [];
 for (const dir of [bridge, join(bridge, 'Protocol')])
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.cs'))) {
   const allowed = file === GAME_SPEED ? [...ALLOWED_CALLS, ...SPEED_CALLS] : ALLOWED_CALLS;
   const code = allowed.reduce((c, call) => c.replaceAll(call, ''), strip(await readFile(join(dir, file), 'utf8')));
   for (const name of FORBIDDEN) if (code.includes(name)) found.push(`${file}: ${name}`);
   for (const pattern of FORBIDDEN_WRITES) if (pattern.test(code)) found.push(`${file}: ${pattern}`);
   if (file !== PROFILE_READER && PROFILE_FIELDS.test(code)) found.push(`${file}: reads a saved unlock or XP field outside ${PROFILE_READER}`);
   if (file === PROFILE_READER && PROFILE_WRITES.test(code)) found.push(`${file}: ${code.match(PROFILE_WRITES)[0]}`);
  }
 assert.deepEqual(found, []);
});

test('the write patterns catch profile writes and co-op flags but not reads', () => {
 const caught = code => FORBIDDEN_WRITES.some(p => p.test(strip(code)));
 assert.ok(caught('profile.primaryHero = "Quincy";'));
 assert.ok(caught('player.Data = other;'));
 assert.ok(caught('data.selectedCoopMode = true;'));
 assert.ok(!caught('var selected = profile?.primaryHero; if (selected != command.Hero) return;'));
 assert.ok(!caught('data.selectedCoopMode = false; foreach (var entry in profile.savedMaps) { }'));
});

test('the profile reader may enumerate saved unlocks but not change them', () => {
 const writes = code => PROFILE_WRITES.test(strip(code));
 assert.ok(!writes('foreach (var id in set) if (id != null) list.Add(id); dto.Rank = Whole(profile.rank); var v = value.Value;'));
 for (const code of ['profile.unlockedTowers.Add("DartMonkey");', 'set.Add(id);', 'profile.acquiredUpgrades.UnionWith(all);', 'profile.xp.Write(1);',
  'profile.rank.Value = 50;', 'profile.knowledgePoints.Value += 1;', 'profile.unlockedHeroes = other;', 'profile.towerXp.Remove("DartMonkey");'])
  assert.ok(writes(code), code);
 assert.ok(PROFILE_FIELDS.test(strip('var towers = profile.unlockedTowers;')));
 assert.ok(!PROFILE_FIELDS.test(strip('// profile.unlockedTowers\nvar hero = profile.primaryHero;')));
});
