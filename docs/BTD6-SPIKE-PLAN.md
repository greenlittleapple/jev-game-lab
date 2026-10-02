# Live checks for the BTD6 bridge

The first spike (bridge 0.1.0) ran on 2026-09-29: it read the match, placed three towers, upgraded one and started rounds. Its results are in [BTD6-VERIFICATION.md](BTD6-VERIFICATION.md). Bridge 0.2.0 (starting lives, screens over a match) was installed on 2026-09-29; its in-match checks are carried into the list below. Bridge 0.3.1 adds the startup screens (title screen, Modded Client notice) and more detail on unknown screens; it also closes the CHIMPS rules dialog (`mode_rules_notice`), can replace a saved game on start (`--replace-saved`), and refuses an upgrade without the cash as `insufficient_cash`. Its checks are step 4a and the notes in steps 5 and 8. The 0.3.0 results are in [BTD6-VERIFICATION.md](BTD6-VERIFICATION.md). This page lists the checks for bridge 0.3.0, which adds starting a match from the main menu (`start_match`), leaving one (`go_home`), screens over the main menu, the loaded Mod Helper in `/health`, and the fixes from the 0.2.0 review (towers without a target type, the match's own model for prices, hero unlocks, sub-towers, per-tower placement checks). Nothing here runs until Marcus approves it. Jev and the strategist are not involved; every command is typed by the operator.

## Starting point

- The separate Ninja Kiwi account for modded play, set up by Marcus.
- `<BTD6 dir>` has MelonLoader 0.7.3 (`version.dll`, `MelonLoader/`) and BTD6 Mod Helper 3.6.8 (`Mods/Btd6ModHelper.dll`); the first launch created `Btd6ModHelper/`, `Plugins/`, `UserData/` and `UserLibs/`. Game version 56.3, Steam build 24829026.
- Bridge DLL: `integration/btd6-bridge/bin/Release/net6.0/JevBtd6Bridge.dll`, version 0.3.2, built with `dotnet build integration/btd6-bridge/JevBtd6Bridge.csproj -c Release -p:BTD6Dir="<BTD6 dir>"`. Check its SHA-256 against the one reported with the build before installing it; it replaces the installed build in `<BTD6 dir>/Mods/`.
- The bridge's settings, after its first launch: `<BTD6 dir>/UserData/MelonPreferences.cfg`, section `[JevBtd6Bridge]`: `port` (15527).
- `.env` in this repo sets `BTD6_DIR=<BTD6 dir>` for the mods script (see `.env.example`).

## Account and mode rules

Ninja Kiwi treats any mod as cheating and flags the account; the flag stays. So:

- The game runs with mods only while it is logged in to the mod account. Never log in to the main account while any loader file is in the game folder.
- Single-player only. No co-op, races, boss events, Odyssey, Contested Territory or other online modes with mods on. The bridge refuses commands outside standard single-player matches and in the modes Mod Helper lists as a flag risk, but that doesn't stop the game from connecting; staying out of those modes is the operator's part.
- Before logging out of the mod account for the first time, make sure it can be logged back into (a Ninja Kiwi login linked to it). Otherwise switching back to the main account can lose the mod account.

Switching from modded play back to the main account (Ninja Kiwi's procedure as Marcus relayed it):

1. In the game, log out of the mod account, then close the game.
2. `npm run btd6:mods -- off` moves `version.dll`, `MelonLoader/`, `Mods/`, `Btd6ModHelper/`, `Plugins/`, `UserData/` and `UserLibs/` to `.private/btd6/mods-off/` (or `BTD6_MODS_BACKUP_DIR`, which must be on the same drive). It refuses while the game runs and never deletes anything. Add `--dry-run` to see what it would move.
3. Verify the game files in Steam: open `steam://validate/960090`, or Library > B## Mod Helper updates

Mod Helper's `Plugins/UpdaterPlugin.dll` checks GitHub when the game starts and can replace `Mods/Btd6ModHelper.dll` with a newer release, which would change the build the bridge was checked against. `/api/v1/health` reports the loaded Mod Helper's version and DLL SHA-256; the runner pauses and `npm run btd6:bridge -- health` warns when they differ from the pin in `integration/btd6/pins.mjs` (3.6.8). The updater (3.6.8 source, `UpdaterPlugin/UpdaterPlugin.cs`) can be kept from updating Mod Helper in either of two ways, neither tried yet:

- Launch the game with `--modhelper.offline` (Steam: Bloons TD 6 > Properties > Launch Options). The updater then skips every check.
- Create `<BTD6 dir>/Btd6ModHelper/Mod Settings/Btd6ModHelper.json` containing `{"Btd6ModHelper": false}`. Each key is a file name in `Btd6ModHelper/Data/` without `.json`, and a `false` value leaves that mod as it is.

Either is Marcus's choice to make; the bridge doesn't change files in the game folder.

## Checks for bridge 0.3.0

Stop at the first unexpected result: go home without further commands and record what happened.

1. **Approval.** Marcus approves: installing bridge 0.3.0, launching the game on the mod account, and the commands below.
2. **Install and launch.** With the game closed, replace the DLL in `<BTD6 dir>/Mods/`, then launch through Steam on the mod account. `MelonLoader/Latest.log` should show `Mod Helper 3.6.8 (Btd6ModHelper.dll, SHA-256 1556c814...)`, then `Jev BTD6 Bridge 0.3.0 is serving on http://127.0.0.1:15527/`.
3. **Health.** `npm run btd6:bridge -- health`: `version: 0.3.0`, `mod_helper` with version `3.6.8` and the pinned SHA-256 (no warning printed) and `unlock_all`. Switch to another window for a few seconds and run it again: `main_thread_pumping` shows whether the game keeps running frames while unfocused.
4a. **Startup (0.3.1).** Right after launch, `state` shows `popup.kind: title_screen` (scope `startup`) and a `scene`. `npm run btd6:bridge -- advance --confirm` presses Start, then Continue on the Modded Client notice (kind `modded_client_notice`, class `ModdingPopup`: check that it is), then closes the daily rewards or update notice if they open, and prints the main-menu state. Any other screen stops it with the screen's class, text and button labels: record them.
4. **Main menu.** `npm run btd6:bridge -- state` shows `main_menu: true`, `loading: false`. If the daily rewards screen or an update notice is open, `state` reports `popup.kind` `daily_rewards` (class `DailyRewardsScreen`) or `update_notice` (`UpdateAnnouncementScreen`) with `scope: menu`; dismiss it with `dismiss daily_rewards back --confirm` or `dismiss update_notice ok --confirm`. The daily reward must stay unclaimed. Anything else over the menu is `unknown`: note its class and buttons and close it by hand. Quincy must be the selected hero, and Monkey Meadow must have no saved game; the bridge refuses otherwise (`hero_mismatch`, `saved_game_exists`), and both are settled in the game.
5. **Start Monkey Meadow CHIMPS from the menu.** `npm run btd6:bridge -- start MonkeyMeadow Hard CHIMPS --replace-saved --confirm` (0.3.1; without `--replace-saved` a saved game on the map is refused). With a save, the result's detail names the save it replaced. The CHIMPS rules dialog then opens: `state` shows `mode_rules_notice`; close it with `dismiss mode_rules_notice ok --confirm`. Expected: `executed` with the detail `loading Tutorial Hard Clicks with Quincy`, then, after loading, the state of a match on `Tutorial`, Hard, mode ID `Clicks`, `game_type: Standard`, lives `1/1`, `popup: null`. Check on screen that it is the same match the mode screen would start (CHIMPS rules, no Monkey Knowledge, no event bonuses). The shown round is index + 1.
6. **Catalog on CHIMPS.** `npm run btd6:bridge -- catalog`: every tower `unlocked: true`, the Banana Farm `in_inventory: false`, Quincy listed as a hero and unlocked, and the costs are Hard prices (a Dart Monkey costs 215, not Medium's 200).
7. **Place a tower the account has never unlocked.** Pick one the account hasn't earned (the Tack Shooter, unless it has been unlocked since). `check TackShooter <x> <y>`, then `place TackShooter <x> <y> --confirm`. Expected: `queued`, then `executed`, and `state` lists it with `targeting` set. Place a Monkey Village too if cash allows, since towers without a target type crashed the 0.2.0 state read; `state` must still answer, with `targeting: null` for it.
8. **Buy an XP-gated upgrade.** First try one without enough cash: 0.3.1 refuses it as `insufficient_cash`. `state` lists each tower's next upgrades with their cost and `(locked)` where the account hasn't bought them with XP. With enough cash, `upgrade <tower-id> <path> --confirm` on a locked one. Expected: `executed`, the tier in `state` goes up, and the in-game upgrade menu agrees.
9. **Sub-towers, if one comes up** (an Engineer's sentry, a hero summon): `state` counts it in `sub_towers`, leaves it out of `towers`, and the `towers_hash` doesn't change as sentries come and go.
10. **Screens, as they come up** during this or later matches. For each, `state` reports `popup.kind`, `popup.class` and its buttons; then `dismiss <kind> <button> --confirm` presses the allowlisted button:
    - A rank-up: kind `level_up`, class `LevelUpScreen`, button `continue`. The notices after it: kind `xp_notice`, button `continue`.
    - A rank-up tower pick: kind `tower_unlock_choice`. Is the class `TowerGiftBoxScreen`? Are the towers offered listed in `options`? Button `pick_first`, after which the result's `detail` names the tower. With the override on, this screen may not appear at all.
    - The defeat screen: kind `defeat`, button `home` or `restart`. The victory screen: kind `victory`, button `home`.
    - Anything else is `unknown`: note the class, the menu name and the buttons, and close it by hand.
11. **Go home.** From play, `npm run btd6:bridge -- home --confirm`. Expected: `executed` (`quit to the main menu`), then `state` shows `main_menu: true` and no match. Check that the game kept the match's save, as the pause menu's Home does (Monkey Meadow shows a saved CHIMPS game); delete it in the game before the next `start`. If the match ended instead, `home --confirm` presses Home on its victory or defeat screen.
12. **The profile is unchanged.** Bridge 0.3.2: `npm run btd6:bridge -- profile` before and after the session; the unlocked tower and hero lists and the acquired upgrades should be the same (a `btd6:run` logs this comparison itself and the scorecard flags a write). Then, for the visual check: after the session, close the game without logging out, turn mods off (`npm run btd6:mods -- off`) and verify the files in Steam, then launch the unmodded game. It opens on the mod account, and the towers and upgrades that account hadn't earned are locked again. Close the game and turn mods back on (`npm run btd6:mods -- on`).
13. **Record** the results in [BTD6-VERIFICATION.md](BTD6-VERIFICATION.md) and fix anything that differed.

ed.** After the session, close the game without logging out, turn mods off (`npm run btd6:mods -- off`) and verify the files in Steam, then launch the unmodded game. It opens on the mod account, and the towers that account hadn't earned (the Tack Shooter, for one) are locked again. Close the game and turn mods back on (`npm run btd6:mods -- on`).
10. **Record** the results in [BTD6-VERIFICATION.md](BTD6-VERIFICATION.md) and fix anything that differed.

To take the bridge out: close the game and remove `JevBtd6Bridge.dll` from `<BTD6 dir>/Mods/`.

## After these checks

1. Compute the spot catalog for Monkey Meadow with `npm run btd6:spots -- --map Tutorial --confirm` in a fresh CHIMPS match, and check it by eye (built; not run live yet).
2. Run one match with `npm run btd6:run` (built with a status page; tested only against the simulated game). See [ARCHITECTURE.md](ARCHITECTURE.md), "Running a match".
3. Run the pipeline checks on Medium Standard, then the Jev-only baseline and the strategist series on CHIMPS (see [ARCHITECTURE.md](ARCHITECTURE.md), "Evaluation protocol").
