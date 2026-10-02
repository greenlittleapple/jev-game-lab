# BTD6 verification

## First live spike, 2026-09-29

Run from about 21:42 UTC by the coordinating Claude Code session, with Marcus at the game; recorded here from its report. Setup: bridge 0.1.0 (the `e80a5f0` build, SHA-256 `bbc8ed47…`) in `Mods`, BTD6 56.3, MelonLoader 0.7.3, BTD6 Mod Helper 3.6.8, the separate mod account, and a Monkey Meadow Medium Standard match that Marcus started.

| Check | Result |
|---|---|
| Load | `Jev BTD6 Bridge 0.1.0 is serving on http://127.0.0.1:15527/`, two mods loaded, no errors |
| Health | `main_thread_pumping: true`, `run_in_background: true` with the game focused |
| Menu state | `screen: "menu"`, `game_version: "56.3"` |
| Match state | Setup "Tutorial Medium Standard (mode ID Standard)": a standard match's mode ID is `Standard`. `game_type: Standard`, `coop: false`, `account_flagged: false`, `flag_risk_mode: false`, cash 650, round index 0, `before_first_wave: true`, `auto_start: true` (the new account's default) |
| Map | One path of 682 points, x from -333.6 to 74.6, y from -70.1 to 315.1; both ends lie off-screen |
| Catalog | 45 entries (26 towers, 19 heroes). Only the Dart Monkey was unlocked ($200 on Medium); Quincy was locked, probably because the tutorial wasn't finished |
| Placement check | On the track, (-95.65, 20.4): invalid. (-95.65, 5), (0, 0), (-120, -40): valid. (-95.65, 35), (-95.65, 45), (-60, 60), (30, -30): invalid |
| Placement | Dart Monkey at (-95.65, 5): `queued`, then `executed` as tower 392, 40 ms after receipt. The state listed it at (-95.7, 5.0), so coordinates round-trip. Cash 650 to 450, the catalog price. `towers_hash` changed from `cbf29ce484222325` to `e00b53bfc0377924`. The dispatch log had the pending record before the result. `ObjectId.Invalid` works as the ID for a new tower |
| Refusals | The track point: `rejected`, `invalid_position`. A Tack Shooter at (0, 0): `rejected`, `tower_locked`. Neither changed cash or `towers_hash` |
| Start round | `start_round` through `POST /api/v1/command` with an `expect` block: executed; `round.active` went true and cash rose from pops |
| Rounds | Index 0 during round 1 and 1 after the transition, so the displayed round is index + 1 (on-screen confirmation pending). End-of-round cash was $100 + round (602 to 708 entering index 2, 741 to 844 entering index 3). With auto-start on, rounds ran back to back |
| Fast-forward | `fast_forward` went from false to true when Marcus pressed the button |
| Lives | First leak at index 3, 150 to 148; 106 at round 7 |
| Paused by a screen | A rank-up screen opened at round 7: `paused: true`, `ready: false`. Two `place_tower` attempts were refused with `game_paused` and nothing changed |
| Rank-up tower pick | The screen offered a choice of Primary tower. Marcus picked the Boomerang Monkey, and `/api/v1/catalog` showed it unlocked right away ($315 on Medium), so unlock reads are live |
| Second placement | Dart Monkey at (55, -20): `queued`, then executed as tower 3031 |
| Placement batches | A 1,739-point check was refused ("points must be an array of at most 400 [x, y] pairs"). In batches of 400, 1,083 of 1,739 points were valid on a 6-unit grid over x -140 to 140, y -110 to 110 |
| Best spot | Boomerang Monkey at (22, -26), the best-covering valid point (222 path points within its range of 43): `queued`, then executed as tower 3581, worth 315 |
| Upgrade | `upgrade_tower` on tower 392, path 0 (Sharp Shots, listed at $140 and unlocked in `next_upgrades`): `queued`, then executed 20 ms later. Tiers became 1-0-0 and its worth went from 200 to 340. Cash matched: 1,118 - 315 - 140 + pops = 698 |

### Found and fixed

