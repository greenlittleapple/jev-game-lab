// Camo capacity replay (data only; no decision or rule changes): estimate.mjs camoCheck rebuilt on logged decision states
// with the current towers.json and Quincy's level from the state (estimate.mjs heroLevel), the run's session calibration
// (pops factor, MOAB factor) as pops-study's gradedRows sets it, and Monkey Meadow's track for map Tutorial.
//   npm run btd6:camo-replay -- [--dir <folder>] [--since 2026-09-30T19-26] [--thresholds 0.9,1,1.1,1.2,1.3] [--json]
// Runs: currentEra (btd6-open-v2 or later, bridge 0.3.13 or later) whose log name starts at or after --since.
// Per round (pops-calibration.mjs roundsOf for lives lost), at the round's first decision state: camo, the camo margin
// (camoCheck ratio; null in a round without camo bloons); whole, roundCheck's ratio with reach (0 when camo or Lead is
// missing, defenceMargins' pops without camo); graded, defenceMargins' margin (whole against the MOAB check).
// Look-ahead (as threat_short, THREAT_LEAD_ROUNDS): at each decision in round n, the rounds n..n+3 (to the match's end)
// with camo bloons; the decision is flagged at a threshold when one of them has a camo margin below it (the first such
// round is the flagged round). Answers: the logged options (affordable when logged; threat-replay.mjs rebuild) with a
// known cost whose purchase raises camoCheck's can_pop for the flagged round; the best is the largest gain per dollar.
// Camo models (--models; camo.mjs, data only):
//   npm run btd6:camo-replay -- --models [--since 2026-09-30T10-00] [--json]
// Runs: currentEra, Hard Standard and Hard CHIMPS, from --since. At each round with camo bloons, at the round's first
// decision state (towers, reach, lives margin and calibration as above): today's camo margin (camoCheck ratio) and the
// models A, B and C (camo.mjs), bucketed by MODEL_BUCKETS with the rounds that lost lives (pops_round lives_lost, else
// roundsOf); per round also the pops the camo-capable towers made (pops_round per tower, any bloon) and whether a camo
// bloon was among state.bloons.nearest_exit at the round's last decision. Losses (MODEL_LOSSES): each figure for the
// loss round at the first decision state of that round and the 3 before. Binding: CHIMPS decision states (no popup) in
// rounds 6 to 80 where a camo round within THREAT_LEAD_ROUNDS has the figure below CAMO_CAPACITY_AT.
// Lead margin (--lead; threat.mjs lead_capacity, btd6-jev-v6 revision 12; counts only):
//   npm run btd6:camo-replay -- --lead [--since 2026-09-30T10-00] [--json]
// Runs: currentEra, Hard Standard and Hard CHIMPS, from --since. At each round with Lead bloons (estimate.mjs leadRbe > 0),
// the Lead margin (leadCheck ratio) at the round's first decision state, with the same calibration, tower table and track as
// above, and whether lives were lost in that round (roundsOf), bucketed by LEAD_BUCKETS. Flags: for each CHIMPS
// btd6-jev-v6 log, the decisions where threat_short with THREAT_KINDS_V4 has lead_capacity due, and of those the decisions
// where an affordable logged option (threat-replay.mjs rebuild) raises the Lead margin; saving: the decisions where revision
// 12's floor (policy-v6.mjs floorRulesV6, the saving pool from threat-replay.mjs poolFor, leak pressure from the logged rules)
// saves and revision 11's doesn't, each on its logged state (the cash the saving would have kept isn't added back), and the
// longest run of such decisions in a row (decisions, and the rounds from its first to its last).
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {camoCheck, leadCheck, leadRbe, roundCheck, roundFacts, setPopsCalibration} from './estimate.mjs';
import {defenceMargins} from './speed.mjs';
import {setMoabCalibration} from './moab.mjs';
import {setTowerTable} from './towers.mjs';
import {after} from './policy-v3.mjs';
import {THREAT_LEAD_ROUNDS, THREAT_KINDS_V3, THREAT_KINDS_V4, THREAT_BURST_AHEAD, threatShort, threatEffect} from './threat.mjs';
import {roundsOf} from './pops-calibration.mjs';
import {currentEra} from './hard-rounds.mjs';
import {pathsFor} from './moab-replay.mjs';
import {readRuns} from './rules-audit.mjs';
import {harvest, rebuild, poolFor} from './threat-replay.mjs';
import {floorRulesV6} from './policy-v6.mjs';
import {camoFigures} from './camo.mjs';
import {towerEstimate} from './estimate.mjs';
import {CAMO_CAPACITY_AT} from './threat.mjs';

