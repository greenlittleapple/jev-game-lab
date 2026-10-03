// threat_short replay: rebuilds threat.mjs applyThreatShort's decision on each logged decision state (docs/ARCHITECTURE.md,
// "threat_short"). The logged options are every candidate before the rules (core/runner.mjs), and candidates are built only
// when affordable (candidates.mjs), so an option in the log was affordable at that decision.
//   npm run btd6:threat-replay                               (every run in .private/btd6/runs)
//   npm run btd6:threat-replay -- --runs 20-45-16 --rounds 24-28
//   npm run btd6:threat-replay -- --dir <folder> --json
//   npm run btd6:threat-replay -- --kinds v2 --current-era      (camo Lead and burst too, threat.mjs THREAT_KINDS_V2;
//                                                                runs of the current code only, hard-rounds.mjs currentEra)
//   npm run btd6:threat-replay -- --burst [--min-round 68] [--detail]
//                                (THREAT_BURST_AHEAD against revision 3's rule on the same states: burst flags, changed
//                                 decisions and each burst decision's gain-per-dollar answer against the cheapest; burstReplay)
//   npm run btd6:threat-replay -- --camo-capacity --current-era [--detail] [--runs 06-56,07-18]
//                                (THREAT_KINDS_V3 against the series 6 rule, THREAT_KINDS_V2, both with THREAT_BURST_AHEAD: the
//                                 decisions where camo_capacity decides, the waits it removes, its first answer; camoCapacityReplay)
//   npm run btd6:threat-replay -- --one-life-bind [--since 2026-10-01T20-19] [--mode Clicks] [--track]
//                                (btd6-jev-v6's floor rules with revision 10's cap and revision 11's, policy-v6.mjs applyTowerCap
//                                 bindUnderCap, on each rebuilt decision of the v6 logs: decisions left with only "Wait" while a
//                                 binding has an answer, and decisions where placements passed the cap; oneLifeBindReplay. No
//                                 track unless --track: the logged threat_short records of CHIMPS series 1f reproduce without it.
//                                 Leak pressure is read from the logged rules.)
//   npm run btd6:threat-replay -- --one-life-bind --stand-aside [--since 2026-10-01T20-19] [--mode Clicks] [--track]
//                                (revision 13's floor against revision 14's, applyTowerCap burstStandAside, with the DDT check on
//                                 as both run it: per log, the placement passes by binding kind, the burst stand-asides and the
//                                 decisions left with only "Wait"; standAsideReplay. Counts only.)
//   npm run btd6:threat-replay -- --lead-ddt [--since 2026-10-01T23-47] [--mode Clicks] [--no-track] [--rounds 92-95]
//                                (revision 14's Lead RBE, with DDTs, against revision 15's, without them (threat.mjs leadDdt), in
//                                 btd6-jev-v6's floor rules on each rebuilt decision of the v6 logs, with the run's MOAB and pops
//                                 calibration, the DDT check on and the saving pool of poolFor: per log, the decisions where
//                                 lead_capacity is due and the saving decisions (all, and those whose gap includes lead_capacity);
//                                 leadDdtReplay. Counts only. With the map's track by default: on series 1h match 2's rounds 90
//                                 to 95 it reproduces 132 of 142 logged rule lists, against 126 without; decisions the
//                                 runner didn't put through the rules (single_option, forced) are skipped.)
//   npm run btd6:threat-replay -- --moab-bind [--since 2026-10-01T20-19] [--mode Clicks] [--no-track] [--rounds 36-40]
//                                (revision 15 of btd6-jev-v6's floor rules against revision 16's moab_short binding, policy-v4.mjs
//                                 moabBinding, on each rebuilt decision of the v6 logs, with the run's MOAB and pops calibration
//                                 and the DDT check on, as both run: per log, the decisions where moab_short fires, those where
//                                 it binds, the logged choices the binding removes (and how many of them added no MOAB damage),
//                                 and those decisions' rounds; moabBindReplay. Counts only. Track and skipping as --lead-ddt.)
//   npm run btd6:threat-replay -- --moab-cutoff [--since 2026-10-01T20-19] [--runs a,b] [--out file.json]
//                                (revisions 16 and 17 of btd6-jev-v6's moab_short against revision 15, with one life: binding and
//                                 saving decisions and logged choices removed by the short round's ratio, and the decisions the
//                                 10-round DDT lead adds; moabCutoffReplay. Counts only. Track and skipping as --lead-ddt.)
//   npm run btd6:threat-replay -- --ddt-need [--since 2026-10-01T20-19] [--mode Clicks|Standard] [--calibration <dir>] [--tables a,b] [--without nearest|best] [--saving-only] [--out file.json]
//                                (revision 18 of btd6-jev-v6 against revision 20's support-effects DDT figure and deadline-based
//                                 need and nearest-round target (and 20 without it): binding, saving, pass-only and capacity
//                                 decisions, option sets that differ, decisions the nearest round moves, and for the
//                                 logs named in --tables the lowest DDT-round ratio per round from 80 and revision 20's MOAB answers
//                                 at the first decision of rounds 85 to 94 and the saving targets; ddtNeedReplay. From round 76 in
//                                 CHIMPS; zero-leak logs with one life, as the policy saw them.)
//   npm run btd6:threat-replay -- --ddt-reach [--since 2026-10-01T20-19] [--mode Clicks|Standard] [--zero-leak] [--calibration <dir>] [--firsts name,...] [--out file.json]
//                                (revision 21 of btd6-jev-v6 against revision 22's reachable DDT saving targets and same-round
//                                 capacity answers: per round band (CAMO_BANDS) the decisions, saving decisions per revision,
//                                 option sets that differ and decisions where the same-round answers were kept; revision 22's
//                                 saving targets (cost, gain, round, expected cash); for the logs named in --firsts, revision
//                                 22 at the first decision of rounds 85 to 93; ddtReachReplay. As --camo-rate otherwise.)
//   npm run btd6:threat-replay -- --camo-rate [--since 2026-10-01T20-19] [--mode Clicks|Standard] [--zero-leak] [--calibration <dir>] [--losses name:round,...] [--out file.json]
//                                (revision 20 of btd6-jev-v6 against revision 21's camo_capacity on the camo rate, threat.mjs
//                                 camoRate: per log and round band (CAMO_BANDS) the decisions with camo_capacity due and those
//                                 where its binding acted, and the option sets that differ; for each --losses entry, at the
//                                 first decision of the 3 rounds before the loss round, revision 21's camo_capacity round, rate
//                                 and margin and its camo answers; camoRateReplay. Revision 20's DDT setters on for both;
//                                 --zero-leak: only zero-leak logs, as the policy saw them, else only logs without it.)
// Rebuilt from the log: a placement's spot position from the place commands chosen in the logs read (spots never placed
// on have no position and are skipped), an upgrade's tiers from the tower in the state, and costs from the chosen labels
// ("... ($270)") for the ordering; purchases whose cost no log shows sort last among equals. The saving part needs the
// purchases that weren't affordable: the replay offers the next tier of each tower and each tower the run ever offered
// at each free known spot, at the costs the logs show (those without a known cost are left out).
// Saving is judged on the logged cash; "cash if saved" adds back what the purchases chosen at the earlier saving
// decisions of the same gap cost, as an estimate of the cash the rule would have kept. Paths: Monkey Meadow's
// track from fixtures/monkey-meadow.json for map Tutorial (moab-replay.mjs pathsFor).
import {writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyThreatShort, threatShort, burstPerDollar, camoPerDollar, THREAT_KINDS, THREAT_KINDS_V2, THREAT_KINDS_V3, THREAT_KINDS_V4, THREAT_BURST_AHEAD, THREAT_OPTIONS_R21, LEAD_CAPACITY_AT_R12} from './threat.mjs';
import {withMoab, moabShort, DDT_GAP_SHARE} from './policy-v4.mjs';
import {applyTowerCap, floorRulesV6} from './policy-v6.mjs';
import {setDdtCheck, setMoabCalibration, setMoabDdtLead, setDdtSupport, setDdtNeed, moabDue, hasDdtRound, MOAB_LEAD_ROUNDS, MOAB_DDT_LEAD_ROUNDS} from './moab.mjs';
import {setPopsCalibration} from './estimate.mjs';
import {currentEra} from './hard-rounds.mjs';
import {zeroLeakView} from './zero-leak.mjs';
import {nextTierAllowed} from './candidates.mjs';
import {pathsFor} from './moab-replay.mjs';
import {roundsOf} from './pops-calibration.mjs';
import {readRuns} from './rules-audit.mjs';

const costOf = label => { const m = /\(\$(\d+)\)\s*$/.exec(label ?? ''); return m ? Number(m[1]) : null; };
const upgradeKey = (tower, tiers) => `${tower}:${tiers}`;
// An upgrade's cost depends on its path and the tier it reaches, not on the other paths' tiers: the key for that (from the
// lead_capacity work; the tiers-after key alone gave the Wizard's 1-0-0 to 1-1-0 the $190 of 0-1-0 to 1-1-0).
const tierKey = (tower, path, tiers) => `${tower}:p${path}:${String(tiers).split('-')[path - 1]}`;
const upgradeCost = (costs, diff, tower, path, after) => costs.get(`${diff}|upgrade:${tierKey(tower, path, after)}`) ?? costs.get(`${diff}|upgrade:${upgradeKey(tower, after)}`);