- **Lives.** The state showed 150/5000. `max_lives` (Mod Helper's `GetMaxHealth`) is the game's cap on lives, 5000 on Medium, not the starting lives, and lives percentages (the low-lives trigger, the emergency rule, the scorecard) were computed from it. Bridge 0.2.0 also reports `starting_lives` (`UnityToSimulation.GetStartingHealth`), and the runner computes percentages from it, falling back to the mode's starting lives.
- **A screen over the match stalls play.** The bridge refused commands correctly while the rank-up screen was open, but an unattended run would wait there. Bridge 0.2.0 reports open screens in the state and dismisses allowlisted ones (see [ARCHITECTURE.md](ARCHITECTURE.md), "Bridge").
- **Placements and upgrades finish one frame later.** The bridge answers `queued`, and the game's callback settles the record 20 to 40 ms later. The runner looks the command up instead of resending it. This works as designed.

## Bridge 0.3.0 live check, 2026-09-29

About 22:41 to 22:50 UTC on the mod account, bridge DLL SHA-256 `89972509...`. Operator commands only; no Jev or strategist.

- **Startup.** The bridge loaded with Mod Helper 3.6.8 at the pinned hash (`1556c814...`). The game stopped on the title screen; Marcus pressed Start, then Continue on the Modded Client screen, by hand (0.3.1 does both). On the main menu the state showed menu `MainMenuUi` and `main_menu: true`.
- **Saved game.** `start MonkeyMeadow Hard CHIMPS` was refused with `saved_game_exists` (a Medium Standard save on Tutorial, round index 8), as designed. 0.3.1 adds `--replace-saved`.
- **Start CHIMPS.** `start InTheLoop Hard CHIMPS` executed. The state showed mode `Clicks`, round index 5 before the first wave, cash 650, lives 1 of 1, `unlock_all: true`. CHIMPS starts on round 6, so the displayed round is index + 1.
- **Catalog.** All 45 towers unlocked, with Hard prices from the match's model: Dart Monkey 215, Ninja Monkey 430, Monkey Village 1295, Quincy 585.
- **A never-unlocked tower.** A Ninja Monkey was placed at (52, 40): queued, then settled; cash went from 650 to 220. Its next upgrades were listed with prices and `unlocked: true`.
- **Upgrade without the cash.** Ninja Discipline ($380) with $220 was refused as `game_refused`. 0.3.1 refuses it first as `insufficient_cash`.
- **Mode rules dialog.** CHIMPS opened a plain `Popup` whose text begins "The true test of a BTD master" with one `OKButton`. The bridge reported it as `unknown` and refused `go_home` while it was open; Marcus pressed OK. 0.3.1 reports it as `mode_rules_notice` and closes it with OK.
- **Rounds and an XP-gated upgrade.** `start_round` executed. By round 7, Ninja Discipline, normally XP-gated, executed: tiers 1-0-0, no leaks.
- **go_home.** Executed ("quit to the main menu"); the state then showed `main_menu: true` and no screen.

## Bridge 0.3.1 live check, 2026-09-29

About 22:52 UTC on the mod account, bridge DLL SHA-256 `87e25089...`.

- **Startup, hands-free.** From a fresh launch, `advance --confirm` pressed Start on the title screen. Its first Continue on the Modded Client notice was refused as `button_unavailable` (the button wasn't enabled yet), the retry went through, and it ended on the main menu (`MainMenuUi`, `main_menu: true`) with no clicks by hand.
- **Replacing a saved game.** `start MonkeyMeadow Hard CHIMPS --replace-saved` executed ("loading Tutorial Hard Clicks with Quincy, replacing a saved game on Tutorial (Medium Standard, round index 8)"). The match loaded at round 6 with $650 and 1 life.
- **Mode rules dialog.** Reported as `mode_rules_notice` (class `Popup`, title "C.H.I.M.P.S.", one OK button); `dismiss mode_rules_notice ok` executed, then no screen and `ready: true`.
- **Placement.** A Ninja Monkey at (-86, 40): queued, cash 650 to 220.
- **go_home.** Executed, then `main_menu: true`.
- **The old save stayed.** A plain `start MonkeyMeadow Hard CHIMPS` afterwards was refused with `saved_game_exists`, still describing the old Medium Standard save at round index 8. The bridge reads `savedMaps` from the profile on every `start_match`, so the summary isn't stale. The game writes a match's save at round checkpoints (`InGame.CreateMapSave(completedRound, highestCompletedRound)`, with `DisableSaveFileIfNoCheckpointReached`), and this match was left before its first wave, so it never wrote one. `--replace-saved` starts a fresh match without removing the old save; the new match replaces it only once it saves at a completed round. Benchmark starts on Monkey Meadow should always pass `--replace-saved`, since a match left mid-way also leaves a save.

### Still open

- Whether the game runs frames while unfocused.
- The playfield bounds. The grid above covered x -140 to 140 and y -110 to 110; the game's own bounds aren't confirmed.
- Bridge 0.2.0 and 0.3.0 in play (0.2.0 was installed; the checks are in [BTD6-SPIKE-PLAN.md](BTD6-SPIKE-PLAN.md)):
  - on the lab's account, every tower and upgrade is placeable and CHIMPS is selectable on Monkey Meadow;
  - `starting_lives: 150` on Medium;
  - the screen report and dismissal for each kind: level-up, the notices after it, the tower pick (is it `TowerGiftBoxScreen`?), victory and defeat;
  - with mods off afterwards, the mod account's own unlocks are unchanged, which would show the bridge wrote nothing.
  - 0.3.0 (the rest was confirmed above): whether `go_home` keeps the game's saved match, the main-menu screens (`daily_rewards`, `update_notice`), towers without a target type (`targeting: null`), and whether `isSubTower` covers every tower another tower makes;
  - 0.3.1: `insufficient_cash` on an upgrade, and that a new match's save at its first completed round replaces the old one (and whether victory or defeat removes the save).
  - 0.3.10: that Close on `StoreLegendsPopup` closes the ad through the `CloseButton` field the bridge checks (`closeBtn` or `exitButton`) and opens nothing else (the result's `detail` lists its persistent listeners); `StorePopup` and `RacePassStorePopup` as `store_ad` are from the interop assembly only.
  - 0.3.11: `bloons.moabs` health values in play (that `Bloon.health` is the shell's health left); that `set_auto_start` off makes the game wait after each round and `start_round` starts the next; whether the setting is saved to the profile or belongs to the match only; and whether restoring it after the match result takes effect.
  - 0.3.14: that `set_targeting` (now `Tower.SetTargetType`) switches a Dartling to Locked and a Heli to Lock In Place or Pursuit at once and answers `executed` (0.3.13 answered `not_applied` and the arrows' step landed a frame later).
  - 0.3.12: that `set_target_point` moves a Mortar's reticle and a Dartling's Locked point to the map point given (the same coordinates as tower positions) and `target_point` reads it back; that `/api/v1/screenshot` returns the game frame as a PNG, one per second.
  - Whether the Modded Client notice's class is `ModdingPopup` (the bridge found and dismissed it, which suggests so, but the class wasn't recorded).
