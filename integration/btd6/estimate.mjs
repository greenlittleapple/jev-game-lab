// Round composition and a rough estimate of what the placed towers can pop, for policy btd6-jev-v2.
// Data: data/rounds.json and data/towers.json, made by data/generate.mjs from the BTD6 Mod Helper
// game-data export (the source commit is in each file). See docs/ARCHITECTURE.md, "Policy btd6-jev-v2".
//
// Estimate: a tower's pops per second (towers.json: projectiles per shot x min(pierce, 10) x damage /
// attack interval) times the time bloons are on the track for the round (when the last bloon is sent,
// plus DWELL_SECONDS for it to cross the defence) times EFFICIENCY (towers miss, overkill and idle).
// Enough for a round: that estimate for all damage-dealing towers is at least the round's RBE times the
// safety margin for the lives left, the defence can pop camo and lead if the round has them (camo Lead bloons:
// one tower that does both), and some damage-dealing tower's range reaches the first half of the track.
// Burst (reported, not part of enough; threat.mjs uses it): the same estimate over the round's densest
// PEAK_SECONDS of sending plus DWELL_SECONDS, times BURST_FACTOR, against that window's RBE times the margin.
import {readFileSync} from 'node:fs';
import {coverage, reach} from './spots.mjs';
import {towerFacts, aimOf, globalShare, towerTable} from './towers.mjs';
import {aimStatus} from './aim.mjs';
import {bloonRbe, parseBloon} from './data/generate.mjs';

const load = name => JSON.parse(readFileSync(new URL(`./data/${name}.json`, import.meta.url), 'utf8'));
export const ROUND_DATA = load('rounds');
export const TOWER_DATA = load('towers');

export const EFFICIENCY = 0.8;
export const DWELL_SECONDS = 8;
// The window of rounds.json's peak (data/generate.mjs PEAK_SECONDS).
export const PEAK_SECONDS = 10;
// The pops the defence measured in the densest window against the estimate for it. Round 78 on Monkey Meadow Hard
// Standard sends 8,870 of its 26,382 RBE in 10 s near its end (72 camo Ceramics in 1.2 s, with Purples and
// Rainbows). In three current-era runs that lost there with pops measured (logs 21-12-37, 21-59-37 and
// 22-21-05), the towers popped 0.92 to 0.96 of the round's RBE, while this window's estimate (with the Ace's
// measured share, towers.mjs GLOBAL_SHARE) was 1.30, 1.12 and 1.20 times the window's RBE: 0.71 to 0.82 of the
// estimate was real, about 0.8. The runs that cleared it without loss had 1.43 to 1.66. A fourth loss (22-38-58:
// 0.89 popped against 1.68) is inside the wins' range, so no factor on this estimate separates it.
export const BURST_FACTOR = 0.8;
// Share of the track, from the entrance, that some damage-dealing tower must reach.
export const EARLY_TRACK = 0.5;
// Estimate / (RBE x margin) at or above COMFORT for this round and the next: far enough ahead to save.
export const COMFORT = 1.5;
// With one life no bloon may leak; with few lives, few.
// Early rounds with one life (CHIMPS): through EARLY_ROUND_LAST the margin is EARLY_ONE_LIFE_MARGIN. CHIMPS series 1
// (btd6-jev-v6 revision 5) lost both matches at round 6 with one 0-0-0 Bomb Shooter and $245 unspent, at an estimate
// of about 2.5 times the round's RBE (ratio 1.66 at 1.5); in the current-era Hard Standard logs rounds 3 to 10 leaked
// at estimates up to about 2.2 times RBE. From btd6-jev-v6 revision 6, btd6-playbook-v5 revision 10 and btd6-claude-v1
// revision 9; the session turns it on for those policies only (session.mjs, dashboard.mjs). btd6-jev-v4 is frozen and,
// like the earlier policies, keeps the margin without it, as it keeps towers-v4.json.
export const EARLY_ROUND_LAST = 10;
export const EARLY_ONE_LIFE_MARGIN = 3.0;
export const EARLY_MARGIN_POLICIES = ['btd6-jev-v6', 'btd6-playbook-v5', 'btd6-claude-v1'];
let earlyMargin = false;
export function setEarlyMargin(on = false) { earlyMargin = !!on; }
export const earlyMarginFor = policy => EARLY_MARGIN_POLICIES.includes(policy);
export const earlyMarginOn = () => earlyMargin;
// round: the round being checked (null: unknown, no early margin).
export const margin = (lives, round = null) => lives <= 1 && earlyMargin && round != null && round <= EARLY_ROUND_LAST ? EARLY_ONE_LIFE_MARGIN
 : lives <= 1 ? 1.5 : lives <= 10 ? 1.3 : 1.15;