// Spot positions and costs from the chosen actions of the given runs: {spots: Map(spot -> {x, y}), costs: Map(key -> cost)}.
// Keys: place:<tower>, upgrade:<tower>:<tiers after>, per difficulty ("Hard|...").
// targets (--ddt-reach): also the upgrade costs of the logged saving targets (moab_short and threat_short records' for and
// saving), for upgrades no run bought, such as the $34,560 Sniper tiers that series 1l saved for.
export function harvest(runs, {targets = false} = {}) {
 const spots = new Map(), costs = new Map();
 for (const {records} of runs) for (const r of records) {
  if (targets && r.kind === 'decision' && r.state?.towers) for (const q of r.constraint?.rules ?? []) {
   const m = q.saving != null && /^upgrade:(\d+):p(\d)$/.exec(q.for ?? ''), t = m && r.state.towers.find(x => String(x.id) === m[1]);
   if (!t || !Array.isArray(t.tiers)) continue;
   const path = Number(m[2]), after = t.tiers.map((v, i) => i === path - 1 ? v + 1 : v).join('-'), key = `${r.state.match?.difficulty ?? ''}|upgrade:${tierKey(t.base_id, path, after)}`;
   if (!costs.has(key)) costs.set(key, q.saving);
  }
  if (r.kind !== 'decision' || !r.chosen?.command) continue;
  const c = r.chosen, cmd = c.command, diff = r.state?.match?.difficulty ?? '';
  if (cmd.action === 'place_tower') {
   const spot = /@(.+)$/.exec(c.id)?.[1];
   if (spot && !spots.has(spot)) spots.set(spot, {x: cmd.x, y: cmd.y});
   const cost = costOf(c.label);
   if (cost != null) costs.set(`${diff}|place:${cmd.tower}`, cost);
  } else if (cmd.action === 'upgrade_tower') {
   const m = /^Upgrade (\S+) #\d+ to (\S+)/.exec(c.label ?? ''), cost = costOf(c.label);
   if (m && cost != null) {
    costs.set(`${diff}|upgrade:${upgradeKey(m[1], m[2])}`, cost);
    if (Number.isInteger(cmd.path)) costs.set(`${diff}|upgrade:${tierKey(m[1], cmd.path + 1, m[2])}`, cost);
   }
  }
 }
 return {spots, costs};
}

// The candidates of one logged decision, rebuilt from its option IDs. Options that can't be rebuilt are left out.
export function rebuild(record, {spots, costs}) {
 const s = record.state, diff = s.match?.difficulty ?? '', cash = Math.floor(s.cash ?? 0), out = [];
 let skipped = 0;
 for (const id of record.options ?? []) {
  if (id === 'wait') { out.push({id, details: {kind: 'wait'}}); continue; }
  if (id === 'start_round') { out.push({id, details: {kind: 'start_round'}}); continue; }
  const place = /^place:([^@]+)@(.+)$/.exec(id);
  if (place) {
   const at = spots.get(place[2]);
   if (!at) { skipped++; continue; }
   const cost = costs.get(`${diff}|place:${place[1]}`);
   out.push({id, command: {action: 'place_tower', tower: place[1], x: at.x, y: at.y},
    details: {kind: 'place', tower: place[1], spot: place[2], ...(cost != null ? {cost, cash_after: cash - cost} : {})}});
   continue;
  }
  const up = /^upgrade:(\d+):p(\d)$/.exec(id);
  const t = up && s.towers.find(x => String(x.id) === up[1]);
  if (!t || !Array.isArray(t.tiers)) { skipped++; continue; }
  const path = Number(up[2]), after = t.tiers.map((v, i) => i === path - 1 ? v + 1 : v).join('-');
  const cost = upgradeCost(costs, diff, t.base_id, path, after);
  out.push({id, command: {action: 'upgrade_tower', tower_id: t.id, path: path - 1},
   details: {kind: 'upgrade', tower_id: t.id, tower: t.base_id, path, tiers_before: t.tiers.join('-'), tiers_after: after, ...(cost != null ? {cost, cash_after: cash - cost} : {})}});
 }
 return {candidates: out, skipped};
}

// The purchases at any cash for one logged decision (the saving pool): the next tier on each path of each tower, and a
// placement of each tower in offered (the towers the run offered) at each known spot no tower stands on.
export function poolFor(state, {spots, costs}, offered) {
 const diff = state.match?.difficulty ?? '', out = [];
 const taken = new Set(state.towers.map(t => `${t.x},${t.y}`));
 for (const tower of offered) {
  const cost = costs.get(`${diff}|place:${tower}`);
  if (cost == null) continue;
  for (const [spot, at] of spots) if (!taken.has(`${at.x},${at.y}`)) out.push({id: `place:${tower}@${spot}`, command: {action: 'place_tower', tower, x: at.x, y: at.y}, details: {kind: 'place', tower, spot, cost}});
 }
 for (const t of state.towers) {
  if (t.is_hero || !Array.isArray(t.tiers)) continue;
  for (const path of [1, 2, 3]) {
   if (!nextTierAllowed(t.tiers, path)) continue;
   const after = t.tiers.map((v, i) => i === path - 1 ? v + 1 : v).join('-'), cost = upgradeCost(costs, diff, t.base_id, path, after);
   if (cost != null) out.push({id: `upgrade:${t.id}:p${path}`, command: {action: 'upgrade_tower', tower_id: t.id, path: path - 1},
    details: {kind: 'upgrade', tower_id: t.id, tower: t.base_id, path, tiers_before: t.tiers.join('-'), tiers_after: after, cost}});
  }
 }
 return out;
}

// One run's decisions with a Lead or camo gap within the lead time: [{round, cash, lives, missing, rounds, fired, adders,
// first, removed, chosen, chosen_adds, logged}]. fired: an adding purchase was on offer (the rule would apply); chosen_adds:
// the logged choice was one of the adders; logged: the log already has threat_short.
export function replayRun(records, lookup, {paths = [], from = -Infinity, to = Infinity, kinds = THREAT_KINDS} = {}) {
 const out = [];
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 let gapKey = null, spent = 0;
 for (const r of records) {
  if (r.kind !== 'decision' || !r.state?.in_game || !r.state.round || !Array.isArray(r.state.towers) || !r.options) continue;
  const n = r.state.round.number;
  if (n < from || n > to) continue;
  const short = threatShort(r.state, paths, {kinds});
  if (!short) continue;
  const {candidates, skipped} = rebuild(r, lookup);
  const {rule, candidates: kept} = applyThreatShort(r.state, candidates, {paths, kinds, pool: () => poolFor(r.state, lookup, offered)});
  const adders = rule?.saving ? [] : kept.filter(c => c.details?.threat?.length);
  const key = JSON.stringify(short.rounds);
  if (key !== gapKey) { gapKey = key; spent = 0; }
  const cashIfSaved = Math.floor(r.state.cash) + spent;
  const bought = ['queued', 'executed'].includes(r.outcome) && /^(place|upgrade):/.test(r.chosen?.id ?? '') ? costOf(r.chosen.label) ?? 0 : 0;
  if (rule?.saving) spent += bought;
  out.push({round: n, cash: Math.floor(r.state.cash), lives: r.state.lives, missing: short.missing, rounds: short.rounds, fired: Boolean(rule) && !rule.saving, saving: rule?.saving ?? null, saving_for: rule?.for ?? null, cash_if_saved: cashIfSaved,
   adders: adders.map(c => `${c.id}${c.details.cost != null ? ` $${c.details.cost}` : ''} +${c.details.threat.join('+')}`), first: rule?.saving ? null : rule?.first ?? null,
   removed: rule?.removed ?? 0, skipped, chosen: r.chosen?.id ?? null, chosen_adds: adders.some(c => c.id === r.chosen?.id),
   logged: (r.constraint?.rules ?? []).some(x => x.kind === 'threat_short')});
 }
 return out;
}

// Totals per run: decisions with a gap, those where the rule fires, rounds of each, and the lives lost in the gap rounds.
export function summarize(name, records, rows) {
 const lost = new Map(roundsOf(records).map(x => [x.round, x.lost]));
 const rounds = rows => [...new Set(rows.map(r => r.round))];
 const gapRounds = rounds(rows);
 const reached = rows.find(r => r.saving != null && r.cash_if_saved >= r.saving);
 return {run: name, gap_decisions: rows.length, fired: rows.filter(r => r.fired).length, saving: rows.filter(r => r.saving != null).length,
  neither: rows.filter(r => !r.fired && r.saving == null).length, saved_answer_at: reached ? {round: reached.round, cash: reached.cash_if_saved, for: reached.saving_for, cost: reached.saving} : null,
  gap_rounds: gapRounds, fired_rounds: rounds(rows.filter(r => r.fired)), chosen_adds: rows.filter(r => r.chosen_adds).length,
  missing: [...new Set(rows.flatMap(r => r.missing))], lost_in_gap_rounds: gapRounds.reduce((n, x) => n + (lost.get(x) ?? 0), 0)};
}

// runs: [{name, records}], lookup from harvest (defaults to all the runs given). Returns [{summary, rows}].
export function replayRuns(runs, {lookup = harvest(runs), from, to, kinds} = {}) {
 return runs.map(({name, records}) => {
  const start = records.find(r => r.kind === 'run_start') ?? {};
  const map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
  const rows = replayRun(records, lookup, {paths: pathsFor(map), from, to, kinds});
  return {summary: {...summarize(name, records, rows), policy: start.policy ?? null, revision: start.policy_revision ?? null, ruleset: start.ruleset?.id ?? null}, rows};
 });
}

