// Candidate camo capacity models (camo-replay.mjs --models; data only, no policy or rule uses them). Each takes
// estimate.mjs camoCheck's figures for a round (can_pop: the camo-capable towers' pops over the round, with reach,
// efficiency and the pops calibration; needs: the round's camo RBE times the lives margin) and returns a ratio, as
// camoCheck's own ratio (today's camo margin) does.
//   A (competing targets): the towers' pops scaled by the round's camo share (camo RBE / round RBE).
//   B (rate): the towers' pops per second (can_pop over roundSeconds) against the camo RBE per second (needs over the
//     camo spawn window: the stretch from the first camo bloon's spawn to the last one's, data/camo-timing.json, plus
//     DWELL_SECONDS for the last to cross the defence, as roundSeconds adds it to the round).
//   C: B with A's share on the towers' rate.
import CAMO_TIMING from './data/camo-timing.json' with {type: 'json'};
import {camoCheck, roundFacts, roundSeconds, DWELL_SECONDS} from './estimate.mjs';

const ratio = (pops, needs) => needs > 0 ? +(pops / needs).toFixed(2) : null;

// The round's camo share of its RBE (0 to 1).
export const camoShare = ({rbe, camo_rbe: camoRbe}) => rbe > 0 && camoRbe > 0 ? Math.min(1, camoRbe / rbe) : 0;
// Seconds the defence has for the round's camo bloons: their spawn stretch plus DWELL_SECONDS; null without timing.
export const camoWindow = timing => timing && Number.isFinite(timing.start) && Number.isFinite(timing.end) ? +(Math.max(0, timing.end - timing.start) + DWELL_SECONDS).toFixed(2) : null;
export const camoTimingOf = round => CAMO_TIMING.rounds[round] ?? null;

export function modelA({canPop, needs, share}) { return ratio(canPop * share, needs); }
export function modelB({canPop, needs, roundSecs, windowSecs}) {
 if (!(roundSecs > 0) || !(windowSecs > 0)) return null;
 return ratio(canPop / roundSecs, needs / windowSecs);
}
export function modelC({canPop, needs, share, roundSecs, windowSecs}) { return modelB({canPop: canPop * share, needs, roundSecs, windowSecs}); }

// All four figures for a round on a tower list: {today, a, b, c, can_pop, needs, share, window, round_seconds}; null in
// a round without camo bloons.
export function camoFigures(towers, round, {lives = 1, paths = [], factor} = {}) {
 const check = camoCheck(towers, round, {lives, paths, ...(factor != null ? {factor} : {})});
 if (!check) return null;
 const share = camoShare(roundFacts(round)), roundSecs = roundSeconds(round), windowSecs = camoWindow(camoTimingOf(round));
 const x = {canPop: check.can_pop, needs: check.needs, share, roundSecs, windowSecs};
 return {today: check.ratio, a: modelA(x), b: modelB(x), c: modelC(x), can_pop: check.can_pop, needs: check.needs,
  share: +share.toFixed(3), window: windowSecs, round_seconds: roundSecs};
}
