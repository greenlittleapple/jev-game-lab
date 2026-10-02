# BTD6 strategist brief (policy `btd6-claude-v1`)

This is for the Claude session that answers strategy requests during a live Bloons TD 6 match. It is self-contained: you need only this file and the requests.

## What you are doing

An automated player runs a BTD6 match. Jev, a fast model, picks each action (place a tower, upgrade one, wait). Code applies fixed survival rules (policy `btd6-jev-v4`), then your plan, and Jev chooses among what is left. You are asked for a plan at the start of the match and again at set moments: before new bloon types, before MOAB-class rounds, after a large leak, and every 10 rounds or so. A match makes about 15 to 25 requests.

The game does not wait for you. Play continues under your previous plan while you think, and your answer takes effect at the next decision after you deliver it. The only exception is the opening request before the first round: the runner waits for it, up to a timeout (5 minutes by default), then plays on without a plan until you answer. Answer quickly; the brief says how many rounds a typical answer takes (`brief.timing.lead_rounds`), and you should plan from `brief.timing.plan_from_round` on.

Plan from the request's brief and this document only, not from earlier matches: each claude-v1 match gets a new strategist agent, and lessons carried over from another match don't apply to this one.

## The loop

Run these from the repository root. `-s` keeps npm's own lines out of the output.

```
npm run -s btd6:strategy -- wait
npm run -s btd6:strategy -- show
npm run -s btd6:strategy -- answer <request-id> <plan-file>
```

1. `wait` blocks until a request is pending and prints `Strategy request <id> (<reason>, round <n>, needed by round <m>)`. It can block for many minutes; if your tool call times out, run `wait` again.
2. `show` prints one JSON object: `id`, `reason`, `instructions`, `schema` and `brief`. Read the brief; the instructions repeat the rules below.
3. Write your plan as JSON to a file (for example `.private/btd6/plan.json`, which git ignores), then `answer` with the request's ID. The CLI checks the plan against the schema and the request. On errors it prints them and exits with status 1: fix the plan and answer again. If the request is no longer pending (replaced by a newer one, or already answered), the CLI says so without checking the plan: run `show` and answer the request it prints.
4. Go back to `wait`.

For a dry run left to you (`--no-fake-strategist`), set `STRATEGY_DIR=.private/btd6/dry-run/strategy` for these commands.

Running the loop doesn't authorize starting a runner or a match.

## Request reasons

| Reason | When |
|---|---|
| `match_start` | No plan yet for this match. Before the first round the runner waits for it |
| `threat_ahead` | New bloon types are a few rounds away (`brief.detail.threats`) and your plan's answer for them isn't met yet |
| `moab_window` | A run of MOAB-class rounds starts soon (`brief.detail`, `brief.moab.windows`) |
| `big_leak` | More than 5% of the starting lives were lost in one round (`brief.detail`) |
| `review` | Your plan's `review_round`, or 10 rounds after the request it answered |

A more urgent request replaces a pending one (match start, then big leak, then threats and MOAB windows, then review).

## The brief

- `match`: map, difficulty, mode, round, end round, lives, cash, and whether a round is running.
- `timing`: `lead_rounds`, `seconds_per_round`, `plan_from_round`.
- `heroes`, `catalog`: what may be placed, with base prices. Tower IDs are the game's (`DartMonkey`, `SniperMonkey`).
- `tower_facts`: per tower, from the game data: the lowest tiers that detect camo, the lowest that pop lead (`"0-0-0"` means the base tower does), and the best MOAB damage per second up to tier 4.
- `towers`: towers on the map with tiers, camo, lead, MOAB damage per second and the next upgrade prices per path.
- `spots`: free placement spots with the track they cover. Naming a spot is optional.
- `threats_ahead`: first appearances in the next 20 rounds (camo 24, purple 25, lead 28, ceramic 38, MOAB 40, fortified 45, camo lead 59, BFB 60, fortified MOAB 62, ZOMG 80 on the standard rounds).
- `moab`: the towers' MOAB damage per second now, and the next MOAB-class windows with what the first round of each needs (`needs_dps`).
- `leaks`: recent rounds with lives lost.
- `previous_plan`: your last plan, with the towers counted toward each target (`have`) and whether it is met (`done`).
- `consults`: requests, answers and late answers so far.

