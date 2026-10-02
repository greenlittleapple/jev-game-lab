// Progress measure for BTD6: the round reached on a fixed map, difficulty and mode, lives left, and
// whether the final round was cleared (a win). Used by the scorecard and the version chart.
import {THREATS} from './rounds.mjs';
import {profileStatus} from './profile.mjs';

export const runOf = e => e.match_id ?? e.state?.match?.id ?? null;

// The speed a run was set to (speed.mjs: a number, "graded:<max>" or "adaptive:<cruise>/<pressure>", with
// "+between-rounds" in between-rounds mode), or for runs before --speed, what the game reported at the
// start: fast-forward off is 1, on is its time scale (3 unless changed).
export function runSpeed(start) {
 if (Number.isFinite(start?.speed) || (typeof start?.speed === 'string' && start.speed)) return start.speed;
 const c = start?.conditions;
 if (typeof c?.fast_forward !== 'boolean') return null;
 return c.fast_forward ? c.multiplier ?? 3 : 1;
}

export const isAdaptive = speed => typeof speed === 'string' && speed.startsWith('adaptive');
// A run's speed series: '' for a fixed speed, else "adaptive", "graded", "between rounds" (a fixed speed in
// between-rounds mode), "adaptive between rounds" or "graded between rounds".
export function speedVariant(speed) {
 if (typeof speed !== 'string') return '';
 const kind = speed.startsWith('adaptive') ? 'adaptive' : speed.startsWith('graded') ? 'graded' : '';
 return [kind, speed.endsWith('+between-rounds') ? 'between rounds' : ''].filter(Boolean).join(' ');
}
const VARIANTS = ['adaptive', 'graded', 'between rounds', 'adaptive between rounds', 'graded between rounds'];
const HOW = {adaptive: 'adaptive game speed (--speed adaptive)', graded: 'graded game speed (--speed graded)', 'between rounds': 'between-rounds purchases (--between-rounds)'};
const variantText = variant => HOW[variant] ?? `${HOW[variant.replace(' between rounds', '')]} and ${HOW['between rounds']}`;

// Wall-clock minutes of a run and minutes at the slow (pressure) speed, from run_end's speed_time; runs
// without it are timed from their first to their last logged event, with no slow time.
export function runMinutes(events, end) {
 const min = s => s == null ? null : Math.round(s / 6) / 10;
 if (end?.speed_time) return {wall_min: min(end.speed_time.total_s), slow_min: min(end.speed_time.slow_s)};
 const times = events.map(e => Date.parse(e.time)).filter(Number.isFinite);
 return {wall_min: times.length > 1 ? min((Math.max(...times) - Math.min(...times)) / 1000) : null, slow_min: null};
}

// A Jev decision is a near tie when the top two probabilities of one of its answers (the group or the move)
// are less than NEAR_TIE apart. Jev has no temperature or seed, and its probabilities vary by a few points
// between identical calls, so near ties can go either way.
export const NEAR_TIE = 0.1;
export function answerMargin(answer) {
 const p = Object.values(answer?.probabilities ?? {}).filter(Number.isFinite).sort((a, b) => b - a);
 return p.length >= 2 ? p[0] - p[1] : null;
}
// Over the Jev decisions whose answers have probabilities: {near, of} and the playbook's tie-breaks
// ({considered, switched}; btd6-jev-v6's majority_wait records are counted under Rules instead).
export function nearTies(decisions) {
 const margins = decisions.filter(e => e.decisionSource === 'jev')
  .map(e => [e.group_answer, e.answer].map(answerMargin).filter(m => m != null)).filter(m => m.length).map(m => Math.min(...m));
 const breaks = decisions.flatMap(e => e.tie_break ?? []).filter(b => b.kind !== 'majority_wait');
 return {near: margins.filter(m => m < NEAR_TIE).length, of: margins.length, tie_breaks: {considered: breaks.length, switched: breaks.filter(b => b.switched).length}};
}

