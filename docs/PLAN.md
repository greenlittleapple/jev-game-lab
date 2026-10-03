# Plan

The current plan for the BTD6 port. Update this file whenever the plan changes, so any AI session (Claude or Codex) can continue from here. Results live in `docs/progress/btd6.json` and the README table. The design is in `ARCHITECTURE.md`, live evidence in `BTD6-VERIFICATION.md`, and the strategist's brief in `BTD6-STRATEGIST.md`.

Last updated: 2026-10-02 20:20 UTC (zero-leak confirmed, 20 of 20 won and 19 clean; CHIMPS revision 19 merged, series 1k against revision 18 started; the support-effects DDT figure merged, default off).

## Goal

Measure whether the Jev + Claude strategist design plays Bloons TD 6 better than Jev alone, in real time, with the same bridge and rules. A third design sits between them: Jev with a playbook that Claude writes ahead of time (btd6-playbook-v5), as fast as Jev alone.

**Target set by Marcus (2026-10-02): clear Hard Standard with 0 lives lost almost every time**, allowing for slight randomness, at 3x or faster.
- **First step:** a `--zero-leak` mode that plays Hard Standard with the one-life (CHIMPS) rule set, whatever the real lives. On CHIMPS, revisions 17 and 18 passed rounds 6 to 90 without a single leak in 8 of 9 matches, with less income than Hard Standard has.
- **Measure:** lives lost per match over 10 Hard Standard matches. The target is 0 in at least 9.
- **If failures remain:** fix each failure round in turn. A strict scripted build for the failing stretch is the fallback.
- **Result (2026-10-02): met.** `btd6-jev-v6` revision 18 with `--zero-leak` won 20 of 20, 19 with no lives lost: a 10-match series and a 10-match confirmation. It is the README's headline result so far, framed as Jev with its rules (not a comparison of the designs) on one map. CHIMPS remains the final benchmark.

## Benchmark decisions

| Setting | Choice |
|---|---|
| Map | Monkey Meadow (`Tutorial`) |
| Development setup | Hard Standard: rounds 3 to 80, 100 lives. Leaks cost lives instead of ending the match. |
| Headline setup | CHIMPS: rounds 6 to 100, 1 life. We switch to it for headline runs once Jev reliably passes about round 30 on Hard Standard (reached). |
| Ruleset | `btd6-open-v2` (default): v1 without the Dartling Gunner, Mortar Monkey and Heli Pilot, whose attacks follow the mouse cursor or a set point. `btd6-open-v3` (`--ruleset v3`, bridge 0.3.12) keeps them and has the runner aim them; aiming works live on bridge 0.3.14 (step 3), and every series since series 3 passes `--ruleset v3`; making it the code default is an open item. Runs under each ruleset are their own series. |
| Unlocks | Every tower and upgrade. The lab's recorded results were played on a separate single-player account with every tower and upgrade available. The public bridge uses the account's own unlocks. The saved profile is never written, and a per-run check verifies it. |
| Monkey Knowledge | None. The runner never spends knowledge points. |
| Hero | Quincy |
| Speed | Comparison series use graded speed with pinned factors: series 3 and 4 `graded:5`, series 5 `graded:10+moab3`, series 6 `graded:10+moab3+camo`. Fixed 5x was the first setting. The runner's default is graded speed (`graded:10`: 10, 5, 3 or 1 by the defence's margin for the round, 1 on danger, at most 3 on the setup's hard rounds and the last 6). Graded, adaptive (5x dropping to 1x by category) and between-rounds runs (`--between-rounds`: auto-start off, purchases between rounds) each have their own series. |
| Score | Win rate, median round reached, lives left, minutes, and Jev tokens, over several runs per version. A single run is not evidence. |
| Account | A separate Ninja Kiwi mod account, single-player only |

## Results so far (Hard Standard)