export const CAMO_THRESHOLDS = [0.9, 1.0, 1.1, 1.2, 1.3];
export const BIG_LOSS = 5;
const hasCamo = n => roundFacts(n)?.camo_rbe > 0;
const isDecision = r => r.kind === 'decision' && r.state?.in_game && r.state.round && Array.isArray(r.state.towers);
const costOf = label => { const m = /\(\$(\d+)\)\s*$/.exec(label ?? ''); return m ? Number(m[1]) : null; };
const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';

// Camo can_pop for a round on a tower list (0 when the round has no camo bloons).
const camoPops = (towers, round, lives, paths) => camoCheck(towers, round, {lives, paths})?.can_pop ?? 0;

// Affordable purchases at one decision that raise the camo can_pop of `round`: [{id, cost, gain (ratio), per_k (ratio per $1000)}],
// best first; plus the options left out for want of a known cost.
export function camoAnswers(record, lookup, round, paths) {
 const s = record.state, base = camoCheck(s.towers, round, {lives: s.lives, paths});
 if (!base) return {answers: [], no_cost: 0};
 const all = rebuild(record, lookup).candidates.filter(spends);
 const out = [];
 for (const c of all.filter(c => c.details.cost != null)) {
  const added = camoPops(after(s, c), round, s.lives, paths) - base.can_pop;
  if (added > 0) { const gain = added / base.needs; out.push({id: c.id, cost: c.details.cost, gain: +gain.toFixed(3), per_k: +(1000 * gain / (c.details.cost || 1)).toFixed(4), ratio_after: +(base.ratio + gain).toFixed(2)}); }
 }
 out.sort((a, b) => b.per_k - a.per_k || a.cost - b.cost);
 return {answers: out, no_cost: all.length - all.filter(c => c.details.cost != null).length};
}

// One run: {rounds: [{round, lost, cleared, camo_round, camo, whole, graded}], decisions: [{round, ahead: [{round, camo}], chosen, cost, outcome}]}.
// calibration: the session's (session_start.calibration), set for the run.
export function withCalibration(cal, fn) {
 setMoabCalibration(cal?.moab?.factor ?? 1);
 setPopsCalibration(cal?.pops?.factor ?? 1, {fromRound: cal?.pops?.from_round ?? 1});
 try { return fn(); } finally { setMoabCalibration(1); setPopsCalibration(1); }
}
export const sessionCalibration = records => records.find(r => r.kind === 'session_start')?.calibration ?? {};

export function camoRun(records, {paths = []} = {}) {
 return withCalibration(sessionCalibration(records), () => {
  const firstState = new Map();
  for (const r of records) if (isDecision(r) && !firstState.has(r.state.round.number)) firstState.set(r.state.round.number, r.state);
  const rounds = roundsOf(records).map(x => {
   const s = firstState.get(x.round), m = s ? defenceMargins(s, paths, {camo: true}) : null;
   const whole = s ? roundCheck(s.towers, x.round, {lives: s.lives, paths, useReach: true}) : null;
   return {round: x.round, lost: x.lost, cleared: x.cleared, camo_round: hasCamo(x.round), camo: m?.camo ?? null,
    whole: whole ? (whole.camo === false || whole.lead === false ? 0 : whole.ratio) : null, graded: s ? (defenceMargins(s, paths).margin ?? null) : null};
  });
  const decisions = [];
  for (const r of records) {
   if (!isDecision(r)) continue;
   const s = r.state, n = s.round.number, last = Math.min(s.match?.end_round ?? 100, n + THREAT_LEAD_ROUNDS), ahead = [];
   for (let k = n; k <= last; k++) if (hasCamo(k)) ahead.push({round: k, camo: camoCheck(s.towers, k, {lives: s.lives, paths}).ratio});
   decisions.push({record: r, round: n, cash: Math.floor(s.cash ?? 0), ahead, chosen: r.chosen?.id ?? null, cost: costOf(r.chosen?.label), outcome: r.outcome ?? null});
  }
  return {rounds, decisions};
 });
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))] : null;
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
export const BANDS = [[24, 39], [40, 59], [60, 80]];