// How far a plan (claude-v1's or v5's playbook) was followed: targets met by their round (plan_target
// records), holds that held against holds lifted and why (cash_hold, cash_hold_lifted, survival_first with
// a hold), and decisions where the plan filters were skipped for survival_first. null without a plan.
export function planAdherence(events, decisions) {
 const planned = decisions.filter(e => e.plan);
 if (!planned.length) return null;
 const targets = events.filter(e => e.kind === 'plan_target');
 const lifted = {};
 let kept = 0, survival = 0;
 for (const e of planned) {
  const rules = e.constraint?.rules ?? [];
  if (rules.some(r => r.kind === 'cash_hold')) kept++;
  for (const r of rules.filter(r => r.kind === 'cash_hold_lifted')) { const why = r.reason ?? r.floor ?? 'other'; lifted[why] = (lifted[why] ?? 0) + 1; }
  const s = rules.find(r => r.kind === 'survival_first');
  if (s) { survival++; if (s.hold) lifted.survival_first = (lifted.survival_first ?? 0) + 1; }
 }
 return {targets: {met: targets.filter(t => t.done).length, of: targets.length, missed: targets.filter(t => !t.done).map(t => t.id)},
  holds: {kept, lifted}, survival_skips: survival, decisions: planned.length};
}

export const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Bridge 0.3.13 pops against the estimates (pops.mjs): the median of each round's measured pops over its
// estimate with reach, and the aim checks whose tower's pops rose within 10 s of game time. Null without records.
export function measuredPops(events) {
 const rounds = events.filter(e => e.kind === 'pops_round' && e.est_reach > 0).map(e => e.pops / e.est_reach);
 const checks = events.filter(e => e.kind === 'aim_check' && e.complete);
 if (!rounds.length && !checks.length) return null;
 const m = median(rounds);
 return {rounds: rounds.length, median_ratio: m == null ? null : +m.toFixed(2), aim_checks: checks.length, aim_rose: checks.filter(e => e.gained > 0).length};
}

// The MOAB and pops calibration factors a run played with (run_start calibration) and which of them were pinned
// (--moab-factor, --pops-factor), or null for runs logged before calibration was recorded.
export function runCalibration(start) {
 const c = start?.calibration;
 if (!Number.isFinite(c?.moab?.factor) || !Number.isFinite(c?.pops?.factor)) return null;
 return {moab_factor: c.moab.factor, pops_factor: c.pops.factor, pinned: ['moab', 'pops'].filter(k => c[k].source === 'pinned')};
}