| Version | Speed | Runs |
|---|---|---|
| btd6-jev-v3 | 3x | won once with 60 lives; lost at 40; stopped at 16, 17, 10 and 51 on popups |
| btd6-jev-v3 | 5x | lost at 75 |
| btd6-jev-v4 | 3x | lost at 31; stopped at 20 |
| btd6-jev-v4 | 5x | won with 100 lives |
| btd6-claude-v1 | adaptive | won with 96 lives (19 consults, 161 Jev calls) |
| btd6-jev-v4 | graded | lost at 37, 42 and 40 (see below) |
| btd6-playbook-v5 (revision 1) | graded | lost at 51, 56 and 51 (see below) |
| btd6-playbook-v5 revisions 2 and 3, ruleset v2 | graded | lost at 78 (revision 2) and at 51 (revision 3) |
| btd6-jev-v6, ruleset v2 | graded | lost at 78 |
| btd6-jev-v6, ruleset v3 | graded:10 | won with 98 lives (the check of the runner's own aiming) |
| **Series 3**, ruleset v3, graded:5, factors 1.27 and 1: | | |
| btd6-jev-v6 | graded:5 | won with 99 lives; lost at 40 (the first MOAB leaked with 3 of 200 health left) |
| btd6-playbook-v5 revision 4 | graded:5 | lost at 76 (before the tower cap) |
| btd6-playbook-v5 revision 5 | graded:5 | won with 94 and with 90 lives |
| btd6-claude-v1 revision 4 | graded:5 | won with 98 lives; lost at 28 (the first Lead round) |

## Findings from the first claude-v1 match

Won on Hard Standard with 96 lives (log `.private/btd6/runs/2026-09-30T07-45-32-926Z-btd6-claude-v1.jsonl`). The plans were mostly not carried out: the camo Darts and the first Ninja 2-0-4 (by round 50) were built; the MOAB Assassin Bomb Shooter, the second Ninja, the Super Monkey and the Archmages were not, and Jev spent on Snipers 4-2-0, Darts 4-0-2 and 0-4-2 and Wizards 3-2-0 instead.

- **Survival rules were not the cause.** `survival_first` skipped the plan filters in 19 of 568 decisions: `moab_short` 18 times, all in rounds 36 to 40, and `leak_pressure` once.
- **No free spot.** All 12 catalog spots were taken by round 50, so placement targets (the second Ninja, the Super Monkey) were never offered. Fixed by the 30-spot catalog and the placement fallback.
- **Holds dropped without a record.** From round 53, v3's `no_wait_behind` removed waiting, every purchase left spent below the hold, and a filter never removes the last option, so the hold did nothing. Now waiting is put back when the round is covered (verdict not `short`, no leaks) and the hold is otherwise lifted with a recorded reason (ARCHITECTURE.md, claude-v1 enforcement).
- **The MOAB estimate is too low.** Round 40 was cleared at an estimated 17.4 MOAB damage per second against 36 needed, and the ZOMG at 112 against 324, with no lives lost. Every MOAB estimate now carries a calibration factor per setup: 2.0 as a hypothesis until live runs measure it (bridge 0.3.11 `moab_measure` records).
- **Mortars** counted a quarter of their pops and MOAB damage (`RETICLE_SHARE`), since nothing aimed them. Replaced by aiming (see the graded-run findings).
- **Near ties:** 26% of that match's Jev decisions (40 of 152) had an answer whose top two options were less than 0.10 apart; 23% in the v4 win.

## Findings from the first graded runs (bridge 0.3.11)

Three btd6-playbook-v5 runs at graded:10 were lost at rounds 51, 56 and 51, and a v4 run at graded:10 at round 37 (logs `.private/btd6/runs/2026-09-30T08-39-43-306Z-btd6-playbook-v5.jsonl`, `...08-49-41-964Z...` and `...09-01-37-043Z...`).

- **Dartlings "pointing down"** (Marcus, live). A Dartling fires toward the mouse cursor by default and the runner never moves the mouse; a Heli follows the cursor, and nothing places a Mortar's reticle. The estimates counted all three over the whole track or a quarter of it, which likely inflated the margins that allowed 10x. Now: ruleset v2 leaves them out; bridge 0.3.12 and ruleset v3 aim them; unaimed, they count 0 (ARCHITECTURE.md, "Towers that need a point").
- **Stale hold.** The bfb hold ($3,500 for the Bomb Shooter, rounds 44 to 50) stayed after the Bomb Shooter reached 0-4-2 in round 43. Holds whose targets are all complete now lapse (claude-v1 too).
- **Idle cash.** With the options narrowed to the due target's purchases and waiting, Jev chose waiting (0.58 to 0.63) at every decision while cash rose from $1,090 to $9,851 (run 1, rounds 44-48), $4,067 to $11,550 (run 2, rounds 44-49) and $843 to $7,634 (run 2, rounds 52-55, although the offered upgrades advanced the Ninja the $6,000 hold was for). Round 49 then leaked 66 and 56 lives. v5 revision 2 removes waiting while an on-plan purchase is affordable above the holds for other targets (`idle_cash`). v4 is unchanged.
- **10x.** In run 1 a sampler saw 10x with 32 lives in round 51, and the match was lost before its next sample 2 s later. Time over the match: 1x 36%, 3x 5%, 5x 7%, 10x 52%. The session read the state only between runner steps, and a step with a Jev call takes 1 to 3 s. Now: reads every 250 ms while a step waits, the furthest-bloon threshold drops with the speed (0.5 at 10x, 0.6 at 5x, 0.7 at 3x and below), and MOAB-class rounds and RBE spikes play at most at 5 until the MOAB calibration is measured.
- **10x from high lives.** A third graded v5 run (09:01) dropped to 1x in round 49 on bloons past 0.7 and leak pressure with no lives lost, went to 5x in round 50 and to 10x in round 51 on a pops margin of 4.05, and went from 99 lives to a loss within about 2 s. Now: after a danger drop the next 3 rounds play at most at 5, and round 51 is on the hard-round list (below; it replaced the round-40 rule).
- **v4 at graded, and the catalog.** v4 lost at 37, 42 and 40 at graded:10.
  - Graded speed didn't cut its purchases: 23 to 30 in rounds 10 to 35, against 21 in the 5x win.
  - It spread them over more towers: 13 or 14 towers with 10 to 16 upgrade tiers in all at round 35, against 7 towers and 18 tiers in the 5x win.
  - The 5x win used the old 12-spot catalog; these runs had the new 31-spot one. Speed and catalog changed together, so the next series separates them (step 2).
- **No `moab_measure` records** in run 1, although rounds 40 and 50 were MOAB rounds. Round 40 took 3.5 s of real time at 5x; the runner read the state about three times in it, between Jev calls, so the lead MOAB was likely seen at most once and a single sighting gives no interval. The reads while a step waits should give the measure enough samples. (Run 2 not checked here.)
- **Review of all 26 run logs (2026-09-30), fixed on `bridge-pops`:**
  - No run had a `moab_measure` record because `state.mjs` `normalizeBloons` dropped `bloons.moabs`: the bridge sent it, the Node side never passed it on. The measure's tests built states by hand and skipped normalizing. The same list feeds graded speed's `moab_outrun`, which therefore never fired either. Now the list is kept, and a test sends a bridge-shaped state through `normalizeState`.
  - A `set_speed` refused behind a screen was never resent (run 08-39-43, round 49: 10 to 5 refused with `game_paused` behind a Level Up screen; 10x until leak pressure forced 1x, 98 to 32 lives). The speed keeper now keeps a target pending and resends it once no screen is open.
  - 40 purchases were refused as `stale_towers`: 16 right after a wait (the hero's level had risen, which the towers hash included), 21 1.2 to 1.5 s after a queued purchase (the next decision was built on the state before it applied). Bridge 0.3.13 leaves the hero's level out of the hash (hero upgrades carry `expect.tiers` instead), and the runner waits up to 1.5 s for a queued purchase to show.
  - 308 `spot_fallback` records were for the Monkey Sub, which can't be placed on Monkey Meadow; the runner now skips towers the spot catalog found unplaceable.

## Rule audit (2026-09-30, 24 runs)

`npm run btd6:rules-audit` over the 24 runs up to 09:30 UTC. Two rules that rest on uncalibrated estimates fire mostly in rounds that lose nothing:
- `moab_short` (the interim MOAB factor 2.0): 46 rounds, 83% without lives lost in that round or the next.
- `no_wait_behind` (the pops verdict): 104 rounds, 83% without a leak, 29 of them from round 60 (97% without a leak).

The v5 revision 2 run of 09:30 shows the cost. From round 60 the verdict said `short` at 59 decisions (rounds 74, 75, 76 and 78), and each time `cash_hold_lifted no_wait_behind:short` lifted the $5,000 hold for the Snipers at 4-2-0; `moab_short` and `survival_first` set the plan filters aside, and Jev bought about 25 low-tier Dart Monkeys (63 towers at the end). Rounds 60 to 77 lost no lives; round 78 lost 97. Two causes behind the `short` verdicts:
- 6 or 7 Skywardens were on the track in each of those states, and towers.json has no Skywarden, so they count 0 pops.
- The pops estimate itself: 22 cleared rounds from 60 on in other runs had it below the RBE (docs/ARCHITECTURE.md, "Pops calibration").

Replay of the 59 verdicts with the interim pops factor (1.08 from round 60): 39 stay `short` (all of rounds 74, 75 and 76); the 20 at round 78, all before its leak, become `enough`. It takes 1.5 to turn all 59. The round-78 verdicts were the ones before the loss, so a larger factor would also have removed that warning.

## MOAB requirement replay (2026-09-30)

`moab_short`'s requirement now asks for the kill of the toughest MOAB-class bloon before the exit, times the margin for the lives, with no / 0.8 and no term for the round's total MOAB-class health (ARCHITECTURE.md, "What a MOAB-class round needs"). `npm run btd6:moab-replay -- --factor 1.34` over the 16 finished run logs with a MOAB-class round due:

| Requirement | Rounds where a state with the logged rule is short (lives lost that round or the next) | Rounds where any decision state is short (graded speed's signal) |
|---|---|---|
| First half of the track, / 0.8, with the total term | 72 (13) | 225 (26) |
| Whole track, with the total term | 45 (9) | 135 (17) |
| Whole track, toughest bloon only (current) | 22 (9) | 60 (15) |

- The total term (a round's MOAB-class health over its sending time plus 16 s) set the requirement in rounds 64 (108), 68 (109), 73 (123), 75 (349) and 77 (149), all cleared with nothing lost at 70 to 122 calibrated. The damage figure is for one bloon, while splash and several towers hit the group. Dropping it keeps the same 9 rule rounds with lives lost.
- From round 60 the rule now fires only at rounds 76 to 78, for round 80's ZOMG (130): v6 has 76 to 77, v5 revision 2 120 to 123.
- Round 78 (1 BFB, 150 Rainbow, 147 Ceramic, 80 Purple): v6 lost 68 lives, v5 revision 2 97. Its own check says enough (v6 77 against 27, v5 123 against 27). It stays flagged in both runs only because round 80 is within 4 rounds; in v5 revision 2 by 5%.
- Graded speed follows (`defenceMargins` uses `moabCheck`). With ×1.34, v6's MOAB margin is 2.35 to 4.76 in rounds 52 to 58 and 2.43 to 5.10 in rounds 60 to 78; v5 revision 2's is 3.45 to 6.95 and 3.7 to 7.72. Where the pops margin is also 2.0 or more, those rounds predict 10: in v6 rounds 52 to 58, 60 to 62, 64 to 68, 70 to 74, 77 and 78; in v5 revision 2 rounds 50, 52 to 58, 61, 62, 66, 67, 70, 74 and 78. Rounds 77 and 78 are held at 1 by the `moab_short` signal for round 80. Before, v6 played rounds 60 to 78 at 1 or 3 from its MOAB margin alone.

## Graded speed replay (2026-09-30)

Graded:10 now caps hard rounds at 3, the round before each at 5, the last 6 rounds at 3, and play at most at 5 while the runner is buying (ARCHITECTURE.md, "Graded speed"). `npm run btd6:speed-replay` ran the controller over 29 logged runs (to 19:42 UTC; 25 with speed records for time), each at the factors it was played with, with the hard list built leave-one-out (a run doesn't see its own lost rounds). 87 rounds lost lives.

| Variant | Lost rounds by the level they'd be played at | Minutes (logged 232.7) | Game time at 1 / 3 / 5 / 10 |
|---|---|---|---|
| Graded:10 before this change | 16 at 1, 21 at 3, 29 at 5, 21 at 10 | 187.9 | 17 / 7 / 32 / 45% |
| Hard list, lead at 5 (new default) | 16 at 1, 68 at 3, 2 at 5, 1 at 10 | 241.8 | 16 / 44 / 34 / 6% |
| Lead at 3 | 16, 70, 0, 1 | 255.7 | 16 / 61 / 17 / 6% |
| No lead | 16, 68, 1, 2 (10 more entered at 10 from the round before) | 238.3 | 16 / 44 / 29 / 12% |
| Hard rounds at 5 | 16, 21, 49, 1 | 208.5 | 17 / 7 / 65 / 12% |
| Round data only (no log rounds) | 16, 38, 22, 11 | 221.9 | 16 / 27 / 41 / 16% |
| Log rounds from 2+ runs or 20+ lives | 16, 65, 5, 1 | 238.3 | 16 / 41 / 36 / 8% |
| No buying cap | 16, 68, 2, 1 | 239.6 | 16 / 44 / 31 / 10% |

- The one round at 10x in the new mode is round 19 of run 06-41-10 (1 life, a v3 run at fixed 3x); only that run lost lives there, so leave-one-out drops it. The committed list has it.
- End cap: 0, 3, 6 and 10 rounds lost the same rounds; the last rounds are already listed or held at 1 by `moab_short`. 6 (rounds 75 to 80) is kept for setups with a shorter list.
- 5 is not enough for a hard round: lives were lost at a logged 5x in rounds 3 to 5, 10 and 51 (21 lives, and 79 in a fixed-5x run).
- Little 10x is left because the pops estimate calls most lost rounds safe: 19 of the 24 rounds that lost lives had a margin of 2.0 or more at their start in some run (rounds 4 to 10, 15, 19, 23, 26, 31, 33, 36, 37, 42, 51, 56, 78). With the round before each, most rounds to 63 are capped.
- Time: over the 13 graded-era runs (from 08:39) logged 139.9 min, 93.4 before this change, 129.6 now. v6's win (18:58) 25.4 logged, 17.0 now (8.6 of them at 1, 5.7 at 3). The graded:5 v6 run (19:26) 16.0 logged, 17.0 now. So graded:10 now takes about as long as graded:5, and about half of a v6 run's replayed time is at 1, from `moab_short` in rounds 36 to 40 (for round 40) and 76 to 80 (for round 80) and the cooldowns after it. That signal is the next place to look for time.
- Top speed stays 10: at 10x one 250 ms read already covers 2.5 s of game time, and no run played above 10.
- **Climb-back and buying-cap data (branch `speed-climb`, 2026-09-30, 22 current-era graded runs to 23:50 UTC).** `npm run btd6:speed-replay -- --causes --current-era` gives the time lost per cause from the `speed_set` records; `--fine` replays the `hold 1 s`, `hold 2 s`, `hold 4 s`, `step 2 s`, `buying 0 s` and `buying 1.5 s` variants against graded:10+moab3 with the logged danger signals. The figures went to the primary session, which decides; no speed label or runner behaviour changed. `gradedSpeed` has `jumpHoldMs` and `stepUpMs` as replay options, off by default.
- **Current-era logs and `moab_short` at 3** (replay options, not the default). Current era: run_start's ruleset btd6-open-v2 or later and bridge 0.3.13 or later (`hard-rounds.mjs` `currentEra`, `--current-era`): runs 10:00, 10:07, 18:58, 19:26, 19:42 and 19:52. Their lost rounds on Hard Standard: 4, 9, 33, 37, 40, 42, 51, 56, 76, 78. The 19:52 run is added to the logs (30 runs, 26 timed; logged 238.3 min).

  | Variant | Lost rounds at 1 / 3 / 5 / 10, all runs | Same, current-era runs (13 lost rounds) | Minutes, all runs | Minutes, current-era runs (logged 87.9) | Game time at 1 / 3 / 5 / 10, all runs |
  |---|---|---|---|---|---|
  | graded:10 before this change | 17 / 21 / 29 / 21 | 4 / 3 / 2 / 4 | 192.6 | 53.7 | 17 / 7 / 31 / 46% |
  | New default (all log rounds) | 17 / 68 / 2 / 1 | 4 / 9 / 0 / 0 | 248.4 | 72.5 | 16 / 44 / 34 / 6% |
  | Current-era log rounds only, no round data | 17 / 41 / 16 / 14 | 4 / 5 / 0 / 4 | 212.6 | 61.3 | 16 / 15 / 46 / 23% |
  | Round data plus current-era log rounds | 17 / 46 / 16 / 9 | 4 / 7 / 1 / 1 | 232.7 | 68.2 | 16 / 31 / 40 / 13% |
  | `moab_short` at 3 (all log rounds) | 10 / 75 / 2 / 1 | 2 / 11 / 0 / 0 | 213.7 | 58.8 | 8 / 52 / 34 / 6% |
  | Both | 10 / 53 / 16 / 9 | 2 / 9 / 1 / 1 | 197.9 | 54.5 | 8 / 38 / 40 / 13% |

  - With only current-era log rounds, round 33 of the 10:07 v6 run (24 lives) plays at 10: only that run lost lives there, so leave-one-out drops it, and the round data doesn't flag it. The 10x losses in the all-runs column are old-era rounds (15, 19, 31) that the current-era list no longer has.
  - `moab_short` at 3 moves these lost rounds from 1 to 3: round 78 of 09:30 (97 lives) and 10:07 (68), rounds 36 and 37 of the v4 run at 08:44 (45, 51), round 36 of 08:55 (9) and 09:08 (18), round 37 of 10:07 (4). Round 40 of the 19:52 v6 loss (101 lives; the first MOAB leaked with 3 hp left) stays at 1 in every variant: rounds 36 to 39 move from 1 to 3, but round 40's own MOAB margin is 0.60, which plays at 1.
  - Choice: `moab_short` at 3 with every log round. In the current-era runs it keeps every round that lost more than 5 lives at 3 or below (51, 33, 56, 76 at 3; 78 at 3; both round 40s at 1), and takes 58.8 min against 72.5 for the default and 87.9 logged (v6's win 12.7, the graded:5 v6 win 12.6). It is not the default: it plays rounds that lost 68 to 97 lives at 1 at 3 instead, so it is not better on both columns. Validate it live with `moab_short` at 3 as a run option before making it the default.
- UNVERIFIED: the replay takes a logged 10x as 10 game seconds per second (the game may run slower at 10x), and it has no bloon positions, so `bloons_past` and `moab_outrun` drops are missing from it.

## Time at 1x (2026-10-02; Marcus: "aim for 3x as a minimum")

Wall time by game speed from the `speed_set` records (scratchpad `speedtime.mjs`), with each 1x stretch attributed to the record that set it.

- **CHIMPS:** 11 matches of series 1g, 1h and 1i (216 minutes): 1x 69%, 3x 15%, 5x 14%, 10x 2%. The 1x time came from:
  - the margin below 1.0 with `moab_short` present: 31% of all time (with `--moab-short-speed 3`, the margin grade is what sets 1);
  - the margin below 1.0 on pops: 19% (rounds 7 to 11 under the one-life early margin, and rounds 60 to 73);
  - `moab_outrun`: 11%, plus 4% together with `moab_short`;
  - leak pressure and bloons past: about 4%.
- **Hard Standard:** 10 matches today: 1x 33% (`leak_pressure` 17%, margin 5%, MOAB signals 7%). Series 7 (5 matches): 1x 30%.
- **Cause:** about half of CHIMPS time is MOAB-related. The MOAB figure uses the pinned 1.27, which runs low for CHIMPS (measured damage 1.6 to 2.2 times the estimate on ordinary MOAB rounds), so MOAB rounds look unsafe. The one-life margin (1.5, and 3.0 to round 10) lowers every CHIMPS ratio. Each of these sets 1x.
- **Decided:**
  1. From pair 2 of series 1i onward, both arms run at fixed 3x (`--speed 3`, accepted by both code versions). Pair 1 and pair 2's revision 11 match were at graded speed.
  2. A `btd6-lab` agent is building a speed floor (`--min-speed 3`, label `+min3`) in worktree `speed-floor`, so graded speed never goes below 3x but still uses 5x and 10x. Merge it after series 1i, and use it for later series.
  3. Whether 1x ever saved a match is unmeasured. Leaks happen at 1x by design, because danger drops to 1x before a leak. Series 1i's 3x pairs give the first comparison.

## Findings from v5 revision 3 (majority wait)

- **Majority wait spent the savings.** v5 revision 3 at graded:10 lost at round 51 (`.private/btd6/runs/2026-09-30T10-00-33-227Z-btd6-playbook-v5.jsonl`); revision 2 had reached round 78. In rounds 48 to 50 nothing was due (the Sticky Bomb Ninja was due from 51), and majority wait replaced Jev's "Wait" (0.26 to 0.42) 13 times with the Bomb Shooter placement group, leaving 17 Bomb Shooters at 0-0-0. Round 51 took the match from 99 lives in two decisions. Now: in v5 revision 4 and claude-v1 revision 3, majority wait replaces a wait only with a purchase that advances a due target (ARCHITECTURE.md, "Majority wait"). v6 is unchanged.

## Findings from v5 revision 4 (tower cap)

- **Survival placements without a cap.** The series' first v5 run (revision 4, ruleset v3, graded:5, `.private/btd6/runs/2026-09-30T19-42-45-561Z-btd6-playbook-v5.jsonl`) lost at round 76. In rounds 56 and 57 it lost 20 lives; `leak_pressure` and `survival_first` set the plan filters aside and Jev chose `place:BombShooter` 20 times (19 placed, 1 refused as stale), over $6,000 of 0-0-0 Bomb Shooters, with $6,481 in hand at round 56 and upgrades on offer. It ended with 48 towers, 27 of them 0-0-0 Bomb Shooters. v6, with its 12-tower cap, won in the same series with 99 lives and 24 towers. Now: v5 revision 5 and claude-v1 revision 4 apply v6's cap and exception after their plan filters, also under `survival_first`; placements for a due target that needs a new tower are exempt (ARCHITECTURE.md, claude-v1 enforcement, `tower_cap`).

## Findings: towers without data (2026-09-30)

- **Skywarden missing from the tower table.** `data/towers.json` had 26 towers; the Skywarden, bought often (2,898 tower snapshots in the run logs at this change, 6 or 7 per decision state in v5's late game), wasn't among them, so every estimate counted it as 0 and verdicts such as `no_wait_behind` and `moab_short` called the defence short when Skywardens carried it. Closed: the table now has its 64 upgrade combinations from the same export (f818c39, 56.0); the other entries and `rounds.json` are unchanged. The Sheriff, a Frontier Legends hero with swappable weapons, has no derivable figure and stays out of the table. Towers without data are now left out of the candidates and listed in `run_start` as `no_data`, and `run_start` records the table's content version (`tower_data`), so runs before and after the change can be told apart (ARCHITECTURE.md, "Towers without data").

## Findings from series 3 (2026-09-30 19:26 to 20:50 UTC)

- **Wins:**
  - v5 revision 5 (the playbook with the tower cap): 2 of 2, with 94 and 90 lives, in 11 to 19 min.
  - v6: 1 of 2.
  - claude-v1 revision 4: 1 of 2.
  
  Too few runs for rates (step 7).
- **The tower cap in the plan arms:** in the first v5 revision 5 run it removed off-plan placements at 164 decisions, and its survival exception opened 4 times. That run ended with 21 towers. v5 revision 4, the run before the cap, ended with 48 towers, 27 of them 0-0-0 Bomb Shooters.
- **claude-v1's loss at round 28:** round 28 is the first Lead round, with 6 Leads in 5 s, and the defence could pop no Lead. The Wizards were at 1-0-0, and only 0-1-0 and up pop Lead.
  - **The strategist's error:** its last review, at about round 27, moved the plan's Lead answer from round 27 to round 30.
    The plan also named Wizards at 1-1-0 while all six stayed at 1-0-0, and kept Quincy planned from round 6 until round 28 without placing him. `BTD6-STRATEGIST.md` ("Threats and the hero") now says: `by_round` at least 2 rounds before the first appearance and never moved later, one answer target with the needed tiers and a `cash_hold` for it, and `"none"` for a hero that stays unaffordable. The examples use those `by_round` values.
  - **The code gap:** no survival rule fired in rounds 25 to 28. The Lead check shows Jev "missing: lead" and removes the round-start option (`no_start_short`), but with auto-start on, rounds start by themselves, so nothing forced a purchase that pops Lead.
  - This gap applies to every arm: v6 and v5 had Lead poppers by then, but nothing ensured it. Fixed by `threat_short` (step 0).
- **The strategist:** 19 consults in the win, with 17 plans adopted and a median of 9.7 s; 8 in the loss.
- **Answers to replaced requests:** in the loss the strategist twice answered a request after a newer one had replaced it, and `answer` printed schema errors from the v0 plan format (`priorities`, `build_order`, ...) instead of saying so, because the CLI fell back to its default schema for any ID other than the pending one. Fixed: `answer` now refuses an ID that is not pending before any schema check, names the request that replaced it (reason and round), and exits 1; the same for an unknown ID, no pending request, or an answer not yet taken.
- **`npm run btd6:rules-audit`** over all 34 runs mixes old and new code. Filter with `--runs` to see the current code only.

## Findings: round 78 and round 59 (2026-09-30)

Round 78 of Hard Standard ended 5 current-era runs from about 100 lives: v6 revision 2 at 21:12 (291 lives lost) and 22:38 (241), v5 revision 6 at 21:59 (103) and 22:21 (267), and the earlier v5 revision 2 (09:30, 97) and v6 (10:07, 68). Round 59 ended the v6 revision 2 run at 22:11 (116).

**Round 78: the cause is its end burst, which the whole-round estimate averages away.**
- The round sends 150 Rainbows over 90 s, 75 Ceramics in 1.2 s at 10 s, the BFB at 44 s, 80 Purples from 64 to 79 s and 72 camo Ceramics in 1.2 s at 78 s. Its densest 10 s (from 69 s) hold 8,870 RBE, 7,488 of it camo Ceramics: 493 RBE per second over the window plus the 8 s dwell, 1.83 times the round's average (269) and the highest non-MOAB rate of any round to 80. `roundCheck` compares pops over 98 s with 26,382 RBE, so every run had a margin of 1.6 to 3.5 and nothing fired.
- Timing: the lives went at 87 to 93 s of game time in the four losses with decision states through the round. The leak screenshots show a stream of low layers along the last third of the track. Rates from the towers' pops counts at each decision, 80 to 90 s: 528 to 587 pops per second in the losses, 594 to 742 in the wins (one win's bucket had a gap). The BFB was killed in 9 to 17 s in every run (`moab_measure`), so MOAB damage wasn't the problem.
- Measured capacity: in the four losses with pops measured the towers popped 23,389 to 25,271 of 26,382 (0.89 to 0.96).
- **Purple immunity is not the cause.** The export's Purple has `bloonProperties` 8, and Wizard 3-2-0 and 4-2-0 attacks are immune to it (9.1 of 49.3 and 163.8 pops per second can pop Purple). But the Purple layer is 80 pops of 26,382 (its Pinks aren't immune), and wins 19:26 and 21:41 had 27 to 48% of their measured pops in rounds 77 and 78 from Wizards.
- **Camo capacity alone doesn't separate.** Table camo pops per second (with reach): losses 132 to 477, wins 253 to 607. The camo-only window check flagged every run, wins included, so it was dropped.
- **Per-tower-type estimates are far off** (measured over `est_reach`, median over all current-era `pops_round` tower-rounds, then over rounds that lost lives): Monkey Ace 0.04 and 0.05, Wizard 0.11 and 0.20, Bomb Shooter 0.22 and 0.16, Skywarden 0.20 and 0.22, Dart 0.31 and 0.26, Quincy 0.74 and 1.14, Ninja 1.03 and 1.70, Sniper 2.12 and 2.03. The Ace is the outlier and now counts at 0.1 (`GLOBAL_SHARE`). A per-type factor for the rest, from these leak rounds, didn't separate losses from wins either (0.82 to 1.04 against 0.89 to 2.58), so it isn't applied.

| Run (current era) | Result at 78 | Burst ratio at round 75 / 78 (new check) | Window estimate / peak, no margin, at 78 | Popped at 78 |
|---|---|---|---|---|
| v6 r2 21:12 | lost 291 | 0.87 / 0.90 | 1.30 | 0.92 |
| v5 r6 21:59 | lost 103 | 0.78 / 0.78 | 1.12 | 0.92 |
| v5 r6 22:21 | lost 267 | 0.81 / 0.84 | 1.20 | 0.96 |
| v6 r2 22:38 | lost 241 | 1.14 / 1.17 | 1.68 | 0.89 |
| v6 (r1) 10:07, 56 towers | lost 68 | 1.47 / 1.51 | 2.17 | no est (Skywarden) |
| v5 r2 09:30 (bridge 0.3.12) | lost 97 | 0.98 / 1.04 | 1.49 | not measured |
| v5 r5 20:10 | 9 lost | 0.64 / 0.72 | 1.03 | 1.00 |
| claude-v1 r4 20:29 | won | 0.95 / 0.99 | 1.43 | 1.00 |
| v5 r5 19:58 | won | 0.83 / 1.03 | 1.48 | 1.00 |
| v5 r6 21:28 | won | 0.94 / 1.04 | 1.50 | 1.00 |
| v6 18:58, 19:26, v6 r2 21:41 | won | 1.07 to 1.12 / 1.13 to 1.15 | 1.62 to 1.66 | 1.00 |

Burst ratio: the new `roundCheck` `burst_facts.ratio` at the first decision of the round, with the Ace at 0.1 and `BURST_FACTOR` 0.8; below 1 is short. "Window estimate / peak" is the same without the factor and the margin.

**Round 59: camo Leads with no tower that does both.** The 22:11 run's defence before round 59 had Lead from a Bomb Shooter 0-2-4 and Wizards, camo from Darts, a Ninja and Skywardens, and one tower doing both: a Monkey Ace 4-2-0, whose Lead popping is its Pineapple drops (`MonkeyAce-420.json`: the darts are immune to Lead, the Pineapple attack has no camo filter). With the Ace at its table rate the whole-round margin was 5.5. The leak screenshot shows a line of camo Leads passing the Wizards. The 13 current-era runs that cleared round 59 each had a Sniper, Mortar or Wizard with camo and Lead in one attack. In `towers.json` only the Necromancer tiers split camo and Lead across attacks, so the combined fact matters when different towers cover the two, as here.

**Fix (v6 revision 3, v5 revision 7, claude-v1 revision 6):**
- `rounds.json` `peak` and `camo_lead`, `towers.json` `camo_lead` (same export, f818c39; other fields unchanged, table version `14b45d4c4959`).
- `roundCheck`: `camo_lead` (one tower with both, not the Ace; part of `enough` and `missing`) and `burst` (reported, not part of `enough`).
- The Monkey Ace at 0.1 of its table rate with reach. This changes the shared estimate for every policy that uses reach (v3 on): verdicts, graded speed's margin, `pops_round`'s `est_reach` and the pops calibration's inputs for runs from this commit on.
- `threat_short` with `camo_lead` and `burst` (ARCHITECTURE.md, under v4).

**Replay** (`npm run btd6:threat-replay -- --kinds v2 --current-era --rounds 55-80`, 18 runs, on the logged states):
- Flags and acts on round 78 from round 75 in 3 of the 4 measured losses (21:12, 21:59, 22:21: an answer on offer at 71, 35 and 68 decisions). Not in the 22:38 loss: its window estimate was 1.68 of the peak, as high as the wins, so no factor on this estimate separates it. Not in the 10:07 loss (56 towers, many at 0-0-0).
- Round 59 in the 22:11 loss: `camo_lead` from round 56, an answer on offer at all 10 decisions (cash $10,639 at round 59).
- Round 76 in the v5 revision 4 loss (19:42, 652 lives: 60 Ceramics in 1.8 s): flagged at round 75.
- It also fires in the wins: v5 revision 5 20:10 (rounds 55 and 60 to 78, 119 decisions; it lost 9 lives at 78), claude-v1 20:29 (75 to 78, 25), v5 revisions 5 and 6 19:58 and 21:28 (round 75 only, 2 and 6). Their purchases would go to pops per dollar and waiting would go in those rounds, and in the plan arms the plan's holds step aside (survival rule), so a hold for round 80's MOAB answer waits. The v6 wins aren't touched.
- UNVERIFIED: whether this wins round 78 more often. The replay shows where the rule fires on logged states, not how the match would have gone. Live series runs are needed.

## Pops estimate study (2026-09-30, data only)

`npm run btd6:pops-study` (ARCHITECTURE.md, "Pops study") over the 22 runs with `pops_round` records (10:00 to 23:50 UTC, bridge 0.3.13 and 0.3.14): 1,482 rounds with a first decision state, 45 of them lost lives (26 more than 5), 1,437 clean; 19,849 tower-rounds. No decision code changed.

- Measured over `est_reach` by type, all tower-rounds (median / sum) and under the supply rules (leak median / tight / rel): Dart 0.37/0.41, 0.31/0.60/1.08; Wizard 0.03/0.30, 0.07/0.45/0.76; Bomb 0.19/0.27, 0.19/0.48/0.74; Skywarden 0.27/0.27, 0.22/0.35/0.64; Sniper 1.46/1.46, 1.92/2.19/3.00; Ninja 0.78/1.19, 1.15/1.72/2.45; Ace (at its 0.1 share) 0.43/0.61, 0.58/0.93/1.89; Quincy 0.77/0.91, 0.94/1.24/2.11. Per path in the tool's output.
- Within-round AUC (a leak and a clean run in the same round; 0.5 is none), leaving one run out: current 0.563; leak/type 0.662, leak/path 0.703; tight/type 0.616, tight/path 0.703; rel/type 0.617, rel/path 0.666. From round 30: 0.493; 0.598, 0.680; 0.530, 0.615; 0.566, 0.587.
- Current margin at 2.0 / 1.3 / 1.0: rounds that lost lives below 58 / 33 / 11%, lost more than 5 below 42 / 15 / 12%, clean at or above 70 / 90 / 95%. The fitted factors change the scale (leak fits about 0.25x), so the tool also reports each candidate at the thresholds that keep 70 / 90 / 95% of clean rounds at or above; there, rounds that lost more than 5 below: current 42 / 15 / 12%, leak/path 38 / 27 / 12%, tight/path 27 / 23 / 15%, rel/path 35 / 19 / 15% (leave one run out).
- Round 78 start, current whole margin: in the current-era runs (from 10:07), every run below 2.1 lost lives there (5 of 5: 1.64 to 2.07); of the 9 at 2.27 or above, 7 lost none (10:07 at 3.46 and 22:38 at 2.68 lost 68 and 241). The fitted per-type margins don't show that split. Decision: no fitted factors go into the margins or Jev's facts; they mix a tower's capability with its position and share of the bloons.
- Derivation against the export (`npm run btd6:pops-derive`): Sniper 3-2-0 and 4-2-0 count the shot's damage (20, 30) and leave out the shrapnel (`EmitOnDamageModel`, 5 x pierce 2) and the +50 Ceramic bonus; Bomb 0-2-4 counts 8 cluster explosions at pierce 8 and the main one capped at 10 (179 per second) and leaves out the alternating recursive shot; Wizard 0-0-0 and 1-0-0 count pierce 3 x 1 damage with immunity 73 (Lead, Purple, bit 64); the Skywarden counts both weapons and leaves out its Freeze-state damage and pierce modifiers and attack-speed stacking. The estimate counts a tower's full rate in every round whatever the bloons: in round 56 of 23:38 (40 camo Rainbows and a MOAB) two Bomb Shooters 0-2-4 without camo detection were estimated at 3,473 and popped 72 and 213.
- Candidate estimate (`npm run btd6:pops-study -- --fixes`; nothing fitted; adopted in part, see "Pops estimate changes for series 6" below). Fix 1 (on-damage projectiles) changes 36 of 1,684 table rows (26 Sniper with Shrapnel Shot, 10 Desperado; Sniper 3-2-0 12.6 to 37.7). Within-round AUC, whole / burst, all rounds and from round 30: current 0.563 / 0.563 and 0.493 / 0.493; Fix 1 the same; Fix 2 (camo margin) 0.710 / 0.713 and 0.725 / 0.731; both 0.716 / 0.710 and 0.736 / 0.725; the Purple margin changes no number. At 2.0 / 1.3 / 1.0 (whole, all rounds), rounds that lost more than 5 below and clean at or above: current 42/70, 15/90, 12/95%; both fixes 62/68, 42/89, 35/94%.
- Wizards (`npm run btd6:pops-derive -- --placement WizardMonkey`, rounds where towers popped): 2,260 zero-pop tower-rounds (101 towers) against 2,446 popping (98). All within range of the path, reach factor 1 (median). The stretch they cover starts at 0.59 of the track (median) for zero-pop, 0.22 for popping; by start 0 to 0.25 / to 0.5 / to 0.75 / to 1: 211 / 535 / 1,156 / 358 zero-pop against 1,931 / 377 / 130 / 8 popping (measured over estimated 0.45 / 0.07 / 0.03 / 0).

### Pops estimate changes for series 6 (branch `pops-types`, 2026-10-01; merge after series 5)

Decision-affecting changes (no policy revision bumped here; the revisions from `r78-data`, v6 4, v5 8 and claude-v1 7, are to cover them):
- **On-damage projectiles in `data/towers.json`** (`generate.mjs` counts `EmitOnDamageModel` children: pierce capped at 10, damage, emission count, depth 3). 36 of 1,684 rows change pops per second: 26 Sniper rows with Shrapnel Shot (3-2-0 12.6 to 37.7, 4-2-0 18.9 to 56.6, 2-2-0 4.4 to 23.3, 0-2-4 77 to 154) and 10 Desperado rows (x-x-4 28.7 to 56.1, x-x-5 129 to 211.3). MOAB damage, lead, camo and range are unchanged (shrapnel flies off the bloon hit, so it isn't counted against one MOAB). Table version `984c4369abfb`. This changes every estimate that uses the table: verdicts, graded speed's margin, `threat_short`, Jev's pop facts, `pops_round`'s `est_reach`, for v2, v3, v5, v6 and claude-v1.
- **`btd6-jev-v4` stays frozen** on `data/towers-v4.json` (the previous table, version `14b45d4c4959`) with a hero's level read as before (`towers.mjs` `setTowerTable`, set per session; `run_start.tower_data.table` is `v4`). v2 and v3 read `towers.json` and change.
- **Quincy's level from his first tier** (`estimate.mjs` `heroLevel`). The bridge state carries a hero's level as tiers `[7, 0, 0]` and in its name ("Quincy 7"); logged states keep only the tiers. Live estimates already read the name, so live decisions don't change; replays, the dashboard and tools now read level 7 instead of 1.

New speed label, not the default: **`graded:10+moab3+camo`** (`--camo-margin`). The pops part of `defenceMargins` is min(round margin, camo margin) (`estimate.mjs` `camoCheck`, against `rounds.json` `camo_rbe`), graded on `GRADE_AT_CAMO` 1.95 / 1.29 / 1.01 on this Fix-1 table. On the merged table with corrections A and B, which series 6 plays, the values are 1.82 / 1.17 / 0.88. `graded:10+moab3` keeps its meaning (on the new table).
- **Thresholds** (`npm run btd6:pops-study -- --thresholds`): the graded margin (MOAB part included, each run at its played calibration) at each round's first decision state, 22 runs with `pops_round`, 1,482 rounds, 1,437 clean. 2.0 / 1.3 / 1.0 keep 68.96 / 89.07 / 93.95% of clean rounds at or above on the margin series 5 played with (towers-v4.json, no camo); the camo margin on towers.json reaches those shares at 1.95 / 1.29 / 1.01. Against the margin on the new table without camo the matching values would be 1.91 / 1.24 / 0.89, and the new table without camo matches the old shares at 2.03 / 1.38 / 1.09 (data; `graded:10+moab3` keeps 2.0 / 1.3 / 1.0).
- **Replay** (`--fine`, from branch `speed-climb`, in a scratch merge with this branch; 46 runs, 42 timed; current era 22 runs, all timed). Hard list from all log rounds, leave-one-out:

  | Label and table | Minutes per timed run, all / current era | Lost rounds by level played (all runs) | Lives lost in rounds played at 5x or 10x (current era) |
  |---|---|---|---|
  | graded:10+moab3, towers-v4.json (series 5) | 10.1 / 11.8 | 1: 16, 3: 99, 5: 4, 10: 1 | 122 at 5x (22:11 r59 116, 22:21 r30 6), 0 at 10x |
  | graded:10+moab3, towers.json | 9.8 / 11.6 | 1: 15, 3: 100, 5: 4, 10: 1 | the same |
  | graded:10+moab3+camo, towers.json | 9.9 / 11.7 | 1: 24, 3: 91, 5: 4, 10: 1 | the same |

  - Current-era rounds that lost more than 5 lives, level at the round's start / highest before the loss: the same in all three except 10:00 r51 (105), 19:42 r56 (45), 23:22 r33 (12), 23:38 r56 (31) and 23:50 r33 (20), which go from 3/3 to 1/1 with the camo margin. 22:11 r59 (116) is 5/5 and 22:21 r30 (6) 1/5 in all three; the round-78 losses are 3/3 in all three.
  - With the hard list from current-era log rounds only: 9.6 / 11.3, 9.2 / 11.0 and 9.4 / 11.2 minutes; 125 lives at 5x+ in the current era in all three, 0 at 10x.
  - `--causes` reads the logged `speed_set` records of played runs, so it has no figures for a label not yet played.
- **Skywarden weapons (data, `npm run btd6:pops-derive -- --game-data <clone> --weapons Skywarden` and `--placement Skywarden`):** 38 tier files (all but the x-2-0+ middle path) have one attack with two weapons, MainWeapon and LongWeapon, each rate 1.55, one projectile, pierce 4 (6 from x-0-1), damage 1, radius 2, and a `ToggleFocusStanceModel` with `swapWeapon: true` (range x1.35, rate x1.25); the derivation adds both weapons. Main travels with `TravelStraitSlowdownModel`, Long with `TrackTargetModel`. 0-2-0 has ArcWeapon and LongWeapon and the other middle-path tiers ArcWeapon only, with `swapWeapon: false`. Logged states carry no stance (all `targeting` First), so measured pops can't be split by weapon. Measured over `est_reach` (rounds where towers popped): 2-0-2 1,211 tower-rounds (95 towers), clean 0.28, leak 0.27 (43); 2-0-1 521, 0.24 / 0.17 (9); 1-0-1 202, 0.25; 2-0-3 77, 0.32; 0-0-0 37, 0.14; 2-2-0 (ArcWeapon only) 65 (4 towers), 1.12. By where the covered stretch starts, 0-0.25 / 0.25-0.5 / 0.5-0.75 / 0.75-1: 1,729 / 132 / 216 / 171 tower-rounds, measured over estimated 0.32 / 0.12 / 0.05 / 0.02.
- **Bomb Shooter 0-2-4 clusters:** 8 per contact on a 360-degree `ArcEmissionModel`, each flying 22 to 40 units (`RandomRangeTravelStraitModel`, speed 130) and exploding at the end with radius 15, pierce 8, damage 2; the main explosion has radius 12, pierce 22. On a straight track through the impact point, an explosion reaches the centre line only when its distance times the sine of its angle to the track is at most 15: 2 of the 8 directions if one lies along the track, 4 if the ring is turned 22.5 degrees (bloon size and curves left out).
- **Wizard 0-0-0:** one attack, one weapon: rate 1.1, one projectile, pierce 3, damage 1, radius 4, speed 200 for 0.4 s, range 40, immunity 73, no camo; the derivation uses these and the export has nothing else for it.
- **Candidate corrections A and B (data; `data/towers-candidate.json`, `generate.mjs --candidate`; `towers.json` stays at Fix 1 until decided):**
  - A: under a `ToggleFocusStanceModel` with `swapWeapon: true`, one weapon per attack, MainWeapon (the export names no default stance; MainWeapon is listed first and the other, LongWeapon, fits the stance's range x1.35). B: children in a full ring (`ArcEmissionModel` 360 degrees, not turned with the projectile) that fly further than their explosion's radius count at `RING_SHARE` 0.5.
  - Changed keys, 47: all 38 Skywarden tiers with two weapons (x-0-x: 7.7 to 3.9; 1-0-3 9 and 2-0-3 10.3 to 3.9; x-0-4 15.5 to 7.7; x-0-5 31 to 15.5; 0-0-0 5.2 to 2.6; 4-0-x 10.3 to 5.2 and 15.5 to 7.7; 5-0-x 25.8 to 12.9 and 38.7 to 19.4) and 9 Bomb Shooter tiers (0-0-3 49.3 to 28, 0-0-4 98.7 to 56, 0-0-5 855.6 to 455.6, 0-1-3 65.8 to 37.3, 0-1-4 131.6 to 74.7, 0-1-5 1,140.7 to 607.4, 0-2-3 89.7 to 50.9, 0-2-4 179.4 to 101.8, 0-2-5 1,555.6 to 828.3). No other tower changes.
  - Measured over `est_reach` rescaled to the candidate (clean / leak rounds): Skywarden 2-0-2 0.55 / 0.54, 2-0-1 0.48 / 0.33, 1-0-1 0.50, 2-0-3 0.86, 2-0-4 1.02, 0-0-0 0.28; by stretch start 0-0.25 / 0.25-0.5 / 0.5-0.75 / 0.75-1: 0.64 / 0.23 / 0.09 / 0.04. Bomb 0-2-4 0.41 / 0.29, 0-2-3 0.18 / 0.16.
  - `GRADE_AT_CAMO` on the candidate at series 5's clean shares (`npm run btd6:pops-study -- --thresholds --table candidate`): 1.82 / 1.17 / 0.88 (the candidate without camo: 1.90 / 1.23 / 0.96).
  - Round 78 start, candidate whole / burst: current-era runs that lost lives 1.69 to 1.96 (23:38, 21:59, 20:10, 22:21, 21:12), 2.57 (22:38) and 3.28 (10:07); current-era clean runs 1.90 to 2.44 (21:28 1.90, 19:58 1.92, 23:22 1.98, 18:58 2.11, 20:29 2.28, 19:26 2.43, 21:41 2.44). On towers.json the same runs were 1.83 to 2.21 lost and 2.32 to 2.74 clean, with 22:38 2.82 and 10:07 3.56.
  - Verdicts on every logged decision state (`--verdicts`), round 60-80, `enough` / `threat_short` burst, towers.json then candidate: v6 90 / 5% to 86 / 15%; v5 80 / 25% to 72 / 51%; claude-v1 71 / 24% to 63 / 40%; v4 66 / 53% to 31 / 53%; v3 60 / 61% to 46 / 61%. Rounds 40-59: v6 99 / 0% to 99 / 1%; v5 100 / 3% to 100 / 6%; claude-v1 100 / 6% to 100 / 15%. Rounds 1-39 change by at most 2 points.
  - Replay of `graded:10+moab3+camo` on the candidate with 1.82 / 1.17 / 0.88 (`--fine`, scratch merge with `speed-climb`): 9.9 minutes per timed run (all 42), 11.8 per current-era run (towers.json at 1.95 / 1.29 / 1.01: 9.9 and 11.7); lost rounds by level 1: 22, 3: 93, 5: 4, 10: 1; current era 122 lives at 5x+, 0 at 10x. Current-era rounds over 5 lives that differ from the towers.json `+camo` run (start / highest before the loss): 19:42 r76 (652) 3/3 to 1/3, 23:22 r33 (12) 1/1 to 3/3, 23:22 r51 (16) 3/3 to 1/1, 23:50 r33 (20) 1/1 to 3/3. `graded:10+moab3` on the candidate: 10.2 and 12.0 minutes, 19:42 r76 at 1/1.
- **Not adopted now:** the camo margin in `roundCheck` verdicts and rules; the Purple margin; a position-aware estimate (open items).
- UNVERIFIED: a live run of `+camo` and of the new table; the replay has no bloon positions (`bloons_past`, `moab_outrun` missing) and takes a logged 10x as 10 game seconds per second.

## Fix: Druid vine pops estimate (2026-10-02, branch `druid-fix`)

- **Bug.** `data/towers.json` gave every Druid row with the Jungle vine (0-3-x, 0-4-x, 0-5-x and 1/2-3/4/5-x) 38 to 154 million pops a second. The export writes the vine's grab-and-destroy as pierce 9,999,999 and damage 9,999,999, and `generate.mjs` counted it as pierce 10 x that damage every 2.6 s. In log 2026-10-02T18-17-19 (jev-v6, Hard Standard) a 0-3-2 Druid was estimated at 0.28 to 1.7 billion pops a round in rounds 59 to 64 and measured 96 to 1,985; the round-76 total was 301,547,519 against 6,240 RBE. Every pops-based check counted that Druid as an enormous defence.
- **Fix.** `generate.mjs` counts a projectile with `CollideOnlyWithTargetModel` at pierce 1, and caps the damage of a projectile filtered away from MOAB-class bloons at `KILL_CAP` (104, a Ceramic's RBE). Only the 15 vine rows change: 0-3-2 goes to 51.1 pops a second (about 1,400 a round at round 59; 0-5-0 102.9, 2-5-0 328.5). Recomputed on the log, rounds 59 to 64 total 5,124 to 32,048 against 3,164 to 14,413 RBE. `tower-table-bounds.test.mjs` fails on any row over 20,000 pops a second or over 100 times its tier level's median at rounds 10, 40 and 80 (the highest real ratio is 62).
- **Table version.** `towers.json` `922e6b5e918c` becomes `e185f06f88c1` (`towers-candidate.json` `2fa9c669408f` becomes `f0802fd7406c`). This is a data fix for every current revision, not a new revision: once merged, both arms of a head-to-head use the new table, and runs before it with a Druid at tier 3 on the middle path carry the old estimate. `towers-v4.json` (frozen `btd6-jev-v4`) keeps the old rows.

## Fix: retry transient TypeSafe server errors (2026-10-03, branch `retry-5xx`)

- **Bug.** In log 2026-10-03T02-59-57 (jev-v6), a Jev request at round 55 got `TypeSafe HTTP 520`. The runner logged `error` and `runner_paused`, made no further decisions, and the match was lost at round 76 holding $40,660. Only timeouts were retried.
- **Fix.** `core/jev.mjs` sends a request that gets HTTP 500, 502, 503, 504 or 520 to 524 once more after 1.5 s. If the second attempt also fails, the runner logs the error and pauses as before. 4xx answers are not retried. Each Jev retry (timeout or 5xx) is now logged as a `jev_retry` record with `attempt`, `delay_ms` and either `timed_out` or `status`.

## Next steps, in order

**CHIMPS series 1 (started 2026-10-01 19:09 UTC; Marcus: "continue your recommendations" after the pause from 11:20). Series 1, 1b and 1c lost every match at round 6; series 1d (`btd6-jev-v6` revision 8, `early_short` binding) got past the opening and lost at the first threat rounds; series 1e (revision 9, `threat_short` binding with one life) reached rounds 95, 90, 78, 78 and 28; series 1f (revision 10, the one-life cap) lost its first match at round 51 to a rule deadlock and stopped after match 2; series 1g (revision 11) reached rounds 28, 93, 90, 90 and 90; series 1h runs revision 14 (Lead capacity, DDT-capable MOAB damage, burst stand-aside).**
- **Arm:** `btd6-jev-v6` revision 5 alone, 5 matches, on Monkey Meadow CHIMPS (mode `Clicks`, rounds 6 to 100, 1 life). Code f3519a6.
- **Flags:** as series 7 plus `--setup MonkeyMeadow/Hard/CHIMPS`: `--ruleset v3 --speed graded:10 --moab-short-speed 3 --camo-margin --moab-factor 1.27 --pops-factor 1`.
- **Setup data:** `hard-rounds.json` has a `Tutorial/Hard/Clicks` entry, and `rounds.json` covers rounds 1 to 100. CHIMPS has no measured MOAB factor of its own; the pinned 1.27 comes from Hard Standard, and the composition cap (at most 5x on MOAB-class rounds and RBE spikes) applies while the setup is unmeasured. A dry run with these flags passed first.
- **Decided: v5 doesn't join CHIMPS for now.**
  - It won 4 of its last 13 counted Hard Standard matches (series 5 to 7), and 8 of its 9 losses came at rounds 76 or 78.
  - A CHIMPS playbook would have to be written first.
  - Revisit after v6's CHIMPS results.
- **claude-v1 and the notes arm** join CHIMPS when Claude usage allows (step 8).
- **Results:** both matches lost at round 6, each within 25 seconds of the start.
  - In the second, Jev placed one Bomb Shooter ($405) and started round 6 with $245 unspent.
  - `no_start_short` allowed the start: `roundCheck` rated the round covered (ratio 1.66 at the one-life margin of 1.5, an estimate of about 2.5x the round's RBE). A Red leaked, and with one life that ended the match.
- **Change (v6 revision 6, v5 revision 10, claude-v1 revision 9; v4 unchanged):** with one life, rounds up to 10 need 3.0 times their RBE instead of 1.5 (`estimate.mjs` `EARLY_ONE_LIFE_MARGIN`, `EARLY_ROUND_LAST`). Every check that reads the margin takes the round, so graded speed and the rules that read `roundCheck`'s verdict (`no_start_short`, `no_wait_behind`, `damage_first`, `threat_short`) use it too. With it, the single 0-0-0 Bomb Shooter is short at round 6 (ratio 0.84), and `no_start_short` removes the start while an affordable purchase raises the ratio; with none affordable the start stays.
  - Basis: in the current-era Hard Standard logs, rounds 3 to 10 leaked at estimates up to about 2.2x RBE, and none of 159 round starts at a ratio of 2.0 or more (at 1.15) leaked. 3.0 at one life puts the bar above both.
- **Series 1b:** `btd6-jev-v6` revision 6, same setup and flags.
- **Series 1b result:** `btd6-jev-v6` revision 6 lost at round 6 as well. The new margin blocked "Start round" while the round was short, but Jev placed a Bomb Shooter ($405), then put the rest into that Bomb's 0-0-1 upgrade ($215) instead of a second tower, and started with $30. Four CHIMPS matches in all have been lost at round 6 with a lone Bomb Shooter.
- **Why:** Jev's options show the uncorrected estimate, which rates the Bomb Shooter highest. In the current-era Hard Standard `pops_round` records, rounds 3 to 10, a Bomb Shooter popped about 0.2 of its `est_reach`, a Dart Monkey about 0.5 and a Sniper about 0.75.
- **Change (v6 revision 7, v5 revision 11, claude-v1 revision 10; v4 unchanged): `early_short`** (`early.mjs`, docs/ARCHITECTURE.md). With one life, while the current or next round (both up to 10) is short by `roundCheck` at the 3.0 margin, affordable placements and upgrades go first by the gain in that round's capacity per dollar, with each tower type's pops corrected by its early ratio; "Wait" and "Start round" are removed while one is affordable. It never saves, so with nothing affordable "Start round" stays. It runs after `threat_short` and its order replaces `threat_short`'s burst order. It is a survival rule in the plan policies, and the tower cap passes an answering placement only when no upgrade answers. Jev's facts are unchanged.
  - Data basis: `data/early-ratios.json` (`npm run btd6:early-ratios -- --write`, source ac7ec89): 50 current-era Hard Standard runs (2026-09-30 10:00 to 2026-10-01 10:59 UTC), 905 tower-rounds in rounds 3 to 10. Measured over `est_reach`: Bomb Shooter 0.218 (214 tower-rounds), Dart Monkey 0.476 (603), Sniper Monkey 0.754 (68); all types 0.374. The Monkey Ace (20 tower-rounds, 0.413) is under the 30 needed and uses the all-types ratio, as does any type not seen.
  - Dry run with the series flags: the opening at round 6 is three Dart Monkeys ($215 each), "Start round" at $5; `early_short` acted at all 8 Jev decisions in rounds 6 to 10.
- **Series 1c result:** `btd6-jev-v6` revision 7 lost at round 6 again; the third match (log 2026-10-01T19-30-36) lost as the two before it did. `early_short` acted with `removed: 0`: it only reordered the options, and Jev ignored the order.
  - Decision 1: the rule's first answer was a Mermonkey placement, which has no early data and got the all-types ratio 0.374. Jev placed a Sniper.
  - Decision 2: the rule's first answer was a Dart Monkey placement (0.099 per dollar). Jev bought the Sniper's 0-1-0 upgrade, and started round 6 with $0 and one Sniper 0-1-0.
- **Change (v6 revision 8, v5 revision 12, claude-v1 revision 11; v4 unchanged): `early_short` binds** (`early.mjs` `EARLY_KEEP`, docs/ARCHITECTURE.md).
  - While it acts, the purchases are reduced to its answers whose corrected gain per dollar is at least 0.8 times the best answer's. Lead, camo and camo Lead answers from `threat_short` are always kept, first. Waiting and "Start round" stay removed; with nothing affordable the rule does nothing, so the last option stays.
  - Only types with a measured early ratio (at least 30 tower-rounds: Dart Monkey, Bomb Shooter, Sniper today) are answers; Mermonkey, the Ace and other types without enough data drop out while it binds. The all-types ratio no longer ranks anything.
  - The record logs `removed` and the kept option ids (`kept`).
  - Unit test: the CHIMPS round-6 opening at $650 with no towers keeps only the four Dart Monkey placements; with one Sniper 0-0-0 and $270 the Sniper's upgrades are removed and only Dart placements stay.
  - Dry run with the series flags: revision 8; the opening at round 6 is three Dart Monkeys ($215 each, each decision kept only Dart placements), and round 6 starts with $5.
- **Series 1d result:** `btd6-jev-v6` revision 8, same setup and flags. The opening now holds: the matches lost at rounds 76, 33, 33, 24 and 28. The first match ran from round 6 to 75 without a leak; the other four died at the first threat rounds: 24 (camo), 28 (Lead) and 33 twice (camo).
  - Round-24 loss (log T20-01): from round 21 `threat_short` reported a camo gap with an affordable answer (first `upgrade:392:p3`, a Dart x-x-2 at $215). It only removed waiting (`removed` 0 or 1), and Jev bought two Wizard placements, a Wizard upgrade and a Dart placement with $234 to $342 in hand. The camo bloons of round 24 leaked.
- **Change (v6 revision 9, v5 revision 13, claude-v1 revision 12; v4 unchanged): `threat_short` binds with one life** (`threat.mjs` `bindAnswers`, `THREAT_KEEP`, docs/ARCHITECTURE.md). Hard Standard (more than one life) is unchanged.
  - While `threat_short` has a gap with an affordable answer, the options are reduced to the deciding gap's answers (the first answer's gap in the existing order). Lead, camo and camo Lead: all their affordable answers, in the existing order. `camo_capacity` and burst: the answers within 0.8 of the best gain per dollar, as `early_short` does.
  - Saving is unchanged; the tower cap still passes an answering placement only when no upgrade answers; the first answer always stays.
  - Rounds up to 10: when `early_short` also acts, its set applies (with `threat_short`'s Lead, camo and camo Lead answers first, as before).
  - The record logs `binding: true`, `binding_kind`, `binding_removed` and `kept`.
  - Basis: `early_short` binding fixed the round-6 opening after the order-only version was ignored in series 1c; `threat_short` was order-only in the same way, and Jev ignored it in the round-24 loss.
  - Replay (data only; rounds 20 to 34 of the five series 1d runs, 138 decisions): it would have bound at 17 decisions, and Jev's logged choice was outside the kept set at 13. Round-24 loss: 4 binding decisions (rounds 21 to 24, $234 to $342), each with the $215 Dart x-x-2 first and 2 options kept; Jev's choices there were all removed. Round-28 loss: 1 binding decision (round 26, $506, a Lead gap, first a Wizard x-1-x, 7 kept); Jev's Bomb Shooter placement was among the kept answers, so binding would not have changed that decision.
  - Dry run with the series flags: revision 9 (the simulated game is Tutorial Hard Clicks and ends at round 12 with or without the change).
- **Series 1e (played 2026-10-01 20:19 to 21:32 UTC, `btd6-jev-v6` revision 9, code 4e1c3cb):** rounds **95, 90, 78, 78 and 28**. That's 0 of 5 won, with a median round of 78. Every earlier CHIMPS match had ended at round 6, apart from series 1d's 76.
  - The losses:
    - round 95: a camo regrowing Ceramic;
    - round 90: the first DDT, with `moab_outrun` and `moab_short` firing and $2,383 unspent;
    - round 78 twice: a camo Yellow from the burst;
    - round 28: a Blue.
  - `threat_short` bound at 29 to 43 decisions per match.
  - **What split the matches at round 78, at round 75:**

    | Match | Reached | Towers at round 75 | Cash | Notes |
    |---|---|---|---|---|
    | 1 | 95 | 14 | $1,681 | nearly all at tier 3 or 4; rounds 70–78: 3 placements and 21 upgrades |
    | 2 | 90 | 28 | | |
    | 3 | 78 | 27 | | 10 Bomb Shooters still at 0-0-0 |
    | 4 | 78 | 36 | | 9 Ninjas still at 0-0-0 |

    Round 78 popped 26,375 of 26,382 in match 1, against 25,990 and 24,632 in the losses.
  - The binding answers with one life keep taking cheap new placements, and the tower cap's exception lets an answering placement through when no upgrade answers. The map fills with base towers, and the upgrades that carry rounds 76 and 78 go unbought. That matches v5's Hard Standard losses (24 to 28 towers at round 74).
- **Implemented (series 1f, `btd6-jev-v6` revision 10, v5 revision 14, claude-v1 revision 13; run from 21:38 UTC, code c0ec339):** with one life, the 12-tower cap's survival exception passes only placements that answer a missing Lead or camo (or camo Lead). `camo_capacity`, `burst` and `early_short` answers must be upgrades while 12 or more towers are placed. Below 12 towers, placements stay allowed. The cap's records add `one_life_removed` (docs/ARCHITECTURE.md, "One-life cap"). Replay over series 1e (data only, the logged choices, rounds 40 to 80): 0, 19, 17, 16 and 0 chosen placements removed in the matches that reached 95, 90, 78, 78 and 28, all `burst` (19, 17) or `camo_capacity` (16) answers; of those, 10 (the Bomb Shooter loss) and 9 (the Ninja loss) were at 0-0-0 at round 75, and 4 and 1 at the last logged state. The replay does not model the purchases the saved cash would have made.
- **Series 1f, match 1 (log 2026-10-01T21-38-43): lost at round 51** to camo Blues and Blacks, at 1x. The series stops after match 2 (stop file set at 21:55 UTC), because revision 10 has a rule deadlock. The deadlock is a mistake in my revision 10 design:
  - From round 48, `threat_short` bound on `camo_capacity` (camo margin 0.83 for round 51). `bindAnswers` kept the answers within 0.8 of the best camo gain per dollar: four Ninja placements and no upgrades.
  - With 18 towers and one life, the cap then removed all four (revision 10 passes only Lead and camo placements) and restored "Wait".
  - The rules chose "Wait" at 27 decisions in a row while cash rose from $482 to $11,090.
  - At round 51, `leak_pressure`'s survival exception let five Ninjas through (camo margin 0.83 to 0.97), and the match ended in that round.

  The binding ran first and removed every other option; the cap then removed the binding's answers. Preferring upgrades under the cap still stands; the order of the two rules was wrong.
- **Series 1f, match 2 (log 2026-10-01T21-45-44): lost at round 78** to camo Pinks from the round's burst, at 1x, with 16 towers and $5,007.
  - The deadlock struck again: 21 forced waits in rounds 73 to 75, on a burst gap (burst ratio 0.93 for round 78) whose nine kept answers were all placements.
  - From round 76 the cap alone left "Wait", because no upgrade was affordable. Jev bought a tier-4 upgrade at $10,820 in round 77.
  - Seven of the towers were Wizards at 3-2-0, which have no camo detection.
- **Series 1f: stopped after 2 matches** (rounds 51 and 78), progress data 8a3bccd.
- **Implemented (series 1g, `btd6-jev-v6` revision 11, v5 revision 15, claude-v1 revision 14; v4 unchanged; merged 43b7b62, code 73afc95; series 1g started 22:05 UTC, 5 matches):**
  - With one life and the cap in force (12 or more towers), a rate-kind binding (`camo_capacity`, burst) and `early_short`'s binding choose among the answers the cap allows: affordable upgrade answers (and the plan arms' exempt placements), within 0.8 of the best of those.
  - When the options hold no such answer, the binding's placement answers pass the cap, as in revision 9.
  - The cap never leaves "Wait" alone while a binding has answers.
  - Lead, camo and camo Lead answers, more than one life, and fewer than 12 towers are unchanged.
  - Code: `applyTowerCap`'s `bindUnderCap` option (`false` gives revision 10); the binding rules carry their answers before the keep cut (`threat.mjs` `withBindAnswers`, not logged). Records: `tower_cap` adds `cap_binding`; the placement pass is `tower_cap_exception` with `placement_pass: true` (docs/ARCHITECTURE.md, "One-life binding under the cap").
  - Tests: `one-life-bind.test.mjs`, 7 tests (`npm test` 400 of 400); dry runs of v6, v5 (with `--playbook` the Hard Standard playbook, as no CHIMPS playbook exists) and claude-v1 on the series setup record revisions 11, 15 and 14. The round-48 state of series 1f match 1 is the fixture `fixtures/one-life-bind-r48.json`: revision 10 leaves only "Wait"; revision 11 leaves the Sniper's camo upgrade (0-0-0 to 0-1-0, $270), the one affordable upgrade answer. The logged `threat_short` record reproduces with no track; the Monkey Meadow fixture track adds a `moab_short` the log does not have.
  - Replay (`npm run btd6:threat-replay -- --one-life-bind --since 2026-10-01T20-19 --mode Clicks`, the CHIMPS v6 logs, no track, leak pressure from the logged rules; counts only). Decisions left with only "Wait" while a binding had an answer, revision 10 / 11: 40/0, 52/0, 34/0, 58/0, 0/0, 17/0 and 32/0 in the seven logs from 20:19 to 21:45 (the last was still being written). Decisions where placements passed the cap: 5/4, 1/14, 1/6, 5/32, 0/0, 5/0 and 2/32; of revision 11's, 1, 13, 6, 28, 0, 0 and 32 through `placement_pass`. Revision 10's rule kinds match the logged ones at 80 to 90% of rebuilt decisions (the first five logs ran revision 9).
  - **Risk to watch in series 1g:** the placement pass fires often in late rounds, when the remaining upgrades are tier 4 or 5 and out of reach. That's the pattern that filled the map with 0-0-0 towers in series 1e. Record the towers at round 75 and the `placement_pass` count in each match.
  - **Next change, if the spam returns:** under the cap, save for an upgrade answer that isn't affordable yet, and pass placements only when no tower can be upgraded to answer. `leak_pressure`'s survival exception already covers emergencies.
  - **Separate open problem:** round 78's camo burst needs camo capacity built over more rounds than `threat_short`'s three-round lead.
- **Series 1g, match 1 (log 2026-10-01T22-05-31): lost at round 28** to the round's Leads (a Lead and its Black children at the exit), with 12 towers.
  - `threat_short` flagged a missing Lead answer at round 25, and the binding bought one Lead-popping upgrade. After that the check counted Lead as answered.
  - The whole-round margin for round 28 was 2.46 (RBE 138, estimate 520), but only 96 were popped.
  - This is the third CHIMPS loss at round 28's Leads in 12 matches: series 1d, series 1e's Blue (a Lead's descendant), and this one. claude-v1 also lost at round 28 on Hard Standard in series 3.
  - The Lead check is yes-or-no: one tower that can pop Lead counts as answered, however little of the Lead group it can handle.
- **Implemented on branch `lead-capacity`, not merged (`btd6-jev-v6` revision 12, v5 revision 16, claude-v1 revision 15; v4 unchanged; merge after series 1g):** a `lead_capacity` kind in `threat_short`, the Lead counterpart of `camo_capacity`.
  - **Margin:** for a round within the three-round lead that has Lead bloons (any Lead variant, and DDTs), the Lead-capable capacity is the estimated pops, with reach, of the towers that can pop Lead. The margin divides it by the full RBE of the round's Lead bloons, children included.
  - **Threshold:** short below 1.0, as for camo.
  - **Answers:** purchases that raise the Lead-capable capacity, by gain per dollar. It is a rate kind, so it binds with one life as `camo_capacity` does, including revision 11's choice under the cap. With more lives it orders the answers only.
  - **Saving (added the same day, same revisions):** with one life, while none of its answers is affordable, it saves for the cheapest Lead-capacity answer as the check kinds do (`saving`, `for`). Leak pressure stops it, as it stops theirs. While `moab_short` fires (`moabFirst`) it is set aside as `camo_capacity` is, with one life too: no Lead-capacity answers put first and no Lead-capacity saving; the check kinds are unchanged. With more lives there is no saving. `camo_capacity` and burst still never save.
  - Graded speed is unchanged.
  - Code: `threat.mjs` `THREAT_KINDS_V4` (`threatKinds: THREAT_KINDS_V3` gives the earlier revisions), `estimate.mjs` `leadCheck` and `leadRbe` (DDTs and every Lead variant, full RBE with children; the margin includes the lives margin, as the camo margin does). Order of kinds: check kinds, `camo_capacity`, `lead_capacity`, burst. Records: `lead_capacity: {round, lead_margin, at}`, `first_lead_gain`, `binding_kind: 'lead_capacity'`, `cap_binding.kind: 'lead_capacity'` (docs/ARCHITECTURE.md, "threat_short Lead capacity").
  - Tests: `lead-capacity.test.mjs` (14 tests) and a Lead study test in `camo-replay.test.mjs`; `npm test` 415 of 415. Dry runs of v6, v5 (with `--playbook` the Hard Standard playbook) and claude-v1 on the series setup record revisions 12, 16 and 15.
  - Fixture `fixtures/lead-capacity-r28.json`: the 17 decisions of series 1g match 1 in rounds 25 to 27. Revision 12 flags `lead_capacity` for round 28 at all of them; revision 11 at none, and it reproduces the logged rules. The Lead margin for round 28 is 0 before the Wizard's 1-1-0 and 0.39 (80 of 207) after it, through round 27.
  - Through round 25's upgrade the Lead check decides, as before. At the 13 decisions after it no logged option raised the Lead margin, and revision 12 saves for the cheapest answer, another Wizard's 0-1-0 ($325), leaving only "Wait". That blocks the four logged purchases: a Glue Gunner ($245, round 26), a Wizard 0-0-0 ($270), a Skywarden ($220) and the Skywarden's 0-0-1 ($160, all round 27). Adding back the Glue Gunner's cost, the cash at the last decision of round 26 would have been $359, enough for the $325 answer; the fixture judges each decision on its logged cash.
  - Replay (`npm run btd6:camo-replay -- --lead`, counts only; current-era Hard Standard and CHIMPS logs from 2026-09-30T10-00, 73 runs: 50 Hard Standard, 23 CHIMPS). Lead margin at the first decision of each round with Lead bloons, against rounds that lost lives:

    | Lead margin | rounds | runs | rounds with lives lost | runs with such a round |
    |---|---|---|---|---|
    | <0.5 | 7 | 7 | 4 | 4 |
    | 0.5-1 | 12 | 11 | 1 | 1 |
    | 1-1.5 | 20 | 14 | 0 | 0 |
    | 1.5-2 | 12 | 10 | 0 | 0 |
    | >=2 | 483 | 56 | 10 | 8 |

    The four below 0.5 that lost lives were all at round 28 (logs 2026-09-30T20-45-16, 2026-10-01T20-05-25, 21-28-36 and 22-05-31); the one at 0.5-1 was round 95 (2026-10-01T20-19-27). CHIMPS alone: 6/3, 6/1, 11/0, 2/0 and 61/1 (rounds / rounds with lives lost).
  - Per CHIMPS v6 log (decisions / `lead_capacity` due / due with an affordable logged answer / decisions that save for Lead capacity where revision 11 doesn't / longest saving stretch in decisions, rounds). Each decision is judged on its logged state, so the cash a saving would have kept isn't added back. Revisions 5 to 7 (9 short logs): 0. Revision 8: 505/5/3/2/1,1; 105/9/3/6/3,1; 82/10/6/3/1,1; 76/0/0/0; 95/15/6/5/2,1. Revision 9: 535/110/51/26/3,1 (round 93); 559/23/4/19/13,4 (rounds 26-29); 349/21/7/11/3,1; 412/8/2/6/6,2; 92/16/4/7/3,2. Revision 10: 211/12/4/8/3,2; 323/6/1/5/5,2. Revision 11: 22-05-31 109/24/1/18/17,4 (rounds 25-28); 22-09-52 595/52/25/20/5,1. With `moab_short` setting the gap aside (the second addition), the 20-19-27 log went from 41 saving decisions and a 14-decision stretch at round 95 to 26 and 3 at round 93; the others are unchanged. The Lead-margin table above predates 22-09-52's end: rerun on 74 runs, 1.5-2 has 14 rounds, 1 with lives lost (22-09-52, round 93).
- **Series 1g, match 2 (log 2026-10-01T22-09-52): lost at round 93** to camo DDTs, at 1x. Round 93 is the second-furthest any CHIMPS match has reached, after series 1e's 95.
  - It passed round 78 with 21 towers at round 75, none at 0-0-0.
  - Under revision 11: no forced waits; 29 binding decisions; the cap's binding acted at 7 and passed placements at 6; 13 placements from round 40 on.
  - It ended with 26 towers plus the hero, 10 of them Skywardens.
  - **What MOAB damage reached DDTs:** at round 90 (DDTs only), the measured MOAB damage was 116 per second, about the estimate of 110. On the MOAB rounds around it (88, 89, 91 and 92), it was 172 to 246 per second, 1.6 to 2.2 times the same estimate. The MOAB check counts every tower's MOAB damage against DDTs, including towers without camo detection or Lead popping. It rated round 90 at 1.4.
  - **Round 93** (Fortified BFBs and MOABs, and camo DDTs): 23,149 of 43,536 popped.
  - Series 1e's round-90 loss was also the first DDT, with `moab_short` firing and $2,383 unspent.
- **Decided (`btd6-jev-v6` revision 13, v5 revision 17, claude-v1 revision 16; v4 unchanged; on branch `lead-capacity` after revision 12; merge after series 1g): DDT-capable MOAB damage. Implemented.**
  - In `moabCheck` (moab.mjs), a DDT counts only the MOAB damage of towers that can hit it: camo detection, and damage that pops Lead and Black, from the tower data. This includes the DDTs inside a BAD.
  - The check takes the toughest need across the round's MOAB-class bloons, so DDT rounds get their own damage figure.
  - Everything that reads the check uses the same figure: `moab_short`, `moab_outrun`, graded speed, and the answers' gains.
  - Other MOAB-class bloons are unchanged.
  - The replay must report, for DDT rounds in the current-era logs, the measured damage on DDTs against the old and the new estimate.
  - **Implemented on branch `lead-capacity`** (not yet merged; revisions 13, 17 and 16 in `run_start`):
    - Capability comes from `data/towers-ddt.json`, a new file written by `generate.mjs` from the same export (56.0). A tower counts when one attack sees camo and has a projectile hitting MOABs whose `immuneBloonProperties` has neither Lead (bit 1) nor Black (bit 2). Black is known for every tower in the table. `towers.json` is unchanged, as is its version.
    - A BAD's three inner DDTs count at the DDT-capable figure, and the rest of it at every tower's. `setDdtCheck(false)` gives the earlier revisions; v4 never uses it.
    - Tests: `ddt-check.test.mjs` has 7 tests, plus one replay test (`npm test` 423 of 423). Dry runs of v6, v5 (with the Hard Standard playbook) and claude-v1 on the series setup record revisions 13, 17 and 16.
    - Replay (`npm run btd6:moab-replay -- --ddt`, counts only). DDT measures in the current-era logs, as damage per second (estimates uncalibrated, then times the factor 1.27):

      | Run (CHIMPS) | Round | Measured | Old estimate | DDT-capable estimate | Lives lost |
      |---|---|---|---|---|---|
      | 10-01 20:19 | 90 | 136.4 | 154.9 (196.7) | 60.3 (76.6) | 0 |
      | 10-01 20:19 | 93 | 165.1 | 161.7 (205.4) | 60.3 (76.6) | 0 |
      | 10-01 20:19 | 95 | 141.9 | 165.7 (210.4) | 60.3 (76.6) | the loss |
      | 10-01 20:41 | 90 | 104.9 | 74.5 (94.6) | 15.6 (19.8) | the loss |
      | 10-01 22:09 | 90 | 116.3 | 109.5 (139.1) | 38.5 (48.9) | 0 |
      | 10-01 22:09 | 93 | 186.1 | 110.4 (140.2) | 38.5 (48.9) | the loss |

      No Hard Standard log has a DDT measure.
    - In match 2 (22:09), the check rates round 90 at 0.49 instead of 1.4, and round 93 at 0.49 instead of 1.41.
    - New `moab_short` flags in the CHIMPS logs (states short with the check and not without it): 7 rounds, all in the 20:19 match.
      - Rounds 86 to 88 are short for round 90; rounds 89 and 90 for rounds 90 and 93; rounds 91 and 92 for rounds 93 and 95.
      - In the other two matches the states were already short for other rounds, so the check only adds due rounds there.
  - **Assessment (primary): the new figure runs low, so the check is conservative on DDT rounds.**
    - **On DDT-only rounds:** measured damage is 2.3 to 3.0 times the new uncalibrated estimate (136/60, 142/60 and 116/38.5; the 20:41 run, which lost to its DDTs, is 6.7).
    - **On ordinary MOAB rounds** in match 2 (88, 89, 91, 92): measured damage is 1.6 to 2.2 times the all-tower estimate.
    - Part of the gap is the pinned factor of 1.27, which comes from Hard Standard and is low for CHIMPS. Part may be capable damage the per-tower data misses, such as camo granted by another tower.
    - The direction is right (a Skywarden adds nothing for DDTs), and two of the three matches that reached round 90 died to DDTs, so the check is merged as built. No fitted factor is added.
    - **Watch in the next series:** spending on DDT damage in rounds 82 to 95, and whether it costs rounds 95 to 100. The pinned MOAB factor for CHIMPS stays an open item.
- **Series 1g, match 3 (log 2026-10-01T22-33-39): lost at round 90**, the first DDT round, to DDTs and camo regrowing Ceramics, at 1x.
  - It had 36 towers at round 75 (none at 0-0-0, but many Bombs at 0-2-0 and Skywardens at tier 1 or 2), and 38 at the end.
  - Revision 11's placement pass fired 17 times:
    - 15 for `burst` gaps: rounds 60 to 62 for round 63, then rounds 73 to 75 for round 76;
    - 2 for `camo_capacity` at round 53.
  - Each burst pass bought a Skywarden, Bomb Shooter or Dart Monkey at $200 to $400, raising the burst ratio by about 0.01. Ten placements took round 76's ratio from 0.80 to 0.93.
  - Across CHIMPS so far, matches with fewer towers at round 75 went further: 14 towers reached round 95, 21 reached 93, 28 and 36 reached 90, and 27 and 36 reached 78.
- **Decided (`btd6-jev-v6` revision 14, v5 revision 18, claude-v1 revision 17; v4 unchanged; on branch `lead-capacity` after revision 13; merge after series 1g): Burst stand-aside under the cap. Implemented.**
  - With one life and the cap in force, a `burst` binding with no affordable allowed answer steps aside: `threat_short` only orders the options for that decision, and the cap removes placements as usual. There is no placement pass for burst. So Jev buys upgrades or waits.
  - A burst binding with an affordable upgrade answer still binds (revision 11).
  - `camo_capacity`, `lead_capacity` and `early_short` keep revision 11's placement pass, because a camo or Lead capacity gap can need a new camo or Lead tower. A burst gap asks for more damage in a window, which upgrades give at less cost per tower.
  - Basis: 15 of match 3's 17 placement passes were burst gaps. In series 1e, the placements revision 10 would have removed were all `burst` or `camo_capacity` answers.
  - **Implemented on branch `lead-capacity`** (not yet merged; revisions 14, 18 and 17 in `run_start`):
    - `applyTowerCap`'s `burstStandAside` option (on by default; `false` gives v6 revision 13, v5 17, claude-v1 16). The `threat_short` binding record carries its order-only options (`withBindAnswers` `unbound`, not logged). When a burst binding would pass placements, those options go through the cap as without a binding. The cap record shows `burst_stand_aside: true`. If the cap would leave nothing at all, revision 11's pass still applies.
    - Fixture `fixtures/burst-stand-aside-r73.json`: match 3's 10 placement-pass decisions in rounds 73 to 75, rebuilt from the log with no track. Revision 13 passes a burst placement at all 10. Revision 14 leaves no placement and no lone "Wait": only affordable upgrades, 2 to 17 per decision (4, 2, 4, 3, 8, 14, 12, 5, 7, 17), none of them a burst answer.
    - Tests: 6 new in `one-life-bind.test.mjs` (`npm test` 429 of 429). Dry runs of v6, v5 (with the Hard Standard playbook) and claude-v1 on the series setup record revisions 14, 18 and 17.
    - Replay (`npm run btd6:threat-replay -- --one-life-bind --stand-aside --since 2026-10-01T20-19`, counts only, no track, DDT check on). Over the 11 CHIMPS v6 logs from 20:19 (4,099 decisions rebuilt, 29 skipped; the 22:55 log was still being written):
      - placement passes, revision 13: 111 burst, 66 `camo_capacity`; revision 14: 0 burst, 66 `camo_capacity`;
      - burst stand-asides, revision 14: 111;
      - decisions left with only "Wait": 1,607 in revision 13 and 1,659 in revision 14; with a purchase among the options, 897 and 949.
      - The no-track replay does not reproduce the logged bindings exactly (match 3's log has 2 `camo_capacity` passes; the replay finds 41).
- **Series 1g, matches 4 and 5 (logs 22-55-34 and 23-24-18): both lost at round 90 to DDTs.**
  - Match 4 had 31 towers at round 75 and 13 placement passes. In rounds 89 and 90 the cap left only "Wait" with $1,620 to $2,587, because no upgrade was affordable.
  - Match 5 had 29 towers at round 75 and 13 placement passes.
- **Series 1g result (`btd6-jev-v6` revision 11, played 22:05 to 23:46 UTC, progress data 462d122):** rounds 28, 93, 90, 90 and 90, median 90. Series 1e had a median of 78.
  - Four of the five passed round 78, and every one of those died to DDTs (rounds 90 and 93).
  - No forced waits while bound in any match.
  - Placement passes per match: 0, 6, 17, 13 and 13. Towers at round 75: 21, 36, 31 and 29.
- **Series 1h (started 2026-10-01 23:47 UTC):** `btd6-jev-v6` revision 14 (lab 784de19, code cb3bc8d), 5 matches, with the same setup and flags. It runs revisions 12 to 14 together; they act in different rounds, so each match's death round shows which one failed. Check:
  - round 28: `lead_capacity` saving and binding;
  - rounds 82 to 95: `moab_short` from the DDT check, the DDT-capable damage bought, and the cash it took;
  - the towers at round 75, and burst stand-asides against placement passes.
- **Series 1h, match 1 (log 2026-10-01T23-47-14): lost at round 37** to the camo children of the round's 7 camo Whites, with 13 towers.
  - Round 28 held: `lead_capacity` saved $325, bought a Lead-capacity upgrade (Lead margin 0.77), and round 28 popped 143 of 138.
  - Round 37 has 82 bloons (25 Black, 25 White, 15 Lead, 10 Zebra, 7 camo White), with a camo RBE of 77 out of 1,202. Its camo margin was 13.74, and no `threat_short` fired from round 31.
  - The only camo towers were two Dart 3-0-2s. The camo margin counts camo-capable capacity as if it went only to camo bloons, but those towers spend most of their attacks on the other 75.
  - This is the first loss at round 37 in about a dozen CHIMPS matches that reached it. Recorded as a known weakness of the camo margin; no change yet.
- **Series 1h, match 2 (log 2026-10-01T23-52-01): lost at round 95**, the CHIMPS best so far (with series 1e's), to regrowing Ceramics, a Zebra and a DDT.
  - It had 19 towers at round 75 and 31 at the end; 12 Ninjas came through the camo placement pass in rounds 92 to 95.
  - **DDTs were handled:** `moab_short` never fired in rounds 86 to 95; the DDT-capable figure covered rounds 90 and 93, and the match passed both. Measured damage on round 90's DDTs was 385 per second.
  - **Burst under the cap (revision 14):** in rounds 60 to 65 and 73 to 75 the binding stood aside and the cap left only "Wait" while no upgrade was affordable (62 decisions). Cash then went into upgrades, for example $3,617 to $440 in round 73.
  - **Round 95:** `threat_short` flagged `camo_capacity` (0.49 at round 92, 0.63 at round 95) and `lead_capacity` (0.84) from round 92. Camo answers were Ninja placements.
  - **A mistake in my revision 12 design:** `lead_capacity` counts DDTs as Lead bloons. Round 95's Lead RBE is mostly its 30 camo DDTs, and the rule saved for a $405 Bomb Shooter at about 70 decisions in rounds 92 to 95. A Bomb Shooter can pop Lead but can't damage a DDT (Black). DDTs are already covered by the MOAB check's DDT-capable figure (revision 13).
- **Implemented on branch `lead-no-ddt`, not merged (`btd6-jev-v6` revision 15, v5 revision 19, claude-v1 revision 18; v4 unchanged):** `lead_capacity` counts only Lead bloons that aren't MOAB-class: Lead and its camo, fortified and regrow variants. DDTs, including those inside a BAD, are left to the MOAB check. Everything else in revisions 12 to 14 is unchanged.
  - The series stopped after match 3. It was then resumed at 00:29 UTC for matches 4 and 5 on revision 14, so the game isn't idle while revisions 15 and 16 are built. Series 1i runs revision 16.
  - Code: `estimate.mjs` `leadRbe`/`leadCheck` option `ddt`, `threat.mjs` option `leadDdt` (`threatOptions.leadDdt: true` gives the earlier revisions), `leadDdtFor` for the dashboard.
  - Fixture `fixtures/lead-capacity-r95.json` (129 rule decisions of match 2 in round 90 and rounds 92 to 95):
    - round 95: Lead RBE 30,980 with the DDTs (24,480 from the 30 camo DDTs) and Lead margin 0.85; 6,500 and 4.04 without them;
    - revision 14 reproduces the logged margins and the 71 saving decisions ($405 for a Bomb Shooter); revision 15 doesn't flag `lead_capacity` at any of them and doesn't save;
    - round 90: 3,748 and 2.35 with its 3 DDTs, 1,300 and 6.77 without; neither revision flags it.
  - Unit tests: a DDT-only round (93) gets no flag; round 90 counts only its Leads; round 28 is the same under both; `leadDdt: true` still gives the old count. `npm test` 431 of 431.
  - Replay (`npm run btd6:threat-replay -- --lead-ddt --since 2026-10-01T23-47`; counts at 00:43 UTC, the 00-29-52 log still being written). Decisions where `lead_capacity` is due, then saving decisions, revision 14 against revision 15:
    - 23-47-14 (93 decisions): 4 and 3 against 4 and 3 (round 25);
    - 23-52-01 (618): 128 and 73 (rounds 25 and 92 to 95) against 2 and 1 (round 25);
    - 00-22-58 (116): 16 and 13 against 16 and 13 (rounds 25 to 27);
    - 00-29-52 (262 so far): 0 and 0 under both.
- **Series 1h, match 3 (log 2026-10-02T00-22-58): lost at round 40**, the first MOAB round, to the MOAB's children (Greens and Reds), with 15 towers and $55.
  - `lead_capacity` saved at 17 decisions in rounds 25 to 27, bought a Bomb Shooter and an upgrade (Lead margin 0.39 to 0.75), and round 28 held.
  - `moab_short` flagged round 40 from round 36: MOAB damage 4.3 per second against 18.8 needed. It removed only "Wait". Jev bought upgrades for $250 to $400 each in rounds 36 to 37, and the MOAB figure stayed short.
  - Every other gap now binds with one life: `early_short` from revision 8, `threat_short` from revision 9, `lead_capacity` from revision 12. `moab_short` is the v4 rule and still only removes "Wait". Series 1e's round-90 loss also had `moab_short` firing with $2,383 unspent.
- **Implemented on branch `lead-no-ddt`, not merged (`btd6-jev-v6` revision 16, v5 revision 20, claude-v1 revision 19; v4 unchanged; after revision 15): `moab_short` binds with one life.**
  - While a MOAB-class round within `moab_short`'s lead is short, and an affordable purchase adds MOAB damage for that round (revision 13's per-round gain, so DDT rounds count only DDT-capable damage), the options are reduced to those purchases within 0.8 of the best MOAB gain per dollar.
  - Under the cap, revision 11's choice applies: affordable upgrade answers first, placements only when none.
  - Lead, camo and camo Lead answers from `threat_short` stay first, as they do now while `moab_short` fires.
  - With nothing affordable that adds MOAB damage, the rule does what it does now (no saving).
  - More than one life is unchanged.
  - Code: `policy-v4.mjs` option `moabBinding` (`applyMoabBinding`), on in `floorRulesV6` and the v5 and claude-v1 floors; `moabBinding: false` gives the earlier revisions. It runs after `threat_short`; when that bound, its record shows `deferred_to: 'moab_short'`. A `threat_short` saving for a check kind stands. Under the cap `capBinding` takes `moab_short` as it does the other bindings (`cap_binding` kind `moab_short`, or `placement_pass`).
  - Fixture `fixtures/moab-bind-r40.json` (the 30 rule decisions of match 3 in rounds 36 to 39; track, DDT check, MOAB factor 1.27):
    - revision 15 reproduces all 30 logged rule lists and keeps every logged choice;
    - revision 16 binds at 21 and removes the logged choice at 18 (upgrades with no MOAB gain for round 40, and two weaker placements);
    - what stays, in MOAB damage per second per $1,000: the Skywarden placement at S10 (3.18, at 10 decisions; 2.27 to 2.73 at 6 more, with a second spot at 1.82 to 2.27), four Sniper placements (4.47), a Dart Monkey placement (1.40), and three upgrades kept under the cap ahead of better placements: the new Dart Monkey's 0-0-1 (2.11) and 0-0-2 (0.47) and a Bomb Shooter's 0-2-2 (0.47).
  - Unit tests (`moab-bind.test.mjs`): binding with one life, none with two lives or in v4, check answers first, under the cap upgrades first then the placement pass, no affordable MOAB adder unchanged, a DDT round counts only the DDT-capable upgrade, and the v5 floor binds. `npm test` 438 of 438.
  - Replay (`npm run btd6:threat-replay -- --moab-bind --since 2026-10-01T20-19`, track on, run at 01:26 UTC with 00-55-56 still being written; about 25 minutes). Per CHIMPS v6 log, rebuilt decisions, then decisions where revision 16 binds, then logged choices it would remove (of those, choices that added no MOAB damage):
    - 20-19-27 (461): 95, 73 (68); 20-41-44 (464): 182, 160 (156); 21-02-44 (281): 51, 40 (37); 21-14-37 (329): 67, 47 (38);
    - 21-28-36 (52): 0, 0; 21-38-43 (156): 30, 16 (16); 21-45-44 (269): 46, 33 (32); 22-05-31 (61): 0, 0;
    - 22-09-52 (510): 166, 148 (144); 22-33-39 (524): 212, 173 (170); 22-55-34 (620): 228, 206 (204); 23-24-18 (506): 186, 165 (160);
    - 23-47-14 (93): 10, 6 (4); 23-52-01 (618): 181, 162 (158); 00-22-58 (116): 24, 20 (17); 00-29-52 (477): 166, 147 (145); 00-55-56 (292 so far): 36, 29 (28);
    - totals: 5,829 decisions, 1,680 binding, 1,425 logged choices removed (1,377 with no MOAB gain). `moab_short` fired only with one life in these logs, so every firing bound. Rounds: 36 to 40 in every log that reached them, 46 to 49 in some, 75 to 85 in the long ones (and 90 once).
- **Assessment (primary): revision 16 as built would bind too often.**
  - It binds at 1,680 of 5,829 rebuilt decisions (29%). While `moab_short` fires, the rate kinds (`camo_capacity`, `lead_capacity`, burst) are set aside.
  - The MOAB figure uses the pinned factor 1.27, which runs low for CHIMPS: measured damage on ordinary MOAB rounds is 1.6 to 2.2 times the estimate (series 1g match 2, rounds 88, 89, 91 and 92). Many of these shortfalls aren't real, and binding on them would steer the build to MOAB damage at the cost of camo, Lead and burst.
  - The real cases are far below 1:
    - round 40 of series 1h match 3, at 3.4 to 4.3 against 18.8 (0.18 to 0.24);
    - the round-90 DDT losses, at 0.14 to 0.31 of the DDT-capable figure from round 89.
- **Series 1h, matches 4 and 5 (revision 14):**
  - **Match 4 lost at round 90** to DDTs, with 21 towers at round 75. From round 86, nothing affordable added DDT-capable damage, so `moab_short` did nothing and logged nothing. Recomputed from round 89's towers, the DDT-capable figure for round 90 was 13.5 against 99.3 needed.
  - **Match 5 lost at round 76** to the regrowing Ceramics burst. Under revision 14, with no upgrade affordable, it saved and bought one upgrade of about $3,000 per round. The burst ratio rose only from 0.77 to 0.81. Under revision 11, cheap placements took series 1g match 3 from 0.80 to 0.93, and it passed.
- **Series 1h result (`btd6-jev-v6` revision 14, code cb3bc8d):** rounds 37, 95, 40, 90 and 76, median 76 (series 1g: 90). Progress data 58015da.
  - Round 28 held in every match.
  - The two early losses (37 camo, 40 MOAB) followed money spent on Lead capacity in rounds 25 to 27.
- **Hard Standard check on revision 14 (code cb3bc8d): 1 of 5.** Won with 48 lives; lost at round 78 (the known burst, 24,781 of 26,382 popped), at round 40 twice (leaking from round 4 or 33, MOAB damage about a quarter of the need), and at round 62 (250 Purples and 15 camo regrowing Rainbows; six Wizards can't pop Purple). Revision 5 won 5 of 5 in series 7.
  - Same game (56.3), bridge (0.3.15), tower data (922e6b5e918c) and Jev model (`jev-1.13.0`). None of the one-life rules fired.
  - **Replay** (data agent, the track on; revision 5's settings on current code against revision 14's): over 2,146 series 7 decisions and 1,134 revision 14 decisions, the kept options differ at 0 and Jev's question at 0. The control reproduces the logged rule kinds at 98.4 to 99.6%. Forcing one life shows 46 differences, so the check can detect them.
  - Every lives-dependent change since revision 5 is limited to one life. `lead_capacity` and the DDT check aren't, but neither fired with more than one life on these states: the lowest Lead margin was 2.23, and no DDT appears by round 80.
  - **Check of revision 5's own code** (detached worktree at 3a79fd5, played 02:07 to 03:06 UTC on 2026-10-02; logs copied into `.private/btd6/runs`): **3 of 5.** Won with 97, 97 and 100 lives; lost at round 62 (103 lives in that round, the same Purple and camo regrowing Rainbow round that ended revision 14's fourth check) and at round 37 (leaking from round 20).
  - **Conclusion:** my changes didn't cause the Hard Standard drop. With identical decisions on Hard Standard states, revision 5's code today goes 3 of 5 and revision 14's 1 of 5, a gap well within chance. Series 7's 5 of 5 was a high draw. Revision 5's record is now 8 of 10.
  - Round 62 (250 Purples, 15 camo regrowing Rainbows, 7 MOABs) is a weakness of both, along with the unmodelled Purples.
- **Is progress regressing? (Marcus, 2026-10-02 02:25 UTC) Partly yes.**
  - **CHIMPS medians:** revision 9 78, revision 11 90, revision 14 76. The early deaths under revision 14 (37 and 40) follow money spent on Lead capacity, and its burst saving may have cost round 76.
  - **What went wrong in my process:**
    - several changes per series, each decided from one or two matches;
    - design mistakes in revisions 10 (the deadlock), 12 (counting DDTs as Lead) and 16 (binding too often, caught before merge);
    - no control in the same session.
- **Decided: how changes are tested from series 1i.**
  1. Series 1i alternates the candidate, revision 17 (main 99dc09e), with the control, revision 11 (detached worktree `r11-control` at 73afc95), match by match in the same session, 5 pairs. Loop: `go-chimps1i-ab.sh`.
  2. A candidate is kept only if it beats the control in the same series. Otherwise CHIMPS goes back to revision 11, and the changes come back one at a time.
  3. After that, one change per candidate, each for a failure seen in at least two matches.
- **Open question closed: no MOAB health ramp after round 80.** The game export has no health scaling by round for MOAB-class bloons in this mode: `Bloons/Moab/Moab.json` has a fixed `maxHealth`, and the only multipliers belong to other modes.
- **Implemented, merged 99dc09e (`btd6-jev-v6` revision 17, v5 revision 21, claude-v1 revision 20; v4 unchanged; with revisions 15 and 16; tested head to head in series 1i):**
  1. **Severe-shortfall cutoff:** the `moab_short` binding (revision 16) applies only while the short round's ratio is below 0.5 (`MOAB_BIND_RATIO`). From 0.5 to 1 it does what v4 does: removes Wait and orders the adders.
  2. **DDT rounds:** `moab_short` looks ahead 10 rounds instead of 4. With one life, below 0.5 and no affordable DDT-capable answer, it saves for the cheapest DDT-capable answer, as `lead_capacity` saves. Survival rules override the saving, as they do for the other savings.
  3. **`lead_capacity` threshold 0.5** instead of 1.0. In the Lead-margin buckets, 4 of 7 rounds below 0.5 lost lives, all at round 28. From 0.5 to 1, 1 of 12 did, at round 95, and that came from DDTs, which revision 15 removes. From 1 to 2, no loss was caused by Lead.

  Code: `policy-v4.mjs` `MOAB_BIND_RATIO` (`moabBindBelow`), `moabSaving` (`saveForDdt`); `moab.mjs` `MOAB_DDT_LEAD_ROUNDS`, `setMoabDdtLead` (set by the session and the dashboard per policy and revision); `threat.mjs` `LEAD_CAPACITY_AT` 0.5 (`LEAD_CAPACITY_AT_R12` 1.0 through `threatOptions.leadAt`). `moabBindBelow: Infinity`, `moabSaving: false`, `leadAt: LEAD_CAPACITY_AT_R12` and `setMoabDdtLead(4)` give revision 16.
  - The graded speed keeps the 4-round lead for DDT rounds (`session.mjs` and the dashboard pass `ddtLead: 4`): over the 17 CHIMPS logs the 10-round lead adds a short DDT round at 1,068 of 5,829 decisions, in rounds 80 to 85 and 89 to 95, which would hold the speed at 3 for those rounds.
  - Unit tests (`moab-ddt.test.mjs`, 12): binding below 0.5; v4's `moab_short` from 0.5 to 1 (same as revision 15); the cutoff under the cap; round 90 due from round 80, a MOAB round still 4 ahead; the DDT saving with one life and the hand-off to the binding; no saving with two lives or under leak pressure; the v5 floor saves; `lead_capacity` due at 0.45, not at 0.6. `npm test` 450 of 450.
  - Replay (`npm run btd6:threat-replay -- --moab-cutoff`, `moabCutoffReplay`, with the saving pool; the 17 CHIMPS v6 logs from 20:19, 5,829 decisions, the track on). One-life decisions by the short round's ratio; binding, saving, then logged choices removed against revision 15:

    | Ratio | r16 binds | r16 removed | r17 binds | r17 saves | r17 removed |
    |---|---|---|---|---|---|
    | below 0.25 | 38 | 22 | 89 | 876 | 129 |
    | 0.25 to 0.5 | 891 | 754 | 706 | 268 | 562 |
    | 0.5 to 0.75 | 584 | 516 | 0 | 0 | 0 |
    | 0.75 to 1 | 167 | 133 | 0 | 0 | 0 |

    Revision 16's totals (1,680 binds, 1,425 removed) match the `--moab-bind` replay. Revision 17's ratios are for its own short round, which with the 10-round lead is often round 90.
  - Round-90 losses, rounds 80 to 90 (last decision of each round, the track on, factor 1.27): DDT-capable figure for round 90 against 99.3 needed, and the cheapest DDT-capable purchase in the replay pool:
    - 22-33-39 (r11): 0.16 to 0.20; cash at the last decision $316 to $1,706 (up to $3,113 within a round); cheapest $1,945 (+0.6) at 80 to 83, $3,025 (+0.2) at 84 to 88, $6,805 (+8.0) at 89.
    - 22-55-34 (r11): 0.06 to 0.08; cash $97 to $3,170 (up to $3,596); cheapest $1,945 (+0.9) at 80 and 81, then $16,200 (+3.1).
    - 23-24-18 (r11): 0.32 throughout; cash $66 to $3,635 (up to $4,345); cheapest $6,805 (+8.0).
    - 00-29-52 (r14, match 4): 0.02 (0.05 at 90); cash $235 to $5,640 (up to $7,821); cheapest $16,200 (+3.2).
    - Without the track (as in the assessment above), round 89's figures are 30.4, 17.4, 32 and 13.5.
  - Game export (`.private/btd6-game-data`): no MOAB-class health scaling by round after 80 was found. `Bloons/Moab/Moab.json` has a fixed `maxHealth`, the default round set lists bloons and counts only, and the health multipliers present are for other modes (`Mods/Easy.json` `SetHealthForBloonModModel` at round 40, `frontierData.json` `bloonHealthMultiplier`, `rogueData.json` `freeplayBloonHealthPerStage`). The ramp after round 80 is presumably in game code, not in the export.
- **Implemented, merged ee178f0 at 05:08 UTC (`btd6-jev-v6` revision 18, v5 revision 22, claude-v1 revision 21; v4 unchanged): `lead_capacity` threshold back to 1.0** (`threat.mjs` `LEAD_CAPACITY_AT`; `LEAD_CAPACITY_AT_R17`, 0.5, through `threatOptions.leadAt` gives revision 17). In run 2026-10-02T04-44-47 (CHIMPS, revision 17) `lead_capacity` stayed off at a round-28 Lead margin of 0.62; Jev bought Dart Monkeys and the match was lost at round 28 to Leads. Every revision 12 to 14 match passed round 28. Nothing else changed.
- **Revision 17's threshold of 0.5 was my mistake.** I based it on 12 rounds in the 0.5 to 1 bucket. Revisions 12 to 14 passed round 28 in every match at 1.0.
- **Series 1i so far** (CHIMPS, candidate against the revision 11 control; read revisions from run_start):
  - **Graded speed:** revision 17 reached 95; revision 11 reached 90, 90 and 90 (the last with $3,349 unspent).
  - **Fixed 3x:** revision 11 reached 90 (16.6 minutes); revision 17 reached 28 (the threshold mistake, 3.5 minutes) and 93 (camo DDTs, 17.8 minutes).
  - One revision 11 start at 05:06 was refused by the bridge (`main_thread_timeout`, the game still leaving the defeat screen). The loop moved on, and no match was played.
  - From the next candidate match on, the candidate is revision 18.
- **Series 1i result (played 03:06 to 05:33 UTC; progress data 2ad101c):**

  | Arm | Graded speed | Fixed 3x |
  |---|---|---|
  | candidate (revision 17, then 18) | 95 | 28 (revision 17's threshold), 93, 95 (revision 18) |
  | control (revision 11) | 90, 90, 90 | 90, 28, 28 |

  - **Decided: revision 18 replaces revision 11 as the base.** Without the threshold mistake, the candidate reached 93 to 95 every time. The control died at round 90 to DDTs four times and at round 28 to Leads twice.
  - **Fixed 3x cost no rounds:** the control reached 90 at 3x as at graded speed. Matches took 17 to 20 minutes at 3x, against 21 to 37 at graded speed.
  - **Candidate tower counts:** after round 75 the candidate's tower count rose from 20 to 26 up to 50. Most were cheap Snipers (1-1-0 and 1-0-2, which can hit DDTs) and Skywardens, from the MOAB binding's placement pass under the cap.
- **Series 1j (started 05:34 UTC):** revision 18, 5 matches, `--speed graded:10 --moab-short-speed 3 --camo-margin --min-speed 3` (label `graded:10+moab3+camo+min3`). It gives the base at the new speed. The loop now waits 30 seconds before each match, after two starts were refused while the game was leaving the defeat screen.
  - **Result:** rounds **93, 93, 95, 95, 95**, median 95, the best CHIMPS series so far. Progress data e036dfe.
    - Every match passed round 90, and every one died to DDTs (with camo regrowing Ceramics at round 95).
    - About 15 minutes per match; time at speed 3x 73%, 5x 23%, 10x 4%, 1x none. Under the old graded speed matches took 21 to 37 minutes. The floor cost no rounds.
  - **Match 2 died at round 93 with $13,674 unspent**, a flaw in revision 17's DDT saving.
    - From round 89 it saved for a $16,200 upgrade aimed at round 99, the weakest ratio in its 10-round window, and blocked every purchase while round 93 came first.
    - The saving targets the weakest round in the window rather than the nearest. The pool's cheapest DDT-capable answer can be a tier-5 upgrade, because placing a new Sniper and upgrading it is never an answer.
    - The other four matches spent their money ($164 to $1,632 at death).
  - **Before revision 19's head-to-head:** check its replay count of newly saving decisions. If saving grows a lot, first make the saving target the nearest short DDT round and release it when that round starts.
- **Hard Standard on revision 18 with the floor** (started 06:54 UTC, 5 matches, `go-hs9.sh`): the benchmark mode at the new speed. Before the floor it spent about a third of its time at 1x, mostly on `leak_pressure`.
- **Found: `moabCheck` ignores how many MOAB-class bloons arrive together.**
  - The need is the toughest single bloon's health over its kill window. So round 95's 30 DDTs and 50 Fortified MOABs need 99.3 DDT damage per second, the same as round 90's 3 DDTs.
  - DDT-capable ratios from the logged towers:
    - revision 18's round-95 loss: 0.76 to 0.89 in rounds 89 to 94, above the 0.5 cutoff, so nothing bound or saved;
    - revision 17's round-93 loss: 1.41 to 1.5;
    - revision 14's round-95 loss: 1.58.
- **Decided (`btd6-jev-v6` revision 19, v5 revision 23, claude-v1 revision 22; being built in worktree `moab-count`): a count-aware MOAB need.**
  - The need is the largest MOAB-class health spawning within one kill window, from the round's spawn timing (the data `burst` uses), over that window, times the lives margin. DDTs count against the DDT-capable figure.
  - Everything that reads `moabCheck` follows.
  - Test it head to head against revision 18 (series 1k), and keep it only if it wins. Check the replay's ratio buckets against leaks before merging.
  - **Built (branch `moab-count`, bdc06a1 and 818fee7, 462 tests), not merged. Decided: parked.** The data is against it:
    - **The ratio predicts leaks worse than the old one.** These are MOAB-class round starts since 2026-09-30, 1,981 rounds, track on. Each row gives rounds, then rounds that lost lives:

      | Ratio | Old | New |
      |---|---|---|
      | <0.25 | 4, 2 | 150, 7 |
      | 0.25–0.5 | 31, 3 | 247, 9 |
      | 0.5–1 | 98, 12 | 444, 4 |
      | 1–1.5 | 121, 3 | 303, 3 |
      | 1.5–2 | 196, 1 | 208, 1 |

      The new ratio sends hundreds of safe rounds below 0.5.
    - **It would bind too often:** under revision 17's rules, one-life binding goes from 1,346 to 4,705 of 10,862 rebuilt CHIMPS decisions, from round 48 on.
    - **The need is too high.** Revision 14's match passed round 93 at a new ratio of 0.04. The formula divides the health spawning within one kill window by one window. A deadline-based need, the most health from spawn i to j over (t_j − t_i + window), would be at most half as large for spread spawns. The pinned 1.27 factor is also low for CHIMPS, by about 2x.
    - **To come back to it:** the deadline-based need, a CHIMPS-measured MOAB factor, the buckets checked again, then a head-to-head.
  - **The new needs from its tests,** for reference: round 90 297.9 (3 DDTs in 6 s), round 93 595.9, round 95 2,407.5 (40 Fortified MOABs and 24 DDTs in one 16 s window).
- **Priority now: Marcus's Hard Standard zero-leak target** (Goal section). It runs on revision 18. Revision 19 would affect Hard Standard's MOAB rounds under zero-leak's one-life rules, which is one more reason to keep it out.
- **Open: Purple bloons aren't modelled.** Round 95 has 500 camo regrowing Purples, and magic, fire and plasma attacks can't pop Purple. The camo and round margins count Wizards and similar towers against them.
- **Open: camo capacity for late rounds needs a longer lead.** Round 95 (camo regrowing Ceramics and Purples) ended both matches that reached it. In match 2 the gap was 0.49 at round 92, with three rounds to close it.
- **Check each run for:** the round reached, the first leak (any leak ends a CHIMPS match), the speed at that moment (from `state.speed` or the `speed_set` records, not `multiplier`), and rounds 81 to 100, which no run has played yet.
- **Implemented: graded speed floor `--min-speed 3`** (label `+min3`, e.g. `graded:10+moab3+camo+min3`; branch `speed-floor`). Marcus wants 3x as the minimum game speed.
  - Why: across the 11 CHIMPS matches of 2026-10-01 (logs from 22:05, `graded:10+moab3+camo`), 69% of match time was at 1x, 15% at 3x, 14% at 5x and 2% at 10x. The 1x time came from a graded margin below 1.0 with `moab_short` present (31%), a margin below 1.0 on pops (19%), `moab_outrun` (11%), `moab_outrun` with `moab_short` (4%), and leak pressure, bloons past and the rest (about 4%). On Hard Standard about 30% is at 1x, mostly `leak_pressure`.
  - What it does: with floor 3 nothing in the graded controller goes below 3x. Margin grades below 3, the hard danger signals (`lives_lost`, `bloons_past`, `moab_outrun`, `leak_pressure`), consult slowdowns, `moab_short` (also with `--moab-short-speed 1`) and the start-of-match level are all at least 3. Steps up to 5 and 10 and the caps above 3 work as before. The default is 1, so existing runs and labels are unchanged. The runner's `speed_set`, round-start reapply and resend all send the controller's target, so they respect the floor; the bridge is unchanged. Speed is independent of the policy, so no policy revision changes.
  - Replay (`npm run btd6:speed-replay -- --floor 3 --since 2026-10-01T22:05:00Z --mode Clicks`, `floorEstimate`; numbers only): each match's logged seconds at each observed speed (`run_end.speed_time`), with time below the floor played at the floor and each stretch's game time unchanged. 11 matches: 219.1 min logged (19.9 per match), 118.4 min with floor 3 (10.8 per match, 46% less). Game time: 1x 33%, 3x 21%, 5x 34%, 10x 11%. The estimate keeps the logged decisions and timings; a match that plays differently at 3x would take a different time.
  - Tests: `speed-floor.test.mjs` (5).
- **Implemented, merged 4a7a07e: `--zero-leak` run flag** (v6, v5 and claude-v1; no revision change). Marcus's goal: Hard Standard (100 lives, rounds 3 to 80 on Monkey Meadow) cleared with 0 lives lost almost every time.
  - Why: with one life, revisions 17 and 18 passed CHIMPS rounds 6 to 90 without a leak in 8 of 9 matches (series 1i and 1j). On Hard Standard, with lives above 1, none of the one-life rules run, and v6 has won 60 to 80% with lives often lost.
  - What it does: the policy and graded speed read the state with lives set to 1 (`zero-leak.mjs` `zeroLeakView`, applied to the game adapter's policy hooks and to `defenceMargins` and graded speed's `moab_short`). The run log, the match tracker, the strategist and the lives in Jev's question stay real.
  - The opening isn't blocked: from round 3 with $650 (and from rounds 1 and 2 in the test) the rules keep purchases while one raises the round's ratio, then offer the start.
  - Recording: `zero_leak: true` in `session_start`, `run_start` and the series entry. Progress: Hard Standard runs with `zero_leak: true`, shown as their own rows ("v6 r18 (btd6-open-v3) graded, zero-leak") right after the same revision's normal rows, so `--add` never mixes zero-leak runs with normal runs. (Until 2026-10-02 they were a separate setup, `hard-standard-zero-leak`, with its own chart.)
  - Tests: `zero-leak.test.mjs` (8), one in `progress.test.mjs`. Dry run with the series 1j flags plus `--zero-leak` records `zero_leak: true`.
  - Next: merge, then a Hard Standard series of v6 revision 18 with `--zero-leak --ruleset v3 --speed graded:10 --moab-short-speed 3 --camo-margin --min-speed 3 --moab-factor 1.27 --pops-factor 1`; measure wins and lives lost against the normal Hard Standard series on the same flags.
  - **Comparison: normal Hard Standard on the same flags** (revision 18 with the floor, 06:54 to 07:39 UTC, progress 924e6b9): 2 of 5. It lost at round 40 twice and at round 56, and won with 100 and 33 lives. Round 40 killed 4 of the last 10 normal Hard Standard matches (revisions 14 and 18).
  - **Series HS-z1 (played 07:45 to 09:55 UTC on 2026-10-02):** 10 matches, `go-hs10z.sh` > `hs10z-a.log`. The target was 0 lives lost in at least 9.
    - **Result: 10 of 10 won with all 100 lives (0 lives lost in every match). The target is met.**
    - Each match took 11.4 to 12.7 minutes. Time at speed: 3x 75%, 5x 23%, 10x 2%, 1x none.
    - On the same version and flags without `--zero-leak`, Hard Standard went 2 of 5, with lives lost even in the wins (06:54 to 07:39 UTC).
    - Progress data: `zero_leak: true` on Hard Standard runs, their own rows in the Hard Standard chart and table.
  - **PAUSED at 10:09 UTC on 2026-10-02 at Marcus's request** ("pause after this run completes").
    - The first confirmation match (09:56) won with all 100 lives, so zero-leak is 11 of 11 clean.
    - The parked branch `moab-count` (revision 19) is on GitHub.
  - **Resumed at 18:17 UTC on 2026-10-02** (Marcus: "continue your recs"). The game had been closed since 10:13; it was relaunched through Steam with mods on, so it came up on the mod account (the account it last used). Confirmation series: `go-hs11z.sh` ×9, `hs11z-a.log`.
    - Matches at 18:17, 18:29 and 18:42: won with all 100 lives in 11.7 to 12.4 minutes (14 of 14 clean).
    - **Match at 18:54: won with 83 lives**, the first zero-leak match to lose lives (14 of 15 clean).
      - Round 28 lost 7 lives (6 Leads in 5 seconds), at a Lead margin of 1.19. Round 30 lost 10 (9 Leads), at a Lead margin of 1.29. Both margins were above lead_capacity's 1.0, so nothing bound.
      - The Lead-capable towers popped far less than estimated at round 28: a Bomb Shooter 0-1-2 popped 27 of an estimated 166, and five Wizards at 0-0-0 popped 0 to 7 of 28 each.
      - One occurrence, so no rule change. If round 28 or 30 leaks again, look at a burst-aware Lead check (the Leads arrive in 5 and 13 seconds).
    - Matches at 19:06, 19:19, 19:33, 19:45 and 19:57: won with all 100 lives in 11.3 to 12.7 minutes. The loop ended at 20:09.
  - **Confirmation result: zero-leak won 20 of 20 Hard Standard matches, 19 of them with all 100 lives** (95%; the two-sided 95% lower bound is about 75%). The target of 0 lives lost in at least 9 of 10 holds. Progress data 2077261.
  - **Next, decided:**
    1. CHIMPS: revision 19 (below) head to head against revision 18 (series 1k).
    2. Merge the support-effects figure (default off). The next candidate turns it on, with the deadline-based need for DDT rounds.
    3. Zero-leak for v5 and claude-v1 comes when their series resume.
- **Series 1j's late game** (analysis on 2026-10-02 of the five revision 18 logs, from round 76 to the loss; scratchpad `ddtsave.mjs`):
  - **Saving and waiting dominate.** moab_short's DDT saving (revision 17) was active at 27 to 75 decisions per match, from round 80 to the loss. The rules forced "Wait" at 76 to 93 decisions per match, and cash peaked at $10,011 to $16,149.
  - **Poor targets.** Four of the five matches saved for a $16,200 Dart 5-0-2 (Ultra-Juggernaut), the cheapest DDT-capable purchase in their pools, which the figure credits with about 3 damage per second.
    - Match 2 saved from round 80, bought one at round 88 (the figure went from 40.9 to 43.8, against 99.3 needed), and then saved for a second until it lost at round 93 with $13,674.
  - **Camo answers blocked.** While moab_short saves or binds, threat_short's camo_capacity answers are dropped: only Lead, camo and camo Lead answers stay. With MOAB adders on offer, threat_short skips the rate kinds entirely.
    - camo_capacity was deferred to moab_short 27, 8, 1, 17 and 0 times in the five matches.
    - Three of the five losses leaked camo regrowing Ceramics first. Match 2 waited through rounds 92 and 93 with a camo margin of 0.73 and $9,002 to $13,674 in hand.
  - **The DDT figure runs low.** Measured damage on DDT rounds is 1.0 to 17.7 times the calibrated DDT-capable estimate; at round 90 the median is about 2.7 (`npm run btd6:moab-replay -- --ddt --since 2026-10-01T20-00`).
    - Bloons that lose camo are the likely cause. The bridge reports a bloon's current model, so "Ddt" in a log is a DDT whose camo was removed. Shimmer (Wizard x-x-3 and up) and Counter-Espionage (Ninja x-2-x and up) remove camo, so towers without camo detection can then hit the DDTs. The largest gaps are in matches with these towers.
    - Village Radar Scanner and MIB aren't modelled either.
  - **Round 95 needs far more than the check says.** Its 30 camo DDTs spawn over 20 seconds with 50 Fortified MOABs.
    - A deadline-based need for the DDTs alone is about 500 damage per second before the margin: 12,000 health over 20 seconds plus a 6-second window. The per-bloon need is 99.3 with the margin.
    - Measured DDT damage at round 95 was 76 to 238.
- **Decided: `btd6-jev-v6` revision 19, v5 revision 23, claude-v1 revision 22** (branch `ddt-saving`): two fixes to the DDT saving and binding.
  - The parked `moab-count` branch's revision 19 was never played and is superseded. Its deadline-based need comes back on top of the support-effects figure.
  1. **Camo and Lead capacity answers stay.** With one life, while moab_short's short round has DDTs and it binds or saves, threat_short's camo_capacity and lead_capacity answers stay.
     - Which answers: affordable ones within THREAT_KEEP of their kind's best gain per dollar.
     - Order: after the Lead, camo and camo Lead answers, and before the MOAB adders.
     - threat_short evaluates those two kinds while moab_short has adders for a DDT round. Burst stays skipped.
     - Rounds without DDTs, and so Hard Standard, are unchanged.
  2. **The DDT saving saves only for a purchase that adds at least a quarter of the short round's gap** (the need minus the DDT-capable damage). It targets the cheapest such purchase in the pool. Without one it doesn't save, and moab_short orders the MOAB adders and removes "Wait" as it does between 0.5 and 1.
  - Implemented on branch `ddt-saving` (commit 3c52c80; options `moabCapacity` and `ddtGapShare`; 472 tests pass). Replay (`npm run btd6:threat-replay -- --ddt-save`), CHIMPS v6 logs from 2026-10-01T20-19, from round 76, 3,909 rebuilt decisions: moab saving at 2,011 decisions under revision 18 and 0 under revision 19; only pass options left at 2,576 and 1,858; capacity answers kept at 262; option sets differ at 913. No revision 18 target reached a quarter of the gap (largest share 0.20, a Sniper 3-2-0 at $2,375; the Dart 5-0-2 at 0.01 to 0.03), so revision 19 never saves on these logs. Hard Standard logs from 2026-10-01: 0 of 7,988 decisions differ (27 normal logs) and 0 of 4,952 (15 zero-leak logs).
  - **Head to head against revision 18** after the confirmation series: alternating, 4 matches each, on series 1j's CHIMPS flags. Keep it if it reaches further.
  - **Merged 3368719** (with `ddt-support`; 482 tests). A dry run on the series flags records revision 19.
  - **Decided as built, with the saving effectively off.** Every target scored against today's DDT figure, which runs 3.7 times low at the median, so the gaps are too large for any purchase to reach a quarter of one. The head-to-head therefore tests revision 18's DDT saving against no saving with the capacity answers kept. The support-effects figure changes every gain and gap, so the share isn't tuned on today's figure.
  - **Series 1k (first match 20:12 UTC):** `go-chimps1k-ab.sh 4` > `chimps1k-a.log`. The candidate runs on main (revision 19), and the control from the detached worktree `r18-control` at 4366dc3. The candidate goes first in odd pairs.
    - **Comparison rule, set after match 1 and before any other result:** the revisions decide identically until a DDT round is within view (round 80). So only matches that reach round 80 are compared on the round reached; earlier losses are listed separately. If fewer than 3 matches per arm reach round 80, pairs are added, up to 2.
    - **Match 1 (revision 19): lost at round 33** after 2.6 minutes. Round 33 is 13 camo Yellows and 20 camo Reds over 25 seconds. The only tower that saw camo, a Dart 2-0-3, popped 53 of the 72 RBE and the rest leaked. Its pops estimate for the round was 842, so no camo rule fired. This is the camo-capacity weakness noted at round 37 (one fast-firing need, one tower), not revision 19's change.
    - **Match 2 (revision 18): lost at round 95** with $326 and 36 towers. From round 76: 16 DDT-saving decisions and 80 forced waits.
    - **Match 3 (revision 18): lost at round 93** with $8,161 held and 28 towers. From round 76: 49 DDT-saving decisions and 95 forced waits.
    - **Match 4 (revision 19): lost at round 93** with $85 and 36 towers. From round 76 there were 77 forced waits.
      - 64 of them were "nothing affordable under the tower cap" rather than saving. In series 1j, by contrast, 27 to 75 of each match's forced waits were DDT saving, with $2,700 to $6,600 held on average.
      - Revision 19's saving still fired at 18 decisions. The targets were $34,560 upgrades worth 110 to 184 DDT damage per second, aimed at round 99 (from round 89) and round 100 (rounds 91 and 92), because moab_short aims at the weakest due round, not the nearest. Neither target was affordable before round 93.
      - Capacity answers were kept at 27 decisions.
    - **Match 5 (revision 19): lost at round 90** to regrowing Ceramics, with $126 and 31 towers.
      - No saving and 51 forced waits. Round 90's DDTs were handled (135 damage per second measured).
      - From round 87 to 90 it bought about $7,000 of Ninjas, the camo_capacity answers revision 19 keeps, which are weak against Ceramics.
    - **Match 6 (revision 18): lost at round 95** to a DDT and camo regrowing Ceramics, with $2,963 and 23 towers (57 DDT-saving decisions).
    - **Match 7 (revision 18): lost at round 78** to camo Pinks (72 camo Ceramics in the round).
    - **Match 8 (revision 19): lost at round 37** to camo Greens.
  - **Series 1k result (20:12 to 21:41 UTC; progress data d4cb99b):**

    | Arm | Reached round 80, then lost at | Lost before round 80 (excluded) |
    |---|---|---|
    | revision 19 | 93, 90 | 33, 37 (camo) |
    | revision 18 | 95, 93, 95 | 78 (camo) |

    - **Decided: revision 19 is not kept.** The pairs the comparison rule would add can't change the outcome: revision 19 would have to pass round 95 twice to beat revision 18's median of 95, and no match has ever passed it.
    - Revision 18's DDT saving held money and sometimes bought poor upgrades, but its matches still went further than revision 19's.
    - Revision 20 sits on revision 18's options (`moabCapacity: false`, `ddtGapShare: 0`), with revision 19's options left switchable.
  - **Found: camo losses before round 80**, in 3 of the 8 matches (rounds 33, 37 and 78). Both arms play these rounds the same way.
    - **Round 33:** one camo-capable Dart 2-0-3 popped 53 of 72 RBE against an estimate of 842.
    - **Round 37:** 7 camo Whites among 1,202 RBE. Two Dart 1-0-2s popped 16 and 88 against 132 each.
    - **Round 78:** 72 camo Ceramics among 26,382 RBE.
    - No camo rule fired in any of them, because the camo capacity estimate credits camo-capable towers with pops they spend on other bloons, or can't fit into a fast stream. This is the open item "camo margin ignoring competing targets", now seen in three matches.
  - **Decided next, after revision 20: a camo capacity check that counts competing targets and the time a camo bloon spends in range,** offline first. It must be checked against these losses and the camo rounds that passed, before any policy uses it.
    - The replay of three candidate models is being built on branch `camo-check`:
      - A: camo-capable pops scaled by the round's camo share;
      - B: camo-capable pops per second against camo RBE per second;
      - C: B with A's share.
  - **Camo model replay result** (branch `camo-check`, 88f6e89; `npm run btd6:camo-replay -- --models`; 139 logs since 2026-09-30T10-00).
    - Each cell is camo rounds / rounds that lost lives. The lost lives can have any cause, so the rates are approximate.

      | CHIMPS (587 camo rounds) | <0.5 | 0.5–1 | 1–1.5 | 1.5–2 | 2–4 | >=4 |
      |---|---|---|---|---|---|---|
      | today | 5/4 | 20/14 | 50/8 | 54/4 | 150/3 | 308/2 |
      | A (camo share) | 89/19 | 242/11 | 146/4 | 69/0 | 26/0 | 15/1 |
      | B (rate) | 39/12 | 54/17 | 102/4 | 69/0 | 149/1 | 174/1 |
      | C (both) | 330/22 | 129/8 | 68/4 | 25/0 | 20/0 | 15/1 |

    - **Below 1.0, today's figure catches 18 of the 35 rounds that lost lives,** in 25 flagged rounds. B catches 29 in 93 flagged rounds, and A 30 in 331.
    - **At 1.5 and above,** today's figure misses 9 leaks in 512 rounds and B 2 in 392.
    - Hard Standard shows the same pattern: below 1.0, today catches 15 of 53 and B catches 35 in 168 flagged rounds.
    - **The three losses:**
      - round 37: today 2.28, B 0.42;
      - round 78: today 1.29, B 0.12;
      - round 33: all figures 1.31, then 7.8, because all its RBE is camo and it spawns across the whole round.
    - **Round 33 is a pops-estimate error,** not a camo one. The estimate assumes full pierce use (842 estimated pops from one Dart 2-0-3, 53 made on a sparse stream).
    - **Cost:** under B, camo_capacity is due in 2,387 of 13,414 CHIMPS states in rounds 6 to 80, against 273 today. B flags every state today's figure flags. camo_capacity doesn't save, so a binding with no affordable answer lets the options through.
  - **Decided: `btd6-jev-v6` revision 21 (v5 25, claude-v1 24): revision 20 plus camo_capacity on Model B** (due below 1.0, binding as today), built after revision 20 merges.
    - **Head to head against revision 18 together with revision 20, not separately.** Revision 20 acts only once a DDT round is in view (round 80 on), so losses before round 80 measure the camo change alone. The losses at rounds 93 and 95 come from DDTs and camo regrowing Ceramics, so passing them needs both changes. And fewer camo losses before round 80 would waste fewer matches.
    - **If revision 21 loses,** revision 20 is tested alone.
    - **Added to revision 21 after its replay** (built on `camo-b`): a camo_capacity or lead_capacity round that comes before moab_short's short round is no longer set aside by moab_short.
      - The replay showed revision 21's camo rule due at rounds 34 and 35 before the round-37 loss and at round 75 before the round-78 loss.
      - It was then set aside at round 36 (round 40 in view) and at rounds 76 and 77 (round 80 in view), which is where it mattered.
    - **Series 1l comparison rule, set before any match:** 5 pairs, alternating which arm goes first. All matches count, including losses before round 80, because the camo change acts there.
      - Keep revision 21 if its median round reached is higher than revision 18's, and it doesn't lose more matches before round 80.
      - If the medians tie, the arm with fewer losses before round 80 and more matches past round 95 is kept.
    - **Series 1l setup:** revision 21 merged into main at 31a070e (510 tests; a dry run records revision 21 and table `e185f06f88c1`).
      - The control is revision 18 from `r18-control` (4366dc3), with the Druid-fixed `towers.json` copied in, so both arms use table `e185f06f88c1`. The control's runs record `code_dirty: true` for that file.
      - Bridge 0.3.16 (the lab build). `go-chimps1l-ab.sh 5` > `chimps1l-a.log`, with the candidate first in odd pairs.
    - **Series 1l so far:**
      - match 1 (revision 21): lost at round 94 to Ceramics, with $425;
      - match 2 (revision 18): lost at round 93;
      - match 3 (revision 18): lost at round 28 to Leads;
      - match 4 (revision 21): lost at round 93 to camo regrowing Ceramics, holding $3,099. It made 76 DDT-saving decisions; once its Sniper's cheaper upgrades were bought, the best-value target became a $34,560 upgrade (+110 DDT damage per second) for rounds 90 and 93, out of reach before them.
    - **Match 5 (revision 21) is void and gets a replacement** after the five pairs.
      - At round 55 a Jev request got TypeSafe HTTP 520. The runner paused (`error`, `runner_paused`) and made no decisions until the match was lost at round 76, holding $40,660.
      - Timeouts are retried once, but 5xx answers weren't. A retry for 500, 502 to 504 and 520 to 524 is being built on branch `retry-5xx`, to merge after the series so both arms run unchanged code.
    - **Open for the next revision:** the DDT saving needs a reachability check. A target that can't be afforded before its round shouldn't hold purchases back (1k match 4 and 1l match 4).
    - **Matches 6 to 10 and the replacement:**
      - match 6 (revision 18): lost at round 93 to camo regrowing Ceramics;
      - match 7 (revision 18): lost at round 56 to camo Pinks;
      - match 8 (revision 21): lost at round 93 to camo regrowing Ceramics, holding $11,133. It saved from round 80 for $23,220, then $34,560 upgrades, with cash peaking near $16,000 to $17,500. From round 90, camo_capacity for round 93 was deferred to the saving.
      - match 9 (revision 21): lost at round 90 to camo DDTs;
      - match 10 (revision 18): lost at round 28 to Leads;
      - the replacement (revision 21): lost at round 93 to DDTs and regrowing Ceramics.
    - **Series 1l result (02:12 to 04:14 UTC on 2026-10-03; progress data 2aa7bcd; the void match is tagged `typesafe-520`):**

      | Arm | Rounds reached | Median | Lost before round 80 |
      |---|---|---|---|
      | revision 21 | 94, 93, 93, 90, 93 | 93 | 0 |
      | revision 18 | 93, 28, 93, 56, 28 | 56 | 3 (28, 56, 28) |

      - **Decided: revision 21 is kept** under the comparison rule (median 93 against 56, and fewer losses before round 80).
      - **Its gain is in the early and middle game:** revision 18 lost three matches before round 80, one to camo at 56 and two to Leads at 28, and revision 21 lost none.
      - **The two round-28 losses may be partly chance.** Revision 18 lost none at round 28 in series 1j. Revision 21's camo answers around rounds 21 to 24 (Wizards with camo detection also pop Lead) may help there too.
      - **The late game didn't move:** revision 21 reached 90 to 94, against revision 18's 93 to 95 in series 1j.
    - **The 5xx retry is merged** (98111a9, merge cf4b5cf).
- **Decided: `btd6-jev-v6` revision 22 (v5 26, claude-v1 25): the DDT saving and capacity answers in the last rounds.**
  1. **Reachable saving targets.** The DDT saving saves only for a pool purchase that can be afforded before its target round starts, meaning its cost is at most the cash now plus the expected income until then. Among those, the best gain per dollar wins, with ties going to the cheaper one. With none reachable, it doesn't save, and moab_short orders as between 0.5 and 1.
     - The expected income comes from a per-round table of CHIMPS cash income measured from the logs: the median cash gained per round, counting spending from the dispatch results.
     - Evidence: series 1l matches 4 and 8 and series 1k match 4 saved for $23,220 to $34,560 upgrades with cash peaking at $7,000 to $17,500, and lost at round 93.
  2. **Capacity answers on the same round.** When camo_capacity (past the 5% bar) or lead_capacity is due at the same round as moab_short's short round, its answers stay under moab_short's binding and saving: after the check answers, and before the MOAB adders (binding) or the pass options (saving). Revision 21 already lets a nearer round go first.
     - Evidence: series 1l matches 4 and 8 lost at round 93 to camo regrowing Ceramics while camo_capacity for round 93 was deferred to the DDT saving.
  - **Head to head against revision 21:** 5 pairs, under the same rule (median round, losses before round 80 counted).
  - **Series 1l's comparison rule applies, set before any match:**
    - Keep revision 22 if its median round reached is higher than revision 21's and it doesn't lose more matches before round 80.
    - If the medians tie, keep the arm with more matches past round 95; if that ties too, the one with fewer losses before round 80.
    - A match voided by infrastructure (a runner pause from an API error, a bridge failure) gets a replacement for that arm.
  - **Series 1m setup:**
    - The candidate is revision 22 on main (acaa73c, 522 tests; a dry run records revision 22 and table `e185f06f88c1`).
    - The control is revision 21 from the worktree `r21-control` at 1561d9f, with `.env`, spots and calibration copied in. Its code includes the Druid fix and the 5xx retry, so the arms differ only by revision 22.
    - `go-chimps1m-ab.sh 5` > `chimps1m-a.log`, with the candidate first in odd pairs.
  - **Series 1m result (07:03 to 09:03 UTC on 2026-10-03; progress data 55bcc3b):**

    | Arm | Rounds reached | Median | Lost before round 80 |
    |---|---|---|---|
    | revision 22 | 37, 59, 93, 95, 93 | 93 | 2 (camo at 37, camo Leads at 59) |
    | revision 21 | 95, 93, 95, 28, 93 | 93 | 1 (Leads at 28) |

    - **Decided: revision 22 is not kept.** The medians tie, no match passed round 95, and revision 21 lost fewer matches before round 80.
    - Revision 22's two early losses aren't its own changes: it decides as revision 21 does before round 80. In both, no camo rule fired because the camo checks rated the rounds safe.
    - Its late game (93, 95, 93, with $45 to $3,344 left) matched revision 21's, so the reachable saving and the same-round answers showed no measurable gain.
    - **The noise problem:** losses before round 80, which both revisions share, decide these 5-pair comparisons. Revision 23 goes after them first.
- **Density-aware pops estimate (built offline on branch `camo-data`, bc4039b):**
  - A projectile hits min(pierce, the bloons it can reach), from each round's arrival rate, the time a bloon spends in the tower's coverage and the attack's radius. A layered bloon counts as the cluster it splits into.
  - **Rounds that lost lives** (862 camo-capable tower-rounds): actual pops over the estimate, median 0.44 today and 0.62 density-aware.
  - **Rounds without leaks:** the density-aware sum falls below actual in 19% (3% today), so it is cautious.
  - **CHIMPS camo rounds** (817), below 1.0:
    - today's margin flags 26 and catches 19 of 47 leaks;
    - Model B flags 115 and catches 37;
    - Model B on density-aware pops flags 318 and catches 45, with 2 leaks at 1.0 or above.
- **Decided: `btd6-jev-v6` revision 23 (v5 27, claude-v1 26)** (branch `density-v23`, being built). camo_capacity (Model B, with the 5% bar) and lead_capacity use the density-aware estimate. Revision 22's options are off, so it sits on revision 21's behaviour.
  - **Evidence:**
    - the camo figures above;
    - round 28's 6 Leads in 5 seconds have cost matches in series 1i, 1l (twice) and 1m, and lives in the zero-leak confirmation, where a Bomb Shooter 0-1-2 popped 27 of an estimated 166.
  - **Head to head against revision 21:** 5 pairs, same rule.
  - Implemented on branch `ddt-reach` (a7c78df, replay in the commit after; 522 tests, all passing except the known progress test): `policy-v4.mjs` `ddtReach` and `capacitySame`, `threat.mjs` `capacityAt`; `income.mjs` with `data/income-chimps.json` (median CHIMPS income per round from 67 logs; rounds 6 to 93 have 10 to 55 logs each, round 94 has 9 and 95 to 100 none, so 94 to 100 use the average of rounds 91 to 93). Dry runs record v6 22, v5 26 and claude-v1 25.
    - Replay `npm run btd6:threat-replay -- --ddt-reach`, CHIMPS v6 logs since 2026-10-01T20-19 (50 logs, 16,637 decisions; logged saving-target costs added to the pool): saving decisions, revision 21 / 22: 115/115 in rounds 61-80 and 2,062/926 in 81+. Options differ in 579 decisions, all in rounds 81+; the same-round answers are kept in 112, in 9 logs before series 1l. Revision 22's targets: 153 saving decisions for $20,000 or more, 234 for $10,000 to $19,999, 399 for $5,000 to $9,999 and 255 below.
    - First decision of rounds 85 to 93, where revision 21 saved for $34,560 at every one (series 1k match 4 from round 89 in the log):
      - 1l match 4: saves for a $16,200 Dart upgrade (gain 3.3, reach $16,418 to $18,097) at rounds 85 to 87, then saves for nothing. camo_capacity for round 93 is held by the 5% bar at round 90 and binds through threat_short at 91 to 93.
      - 1l match 8: saves for a $16,200 Dart upgrade at round 85 and a $23,220 upgrade (gain 27.7, reach $23,682) at 86, then saves for nothing. camo_capacity for round 93 binds through threat_short at 90 to 93.
      - 1k match 4: no saving at rounds 85 to 90; camo_capacity for round 90 is held at 87 and 88 and binds at 89 and 90; a $1,405 saving at 91; moab_short binds at 92 and 93.
      - No same-round keeps in these three: once the saving is dropped, moab_short has no affordable DDT adder to bind on, so threat_short's own camo binding applies.
    - Hard Standard zero-leak (20 v6 logs, 6,492 decisions): no decision differs.
- **Open: an intermittent test.** One `npm test` run on main failed one test (512 of 513), and the next passed all 513. The likely one is `ports.test.mjs` "the calibration update holds a short lock: two writers at once keep both runs", which failed once before with EPERM when Windows refused the lock file while two writers ran. Make it tolerate a transient EPERM, or retry.
    - **Added after the nearer-round rule:** camo_capacity on the rate binds only when its best affordable answer adds at least 5% of the gap to 1.0; otherwise it only orders. Without the bar, camo binding in rounds 61 to 80 rose from 0 to 1,001 of 4,033 decisions, and before the round-78 loss the answers raised the rate by about 0.002 against a gap of 0.88.
    - Implemented on branch `camo-b` (fa0edee, 4baf88c and 1c04b04, 507 tests): `threat.mjs` `camoRate`; `policy-v4.mjs` `capacityNearer` (with one life a camo_capacity or lead_capacity round before moab_short's short round keeps threat_short's binding, and moab_short neither binds nor saves over it); the gap guard `camoBindShare` (camo_capacity on the rate binds, and takes precedence over moab_short, only when its best affordable answer adds at least 5% of the gap to 1.0; otherwise it only orders). Replay `npm run btd6:threat-replay -- --camo-rate`, CHIMPS v6 logs since 2026-10-01T20-19 (39 logs, 13,403 decisions; rebuilt purchases with no cost in the logs, 93,575 in all, left out as not affordable):
      - camo_capacity due (20 / 21): 59/59, 157/657, 0/1,304 and 1,071/1,240 in rounds 6-30, 31-60, 61-80 and 81+.
      - camo binding, revision 20 / 21 without the guard / 21: 24/24/24, 138/535/518, 0/1,001/158 and 73/110/25. Options differ from revision 20 (without the guard / 21): 0/0, 394/409, 964/221 and 36/76.
      - Losses: round 37 binds at rounds 34 to 36 (round 36 over moab_short's round 40; Skywarden 2-0-1 for $230, then Wizard 0-1-2 for $325 and Dart 1-0-3 for $620; gains 0.26 to 1.25 against a need of 0.029). Round 78: the guard holds the binding at round 75 (best gain 0.0021 against 0.044), and moab_short (round 80) acts at rounds 76 and 77 as in revision 20. Round 33 is never due.
      - Hard Standard zero-leak (20 v6 logs, 6,492 decisions): options differ from revision 20 in 815 without the guard and 363 with it.
    - **Open:** a pops estimate that counts pierce only where bloons are dense enough to use it (round 33).
- **Publishing (decided by Marcus, 2026-10-02): a curated public copy under the name `jev-game-lab`, published only after he approves the exact snapshot.**
  - The private repo stays the working lab and is renamed (for example `jev-game-lab-private`) before the public repo is created. Every local remote is repointed first.
  - The public repo gets its own history of snapshot commits, made by a private publish script (`.private/publish-public-btd6.sh`) with privacy, test and build checks. The private history is never pushed there.
  - **Left out of the public tree: the lab's unlock setting.** It reports every tower, upgrade, hero, map and mode as unlocked, some heroes are premium (Monkey Money), and the BTD6 modding community forbids distributing mods that unlock premium items. The public bridge uses the account's own unlocks. The README says the results were played on a separate single-player account with every tower and upgrade available.
  - **Audit (2026-10-02):** 207 commits on `main` and `moab-count`, every author and committer the noreply address. `.env` and `.private` were never committed, and the history has no private paths, private email, Steam ID or keys. LICENSE is MIT, as in the public STS2 repo.
  - **Proposed topics:** `bloons-td-6`, `btd6`, `tower-defense`, `game-ai`, `jev`, `typesafe`, `llm-agents`, `claude-code`, `melonloader`.
  - **Proposed description:** "Bloons TD 6 agent: TypeSafe Jev picks each purchase through a MelonLoader bridge, with rules in code and an optional Claude strategist."
  - **Prepared on `publish-prep`, merged into main:**
    - **Bridge 0.3.16:** unlock handling goes through optional partial methods (`Unlocks.cs`). A lab-only file implements them in the lab's build, and its details are in the lab-only docs.
    - **Exclusions:** the public tree leaves out both of those files.
    - **Runner setting:** the Node side no longer requires `unlock_all`. The lab sets `BTD6_REQUIRE_ALL_UNLOCKS=1` in `.env` to keep its refusal.
    - **Publish script:** `.private/publish-public-btd6.sh`, a dry run by default.
  - **Dry-run snapshot e5471d6:** 224 files and 2.9 MB.
    - Privacy and override scans are clean.
    - Both builds compile with 0 errors and pass `npm test` and the bridge tests.
    - Checked by bytes: the lab DLL contains the override and its Harmony patches, and the public DLL contains neither.
  - **Smoke test in the game on the mod account (`smoke-0316.sh`, 22:45 UTC):**
    - the public build reported 0.3.16 with `unlock_all: false` and no override fields, and reached the main menu;
    - the lab build reported 0.3.16 with `unlock_all: true`, 8 patches and 0 failures, and reached the main menu.

    The lab build is installed, and the loop scripts now expect 0.3.16.
  - **Published on 2026-10-02 at about 23:00 UTC, after Marcus's final approval:** https://github.com/greenlittleapple/jev-game-lab, public.
    - It has one root commit, d94f73c ("Snapshot of the lab at 1c383bb"), by the noreply author: 224 files on `main` only. The lab-only unlock file, the lab-only docs, `.env` and `.private` are absent.
    - The description and the nine topics above are set. On the public page the README renders and both progress charts load.
    - The private working repo is now `greenlittleapple/jev-game-lab-private`. Every local `origin` points there, and its `main` and `moab-count` were checked with `ls-remote` before the public repo was created.
    - **Later publishes:** `bash .private/publish-public-btd6.sh` (a dry run), then `--push`. Each adds one snapshot commit after the same checks. Nothing publishes automatically.
    - **Marcus approved one refresh on 2026-10-03, to go out after series 1m** with its result in the README and progress. Refreshes after that need his approval again.
    - **Public docs** (README, docs, PLAN) must not name the lab's unlock file or describe how it works; the script's override scan blocks the publish if they do.
- **Series HS-z2 (started 21:44 UTC): `btd6-playbook-v5` revision 23 in zero-leak mode on Hard Standard**, 5 matches, with the HS-z1 flags and the Hard Standard playbook 1.1.0 (`go-hs12z.sh`, `hs12z-a.log`).
    - It uses game time while revision 20 is built, and starts PLAN's item on zero-leak for the other designs.
    - Revision 23 differs from 22 only in DDT rounds, which Hard Standard never reaches.
    - If the playbook also clears nearly every match, this setup can't separate the designs, and CHIMPS has to.
  - **Result (21:44 to 22:40 UTC; progress data 5d91ffc): 3 of 5 won with all 100 lives.**
    - The two losses were both at round 76, to a burst of regrowing Ceramics: lives fell to −687 and −25, with threat_short binding on burst. This is the playbook's known late-burst weakness from series 5.
    - Jev alone with its rules won 20 of 20 in this mode, 19 with no lives lost. So the setup does separate the designs, though 5 matches is a first look.
    - The live strategist (`btd6-claude-v1`) hasn't played zero-leak mode yet.
- **Considered and declined (2026-10-02, Marcus asked): Banana Farms.**
  - **CHIMPS disables farm income.** Every cash source except starting cash, cash per pop and end-of-round cash is off ([Bloons wiki: CHIMPS](https://www.bloonswiki.com/CHIMPS)), and no CHIMPS log has a farm on offer.
  - **On Hard Standard farms work without clicks** once they have Banana Salvage (x-x-2): uncollected bananas, which otherwise spoil after 15 seconds, are collected at 85%. But zero-leak mode already wins 19 of 20 with cash left at the end, and its one lives-losing match leaked Leads at rounds 28 and 30, where an early farm would have cut the defence further.
  - **Why farms never appear:** the rules rank options by defence and keep at most 16, so farms reach Jev rarely (56 of 42,346 decisions since 2026-10-01, all on Hard Standard) and were never chosen.
  - **Revisit** only for money-limited goals on Hard Standard (for example, harder maps).
- **Series HS-z3 (started 23:07 UTC): `btd6-claude-v1` revision 22 in zero-leak mode on Hard Standard**, 5 matches, one at a time (`go-hs13z-one.sh <n>`, `hs13z-a.log`), with the HS-z1 flags.
  - Each match gets a fresh `general-medium` strategist agent. It works from docs/BTD6-STRATEGIST.md and the requests only, waits in 2-minute slices, and stops when its match's log has `session_end`. The strategy channel starts each match empty.
  - Revision 22 differs from 21 only in DDT rounds, which Hard Standard never reaches.
  - This completes the three designs on the one setup where Jev alone now succeeds: v6 won 20 of 20 (19 clean) and the playbook 3 of 5.
  - **Result (23:07 to 00:17 UTC; progress data eb76ddd): 4 of 5 won, all with 100 lives.** Match 4 lost at round 76 to regrowing Ceramics (241 lives).
    - The strategists answered 13 to 15 requests per match, with one schema error (a `review_round` that wasn't after the current round), and used 68,000 to 83,000 tokens each.
    - A leftover unanswered request from match 4 was moved out of the channel before match 5 (`.private/btd6/strategy-stale/`).
  - **The three designs in zero-leak mode:**

    | Design | Matches | Won | Won with 100 lives | Losses |
    |---|---|---|---|---|
    | v6 r18 (Jev with its rules) | 20 | 20 | 19 | — |
    | claude-v1 r22 (live strategist) | 5 | 4 | 4 | round 76 |
    | playbook-v5 r23 | 5 | 3 | 3 | round 76, round 76 |

  - **Round 76 is 60 regrowing Ceramics within 1.8 seconds.**
    - The margins don't separate the losses. Pops estimate over RBE at round 76: v6 0.59 to 0.96 with no losses; the plan arms' three losses at 0.70, 0.96 and 1.30. Burst ratios at rounds 73 to 76 overlap too.
    - The plan arms had specialised in MOAB damage before it. Match 4's strategist had a fourth Bomb Shooter at 2-4-0, and 198 MOAB damage per second against 130 needed at round 75.
    - **Open:** a ceramic-burst threat in the strategist brief and the playbook for round 76.
  - **Open (data glitch):** v6's 18:17 run logged a round-76 pops estimate of 301,547,519, so some tower's estimate is broken.
- **Decided next, offline first: the DDT-capable figure with support effects.**
  - A tower counts against a DDT when it pops Lead and Black, by its own attack or under a Village MIB covering it.
  - It must also see the DDT: by its own camo detection, under a Village Radar Scanner covering it, or after a camo remover upstream on the track (Shimmer, Counter-Espionage, or any other the export shows) has removed the camo.
  - Check it against measured DDT damage (`moab_measure`) before any policy uses it. Then the deadline-based need goes on top, and then a head-to-head.
  - Implemented on branch `ddt-support` (offline), commits a2a7eb6 and the Skywarden fix after it, 474 tests: `data/towers-ddt-support.json`, `moab.mjs setDdtSupport` (default off, no policy uses it), `npm run btd6:moab-replay -- --ddt --support`.
    - The export confirms Shimmer (Wizard x-x-3 and up, radius 60 to 80), Signal Flare (Mortar x-x-3 and up, 52 around the aim point), Embrittlement (Ice 4-x-x), the Sub's submerged pulse (3-x-x), Cleansing Foam (Engineer x-3-x), Radar Scanner (Village x-2-x, radius 40 to 55) and MIB (Village x-3-x). Counter-Espionage strips camo only from bloons it damages, and its shuriken can't pop Lead, so it works on DDTs only under an MIB. Skywarden 4-x-x has a camo-block zone, which the figure doesn't count: CHIMPS matches with Skywardens and no Shimmer (10-01T20-19, 23-24, 10-02T04-04, 04-48, 06-04, 06-21) logged only "DdtCamo" in their DDT `moab_measure` types, while every match with a Shimmer Wizard (00-29, 03-06, 03-43, 05-09, 05-34, 06-37, 10-01T22-33) logged decamoed "Ddt".
    - 37 CHIMPS DDT records since 2026-10-01T20-00 (26 DDT-only). Measured/estimate, DDT-only: today's figure median 3.67 (1.01 to 150.95), Spearman -0.01; with support effects median 1.90 (0.52 to 5.65), Spearman 0.53. All DDT rounds: 3.76 (1.01 to 150.95), Spearman 0.06; with support 1.93 (0.52 to 5.65), Spearman 0.46.
  - **Merged 3368719, default off.** The figure tracks measured DDT damage far better. Measured damage is a lower bound on capacity (DDTs that die early stop the clock), so its remaining median gap of 1.9 is an upper limit on the figure's error.
- **Decided: `btd6-jev-v6` revision 20, v5 revision 24, claude-v1 revision 23** (branch `ddt-need`; built during series 1k): the DDT check's capacity and need together.
  1. **The support-effects figure is on** (`setDdtSupport`, set by the session for these revisions).
  2. **In rounds with DDTs, the need is deadline-based.** Each MOAB-class bloon must die within its kill window after it spawns.
     - For every interval from one bloon's spawn to another's deadline (its spawn plus its window), the need is the health of the bloons that spawn and fall due inside it, divided by the interval's length, times the lives margin.
     - The DDT part counts against the DDT-capable figure and the rest against every tower's, as `blendedDps` does. The toughest interval sets the need.
     - A single bloon gives today's per-bloon need, so the need is never lower than today's. Rounds without DDTs keep the per-bloon need, and Hard Standard is unchanged.
     - Spawn timing comes from `moab-count`'s `moab_groups` in `rounds.json`.
     - The needs before the margin: round 90 about 217 (3 DDTs in 1.5 seconds; today 66), round 93 about 398 for its 6 DDTs in 2 seconds, and round 95 about 500 for its 30 DDTs over 20 seconds, plus its 50 Fortified MOABs.
  - **Why both together:**
    - The figure alone would raise DDT ratios, so the binding and the DDT lead would act less, while round 95's need is about 5 times the per-bloon figure.
    - The need alone would stack on a figure that runs 3.7 times low at the median.
    - With both, a Shimmer upgrade upstream of the Lead and Black poppers becomes the large DDT answer it is in play.
  - **Revision 19's two parts stay separately switchable**, so revision 20 can sit on revision 18's options if series 1k rejects revision 19.
  3. **Added after series 1k match 4: moab_short's binding and DDT saving aim at the nearest due round below the binding threshold (0.5), not the weakest.** It has its own option.
     - The binding's MOAB gains and the saving's target and gap are computed for that round. With no due round below 0.5, the weakest round still sets the ordering between 0.5 and 1.
     - Without this, the deadline need makes rounds 99 and 100 the weakest, and the saving would chase upgrades that can't be afforded before rounds 93 and 95 (match 4 saved for $34,560 upgrades for rounds 99 and 100 and lost at round 93).
  - **Before its head-to-head, the replay must show** the DDT ratios by round from 80 to the loss in series 1j's logs, the binding and saving counts, and the answers revision 20 would offer at rounds 85 to 94.
  - **Implemented on branch `ddt-need`** (commit 235eea4, 493 tests pass; not merged). It includes two later decisions: with one life, moab_short's binding and DDT saving target the nearest due round below 0.5 instead of the weakest (`moabNearest`; series 1k match 4 saved for $34,560 upgrades aimed at rounds 99 and 100 and lost at round 93 with $85), and revision 19's `moabCapacity` and `ddtGapShare` are off again (series 1k kept revision 18), still switchable.
    - Needs before the margin, from `moab_groups`: round 90 159 (3 DDTs over 1.5 s plus one 6.0 s window), round 93 298 (its 6 DDTs), round 95 889 (30 DDTs and 50 Fortified MOABs over 36 s). With one life the margin puts round 95 at 1,285 to 1,335. The earlier estimates above (217, 398, 500) used other intervals.
    - Replay (`npm run btd6:threat-replay -- --ddt-need`), CHIMPS v6 logs from 2026-10-01T20-19, from round 76, 39 logs, 4,620 rebuilt decisions, revision 18 against 20: moab_short binds at 1,222 and 2,190; saves at 2,175 decisions (236 match-rounds) and 1,360 (205); only pass options left at 2,963 and 2,044; option sets differ at 1,686. The nearest-round rule moves the target round at 1,138 binding and 994 saving decisions; without it revision 20 saves at 1,013 decisions (155 match-rounds). Hard Standard from 2026-10-01: 0 of 7,988 decisions differ (27 normal logs) and 0 of 6,612 (20 zero-leak logs, read with one life).
    - Series 1j's lowest DDT-round ratio, rounds 80 to the loss: revision 18's check 0.05 to 0.55, set by round 90 to round 88 and by round 99 or 100 after; revision 20's 0.03 to 0.43, set by round 90 to round 82, round 93 at 83 and 84, and round 95 or 99 from round 85 (0.03 to 0.14).
    - Revision 20's binding answers at the first decision of rounds 85 to 94 in series 1j: it binds at 20 of 48. The answers are mostly Sniper upgrades ($270 to $6,805, gains 0.1 to 22.9, up to 11.5 per $1,000) and once the $16,200 Dart 5-0-2 (+3). At the rest it saves or has no affordable MOAB adder.
    - **Added on the same branch: the DDT saving targets the most DDT gain per dollar** (`ddtSaveBest`, on in revision 20; ties to the cheaper; the binding is unchanged; `ddtSaveBest: false` gives the cheapest adder). 494 tests pass. Saving-only replay on the same 39 logs (4,620 decisions): revision 18 saves at 2,175 decisions (236 match-rounds); revision 20 with the cheapest adder at 1,360 (205); with the best per dollar at 1,552 (220). In series 1j and 1k the $595 Alchemist targets (gain 0.1 to 0.4) become $2,375 Sniper upgrades (gain about 21) or a $6,805 Sniper 4-0-2 (gain 16), and the late $120 to $380 targets for round 95 become $270 to $2,375 upgrades (gain 3 to 21). Where the pool's only DDT adder for a round is the $16,200 Dart 5-0-2 (05-50-38, 06-21-07, 20-15-21, 20-46-18, 21-14-35), the target stays that (gain 2 to 3.5).
    - Revision 20's saving targets (series 1j and 1k): the cheapest DDT-capable purchase, mostly the $16,200 Dart 5-0-2 (gain 2.1 to 3.2) or a $595 Alchemist (gain 0.1 to 0.4), against gaps of 140 to 230 for round 90, 290 to 420 for round 93 and about 1,150 to 1,190 for round 95.

**Series 7 (played 2026-10-01 08:56 to 11:10 UTC on main 3a79fd5).**
- **Results:**
  - v6 revision 5: **5 of 5 won**, with 100, 100, 54, 100 and 100 lives. Revision 4 won 3 of 5 in series 6.
    - `camo_capacity` acted only in the 54-lives match (20 decisions). That match lost lives at rounds 4–5, 25, 33–37 and 60, and got past round 56.
    - The other four lost no lives.
  - v5 revision 9: **2 of 5 won**, the same as revision 8's 1 of 5 within noise:
    - lost at round 76, all lives in that round;
    - won with 37 lives;
    - lost at 49;
    - won with 100;
    - lost at 76 again: that was the replacement match.
- **A sixth v5 match isn't counted.** At round 8 a Jev request timed out and paused the runner, and the match was lost at round 17 with $2,697 unspent (issue `runner-timeout`). Fixed in f3519a6 (merged after the series):
  - a timed-out Jev request is retried once, then skipped without pausing;
  - bridge reads are retried;
  - a command with an unknown result still pauses;
  - error records name the source (`jev`, `bridge_read`, `bridge_command`).

  The source was inferred from timing: the error came 31.1 s after the last decision, and the Jev timeout is 30 s.
- **The Juggernaut target didn't fix round 76.** In the replacement match both 4-0-2 Darts were built, yet the round popped 5,713 of 6,240. In the first round-76 loss, one was built and it popped 5,192.
  - Two rounds before, both losses had 24 to 28 towers, with $661 to $716 in cash.
  - Seven to nine of those towers were Bomb Shooters, most on the MOAB path (0-3-2, 0-4-2), which do little against Ceramics.
  - From round 70, `no_wait_behind`, `survival_first` and `threat_short` fired at most decisions, so the plan was set aside and spending went to quick answers.
- **Next (proposed, not started):**
  1. CHIMPS (step 8) with `btd6-jev-v6` revision 9 (series 1e, `threat_short` binding with one life; revisions 5, 6 and 7 lost at round 6 in series 1, 1b and 1c, and revision 8 lost at rounds 76, 33, 33, 24 and 28 in series 1d). It needs no Claude usage beyond the reports, and 4 of its 5 series 7 wins lost no lives.
  2. Then decide whether v5 earns another playbook revision, since its late game keeps failing the same way, or leaves the CHIMPS comparison.
  3. claude-v1 and the notes arm on CHIMPS when Claude usage allows.

**Series 7 (decided 2026-10-01).**
- **Arms:** `btd6-jev-v6` revision 5 and `btd6-playbook-v5` revision 9 (playbook 1.1.0), 5 matches each, alternating, on Monkey Meadow Hard Standard, with the series 6 flags (`--ruleset v3 --speed graded:10 --moab-short-speed 3 --camo-margin --moab-factor 1.27 --pops-factor 1`). `btd6-claude-v1` goes to revision 8 with the same rule; v4 is unchanged.
- **Change A: `threat_short` kind `camo_capacity`** (`threat.mjs` `THREAT_KINDS_V3`; docs/ARCHITECTURE.md, "threat_short camo capacity"). In series 6, v6 lost twice at round 56 (camo Rainbows) with a camo margin below 1.0, and no rule read camo capacity. Trigger: a camo round within 3 rounds whose camo margin (`camoCheck`) is below 1.0. Answers: affordable purchases that raise it, highest camo-margin gain per dollar first; while one is affordable, waiting is removed. It never saves. Order of kinds: Lead, camo and camo Lead answers first, then camo capacity, then burst. A survival rule in the plan policies.
- **Change B: v5 playbook 1.1.0.** Phase `zomg` adds `jugg`, two Dart Monkeys 4-0-2 from round 62, due by 74, and both holds in that phase are also for it. In series 6, v5 lost at rounds 76 and 78 with Snipers and Bomb Shooters about 7 to 10% short of the Ceramic bursts; its late game held cash for MOAB damage only.
- **Replay (data only, `npm run btd6:threat-replay -- --camo-capacity --current-era`, 39 runs, threat_short only):** decisions where `camo_capacity` decides (waits it removes): v6 r4 83 (83), v6 r3 58 (58), v6 r2 50 (50), v5 r8 128 (128), v5 r7 96 (90), v5 r6 86 (86), claude-v1 r6 29 (29), claude-v1 r7 0. In the two v6 round-56 losses its first answer at every decision in rounds 53 to 56 was the same: 06:56, a Skywarden 1-0-1 to 2-0-1 ($230, camo margin +0.035 on 0.67); 07:18, a Ninja placement ($430, +0.029 on 0.98), which the tower cap (16 towers) replaces with a Dart 3-0-2 to 4-0-2 ($1,945, +0.024) at the decisions where that upgrade was affordable.

**Series 6 (running since 2026-10-01 05:31 UTC; decided below under "Series 6 (decided 2026-10-01)").**
- **Arms:** `btd6-jev-v6` revision 4 and `btd6-playbook-v5` revision 8, 5 matches each, on Monkey Meadow Hard Standard. `btd6-claude-v1` revision 7 played match 3 only (won with 100 lives; 17 requests, 15 adopted).
- **Decided 2026-10-01: claude-v1's other Hard Standard matches are dropped,** to conserve Claude usage (Marcus asked).
  - Hard Standard doesn't separate claude-v1 from v6: both won 3 of 3 in series 5, and both won with 100 lives in series 6.
  - The strategist's matches move to CHIMPS (step 8), where one life can show a difference.
  - Matches 1 to 3 alternated v6, v5 and claude-v1. From match 4 (06:30 UTC, code 61a66b6) v6 and v5 alternate.
- **Results (finished 2026-10-01 08:07 UTC; progress data 746921b):**
  - v6 revision 4: **3 of 5**. It won with 100, 100 and 97 lives, and lost at round 56 twice (matches 6 and 8).
  - v5 revision 8: **1 of 5**. It lost at round 76, then won with 100, then lost at 78 three times. Every loss came in one late burst round, with no lives lost before it.
  - claude-v1 revision 7: won its one match with 100 lives.
  - No lives were lost at 5x or 10x. All of the losses were at 3x or 1x.
- **Round 56 (40 camo Rainbows and a MOAB) ended both v6 losses.**
  - In series 5, v6 revision 3 passed it 3 of 3.
  - Match 8 entered round 56 with a camo margin of 0.98. The three wins logged 1.04, 1.18 and 1.23. Match 6 logged 0.67 at round 56's `speed_set` and played the round at 1x. `npm run btd6:camo-replay` rebuilds all five values from the decision states.
  - Camo capacity data (`npm run btd6:camo-replay`, data only; 36 runs from 2026-09-30 19:26 UTC): lost rounds with their camo and whole margins, the camo margin's percentiles in clean camo rounds by round band, a 3-round look-ahead at camo thresholds 0.9 to 1.3 (rounds flagged, losses against clean rounds, affordable answers by camo gain per dollar), and the purchases before round 56 in both losses. At 1.0 both round-56 losses are flagged from round 53. No rule uses it.
  - In match 6, Jev saved about $3,700 through round 55, then spent $3,725 on a Bomb Shooter 0-4-2 at round 56's start. Bomb Shooters can't see camo.
  - Nothing in the decision rules reads the camo margin. Only speed uses it, as decided. `threat_short` checks whether some tower sees camo, not whether there's enough camo capacity.
  - Composition alone doesn't separate wins from losses: both losses had 5 Bomb Shooters, and so did the match 10 win.
- **Rounds 76 and 78 ended every v5 loss.**
  - v6 passed round 78 in all 6 of its series 5 and 6 matches that got there. v5 lost at 76 or 78 in 6 of its last 8.
  - The whole margin at round 78 fits the 2.1 split again: the three losses had 1.66 to 1.98 and the win 2.17. Series 5's win at 1.69 is still a counterexample.
  - The win had $5,289 at round 74; most losses had about $800, and one had $3,157.
  - So the playbook's late game is the weakness, not the rules both arms share.
- **Next (proposed):**
  1. Win rates in the README (step 7). Done: v6 r4 3 of 5, v5 r8 1 of 5, and v6 r2 1 of 5 also qualifies.
  2. Data on a camo-capacity check: the camo margin at each round's start across logged runs, how often a check would fire, and whether it would have flagged both round-56 losses.
  3. A late-game revision of the v5 playbook for rounds 70 to 78.
  4. Then a new series. CHIMPS waits until v6 stops leaking early; in series 6 it lost lives at rounds 4–5 twice and 33–34 once, and on CHIMPS any leak ends the match.
- **Flags:** `--ruleset v3 --speed graded:10 --moab-short-speed 3 --camo-margin --moab-factor 1.27 --pops-factor 1`; label `graded:10+moab3+camo`.
- **Code:** main 39e7c49, which merges `series6`: the corrected tower table `922e6b5e918c`, `GRADE_AT_CAMO` 1.82 / 1.17 / 0.88, the bloon summary in the logs, and run provenance (`lab_commit`, `code_commit`, `code_dirty` in `run_start` and the series entry). 356 tests pass.
- **Bridge 0.3.15, checked live** (2026-10-01 05:28 UTC). Before round 3, `bloons.nearest_exit` was empty; during the round it listed the 5 furthest bloons, furthest first, with progress rising. `go_home` returned to the menu.
- **First run_start:** revision 4, ruleset `btd6-open-v3`, label `graded:10+moab3+camo`, table `922e6b5e918c`, bridge 0.3.15, `lab_commit` and `code_commit` 39e7c49, `code_dirty` false.
- **Strategist:** a new `general-medium` agent for each claude-v1 match, started when the v5 match before it starts, with an empty strategy channel. It works from docs/BTD6-STRATEGIST.md and the requests only, and stops when its match's log has `session_end`.
- **Check each run for:**
  - lives lost at 5x or 10x;
  - rounds 76 and 78;
  - where `+camo` sets a lower level than the whole margin would;
  - the bloon summaries in the logs.
- **After the series:**
  - `npm run btd6:progress -- --add` and `npm run btd6:rules-audit`;
  - win rates for the three arms (step 7, done: v6 r4 and v5 r8 qualify; claude-v1 r7 has 1 run);
  - then the CHIMPS step with the notes arm (step 8).

**Series 5 (2026-09-30 23:22 to 2026-10-01 01:35 UTC): paused after 9 of 15 matches at Marcus's request, then closed in favour of series 6** (stop file; progress data a936457).
- **Results** (Hard Standard, `--ruleset v3 --speed graded:10 --moab-short-speed 3 --moab-factor 1.27 --pops-factor 1`):
  - v6 revision 3: won 69, 98 and 100 (3 of 3);
  - claude-v1 revision 6: won 80, 63 and 100 (3 of 3); runs 2 and 3 are tagged `strategist-memory`;
  - v5 revision 7: lost at 78, lost at 76, won 100 (1 of 3).
- **Lives lost at 5x or 10x:** none in all 9 matches.
- **Rules audit** (52 runs):
  - leak_pressure fired in 287 rounds, 68% without a leak in that round or the next. It is a real warning, so it stays.
  - `threat_short` fired in 74 rounds (95% without a leak), 40 of them from round 60, at 90%.
  - The tower-cap exception fired in 175 rounds (85%), most from round 60 (92, at 82%).
  - v5's `branch:leak_fix` fired in 27 rounds, 44% without a leak, which fits a branch that follows leaks.
  - No rule fires heavily without purpose, as `moab_short` once did.
- **The v5 runs diverge early:** 4, 3 and 6 Wizards by round 30. The win leaned on Ninjas (6 at round 74), the losses on Bombs and Skywardens, which measure well below their estimates.
- **Closed at 9 matches (2026-10-01 05:22 UTC, when Marcus asked to continue the recommendations).** Series 6 replaces the 6 remaining matches. Its arms run on new revisions (the corrected table), so series 5's 9 matches stay a separate series with no win rate.

**Decided (Marcus, 2026-10-01): the notes arm comes after the clean arms' win rates, with the move to CHIMPS** (step 8).
- **A fourth arm, `claude-v1-notes`:** a fresh strategist agent each match, which reads and updates a short lessons file (about 15 lines) written by earlier matches' strategists.
  - It tests whether accumulated experience helps a live planner, against the clean claude-v1, with the learning kept in a file that can be read, reset and replayed rather than in hidden context.
  - Order: series 6 first gives the clean arms' win rates (v6, v5 and claude-v1 with a new strategist each match). Then the notes arm joins at step 8, where claude-v1 doesn't already win every match. On Hard Standard claude-v1 won 3 of 3, which leaves no room to show an effect.

**Series 5 (as first planned):**
- **Run 1:** v6 revision 3 won with 69 lives in 15.7 min. No lives were lost at 5x or 10x, and `threat_short` `burst` fired 12 times.
- **Speed:** only 0.4 min was at 10x, with 1x 5.9, 3x 6.7 and 5x 2.7 min. There were 33 slowdowns.
  - **Correction (2026-10-01):** the earlier breakdown here (about 7 min climbing back, about 4.5 min of leak pressure at 10x, and so on) counted all the time spent below 10x, not the time lost, and it mixed up two signals. Leak pressure fires when a bloon reaches 0.6 of the track and holds to the round's end; in series 5 it never fired from 10x. "Bloons past 0.5 at 10x" is the separate `bloons_past` signal.
  - **Time lost against 10x, per match** (series 5 runs 1-3, `npm run btd6:speed-replay -- --causes`; at speed s under allowed level L, the climb costs dt(1 - s/L) and L's cause dt(s/L)(1 - L/max)):
    - `hard_round` 1.97 min;
    - margins below 1.3, 1.0 and 2.0: 1.01, 0.88 and 0.33 min;
    - `leak_pressure` 1.58 min;
    - `moab_short` 0.53 min;
    - strategist consults 0.46 min;
    - cooldown alone 0.35 min;
    - the climb back after a drop 0.32 min (run 1: 0.43);
    - `moab_outrun` 0.27 min;
    - `hard_round_next`, `buying` and `end_rounds` 0.20, 0.20 and 0.18 min;
    - caps together 0.22 min.
- **Run 2:** v5 revision 7 lost at round 78 in 11.8 min, 1.8 of them at 1x. No lives were lost at 5x or 10x.
  - Round 56 lost 31 lives, all at 1x, after the drop for bloons past 0.7 at the hard-round 3x cap. The round's margin was 3.55: RBE 2,496, measured pops 2,413, estimated 10,345.
  - Round 78 lost the last 69 lives, at 3x and then 1x.
  - `threat_short` flagged `burst` for round 78 only from round 75, its look-ahead limit. The ratio was 0.81 with $615 in hand. Eleven cheap placements (Skywardens and Snipers, under the tower-cap exception) and their upgrades raised it only to 0.88.
  - Run 1's v6 reached round 74 with $3,813 and 21 towers (6 Skywarden 2-0-2, 4 Wizard 3-1-0, 2 Bomb 0-4-2 and 2 Bomb 0-2-4 among them), and lost no lives in round 78. v5 had $810 and mostly low-tier towers.
  - So the burst warning comes too late for a weak economy to answer (see the pops study below for the round-78 margins across runs).
- **In progress, merged after series 5 so the series stays on one code version.** Analysis and choosing direction stay with the primary (Max) session; Medium agents gather data and implement decided changes (Marcus, 2026-09-30).
  - **Pops estimate by tower type: decided 2026-10-01, no fitted factors** in the margins or in Jev's facts. Branch `pops-types` holds the study tool (`npm run btd6:pops-study`); merge it after series 5.
    - **Data:** 22 runs with `pops_round`, 1,482 rounds (45 lost lives, 26 lost more than 5).
    - **Within-round AUC:** for runs at the same round where one lost lives and one didn't, the share of pairs where the run that lost lives had the lower margin (0.5 is chance).
      - Current estimate: 0.563 overall, 0.493 from round 30.
      - Per-type factors, leaving one run out: leak rule by path 0.703, tight rule by path 0.703, relative rule by path 0.666.
    - **At the operating points** (thresholds where 70, 90 and 95% of clean rounds are at or above), the share of rounds that lost more than 5 lives below them:
      - current estimate: 42, 15 and 12%;
      - current min(whole, burst): 54, 38 and 27%;
      - leak rule by path, min(whole, burst): 58, 46 and 19%.
    - **Measured over estimated, in leak rounds:** Sniper 1.92, Ninja 1.15, Quincy 0.94, Ace 0.58 (at its 0.1 share), Dart 0.31, Skywarden 0.22, Bomb Shooter 0.19 (bottom path tier 3+: 0.08), Wizard 0.07 (0-0-0: 0). All three fitting rules point the same way.
    - **Round 78** (current-era runs, from 10:07 on):
      - The 5 runs whose current whole margin at the round's start was below 2.1 (burst below 0.95) all lost lives there.
      - Of the 9 at 2.27 or above, 7 lost none. The two exceptions are 10:07 v6 at 3.46 and 22:38 v6 at 2.68.
      - The per-type corrected margins and the camo-seeing towers' pops/s don't show this split.
      - **Counterexample (series 5, run 8, v5 revision 7):** it entered round 78 with a burst ratio of 0.70 (whole margin about 1.6) and lost no lives there, and won with 100. So the split is a warning sign, not a reliable predictor.
    - **Why no factors:**
      - small gains at the operating points, and they would need new thresholds;
      - worse at round 78 than the current estimate;
      - fitted factors mix a tower's capability with its position on the track and its share of the bloons, so in Jev's facts they could pass off position effects as tower quality.
    - **Next, data only, then the primary decides:**
      - **Done: how `towers.json` derives pps, compared with the game data** (`npm run btd6:pops-derive`, branch `pops-types`). The counted fields match the export. The differences:
        - **Sniper shrapnel** (`EmitOnDamageModel`) isn't counted (counted from branch `pops-types`, above). The Sniper upgrades with shrapnel measure 2.4 to 4.1 times their estimate; those without it measure 0.9 to 1.0.
        - **The estimate ignores camo.** It counts every tower's full rate in camo rounds, though Bomb Shooters and Wizards can't pop camo. A 0-2-4 Bomb in round 56 (40 camo Rainbows) popped 72 and 213 against an estimate of 3,473; in a non-camo round it reached about 0.5.
        - **Bomb clusters:** the 8 cluster explosions count at full pierce.
        - **Skywardens** measure 0.24 to 0.29 of their estimate, although the estimate leaves out several of their bonuses.
        - **Wizards** at 0-0-0, 1-0-0 and 0-1-0 popped nothing in 57 to 68% of their tower-rounds (81% from round 40 for 0-0-0), which points at placement or reach rather than the formula.
      - **Decided next (candidate, not wired in):** count on-damage children such as shrapnel in the generator, and add a camo-aware margin, min(whole, camo-capable capacity against camo RBE), plus Purple if the data allows. Evaluate current, each fix and both with the study tool (AUC, operating points, the round-78 split). Adoption is decided on those numbers. Also gather data on why Wizards pop nothing (position, reach, bloons in range).
      - round 78 in the 19 runs that reached it: towers and the track they cover, area or single-target, the loss timeline, bloons near the exit, purchases and margins in rounds 70 to 78 (branch `r78-data`).
  - **Round 78 data** (branch `r78-data`, `integration/btd6/r78-data.mjs`; 20 runs reached the round):
    - Every life lost there went at 1x, 90 to 93 game seconds into the round, as the burst reached the exit.
    - **The margin split:** the current whole margin at round 78's start was below 2.1 in 5 current-era runs, and all of them lost lives. Of the 11 at 2.11 or above, 9 lost none (the 00:06 v6 win was at 2.11). The exceptions were 10:07 v6 at 3.46 and 22:38 v6 at 2.68.
    - **No split:** cash at round 75 (about $380 to $1,400 in most runs either way), spending in rounds 75-78 (about $2,000-5,000 a round in both groups), and the second-half track covered by camo-seeing or area towers.
    - The losers reach the round with a weaker defence overall, and a 3-round warning can't close that.
  - **Decided 2026-10-01, being implemented (not merged; next series):**
    - ~~`threat_short` looks 8 rounds ahead for `burst`~~ **Dropped after the replay (2026-10-01):** compared with a round 8 ahead, the defence nearly always looks short, so it fired throughout the game. It removed 1,887 waits against revision 3, 1,392 of them before round 60, and set the plan filters aside in most decisions of the plan policies (the strategist's ZOMG holds included). The window stays at 3 rounds for all threats.
    - Burst answers by the highest burst-ratio gain per dollar: **no change in effect.** The replay (rounds 75-78, 26 runs) shows revision 3 already ranked burst answers by estimated pops per dollar, which is the same order, so the first answer was identical in every decision. Match 2's cheap Skywardens came from the estimate, which rates Skywardens about 4 times their measured pops (0.22-0.29 measured over estimated). Checked against the game data (`npm run btd6:pops-derive -- --weapons`):
      - **Skywarden:** its attack has two weapons, swapped by a focus stance (`ToggleFocusStanceModel`, `swapWeapon: true`), and the derivation adds both, doubling the estimate. The one-weapon tier 2-2-0 measures 1.12 of its estimate; the swapped tiers measure 0.24-0.32, or 0.32 near the track's start.
      - **Bomb 0-2-4:** its 8 clusters burst in a full ring around the impact point, travelling 22-40 units before exploding with radius 15. Only 2 to 4 of the 8 directions land over the track, but all 8 are counted at full pierce.
      - **Wizard 0-0-0:** the derivation matches the export, so its zero pops come from placement, supply and immunities.
    - **Decided (2026-10-01), as a candidate first:**
      - count one weapon when a stance swaps weapons;
      - count ring-emitted children that land beyond their explosion radius at 0.5 of their number.
    - Lower estimates move every threshold set on the old table, and round 78's split at a burst ratio of 1.0 was found on that table. So the agent first reports, on the new table:
      - the speed thresholds re-derived;
      - the round-78 split;
      - how often verdicts are `enough` and burst fires;
      - the speed replay.
    - Then the primary decides between series 6 and later.
    - Revisions bump: v6 4, v5 8, claude-v1 7.
    - Logs gain a compact bloon summary per decision state: count, furthest progress, and the 5 furthest bloons with type and flags. Bloon positions were never logged, which limited the speed replay and this study.
    - The threat replay shows where the new rule fires and what it changes.
  - **Found while gathering:** `towerEstimate` rates Quincy at level 1, because the logged hero level sits in the first tier and the estimate reads only a `level` field or the tower's name. It goes to the estimate agent with the candidate fixes. Decided: it goes into the estimate with the candidate fixes below.
  - **Candidate estimate evaluated** (branch `pops-types`, `npm run btd6:pops-study -- --fixes`; nothing is fitted):
    - **Within-round AUC, whole margin:**
      - current 0.563 overall, 0.493 from round 30;
      - Fix 1 (on-damage projectiles such as Sniper shrapnel) 0.563 / 0.493;
      - Fix 2 (camo-aware: min(whole, camo-capable capacity against camo RBE)) 0.710 / 0.725;
      - both 0.716 / 0.736.
    - **At the clean-share thresholds** (70/90/95%), rounds that lost more than 5 lives fall below them: current 42/15/12%, Fix 2 69/46/27%, both 62/42/23%.
    - **Round 78:**
      - Fix 1 keeps the split. Current-era winners had burst ratios of 0.99 or more, losers 0.96 or less, apart from the two high-margin v6 losses.
      - Fix 2's camo burst is 0.11 to 0.54 in every run, winners included, so it can't serve as a burst threshold.
    - **Wizards:** those whose covered stretch starts past 0.5 of the track measure about 0.03 of their estimate, against 0.45 for those covering the start. That is a supply and position effect, not counting.
  - **Decided 2026-10-01, being implemented on `pops-types` (merge with the burst change for series 6):**
    - **Fix 1 into `towers.json`:** Sniper shrapnel tiers from about 0.3 to 0.5-0.8 of measured pops; 36 of 1,684 rows change. It shares the burst change's revisions (v6 4, v5 8, claude-v1 7). v4 stays frozen.
    - **Fix 2 in graded speed only,** as a new option and label (`+camo`). `GRADE_AT` is re-derived so the share of clean rounds at each level matches today's, and the speed replay compares the label with `graded:10+moab3`.
    - **Quincy's level** counts in the estimate.
    - **Not now:** Fix 2 in `roundCheck` verdicts and rules (every rule on a new scale, and the burst rule keeps the non-camo ratio), the Purple variant (no difference), and a position-aware estimate (open item).
  - **Implemented on `pops-types`** (31f9640, 5a29740):
    - `towers.json` counts on-damage projectiles (table version `984c4369abfb`). MOAB damage leaves them out, because shrapnel flies off the bloon it hit.
    - v4 keeps `data/towers-v4.json`.
    - Quincy's level was already read live from the tower's name; replays and tools now read it from the tiers.
    - `--camo-margin` gives the label `graded:10+moab3+camo`, with `GRADE_AT_CAMO` 1.95 / 1.29 / 1.01 (the share of clean rounds at each level as in series 5).
  - **Speed replay, all runs / current era:**
    - minutes per match: series 5's setting 10.1 / 11.8; the new table 9.8 / 11.6; the new table with `+camo` 9.9 / 11.7;
    - with `+camo`, 9 rounds that lost lives move from 3x to 1x (5 of them lost more than 5) and none move up;
    - replayed lives lost at 10x: 0 in all three.
  - **Series 6 (decided 2026-10-01):**
    - **Code:** the burst answer order (`r78-data`, 3-round window) and this branch, merged together after series 5. Bridge 0.3.15 (the bloon list for the logs) is installed and checked live before series 6.
    - **Revisions:** v6 4, v5 8, claude-v1 7, for the shrapnel table, the only change to purchase decisions so far. The burst branch adds the bloon summary (bridge 0.3.15), and its answer order is the same as before.
    - **Flags:** `--ruleset v3 --speed graded:10 --moab-short-speed 3 --camo-margin --moab-factor 1.27 --pops-factor 1`.
    - **A new strategist agent for each claude-v1 match** (decided 2026-10-01). In series 5 one agent served all five claude-v1 matches, and from its third match it planned with lessons from earlier ones (the round-33 and round-37 leaks, the camo-Lead gap). v6 and v5 start every match fresh, so claude-v1's later matches were better informed and its win rate depends on match order. Series 5 stays as run and is marked as such. The strategist brief gains a line: plan from the brief and this document, not from earlier matches.
    - **Integration:** a Medium agent combines `speed-climb`, `pops-types` and `r78-data` and resolves the known conflicts in `speed.mjs` and `speed-replay.mjs`. The primary reviews and merges.
    - **Integration branch `series6`** (built 2026-10-01; merges after series 5): main, then `speed-climb`, `pops-types` and `r78-data`. Corrections A (Skywarden one weapon) and B (Bomb ring clusters at 0.5) are in `data/towers.json` (version `922e6b5e918c`; 47 rows differ from the Fix-1 table, 83 from series 5's), `GRADE_AT_CAMO` is 1.82 / 1.17 / 0.88, and `graded:10+moab3` keeps 2.0 / 1.3 / 1.0. MOAB damage is unchanged by A and B. `towers-candidate.json` stays for the studies only (the Purple field; its pops per second equal `towers.json`). Revisions v6 4, v5 8 and claude-v1 7 cover: decisions, the tower table (on-damage projectiles, Skywarden one weapon, Bomb ring clusters at half) and the burst answer order (the same as before in effect); logging and speed only, the bloon summary, bridge 0.3.15 and `+camo`. v4 stays on `towers-v4.json`.
      - Checked on the branch: `npm test` (352), `npm run btd6:bridge-test`, the bridge build 0.3.15 (0 warnings; DLL SHA-256 `a682e835248daaa73ed4a38012fe161efafdc16a7b7decf0ce9e820b5d51255f`, not installed), dry runs of jev-v6, playbook-v5, claude-v1 and jev-v4 with the series-6 flags (revisions 4, 8 and 7 on table `922e6b5e918c`; v4 on `14b45d4c4959` with `table: "v4"`; label `graded:10+moab3+camo`; bloon summaries logged), and `npm run btd6:threat-replay -- --burst --rounds 75-78` (21 runs; on the new table a different first answer in 7 decisions, 2 in 09:30 and 5 in 20:10, no waits removed, no answers forced, no saving). Bridge 0.3.15 was checked live on 2026-10-01 (Series 6, above). The new table and `+camo` are in play from series 6.
  - **Burst answer order: decided 2026-10-01, implemented on branch `r78-data`, merge after series 5.** `btd6-jev-v6` revision 4, `btd6-playbook-v5` revision 8 and `btd6-claude-v1` revision 7 (`threat.mjs` `THREAT_BURST_AHEAD`; v4 unchanged):
    - Burst-only answers go highest burst-ratio gain per dollar first; Lead, camo and camo Lead answers stay cheapest first; saving still targets the cheapest check answer, and a burst gap alone never saves. Burst is checked 3 rounds ahead, as in revision 3.
    - Logging only: each logged state keeps `bloons: {count, furthest, nearest_exit}`, the 5 bloons furthest along with type, camo, regrow, fortified and progress (bridge 0.3.15, built, to be installed and checked live after series 5).
    - **Tried and dropped: an 8-round burst window.** Replayed on 24 runs that reached round 68 (`npm run btd6:threat-replay -- --burst`), it flagged burst all game (round 3 with no towers, then rounds such as 10, 15, 21, 39, 43 and 49 five to eight rounds ahead) and removed 1,887 waits against revision 3 (1,392 before round 60, 437 in rounds 70 to 80). In the plan policies `survival_first` then set the plan aside in most decisions, including holds for the round-80 ZOMG. Round 78 would have been flagged from round 70 in 15 runs (ratio 0.72 to 0.99).
    - **Replay of the decided version** (`npm run btd6:threat-replay -- --burst --min-round 75 --rounds 75-78`, 26 runs that reached round 75, on the logged states; data only):
      - Against revision 3: 0 waits removed, 0 answers forced, 0 saving, 0 different first answers. In all 331 decisions with burst-only answers, the gain-per-dollar first was the same as revision 3's pops-per-dollar first: the gain is the added effective pps times a constant for the due round, so both orders rank the same.
      - Against cheapest first: a different first answer in 284 of the 331. Summed over those decisions per run, gain per dollar against cheapest: 21:12 +0.216 for $9,130 against +0.078 for $8,145; 21:59 +0.206 for $7,700 against +0.084 for $7,525; 22:21 +0.144 for $5,950 against +0.061 for $5,795; 23:38 +0.227 for $9,095 against +0.101 for $8,300; 20:10 +0.257 for $6,340 against +0.065 for $4,945. These sums count every decision, not only purchases made.
      - Typical pair: a Skywarden placement ($220, burst ratio +0.0059) against a Dart Monkey placement ($215, +0.0024). At round 75 the round-78 ratio was 0.78 to 0.98 in the runs flagging it.
      - Limits: purchases without a cost in the logs are left out; the v3 rules before `threat_short` and v6's tower cap aren't rebuilt.
    - Not changed here: `estimate.mjs` `towerEstimate` reads Quincy's level from `level` or the tower's name ("Quincy 7"). Logged states drop the name (`runner.mjs` `describeState`) and carry the level in `tiers[0]`, so every estimate rebuilt from the logs (margins in r78-data, the replays) counts Quincy at level 1 (3.2 pps). Live states keep the bridge's `name`; whether it carries the level is unchecked. For the agent working on `estimate.mjs`.
  - **Graded speed's climb-back: decided 2026-10-01, no speed change** (branch `speed-climb` holds only replay tooling: `--causes`, `--fine`, `--current-era`, and replay-only `gradedSpeed` options that are off by default; merge it after series 5).
    - **Replayed** over 22 current-era graded runs with `--fine` (logged danger signals, 250 ms clock). Change in mean minutes per match against the 11.37 baseline: hold 1 s -0.36, step 2 s -0.24, buying cap 0 s -0.19, hold 2 s -0.18, buying 1.5 s -0.01, hold 4 s +0.11.
    - **Safety numbers:** every variant matched the baseline on the 26 logged rounds that lost more than 5 lives and on replayed lives lost at 5x or 10x. Buying 0 s added one round lost after entering at 10x (leave-one-out).
    - **Why no change:** the best variant saves about 20 s per match (3%). The replay can't see a danger that only faster play would cause, because bloon positions aren't logged, so its safety numbers are weakest for exactly these variants.
    - **Where the time goes instead:** the hard-round cap and leak pressure, which is where the losses are. Of the 26 rounds that lost more than 5 lives, all but one started at 3x or below. Leak pressure from 3x in series 5 preceded lost lives in 6 of 14 rounds, so it stays.
    - **What remains:** the margins (about 2.2 min per match), which depend on the pops estimate. That is the pops study.
- **Dashboard:** merged in 97ff4ff. `npm run btd6:dashboard` serves http://127.0.0.1:4319, read-only. It has been checked beside the live series with the bridge answering.

**Series 5, next** (decided 2026-09-30 23:20 UTC after Marcus asked to run faster):
- **Arms:** v6 revision 3, v5 revision 7 and claude-v1 revision 6, alternating. claude-v1 runs with a `general-medium` strategist agent.
- **Flags:** `--ruleset v3 --speed graded:10 --moab-short-speed 3 --moab-factor 1.27 --pops-factor 1`. That is graded speed up to 10x, with the hard-round list (3x on listed rounds, 5x the round before, 3x in the last 6 rounds), the buying cap, and `moab_short` alone at 3x instead of 1x.
- **Why:** the speed replay estimated about a third less time than graded:5, with every current-era round that lost more than 5 lives played at 3x or below.
- **Check each run for** lives lost at 5x or 10x, and fall back to graded:5 if a round loses lives at 10x.
- **Series 4** (graded:5, v6 revision 2 and v5 revision 6) stopped after 9 runs as the baseline before the round-78 fix:
  - v6: lost at 78, won with 71, lost at 59, lost at 78, and a ninth run;
  - v5: won with 98, lost at 78, lost at 78, lost at 76 (round 76 is 60 regrowing Ceramics in 1.8 s).

0. **Threat readiness under auto-start (all arms): done in code** (`threat_short`, `threat.mjs`; ARCHITECTURE.md under v4). From 3 rounds before a round the towers can't handle for Lead or camo (the check behind "missing"):
   - while an answer is affordable, waiting goes and the answers come first, cheapest first;
   - while none is affordable, every purchase goes until the cheapest answer is affordable (except under leak pressure).
   
   It is a survival rule in the plan arms, and the tower cap lets an answering placement through only when no upgrade answers. v4 is unchanged. On in `btd6-jev-v6` revision 2, `btd6-playbook-v5` revision 6 and `btd6-claude-v1` revision 5; claude-v1 revision 5's instructions also ask for a threat's `by_round` at least 2 rounds before its round, and one answer target with a `cash_hold` if needed.

   Replay (`npm run btd6:threat-replay`, 39 logs):
   - **The claude-v1 loss** (`...20-45-16-989Z...`), rounds 24 to 28: round 24 has no gap (round 28 is 4 rounds away). Rounds 25 to 28 have 24 decisions with a Lead gap. At none of them was an answer affordable: cash was $27 to $280 and the cheapest answer, a Wizard's 1-1-0, cost $325. The rule without saving would never have fired, which is why it saves. It would have saved at 23 decisions (the 24th is the defeat screen). Adding back the $270 Wizard placement it would have blocked at round 25, cash reaches $326 at the fourth decision of that round. From there the rule puts the Wizard's 1-1-0 first and removes waiting. That is an estimate from the logged cash, not a replayed match.
   - **Other current-era runs** (rulesets v2 and v3, 12 runs from 09:26 UTC): only v5 revision 3 (10:00) has a gap, 3 decisions in rounds 25 and 26 (Lead at 28). It saves at 2 in round 25 ($314 and $229, answer $325) and puts the answer first at 1 in round 26, where Jev bought a Lead popper anyway. No lives were lost there. The other 10, v6's and v5 revision 5's included, had Lead and camo covered before the rule's window: 0 decisions.
   - **Older runs** (ruleset v1): one v4 run (07:28) at round 21, for round 24's camo, where Jev bought the camo Ninja.
   - `npm run btd6:rules-audit -- --replay-threat` over 34 runs: `threat_short (replay)` in 7 rounds, 2 with lives lost (the claude-v1 loss's rounds 27 and 28).
   
   UNVERIFIED live: the dry runs (to round 13) never reach a Lead or camo round, so the rule has run only in tests and the replay.

   Next: the series continues toward 5 runs per arm with `btd6-jev-v6` revision 3, `btd6-playbook-v5` revision 7 and `btd6-claude-v1` revision 6, which add `threat_short`'s `camo_lead` and `burst` kinds and the Monkey Ace's measured share ("Findings: round 78 and round 59"). Runs of the earlier revisions stay comparable only among themselves. Watch in the new runs: round 78 lives, round 80 (holds for its MOAB answer can step aside under `burst` in rounds 75 to 78), and how often `burst` fires before round 70. If the 22:38 pattern repeats (a margin like the wins and a loss), measure the round-78 capacity per tower type over more losses before changing `BURST_FACTOR`.


1. **Calibration runs.** Status at the pause (2026-09-30 10:35 UTC): two runs on bridge 0.3.13, ruleset btd6-open-v2, graded:10.
   - Run `100034Z-2` (v5 revision 3) lost at round 51 (majority wait spent the savings; see above). It measured MOAB damage in 2 rounds: round 40 ×1.76, round 50 ×0.91.
   - Run `100711Z-3` (`btd6-jev-v6`, its first live match) lost at round 78 after 25.3 min (21.3 at the slow speed). It measured 24 rounds, so the stored MOAB factor for Meadow Hard Standard is now ×1.34 (`.private/btd6/calibration/`), below the interim ×2.
   - It ended with 42 towers despite the 12-tower cap, so the cap's survival exception let placements through often. Check its `tower_cap_exception` records before the series.
   - With a measured ×1.34, the MOAB estimate goes down, not up. So `moab_short`'s false alarms (rule audit above) come mainly from its requirement (the kill within the first half of the track), not the damage figure. Review the requirement before the series. Done: the kill is required before the exit, with no / 0.8; with no term for the round's total MOAB-class health (it fired in cleared rounds). Rule rounds in the logs drop from 72 to 22; the 9 of them with lives lost stay ("MOAB requirement replay" above).
   - Next, in order:
     1. install bridge 0.3.14;
     2. check `set_targeting` live (Dart Monkey to Strong, Dartling to Locked plus a point, Heli);
     3. more calibration runs as needed;
     4. pin `--moab-factor 1.34` (or the stored factor) and `--pops-factor 1`;
     5. run the series.

   The original step: Before the comparison series, graded runs on bridge 0.3.13 measure the two factors the rules depend on. The factors are not pinned in these runs, so each measured run moves the setup's factor.
   - MOAB damage: `moab_measure` records appear in MOAB-class rounds (none so far, because normalizing dropped `bloons.moabs`; fixed in 4f928e6); measured and estimated damage are of similar scale (ratio 1 to 5); the run's factor is stored in `.private/btd6/calibration/`. If the ratios scatter widely, the measure needs work before it steers play: the lead bloon is matched across reads by type, progress and health only. Until a factor is measured, graded speed plays no 10x from round 40.
   - Pops: `pops_round` records with `lives_lost`. Only rounds that lose lives measure the pops factor (see docs/ARCHITECTURE.md, "Pops calibration"), so a run that clears every round from 60 leaves the interim 1.08 in place.
   - After them, run `npm run btd6:rules-audit` and take the factors the series will pin from `.private/btd6/calibration/` (or the interim ones if nothing was measured).
2. **Comparison series, with pinned factors.** Every run of the series passes the same `--moab-factor` and `--pops-factor`, so the stored factors moving between runs don't change the estimates within the series. `npm run btd6:rules-audit` runs after every series. The 31-spot catalog, Hard Standard. The first series (v4 at 5x and graded, v5 revision 2) was stopped on 2026-09-30: a v4 5x run lost at round 51 after choosing "Wait" at 14 of its last 15 decisions on up to $20,593 (6 of those 14 waits had less than half of Jev's probability). Series 3 ran v6, v5 revision 5 and claude-v1 revision 4 on one set of answer rules and one 12-tower cap: majority wait ("Wait" only with at least 0.5 of Jev's probability; in the plan policies, only on-plan purchases count; docs/ARCHITECTURE.md, "Majority wait"). v4 is the historical baseline without it. 
   Settings, decided 2026-09-30 19:10 UTC after the requirement replay and the live aiming checks:
   - bridge 0.3.14;
   - `--ruleset v3`: aimed Dartlings, Mortars and Helis. It is passed explicitly, because the code default is still v2 (open item);
   - `--speed graded:5` for every arm: graded levels 5, 3 and 1, never 10;
   - `--moab-factor 1.27 --pops-factor 1`. 1.27 is the stored median of the two measured runs: v6 on ruleset v2, 1.34 over 24 rounds; v6 on v3, 1.20 over 27 rounds, the run that won with 98 lives.

   Why graded:5: with a measured MOAB factor the round-40 cap lifts, and the replay predicts round 78 (the Rainbow and Ceramic rush that ended both round-78 runs) at 10x. Graded:10 lost two matches within about 2 s of play at 10x.

   The next runs use `btd6-jev-v6` revision 2, `btd6-playbook-v5` revision 6 and `btd6-claude-v1` revision 5 (`threat_short`, step 0), toward 5 runs per arm. Series 3's arms, alternating, two runs each (v4 is the historical baseline, not rerun):
   - A: `btd6-jev-v6` (Jev only: majority wait and the 12-tower cap).
   - B: `btd6-playbook-v5` revision 5 (the prepared playbook, plan-aware majority wait, v6's tower cap). The series' first v5 run (19:42 UTC, revision 4) came before the cap and lost at round 76 (findings above).
   - C, after A and B: `btd6-claude-v1` revision 4 (with v6's tower cap), with a Medium-effort Claude agent answering through `npm run btd6:strategy` (docs/BTD6-STRATEGIST.md). Check Marcus's usage first.

   Compare result, lives, minutes, tokens, and towers and upgrade tiers at round 35. For v6, v5 and claude-v1, count `majority_wait` in the scorecard's Rules column, and `tower_cap` and `tower_cap_exception`. For v5, also check in the logs:
   - that each decision's `plan` names the expected phase and branches;
   - how often `tie_break` switched Jev's choice;
   - whether the holds were met in time.

   Revise the playbook as a new `playbook_version` from what it does.
   **Graded:10 with hard rounds, live.** After the graded:5 runs of arms A and B, two runs of each arm at `--speed graded:10` (same bridge, ruleset and pinned factors). Check: no lives lost at 10x (`speed_set` and `speed_round` records), `cap` in `speed_set` names `hard_round`, `hard_round_next`, `end_rounds` and `buying` where expected, and minutes against the graded:5 runs (the replay predicts about the same). Then `npm run btd6:hard-rounds -- --write` with the new logs.
3. **Aiming, live: done on bridge 0.3.14** (2026-09-30 18:50 UTC; `.private/btd6/verify-0314.mjs`, 8 of 8 checks passed):
   - a Dart Monkey to Strong and back to First;
   - a Dartling at its default Normal mode popped 0 in 12 s, then 14 in 12 s once Locked on (-51, 15), and 375 by round 15;
   - a Heli to Lock In Place popped 33 in 10 s.
   - In a real run under `--ruleset v3` (`btd6-jev-v6`, match 185825Z-2), the runner's own aiming step set a Mortar's reticle at (-50.8, -16.6), and `aim_check` recorded +12 pops in 10.3 game seconds.
   - Gaps: the state reports no `target_point` for a Heli in Lock In Place, so its point is unconfirmed. Ruleset v3 needs bridge 0.3.14 (`AIMING_BRIDGE`) and isn't the code default yet (open item).

   Earlier notes:
   - Checked live:
     - screenshots are the game frame only at 960 px, and a second within a second is refused (HTTP 429);
     - `set_target_point` moved a Mortar's reticle from (-110, -18.9) to (-51, 15), and the state still showed it there at round 8 (script `.private/btd6/verify-0312.mjs`);
     - `set_target_point` changes pops (bridge 0.3.13, 2026-09-30): a Mortar aimed at open grass popped 4 bloons in 12 s, then 19 in 12 s once aimed on the track.
   - `set_targeting` failed live on 0.3.13: a Dart Monkey on First, asked for Strong, answered `rejected not_applied` ("targeting stayed First"), and 0.4 s later showed Last. `UnityToSimulation.SetNextTowerTargetType` applies its step on a later simulation frame, so the read straight after it saw no change while the step still landed. Bridge 0.3.14 (built, not installed) sets the mode directly with the simulation's `Tower.SetTargetType(TargetType)`, using the type from the tower's own `targetTypes`, and answers `executed` only when the tower then shows the mode (`mode_not_reached` with the mode it shows otherwise). The runner needs no change: it already handles `executed` and `rejected`. UNVERIFIED live: that the direct call takes effect in the same frame, and that the game's tower panel and attacks follow it (the arrows' call also fires the game's target-changed events; whether `SetTargetType` does is unknown).
   - Not checked yet:
     - `set_targeting` on 0.3.14: a Dart Monkey from First to Strong, a Dartling set to Locked, and a Heli;
     - whether shells land on the point. The game draws the reticle only for a selected tower, and explosions are too brief for one screenshot a second.
   - Bridge 0.3.13 (built, not installed or run live) adds each tower's `pops` and `cash_earned` to the state (`TowerToSimulation.damageDealt` and `cashEarned`). The session logs `pops_round` (measured pops per tower and round next to the estimate and the RBE) and `aim_check` (a tower's pops at aiming and 10 s of game time later); the scorecard's Pops column summarises both. Logging only; no decision uses them.
   - Next: install 0.3.13 and check live that `pops` matches the upgrade panel's figure and rises after a Mortar is aimed (an `aim_check` with `gained > 0`). Then one run with `--ruleset v3`, then v3 as the default. Once a few runs have `pops_round` records, compare measured and estimated pops by tower and round (rounds 49 and 51 had margins of 4.05 and above and still lost lives).
4. **Between-rounds mode, live.** One v4 match with `--between-rounds`: auto-start off, the game waiting between rounds, and auto-start restored at the end.
5. **Finish the fixed-speed baselines.** v3 at 3x and v4 at 5x, three runs each, for win rates (arm A counts toward v4).
6. **Near ties.** The scorecard's Near ties column (done) shows, for every policy, the share of Jev decisions where an answer's top two probabilities are less than 0.10 apart.
   - Jev has no temperature or seed setting, and its probabilities vary by a few points between identical calls, so near ties can flip.
   - v5 breaks ties within 0.05 by the playbook (`--tie-margin`).
   - Later: a replay tool that re-asks a logged question to measure stability.
7. **Win rates in the README and the chart. Done (2026-10-01, branch `win-rates`).**
   - `--add` and `--refresh` store each run's MOAB and pops factors from `run_start`'s calibration (`moab_factor`, `pops_factor`, and `pinned`, the ones that were pinned) in `docs/progress/btd6.json`. Runs logged before calibration was recorded have none.
   - Rule (`progress.mjs` `winRate`): within a row (version, revision, ruleset, speed variant), a group of runs with the same exact speed label and the same MOAB and pops factors, both pinned, a finished result (won or lost; stopped runs don't count) and no `issues` tag. A rate needs at least 5 such runs; the largest qualifying group in the row is used.
   - Shown: the README table starts the row's runs with "**3 of 5 won**, median round 80 (speed label, factors):", and the chart adds "3 of 5 won, median round 80" after the row's run count. Other rows list runs only.
   - Rates on 2026-10-01 (all Hard Standard, `btd6-open-v3`, MOAB x1.27 and pops x1 pinned): v6 r4 3 of 5, median round 80 (`graded:10+moab3+camo`); Playbook v5 r8 1 of 5, median round 78 (`graded:10+moab3+camo`); v6 r2 1 of 5, median round 78 (`graded:5`). Marcus asked for this on 2026-09-30.
8. **Headline: CHIMPS on Monkey Meadow.** The best Jev-only version against btd6-claude-v1 and btd6-playbook-v5, plus the fourth arm `claude-v1-notes`: a new strategist each match, which reads and updates a short lessons file that earlier matches wrote. It tests whether accumulated experience helps the live planner, against the clean claude-v1. Decided with Marcus on 2026-10-01; the notes file is kept in the repo's private data so it can be read, reset and replayed.
9. **Harder maps:** intermediate, advanced, then expert. Each map needs its own spot catalog (`npm run btd6:spots`).
10. **Publishing.** This repo stays private as the working lab. A public repo, `greenlittleapple/jev-game-lab`, gets snapshot commits of it with a fresh history, each one only after Marcus approves that snapshot. Snapshots leave out lab-only setup files, and the public bridge uses the account's own unlocks (ruleset runs still record `unlock_all`). Prepared on 2026-10-02 (branch `publish-prep`, bridge 0.3.16: unlock handling separable through partial methods, no behaviour change in the lab's build); nothing is published yet.

## Open items

- Request timeouts (branch `timeouts`): a Jev timeout is retried once and then skipped as `jev_timeout`, a bridge read timeout is retried with backoff, and neither pauses the runner; a command with an unknown result still pauses. `error` and `runner_paused` records name the source, endpoint and timeout. Tested with injected timeouts only, not yet in a live match. The v5 r9 loss tagged runner-timeout (2026-10-01 10:54 UTC) was most likely a Jev timeout: 31 s after the last decision, and the raw message lacks the bridge client's `Bridge <path>:` prefix.
- Two game copies on one PC (branch `two-copies`): a runner lock, run log name, screenshot folder and calibration key per bridge port, `bridge_port` in the logs and the series, a locked calibration update, and a dashboard per copy (`--bridge-port`). Built and checked in tests and a dry run, merged in 61a66b6 (docs/ARCHITECTURE.md, "Two game copies").
  - **Live attempt (2026-10-01), not working yet.** The second copy ran in a Sandboxie-Plus box, with the game's files and registry separate from the first copy and `steam_appid.txt` only inside the box. MelonLoader, Mod Helper and the bridge loaded there.
  - In a standard box the game then crashed at Steam start (`SteamApi_Init failed with NoSteamClient: Cannot create IPC pipe to Steam client process`).
  - Opening Steam's IPC objects, then all IPC objects, then window messages to the box let it get further. Each time it then hung at startup: main thread not pumping, 0% CPU.
  - Sandboxie's application-compartment mode is a paid feature, and in it MelonLoader stopped at "Unable to get process modules".
  - Untried:
    - Sandboxie's trace log, to see what the game waits on;
    - a second Steam account that owns BTD6, signed in to its own Steam client inside the box. That's the usual way to run two copies, and it needs an account and a purchase from Marcus.
  - Until then, series run on one copy.
- A position-aware pops estimate: Wizards whose covered stretch starts past 0.5 of the track measure about 0.03 of their estimate (0.45 for those starting before 0.25; `npm run btd6:pops-derive -- --placement WizardMonkey`). Not modelled.
- The bridge's tower `pops` is the game's `damageDealt` (`GameReader.cs`), so `pops_round` measures damage, which counts hits on Ceramic and MOAB health as well as layers.

- Rows in the progress chart can mix runs made under different code or speed caps. v6's 18:58 UTC win (the old MOAB requirement, graded:10) and the graded:5 series runs share the row "v6 (btd6-open-v3) graded". Record the lab commit in `run_start`, split graded rows by their maximum, and let the win-rate rule (step 7) group by the commit's rules as well. `run_start` and the series entry record `lab_commit`, `code_commit` and `code_dirty` from the series6 provenance change on; grouping runs by them is still open.
- Make `btd6-open-v3` the code default (`rulesets.mjs` `DEFAULT_RULESET`). Aiming works live on 0.3.14, but runner, session and dry-run tests assume v2: switching made five of them fail and one test file hang. Until then, pass `--ruleset v3`.
- The state has no `target_point` for a Heli Pilot in Lock In Place (bridge `GameReader`), so a Heli's lock point is set but can't be read back.
- Unchecked live (bridge 0.3.13 and the runner fixes on `bridge-pops`): the speed resend after a screen closes, `moab_measure` records and `moab_outrun` with real `bloons.moabs`, the hero's level left out of the towers hash with `stale_tiers` on hero upgrades, and the wait after a queued purchase (how often it times out).
- With `moab_outrun` now reading the MOAB list, graded speed can drop for a MOAB about to outrun the towers, which it never did in the runs so far; the next graded runs are not directly comparable with earlier ones on MOAB rounds.
- Plan-aware majority wait (v5 from revision 4, claude-v1 from revision 3) has run live once (v5 revision 4, above). The tower cap in the plan policies (v5 revision 5, claude-v1 revision 4) has run only in tests and a dry run that stayed under 12 towers. Majority wait over any purchase has run live in v5 revision 3 (lost at 51, above); in v6 it and the tower cap have run only in tests and a dry run. The threshold 0.5 and the cap of 12 are first values from one v4 log and the v4 win's 7 towers.
- Store ad classes `StorePopup` and `RacePassStorePopup` are recognised from the interop assemblies only. `StoreLegendsPopup` is live-verified.
- The `profile_screen` recording, which classifies unlocks earned by a rank-up, hasn't run in a live match yet.
- New first-time screens can still appear as the account ranks up. The runner pauses on any unknown screen and resumes by itself once a person closes it.
- The bridge handles every screen by design, so nobody clicks for the runner. Computer use does work in the desktop app (checked 2026-09-30) and can be a fallback with Marcus's approval.
- Bridge 0.3.11 (`bloons.moabs` with health, `set_auto_start`) builds and its protocol tests pass; nothing of it is checked live. Whether the auto-start setting belongs to the match only or is also saved to the profile is unknown.
- The pops factor 1.08 (Hard Standard, from round 60) is the 25th percentile of outcome lower bounds, not a measurement. The bounds scatter by round (1.01 to 4.5; highest in rounds 75, 76, 79 and 80, the MOAB-heavy ones), so one factor for all rounds from 60 is a compromise, and the replay shows it turns the `short` verdicts before round 78's 97-life leak into `enough`. Only `pops_round` rounds that lose lives measure it; none has been logged yet.
- A pinned factor (`--moab-factor`, `--pops-factor`) leaves graded speed's composition cap to the stored run count, so pinning the interim MOAB factor doesn't lift it.
- **The stored MOAB factor by arm (data, 2026-10-01):**
  - The store keeps the last 5 measured runs, now all from series 5: v5 0.59 and 0.51, claude-v1 0.47 and 0.49, v6 1.17. The median is 0.51, against the pinned 1.27, which came from two v6 runs (1.34 and 1.20).
  - So the plan arms' MOAB damage measures about 0.5 of their estimate, against about 1.2 for v6. Series 5 and 6 pin 1.27, so their decisions and speed don't move.
  - Not yet explained. The Skywarden's MOAB damage still counts both weapons (corrections A and B left MOAB damage unchanged), and the arms build different towers.
  - Measure by tower composition before the CHIMPS step, where a MOAB leak ends the match.
- The MOAB calibration factor: the stored ×1.34 comes from one run (v6, 24 rounds); the interim 2.0 was a hypothesis. With the kill-before-exit requirement the ZOMG round needs 130 on Meadow, so a defence of about 76 (v6 at round 76, ×1.34) is short and `moab_short` applies from round 76.
- `moab_short` has no term for a round's total MOAB-class health any more; the replay covered Hard Standard only (100 lives, margin 1.15). Revisit a group term for CHIMPS (1 life, margin 1.5), where a missed flag costs the match. A round's own MOAB check doesn't see Ceramics and Rainbows competing for the same towers (round 78).
- Whether a Fortified BFB's or ZOMG's inner bloons are fortified in the game is unchecked; the requirement counts them unfortified (a Fortified BFB 2,200: 1,400 + 4 x 200). Affects rounds 79, 82, 86, 89, 93, 97 and 98.
- Aiming: `ApplyTargetTypeData` (bridge 0.3.12) works live and its point is in the tower positions' map coordinates. `set_targeting` uses `Tower.SetTargetType` from 0.3.14 (the arrows' `SetNextTowerTargetType` applies a frame late); unverified live. The aim point (densest track point) and radii (12, 22) are a first choice, not tuned; for a Dartling the line from the tower through the point matters more than the point.
- Screenshots: the capture runs at the end of a frame in a MelonLoader coroutine; not run live. In a dry run the end-screen shot can miss when the previous shot was less than a second earlier.
- The composition cap (5 on MOAB-class and RBE-spike rounds), the cooldown (3 rounds at 5 after a danger drop) and the speed-scaled danger thresholds are first values from three lost runs. The hard-round thresholds (RBE record 1.5, burst 2.0 from 500 RBE, 15 camo Ceramics and Rainbows), the caps (3, 5 before, 6 end rounds, 5 while buying) come from the replay, not from live runs at graded:10.
- The adherence measure (scorecard Plan column) needs `plan_target` records, so it covers runs from this change on; older runs show holds kept and survival skips only.
- The playbook's cash holds use upgrade costs estimated from game knowledge, not read from the game; the first live v5 match will show whether they are met in time.
- `pops` is the upgrade panel's count by its member name (`damageDealt`); whether it matches the panel figure, and whether sub-towers' pops are credited to the parent (`CreditPopsToParentTower`), is unchecked live. `pops_round` round boundaries are the speed clock's (the next round number first seen), so a round's count includes the pause before the next round, when nothing pops.
- Graded speed's MOAB check uses the towers' MOAB damage over the first half of the track, which is only approximate for a bloon already past half.
- Whether the live catalog lists the Sheriff as a hero (`is_hero`) is unchecked; the profile lists it under `unlocked_heroes`. If the catalog marks it a non-hero, `no_data` shows `Sheriff` and the runner leaves it out.
- The dashboard (`npm run btd6:dashboard`) ran beside series 5's match 3 with the bridge answering.
  - It showed live state, towers, bloon progress, caps, the speed log and Jev's decisions.
  - At round 44 its expected speed (5x: cooldown and hard_round_next) matched the game and the runner's last `speed_set`.
  - Its speed panel shows what the rules give for the current state. The runner's own level also depends on the step-up delay and its in-memory trackers, so the two can differ for a few seconds.
  - `moab_outrun` and `moab_short` have not yet been seen live on the page.
- Runs affected by known bugs are tagged in `docs/progress/btd6.json` (`issues`) by hand; new bugs found in later runs need a new issue entry and tags.