// The burst look-ahead (THREAT_BURST_AHEAD) against revision 3's rule (THREAT_KINDS_V2, 3 rounds, pops per dollar) on each
// logged decision of one run. Both see the same rebuilt options (purchases without a known cost left out, so the per-dollar
// orders have figures), the same moabFirst (moab_short with a MOAB-damage purchase on offer, policy-v4.mjs) and leak pressure
// where the decision logged it; the v3 rules that run before them in the floor (no_wait_behind and others) are not rebuilt.
// Returns {flags, rows}. flags: per round burst is due under the new rule, the first decision round flagging it, the ratio
// there and the decisions flagging it. rows: the decisions where the two rules differ or the new one fires with burst-only
// answers. change: 'wait_removed' (the new rule removes a "Wait" the old kept), 'forced' (the new rule puts answers first
// where the old didn't fire, with no "Wait" on offer), 'saving' (the new rule saves where the old didn't), 'order' (both
// fire, with a different first answer) or 'same'.
export function burstReplay(records, lookup, {paths = [], from = -Infinity, to = Infinity} = {}) {
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 const flags = new Map(), rows = [];
 const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';
 const fires = x => Boolean(x.rule) && x.rule.saving == null;
 const hasWait = list => list.some(c => c.id === 'wait');
 const burstOnly = c => c.details?.threat?.length > 0 && c.details.threat.every(k => k === 'burst');
 const brief = c => c ? {id: c.id, cost: c.details.cost ?? null, gain: c.details.burst_gain ?? null, gain_per_k: burstPerDollar(c) != null ? +(1000 * burstPerDollar(c)).toFixed(4) : null} : null;
 const said = rule => rule ? (rule.saving != null ? `saves for ${rule.for}` : `first ${rule.first}`) : null;
 for (const r of records) {
  if (r.kind !== 'decision' || !r.state?.in_game || !r.state.round || !Array.isArray(r.state.towers) || !r.options) continue;
  const n = r.state.round.number;
  if (n < from || n > to) continue;
  const newShort = threatShort(r.state, paths, {kinds: THREAT_KINDS_V2, burstLead: THREAT_BURST_AHEAD.burstLead});
  const oldShort = threatShort(r.state, paths, {kinds: THREAT_KINDS_V2});
  if (!newShort && !oldShort) continue;
  if (newShort?.rounds.burst != null) {
   const due = newShort.rounds.burst;
   if (!flags.has(due)) flags.set(due, {due, from_round: n, ratio: newShort.ratios.burst, decisions: 0});
   flags.get(due).decisions++;
  }
  const rebuilt = rebuild(r, lookup).candidates, candidates = rebuilt.filter(c => !spends(c) || c.details.cost != null);
  const pressure = (r.constraint?.rules ?? []).some(x => x.kind === 'leak_pressure') ? {active: true} : null;
  const moabFirst = Boolean(moabShort(r.state, paths)) && withMoab(r.state, candidates, paths).some(c => spends(c) && (c.details.moab ?? 0) > 0);
  const opts = {paths, kinds: THREAT_KINDS_V2, moabFirst, pressure, pool: () => poolFor(r.state, lookup, offered)};
  const old = applyThreatShort(r.state, candidates, opts), neu = applyThreatShort(r.state, candidates, {...opts, ...THREAT_BURST_AHEAD});
  let change = 'same';
  if (neu.rule?.saving != null && old.rule?.saving == null) change = 'saving';
  else if (fires(neu) && !fires(old)) change = hasWait(candidates) && hasWait(old.candidates) && !hasWait(neu.candidates) ? 'wait_removed' : 'forced';
  else if (fires(neu) && fires(old) && neu.rule.first !== old.rule.first) change = 'order';
  const burstAdders = fires(neu) ? neu.candidates.filter(burstOnly) : [];
  if (change === 'same' && !burstAdders.length) continue;
  const cheapest = [...burstAdders].sort((a, b) => a.details.cost - b.details.cost)[0];
  rows.push({round: n, cash: Math.floor(r.state.cash), due: newShort?.rounds.burst ?? null, ratio: newShort?.ratios?.burst ?? null, change, old: said(old.rule), new: said(neu.rule),
   first: brief(burstAdders[0]), cheapest: brief(cheapest), old_first: fires(old) ? brief(old.candidates.find(c => c.id === old.rule.first)) : null,
   burst_adders: burstAdders.length, chosen: r.chosen?.id ?? null, dropped_no_cost: rebuilt.length - candidates.length});
 }
 return {flags: [...flags.values()].sort((a, b) => a.due - b.due), rows};
}

// camo_capacity (THREAT_KINDS_V3) against the series 6 rule (THREAT_KINDS_V2), both with THREAT_BURST_AHEAD, on each logged
// decision of one run, with the same rebuilt options, moabFirst and leak pressure as burstReplay. Data only. Returns {flagged,
// suppressed, rows}: flagged, the decisions where camo_capacity is due; suppressed, those of them where moab_short's MOAB-damage
// purchases come first (moabFirst) and only rate kinds (camo capacity, burst) are short, so the options stay; rows, the decisions
// where camo_capacity decides (the new rule fires and its first answer adds camo capacity and no check kind). change:
// 'wait_removed' (a "Wait" the old rule kept is removed), 'forced' (answers put first where the old rule didn't fire, no "Wait"
// on offer), 'order' (both fire, with a different first answer) or 'same'; first: the answer put first, its cost and camo gain;
// after_cap: the first camo answer left after v6's tower cap (policy-v6.mjs applyTowerCap, no on-plan exemption), or null.
export function camoCapacityReplay(records, lookup, {paths = [], from = -Infinity, to = Infinity} = {}) {
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 const rows = [];
 let flagged = 0, suppressed = 0;
 const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';
 const fires = x => Boolean(x.rule) && x.rule.saving == null;
 const hasWait = list => list.some(c => c.id === 'wait');
 const rate = k => ['camo_capacity', 'burst'].includes(k);
 const checkKind = c => (c.details?.threat ?? []).some(k => !rate(k));
 for (const r of records) {
  if (r.kind !== 'decision' || !r.state?.in_game || !r.state.round || !Array.isArray(r.state.towers) || !r.options) continue;
  const n = r.state.round.number;
  if (n < from || n > to) continue;
  const short = threatShort(r.state, paths, {kinds: THREAT_KINDS_V3, burstLead: THREAT_BURST_AHEAD.burstLead});
  if (short?.rounds.camo_capacity == null) continue;
  flagged++;
  const rebuilt = rebuild(r, lookup).candidates, candidates = rebuilt.filter(c => !spends(c) || c.details.cost != null);
  const pressure = (r.constraint?.rules ?? []).some(x => x.kind === 'leak_pressure') ? {active: true} : null;
  const moabFirst = Boolean(moabShort(r.state, paths)) && withMoab(r.state, candidates, paths).some(c => spends(c) && (c.details.moab ?? 0) > 0);
  if (moabFirst && short.missing.every(rate)) suppressed++;
  const opts = {paths, moabFirst, pressure, pool: () => poolFor(r.state, lookup, offered), ...THREAT_BURST_AHEAD};
  const old = applyThreatShort(r.state, candidates, {...opts, kinds: THREAT_KINDS_V2}), neu = applyThreatShort(r.state, candidates, {...opts, kinds: THREAT_KINDS_V3});
  const first = fires(neu) ? neu.candidates.find(c => c.id === neu.rule.first) : null;
  if (!first?.details.threat?.includes('camo_capacity') || checkKind(first)) continue;
  const capped = applyTowerCap(r.state, candidates, neu.candidates, [neu.rule]);
  const afterCap = (capped?.candidates ?? neu.candidates).find(c => c.details.threat?.includes('camo_capacity')) ?? null;
  const waitGone = hasWait(fires(old) ? old.candidates : candidates) && !hasWait(neu.candidates);
  const change = waitGone ? 'wait_removed' : !fires(old) ? 'forced' : old.rule.first !== neu.rule.first ? 'order' : 'same';
  rows.push({round: n, cash: Math.floor(r.state.cash), lives: r.state.lives, due: short.rounds.camo_capacity, camo_margin: short.ratios.camo_capacity, change,
   first: {id: first.id, cost: first.details.cost ?? null, camo_gain: first.details.camo_gain ?? null},
   after_cap: afterCap ? {id: afterCap.id, cost: afterCap.details.cost ?? null, camo_gain: afterCap.details.camo_gain ?? null} : null,
   answers: neu.candidates.filter(c => c.details.threat?.includes('camo_capacity')).length, old: old.rule ? (old.rule.saving != null ? `saves for ${old.rule.for}` : `first ${old.rule.first}`) : null,
   chosen: r.chosen?.id ?? null, dropped_no_cost: rebuilt.length - candidates.length});
 }
 return {flagged, suppressed, rows};
}

// Revisions 10 and 11 of btd6-jev-v6's floor rules on one run's decisions (--one-life-bind above). Decisions with an option
// that can't be rebuilt are counted in skipped and left out. same_rules: decisions whose revision-10 rule kinds match the log.
export function oneLifeBindReplay(records, lookup, {paths = []} = {}) {
 const out = {decisions: 0, skipped: 0, same_rules: 0, r10: {wait_only_bound: 0, placements_passed: 0, placement_pass: 0}, r11: {wait_only_bound: 0, placements_passed: 0, placement_pass: 0}, rounds: {r10: [], r11: []}};
 const kinds = c => (c?.rules ?? []).filter(q => q.kind !== 'majority_wait').map(q => q.kind).join(',');
 for (const d of records) {
  if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length) continue;
  const {candidates, skipped} = rebuild(d, lookup);
  if (skipped) { out.skipped++; continue; }
  out.decisions++;
  const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
  for (const [key, bindUnderCap] of [['r10', false], ['r11', true]]) {
   const r = floorRulesV6(d.state, candidates, {paths, pressure}, {bindUnderCap});
   const rules = r.constraint?.rules ?? [];
   if (key === 'r10' && kinds(r.constraint) === kinds(d.constraint)) out.same_rules++;
   const bound = rules.some(q => q.binding === true && q.kept?.length > 0);
   if (bound && r.candidates.length === 1 && r.candidates[0].details?.kind === 'wait') { out[key].wait_only_bound++; out.rounds[key].push(d.state.round.number); }
   if (rules.some(q => q.kind === 'tower_cap_exception') && r.candidates.some(c => c.details?.kind === 'place')) out[key].placements_passed++;
   if (rules.some(q => q.placement_pass)) out[key].placement_pass++;
  }
 }
 out.rounds = {r10: [...new Set(out.rounds.r10)], r11: [...new Set(out.rounds.r11)]};
 return out;
}

