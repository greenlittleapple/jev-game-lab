// The live dashboard's model (npm run btd6:dashboard; server and page in dashboard-server.mjs and
// dashboard.html). It is read-only: it tails the run logs, reads series.jsonl, and takes a bridge state
// when one is given, and it never sends a command or writes a file. Two kinds of figures come out of it:
//  - from the log: what the runner recorded (decisions, speed_set, pops_round, moab_measure, aim_check,
//    strategist requests and plans, run results);
//  - recomputed here: margins, caps, danger signals, round checks and per-tower estimates, with the
//    runner's own functions (speed.mjs, estimate.mjs, moab.mjs, threat.mjs, hard-rounds.mjs) on the
//    latest state, with the calibration factors the run recorded. They follow the dashboard's checkout of
//    the code and data; run_start's tower data version is compared with it.
import {open, readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {BETWEEN_ROUNDS_SUFFIX, BUYING_MS, EMERGENCIES, MIN_SPEED, SLOW_CONSULTS, compositionCap, dangerProgress, dangerSignals, defenceMargins,
 GRADE_AT, GRADE_AT_CAMO, gradeFor, isPurchase, moabOutrun, observedSpeed, parseSpeedMode, speedCaps} from './speed.mjs';
import {effectivePps, popsCalibration, roundCheck, roundFacts, earlyMarginFor, setEarlyMargin, setPopsCalibration, towerEstimate} from './estimate.mjs';
import {moabCalibration, moabCheck, moabDps, setMoabCalibration, setDdtCheck, ddtCheckFor, setMoabDdtLead, moabDdtLeadFor, setDdtSupport, ddtSupportFor, setDdtNeed, ddtNeedFor, towerMoab, MOAB_LEAD_ROUNDS} from './moab.mjs';
import {THREAT_KINDS_V4, THREAT_BURST_ROUNDS, LEAD_CAPACITY_AT, threatShort, leadDdtFor, leadAtFor, camoRateFor} from './threat.mjs';
import {hardRoundsFor} from './hard-rounds.mjs';
import {moabShort} from './policy-v4.mjs';
import {pressureTracker} from './policy-v3.mjs';
import {aimStatus} from './aim.mjs';
import {TOWER_DATA_VERSION, setTowerTable} from './towers.mjs';
import {DEFAULT_PORT as DEFAULT_BRIDGE_PORT, logBridgePort} from './ports.mjs';

export const UPCOMING_ROUNDS = 5;
const KEEP = {decisions: 150, speedSets: 40, popsRounds: 12, aimChecks: 12, warnings: 20, rejected: 10};
const push = (list, item, max) => { list.push(item); if (list.length > max) list.splice(0, list.length - max); };
const NL = 0x0a;

// Follows the newest *.jsonl file in dir. poll() returns [{file, records, fresh}]: the rest of the file it was
// on, then, when a newer file has appeared, that file from its start (fresh: true). A missing directory or an
// empty one gives []. A line is parsed only once it is complete; a line that isn't JSON is skipped.
// bridgePort: follow only the run logs of that bridge port (ports.mjs logBridgePort: session_start.bridge_port, the
// file name, or 15527 for logs from before the field), for a second game copy; null follows every log.
export function logTail(dir, {bridgePort = null} = {}) {
 const t = {dir, file: null, offset: 0, rest: Buffer.alloc(0)};
 const ports = new Map();
 const portOf = async file => {
  if (ports.has(file)) return ports.get(file);
  const head = await readHead(join(dir, file));
  const session = head.split('\n').filter(l => l.includes('"kind":"session_start"')).map(l => { try { return JSON.parse(l); } catch { return null; } }).find(Boolean) ?? null;
  const port = logBridgePort(file, session);
  // Cached once session_start has been read; until then the file name decides and the file is read again.
  if (session) ports.set(file, port);
  return port;
 };
 const read = async file => {
  let fh;
  try { fh = await open(join(dir, file), 'r'); } catch { return []; }
  try {
   const {size} = await fh.stat();
   if (size < t.offset) Object.assign(t, {offset: 0, rest: Buffer.alloc(0)});
   if (size === t.offset) return [];
   const buf = Buffer.alloc(size - t.offset);
   const {bytesRead} = await fh.read(buf, 0, buf.length, t.offset);
   t.offset += bytesRead;
   const all = Buffer.concat([t.rest, buf.subarray(0, bytesRead)]);
   const end = all.lastIndexOf(NL);
   t.rest = end < 0 ? all : all.subarray(end + 1);
   if (end < 0) return [];
   return all.subarray(0, end).toString('utf8').split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } finally { await fh.close(); }
 };
 t.poll = async () => {
  const out = [];
  if (t.file) out.push({file: t.file, records: await read(t.file), fresh: false});
  let files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.jsonl')).sort();
  if (bridgePort != null) {
   const mine = [];
   // Newest first; stops at the first log of this port.
   for (const f of files.toReversed()) { if (t.file != null && f <= t.file) break; if (await portOf(f) === bridgePort) { mine.push(f); break; } }
   files = mine;
  }
  const newest = files.at(-1) ?? null;
  if (newest && (t.file == null || newest > t.file)) {
   Object.assign(t, {file: newest, offset: 0, rest: Buffer.alloc(0)});
   out.push({file: newest, records: await read(newest), fresh: true});
  }
  return out;
 };
 return t;
}

// The speed label a run recorded (run_start.speed), as a mode: graded:10+moab3+between-rounds and so on; null
// for none or one this checkout can't read. Suffix order: +moab<n>, +camo, +min<n>, +between-rounds.
export function parseSpeedLabel(label) {
 if (label == null) return null;
 let s = String(label);
 const betweenRounds = s.endsWith(BETWEEN_ROUNDS_SUFFIX);
 if (betweenRounds) s = s.slice(0, -BETWEEN_ROUNDS_SUFFIX.length);
 const min = /\+min(\d)$/.exec(s);
 if (min) s = s.slice(0, min.index);
 const camoMargin = s.endsWith('+camo');
 if (camoMargin) s = s.slice(0, -'+camo'.length);
 const moab = /\+moab(\d)$/.exec(s);
 if (moab) s = s.slice(0, moab.index);
 try { return {...parseSpeedMode(s), moabShortSpeed: moab ? Number(moab[1]) : MIN_SPEED, betweenRounds, ...(camoMargin ? {camoMargin} : {}), ...(min ? {minSpeed: Number(min[1])} : {}), label: String(label)}; } catch { return null; }
}

// A danger signal a speed_set reason starts with (speed.mjs gradedSpeed: "drop: lives_lost, ..."), or null for a
// margin reason.
const DANGER_REASON = /^(?:match_start: )?(?:start|drop|up): (lives_lost|bloons_past_[\d.]+|moab_outrun|leak_pressure|moab_short|consult:\w+)/;

const probList = probs => Object.entries(probs ?? {}).sort((a, b) => b[1] - a[1]).map(([id, p]) => ({id, p}));

// One decision record without its state and full options, for the feed.
export function decisionItem(e, n) {
 const s = e.state;
 return {n, time: e.time, round: s?.round?.number ?? null, cash: s?.cash != null ? Math.floor(s.cash) : null, lives: s?.lives ?? null,
  source: e.decisionSource ?? null, model: e.model ?? null, chosen: e.chosen ? {id: e.chosen.id, label: e.chosen.label} : null, outcome: e.outcome ?? null,
  result: e.result ? {status: e.result.status ?? null, reason: e.result.reason ?? null, detail: e.result.detail ?? null} : null,
  usage: e.usage ?? null, confidence: e.answer?.confidence ?? null,
  move: probList(e.answer?.probabilities), group: e.group_answer ? probList(e.group_answer.probabilities) : null, narrowed: e.narrowed ?? null,
  options: Array.isArray(e.options) ? e.options.length : null, option_ids: Array.isArray(e.options) ? e.options.slice(0, 120) : [],
  constraint: e.constraint ? {kind: e.constraint.kind ?? null, removed: e.constraint.removed ?? null, rules: e.constraint.rules ?? []} : null,
  overrides: e.tie_break ?? [], plan: e.plan ?? null};
}

// What one run log holds, kept as it is read. add(record) takes each record in order.
export function runModel(file) {
 const m = {file, session: null, start: null, end: null, sessionEnd: null, decisions: [], counts: {decisions: 0, held: 0, executed: 0, queued: 0, rejected: 0, other: 0},
  tokens: {input: 0, output: 0, requests: 0}, ruleCounts: {}, overrideCounts: {}, speedSets: [], speedSetCount: 0, speedRounds: [], popsRounds: [], moabMeasures: [],
  aimChecks: [], aims: 0, requests: [], planTargets: new Map(), warnings: [], rejected: [], dispatches: 0, screenshots: 0, calibration: [],
  lastState: null, lastStateTime: null, lastDecision: null, dangerRound: null, spots: null};
 m.add = e => {
  switch (e.kind) {
   case 'session_start': m.session = e; break;
   case 'run_start': m.start = e; break;
   case 'run_end': m.end = e; if (e.state) Object.assign(m, {lastState: e.state, lastStateTime: e.time}); break;
   case 'session_end': m.sessionEnd = e; break;
   case 'decision': {
    m.counts.decisions++;
    const o = e.outcome;
    if (o in m.counts && o !== 'decisions') m.counts[o]++; else m.counts.other++;
    if (e.usage) { m.tokens.input += e.usage.input_tokens ?? 0; m.tokens.output += e.usage.output_tokens ?? 0; if (e.usage.input_tokens) m.tokens.requests++; }
    for (const r of e.constraint?.rules ?? []) m.ruleCounts[r.kind] = (m.ruleCounts[r.kind] ?? 0) + 1;
    for (const r of e.tie_break ?? []) { const k = r.kind ?? 'tie_break'; m.overrideCounts[k] = (m.overrideCounts[k] ?? 0) + 1; }
    push(m.decisions, decisionItem(e, m.counts.decisions), KEEP.decisions);
    m.lastDecision = {chosen: e.chosen, outcome: e.outcome, time: e.time};
    if (e.state?.in_game) Object.assign(m, {lastState: e.state, lastStateTime: e.time});
    break;
   }
   case 'speed_set': {
    m.speedSetCount++;
    push(m.speedSets, {time: e.time, round: e.round, speed: e.speed, reason: e.reason, cap: e.cap ?? null, margins: e.margins ?? null, status: e.status, refused: e.refused ?? null}, KEEP.speedSets);
    if (DANGER_REASON.test(e.reason ?? '')) m.dangerRound = e.round;
    break;
   }
   case 'speed_round': m.speedRounds.push({round: e.round, seconds: e.seconds ?? {}, slow_s: e.slow_s ?? null}); break;
   case 'pops_round': push(m.popsRounds, e, KEEP.popsRounds); break;
   case 'moab_measure': m.moabMeasures.push(e); break;
   case 'aim_check': push(m.aimChecks, e, KEEP.aimChecks); break;
   case 'aim': m.aims++; break;
   case 'strategy_request': m.requests.push({request_id: e.request_id, reason: e.reason, time: e.time, blocking: Boolean(e.blocking), adopted: null, timeout: null}); break;
   case 'strategy_adopted': case 'strategy_timeout': {
    const r = m.requests.find(x => x.request_id === e.request_id) ?? (m.requests.push({request_id: e.request_id, reason: e.reason, time: null, blocking: false, adopted: null, timeout: null}), m.requests.at(-1));
    if (e.kind === 'strategy_adopted') r.adopted = {time: e.time, latency_ms: e.latency_ms ?? null, late: Boolean(e.late), plan: e.plan ?? null};
    else r.timeout = {time: e.time, waited_ms: e.waited_ms ?? null};
    break;
   }
   case 'plan_target': m.planTargets.set(e.id, e); break;
   case 'dispatch': m.dispatches++; if (['rejected', 'failed', 'unknown'].includes(e.outcome)) push(m.rejected, {time: e.time, outcome: e.outcome, reason: e.result?.reason ?? e.message ?? null}, KEEP.rejected); break;
   case 'screenshot': m.screenshots++; break;
   case 'calibration_recorded': m.calibration.push(e); break;
   case 'spots': m.spots = {count: e.count, map: e.map}; break;
   case 'warning': case 'error': case 'runner_paused': case 'popup_unhandled': case 'jev_timeout': case 'bridge_read_timeout':
    push(m.warnings, {time: e.time, kind: e.kind, message: e.message ?? e.reason ?? null, ...(e.source ? {source: e.source} : {})}, KEEP.warnings); break;
   default: break;
  }
 };
 return m;
}

// The first 64 KB of a file as text (session_start is among the first records), or ''.
async function readHead(file, bytes = 65536) {
 let fh;
 try { fh = await open(file, 'r'); } catch { return ''; }
 try { const buf = Buffer.alloc(bytes); const {bytesRead} = await fh.read(buf, 0, bytes, 0); return buf.subarray(0, bytesRead).toString('utf8'); }
 finally { await fh.close(); }
}

// The short record of a run log for the history: from its first and last records only.
export function summarizeRun(file, records) {
 const start = records.find(e => e.kind === 'run_start'), session = records.find(e => e.kind === 'session_start');
 const end = records.findLast(e => e.kind === 'run_end'), sessionEnd = records.findLast(e => e.kind === 'session_end');
 return {file, match_id: start?.match_id ?? end?.match_id ?? sessionEnd?.match_id ?? null, time: start?.time ?? session?.time ?? null,
  policy: start?.policy ?? session?.policy ?? null, revision: start?.policy_revision ?? null, speed: start?.speed ?? session?.speed ?? null,
  ruleset: start?.ruleset?.id ?? session?.ruleset ?? null, dry_run: session?.dry_run ?? null,
  result: end?.result ?? null, round: end?.state?.round?.number ?? null, lives: end?.state?.lives ?? null,
  ended: sessionEnd ? sessionEnd.reason : null, message: sessionEnd?.message ?? null, decisions: sessionEnd?.decisions ?? null,
  bridge_port: logBridgePort(file, session ?? start), input_tokens: sessionEnd?.usage?.inputTokens ?? null, minutes: end?.speed_time?.total_s != null ? +(end.speed_time.total_s / 60).toFixed(1) : null};
}

// Summaries of every run log in dir, re-read only for files whose size changed. Only the lines that
// summarizeRun needs are parsed.
export function historyScanner(dir) {
 const cache = new Map();
 const WANT = /"kind":"(run_start|run_end|session_start|session_end)"/;
 return async () => {
  const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.jsonl')).sort();
  const out = [];
  for (const f of files) {
   const size = (await stat(join(dir, f)).catch(() => null))?.size ?? 0;
   const hit = cache.get(f);
   if (hit?.size === size) { out.push(hit.summary); continue; }
   const text = await readFile(join(dir, f), 'utf8').catch(() => '');
   const records = text.split('\n').filter(l => WANT.test(l)).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
   const summary = summarizeRun(f, records);
   cache.set(f, {size, summary});
   out.push(summary);
  }
  return out;
 };
}

// series.jsonl: one entry per run start (no kind) and a profile_check entry per end. The current series is the
// run of consecutive start entries, up to the last, with the same speed label, ruleset, bridge version, setup,
// pinned factors and dry-run flag (the policies alternate inside a series).
export const seriesKey = e => JSON.stringify([e.speed ?? null, e.ruleset?.id ?? null, e.bridge_version ?? null,
 e.setup ? `${e.setup.map}/${e.setup.difficulty}/${e.setup.mode}` : null, e.calibration?.moab?.source === 'pinned' ? e.calibration.moab.factor : null,
 e.calibration?.pops?.source === 'pinned' ? e.calibration.pops.factor : null, Boolean(e.dry_run)]);

export function currentSeries(entries) {
 const starts = entries.filter(e => !e.kind && e.run);
 if (!starts.length) return null;
 const key = seriesKey(starts.at(-1));
 let i = starts.length - 1;
 while (i > 0 && seriesKey(starts[i - 1]) === key) i--;
 // Both game copies' runs are in the series; bridge_port says which copy (15527 for entries from before the field).
 const runs = starts.slice(i).map(e => ({run: e.run, time: e.time, policy: e.policy, revision: e.policy_revision ?? null, bridge_port: e.bridge_port ?? DEFAULT_BRIDGE_PORT}));
 const last = starts.at(-1);
 return {key: {speed: last.speed ?? null, ruleset: last.ruleset?.id ?? null, bridge: last.bridge_version ?? null,
  moab_factor: last.calibration?.moab?.factor ?? null, pops_factor: last.calibration?.pops?.factor ?? null, dry_run: Boolean(last.dry_run)},
  since: runs[0].time, runs, position: runs.length,
  by_policy: runs.reduce((o, r) => ({...o, [r.policy]: (o[r.policy] ?? 0) + 1}), {})};
}

export async function readSeries(file) {
 const text = await readFile(file, 'utf8').catch(() => '');
 return text.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// The dashboard's own reads of the match: lives at each round start and v3's leak pressure (policy-v3.mjs), which
// the runner keeps in memory only. Fed every state the dashboard sees, bridge or log.
export function liveTracker() {
 const k = {match: null, livesAt: new Map(), pressure: pressureTracker(), dangerRound: null, last: null};
 k.observe = s => {
  if (!s?.in_game) return;
  if (s.match.id !== k.match) Object.assign(k, {match: s.match.id, livesAt: new Map(), pressure: pressureTracker(), dangerRound: null});
  if (!k.livesAt.has(s.round.number)) k.livesAt.set(s.round.number, s.lives);
  k.pressure.observe(s);
  k.last = s;
 };
 k.livesLost = s => Math.max(s.round.lives_lost ?? 0, k.livesAt.has(s.round.number) ? k.livesAt.get(s.round.number) - s.lives : 0);
 return k;
}

// The calibration the run recorded, applied to this process's estimate modules; returns what was applied.
function applyCalibration(start) {
 const moab = start?.calibration?.moab, pops = start?.calibration?.pops;
 try { setMoabCalibration(moab?.factor ?? 1); } catch { setMoabCalibration(1); }
 try { setPopsCalibration(pops?.factor ?? 1, {fromRound: pops?.from_round ?? 1}); } catch { setPopsCalibration(1); }
 // btd6-jev-v4 runs estimate with the frozen table (session.mjs, towers.mjs setTowerTable).
 setTowerTable(start?.policy === 'btd6-jev-v4' ? 'v4' : 'current');
 setEarlyMargin(earlyMarginFor(start?.policy));
 // The DDT check by the run's policy and revision (moab.mjs DDT_CHECK_FROM); a run without a revision predates it.
 setDdtCheck(ddtCheckFor(start?.policy, start?.policy_revision ?? 0));
 // moab_short's lead for DDT rounds by the run's policy and revision (moab.mjs MOAB_DDT_LEAD_FROM).
 setMoabDdtLead(moabDdtLeadFor(start?.policy, start?.policy_revision ?? 0));
 // The support-effects DDT figure and the deadline-based need by the run's policy and revision (moab.mjs DDT_SUPPORT_FROM, DDT_NEED_FROM).
 setDdtSupport(ddtSupportFor(start?.policy, start?.policy_revision ?? 0));
 setDdtNeed(ddtNeedFor(start?.policy, start?.policy_revision ?? 0));
 // gradedSpeed's calibrated flag: the setup's MOAB calibration was measured (session.mjs: calibration.runs > 0).
 const measured = s => typeof s === 'string' && s.startsWith('measured');
 return {moab: moabCalibration(), pops: popsCalibration(), moab_source: moab?.source ?? null, pops_source: pops?.source ?? null,
  calibrated: measured(moab?.source) || measured(moab?.stored?.source)};
}

const r2 = v => v == null || !Number.isFinite(v) ? v ?? null : +v.toFixed(2);

// The speed, caps and danger panel for a state: recomputed with speed.mjs. mode: parseSpeedLabel's result.
export function speedPanel(state, {paths = [], mode = null, hard = null, calibrated = false, dangerRound = null, lastDecision = null, now = Date.now(), tracker = null, openConsult = null} = {}) {
 const margins = defenceMargins(state, paths, {camo: Boolean(mode?.camoMargin)});
 const max = mode?.mode === 'graded' ? mode.max : null;
 const grade = max != null ? gradeFor(margins.margin, max, mode.camoMargin ? GRADE_AT_CAMO : GRADE_AT) : null;
 const buying = Boolean(lastDecision && isPurchase(lastDecision) && now - Date.parse(lastDecision.time) < BUYING_MS);
 const caps = speedCaps(state.round.number, {calibrated, dangerRound, margins, hard, endRound: state.match.end_round ?? null, buying});
 const limit = grade != null ? Math.min(grade, ...caps.map(c => c.speed)) : null;
 const livesLost = tracker ? tracker.livesLost(state) : (state.round.lives_lost ?? 0);
 const pressure = tracker ? tracker.pressure.status() : null;
 // The graded speed's moab_short signal keeps MOAB_LEAD_ROUNDS for DDT rounds too (session.mjs).
 const short = moabShort(state, paths, {ddtLead: MOAB_LEAD_ROUNDS});
 const consult = openConsult && SLOW_CONSULTS.includes(openConsult) ? openConsult : null;
 const danger = dangerSignals(state, {livesLost, pressure, moabShort: Boolean(short), consult, paths});
 const speed = observedSpeed(state);
 const b = state.bloons ?? null;
 const outrun = moabOutrun(state, paths);
 const hardDanger = danger.filter(d => !(d === 'moab_short' && (mode?.moabShortSpeed ?? 1) > MIN_SPEED));
 const floor = mode?.minSpeed ?? MIN_SPEED;
 const expected = limit == null ? null : Math.max(floor, hardDanger.length ? MIN_SPEED : danger.length ? Math.min(limit, mode.moabShortSpeed) : limit);
 return {speed, mode: mode?.label ?? null, max,
  margins: {...margins, grade},
  caps: caps.map(c => ({...c, lowers: grade != null && c.speed < grade})), buying, limit, expected,
  danger, emergencies: danger.filter(d => EMERGENCIES.some(e => d === e || (e === 'bloons_past' && d.startsWith('bloons_past_')))),
  signals: {
   lives_lost: livesLost,
   bloons: b ? {count: b.count ?? 0, furthest: b.furthest ?? null, threshold: dangerProgress(speed), moab_class: b.moab_class ?? 0} : null,
   moab_outrun: outrun,
   leak_pressure: pressure,
   moab_short: short ? {round: short.round, dps: short.dps, needs_dps: short.needs_dps, ratio: short.ratio} : null,
   consult: openConsult ?? null,
  },
  danger_round: dangerRound};
}

// The upcoming rounds from the round data, each with the hard-round reasons and the checks the rules use.
// leadDdt: count DDTs in lead_capacity's Lead RBE, as the run's revision did (threat.mjs leadDdtFor); leadAt: its threshold (leadAtFor); camoRate: camo_capacity on the camo rate (camoRateFor).
export function roundsPanel(state, {paths = [], hard = null, calibrated = false, count = UPCOMING_ROUNDS, leadDdt = false, leadAt = LEAD_CAPACITY_AT, camoRate = false} = {}) {
 const now = state.round.number, end = state.match.end_round ?? 100, lives = state.lives;
 const out = [];
 for (let r = now; r <= Math.min(end, now + count); r++) {
  const f = roundFacts(r);
  if (!f) { out.push({round: r, known: false}); continue; }
  const c = roundCheck(state.towers, r, {lives, paths, useReach: true});
  const m = moabCheck(state.towers, r, {lives, paths});
  out.push({round: r, known: true, bloons: f.bloons, rbe: f.rbe, seconds: f.seconds, peak: f.peak ?? null, camo: f.camo, camo_lead: f.camo_lead ?? 0,
   regrow: f.regrow, fortified: f.fortified, first: f.first ?? [], hard: hard?.rounds?.get(r) ?? null, composition: compositionCap(r, {calibrated})?.reason ?? null,
   check: c ? {ratio: c.ratio, can_pop: c.can_pop, needs: c.needs, camo: c.camo, lead: c.lead, camo_lead: c.camo_lead, early: c.early, burst: c.burst,
    burst_ratio: c.burst_facts?.ratio ?? null, enough: c.enough} : null,
   moab: m ? {bloons: m.bloons, dps: m.dps, needs_dps: m.needs_dps, ratio: m.ratio, enough: m.enough} : null});
 }
 return {rounds: out, threat_short: threatShort(state, paths, {kinds: THREAT_KINDS_V4, burstLead: THREAT_BURST_ROUNDS, leadDdt, leadAt, camoRate}), end_round: end};
}

// The towers on the map, with the estimates the rules use and the pops the bridge counts (0.3.13).
export function towersPanel(state, paths = []) {
 return state.towers.map(t => {
  const e = towerEstimate(t), aim = aimStatus(t, paths);
  return {id: t.id, base_id: t.base_id, tiers: t.tiers, targeting: t.targeting ?? null, target_point: t.target_point ?? null, aim: aim.kind,
   pops: Number.isFinite(t.pops) ? t.pops : null, pps: e ? r2(effectivePps(t, paths)) : null, moab_dps: e ? r2(towerMoab(t, paths).effective) : null,
   camo: e?.camo ?? null, lead: e?.lead ?? null, x: t.x, y: t.y};
 });
}

const secondsBySpeed = rounds => rounds.reduce((o, r) => { for (const [s, v] of Object.entries(r.seconds)) o[s] = +((o[s] ?? 0) + v).toFixed(1); return o; }, {});

// The plan in force: claude-v1's last adopted plan, v5's playbook phase from the last decision, or none.
export function planPanel(model, playbook = null) {
 const policy = model.start?.policy ?? model.session?.policy ?? '';
 const targets = [...model.planTargets.values()];
 const requests = model.requests.map(r => ({request_id: r.request_id, reason: r.reason, time: r.time, blocking: r.blocking,
  adopted: r.adopted ? {time: r.adopted.time, latency_ms: r.adopted.latency_ms, late: r.adopted.late, summary: r.adopted.plan?.summary ?? null} : null,
  timeout: r.timeout, open: !r.adopted && !r.timeout}));
 if (policy.includes('claude')) {
  const plan = model.requests.findLast(r => r.adopted?.plan)?.adopted.plan ?? null;
  const latencies = requests.filter(r => r.adopted?.latency_ms != null).map(r => r.adopted.latency_ms);
  return {kind: 'strategist', plan: plan && {summary: plan.summary, hero: plan.hero, build: plan.build, cash_hold: plan.cash_hold, threats: plan.threats,
   review_round: plan.review_round ?? null, note: plan.note ?? null, reason: plan.reason ?? null, round_at: plan.round_at ?? null, adopted_at: plan.adopted_at ?? null},
   requests: requests.slice(-20).reverse(), open: requests.find(r => r.open) ?? null, targets,
   latency: latencies.length ? {n: latencies.length, median_ms: [...latencies].sort((a, b) => a - b)[latencies.length >> 1], max_ms: Math.max(...latencies)} : null};
 }
 if (policy.includes('playbook')) {
  const p = model.decisions.findLast(d => d.plan)?.plan ?? null;
  const phase = p && playbook ? playbook.phases?.find(x => x.id === p.phase) ?? null : null;
  const branches = p && playbook ? (playbook.branches ?? []).filter(b => (p.branches ?? []).includes(b.id)) : [];
  return {kind: 'playbook', playbook: p ? {id: p.playbook, version: p.version, revision: p.revision} : null, phase: p?.phase ?? null, due: p?.due ?? [], hold: p?.hold ?? null,
   branches: p?.branches ?? [], phase_plan: phase && {summary: phase.summary, from_round: phase.from_round, to_round: phase.to_round, build: phase.build, cash_hold: phase.cash_hold, threats: phase.threats},
   branch_notes: branches.map(b => ({id: b.id, note: b.note ?? null})), targets};
 }
 return {kind: 'none', policy};
}

// The whole view. run: runModel of the newest log, or null. bridge: {up, state, health, error, at}. paths: the
// active map's paths (from the bridge's /api/v1/map), or []. history: historyScanner's summaries.
export function buildView({run = null, bridge = null, paths = [], history = [], series = [], tracker = null, playbook = null, now = Date.now(), runsDir = null}) {
 const start = run?.start ?? null, session = run?.session ?? null;
 const bridgeState = bridge?.up && bridge.state?.in_game ? bridge.state : null;
 const logState = run?.lastState?.in_game ? run.lastState : null;
 const state = bridgeState ?? logState;
 const stateSource = bridgeState ? 'bridge' : logState ? 'log' : null;
 const mismatch = bridgeState && start?.match_id && bridgeState.match.id !== start.match_id ? {bridge: bridgeState.match.id, log: start.match_id} : null;
 const cal = applyCalibration(start ?? session);
 const mode = parseSpeedLabel(start?.speed ?? session?.speed ?? null);
 const setup = start?.setup ?? session?.setup ?? (state ? {map: state.match.map, difficulty: state.match.difficulty, mode: state.match.mode} : null);
 const hard = mode?.mode === 'graded' && setup ? hardRoundsFor(setup) : null;
 const openConsult = run?.requests.find(r => !r.adopted && !r.timeout)?.reason ?? null;
 const s = series.length ? currentSeries(series) : null;
 // A series entry's run log: the same match ID (dry runs all use dry-1), nearest in start time.
 const logFor = r => history.filter(h => h.match_id === r.run && (h.bridge_port ?? DEFAULT_BRIDGE_PORT) === (r.bridge_port ?? DEFAULT_BRIDGE_PORT)).sort((a, b) => Math.abs(Date.parse(a.time) - Date.parse(r.time)) - Math.abs(Date.parse(b.time) - Date.parse(r.time)))[0] ?? {};
 const header = {
  policy: start?.policy ?? session?.policy ?? null, revision: start?.policy_revision ?? null, ruleset: start?.ruleset?.id ?? session?.ruleset ?? null,
  speed: mode?.label ?? start?.speed ?? session?.speed ?? null, calibration: {moab: cal.moab, moab_source: cal.moab_source, pops: cal.pops.factor, pops_from: cal.pops.from_round, pops_source: cal.pops_source, measured: cal.calibrated},
  match_id: start?.match_id ?? null, setup: setup ? `${setup.map} ${setup.difficulty} ${start?.setup?.mode_name ?? setup.mode}` : null,
  bridge_version: bridge?.health?.version ?? start?.bridge_version ?? session?.bridge?.version ?? null, game_version: start?.game_version ?? null,
  dry_run: session?.dry_run ?? null, log: run?.file ?? null, runs_dir: runsDir, bridge_port: run ? logBridgePort(run.file, session ?? start) : null,
  tower_data: {run: start?.tower_data?.version ?? null, here: TOWER_DATA_VERSION, same: start?.tower_data?.version ? start.tower_data.version === TOWER_DATA_VERSION : null},
  playbook: session?.playbook ?? null,
  series: s && {position: s.position, since: s.since, by_policy: s.by_policy, key: s.key, this_run: start?.match_id ? s.runs.findLastIndex(r => r.run === start.match_id) + 1 || null : null},
 };
 const match = state ? {
  source: stateSource, at: stateSource === 'bridge' ? bridge.at : run?.lastStateTime ?? null, id: state.match.id, round: state.round.number, final_round: state.match.end_round ?? null,
  round_active: Boolean(state.round.active), lives: state.lives, starting_lives: state.starting_lives ?? null, cash: Math.floor(state.cash), result: state.match.result ?? null,
  speed: observedSpeed(state), paused: state.paused ?? null, auto_start: state.auto_start ?? null, bloons: state.bloons ?? null,
  towers: towersPanel(state, paths), moab_dps: r2(moabDps(state.towers, paths))} : null;
 // After the result the panels still show the last state, for review; the page marks the match as over.
 const active = Boolean(state);
 // The last round with danger: from the log's speed_set reasons and, live, the dashboard's own reads.
 const dangerRounds = [run?.dangerRound, tracker?.dangerRound].filter(r => r != null);
 const speed = active ? speedPanel(state, {paths, mode, hard, calibrated: cal.calibrated, dangerRound: dangerRounds.length ? Math.max(...dangerRounds) : null,
  lastDecision: run?.lastDecision ?? null, now, tracker, openConsult}) : null;
 if (speed && tracker && speed.danger.length && bridgeState) tracker.dangerRound = state.round.number;
 const speedTime = run?.end?.speed_time ?? {seconds: secondsBySpeed(run?.speedRounds ?? []), from: 'speed_round records'};
 return {
  now: new Date(now).toISOString(), header,
  bridge: bridge ? {up: Boolean(bridge.up), enabled: bridge.enabled !== false, error: bridge.error ?? null, at: bridge.at ?? null, since: bridge.since ?? null,
   version: bridge.health?.version ?? null, main_thread_pumping: bridge.health?.main_thread_pumping ?? null, screen: bridge.state && !bridge.state.in_game ? (bridge.state.screen ?? 'not in a match') : null} : null,
  paths: {count: paths.length, from: paths.length ? 'bridge /api/v1/map' : null},
  state_mismatch: mismatch,
  match, speed,
  speed_log: run ? {sets: run.speedSets.slice(-12).reverse(), count: run.speedSetCount, time: speedTime} : null,
  rounds: active ? roundsPanel(state, {paths, hard, calibrated: cal.calibrated, leadDdt: leadDdtFor(start?.policy ?? session?.policy, start?.policy_revision ?? 0),
   leadAt: leadAtFor(start?.policy ?? session?.policy, start?.policy_revision ?? 0), camoRate: camoRateFor(start?.policy ?? session?.policy, start?.policy_revision ?? 0)}) : null,
  hard_source: hard?.source ?? null,
  decisions: run ? {items: run.decisions.slice(-60).reverse(), counts: run.counts, tokens: run.tokens, rules: run.ruleCounts, overrides: run.overrideCounts} : null,
  plan: run ? planPanel(run, playbook) : null,
  measurements: run ? {pops_rounds: run.popsRounds.slice(-8).reverse(), moab: run.moabMeasures.slice(-10).reverse(), aim_checks: run.aimChecks.slice(-8).reverse(), aims: run.aims} : null,
  run: run ? {result: run.end?.result ?? null, ended: run.sessionEnd?.reason ?? null, message: run.sessionEnd?.message ?? null, warnings: run.warnings.slice(-8).reverse(),
   rejected: run.rejected.slice(-5).reverse(), dispatches: run.dispatches, screenshots: run.screenshots} : null,
  history: {series: s ? s.runs.map(r => ({...r, ...logFor(r), run: r.run, time: r.time})).reverse() : [],
   recent: history.slice(-12).reverse()},
 };
}