// The study over runs [{name, records}]: lost rounds, clean-round percentiles, thresholds with answers, and the
// purchases of the given runs over the given rounds (focus: {runs: [name parts], from, to, round}).
export function camoStudy(runs, {lookup = harvest(runs), thresholds = CAMO_THRESHOLDS, focus = null} = {}) {
 setTowerTable('current');
 const per = runs.map(({name, records}) => {
  const start = records.find(r => r.kind === 'run_start') ?? {};
  const map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map, paths = pathsFor(map);
  return {name, policy: start.policy ?? '?', revision: start.policy_revision ?? null, paths, cal: sessionCalibration(records), ...camoRun(records, {paths})};
 });
 const lostRounds = per.flatMap(p => p.rounds.filter(x => x.lost > BIG_LOSS).map(x => ({run: p.name, policy: p.policy, revision: p.revision, round: x.round, lost: x.lost,
  camo_round: x.camo_round, camo: x.camo, whole: x.whole, graded: x.graded})));
 const clean = BANDS.map(([lo, hi]) => {
  const v = per.flatMap(p => p.rounds.filter(x => x.round >= lo && x.round <= hi && x.camo_round && x.lost === 0 && x.cleared && x.camo != null).map(x => x.camo)).sort((a, b) => a - b);
  return {band: `${lo}-${hi}`, rounds: v.length, p5: pct(v, 5), p10: pct(v, 10), p25: pct(v, 25), p50: pct(v, 50)};
 });
 const byThreshold = thresholds.map(t => {
  const flaggedRounds = new Map(), answers = [];
  let decisions = 0;
  for (const p of per) {
   const lost = new Map(p.rounds.map(x => [x.round, x]));
   for (const d of p.decisions) {
    const hit = d.ahead.find(a => a.camo < t);
    if (!hit) continue;
    decisions++;
    for (const a of d.ahead.filter(a => a.camo < t)) {
     const key = `${p.name}|${a.round}`;
     if (!flaggedRounds.has(key)) flaggedRounds.set(key, {run: p.name, policy: p.policy, round: a.round, from_round: d.round, lost: lost.get(a.round)?.lost ?? null, reached: lost.has(a.round)});
    }
    const memo = d.answers ??= new Map();
    if (!memo.has(hit.round)) memo.set(hit.round, withCalibration(p.cal, () => camoAnswers(d.record, lookup, hit.round, p.paths)));
    const {answers: list, no_cost} = memo.get(hit.round);
    answers.push({run: p.name, round: d.round, flagged: hit.round, camo: hit.camo, cash: d.cash, best: list[0] ?? null, reaches: list.some(a => a.ratio_after >= t), no_cost});
   }
  }
  const fr = [...flaggedRounds.values()].filter(x => x.reached);
  const tally = list => ({rounds: list.length, lost_over_5: list.filter(x => x.lost > BIG_LOSS).length, lost_1_to_5: list.filter(x => x.lost > 0 && x.lost <= BIG_LOSS).length, clean: list.filter(x => x.lost === 0).length});
  const policies = [...new Set(per.map(p => p.policy))].map(policy => ({policy, decisions: answers.filter(a => per.find(p => p.name === a.run).policy === policy).length, ...tally(fr.filter(x => x.policy === policy))}));
  const withAnswer = answers.filter(a => a.best);
  return {threshold: t, decisions, ...tally(fr), not_reached: flaggedRounds.size - fr.length, policies,
   flagged_losses: fr.filter(x => x.lost > BIG_LOSS).map(x => `${x.run.slice(0, 16)} r${x.round} (${x.lost} lost, from r${x.from_round})`),
   answers: {decisions: answers.length, with_answer: withAnswer.length, share: answers.length ? +(withAnswer.length / answers.length).toFixed(3) : null,
    median_cost: median(withAnswer.map(a => a.best.cost)), reaching_threshold: answers.filter(a => a.reaches).length, decisions_with_options_without_cost: answers.filter(a => a.no_cost).length},
   focus: focus ? per.filter(p => focus.runs.some(f => p.name.includes(f))).map(p => {
    const x = flaggedRounds.get(`${p.name}|${focus.round}`);
    return {run: p.name, flagged: Boolean(x), from_round: x?.from_round ?? null};
   }) : null,
   rows: answers};
 });
 // All camo rounds (reached) that lost more than 5 lives: the base the flagged counts are taken from.
 const camoLossRounds = per.reduce((n, p) => n + p.rounds.filter(x => x.camo_round && x.lost > BIG_LOSS).length, 0);
 const cleanCamoRounds = per.reduce((n, p) => n + p.rounds.filter(x => x.camo_round && x.lost === 0).length, 0);
 const smallLossCamoRounds = per.reduce((n, p) => n + p.rounds.filter(x => x.camo_round && x.lost > 0 && x.lost <= BIG_LOSS).length, 0);
 const purchases = focus ? per.filter(p => focus.runs.some(f => p.name.includes(f))).map(p => ({run: p.name, policy: p.policy, revision: p.revision,
  list: p.decisions.filter(d => d.round >= focus.from && d.round <= focus.to && /^(place|upgrade):/.test(d.chosen ?? '') && ['queued', 'executed'].includes(d.outcome)).map(d => {
   const s = d.record.state, c = rebuild({...d.record, options: [d.chosen]}, lookup).candidates[0];
   return withCalibration(p.cal, () => {
   const before = camoCheck(s.towers, focus.round, {lives: s.lives, paths: p.paths}), afterPops = c ? camoPops(after(s, c), focus.round, s.lives, p.paths) : null;
   return {round: d.round, id: d.chosen, label: d.record.chosen?.label ?? null, cost: d.cost, camo_before: before?.ratio ?? null,
    camo_after: afterPops != null && before ? +(afterPops / before.needs).toFixed(2) : null, raises_camo: afterPops != null && before ? afterPops > before.can_pop : null};
   });
  })})) : null;
 return {runs: per.length, camo_rounds_lost_over_5: camoLossRounds, clean_camo_rounds: cleanCamoRounds, camo_rounds_lost_1_to_5: smallLossCamoRounds, lostRounds, clean, thresholds: byThreshold, purchases};
}