// Revisions 13 and 14 of btd6-jev-v6's floor rules on one run's decisions (--one-life-bind --stand-aside above): for each,
// placement_pass: the decisions where a binding's placements passed the cap, by binding kind; stand_aside: the decisions
// where a burst binding stepped aside; wait_only: the decisions left with only "Wait", and wait_only_offered those of them
// whose options held a purchase. Rebuild as oneLifeBindReplay.
export function standAsideReplay(records, lookup, {paths = []} = {}) {
 const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';
 const blank = () => ({placement_pass: {}, stand_aside: 0, wait_only: 0, wait_only_offered: 0});
 const out = {decisions: 0, skipped: 0, r13: blank(), r14: blank()};
 for (const d of records) {
  if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length) continue;
  const {candidates, skipped} = rebuild(d, lookup);
  if (skipped) { out.skipped++; continue; }
  out.decisions++;
  const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
  for (const [key, burstStandAside] of [['r13', false], ['r14', true]]) {
   const r = floorRulesV6(d.state, candidates, {paths, pressure}, {burstStandAside});
   const rules = r.constraint?.rules ?? [], o = out[key];
   if (rules.some(q => q.placement_pass)) {
    const binding = [...rules].reverse().find(q => q.binding === true);
    const kind = binding?.kind === 'early_short' ? 'early_short' : binding?.binding_kind ?? '?';
    o.placement_pass[kind] = (o.placement_pass[kind] ?? 0) + 1;
   }
   if (rules.some(q => q.burst_stand_aside)) o.stand_aside++;
   if (r.candidates.length === 1 && r.candidates[0].details?.kind === 'wait') { o.wait_only++; if (candidates.some(spends)) o.wait_only_offered++; }
  }
 }
 return out;
}

// Revisions 14 and 15 of btd6-jev-v6's floor rules on one run's decisions (--lead-ddt above): for each, lead_due: the
// decisions where threatShort has lead_capacity due; saving: the decisions where threat_short saves, and saving_lead those
// whose gap includes lead_capacity; rounds: the rounds of those saving decisions. Rebuild as oneLifeBindReplay, with
// poolFor's saving pool as replayRun.
export function leadDdtReplay(records, lookup, {paths = [], from = -Infinity, to = Infinity} = {}) {
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 const blank = () => ({lead_due: 0, saving: 0, saving_lead: 0, rounds: []});
 const out = {decisions: 0, skipped: 0, r14: blank(), r15: blank()};
 for (const d of records) {
  if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length || !d.state.round) continue;
  if (d.decisionSource === 'single_option' || d.decisionSource === 'forced') continue;
  const n = d.state.round.number;
  if (n < from || n > to) continue;
  const {candidates, skipped} = rebuild(d, lookup);
  if (skipped) { out.skipped++; continue; }
  out.decisions++;
  const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
  for (const [key, leadDdt] of [['r14', true], ['r15', false]]) {
   const o = out[key];
   if ('lead_capacity' in (threatShort(d.state, paths, {kinds: THREAT_KINDS_V4, ...THREAT_BURST_AHEAD, leadDdt})?.rounds ?? {})) o.lead_due++;
   const r = floorRulesV6(d.state, candidates, {paths, pressure, pool: () => poolFor(d.state, lookup, offered)}, {threatOptions: {...THREAT_BURST_AHEAD, leadDdt}});
   const rule = (r.constraint?.rules ?? []).find(q => q.kind === 'threat_short');
   if (rule?.saving != null) { o.saving++; if (rule.missing.includes('lead_capacity')) o.saving_lead++; o.rounds.push(n); }
  }
 }
 for (const key of ['r14', 'r15']) out[key].rounds = [...new Set(out[key].rounds)];
 return out;
}

export function formatCamoCapacity(results, {detail = false} = {}) {
 const out = ['run | policy | decisions with camo_capacity due | of those, set aside by moabFirst | decisions where it decides | waits removed / forced (no wait offered) / other first answer / same | rounds where it decides'];
 const byPolicy = new Map();
 for (const {name, policy, flagged, suppressed, rows} of results) {
  const count = k => rows.filter(r => r.change === k).length;
  out.push([name, policy, flagged, suppressed, rows.length, `${count('wait_removed')} / ${count('forced')} / ${count('order')} / ${count('same')}`, [...new Set(rows.map(r => r.round))].join(',') || '-'].join(' | '));
  const p = byPolicy.get(policy) ?? {runs: 0, flagged: 0, suppressed: 0, acts: 0, waits: 0};
  Object.assign(p, {runs: p.runs + 1, flagged: p.flagged + flagged, suppressed: p.suppressed + suppressed, acts: p.acts + rows.length, waits: p.waits + count('wait_removed')});
  byPolicy.set(policy, p);
  if (detail) for (const r of rows) out.push(`  round ${r.round} $${r.cash} ${r.lives} lives, due ${r.due} (camo margin ${r.camo_margin}), ${r.change}: first ${r.first.id} $${r.first.cost} +${r.first.camo_gain} (${r.answers} answers; after the tower cap ${r.after_cap ? `${r.after_cap.id} $${r.after_cap.cost} +${r.after_cap.camo_gain}` : 'none'}); old rule ${r.old ?? 'none'}; chosen ${r.chosen}`);
 }
 out.push('', 'policy | runs | decisions with camo_capacity due | set aside by moabFirst | decisions where it decides | waits removed');
 for (const [policy, p] of byPolicy) out.push([policy, p.runs, p.flagged, p.suppressed, p.acts, p.waits].join(' | '));
 return out.join('\n');
}

export function formatBurst(results, {detail = false} = {}) {
 const out = ['run | policy | burst due: round (first flagged at, ratio there; decisions) | changed decisions: waits removed / answers forced / saving / other first answer | decisions with burst-only answers | of those, gain-per-dollar first is not the cheapest | summed over those decisions, first by gain per dollar: ratio gain for $ | cheapest first: ratio gain for $'];
 const sum = (list, k) => list.reduce((n, x) => n + (x?.[k] ?? 0), 0);
 for (const {name, policy, flags, rows} of results) {
  const count = k => rows.filter(r => r.change === k).length, burst = rows.filter(r => r.first);
  out.push([name, policy, flags.map(f => `${f.due} (r${f.from_round}, ${f.ratio}; ${f.decisions})`).join(', ') || '-',
   `${count('wait_removed')} / ${count('forced')} / ${count('saving')} / ${count('order')}`, burst.length, burst.filter(r => r.first.id !== r.cheapest.id).length,
   `+${sum(burst.map(r => r.first), 'gain').toFixed(3)} for $${sum(burst.map(r => r.first), 'cost')}`, `+${sum(burst.map(r => r.cheapest), 'gain').toFixed(3)} for $${sum(burst.map(r => r.cheapest), 'cost')}`].join(' | '));
  if (detail) for (const r of burst) out.push(`  round ${r.round} $${r.cash}, due ${r.due} (${r.ratio}), ${r.change}: by gain/$ ${r.first.id} $${r.first.cost} +${r.first.gain}; cheapest ${r.cheapest.id} $${r.cheapest.cost} +${r.cheapest.gain}; old rule ${r.old ?? 'none'}; chosen ${r.chosen}`);
 }
 return out.join('\n');
}

export function format(results, {detail = false} = {}) {
 const lines = ['run | policy | ruleset | decisions with a Lead/camo gap | answer on offer (first) | saving (all purchases removed) | neither | logged choice added it | gap rounds | rounds with an answer on offer | first saving decision whose cash if saved covers the answer | lives lost in gap rounds'];
 for (const {summary: s, rows} of results) {
  lines.push([s.run, `${s.policy ?? '?'}${s.revision != null ? ` r${s.revision}` : ''}`, s.ruleset ?? '-', s.gap_decisions, s.fired, s.saving, s.neither, s.chosen_adds,
   s.gap_rounds.join(',') || '-', s.fired_rounds.join(',') || '-', s.saved_answer_at ? `round ${s.saved_answer_at.round}, ${s.saved_answer_at.cash} for ${s.saved_answer_at.for} (${s.saved_answer_at.cost})` : '-', s.lost_in_gap_rounds].join(' | '));
  if (detail) for (const r of rows) lines.push(`  round ${r.round} $${r.cash} ${r.lives} lives, missing ${r.missing.map(k => `${k}@${r.rounds[k]}`).join(' ')}: ${r.fired ? `fires, first ${r.first}, removed ${r.removed}; adders ${r.adders.join(', ')}` : r.saving != null ? `saves for ${r.saving_for} (${r.saving}), cash if saved ${r.cash_if_saved}` : 'nothing adds it at a known cost'}; chosen ${r.chosen}${r.skipped ? ` (${r.skipped} options not rebuilt)` : ''}`);
 }
 return lines.join('\n');
}

// Revisions 15 and 16 of btd6-jev-v6's floor rules on one run's decisions (--moab-bind above): fires: decisions where
// revision 16 records moab_short; bound: where it binds; removed: where the logged choice is among revision 15's options and
// not among revision 16's, removed_no_moab those of them whose choice added no MOAB damage; rounds: the rounds of the
// removals. Rebuild and skipping as leadDdtReplay.
export function moabBindReplay(records, lookup, {paths = [], from = -Infinity, to = Infinity} = {}) {
 const out = {decisions: 0, skipped: 0, fires: 0, bound: 0, removed: 0, removed_no_moab: 0, rounds: []};
 for (const d of records) {
  if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length || !d.state.round) continue;
  if (d.decisionSource === 'single_option' || d.decisionSource === 'forced') continue;
  const n = d.state.round.number;
  if (n < from || n > to) continue;
  const {candidates, skipped} = rebuild(d, lookup);
  if (skipped) { out.skipped++; continue; }
  out.decisions++;
  // Without a short MOAB-class round within the lead moab_short can't fire under either revision.
  if (!moabShort(d.state, paths)) continue;
  const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
  const old = floorRulesV6(d.state, candidates, {paths, pressure}, R15_OPTIONS), neu = floorRulesV6(d.state, candidates, {paths, pressure}, R16_OPTIONS);
  const rule = (neu.constraint?.rules ?? []).find(q => q.kind === 'moab_short');
  if (!rule) continue;
  out.fires++;
  if (!rule.binding) continue;
  out.bound++;
  const chosen = d.chosen?.id, before = old.candidates.find(c => c.id === chosen);
  if (before && !neu.candidates.some(c => c.id === chosen)) {
   out.removed++;
   if (!(before.details?.moab > 0)) out.removed_no_moab++;
   out.rounds.push(n);
  }
 }
 out.rounds = [...new Set(out.rounds)];
 return out;
}