## The plan

```json
{
 "summary": "one sentence on how this setup reaches the final round",
 "hero": {"tower": "Quincy", "round_from": 3},
 "build": [
  {"id": "darts", "tower": "DartMonkey", "tiers": "0-2-2", "count": 2, "round_from": 3, "round_by": 12, "priority": 1}
 ],
 "cash_hold": [{"from_round": 30, "to_round": 36, "amount": 1200, "for": ["moab"]}],
 "threats": [{"threat": "camo", "by_round": 22, "answer": "darts"}],
 "review_round": 20,
 "note": ""
}
```

| Field | Meaning | How code uses it |
|---|---|---|
| `summary` | One sentence, at most 200 characters | Shown to Jev and in the logs |
| `hero` | `tower`: a hero from `brief.heroes`, or `"none"`; `round_from`: when to place it | Placing the hero is a priority-1 target from `round_from`; with `"none"` hero placements are removed |
| `build` | Targets in order: `id` (lowercase, up to 16 characters), `tower`, `tiers` (`"a-b-c"`: path 1, 2, 3), `count` (default 1), `spot` (optional), `round_from`, `round_by`, `priority` (1 highest, to 3), `note` (optional, 80 characters) | See enforcement below |
| `cash_hold` | `{from_round, to_round, amount, for: [target ids]}` | In those rounds, purchases that would leave less than `amount` are removed unless they advance a target in `for` |
| `threats` | `{threat, by_round, answer: target id}` | Within `lead_rounds` of `by_round`, that target goes before every other; a met answer means no `threat_ahead` request for it |
| `review_round` | Optional; must be after the current round | When to ask for a review (default 10 rounds after this request) |
| `note` | One sentence for the operator, or `""` | Logged |

Tiers follow the game's crosspath rule: at most two paths above 0, and only one above 2 (`"0-2-4"` is fine, `"3-3-0"` is not). A target is met when `count` towers of that type have at least those tiers. Towers already on the map count: each tower counts toward the first target in the list that it can still reach, so list targets in the order you want towers assigned. To take the same tower further, raise its target's tiers; a second target of the same tower type needs a second tower.

### Enforcement

Code applies these after the survival rules, in this order, and never removes the last option:

1. From a target's `round_from` (or earlier when a threat it answers is within the lead time), while any purchase that advances an unmet target is affordable, all other purchases are removed. Waiting stays, so Jev may still wait.
2. Of those purchases, only the best priority is kept. A threat answer within the lead time counts as priority 0.
3. The active `cash_hold` removes purchases that would leave less than its amount, except ones advancing the targets it is for. Those may be bought early, before their `round_from`.

When nothing on the plan is affordable and no hold is active, Jev spends freely. To save for an expensive upgrade, add a `cash_hold`.

Survival first: while bloons are leaking, or the towers' MOAB damage is short of a MOAB-class round within 4 rounds, your filters and holds are lifted and the survival rules decide. A hold is also lifted while the towers are short for the coming round. The MOAB damage figures in the brief include a calibration factor (2.0 until live runs measure it), since the first strategist match cleared every MOAB-class round with the uncalibrated figure far below what was needed. Plan MOAB damage early enough that this rarely happens: the v3 baseline lost all its lives to the round-40 MOAB with 21 MOAB damage per second against the 36 needed.

### Threats and the hero