export function scoreRun(run) {
 const start = run.events.find(e => e.kind === 'run_start') ?? run.series ?? null;
 const decisions = run.events.filter(e => e.kind === 'decision');
 // Placements and upgrades are answered "queued" and settle a frame later; the settled dispatch record
 // names the command, so a queued decision counts once its command executed.
 const settled = new Set(run.events.filter(e => e.kind === 'dispatch' && e.outcome === 'executed').map(e => e.command_id));
 const done = e => e.outcome === 'executed' || (e.outcome === 'queued' && settled.has(e.command_id ?? e.result?.command_id));
 const executed = decisions.filter(done);
 const end = run.events.findLast(e => e.kind === 'run_end');
 const states = run.events.map(e => e.state).filter(s => s?.in_game);
 const last = end?.state ?? states.at(-1) ?? null;
 const result = !end ? 'in progress' : end.result === 'victory' ? 'won' : 'lost';
 const final = last?.match?.end_round ?? null;
 const reached = Math.max(0, ...states.map(s => s.round?.number).filter(Number.isFinite));
 // Lives lost, counted in the round they were observed lost.
 const leaks = new Map();
 for (let i = 1; i < states.length; i++) {
  const lost = states[i - 1].lives - states[i].lives;
  if (lost > 0) leaks.set(states[i].round.number, (leaks.get(states[i].round.number) ?? 0) + lost);
 }
 // Rule counts include btd6-jev-v6's majority_wait overrides, which are recorded in tie_break.
 const rules = {};
 for (const e of executed) for (const r of [...(e.constraint?.rules ?? []), ...(e.tie_break ?? []).filter(b => b.kind === 'majority_wait')]) (rules[r.kind] ??= {fired: 0}).fired++;
 const source = s => executed.filter(e => e.decisionSource === s).length;
 const adopted = run.events.filter(e => e.kind === 'strategy_adopted');
 const latency = median(adopted.map(e => e.latency_ms).filter(Number.isFinite));
 return {
  policy: [...new Set(decisions.map(e => e.policy).filter(Boolean))].join('+') || null, decisions: decisions.length,
  ruleset: start?.ruleset?.id ?? null, unlock_all: start?.unlock_all ?? null, profile: profileStatus(run.events), speed: runSpeed(start),
  setup: last?.match ? [last.match.map, last.match.difficulty, last.match.mode_name ?? last.match.mode].join(' ') : null,
  ...(start?.zero_leak === true ? {zero_leak: true} : {}),
  result, round_reached: result === 'won' && final ? final : reached, final_round: final,
  ...runMinutes(run.events, end),
  lives_left: last?.lives ?? null, starting_lives: last?.starting_lives ?? null,
  leak_rounds: [...leaks].map(([round, lives]) => ({round, lives})),
  cash_end: last ? Math.floor(last.cash) : null,
  placed: executed.filter(e => e.chosen?.command?.action === 'place_tower').length,
  upgrades: executed.filter(e => e.chosen?.command?.action === 'upgrade_tower').length,
  moves: executed.filter(e => e.decisionSource !== 'forced').length,
  screens_dismissed: executed.filter(e => e.decisionSource === 'forced' && e.chosen?.command?.action === 'dismiss_popup').map(e => e.chosen?.label).filter(Boolean),
  aims: executed.filter(e => e.decisionSource === 'forced' && /^set_target/.test(e.chosen?.command?.action ?? '')).length,
  sources: {jev: source('jev'), plan: source('plan'), rules: source('rules'), single_option: source('single_option')},
  plan_adherence: planAdherence(run.events, decisions),
  moab_measured: (m => m.length ? {rounds: m.length, median_ratio: median(m)} : null)(run.events.filter(e => e.kind === 'moab_measure' && e.ratio != null).map(e => e.ratio)),
  pops: measuredPops(run.events),
  near_ties: nearTies(decisions.filter(e => e.outcome !== 'cancelled')),
  playbook: start?.playbook ?? null, calibration: runCalibration(start),
  // The policy's revision (run_start policy_revision); a run without one is revision 1.
  revision: Number.isInteger(start?.policy_revision) ? start.policy_revision : 1,
  input_tokens: decisions.reduce((n, e) => n + (e.usage?.input_tokens ?? 0), 0),
  strategist: {requests: run.events.filter(e => e.kind === 'strategy_request').length, answers: adopted.length,
   late: adopted.filter(e => e.late).length, median_latency_s: latency == null ? null : Math.round(latency / 100) / 10},
  rules,
 };
}

// Chart data for a fixed setup: milestones are the threat rounds inside the round range.
// Far enough apart to label on a 0-100 axis.
const MILESTONE_LABELS = {camo: 'Camo', moab: 'MOAB', bfb: 'BFB', zomg: 'ZOMG', bad: 'BAD'};
export function chartMilestones({start = 1, end = 100} = {}) {
 return THREATS.filter(t => MILESTONE_LABELS[t.id] && t.round >= start && t.round <= end).map(t => ({value: t.round, label: MILESTONE_LABELS[t.id]}));
}