// Revisions 15, 16 and 17 of btd6-jev-v6's floor rules on one run's decisions (--moab-cutoff below), with poolFor's saving pool:
// per revision, by the short round's ratio (moabShort at that revision's DDT lead; MOAB_CUTOFF_BUCKETS), bound: decisions where
// moab_short binds; saved: where it saves (revision 17 only); removed: those of them where the logged choice is among revision
// 15's options and not among that revision's. lead10: decisions where the 10-round DDT lead finds a short round with DDTs that
// the 4-round lead doesn't (what the graded speed would add if it read revision 17's lead), and their rounds. Counts only.
export const MOAB_CUTOFF_BUCKETS = [['<0.25', 0.25], ['0.25-0.5', 0.5], ['0.5-0.75', 0.75], ['0.75-1', Infinity]];
const R16_OPTIONS = {moabBindBelow: Infinity, moabSaving: false, threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R12}};
const R15_OPTIONS = {...R16_OPTIONS, moabBinding: false};
export function moabCutoffReplay(records, lookup, {paths = [], from = -Infinity, to = Infinity} = {}) {
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 const blank = () => Object.fromEntries(MOAB_CUTOFF_BUCKETS.map(([k]) => [k, {bound: 0, saved: 0, removed: 0}]));
 const out = {decisions: 0, skipped: 0, r16: blank(), r17: blank(), lead10: 0, lead10_rounds: []};
 const bucket = ratio => MOAB_CUTOFF_BUCKETS.find(([, below]) => ratio < below)[0];
 for (const d of records) {
  if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length || !d.state.round) continue;
  if (d.decisionSource === 'single_option' || d.decisionSource === 'forced') continue;
  const n = d.state.round.number;
  if (n < from || n > to) continue;
  const {candidates, skipped} = rebuild(d, lookup);
  if (skipped) { out.skipped++; continue; }
  out.decisions++;
  if (!(d.state.lives <= 1)) continue;
  setMoabDdtLead(MOAB_LEAD_ROUNDS);
  const short4 = moabShort(d.state, paths);
  setMoabDdtLead(MOAB_DDT_LEAD_ROUNDS);
  const short10 = moabShort(d.state, paths);
  if (short10 && hasDdtRound(short10.round) && !(short4 && short4.round === short10.round)) { out.lead10++; out.lead10_rounds.push(n); }
  if (!short4 && !short10) continue;
  const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
  const context = {paths, pressure, pool: () => poolFor(d.state, lookup, offered)};
  setMoabDdtLead(MOAB_LEAD_ROUNDS);
  const old = floorRulesV6(d.state, candidates, context, R15_OPTIONS);
  const chosen = d.chosen?.id, kept = old.candidates.some(c => c.id === chosen);
  const runs = [['r16', short4, MOAB_LEAD_ROUNDS, R16_OPTIONS], ['r17', short10, MOAB_DDT_LEAD_ROUNDS, {}]];
  for (const [key, short, lead, opts] of runs) {
   if (!short) continue;
   setMoabDdtLead(lead);
   const r = floorRulesV6(d.state, candidates, context, opts), rule = (r.constraint?.rules ?? []).find(q => q.kind === 'moab_short');
   if (!rule || !(rule.binding || rule.saving != null)) continue;
   const o = out[key][bucket(short.ratio)];
   if (rule.binding) o.bound++; else o.saved++;
   if (kept && !r.candidates.some(c => c.id === chosen)) o.removed++;
  }
 }
 setMoabDdtLead(MOAB_LEAD_ROUNDS);
 out.lead10_rounds = [...new Set(out.lead10_rounds)];
 return out;
}

// btd6-jev-v6 revision 18 against revision 19 (policy-v4.mjs moabCapacity and ddtGapShare) on one run's decisions (--ddt-save
// below), with poolFor's saving pool and the 10-round DDT lead. Per revision: saving (moab_short saves), pass_only (only "Wait"
// and "Start round" left), capacity (moab_short kept camo or Lead capacity answers; revision 19 only); differ: decisions whose
// option sets differ. targets: each revision's saving targets {id, tiers, cost, gain, gap, share, decisions}, gain being the
// target's MOAB gain for the short round and share gain / gap. Counts only.
export const R18_OPTIONS = {moabCapacity: false, ddtGapShare: 0, moabNearest: false, ddtSaveBest: false, ddtReach: false, capacitySame: false};
export const R19_OPTIONS = {moabCapacity: true, ddtGapShare: DDT_GAP_SHARE, moabNearest: false, ddtSaveBest: false, ddtReach: false, capacitySame: false};
export function ddtSaveReplay(records, lookup, {paths = [], from = -Infinity, to = Infinity} = {}) {
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 const blank = () => ({saving: 0, pass_only: 0, capacity: 0, targets: new Map()});
 const out = {decisions: 0, skipped: 0, differ: 0, r18: blank(), r19: blank()};
 const isPass = c => c.details?.kind === 'wait' || c.details?.kind === 'start_round';
 setMoabDdtLead(MOAB_DDT_LEAD_ROUNDS);
 for (const d of records) {
  if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length || !d.state.round) continue;
  if (d.decisionSource === 'single_option' || d.decisionSource === 'forced') continue;
  const n = d.state.round.number;
  if (n < from || n > to) continue;
  const {candidates, skipped} = rebuild(d, lookup);
  if (skipped) { out.skipped++; continue; }
  out.decisions++;
  const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
  let pool = null;
  const context = {paths, pressure, pool: () => pool ??= poolFor(d.state, lookup, offered)};
  const results = {r18: floorRulesV6(d.state, candidates, context, R18_OPTIONS), r19: floorRulesV6(d.state, candidates, context, R19_OPTIONS)};
  const sets = Object.values(results).map(r => r.candidates.map(c => c.id).sort().join(','));
  if (sets[0] !== sets[1]) out.differ++;
  for (const [key, r] of Object.entries(results)) {
   const o = out[key], rule = (r.constraint?.rules ?? []).find(q => q.kind === 'moab_short');
   if (r.candidates.length && r.candidates.every(isPass)) o.pass_only++;
   if (rule?.kept_capacity) o.capacity++;
   if (rule?.saving == null) continue;
   o.saving++;
   const target = withMoab(d.state, context.pool().filter(c => c.id === rule.for), paths)[0];
   const gain = target?.details?.moab ?? null, gap = +(rule.needs_dps - rule.dps).toFixed(1);
   const k = `${rule.for} ${target?.details?.tiers_after ?? target?.details?.tower ?? ''}`;
   const t = o.targets.get(k) ?? {id: rule.for, tower: target?.details?.tower ?? null, tiers: target?.details?.tiers_after ?? null, cost: rule.saving, decisions: 0, gain, gap, share: null};
   t.decisions++; t.gain = gain; t.gap = gap; t.share = gain != null && gap > 0 ? +(gain / gap).toFixed(3) : null;
   o.targets.set(k, t);
  }
 }
 setMoabDdtLead(MOAB_LEAD_ROUNDS);
 for (const key of ['r18', 'r19']) out[key].targets = [...out[key].targets.values()];
 return out;
}