export function selectRuns(all, since = '2026-09-30T19-26') {
 return all.filter(r => r.name >= since && currentEra(r.records));
}

export function formatCamo(s) {
 const f = v => v == null ? '-' : v;
 const out = [`Runs: ${s.runs}. Camo rounds that lost more than ${BIG_LOSS} lives: ${s.camo_rounds_lost_over_5}; clean camo rounds: ${s.clean_camo_rounds}.`, '',
  `Rounds that lost more than ${BIG_LOSS} lives: run | policy r | round | lost | camo bloons | camo margin | whole | graded`];
 for (const x of s.lostRounds) out.push([x.run.slice(0, 19), `${x.policy} r${f(x.revision)}`, x.round, x.lost, x.camo_round ? 'yes' : 'no', f(x.camo), f(x.whole), f(x.graded)].join(' | '));
 out.push('', 'Camo margin in clean camo rounds: band | rounds | p5 | p10 | p25 | p50');
 for (const b of s.clean) out.push([b.band, b.rounds, f(b.p5), f(b.p10), f(b.p25), f(b.p50)].join(' | '));
 out.push('', `Thresholds (look-ahead ${THREAT_LEAD_ROUNDS}): threshold | decisions flagged | rounds flagged (reached) | lost >${BIG_LOSS} | lost 1-${BIG_LOSS} | clean | flagged, not reached | with an affordable answer | median best cost | answer reaches threshold | focus`);
 for (const t of s.thresholds) out.push([t.threshold, t.decisions, t.rounds, t.lost_over_5, t.lost_1_to_5, t.clean, t.not_reached, `${t.answers.with_answer}/${t.answers.decisions} (${t.answers.share})`, f(t.answers.median_cost), t.answers.reaching_threshold,
  (t.focus ?? []).map(x => `${x.run.slice(11, 16)} ${x.flagged ? `from r${x.from_round}` : 'no'}`).join(', ')].join(' | '));
 out.push('', 'Per policy: threshold | policy | decisions | rounds | lost >5 | lost 1-5 | clean');
 for (const t of s.thresholds) for (const p of t.policies) out.push([t.threshold, p.policy, p.decisions, p.rounds, p.lost_over_5, p.lost_1_to_5, p.clean].join(' | '));
 if (s.purchases) {
  out.push('', 'Purchases: run | round | label | cost | camo margin of the focus round before -> after | raises camo');
  for (const p of s.purchases) for (const x of p.list) out.push([p.run.slice(0, 19), x.round, x.label, f(x.cost), `${f(x.camo_before)} -> ${f(x.camo_after)}`, x.raises_camo == null ? '-' : x.raises_camo ? 'yes' : 'no'].join(' | '));
 }
 return out.join('\n');
}