export const SCORE_COLUMNS = [
 ['Run', s => s.run], ['Setup', s => s.setup + (s.seed ? ` (${s.seed})` : '')], ['Policy', s => s.policy + (s.playbook ? ` (playbook ${s.playbook.version})` : '')],
 ['Ruleset', s => (s.ruleset ?? '-') + (s.unlock_all === false ? ' (account unlocks only)' : '')], ['Speed', s => s.speed ?? '-'], ['Result', s => s.result],
 ['Minutes', s => s.wall_min == null ? '-' : `${s.wall_min}${s.slow_min != null ? ` (${s.slow_min} slow)` : ''}`],
 ['Profile', s => s.profile],
 ['Round', s => `${s.round_reached}/${s.final_round ?? '?'}`], ['Lives', s => `${s.lives_left}/${s.starting_lives}`],
 ['Leaks', s => s.leak_rounds.map(l => `r${l.round}:${l.lives}`).join(' ') || '-'], ['Cash left', s => s.cash_end],
 ['Moves', s => `${s.moves} (Jev ${s.sources.jev}, plan ${s.sources.plan}, rules ${s.sources.rules ?? 0})`], ['Plan', s => { const a = s.plan_adherence; if (!a) return '-';
  const lifted = Object.entries(a.holds.lifted);
  return `targets ${a.targets.of ? `${a.targets.met}/${a.targets.of} on time` : '-'}; holds kept ${a.holds.kept}, lifted ${lifted.reduce((n, [, v]) => n + v, 0)}`
   + (lifted.length ? ` (${lifted.map(([k, v]) => `${k} ${v}`).join(', ')})` : '') + `; survival skips ${a.survival_skips}/${a.decisions}`; }],
 ['MOAB measured', s => s.moab_measured ? `x${s.moab_measured.median_ratio} the estimate (${s.moab_measured.rounds} rounds)` : '-'],
 ['Pops', s => !s.pops ? '-' : [s.pops.rounds ? `x${s.pops.median_ratio} the estimate (${s.pops.rounds} rounds)` : null,
  s.pops.aim_checks ? `aimed towers popping ${s.pops.aim_rose}/${s.pops.aim_checks}` : null].filter(Boolean).join('; ')],
 ['Near ties', s => !s.near_ties?.of ? '-' : `${Math.round(100 * s.near_ties.near / s.near_ties.of)}% (${s.near_ties.near}/${s.near_ties.of})`
  + (s.near_ties.tie_breaks.considered ? `, tie-breaks ${s.near_ties.tie_breaks.switched}/${s.near_ties.tie_breaks.considered} switched` : '')],
 ['Tokens', s => `${(s.input_tokens / 1e6).toFixed(2)}M`],
 ['Strategist', s => `${s.strategist.answers}/${s.strategist.requests} answered, ${s.strategist.late} late, median ${s.strategist.median_latency_s ?? '-'} s`],
 ['Rules', s => Object.entries(s.rules).map(([k, v]) => `${k} ${v.fired}`).join(', ') || '-'],
];

// docs/progress/btd6.json tracks each setup as its own series: setups [{id, label, match, start, end,
// lives}], and each run names its setup. Jev-only versions are tested on Hard Standard, where a leak
// costs lives instead of ending the match; CHIMPS is the final goal.
// Zero-leak runs (--zero-leak, zero-leak.mjs; run_start zero_leak: true) are on their match's setup with zero_leak: true,
// which gives them their own rows (speedSeries), so their rows and win rates never mix with normal runs.
// setupOf: the setup ID for a scored run's setup ("Tutorial Hard Standard"), or null.
export const setupOf = (data, scoredSetup) => data.setups.find(s => s.match === scoredSetup)?.id ?? null;

// A listed run's fields from its scored row (npm run btd6:progress -- --refresh). A run recorded as
// "stopped" stays stopped while its log has no result. A policy revision above 1 is stored as `revision`, and a
// ruleset other than btd6-open-v1 as `ruleset` (both give the run its own series); a run's `issues` are kept.
// The calibration factors the run played with are stored as moab_factor, pops_factor and pinned (the pinned ones),
// and a zero-leak run (run_start zero_leak: true) as zero_leak: true.
export function refreshRun(data, r, s) {
 if (!s) throw Error(`Run ${r.run} is not in the logs`);
 const setup = setupOf(data, s.setup);
 if (!setup) throw Error(`Run ${r.run} was played on ${s.setup}, which is not one of the setups`);
 Object.assign(r, {setup, seed: s.seed, result: r.result === 'stopped' && s.result === 'in progress' ? 'stopped' : s.result,
  value: s.round_reached, lives: s.lives_left, tokens: s.input_tokens, speed: s.speed});
 if (s.revision > 1) r.revision = s.revision; else delete r.revision;
 if (s.ruleset && s.ruleset !== BASE_RULESET) r.ruleset = s.ruleset; else delete r.ruleset;
 for (const k of ['moab_factor', 'pops_factor', 'pinned']) delete r[k];
 if (s.calibration) Object.assign(r, s.calibration);
 if (s.zero_leak === true) r.zero_leak = true; else delete r.zero_leak;
 if (r.issues) { const issues = r.issues; delete r.issues; r.issues = issues; }
 return r;
}

