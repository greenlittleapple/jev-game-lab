// Round-78 data from the run logs (data only, no fitting or verdicts): for each run that reached round 78, the margins at
// rounds 70, 75 and 78, the towers at round 78's first decision, round 78's life losses, purchases in rounds 75 to 78
// and coverage of the second half of the track.
//   node integration/btd6/r78-data.mjs [--dir <runs dir>] [--data <btd6-game-data clone>] [--round 78] [--json]
// --data is optional: without it the single-target / area column is left empty.
import {readFileSync, existsSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRuns} from './rules-audit.mjs';
import {roundsOf} from './pops-calibration.mjs';
import {pathsFor} from './moab-replay.mjs';
import {currentEra} from './hard-rounds.mjs';
import {roundCheck, towerEstimate, effectivePps, reachFactor} from './estimate.mjs';
import {aimStatus} from './aim.mjs';
import {aimOf, globalShare} from './towers.mjs';
import {pathLength} from './spots.mjs';

const CREATES = /Create(Distance)?ProjectileOn/;
const emitted = e => e?.count ?? e?.Count ?? e?.projectileCount ?? 1;
const damaging = p => (p?.behaviors ?? []).some(b => /\.DamageModel,/.test(b?.$type ?? '') && b.damage > 0);

// From the game-data tower file: the largest pierce of a damaging projectile (direct or created on contact or expiry),
// the most projectiles per shot, and whether a damaging projectile is created by another (an explosion or frags).
// single: every damaging projectile has pierce 2 or less, at most 2 per shot, and none is created by another; else multi.
export function attackShape(model) {
 let pierce = 0, perShot = 0, created = false, any = false;
 const walk = (p, depth, count, isChild) => {
  if (!p || depth > 3) return;
  if (damaging(p)) { any = true; pierce = Math.max(pierce, p.pierce ?? 1); perShot = Math.max(perShot, count); if (isChild) created = true; }
  for (const b of p.behaviors ?? []) if (b?.projectile && CREATES.test(b.$type)) walk(b.projectile, depth + 1, emitted(b.emission), true);
 };
 for (const a of model.behaviors ?? []) {
  if (!/\.Attack(AirUnit)?Model,/.test(a?.$type ?? '')) continue;
  for (const w of a.weapons ?? []) walk(w.projectile, 0, emitted(w.emission), false);
 }
 if (!any) return null;
 return {pierce: +pierce.toFixed(1), per_shot: perShot, created, shape: pierce <= 2 && perShot <= 2 && !created ? 'single' : 'multi'};
}
function shapeLookup(dataDir) {
 const cache = new Map();
 return t => {
  if (!dataDir) return null;
  const hero = t.is_hero || t.base_id === 'Quincy';
  // The logged state has no hero level field; Quincy's first tier holds it in the logs.
  const level = t.level ?? (hero && t.tiers?.[0] > 0 ? t.tiers[0] : 1), tiers = (t.tiers ?? [0, 0, 0]).join('');
  const file = hero ? join(dataDir, 'Towers', t.base_id, level === 1 ? `${t.base_id}.json` : `${t.base_id} ${level}.json`)
   : join(dataDir, 'Towers', t.base_id, tiers === '000' ? `${t.base_id}.json` : `${t.base_id}-${tiers}.json`);
  if (!cache.has(file)) cache.set(file, existsSync(file) ? attackShape(JSON.parse(readFileSync(file, 'utf8'))) : null);
  return cache.get(file);
 };
}

// Points along the track at progress 0..1 (length share, as spots.mjs coverage), per path.
function samplePath(paths, from, to, n = 1000) {
 const out = [];
 for (const path of paths) {
  const total = pathLength(path), cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  for (let k = 0; k <= n; k++) {
   const d = (from + (to - from) * k / n) * total;
   let i = cum.findIndex(c => c >= d); if (i <= 0) i = 1;
   const s = cum[i] - cum[i - 1], f = s ? (d - cum[i - 1]) / s : 0;
   out.push({x: path[i - 1].x + f * (path[i].x - path[i - 1].x), y: path[i - 1].y + f * (path[i].y - path[i - 1].y)});
  }
 }
 return out;
}
// What a tower reaches: {kind: 'global' | 'circle' | 'none', c, r}. Global: Sniper and Ace (towers.mjs AIM) or a Heli on
// Pursuit; point towers (aim.mjs): the aim circle; unaimed: none; others: the range circle around the tower.
function zone(t, e, paths) {
 const status = aimStatus(t, paths);
 if (status.kind === 'unaimed') return {kind: 'none'};
 if (status.kind === 'global') return {kind: 'global'};
 if (status.kind === 'point') return {kind: 'circle', c: status.point, r: status.radius};
 if (aimOf(t.base_id) === 'global') return {kind: 'global'};
 return e?.range > 0 ? {kind: 'circle', c: t, r: e.range} : {kind: 'none'};
}
const inZone = (z, p) => z.kind === 'global' || (z.kind === 'circle' && Math.hypot(p.x - z.c.x, p.y - z.c.y) <= z.r);
const share = (pts, zones) => pts.length ? pts.filter(p => zones.some(z => inZone(z, p))).length / pts.length : 0;