- Set each threat's `by_round` at least 2 rounds before its first appearance in `threats_ahead` (lead 28 means `by_round` 26 or earlier). Never move a `by_round` later than that in a new plan; if the answer is not ready, bring it forward instead. In one lost match the plan moved lead from 27 to 30 at round 28, and the lead round ended the match.
- Answer a threat with one target whose tiers have the property, per `tower_facts` (for lead, a tier at or above that tower's lead-popping tiers). Check `towers` and `previous_plan` that the answer is actually met. If it is not affordable yet, add a `cash_hold` for that target. In the same match six Wizard Monkeys stayed at 1-0-0, which does not pop lead, while the plan named 1-1-0.
- If the hero is still not placed a few rounds after its `round_from` and cash is short, set `hero` to `"none"` instead of keeping it in the plan. In that match Quincy was planned from round 6 and was never placed by round 28.

### Rules for strings

- Use only IDs from the brief: towers from `catalog`, heroes from `heroes`, spots from `spots`, threats from the list above, and target IDs you defined.
- Keep `summary` and `note` to one plain sentence. No lists, slogans or instructions to Jev inside strings.
- No other fields; unknown fields are refused.

## Examples

The test suite checks these examples against the schema and the answer checks. Opening plan for Monkey Meadow, Hard Standard ($650, rounds 3 to 80); the second Bomb Shooter is the MOAB one:

```json
{
 "summary": "Two Dart Monkeys hold the early rounds, a Ninja covers camo, Bomb Shooters cover lead, and Bomb and Sniper upgrades give MOAB damage by round 38.",
 "hero": {"tower": "Quincy", "round_from": 5},
 "build": [
  {"id": "darts", "tower": "DartMonkey", "tiers": "0-2-2", "count": 2, "round_from": 3, "round_by": 14, "priority": 1},
  {"id": "ninja", "tower": "NinjaMonkey", "tiers": "2-0-1", "round_from": 16, "round_by": 22, "priority": 2},
  {"id": "bomb", "tower": "BombShooter", "tiers": "0-2-2", "round_from": 20, "round_by": 26, "priority": 2},
  {"id": "moab", "tower": "BombShooter", "tiers": "0-4-2", "round_from": 30, "round_by": 38, "priority": 1},
  {"id": "sniper", "tower": "SniperMonkey", "tiers": "2-0-4", "round_from": 36, "round_by": 48, "priority": 2}
 ],
 "cash_hold": [{"from_round": 32, "to_round": 37, "amount": 1500, "for": ["moab"]}],
 "threats": [
  {"threat": "camo", "by_round": 22, "answer": "ninja"},
  {"threat": "lead", "by_round": 26, "answer": "bomb"},
  {"threat": "moab", "by_round": 38, "answer": "moab"}
 ],
 "review_round": 18,
 "note": ""
}
```

After a big leak at round 33 (keep the targets that still make sense, bring the fix forward):

```json
{
 "summary": "Ceramics leaked at the exit; a third Bomb Shooter at S03 goes first, then the MOAB plan as before.",
 "hero": {"tower": "Quincy", "round_from": 5},
 "build": [
  {"id": "darts", "tower": "DartMonkey", "tiers": "0-2-2", "count": 2, "round_from": 3, "round_by": 14, "priority": 1},
  {"id": "ninja", "tower": "NinjaMonkey", "tiers": "2-0-1", "round_from": 16, "round_by": 22, "priority": 2},
  {"id": "bomb", "tower": "BombShooter", "tiers": "0-2-2", "round_from": 20, "round_by": 26, "priority": 2},
  {"id": "exitbomb", "tower": "BombShooter", "tiers": "2-0-2", "spot": "S03", "round_from": 33, "round_by": 34, "priority": 1},
  {"id": "moab", "tower": "BombShooter", "tiers": "0-4-2", "round_from": 33, "round_by": 38, "priority": 1}
 ],
 "cash_hold": [{"from_round": 35, "to_round": 37, "amount": 1500, "for": ["moab"]}],
 "threats": [{"threat": "moab", "by_round": 38, "answer": "moab"}, {"threat": "ceramic", "by_round": 36, "answer": "exitbomb"}],
 "note": ""
}
```
