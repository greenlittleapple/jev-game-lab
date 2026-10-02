// Candidate pops estimate for evaluation only (pops-study.mjs --fixes); no policy or runner uses it. Rates are the
// active tower table's (towers.mjs setTowerTable: 'v4' is the table from before on-damage projectiles were counted).
// Graded speed's --camo-margin uses estimate.mjs camoCheck, the whole-round camo part below.
//  - camo: the camo-capable towers' pops (the same rate, reach, time and efficiency as roundCheck) against the RBE of
//    the round's camo bloons (rounds-candidate.json camo_rbe: each camo bloon's full RBE, by its name in the export),
//    and over the densest PEAK_SECONDS against camo_peak as burstCheck does.
//  - purple: the same for towers with a damaging projectile not immune to Purple (bit 8) against the round's Purple
//    layers (one per Purple bloon; their Pink children aren't immune) and purple_peak.
// ratio / burst: the smaller of the whole-round (or burst) margin and each enabled margin.
import {aimStatus} from './aim.mjs';
import {effectivePps, towerEstimate, roundFacts, roundSeconds, EFFICIENCY, margin, PEAK_SECONDS, DWELL_SECONDS, BURST_FACTOR} from './estimate.mjs';
import CANDIDATE from './data/towers-candidate.json' with {type: 'json'};
import ROUND_EXTRAS from './data/rounds-candidate.json' with {type: 'json'};

const heroLevel = t => t.level ?? Number(/ (\d+)$/.exec(t.name ?? '')?.[1] ?? 1);
// {pps, camo, purple, range} from towers-candidate.json, or null.
export function candidateEstimate(t) {
 const row = CANDIDATE.towers[t.base_id]?.[t.is_hero || t.base_id === 'Quincy' ? heroLevel(t) : (t.tiers ?? [0, 0, 0]).join('')];
 return row ? {pps: row[0], camo: row[2] === 1, range: row[3], purple: row[6] === 1} : null;
}
export const roundExtras = round => ROUND_EXTRAS.rounds[round] ?? null;

export function candidateCheck(towers, round, {lives = 1, paths = [], camo = false, purple = false} = {}) {
 const r = roundFacts(round), x = roundExtras(round);
 if (!r) return null;
 let pps = 0, camoPps = 0, purplePps = 0;
 for (const t of towers) {
  if (aimStatus(t, paths).kind === 'unaimed') continue;
  const e = towerEstimate(t), c = candidateEstimate(t);
  if (!(e?.pps > 0) || !c) continue;
  const rate = effectivePps(t, paths) ?? 0;
  pps += rate;
  if (c.camo) camoPps += rate;
  if (c.purple) purplePps += rate;
 }
 const L = margin(lives, round), whole = secs => secs * EFFICIENCY, peak = (PEAK_SECONDS + DWELL_SECONDS) * EFFICIENCY * BURST_FACTOR;
 const ratio = (rate, rbe, t) => rbe > 0 ? rate * t / Math.ceil(rbe * L) : null;
 const out = {whole: ratio(pps, r.rbe, whole(roundSeconds(round))), whole_burst: ratio(pps, r.peak, peak), camo: null, camo_burst: null, purple: null, purple_burst: null};
 if (camo && x) Object.assign(out, {camo: ratio(camoPps, x.camo_rbe, whole(roundSeconds(round))), camo_burst: ratio(camoPps, x.camo_peak, peak)});
 if (purple && x) Object.assign(out, {purple: ratio(purplePps, x.purple, whole(roundSeconds(round))), purple_burst: ratio(purplePps, x.purple_peak, peak)});
 const min = list => { const v = list.filter(n => n != null); return v.length ? Math.min(...v) : null; };
 return {...out, ratio: min([out.whole, out.camo, out.purple]), burst: min([out.whole_burst, out.camo_burst, out.purple_burst])};
}