// pops_round records merged per round (a round can be logged in parts): Map(round -> Map(tower id -> pops)).
function popsByRound(records) {
 const out = new Map();
 for (const r of records.filter(r => r.kind === 'pops_round')) {
  if (!out.has(r.round)) out.set(r.round, new Map());
  const m = out.get(r.round);
  for (const t of r.towers ?? []) m.set(t.id, (m.get(t.id) ?? 0) + (t.pops ?? 0));
 }
 return out;
}
const ms = t => Date.parse(t);
const states = records => records.filter(r => r.time && r.state?.in_game && r.state.round && Number.isFinite(r.state.lives));

// Speed over wall time from observed state speeds and executed speed_set records: [{at, speed}] sorted.
function speedTimeline(records) {
 const ev = [];
 for (const r of records) {
  if (!r.time) continue;
  if (r.kind === 'speed_set' && r.status === 'executed' && Number.isFinite(r.speed)) ev.push({at: ms(r.time), speed: r.speed});
  else if (r.state?.in_game && Number.isFinite(r.state.speed)) ev.push({at: ms(r.time), speed: r.state.speed});
 }
 return ev.sort((a, b) => a.at - b.at);
}
function gameSeconds(ev, from, to) {
 let s = 0, speed = [...ev].reverse().find(e => e.at <= from)?.speed ?? 1, at = from;
 for (const e of ev) {
  if (e.at <= from) continue;
  if (e.at >= to) break;
  s += (e.at - at) / 1000 * speed; at = e.at; speed = e.speed;
 }
 return s + (to - at) / 1000 * speed;
}

