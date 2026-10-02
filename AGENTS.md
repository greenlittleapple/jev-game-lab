# Jev game lab

When working on TypeSafe/Jev integration, question design, uncertainty handling or decision logic, read and use the project-local [TypeSafe skill](.agents/skills/typesafe-ai/SKILL.md) and follow its links to the current official documentation.

The current game is Bloons TD 6. The plan of record is [docs/PLAN.md](docs/PLAN.md): benchmark decisions, ordered next steps and open items. Read it before continuing the work, and update it whenever the plan changes. The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and the live evidence is in [docs/BTD6-VERIFICATION.md](docs/BTD6-VERIFICATION.md).

Live actions need Marcus's approval: installing or removing mods, launching or closing the game, bridge commands that change the game (`place`, the runner's commands), and running the mods on/off script against the real install. Since 2026-09-30 the coordinating session has his standing approval to install bridge builds and run matches on the mod account. Delegated agents don't touch the game. Modded play uses only the separate Ninja Kiwi account and single-player modes.

Strategist: while a BTD6 runner is active (policy `claude-v1`), a Claude Code agent answers requests with `npm run btd6:strategy -- wait | show | answer`, following [docs/BTD6-STRATEGIST.md](docs/BTD6-STRATEGIST.md). Since series 6 each claude-v1 match gets a new agent, which plans from the requests and that brief only. Plans use only the brief's information, name towers and spots from the brief, and keep strings short. The game keeps running while you answer, except before the first round. Running the watcher doesn't authorize starting a runner or a match.

The lab's recorded results were played on a separate single-player account with every tower and upgrade available. The public bridge uses the account's own unlocks. The bridge never writes the profile, and `npm test` checks that it calls no profile-writing or gameplay-changing method. If `docs/private/` exists, read it for setup that only the lab uses.

Committed files must not contain local user paths, drive-letter install paths, personal emails, Steam IDs or keys; write the game folder as `<BTD6 dir>`. `npm test` checks this.