export const roundFacts = round => ROUND_DATA.rounds[round] ?? null;
export const roundSeconds = round => (roundFacts(round)?.seconds ?? 0) + DWELL_SECONDS;
// e.g. "4 Green, 15 Red, 15 Blue"
export const bloonList = round => Object.entries(roundFacts(round)?.bloons ?? {}).map(([b, n]) => `${n} ${b}`).join(', ');
export const hasLead = round => Object.keys(roundFacts(round)?.bloons ?? {}).some(b => b.startsWith('Lead'));

// Hero level: the tower's level field, else its first tier (the bridge state and the logs carry Quincy 7 as tiers
// [7, 0, 0]), else its name ("Quincy 3"); 1 when none says. The 'v4' table (towers.mjs setTowerTable) skips the tier,
// as the estimate did before.
export const heroLevel = (t, {tiers = true} = {}) => t.level ?? (tiers && t.tiers?.[0] >= 1 ? t.tiers[0] : null) ?? Number(/ (\d+)$/.exec(t.name ?? '')?.[1] ?? 1);
// {pps, lead, camo, range, moab, camoLead} for a placed tower, or null when towers.json doesn't have it. moab: damage
// per second against one MOAB (policy btd6-jev-v4, moab.mjs); camoLead: one attack sees camo and pops Lead.
export function towerEstimate(t) {
 const {data, heroTiers} = towerTable(), table = data.towers[t.base_id];
 const row = table?.[t.is_hero || t.base_id === 'Quincy' ? heroLevel(t, {tiers: heroTiers}) : (t.tiers ?? [0, 0, 0]).join('')];
 return row ? {pps: row[0], lead: row[1] === 1, camo: row[2] === 1, range: row[3], moab: row[4] ?? 0, camoLead: row[5] === 1} : null;
}
// The same for a tower about to be placed or upgraded.
export const baseEstimate = id => towerEstimate({base_id: id, tiers: [0, 0, 0], level: 1});

