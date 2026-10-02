// Named, versioned rulesets: what a run may use. The runner records the ruleset with every run (the
// run_start event in the run log and the run's entry in series.jsonl), and pauses when the live game
// doesn't meet it.
import {observedSpeed} from './speed.mjs';

export const RULESETS = {
 'btd6-open-v1': {
  name: 'btd6-open', version: 1,
  summary: 'Every tower and upgrade the account has unlocked (the lab\'s runs had all of them, as for an experienced player); hero Quincy; no paragons; no powers, Insta Monkeys, Monkey Knowledge, Double Cash or continues; game rules unchanged.',
  // 'all' or a list of tower IDs; heroes are governed by `hero`.
  towers: 'all',
  upgrades: 'all',
  // The bridge has no paragon command and the candidates never include one.
  paragons: false,
  hero: 'Quincy',
  requires: {double_cash_used: false},
 },
 // v1 without the towers whose attack follows the mouse cursor or a player-set point (aim.mjs): the runner
 // never moves the mouse, so a Dartling fired at wherever the cursor sat ("pointing down", seen live), a
 // Heli followed it, and a Mortar's reticle was never placed.
 'btd6-open-v2': {
  name: 'btd6-open', version: 2,
  summary: 'As btd6-open-v1, without the Dartling Gunner, Mortar Monkey and Heli Pilot, whose attacks need a point the runner does not aim.',
  towers: 'all', exclude: ['DartlingGunner', 'MortarMonkey', 'HeliPilot'], upgrades: 'all', paragons: false, hero: 'Quincy',
  requires: {double_cash_used: false},
 },
 // v1 with those towers aimed by the runner after each placement or upgrade (aim.mjs). Checked live on
 // 2026-09-30 with bridge 0.3.14: set_targeting (a Dartling to Locked, a Heli to Lock In Place) and
 // set_target_point, and a run's own aiming step aimed a Mortar that then popped more. Pass --ruleset v3;
 // making it the default is an open item (the tests assume v2).
 'btd6-open-v3': {
  name: 'btd6-open', version: 3,
  summary: 'As btd6-open-v1; the runner aims the Dartling Gunner (Locked), Mortar Monkey (reticle) and Heli Pilot (Pursuit, or Lock In Place) at the densest track point.',
  towers: 'all', exclude: [], aimed: true, upgrades: 'all', paragons: false, hero: 'Quincy',
  requires: {double_cash_used: false, aiming: true},
 },
};
export const DEFAULT_RULESET = RULESETS['btd6-open-v2'];
export const rulesetId = r => `${r.name}-v${r.version}`;
// --ruleset: a ruleset ID, or its version alone ("v3", "3").
export function findRuleset(raw) {
 if (raw == null) return DEFAULT_RULESET;
 const id = /^v?\d+$/.test(String(raw)) ? `btd6-open-v${String(raw).replace(/^v/, '')}` : String(raw);
 const r = RULESETS[id];
 if (!r) throw Error(`Unknown ruleset ${raw}; known: ${Object.keys(RULESETS).join(', ')}.`);
 return r;
}

// Catalog entries the ruleset allows. Account unlocks and the mode's own inventory are checked
// separately, from the catalog's unlocked and in_inventory flags.
export function allowedCatalog(ruleset, catalog) {
 return catalog.filter(t => t.is_hero ? !ruleset.hero || t.id === ruleset.hero
  : (ruleset.towers === 'all' || ruleset.towers.includes(t.id)) && !(ruleset.exclude ?? []).includes(t.id));
}

// BTD6_REQUIRE_ALL_UNLOCKS=1: refuse a match unless the bridge reports unlock_all (every tower and upgrade
// available regardless of the account's unlocks), as on the account the lab's runs were played on. Off by
// default: the account's own unlocks apply, and the candidates leave out locked towers and upgrades.
export const requireAllUnlocks = (env = process.env) => env.BTD6_REQUIRE_ALL_UNLOCKS === '1';
export const allUnlocksProblem = (where, value) =>
 `BTD6_REQUIRE_ALL_UNLOCKS is set, and ${where} reports unlock_all ${value ?? 'missing'} rather than true.`;

// Why the live match doesn't meet the ruleset, or null.
export function rulesetProblem(ruleset, state, {allUnlocks = requireAllUnlocks()} = {}) {
 if (!state.in_game) return null;
 if (allUnlocks && state.unlock_all !== true) return allUnlocksProblem('the bridge', state.unlock_all);
 if (ruleset.requires?.double_cash_used === false && state.match.double_cash_used === true)
  return `Ruleset ${rulesetId(ruleset)} excludes Double Cash, and this match uses it.`;
 if (ruleset.requires?.aiming && !bridgeAtLeast(state.bridge_version, AIMING_BRIDGE))
  return `Ruleset ${rulesetId(ruleset)} needs bridge ${AIMING_BRIDGE} or later to aim towers; the bridge is ${state.bridge_version ?? 'unknown'}.`;
 return null;
}

// The first bridge with set_targeting and set_target_point.
// 0.3.12 added the aiming commands; 0.3.14 fixed set_targeting, which the Dartling's Locked mode needs.
export const AIMING_BRIDGE = '0.3.14';
export function bridgeAtLeast(version, min) {
 if (typeof version !== 'string') return false;
 const a = version.split('.').map(Number), b = min.split('.').map(Number);
 for (let i = 0; i < b.length; i++) { if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i]; }
 return true;
}

// What the runner records for each run. speed: the speed the run was set to (speed.mjs), or null when the
// runner doesn't set it; conditions.speed is what the game reported when the run was recorded.
export function runMetadata(state, ruleset, policy = null, speed = null) {
 const m = state.match;
 return {
  setup: {map: m.map, difficulty: m.difficulty, mode: m.mode, mode_name: m.mode_name ?? null, start_round: m.start_round ?? null, end_round: m.end_round ?? null},
  ruleset: {id: rulesetId(ruleset), name: ruleset.name, version: ruleset.version, excluded: ruleset.exclude ?? [], aimed: Boolean(ruleset.aimed)},
  unlock_all: state.unlock_all === true,
  double_cash_used: m.double_cash_used ?? null,
  speed,
  conditions: {auto_start: state.auto_start ?? null, fast_forward: state.fast_forward ?? null, multiplier: state.multiplier ?? null, speed: observedSpeed(state)},
  bridge_version: state.bridge_version ?? null, game_version: state.game_version ?? null, policy,
 };
}