export function runData({name, records}, {round = 78, shapeOf = () => null} = {}) {
 const start = records.find(r => r.kind === 'run_start') ?? {}, session = records.find(r => r.kind === 'session_start') ?? {};
 const map = session.setup?.map ?? start.setup?.map, paths = pathsFor(map);
 const cal = start.calibration?.pops ?? session.calibration?.pops ?? null;
 const popsCal = r => cal && r >= (cal.from_round ?? 1) ? cal.factor ?? 1 : 1;
 const st = states(records), rounds = roundsOf(records), pops = popsByRound(records), speeds = speedTimeline(records);
 const firstDecision = n => records.find(r => r.kind === 'decision' && r.state?.in_game && r.state.round?.number === n);
 const lost = n => rounds.find(r => r.round === n)?.lost ?? null;
 const run = {name, policy: start.policy ?? session.policy ?? '?', revision: start.policy_revision ?? null, map, current_era: currentEra(records),
  pops_calibration: cal ? {factor: cal.factor, from_round: cal.from_round} : null, lost: lost(round), result: records.find(r => r.kind === 'run_end')?.result ?? null};

 // Margins at the first decision of rounds 70, 75 and round.
 run.margins = [70, 75, round].map(n => {
  const d = firstDecision(n);
  if (!d) return {round: n, missing: true};
  const s = d.state, c = roundCheck(s.towers, n, {lives: s.lives, paths, useReach: true, factor: popsCal(n)});
  const logged = records.find(r => r.kind === 'speed_set' && r.round === n && r.margins)?.margins ?? null;
  const est = s.towers.map(t => towerEstimate(t)).filter(e => e && e.pps > 0);
  return {round: n, time: d.time, cash: s.cash, lives: s.lives, towers: s.towers.length, whole: c?.ratio ?? null, burst: c?.burst_facts?.ratio ?? null,
   can_pop: c?.can_pop, needs: c?.needs, camo: c?.camo, camo_lead: c?.camo_lead, pps_table: +est.reduce((n, e) => n + e.pps, 0).toFixed(1),
   pps_reach: +s.towers.reduce((n, t) => n + (effectivePps(t, paths) ?? 0), 0).toFixed(1), logged_speed_set_margin: logged?.pops ?? null};
 });

 // Towers at the first decision of the round.
 const d0 = firstDecision(round), second = samplePath(paths, 0.5, 1);
 run.first_decision = d0 ? {time: d0.time, round_state: d0.state.round, cash: d0.state.cash, lives: d0.state.lives} : null;
 run.towers = (d0?.state.towers ?? []).map(t => {
  const e = towerEstimate(t), rf = e ? reachFactor(t, e.range, paths) : null, z = zone(t, e, paths), sh = shapeOf(t);
  return {id: t.id, base: t.base_id, tiers: (t.tiers ?? []).join(''), targeting: t.targeting ?? null, target_point: t.target_point ?? null,
   camo: e?.camo ?? null, lead: e?.lead ?? null, camo_lead: e?.camoLead ?? null, pps: e?.pps ?? null, range: e?.range ?? null,
   aim: rf?.aim ?? null, reach_factor: rf?.factor ?? null, from: rf?.reach?.from ?? null, to: rf?.reach?.to ?? null, track_share: rf?.reach?.share ?? null,
   second_half: z.kind === 'global' ? 1 : +share(second, [z]).toFixed(3), zone: z.kind, global_share: z.kind === 'global' ? globalShare(t.base_id) : null,
   shape: sh?.shape ?? null, pierce: sh?.pierce ?? null, per_shot: sh?.per_shot ?? null, created: sh?.created ?? null,
   pops: Object.fromEntries([round - 2, round - 1, round].map(n => [n, pops.get(n)?.get(t.id) ?? null]))};
 });

 // Coverage of the second half (progress 0.5 to 1) by unions of tower zones.
 const zoned = run.towers.map((t, i) => ({t, z: zone(d0.state.towers[i], towerEstimate(d0.state.towers[i]), paths)})).filter(x => x.t.pps > 0);
 const cover = pick => { const xs = zoned.filter(pick); return {towers: xs.length, global: xs.filter(x => x.z.kind === 'global').map(x => x.t.base).join('+') || null,
  share: +share(second, xs.map(x => x.z)).toFixed(3), share_no_global: +share(second, xs.filter(x => x.z.kind !== 'global').map(x => x.z)).toFixed(3)}; };
 run.second_half = {camo: cover(x => x.t.camo), multi: cover(x => x.t.shape === 'multi'), camo_multi: cover(x => x.t.camo && x.t.shape === 'multi'), all: cover(() => true)};

 // Round timeline: start = the last pops_round of the previous round logged before the first state of this round (the
 // runner logs it at the round change), else that first state.
 const first = st.find(r => r.state.round.number === round);
 if (first) {
  const prev = records.filter(r => r.kind === 'pops_round' && r.round === round - 1 && r.time && ms(r.time) <= ms(first.time)).at(-1);
  const t0 = ms(prev?.time ?? first.time);
  const inRound = st.filter(r => r.state.round.number === round);
  const at = r => ({utc: r.time.slice(11, 23), wall_s: +((ms(r.time) - t0) / 1000).toFixed(1), game_s: +gameSeconds(speeds, t0, ms(r.time)).toFixed(1), speed: r.state.speed});
  run.round_start = {utc: new Date(t0).toISOString().slice(11, 23), from: prev ? 'pops_round' : 'first_state'};
  run.losses = [];
  for (let i = 1; i < inRound.length; i++) {
   const a = inRound[i - 1].state, b = inRound[i].state;
   if (b.lives < a.lives) run.losses.push({before: at(inRound[i - 1]), after: at(inRound[i]), lives: [a.lives, b.lives], lost: a.lives - b.lives, kind: inRound[i].kind});
  }
  const end = inRound.at(-1);
  run.round_end = {...at(end), kind: end.kind, lives: end.state.lives, lives_lost_field: end.state.round.lives_lost ?? null};
  run.speed_sets = records.filter(r => r.kind === 'speed_set' && r.round === round && r.time).map(r => ({utc: r.time.slice(11, 23), wall_s: +((ms(r.time) - t0) / 1000).toFixed(1), speed: r.speed, status: r.status, reason: r.reason}));
  run.speed_round = records.filter(r => r.kind === 'speed_round' && r.round === round).map(r => r.seconds);
  // The bridge's bloon list isn't logged (runner.mjs describeState drops it). The furthest bloon's progress is logged only
  // where a decision's rules carry it (policy-v3.mjs leak_pressure: state.bloons.furthest at that decision).
  run.furthest = records.filter(r => r.kind === 'decision' && r.time && r.state?.round?.number === round).flatMap(r => (r.constraint?.rules ?? [])
   .filter(x => x && 'furthest' in x).slice(0, 1).map(x => ({...at(r), furthest: x.furthest, lives: r.state.lives, rule: x.kind, reason: x.reason ?? null})));
 }

 // Purchases and cash at round starts, rounds round-3 to round.
 // A decision's dispatch result: the first dispatch record with a result logged after it.
 const resultAfter = d => records.find(r => r.kind === 'dispatch' && r.result && r.time && ms(r.time) >= ms(d.time) && r.result.action === d.chosen.command.action);
 run.rounds = [];
 for (let n = round - 3; n <= round; n++) {
  const f = st.find(r => r.state.round.number === n);
  const prev = f && records.filter(r => r.kind === 'pops_round' && r.round === n - 1 && r.time && ms(r.time) <= ms(f.time)).at(-1);
  const t0 = f ? ms(prev?.time ?? f.time) : null;
  const buys = records.filter(r => r.kind === 'decision' && r.state?.round?.number === n && r.chosen && r.chosen.id !== 'wait' && !r.chosen.id.startsWith('dismiss:') && r.chosen.command).map(r => {
   const res = resultAfter(r);
   return {wall_s: +((ms(r.time) - t0) / 1000).toFixed(1), id: r.chosen.id, label: r.chosen.label, cash_before: r.state.cash, outcome: r.outcome, status: res?.outcome ?? null, result_action: res?.result?.action ?? null, source: r.decisionSource};
  });
  run.rounds.push({round: n, cash_at_start: f?.state.cash ?? null, lives_at_start: f?.state.lives ?? null, lost: lost(n), buys});
 }
 return run;
}