// Real-coverage factor (policy btd6-jev-v3): pops only count for the track the tower reaches.
//  - a tower that aims at bloons is busy for the time a bloon takes to cross its range; that time is full
//    when the track in range is at least a straight pass through the whole circle (2 x range), and
//    shorter in proportion when the track only clips the circle;
//  - a radial tower (the Tack Shooter) also sends its projectiles in fixed directions: only the share of
//    directions that point at track in range can hit (`directions`), and of those about RADIAL_HIT
//    find a bloon (a guess: the tack needs a bloon on its line when it passes);
//  - a global tower (towers.mjs AIM) reaches the whole track: factor 1, times its measured share (towers.mjs
//    GLOBAL_SHARE: 0.1 for the Monkey Ace, whose shots mostly miss the track);
//  - a tower whose attack goes to a set point (aim.mjs: Dartling, Mortar, Heli) counts only once aimed: at a
//    point, like an aimed tower whose range circle is the aim radius around that point; a Heli on Pursuit
//    reaches the whole track; left on the cursor, or with no point, it counts 0 (aimStatus).
// Without paths the factor is 1 (unknown), as in v2, except that an unaimed point tower counts 0.
export const RADIAL_HIT = 0.5;
export function reachFactor(t, range, paths) {
 const status = aimStatus(t, paths);
 if (status.kind === 'unaimed') return {factor: 0, reach: null, aim: 'unaimed'};
 if (status.kind === 'global') return {factor: 1, reach: null, aim: 'global'};
 if (status.kind === 'point') {
  if (!paths.length) return {factor: 1, reach: null, aim: 'point'};
  const r = reach(status.point, status.radius, paths);
  return {factor: +Math.min(1, r.length / (2 * status.radius)).toFixed(3), reach: r, aim: 'point', point: status.point};
 }
 const aim = aimOf(t.base_id);
 if (aim === 'global') return {factor: globalShare(t.base_id), reach: null, aim};
 if (!paths.length) return {factor: 1, reach: null, aim};
 if (!(range > 0) || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return {factor: 0, reach: null, aim};
 const r = reach(t, range, paths);
 const exposure = Math.min(1, r.length / (2 * range));
 const factor = aim === 'radial' ? exposure * r.directions * RADIAL_HIT : exposure;
 return {factor: +factor.toFixed(3), reach: r, aim};
}
// Pops per second that count on this track: towers.json's rate times the reach factor.
export function effectivePps(t, paths) {
 const e = towerEstimate(t);
 if (!e) return null;
 return +(e.pps * reachFactor(t, e.range, paths).factor).toFixed(2);
}

// The pops calibration (pops-calibration.mjs): a factor on can_pop for rounds from fromRound on, with the reach
// factor only (btd6-jev-v3 and later; v2's estimate is left as it is). Set once per session; 1 by default.
const pops = {factor: 1, fromRound: 1};
export function setPopsCalibration(factor = 1, {fromRound = 1} = {}) {
 if (!(factor > 0 && factor <= 10)) throw Error('The pops calibration factor must be above 0 and at most 10.');
 if (!(Number.isInteger(fromRound) && fromRound >= 1)) throw Error('The pops calibration round must be a whole number from 1.');
 Object.assign(pops, {factor, fromRound});
}
export const popsCalibration = () => ({factor: pops.factor, from_round: pops.fromRound});

// The defence against one round. towers: [{base_id, tiers, x, y, ...}]; paths from the spot catalog
// (none: the early-track check is skipped, early: null). Towers missing from towers.json count as
// damage-dealing with no pops (unknown), so they never make a round look covered. useReach (v3): each
// tower's pops are scaled by reachFactor.
// factor: the pops calibration for this check; by default the session's for this round (setPopsCalibration).
export function roundCheck(towers, round, {lives = 1, paths = [], useReach = false, factor = round >= pops.fromRound ? pops.factor : 1} = {}) {
 const r = roundFacts(round);
 if (!r) return null;
 // A point tower left unaimed (aim.mjs) counts for nothing, with or without reach.
 const est = towers.filter(t => aimStatus(t, paths).kind !== 'unaimed').map(t => ({t, e: towerEstimate(t)})).filter(({t, e}) => e ? e.pps > 0 : towerFacts(t.base_id).damage !== false);
 const rate = ({t, e}) => e ? (useReach ? effectivePps(t, paths) : e.pps) : 0;
 const pps = est.reduce((n, x) => n + rate(x), 0);
 // v3: a tower that reaches no track (factor 0) doesn't count for camo, lead or the early track either.
 const counted = useReach && paths.length ? est.filter(({t, e}) => !e || reachFactor(t, e.range, paths).factor > 0) : est;
 const canPop = Math.round(pps * roundSeconds(round) * EFFICIENCY * (useReach ? factor : 1)), needs = Math.ceil(r.rbe * margin(lives, round));
 // towers.json first; the hand-written table in towers.mjs only for towers missing there.
 const can = (t, e, k) => e ? e[k] : towerFacts(t.base_id)[k] === true;
 const camo = r.camo > 0 ? counted.some(({t, e}) => can(t, e, 'camo')) : null;
 const lead = hasLead(round) ? counted.some(({t, e}) => can(t, e, 'lead')) : null;
 // Camo Lead bloons: one tower must do both (towers.mjs's table has no tower that does, so a missing entry never covers them),
 // and a global tower with a measured share below 1 (the Monkey Ace, towers.mjs GLOBAL_SHARE) doesn't count. In the
 // current-era logs the one run whose only camo Lead answer was a Monkey Ace (4-2-0, whose Lead popping is its
 // Pineapple drops; log 22-11-44) lost 116 of 100 lives at round 59 (50 camo Leads); the 13 that cleared it had a
 // Sniper, Mortar or Wizard that does both.
 const camoLead = r.camo_lead > 0 ? counted.some(({t, e}) => e?.camoLead === true && globalShare(t.base_id) >= 1) : null;
 const early = paths.length ? counted.some(({t, e}) => {
  const status = aimStatus(t, paths);
  if (useReach && status.kind === 'global') return true;
  if (status.kind === 'point') { const c = coverage(status.point, status.radius, paths); return c.share > 0 && c.from <= EARLY_TRACK; }
  if (useReach && aimOf(t.base_id) === 'global') return true;
  const c = coverage(t, e?.range ?? 0, paths);
  return c.share > 0 && c.from <= EARLY_TRACK;
 }) : null;
 const ratio = needs ? canPop / needs : Infinity;
 const burst = burstCheck(r, {round, pps, lives, factor: useReach ? factor : 1});
 return {round, rbe: r.rbe, can_pop: canPop, needs, ratio: +ratio.toFixed(2), camo, lead, camo_lead: camoLead, early,
  enough: ratio >= 1 && camo !== false && lead !== false && camoLead !== false && early !== false, ...burst};
}

// Camo capacity (graded speed's camo margin, speed.mjs defenceMargins with camo; no verdict or rule uses it): the
// camo-capable towers' pops over the round (the same rate, reach, time, efficiency and factor as roundCheck) against
// the RBE of the round's camo bloons (rounds.json camo_rbe) times the lives margin. null in a round without camo bloons.
export function camoCheck(towers, round, {lives = 1, paths = [], factor = round >= pops.fromRound ? pops.factor : 1} = {}) {
 const r = roundFacts(round);
 if (!(r?.camo_rbe > 0)) return null;
 let pps = 0;
 for (const t of towers) {
  if (aimStatus(t, paths).kind === 'unaimed') continue;
  const e = towerEstimate(t);
  if (e?.pps > 0 && e.camo) pps += effectivePps(t, paths) ?? 0;
 }
 const canPop = Math.round(pps * roundSeconds(round) * EFFICIENCY * factor), needs = Math.ceil(r.camo_rbe * margin(lives, round));
 return {rbe: r.camo_rbe, can_pop: canPop, needs, ratio: +(canPop / needs).toFixed(2)};
}

// The RBE of a round's Lead bloons (any Lead variant: camo, fortified, regrow), each bloon's full RBE with its children, by
// its name in rounds.json's bloons. 0 in a round without them. ddt: true counts DDTs as Lead bloons too, as btd6-jev-v6
// revisions 12 to 14 did; from v6 revision 15 a DDT (MOAB-class, and Black, which a Lead-only tower such as a Bomb Shooter
// can't damage) is left to the MOAB check's DDT-capable figure (moab.mjs). A BAD's DDTs never counted here.
export const isLeadBloon = (name, {ddt = false} = {}) => (ddt ? ['Lead', 'Ddt'] : ['Lead']).includes(parseBloon(name).base);
export const leadRbe = (round, {ddt = false} = {}) => Object.entries(roundFacts(round)?.bloons ?? {}).reduce((n, [b, k]) => n + (isLeadBloon(b, {ddt}) ? bloonRbe(b) * k : 0), 0);

// Lead capacity (threat.mjs lead_capacity, from btd6-jev-v6 revision 12): camoCheck for Lead. The Lead-capable towers' pops
// over the round (the same rate, reach, time, efficiency and factor) against leadRbe times the lives margin. null in a
// round without Lead bloons. A tower counts when towers.json says it pops Lead; for camo Lead bloons the yes-or-no
// camo_lead check, not this, asks for one tower that does both. ddt: as leadRbe (true gives v6 revisions 12 to 14).
export function leadCheck(towers, round, {lives = 1, paths = [], factor = round >= pops.fromRound ? pops.factor : 1, ddt = false} = {}) {
 const rbe = leadRbe(round, {ddt});
 if (!(rbe > 0)) return null;
 let pps = 0;
 for (const t of towers) {
  if (aimStatus(t, paths).kind === 'unaimed') continue;
  const e = towerEstimate(t);
  if (e?.pps > 0 && e.lead) pps += effectivePps(t, paths) ?? 0;
 }
 const canPop = Math.round(pps * roundSeconds(round) * EFFICIENCY * factor), needs = Math.ceil(rbe * margin(lives, round));
 return {rbe, can_pop: canPop, needs, ratio: +(canPop / needs).toFixed(2)};
}

// The densest PEAK_SECONDS of a round (rounds.json peak): {burst: null | true | false, burst_facts}. burst is false when
// the pops over PEAK_SECONDS + DWELL_SECONDS times BURST_FACTOR fall short of the window's RBE x margin; null when the
// round has no peak (MOAB-class only, or no data).
function burstCheck(r, {round, pps, lives, factor}) {
 if (!(r.peak > 0)) return {burst: null, burst_facts: null};
 const canPop = Math.round(pps * (PEAK_SECONDS + DWELL_SECONDS) * EFFICIENCY * BURST_FACTOR * factor), needs = Math.ceil(r.peak * margin(lives, round));
 const ratio = +(canPop / needs).toFixed(2);
 return {burst: ratio >= 1, burst_facts: {rbe: r.peak, can_pop: canPop, needs, ratio}};
}

// Pops per second a round needs from the defence (the floor as a rate), for docs and tests.
export const neededPps = (round, lives = 1) => (roundFacts(round).rbe * margin(lives, round)) / (roundSeconds(round) * EFFICIENCY);