// Lead margin buckets: [label, from (inclusive), to (exclusive)].
export const LEAD_BUCKETS = [['<0.5', -Infinity, 0.5], ['0.5-1', 0.5, 1], ['1-1.5', 1, 1.5], ['1.5-2', 1.5, 2], ['>=2', 2, Infinity]];
const modeOf = records => records.find(isDecision)?.state?.match ?? {};
const setupOf = m => m.difficulty === 'Hard' && m.mode === 'Clicks' ? 'CHIMPS' : m.difficulty === 'Hard' && m.mode === 'Standard' ? 'Hard Standard' : null;

// One run: {rounds: [{round, lost, cleared, lead}], flags: {decisions, flagged, with_answer} | null (flags only for CHIMPS v6)}.
export function leadRun(records, {paths = [], lookup = null, flags = false} = {}) {
 return withCalibration(sessionCalibration(records), () => {
  const firstState = new Map();
  for (const r of records) if (isDecision(r) && !firstState.has(r.state.round.number)) firstState.set(r.state.round.number, r.state);
  const rounds = roundsOf(records).filter(x => leadRbe(x.round) > 0 && firstState.has(x.round)).map(x => {
   const s = firstState.get(x.round);
   return {round: x.round, lost: x.lost, cleared: x.cleared, lead: leadCheck(s.towers, x.round, {lives: s.lives, paths}).ratio};
  });
  if (!flags) return {rounds, flags: null};
  const out = {decisions: 0, flagged: 0, with_answer: 0, rounds: [], saving: 0, longest: {decisions: 0, rounds: 0, from: null, to: null}};
  const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
  let stretch = null;
  for (const r of records) {
   if (!isDecision(r) || r.state.popup) continue;
   out.decisions++;
   const n = r.state.round.number;
   const short = threatShort(r.state, paths, {kinds: THREAT_KINDS_V4, burstLead: THREAT_BURST_AHEAD.burstLead});
   let saves = false;
   if (short?.rounds.lead_capacity != null) {
    out.flagged++;
    out.rounds.push(n);
    const only = {...short, missing: ['lead_capacity']};
    const {candidates, skipped} = lookup ? rebuild(r, lookup) : {candidates: [], skipped: 1};
    if (candidates.some(c => threatEffect(r.state, c, only, paths).adds.length)) out.with_answer++;
    // Saving for Lead capacity: revision 12's floor saves where revision 11's doesn't (leak pressure from the logged rules).
    if (lookup && !skipped && r.options?.length) {
     const context = {paths, pool: () => poolFor(r.state, lookup, offered), ...(r.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {pressure: {active: true}} : {})};
     const saving = x => x.constraint?.rules?.some(q => q.kind === 'threat_short' && q.saving != null);
     saves = saving(floorRulesV6(r.state, candidates, context)) && !saving(floorRulesV6(r.state, candidates, context, {threatKinds: THREAT_KINDS_V3}));
    }
   }
   if (saves) {
    out.saving++;
    stretch = stretch ? {...stretch, decisions: stretch.decisions + 1, to: n} : {decisions: 1, from: n, to: n};
    if (stretch.decisions > out.longest.decisions) out.longest = {...stretch, rounds: stretch.to - stretch.from + 1};
   } else stretch = null;
  }
  out.rounds = [...new Set(out.rounds)];
  return {rounds, flags: out};
 });
}

// The Lead-margin replay over runs [{name, records}]: per setup and bucket, rounds, runs, rounds with lives lost and runs
// with such a round; and the CHIMPS v6 flag counts.
export function leadStudy(runs, {lookup = harvest(runs)} = {}) {
 setTowerTable('current');
 const per = runs.map(({name, records}) => {
  const start = records.find(r => r.kind === 'run_start') ?? {}, match = modeOf(records), setup = setupOf(match);
  const paths = pathsFor(start.setup?.map ?? match.map);
  return {name, setup, policy: start.policy ?? '?', revision: start.policy_revision ?? null,
   ...leadRun(records, {paths, lookup, flags: setup === 'CHIMPS' && start.policy === 'btd6-jev-v6'})};
 }).filter(p => p.setup);
 const bucket = v => LEAD_BUCKETS.find(([, lo, hi]) => v >= lo && v < hi)[0];
 const table = setups => LEAD_BUCKETS.map(([label]) => {
  const rows = per.filter(p => setups.includes(p.setup)).flatMap(p => p.rounds.filter(x => bucket(x.lead) === label).map(x => ({...x, run: p.name})));
  const leaks = rows.filter(x => x.lost > 0);
  return {bucket: label, rounds: rows.length, runs: new Set(rows.map(x => x.run)).size, leak_rounds: leaks.length, leak_runs: new Set(leaks.map(x => x.run)).size,
   leaks: leaks.map(x => `${x.run.slice(0, 19)} r${x.round} (${x.lost})`)};
 });
 return {runs: per.length, by_setup: Object.fromEntries(['Hard Standard', 'CHIMPS'].map(k => [k, per.filter(p => p.setup === k).length])),
  buckets: {all: table(['Hard Standard', 'CHIMPS']), 'Hard Standard': table(['Hard Standard']), CHIMPS: table(['CHIMPS'])},
  flags: per.filter(p => p.flags).map(p => ({run: p.name, revision: p.revision, ...p.flags}))};
}

