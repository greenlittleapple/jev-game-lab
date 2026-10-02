// Bridge state as the runner uses it. The bridge sends raw game values (docs/ARCHITECTURE.md,
// "Bridge"); normalizeState checks the fields decisions depend on and adds derived ones.
import {roundRange, modeName} from './rounds.mjs';

export const API_VERSION = 1;
// UnityToSimulation.GetCurrentRound() is taken to be 0-based, so the displayed round is index + 1.
// The first live spike checks this against the round shown on screen.
export const ROUND_NUMBER_OFFSET = 1;

const finite = (v, name) => { if (!Number.isFinite(v)) throw Error(`Bridge state: ${name} must be a number`); return v; };

export function normalizeState(raw) {
 if (!raw || typeof raw !== 'object') throw Error('Bridge state must be an object');
 if (raw.api !== API_VERSION) throw Error(`Bridge API ${raw.api} is not supported (expected ${API_VERSION})`);
 if (raw.screen !== 'in_game' || !raw.match) return {...raw, in_game: false, towers: []};
 const {match, round} = raw;
 if (typeof match.id !== 'string' || !match.id) throw Error('Bridge state: match.id is missing');
 if (!round || !Number.isInteger(round.index)) throw Error('Bridge state: round.index must be an integer');
 const towers = (raw.towers ?? []).map((t, n) => {
  if (!Number.isInteger(t.id) || t.id < 0) throw Error(`Bridge state: towers[${n}].id must be a non-negative integer`);
  if (typeof t.base_id !== 'string') throw Error(`Bridge state: towers[${n}].base_id is missing`);
  if (!Array.isArray(t.tiers) || t.tiers.length !== 3 || !t.tiers.every(Number.isInteger)) throw Error(`Bridge state: towers[${n}].tiers must be three integers`);
  return {...t, x: finite(t.x, `towers[${n}].x`), y: finite(t.y, `towers[${n}].y`), next_upgrades: t.next_upgrades ?? []};
 });
 const range = roundRange(match.difficulty, match.mode);
 // Bridge 0.3.3 adds the bloons on the track (a summary) and the lives lost this round; older bridges: null.
 return {
  ...raw, in_game: true, towers,
  cash: finite(raw.cash, 'cash'), lives: finite(raw.lives, 'lives'),
  // max_lives is the game's cap on lives (5000 on Medium); percentages use the starting lives, from the
  // bridge or else the mode's rules.
  starting_lives: Number.isFinite(raw.starting_lives) && raw.starting_lives > 0 ? raw.starting_lives : range?.lives ?? raw.lives,
  round: {...round, number: round.index + ROUND_NUMBER_OFFSET, lives_lost: Number.isFinite(round.lives_lost) ? round.lives_lost : null},
  bloons: normalizeBloons(raw.bloons),
  match: {...match, end_round: range?.end ?? null, start_round: range?.start ?? null, mode_name: modeName(match.difficulty, match.mode)},
 };
}

// {count, by_type, other_types, camo, regrow, fortified, moab_class, furthest, progress_p50, progress_p75,
// progress_p90, moabs} or null. Progress values are 0 (entrance) to 1 (exit). moabs (bridge 0.3.11): the MOAB-class
// bloons, furthest first, [{type, progress, health, max_health}]; [] from older bridges. The MOAB measure
// (moab-calibration.mjs) and graded speed's moab_outrun read it; before this was kept, normalizing dropped it.
// nearest_exit (bridge 0.3.15): the 5 bloons furthest along, furthest first, [{type, camo, regrow, fortified, progress}];
// [] from older bridges. The runner logs it with each decision (runner.mjs bloonLog).
export function normalizeBloons(b) {
 if (!b || typeof b !== 'object') return null;
 if (!Number.isInteger(b.count) || b.count < 0) throw Error('Bridge state: bloons.count must be a non-negative integer');
 const p = (v, name) => { if (v == null) return null; if (!Number.isFinite(v) || v < 0 || v > 1) throw Error(`Bridge state: bloons.${name} must be 0 to 1`); return v; };
 const n = k => Number.isInteger(b[k]) ? b[k] : 0;
 return {count: b.count, by_type: b.by_type ?? {}, other_types: n('other_types'), camo: n('camo'), regrow: n('regrow'), fortified: n('fortified'), moab_class: n('moab_class'),
  furthest: p(b.furthest, 'furthest'), progress_p50: p(b.progress_p50, 'progress_p50'), progress_p75: p(b.progress_p75, 'progress_p75'), progress_p90: p(b.progress_p90, 'progress_p90'),
  moabs: normalizeMoabs(b.moabs), nearest_exit: normalizeFront(b.nearest_exit)};
}

function normalizeFront(list) {
 if (list == null) return [];
 if (!Array.isArray(list)) throw Error('Bridge state: bloons.nearest_exit must be a list');
 return list.filter(b => b && typeof b.type === 'string').map(b => ({type: b.type, camo: b.camo === true, regrow: b.regrow === true, fortified: b.fortified === true,
  progress: Number.isFinite(b.progress) ? b.progress : null}));
}

function normalizeMoabs(list) {
 if (list == null) return [];
 if (!Array.isArray(list)) throw Error('Bridge state: bloons.moabs must be a list');
 const num = v => Number.isFinite(v) ? v : null;
 return list.filter(m => m && typeof m.type === 'string').map(m => ({type: m.type, progress: num(m.progress), health: num(m.health), max_health: num(m.max_health)}));
}

export const towerLabel = t => `${t.base_id} ${t.tiers.join('-')}`;
export const livesPercent = s => s.starting_lives ? Math.round(100 * s.lives / s.starting_lives) : null;

// What a decision depends on: the match, the round, the towers with their upgrade tiers, and any open screen.
// Cash, lives and bloons change continuously and are checked as action preconditions instead.
export function fingerprint(state) {
 if (!state.in_game) return JSON.stringify(['out_of_game', state.screen ?? null, state.popup?.class ?? null]);
 const towers = state.towers_hash ?? JSON.stringify([...state.towers].sort((a, b) => a.id - b.id).map(t => [t.id, t.base_id, t.tiers]));
 return JSON.stringify([state.match.id, state.round.number, towers, state.popup?.class ?? null]);
}