// npm run btd6:progress -- --add: lists every scored run that isn't in data yet under the version whose
// policy matches, in start order. A run whose log has no result is added as "stopped" (a run still being
// played is too; the next --refresh sets its result once the log has one). Runs where the runner made no
// move (no decisions, or none executed: the match-ID race records of bridge 0.3.6) are skipped; a run whose policy no version has, or two versions share, or whose setup isn't listed, is
// reported and left out. Mutates data; returns {added: [{run, version}], skipped, unmatched: [{run, policy|setup, reason}]}.
export function addRuns(data, scored) {
 const listed = new Set(data.versions.flatMap(v => v.runs.map(r => r.run)));
 const out = {added: [], skipped: [], unmatched: []};
 for (const s of [...scored].sort((a, b) => String(a.started).localeCompare(String(b.started)))) {
  if (listed.has(s.run)) continue;
  if (!s.decisions || !s.moves) { out.skipped.push(s.run); continue; }
  const versions = data.versions.filter(v => v.policy === s.policy);
  if (versions.length !== 1) { out.unmatched.push({run: s.run, policy: s.policy, reason: versions.length ? 'more than one version has this policy' : 'no version has this policy'}); continue; }
  if (!setupOf(data, s.setup)) { out.unmatched.push({run: s.run, setup: s.setup, reason: 'not one of the setups'}); continue; }
  const r = {run: s.run, setup: null, seed: null, result: s.result === 'in progress' ? 'stopped' : null};
  versions[0].runs.push(refreshRun(data, r, s));
  out.added.push({run: s.run, version: versions[0].name});
 }
 return out;
}

// A version's runs at a fixed speed, at adaptive speed, at graded speed and in between-rounds mode are
// separate series: the others follow the version as "<name> <variant>" (speedVariant). Its fixed-speed
// series stays, empty when it has no such runs.
// Runs under another ruleset than btd6-open-v1 (a run's `ruleset`; none recorded means v1) are their own series
// too: btd6-open-v2 leaves out the towers that need aiming, v3 aims them. So are runs of a policy revision above 1
// (a run's `revision`; none means 1), described as "<version> revision N".
// Zero-leak runs (a run's zero_leak: true) are their own series too, after the normal series of the same version and
// revision, named "<series>, zero-leak".
// Series names combine in a fixed order: version, revision, ruleset, speed variant, zero-leak, e.g. "v6 r18 (btd6-open-v3)
// graded, zero-leak"; descriptions use the words instead ("<version> revision 2 under ruleset ... with graded game speed ...").
export const BASE_RULESET = 'btd6-open-v1';
export const runRevision = r => Number.isInteger(r.revision) && r.revision > 1 ? r.revision : 1;
export function speedSeries(versions) {
 return versions.flatMap(v => {
  const revisions = [...new Set([1, ...v.runs.map(runRevision)])].sort((a, b) => a - b);
  return revisions.flatMap(rev => {
   const all = v.runs.filter(r => runRevision(r) === rev);
   const series = runs => {
    if (rev === 1) return rulesetSeries({...v, runs});
    const label = `${v.name} revision ${rev}`;
    return rulesetSeries({...v, name: `${v.name} r${rev}`, label, added: label, revision: rev, runs}).filter(s => s.runs.length);
   };
   return [...series(all.filter(r => r.zero_leak !== true)),
    ...series(all.filter(r => r.zero_leak === true)).filter(s => s.runs.length)
     .map(s => ({...s, name: `${s.name}, zero-leak`, added: `${s.added} in ${ZERO_LEAK}`, zeroLeak: true}))];
  });
 });
}
const ZERO_LEAK = 'zero-leak mode (--zero-leak: played as if with 1 life)';
function rulesetSeries(v) {
 const label = v.label ?? v.name;
 const rulesets = [...new Set(v.runs.map(r => r.ruleset ?? BASE_RULESET))].filter(r => r !== BASE_RULESET).sort();
 const base = {...v, runs: v.runs.filter(r => (r.ruleset ?? BASE_RULESET) === BASE_RULESET)};
 return [...variantSeries(base), ...rulesets.flatMap(id => variantSeries({...v, name: `${v.name} (${id})`, ruleset: id,
  label: `${label} under ruleset ${id}`, added: `${label} under ruleset ${id}`, runs: v.runs.filter(r => r.ruleset === id)}).filter(s => s.runs.length))];
}
function variantSeries(v) {
 return [{...v, runs: v.runs.filter(r => !speedVariant(r.speed))},
  ...VARIANTS.map(variant => ({variant, runs: v.runs.filter(r => speedVariant(r.speed) === variant)})).filter(x => x.runs.length)
   .map(({variant, runs}) => ({...v, name: `${v.name} ${variant}`, added: `${v.label ?? v.name} with ${variantText(variant)}`, variant, runs}))];
}

