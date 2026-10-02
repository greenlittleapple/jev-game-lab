// Candidate actions: what Jev chooses from and what the rules filter. Each candidate has an ID, a
// label, the bridge command (null for waiting) and details that the question and rules read.
// Paths are 1-3 here and in plans; the bridge's commands and next_upgrades use the game's 0-2.
import {coverage, describeCoverage} from './spots.mjs';

export const WAIT_HOLD_MS = 5000;

// Crosspath rule: tiers up to 5, at most two paths upgraded, only one of them above tier 2.
export function nextTierAllowed(tiers, path) {
 const next = tiers.map((t, i) => i === path - 1 ? t + 1 : t);
 return next[path - 1] <= 5 && next.filter(t => t > 0).length <= 2 && next.filter(t => t > 2).length <= 1;
}

// context: catalog [{id, name, cost, range, is_hero, unlocked, in_inventory}], freeSpots [{id, x, y}] (valid and
// unoccupied), or a function from tower ID to that tower's free spots (placement differs by tower: water
// towers, footprints), paths [[{x, y}]], spotsPerTower (best spots offered per tower), required
// [{tower, spot}] (spots a plan step names, offered even when not among the best), towerWhitelist
// (the series' fixed tower list, or null for every unlocked tower).
export function buildCandidates(state, {catalog = [], freeSpots = [], paths = [], spotsPerTower = 4, required = [], holdMs = WAIT_HOLD_MS, towerWhitelist = null} = {}) {
 if (!state.in_game || state.match.result || state.ready === false) return [];
 const cash = state.cash, out = [];
 const canStart = !state.round.active && (state.round.before_first_wave || state.auto_start === false);
 if (canStart) out.push({id: 'start_round', label: `Start round ${state.round.number}`, command: {action: 'start_round'}, details: {kind: 'start_round'}});
 // Waiting between rounds earns nothing, so it's offered only when a round can't be started.
 else out.push({id: 'wait', label: 'Wait and keep the cash', command: null, hold_ms: holdMs, details: {kind: 'wait', cash: Math.floor(cash)}});
 const heroPlaced = state.towers.some(t => t.is_hero);
 const spotsFor = typeof freeSpots === 'function' ? freeSpots : () => freeSpots;
 const listed = id => !towerWhitelist || towerWhitelist.includes(id);
 for (const tower of catalog) {
  if (tower.unlocked === false || tower.in_inventory === false || !listed(tower.id) || !(tower.cost <= cash) || (tower.is_hero && heroPlaced)) continue;
  const scored = spotsFor(tower.id).map(spot => ({spot, cov: coverage(spot, tower.range, paths)}));
  const offered = [...scored].sort((a, b) => b.cov.share - a.cov.share).slice(0, spotsPerTower);
  for (const r of required.filter(r => r.tower === tower.id)) {
   const named = scored.find(s => s.spot.id === r.spot);
   if (named && !offered.includes(named)) offered.push(named);
  }
  for (const {spot, cov} of offered) out.push({
   id: `place:${tower.id}@${spot.id}`, label: `Place ${tower.name ?? tower.id} at ${spot.id} ($${tower.cost})`,
   command: {action: 'place_tower', tower: tower.id, x: spot.x, y: spot.y},
   details: {kind: 'place', tower: tower.id, spot: spot.id, cost: tower.cost, cash_after: Math.floor(cash - tower.cost),
    range: tower.range, coverage: {share: +cov.share.toFixed(3), from: cov.from, to: cov.to}, track: describeCoverage(cov)}});
 }
 for (const t of state.towers.filter(t => listed(t.base_id))) for (const up of t.next_upgrades) {
  const path = up.path + 1;
  if (up.unlocked === false || !(up.cost <= cash) || !nextTierAllowed(t.tiers, path)) continue;
  const after = t.tiers.map((v, i) => i === path - 1 ? v + 1 : v).join('-');
  out.push({id: `upgrade:${t.id}:p${path}`, label: `Upgrade ${t.base_id} #${t.id} to ${after} ($${up.cost})`,
   // expect_tiers: the tiers this option was built on; the runner sends them as expect.tiers (bridge 0.3.13), since the
   // towers hash leaves out a hero's level.
   command: {action: 'upgrade_tower', tower_id: t.id, path: up.path, expect_tiers: [...t.tiers]},
   details: {kind: 'upgrade', tower_id: t.id, tower: t.base_id, path, tiers_before: t.tiers.join('-'), tiers_after: after,
    upgrade: up.id, cost: up.cost, cash_after: Math.floor(cash - up.cost)}});
 }
 return out;
}

// Preconditions checked again on a fresh observation just before dispatch. The structural
// fingerprint already covers the match, round and towers; cash moves on its own.
export function stillValid(state, choice) {
 const d = choice.details ?? {};
 if (d.kind === 'dismiss_popup') return state.popup?.class === d.popup_class && state.popup?.kind === d.popup;
 if (!state.in_game || state.match.result) return false;
 if (d.kind === 'place' || d.kind === 'upgrade') return state.cash >= d.cost;
 if (d.kind === 'start_round') return !state.round.active;
 if (d.kind === 'aim_tower') return state.towers.some(t => t.id === d.tower_id);
 if (d.kind === 'dismiss_popup') return state.popup?.class === d.popup_class && state.popup?.kind === d.popup;
 return true;
}