export function formatLead(s) {
 const out = [`Runs: ${s.runs} (Hard Standard ${s.by_setup['Hard Standard']}, CHIMPS ${s.by_setup.CHIMPS}). Lead rounds at their first decision state.`];
 for (const [k, rows] of Object.entries(s.buckets)) {
  out.push('', `${k}: Lead margin | rounds | runs | rounds with lives lost | runs with such a round`);
  for (const b of rows) out.push([b.bucket, b.rounds, b.runs, b.leak_rounds, b.leak_runs].join(' | '));
 }
 out.push('', 'Leaking Lead rounds (run r round (lives lost)), by bucket:');
 for (const b of s.buckets.all) if (b.leaks.length) out.push(`${b.bucket}: ${b.leaks.join(', ')}`);
 out.push('', 'CHIMPS btd6-jev-v6 logs: run | revision | decisions | lead_capacity due | of those, with an affordable answer | saving for Lead capacity | longest saving stretch (decisions, rounds) | rounds due');
 for (const f of s.flags) out.push([f.run.slice(0, 19), f.revision, f.decisions, f.flagged, f.with_answer, f.saving,
  f.longest.decisions ? `${f.longest.decisions}, ${f.longest.rounds} (r${f.longest.from}-${f.longest.to})` : '-', f.rounds.join(',')].join(' | '));
 return out.join('\n');
}

export const MODEL_BUCKETS = [['<0.5', -Infinity, 0.5], ['0.5-1', 0.5, 1], ['1-1.5', 1, 1.5], ['1.5-2', 1.5, 2], ['2-4', 2, 4], ['>=4', 4, Infinity]];
export const FIGURES = ['today', 'a', 'b', 'c'];
export const MODEL_LOSSES = [['2026-10-02T20-12-12', 33], ['2026-10-02T21-37-57', 37], ['2026-10-02T21-28-24', 78]];
export const BINDING_ROUNDS = [6, 80];

// One run: {rounds: [{round, lost, lost_from, figures, camo_tower_pops, camo_tower_est, camo_near_exit}], losses: {round: [{at, figures}]},
// binding: {decisions, due, only (due, today not), not (today due, this not)} per figure, or null}.
export function modelsRun(records, {paths = [], losses = [], binding = false} = {}) {
 return withCalibration(sessionCalibration(records), () => {
  const firstState = new Map(), lastState = new Map(), popsRound = new Map();
  for (const r of records) {
   if (r.kind === 'pops_round' && Number.isFinite(r.round)) popsRound.set(r.round, r);
   if (!isDecision(r)) continue;
   const n = r.state.round.number;
   if (!firstState.has(n)) firstState.set(n, r.state);
   lastState.set(n, r.state);
  }
  const camoTower = t => towerEstimate({base_id: t.base_id, tiers: t.tiers})?.camo === true;
  const rounds = roundsOf(records).filter(x => hasCamo(x.round) && firstState.has(x.round)).map(x => {
   const s = firstState.get(x.round), p = popsRound.get(x.round), near = lastState.get(x.round)?.bloons?.nearest_exit;
   const towers = p?.towers?.filter(camoTower) ?? null, fromPops = Number.isFinite(p?.lives_lost);
   return {round: x.round, lost: fromPops ? p.lives_lost : x.lost, lost_from: fromPops ? 'pops_round' : 'roundsOf',
    figures: camoFigures(s.towers, x.round, {lives: s.lives, paths}),
    camo_tower_pops: towers ? towers.reduce((n, t) => n + (t.pops ?? 0), 0) : null,
    camo_tower_est: towers ? towers.reduce((n, t) => n + (t.est_reach ?? t.est ?? 0), 0) : null,
    camo_near_exit: Array.isArray(near) ? near.some(b => b.camo === true || /Camo/.test(b.type ?? '')) : null};
  });
  const lossOut = {};
  for (const n of losses) lossOut[n] = [n - 3, n - 2, n - 1, n].map(at => {
   const s = firstState.get(at);
   return {at, figures: s ? camoFigures(s.towers, n, {lives: s.lives, paths}) : null};
  });
  let bind = null;
  if (binding) {
   const zero = () => Object.fromEntries(FIGURES.map(k => [k, 0]));
   bind = {decisions: 0, due: zero(), only: zero(), not: zero()};
   for (const r of records) {
    if (!isDecision(r) || r.state.popup) continue;
    const s = r.state, n = s.round.number;
    if (n < BINDING_ROUNDS[0] || n > BINDING_ROUNDS[1]) continue;
    bind.decisions++;
    const last = Math.min(s.match?.end_round ?? 100, n + THREAT_LEAD_ROUNDS), due = Object.fromEntries(FIGURES.map(k => [k, false]));
    for (let k = n; k <= last; k++) {
     if (!hasCamo(k)) continue;
     const fig = camoFigures(s.towers, k, {lives: s.lives, paths});
     for (const f of FIGURES) if (fig[f] != null && fig[f] < CAMO_CAPACITY_AT) due[f] = true;
    }
    for (const f of FIGURES) { if (due[f]) bind.due[f]++; if (due[f] && !due.today) bind.only[f]++; if (!due[f] && due.today) bind.not[f]++; }
   }
  }
  return {rounds, losses: lossOut, binding: bind};
 });
}