// A row's win rate comes only from runs that are comparable: a finished result (won or lost), no issues tag, and
// the same exact speed label and the same MOAB and pops factors, both pinned. The largest such group of at least
// RATE_MIN runs gives {won, of, median (round), speed, factors}; a row without one has no rate (null).
export const RATE_MIN = 5;
export function winRate(runs) {
 const groups = Map.groupBy(runs.filter(r => (r.result === 'won' || r.result === 'lost') && !r.issues?.length && r.speed != null
  && Number.isFinite(r.moab_factor) && Number.isFinite(r.pops_factor) && ['moab', 'pops'].every(k => r.pinned?.includes(k))),
  r => [r.speed, r.moab_factor, r.pops_factor].join('|'));
 const best = [...groups.values()].reduce((a, g) => g.length > (a?.length ?? 0) ? g : a, null);
 if (!best || best.length < RATE_MIN) return null;
 const r = best[0];
 return {won: best.filter(x => x.result === 'won').length, of: best.length, median: median(best.map(x => x.value)),
  speed: String(r.speed), factors: `MOAB x${r.moab_factor} and pops x${r.pops_factor} pinned`};
}

// A version whose runs on a setup are all in speed or ruleset series shows only those series: its empty base
// row is dropped, and the first series row starts with the version's own description.
export function withoutEmptyBase(rows) {
 const out = [];
 for (const r of rows) {
  const series = r.variant || r.ruleset || r.revision || r.zeroLeak;
  const siblings = rows.filter(x => x !== r && x.policy === r.policy && x.runs.length);
  if (!series && !r.runs.length && siblings.length) {
   const first = siblings[0];
   first.added = `${r.added}. ${first.added}`;
   continue;
  }
  out.push(r);
 }
 return out;
}

// One chart per setup: the versions with runs on it or aimed at it, their runs on it, and the lives left
// after each run's round where the setup has more than one life. The README table also shows each run's speed.
// data.notes are {text, setups}: each shows only on the charts of the setups it lists (a plain string shows on every chart).
export const notesFor = (data, id) => (data.notes ?? []).filter(n => typeof n === 'string' || n.setups.includes(id)).map(n => n.text ?? n);
export function setupViews(data) {
 return data.setups.map(setup => ({setup, view: {
  game: `${data.game}, ${setup.label}; ruleset ${BASE_RULESET} unless the row names another`, unit: data.unit, max: setup.end, milestones: chartMilestones(setup), groups: data.groups,
  versions: withoutEmptyBase(speedSeries(data.versions.map(v => ({...v, runs: v.runs.filter(r => r.setup === setup.id)}))))
   .filter(v => v.runs.length || (v.setup === setup.id && !v.variant)).map(v => ({...v, rate: winRate(v.runs)})),
  issues: data.issues ?? [], notes: notesFor(data, setup.id),
  ...(setup.lives > 1 ? {runNote: r => { if (r.lives == null) return null; const n = Math.max(0, r.lives); return `${n} ${n === 1 ? 'life' : 'lives'} left`; }} : {}),
  tableNote: r => r.speed == null ? null : `speed ${r.speed}`,
 }}));
}