const pct = v => v == null ? '-' : `${Math.round(v * 100)}%`;
const tag = r => `${r.name.slice(11, 16)} ${r.policy.replace('btd6-', '')}${r.revision != null ? ` r${r.revision}` : ''}`;
const row = cells => `| ${cells.join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
// Markdown tables of runData results.
export function formatMarkdown(runs, round = 78) {
 const out = [];
 out.push(`## Margins (roundCheck with reach, the run's pops calibration)\n`, table(['run', 'lost', ...[70, 75, round].map(n => `r${n} whole / burst / cash`), `r${round} lives`, `r${round} pps table / reach`],
  runs.map(r => [tag(r), r.lost, ...r.margins.map(m => m.missing ? '-' : `${m.whole} / ${m.burst} / ${m.cash}`), r.margins[2].lives ?? '-', `${r.margins[2].pps_table} / ${r.margins[2].pps_reach}`])));
 out.push(`\n## Towers at the first decision of round ${round}\n`, table(['run', 'id', 'tower', 'tiers', 'targeting', 'camo/lead/camo_lead', 'shape (pierce, per shot, created)', 'pps', 'aim', 'reach f', 'from-to (share)', '2nd half', `pops ${round - 2}/${round - 1}/${round}`],
  runs.flatMap(r => r.towers.map(t => [tag(r), t.id, t.base, t.tiers, t.targeting ?? '-', [t.camo, t.lead, t.camo_lead].map(v => v == null ? '?' : v ? 'y' : 'n').join('/'),
   t.shape ? `${t.shape} (${t.pierce}, ${t.per_shot}, ${t.created ? 'y' : 'n'})` : '-', t.pps ?? '-', t.aim ?? '-', t.reach_factor ?? '-',
   t.zone === 'global' ? `global x${t.global_share}` : t.from == null ? 'none' : `${pct(t.from)}-${pct(t.to)} (${pct(t.track_share)})`, pct(t.second_half),
   Object.values(t.pops).map(v => v ?? '-').join('/')]))));
 out.push(`\n## Round ${round} life losses\n`, table(['run', 'start (UTC)', 'last state before (UTC, wall s, game s, speed)', 'first state after', 'lives', 'lost'],
  runs.flatMap(r => (r.losses ?? []).map(l => [tag(r), r.round_start.utc, `${l.before.utc}, ${l.before.wall_s}, ${l.before.game_s}, x${l.before.speed}`, `${l.after.utc}, ${l.after.wall_s}, ${l.after.game_s}, x${l.after.speed} (${l.kind})`, l.lives.join(' -> '), l.lost]))));
 out.push(`\n## Round ${round} end of logged states and speed\n`, table(['run', 'start (UTC)', 'last state (wall s, game s, speed, kind)', 'speed_set in round', 'speed_round seconds'],
  runs.map(r => [tag(r), r.round_start?.utc ?? '-', r.round_end ? `${r.round_end.wall_s}, ${r.round_end.game_s}, x${r.round_end.speed}, ${r.round_end.kind}` : '-',
   (r.speed_sets ?? []).map(x => `${x.wall_s}s x${x.speed} ${x.status}`).join('; ') || '-', (r.speed_round ?? []).map(x => JSON.stringify(x)).join(' ') || '-'])));
 out.push(`\n## Furthest bloon progress in round ${round} (where a decision's rules logged it)\n`, table(['run', 'samples (wall s / game s: furthest, lives)'],
  runs.map(r => [tag(r), (r.furthest ?? []).map(x => `${x.wall_s}/${x.game_s}: ${x.furthest ?? 'null'}, ${x.lives}`).join('; ') || 'none'])));
 out.push(`\n## Purchases, rounds ${round - 3} to ${round}\n`, table(['run', 'round', 'cash at start', 'lives at start', 'lost', 'purchases (wall s: what, cash before, result)'],
  runs.flatMap(r => r.rounds.map(x => [tag(r), x.round, x.cash_at_start ?? '-', x.lives_at_start ?? '-', x.lost ?? '-',
   x.buys.map(b => `${b.wall_s}: ${b.label.replace(/^(Upgrade|Place) /, '')}, ${b.cash_before}, ${b.status ?? b.outcome}`).join('; ') || '-']))));
 out.push(`\n## Second half of the track (progress 0.5 to 1) covered, union of tower zones\n`, table(['run', 'camo towers: share (no global) [global]', 'multi towers', 'camo and multi', 'all damaging'],
  runs.map(r => [tag(r), ...['camo', 'multi', 'camo_multi', 'all'].map(k => { const c = r.second_half[k]; return `${c.towers}: ${pct(c.share)} (${pct(c.share_no_global)})${c.global ? ` [${c.global}]` : ''}`; })])));
 // Summaries of the two long tables.
 const classes = [['camo multi', t => t.camo && t.shape === 'multi'], ['camo single', t => t.camo && t.shape === 'single'], ['no-camo multi', t => !t.camo && t.shape === 'multi'], ['no-camo single', t => !t.camo && t.shape === 'single']];
 const sum = (xs, k) => Math.round(xs.reduce((n, t) => n + (k(t) ?? 0), 0));
 out.push(`\n## Towers by class at round ${round}'s first decision: count / table pps / measured pops ${round - 1} / measured pops ${round}\n`, table(['run', ...classes.map(c => c[0]), 'no estimate or shape'],
  runs.map(r => { const dmg = r.towers.filter(t => t.pps > 0); return [tag(r), ...classes.map(([, f]) => { const xs = dmg.filter(f); return `${xs.length} / ${sum(xs, t => t.pps)} / ${sum(xs, t => t.pops[round - 1])} / ${sum(xs, t => t.pops[round])}`; }),
   r.towers.filter(t => !(t.pps > 0) || t.shape == null).map(t => `${t.base} ${t.tiers}`).join(', ') || '-']; })));
 const spent = b => Number(/\(\$(\d+)\)/.exec(b.label)?.[1] ?? 0);
 out.push(`\n## Purchases summary: cash at round start / purchases / $ spent (from the option labels)\n`, table(['run', ...runs[0].rounds.map(x => `r${x.round}`)],
  runs.map(r => [tag(r), ...r.rounds.map(x => `${x.cash_at_start ?? '-'} / ${x.buys.length} / ${x.buys.reduce((n, b) => n + spent(b), 0)}`)])));
 return out.join('\n');
}

const reached = (records, round) => states(records).some(r => r.state.round.number >= round);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const dir = resolve(flag('--dir') ?? join(root, '.private/btd6/runs')), data = flag('--data') ? resolve(flag('--data')) : null;
 const round = Number(flag('--round') ?? 78), shapeOf = shapeLookup(data);
 const runs = readRuns(dir).filter(r => reached(r.records, round)).map(r => runData(r, {round, shapeOf}));
 console.log(argv.includes('--json') ? JSON.stringify(runs, null, 1) : formatMarkdown(runs, round));
}
