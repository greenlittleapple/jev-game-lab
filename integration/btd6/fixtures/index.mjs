// Hand-written fixtures for the BTD6 tests. Costs, ranges, positions and upgrade names are
// illustrative, not exported game data, and the track is a simple polyline, not a real map.
import {readFileSync} from 'node:fs';
import {normalizeState} from '../state.mjs';

const load = name => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
export const rawPreRound = () => load('state-pre-round');
export const rawRound21 = () => load('state-round21');
export const preRound = () => normalizeState(rawPreRound());
export const round21 = () => normalizeState(rawRound21());
export const catalog = load('catalog').towers;
export const paths = load('track').paths;

// A valid opening plan for the pre-round state, in the shape the strategist answers with.
export const openingPlan = (extra = {}) => ({
 summary: 'Darts and a Boomerang hold the early rounds; a Bomb Shooter covers lead by round 28.',
 priorities: ['No leaks before round 24', 'Camo detection before round 24'],
 build_order: [
  {step: 's1', action: 'place', tower: 'DartMonkey', spot: 'S01', ref: 'dart1', round_from: 3},
  {step: 's2', action: 'upgrade', target: 'dart1', path: 2, tier: 2, round_from: 5},
  {step: 's3', action: 'place', tower: 'BoomerangMonkey', round_from: 8},
  {step: 's4', action: 'place', tower: 'BombShooter', ref: 'bomb1', round_from: 20, round_by: 26},
 ],
 cash_reserve: [{from_round: 18, to_round: 26, amount: 400, reason: 'Bomb Shooter for lead'}],
 allowed_towers: ['DartMonkey'],
 threats: [{threat: 'lead', round: 28, handled_by: ['s4']}],
 replan_below_lives_percent: 50, review_round: 30, note: '',
 ...extra,
});

// The first live btd6-jev-v0 run's opening decision (see v0-round6.json).
const v0 = load('v0-round6');
export const v0Round6 = (patch = {}) => normalizeState({...structuredClone(v0.state), ...patch});
export const v0Catalog = v0.towers.map(t => ({is_hero: false, unlocked: true, ...t}));

// Monkey Meadow's real track and its DartMonkey spot catalog (see monkey-meadow.json).
const meadow = load('monkey-meadow');
export const meadowPaths = meadow.paths.map(p => p.points.map(([x, y]) => ({x, y})));
export const meadowSpots = meadow.spots;
export const meadowSpot = id => meadow.spots.find(s => s.id === id);