// The camo-model replay over runs [{name, records}]: per setup and figure, bucket tables (rounds, rounds that lost lives);
// the losses' figures; the CHIMPS binding counts; nearest-exit counts.
export function modelsStudy(runs, {losses = MODEL_LOSSES} = {}) {
 setTowerTable('current');
 const per = runs.map(({name, records}) => {
  const start = records.find(r => r.kind === 'run_start') ?? {}, match = modeOf(records), setup = setupOf(match);
  const mine = losses.filter(([prefix]) => name.startsWith(prefix)).map(([, n]) => n);
  return {name, setup, policy: start.policy ?? '?', ...modelsRun(records, {paths: pathsFor(start.setup?.map ?? match.map), losses: mine, binding: setup === 'CHIMPS'})};
 }).filter(p => p.setup);
 const SETUPS = ['CHIMPS', 'Hard Standard'];
 const bucket = v => MODEL_BUCKETS.find(([, lo, hi]) => v >= lo && v < hi)[0];
 const table = (setup, f) => MODEL_BUCKETS.map(([label]) => {
  const rows = per.filter(p => p.setup === setup).flatMap(p => p.rounds.filter(x => x.figures?.[f] != null && bucket(x.figures[f]) === label));
  return {bucket: label, rounds: rows.length, lost: rows.filter(x => x.lost > 0).length};
 });
 const sum = key => Object.fromEntries(FIGURES.map(f => [f, per.reduce((n, p) => n + (p.binding?.[key][f] ?? 0), 0)]));
 const all = per.flatMap(p => p.rounds);
 const exits = lost => { const rows = all.filter(x => (x.lost > 0) === lost); return {rounds: rows.length, camo_near_exit: rows.filter(x => x.camo_near_exit === true).length, unknown: rows.filter(x => x.camo_near_exit == null).length}; };
 return {runs: per.length, by_setup: Object.fromEntries(SETUPS.map(k => [k, per.filter(p => p.setup === k).length])),
  camo_rounds: Object.fromEntries(SETUPS.map(k => [k, per.filter(p => p.setup === k).reduce((n, p) => n + p.rounds.length, 0)])),
  buckets: Object.fromEntries(SETUPS.map(k => [k, Object.fromEntries(FIGURES.map(f => [f, table(k, f)]))])),
  losses: per.flatMap(p => Object.entries(p.losses).map(([n, list]) => ({run: p.name, round: Number(n), lost: p.rounds.find(x => x.round === Number(n))?.lost ?? null, list}))),
  lost_rows: per.flatMap(p => p.rounds.filter(x => x.lost > 0).map(x => ({run: p.name, setup: p.setup, ...x}))),
  binding: {decisions: per.reduce((n, p) => n + (p.binding?.decisions ?? 0), 0), due: sum('due'), only: sum('only'), not: sum('not')},
  near_exit: {lost: exits(true), clean: exits(false)}, lost_from_roundsOf: all.filter(x => x.lost_from === 'roundsOf').length};
}