// btd6-jev-v6 revision 18 against revision 20 (moab.mjs setDdtSupport and setDdtNeed, policy-v4.mjs moabNearest, both on
// revision 18's moabCapacity and ddtGapShare) on one run's decisions (--ddt-need below), with poolFor's saving pool and the
// 10-round DDT lead; also revision 20 with the rule options in `without` (r20w; default moabNearest: false). tables: false skips ratios and answers. Revision 19 isn't run (its check is revision 18's; its rules are
// ddtSaveReplay's). zeroLeak: the policy's view with one life (zero-leak.mjs zeroLeakView). Per revision: binding (moab_short
// binds), saving, saving_rounds (rounds with a saving decision), pass_only and capacity as ddtSaveReplay; differ: decisions whose
// option sets differ between revisions 18 and 20; nearest: revision 20's binding and saving decisions whose round moabNearest
// moved off the weakest. targets: each revision's saving targets {round, id, cost, gain, gap, decisions, rounds}. ratios: per round from ratioFrom, the lowest
// ratio among the due rounds with DDTs (moabDue, 10-round lead) over the round's decisions and the due round that set it, per
// revision. answers: for rounds answersFrom to answersTo, at the round's first rebuilt decision, revision 20's first five
// options that add MOAB damage, one per tower, tiers and cost (tower, tiers, cost, gain in the check's figure for the round in
// focus, gain per $1,000), with whether moab_short binds and its round.
// Revision 18's rules on revision 20's floor (moabCapacity and ddtGapShare are already off by default).
// Revision 22's options off (policy-v4.mjs ddtReach, capacitySame): the replays written before it keep their revisions.
export const R22_OFF = {ddtReach: false, capacitySame: false};
export const R18_OPTIONS_V20 = {moabNearest: false, ddtSaveBest: false, ...R22_OFF};
const setRevision20 = on => { setDdtSupport(on); setDdtNeed(on); };
export function ddtNeedReplay(records, lookup, {paths = [], from = -Infinity, to = Infinity, ratioFrom = 80, answersFrom = 85, answersTo = 94, zeroLeak = false, without = {moabNearest: false}, tables = true} = {}) {
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 const blank = () => ({binding: 0, saving: 0, saving_rounds: [], pass_only: 0, capacity: 0, targets: new Map()});
 const out = {decisions: 0, skipped: 0, differ: 0, nearest: {binding: 0, saving: 0}, r18: blank(), r20w: blank(), r20: blank(), ratios: {}, answers: []};
 const isPass = c => c.details?.kind === 'wait' || c.details?.kind === 'start_round';
 const answered = new Set();
 setMoabDdtLead(MOAB_DDT_LEAD_ROUNDS);
 try {
  for (const d of records) {
   if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length || !d.state.round) continue;
   if (d.decisionSource === 'single_option' || d.decisionSource === 'forced') continue;
   const n = d.state.round.number;
   if (n < from || n > to) continue;
   const {candidates, skipped} = rebuild(d, lookup);
   if (skipped) { out.skipped++; continue; }
   out.decisions++;
   const state = zeroLeak ? zeroLeakView(d.state) : d.state;
   const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
   let pool = null;
   const context = {paths, pressure, pool: () => pool ??= poolFor(d.state, lookup, offered)};
   const results = {};
   for (const [key, on, opts] of [['r18', false, R18_OPTIONS_V20], ['r20w', true, {...R22_OFF, ...without}], ['r20', true, R22_OFF]]) {
    setRevision20(on);
    results[key] = floorRulesV6(state, candidates, context, opts);
    if (tables && n >= ratioFrom && key !== 'r20w') {
     const due = moabDue(state.towers, n, {lives: state.lives, paths, end: state.match?.end_round ?? 100, ddtLead: MOAB_DDT_LEAD_ROUNDS}).filter(c => hasDdtRound(c.round));
     const row = out.ratios[n] ??= {};
     if (due.length && (!row[key] || due[0].ratio < row[key].ratio)) row[key] = {ratio: due[0].ratio, due: due[0].round, needs: due[0].needs_dps, dps: due[0].dps};
    }
   }
   const ids = r => r.candidates.map(c => c.id).sort().join(',');
   if (ids(results.r18) !== ids(results.r20)) out.differ++;
   for (const [key, r] of Object.entries(results)) {
    const o = out[key], rule = (r.constraint?.rules ?? []).find(q => q.kind === 'moab_short');
    if (r.candidates.length && r.candidates.every(isPass)) o.pass_only++;
    if (rule?.binding) o.binding++;
    if (rule?.kept_capacity) o.capacity++;
    if (key === 'r20' && rule?.weakest != null) { if (rule.binding) out.nearest.binding++; if (rule.saving != null) out.nearest.saving++; }
    if (rule?.saving == null) continue;
    o.saving++;
    if (!o.saving_rounds.includes(n)) o.saving_rounds.push(n);
    const k = `${rule.round}|${rule.for}`;
    const t = o.targets.get(k) ?? {round: rule.round, id: rule.for, cost: rule.saving, gain: rule.gain ?? null, gap: rule.gap ?? null, decisions: 0, rounds: []};
    t.decisions++;
    if (!t.rounds.includes(n)) t.rounds.push(n);
    o.targets.set(k, t);
   }
   if (tables && n >= answersFrom && n <= answersTo && !answered.has(n)) {
    answered.add(n);
    const rule = (results.r20.constraint?.rules ?? []).find(q => q.kind === 'moab_short');
    out.answers.push({round: n, cash: Math.floor(state.cash), binding: rule?.binding === true, short: rule ? {round: rule.round, dps: rule.dps, needs: rule.needs_dps, weakest: rule.weakest ?? null} : null,
     top: [...new Map(results.r20.candidates.filter(c => (c.details?.moab ?? 0) > 0).map(c => [`${c.details.tower}|${c.details.tiers_after}|${c.details.cost}`, c])).values()].slice(0, 5)
      .map(c => ({tower: c.details.tower ?? c.id, tiers: c.details.tiers_after ?? (c.details.kind === 'place' ? '0-0-0' : null), kind: c.details.kind, cost: c.details.cost, gain: c.details.moab,
       per_1000: c.details.cost > 0 ? +(1000 * c.details.moab / c.details.cost).toFixed(2) : null}))});
   }
  }
 } finally { setRevision20(false); setMoabDdtLead(MOAB_LEAD_ROUNDS); }
 for (const key of ['r18', 'r20w', 'r20']) out[key].targets = [...out[key].targets.values()];
 return out;
}

// Revision 20 of btd6-jev-v6 against revision 21 (camo_capacity on the camo rate), on each rebuilt decision (no popup, not
// single-option or forced) with revision 20's DDT setters on for both, and revision 21 also without capacityNearer (21n).
// Per round band (CAMO_BANDS: [from, to]): decisions; due (threatShort with THREAT_KINDS_V4 has camo_capacity), binding
// (threat_short binds on camo_capacity) per revision; differ and differ_n (option sets after the floor differ from revision
// 20's, for 21 and 21n); bind21u and differ_u: revision 21 without the gap guard (camoBindShare: 0). Rebuilt purchases with
// no cost in the logs are left out as not affordable (no_cost counts them). losses: rounds; for each, at the first decision of each of the 3 rounds before,
// revision 21's camo_capacity round, rate and margin and its camo answers (most camo gain per dollar first, up to 5), and the
// number of decisions in those rounds with camo_capacity due. zeroLeak: the policy's view with one life.
export const CAMO_BANDS = [[6, 30], [31, 60], [61, 80], [81, 100]];
export function camoRateReplay(records, lookup, {paths = [], zeroLeak = false, losses = []} = {}) {
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 const band = n => CAMO_BANDS.find(([a, b]) => n >= a && n <= b);
 const out = {decisions: 0, skipped: 0, no_cost: 0, bands: Object.fromEntries(CAMO_BANDS.map(([a, b]) => [`${a}-${b}`, {decisions: 0, due20: 0, due21: 0, bind20: 0, bind21n: 0, bind21u: 0, bind21: 0, differ_n: 0, differ_u: 0, differ: 0}])), losses: []};
 const before = new Map(losses.flatMap(L => [L - 3, L - 2, L - 1].filter(n => n > 0).map(n => [n, L])));
 const seen = new Set(), lossRows = new Map(losses.map(L => [L, {round: L, due_decisions: 0, decisions: 0, first: []}]));
 const camoBinds = r => (r.constraint?.rules ?? []).some(q => q.kind === 'threat_short' && q.binding && q.binding_kind === 'camo_capacity');
 setDdtSupport(true); setDdtNeed(true); setMoabDdtLead(MOAB_DDT_LEAD_ROUNDS);
 try {
  for (const d of records) {
   if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length || !d.state.round) continue;
   if (d.decisionSource === 'single_option' || d.decisionSource === 'forced') continue;
   const n = d.state.round.number, b = band(n);
   if (!b && !before.has(n)) continue;
   const rebuilt = rebuild(d, lookup);
   if (rebuilt.skipped) { out.skipped++; continue; }
   out.decisions++;
   // Purchases whose cost no log shows (placements of towers never bought) count as not affordable: left out.
   const candidates = rebuilt.candidates.filter(c => !((c.details?.kind === 'place' || c.details?.kind === 'upgrade') && !Number.isFinite(c.details.cost)));
   out.no_cost += rebuilt.candidates.length - candidates.length;
   const state = zeroLeak ? zeroLeakView(d.state) : d.state;
   const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
   let pool = null;
   const context = {paths, pressure, pool: () => pool ??= poolFor(d.state, lookup, offered)};
   const r21u = floorRulesV6(state, candidates, context, {threatOptions: {...THREAT_OPTIONS_R21, camoBindShare: 0}, ...R22_OFF});
   const r20 = floorRulesV6(state, candidates, context, {threatOptions: THREAT_BURST_AHEAD, capacityNearer: false, ...R22_OFF});
   const r21n = floorRulesV6(state, candidates, context, {threatOptions: THREAT_OPTIONS_R21, capacityNearer: false, ...R22_OFF});
   const r21 = floorRulesV6(state, candidates, context, {threatOptions: THREAT_OPTIONS_R21, ...R22_OFF});
   const due = opts => 'camo_capacity' in (threatShort(state, paths, {kinds: THREAT_KINDS_V4, ...opts})?.rounds ?? {});
   const due21 = due(THREAT_OPTIONS_R21);
   if (b) {
    const o = out.bands[`${b[0]}-${b[1]}`];
    o.decisions++;
    if (due(THREAT_BURST_AHEAD)) o.due20++;
    if (due21) o.due21++;
    if (camoBinds(r20)) o.bind20++;
    if (camoBinds(r21n)) o.bind21n++;
    if (camoBinds(r21u)) o.bind21u++;
    if (camoBinds(r21)) o.bind21++;
    const ids = r => r.candidates.map(c => c.id).sort().join(',');
    if (ids(r20) !== ids(r21n)) o.differ_n++;
    if (ids(r20) !== ids(r21u)) o.differ_u++;
    if (ids(r20) !== ids(r21)) o.differ++;
   }
   if (!before.has(n)) continue;
   const row = lossRows.get(before.get(n));
   row.decisions++;
   if (due21) row.due_decisions++;
   if (seen.has(n)) continue;
   seen.add(n);
   const short = threatShort(state, paths, {kinds: THREAT_KINDS_V4, ...THREAT_OPTIONS_R21});
   const rule = (r21.constraint?.rules ?? []).find(q => q.kind === 'threat_short');
   const camo = 'camo_capacity' in (short?.rounds ?? {}) ? {round: short.rounds.camo_capacity, rate: short.ratios.camo_capacity, margin: short.camoMargin} : null;
   const answers = r21.candidates.filter(c => camoPerDollar(c) != null).sort((x, y) => camoPerDollar(y) - camoPerDollar(x)).slice(0, 5)
    .map(c => ({tower: c.details.tower ?? c.id, tiers: c.details.tiers_after ?? (c.details.kind === 'place' ? '0-0-0' : null), kind: c.details.kind, cost: c.details.cost, camo_gain: c.details.camo_gain}));
   row.first.push({round: n, cash: Math.floor(d.state.cash), camo, rules: (r21.constraint?.rules ?? []).map(q => q.kind + (q.binding_kind ? ':' + q.binding_kind : '')), rules_n: (r21n.constraint?.rules ?? []).map(q => q.kind), rules_u: (r21u.constraint?.rules ?? []).map(q => q.kind + ((q.binding_kind ?? '') ? ':' + q.binding_kind : '')), held: rule?.camo_bind_held ?? null, binding: rule?.binding === true ? rule.binding_kind : null, first: rule?.first ?? null, answers});
  }
 } finally { setDdtSupport(false); setDdtNeed(false); setMoabDdtLead(MOAB_LEAD_ROUNDS); }
 out.losses = [...lossRows.values()];
 return out;
}

// Revision 21 of btd6-jev-v6 against revision 22 (policy-v4.mjs ddtReach and capacitySame), on each rebuilt decision (no popup,
// not single-option or forced) with revision 20's DDT setters on for both, as camoRateReplay. Per round band: decisions, saving21
// and saving22 (moab_short saves), differ (option sets differ), kept (revision 22's moab_short keeps capacity answers through
// capacitySame), unreached (revision 21 saved and revision 22 doesn't). targets: revision 22's saving targets by target and
// round: {for, cost, gain, round, decisions, reach: [min, max]}. firsts: at the first decision of each round from firstFrom to
// firstTo, revision 22's saving (for, cost, round, reach) or null, its binding, and the capacity answers it kept (tower, tiers,
// cost, camo_gain, lead_gain), with revision 21's saving beside it. zeroLeak: the policy's view with one life.
export function ddtReachReplay(records, lookup, {paths = [], zeroLeak = false, firsts = false, firstFrom = 85, firstTo = 93} = {}) {
 const offered = [...new Set(records.flatMap(r => r.kind === 'decision' ? (r.options ?? []) : []).map(id => /^place:([^@]+)@/.exec(id)?.[1]).filter(Boolean))];
 const band = n => CAMO_BANDS.find(([a, b]) => n >= a && n <= b);
 const out = {decisions: 0, skipped: 0, bands: Object.fromEntries(CAMO_BANDS.map(([a, b]) => [`${a}-${b}`, {decisions: 0, saving21: 0, saving22: 0, unreached: 0, differ: 0, kept: 0}])), targets: new Map(), firsts: []};
 const seen = new Set();
 const moab = r => (r.constraint?.rules ?? []).find(q => q.kind === 'moab_short');
 setDdtSupport(true); setDdtNeed(true); setMoabDdtLead(MOAB_DDT_LEAD_ROUNDS);
 try {
  for (const d of records) {
   if (d.kind !== 'decision' || !d.state?.in_game || d.state.popup || !d.options?.length || !d.state.round) continue;
   if (d.decisionSource === 'single_option' || d.decisionSource === 'forced') continue;
   const n = d.state.round.number, b = band(n);
   if (!b) continue;
   const rebuilt = rebuild(d, lookup);
   if (rebuilt.skipped) { out.skipped++; continue; }
   out.decisions++;
   const candidates = rebuilt.candidates.filter(c => !((c.details?.kind === 'place' || c.details?.kind === 'upgrade') && !Number.isFinite(c.details.cost)));
   const state = zeroLeak ? zeroLeakView(d.state) : d.state;
   const pressure = d.constraint?.rules?.some(q => q.kind === 'leak_pressure') ? {active: true} : null;
   let pool = null;
   const context = {paths, pressure, pool: () => pool ??= poolFor(d.state, lookup, offered)};
   const r21 = floorRulesV6(state, candidates, context, R22_OFF), r22 = floorRulesV6(state, candidates, context);
   const m21 = moab(r21), m22 = moab(r22), o = out.bands[`${b[0]}-${b[1]}`];
   o.decisions++;
   if (m21?.saving != null) o.saving21++;
   if (m22?.saving != null) o.saving22++;
   if (m21?.saving != null && m22?.saving == null) o.unreached++;
   if (m22?.kept_capacity) o.kept++;
   const ids = r => r.candidates.map(c => c.id).sort().join(',');
   if (ids(r21) !== ids(r22)) o.differ++;
   if (m22?.saving != null) {
    const key = `${m22.for}|${m22.saving}|${m22.round}`, t = out.targets.get(key) ?? {for: m22.for, cost: m22.saving, gain: m22.gain, round: m22.round, decisions: 0, reach: [Infinity, -Infinity]};
    t.decisions++; t.reach = [Math.min(t.reach[0], m22.reach), Math.max(t.reach[1], m22.reach)];
    out.targets.set(key, t);
   }
   if (!firsts || n < firstFrom || n > firstTo || seen.has(n)) continue;
   seen.add(n);
   const capacity = m22?.kept_capacity ? r22.candidates.filter(c => (c.details?.threat ?? []).some(k => k === 'camo_capacity' || k === 'lead_capacity'))
    .map(c => ({tower: c.details.tower ?? c.id, tiers: c.details.tiers_after ?? (c.details.kind === 'place' ? '0-0-0' : null), cost: c.details.cost, camo_gain: c.details.camo_gain, lead_gain: c.details.lead_gain})) : [];
   const t22 = (r22.constraint?.rules ?? []).find(q => q.kind === 'threat_short');
   out.firsts.push({round: n, cash: Math.floor(d.state.cash), short: m22?.round ?? null, ratio: m22?.ratio ?? null, first: r22.candidates.slice(0, 3).map(c => c.id),
    threat22: t22 ? {round: t22.round, missing: t22.missing, binding: t22.binding === true ? t22.binding_kind : null, deferred: t22.deferred_to ?? null, held: t22.camo_bind_held ?? null} : null,
    saving22: m22?.saving != null ? {for: m22.for, cost: m22.saving, gain: m22.gain, reach: m22.reach} : null, binding22: m22?.binding === true,
    saving21: m21?.saving != null ? {for: m21.for, cost: m21.saving} : null, threat: (r22.constraint?.rules ?? []).find(q => q.kind === 'threat_short')?.missing ?? null, kept: capacity});
  }
 } finally { setDdtSupport(false); setDdtNeed(false); setMoabDdtLead(MOAB_LEAD_ROUNDS); }
 out.targets = [...out.targets.values()];
 return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const dir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs'));
 let all;
 try { all = readRuns(dir); } catch (error) { console.error(`Can't read the run logs in ${dir}: ${error.message}`); process.exit(2); }
 const parts = flag('--runs')?.split(',').map(s => s.trim()).filter(Boolean);
 const runs = (parts ? all.filter(r => parts.some(p => r.name.includes(p))) : all).filter(r => !argv.includes('--current-era') || currentEra(r.records));
 if (!runs.length) { console.error('No run logs match.'); process.exit(1); }
 const [from, to] = (flag('--rounds') ?? '').split('-').map(Number);
 if (argv.includes('--burst')) {
  const min = Number(flag('--min-round') ?? 68), lookup = harvest(all);
  const top = records => Math.max(0, ...records.filter(r => r.state?.in_game && r.state.round).map(r => r.state.round.number));
  const results = runs.filter(r => top(r.records) >= min).map(({name, records}) => {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   return {name, policy: `${start.policy ?? '?'}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`,
    ...burstReplay(records, lookup, {paths: pathsFor(map), from: Number.isFinite(from) ? from : undefined, to: Number.isFinite(to) ? to : undefined})};
  });
  // --out <file>: the JSON there as well as the table on stdout (the replay takes minutes over a full log folder).
  if (flag('--out')) writeFileSync(resolve(flag('--out')), JSON.stringify(results, null, 1));
  console.log(argv.includes('--json') ? JSON.stringify(results, null, 1) : formatBurst(results, {detail: argv.includes('--detail')}));
  process.exit(0);
 }
 if (argv.includes('--camo-capacity')) {
  const lookup = harvest(all);
  const results = runs.map(({name, records}) => {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   return {name, policy: `${start.policy ?? '?'}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`,
    ...camoCapacityReplay(records, lookup, {paths: pathsFor(map), from: Number.isFinite(from) ? from : undefined, to: Number.isFinite(to) ? to : undefined})};
  });
  if (flag('--out')) writeFileSync(resolve(flag('--out')), JSON.stringify(results, null, 1));
  console.log(argv.includes('--json') ? JSON.stringify(results, null, 1) : formatCamoCapacity(results, {detail: argv.includes('--detail')}));
  process.exit(0);
 }
 if (argv.includes('--moab-cutoff')) {
  const since = flag('--since') ?? '', mode = flag('--mode') ?? 'Clicks', lookup = harvest(all);
  const chosen = runs.filter(r => r.name >= since && r.records.find(x => x.kind === 'run_start')?.policy === 'btd6-jev-v6'
   && r.records.some(x => x.kind === 'decision' && x.state?.match?.mode === mode));
  setDdtCheck(true);
  const results = chosen.map(({name, records}) => {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   const cal = start.calibration ?? {};
   setMoabCalibration(cal.moab?.factor ?? 1);
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   const paths = argv.includes('--no-track') ? [] : pathsFor(map);
   return {name, policy: `${start.policy}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`,
    ...moabCutoffReplay(records, lookup, {paths, from: Number.isFinite(from) ? from : undefined, to: Number.isFinite(to) ? to : undefined})};
  });
  if (flag('--out')) writeFileSync(resolve(flag('--out')), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, argv.includes('--json') ? 1 : undefined));
  process.exit(0);
 }
 if (argv.includes('--ddt-reach')) {
  // As --camo-rate: --since, --mode, --zero-leak, --calibration; revision 21 against 22 (ddtReachReplay). --firsts name,...
  const since = flag('--since') ?? '', mode = flag('--mode') ?? 'Clicks', lookup = harvest(all, {targets: true}), zl = argv.includes('--zero-leak');
  const calibration = resolve(flag('--calibration') ?? join(root, '.private/btd6/calibration'));
  const firsts = (flag('--firsts') ?? '').split(',').filter(Boolean);
  const chosen = runs.filter(r => r.name >= since && r.records.find(x => x.kind === 'run_start')?.policy === 'btd6-jev-v6'
   && (r.records.find(x => x.kind === 'run_start')?.zero_leak === true) === zl
   && r.records.some(x => x.kind === 'decision' && x.state?.match?.mode === mode && x.state?.match?.difficulty === 'Hard'));
  setDdtCheck(true);
  const {loadCalibration} = await import('./moab-calibration.mjs');
  const results = [];
  for (const {name, records} of chosen) {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   const cal = start.calibration ?? {}, setup = start.setup ?? records.find(r => r.kind === 'session_start')?.setup;
   setMoabCalibration(cal.moab?.factor ?? (setup ? (await loadCalibration(calibration, setup)).factor : 1));
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   const paths = argv.includes('--no-track') ? [] : pathsFor(map);
   const r = ddtReachReplay(records, lookup, {paths, zeroLeak: start.zero_leak === true, firsts: firsts.some(p => name.includes(p))});
   results.push({name, policy: `${start.policy}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`, zero_leak: start.zero_leak === true, ...r});
  }
  if (flag('--out')) writeFileSync(resolve(flag('--out')), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, argv.includes('--json') ? 1 : undefined));
  process.exit(0);
 }
 if (argv.includes('--camo-rate')) {
  // As --ddt-need: --since, --mode, --calibration; revision 20 against 21 (camoRateReplay). --losses name:round,...
  const since = flag('--since') ?? '', mode = flag('--mode') ?? 'Clicks', lookup = harvest(all), zl = argv.includes('--zero-leak');
  const calibration = resolve(flag('--calibration') ?? join(root, '.private/btd6/calibration'));
  const losses = (flag('--losses') ?? '').split(',').filter(Boolean).map(s => { const i = s.lastIndexOf(':'); return {part: s.slice(0, i), round: Number(s.slice(i + 1))}; });
  const chosen = runs.filter(r => r.name >= since && r.records.find(x => x.kind === 'run_start')?.policy === 'btd6-jev-v6'
   && (r.records.find(x => x.kind === 'run_start')?.zero_leak === true) === zl
   && r.records.some(x => x.kind === 'decision' && x.state?.match?.mode === mode && x.state?.match?.difficulty === 'Hard'));
  setDdtCheck(true);
  const {loadCalibration} = await import('./moab-calibration.mjs');
  const results = [];
  for (const {name, records} of chosen) {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   const cal = start.calibration ?? {}, setup = start.setup ?? records.find(r => r.kind === 'session_start')?.setup;
   setMoabCalibration(cal.moab?.factor ?? (setup ? (await loadCalibration(calibration, setup)).factor : 1));
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   const paths = argv.includes('--no-track') ? [] : pathsFor(map);
   const r = camoRateReplay(records, lookup, {paths, zeroLeak: start.zero_leak === true, losses: losses.filter(l => name.includes(l.part)).map(l => l.round)});
   results.push({name, policy: `${start.policy}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`, zero_leak: start.zero_leak === true, ...r});
  }
  if (flag('--out')) writeFileSync(resolve(flag('--out')), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, argv.includes('--json') ? 1 : undefined));
  process.exit(0);
 }
 if (argv.includes('--ddt-need')) {
  // As --ddt-save: --since, --mode, --calibration, --rounds; revision 18 against revision 20 (ddtNeedReplay). Per log
  // the counts, and the ratio, answer and saving-target tables only for --tables <run-name parts>.
  const since = flag('--since') ?? '', mode = flag('--mode') ?? 'Clicks', lookup = harvest(all);
  const calibration = resolve(flag('--calibration') ?? join(root, '.private/btd6/calibration'));
  const start76 = flag('--rounds') != null && Number.isFinite(from) ? from : mode === 'Clicks' ? 76 : -Infinity;
  const tables = flag('--tables')?.split(',').filter(Boolean) ?? null;
  const chosen = runs.filter(r => r.name >= since && r.records.find(x => x.kind === 'run_start')?.policy === 'btd6-jev-v6'
   && r.records.some(x => x.kind === 'decision' && x.state?.match?.mode === mode && x.state?.match?.difficulty === 'Hard'));
  setDdtCheck(true);
  const {loadCalibration} = await import('./moab-calibration.mjs');
  const results = [];
  for (const {name, records} of chosen) {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   const cal = start.calibration ?? {}, setup = start.setup ?? records.find(r => r.kind === 'session_start')?.setup;
   setMoabCalibration(cal.moab?.factor ?? (setup ? (await loadCalibration(calibration, setup)).factor : 1));
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   const paths = argv.includes('--no-track') ? [] : pathsFor(map);
   const r = ddtNeedReplay(records, lookup, {paths, from: start76, to: Number.isFinite(to) ? to : undefined, zeroLeak: start.zero_leak === true,
    without: flag('--without') === 'best' ? {ddtSaveBest: false} : {moabNearest: false}, tables: !argv.includes('--saving-only')});
   if (tables && !tables.some(p => name.includes(p))) { delete r.ratios; delete r.answers; for (const k of ['r18', 'r20w', 'r20']) delete r[k].targets; }
   results.push({name, policy: `${start.policy}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`, zero_leak: start.zero_leak === true, ...r});
  }
  if (flag('--out')) writeFileSync(resolve(flag('--out')), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, argv.includes('--json') ? 1 : undefined));
  process.exit(0);
 }
 if (argv.includes('--ddt-save')) {
  // --since: run-name prefix; --mode Clicks (CHIMPS, from --rounds' start, 76 by default) or Standard (every round);
  // --calibration: the MOAB calibration directory, for runs whose run_start doesn't record the factor.
  const since = flag('--since') ?? '', mode = flag('--mode') ?? 'Clicks', lookup = harvest(all);
  const calibration = resolve(flag('--calibration') ?? join(root, '.private/btd6/calibration'));
  const start76 = flag('--rounds') != null && Number.isFinite(from) ? from : mode === 'Clicks' ? 76 : -Infinity;
  const chosen = runs.filter(r => r.name >= since && r.records.find(x => x.kind === 'run_start')?.policy === 'btd6-jev-v6'
   && r.records.some(x => x.kind === 'decision' && x.state?.match?.mode === mode && x.state?.match?.difficulty === 'Hard'));
  setDdtCheck(true);
  const {loadCalibration} = await import('./moab-calibration.mjs');
  const results = [];
  for (const {name, records} of chosen) {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   const cal = start.calibration ?? {}, setup = start.setup ?? records.find(r => r.kind === 'session_start')?.setup;
   setMoabCalibration(cal.moab?.factor ?? (setup ? (await loadCalibration(calibration, setup)).factor : 1));
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   const paths = argv.includes('--no-track') ? [] : pathsFor(map);
   results.push({name, policy: `${start.policy}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`, zero_leak: start.zero_leak === true,
    ...ddtSaveReplay(records, lookup, {paths, from: start76, to: Number.isFinite(to) ? to : undefined})});
  }
  if (flag('--out')) writeFileSync(resolve(flag('--out')), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, argv.includes('--json') ? 1 : undefined));
  process.exit(0);
 }
 if (argv.includes('--moab-bind')) {
  const since = flag('--since') ?? '', mode = flag('--mode') ?? 'Clicks', lookup = harvest(all);
  const chosen = runs.filter(r => r.name >= since && r.records.find(x => x.kind === 'run_start')?.policy === 'btd6-jev-v6'
   && r.records.some(x => x.kind === 'decision' && x.state?.match?.mode === mode));
  // Revisions 15 and 16 both count only DDT-capable MOAB damage against DDTs.
  setDdtCheck(true);
  const results = chosen.map(({name, records}) => {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   const cal = start.calibration ?? {};
   setMoabCalibration(cal.moab?.factor ?? 1);
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   const paths = argv.includes('--no-track') ? [] : pathsFor(map);
   return {name, policy: `${start.policy}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`,
    ...moabBindReplay(records, lookup, {paths, from: Number.isFinite(from) ? from : undefined, to: Number.isFinite(to) ? to : undefined})};
  });
  console.log(JSON.stringify(results, null, argv.includes('--json') ? 1 : undefined));
  process.exit(0);
 }
 if (argv.includes('--lead-ddt')) {
  const since = flag('--since') ?? '', mode = flag('--mode') ?? 'Clicks', lookup = harvest(all);
  const chosen = runs.filter(r => r.name >= since && r.records.find(x => x.kind === 'run_start')?.policy === 'btd6-jev-v6'
   && r.records.some(x => x.kind === 'decision' && x.state?.match?.mode === mode));
  // Revisions 14 and 15 both count only DDT-capable MOAB damage against DDTs.
  setDdtCheck(true);
  const results = chosen.map(({name, records}) => {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   const cal = start.calibration ?? {};
   setMoabCalibration(cal.moab?.factor ?? 1);
   setPopsCalibration(cal.pops?.factor ?? 1, {fromRound: cal.pops?.from_round ?? 1});
   const paths = argv.includes('--no-track') ? [] : pathsFor(map);
   return {name, policy: `${start.policy}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`,
    ...leadDdtReplay(records, lookup, {paths, from: Number.isFinite(from) ? from : undefined, to: Number.isFinite(to) ? to : undefined})};
  });
  console.log(JSON.stringify(results, null, argv.includes('--json') ? 1 : undefined));
  process.exit(0);
 }
 if (argv.includes('--one-life-bind')) {
  const since = flag('--since') ?? '', mode = flag('--mode') ?? 'Clicks', lookup = harvest(all);
  const chosen = runs.filter(r => r.name >= since && r.records.find(x => x.kind === 'run_start')?.policy === 'btd6-jev-v6'
   && r.records.some(x => x.kind === 'decision' && x.state?.match?.mode === mode));
  const aside = argv.includes('--stand-aside');
  // Revisions 13 and 14 both count only DDT-capable MOAB damage against DDTs.
  if (aside) setDdtCheck(true);
  const results = chosen.map(({name, records}) => {
   const start = records.find(r => r.kind === 'run_start') ?? {}, map = start.setup?.map ?? records.find(r => r.kind === 'decision')?.state?.match?.map;
   const paths = argv.includes('--track') ? pathsFor(map) : [];
   return {name, policy: `${start.policy}${start.policy_revision != null ? ` r${start.policy_revision}` : ''}`, ...(aside ? standAsideReplay(records, lookup, {paths}) : oneLifeBindReplay(records, lookup, {paths}))};
  });
  console.log(JSON.stringify(results, null, argv.includes('--json') ? 1 : undefined));
  process.exit(0);
 }
 // Positions and costs come from every log in the folder, so a filtered replay still knows them.
 const results = replayRuns(runs, {lookup: harvest(all), from: Number.isFinite(from) ? from : undefined, to: Number.isFinite(to) ? to : undefined, kinds: flag('--kinds') === 'v2' ? THREAT_KINDS_V2 : THREAT_KINDS});
 console.log(argv.includes('--json') ? JSON.stringify(results, null, 1) : format(results, {detail: argv.includes('--detail')}));
}