export function formatModels(s) {
 const f = v => v == null ? '-' : v;
 const out = [`Runs: ${s.runs} (Hard Standard ${s.by_setup['Hard Standard']}, CHIMPS ${s.by_setup.CHIMPS}); camo rounds at their first decision state: Hard Standard ${s.camo_rounds['Hard Standard']}, CHIMPS ${s.camo_rounds.CHIMPS}. Lives lost from pops_round (roundsOf for ${s.lost_from_roundsOf} rounds without one).`];
 for (const [setup, figs] of Object.entries(s.buckets)) {
  out.push('', `${setup}: bucket | ${FIGURES.map(k => `${k} rounds/lost`).join(' | ')}`);
  MODEL_BUCKETS.forEach(([label], i) => out.push([label, ...FIGURES.map(k => `${figs[k][i].rounds}/${figs[k][i].lost}`)].join(' | ')));
 }
 out.push('', 'Losses: run | round (lives lost) | at round | today | a | b | c | can_pop | needs | share | window s | round s');
 for (const l of s.losses) for (const x of l.list) { const g = x.figures;
  out.push([l.run.slice(0, 19), `r${l.round} (${f(l.lost)})`, x.at, ...(g ? [g.today, g.a, g.b, g.c, g.can_pop, g.needs, g.share, g.window, g.round_seconds] : ['no state'])].join(' | ')); }
 out.push('', "Camo rounds that lost lives: run | setup | round | lost | today | a | b | c | camo-capable towers' pops (any bloon) / their est | camo nearest exit at last decision");
 for (const x of s.lost_rows) out.push([x.run.slice(0, 19), x.setup, x.round, x.lost, f(x.figures?.today), f(x.figures?.a), f(x.figures?.b), f(x.figures?.c), `${f(x.camo_tower_pops)} / ${f(x.camo_tower_est)}`, f(x.camo_near_exit)].join(' | '));
 const e = s.near_exit;
 out.push('', `Camo bloon nearest the exit at the round's last decision: lost rounds ${e.lost.camo_near_exit} of ${e.lost.rounds} (unknown ${e.lost.unknown}); clean rounds ${e.clean.camo_near_exit} of ${e.clean.rounds} (unknown ${e.clean.unknown}).`);
 out.push('', `Binding, CHIMPS decision states in rounds ${BINDING_ROUNDS.join('-')}: ${s.binding.decisions}. figure | due | due, today not | today due, this not`);
 for (const k of FIGURES) out.push([k, s.binding.due[k], s.binding.only[k], s.binding.not[k]].join(' | '));
 return out.join('\n');
}

export function camoMain(argv, dir) {
 const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 if (argv.includes('--models')) {
  const runs = selectRuns(readRuns(dir), flag('--since') ?? '2026-09-30T10-00');
  if (!runs.length) { console.error('No run logs match.'); return 1; }
  const s = modelsStudy(runs);
  console.log(argv.includes('--json') ? JSON.stringify(s, null, 1) : formatModels(s));
  return 0;
 }
 if (argv.includes('--lead')) {
  const all = readRuns(dir), runs = selectRuns(all, flag('--since') ?? '2026-09-30T10-00');
  if (!runs.length) { console.error('No run logs match.'); return 1; }
  const s = leadStudy(runs, {lookup: harvest(all)});
  console.log(argv.includes('--json') ? JSON.stringify(s, null, 1) : formatLead(s));
  return 0;
 }
 const all = readRuns(dir), runs = selectRuns(all, flag('--since'));
 if (!runs.length) { console.error('No run logs match.'); return 1; }
 const thresholds = flag('--thresholds')?.split(',').map(Number) ?? CAMO_THRESHOLDS;
 const focus = {runs: (flag('--focus') ?? '2026-10-01T06-56,2026-10-01T07-18').split(','), from: 50, to: 56, round: Number(flag('--focus-round') ?? 56)};
 const s = camoStudy(runs, {lookup: harvest(all), thresholds, focus});
 if (argv.includes('--json')) { for (const t of s.thresholds) if (!argv.includes('--detail')) delete t.rows; console.log(JSON.stringify(s, null, 1)); }
 else console.log(formatCamo(s));
 return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), i = argv.indexOf('--dir');
 const dir = resolve(i >= 0 ? argv[i + 1] : join(dirname(fileURLToPath(import.meta.url)), '../../.private/btd6/runs'));
 process.exit(camoMain(argv, dir));
}
