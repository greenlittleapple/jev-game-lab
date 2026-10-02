// When policy btd6-claude-v1 asks the strategist. BTD6 doesn't wait for the answer (except the opening one,
// up to a timeout), so threat and MOAB triggers fire the answer's lead time ahead (triggers.mjs leadRounds).
//  match_start:  no plan for this match; blocking, with a timeout, only while the game waits before its first round
//  big_leak:     more than BIG_LEAK_SHARE of the starting lives lost in the current round; once per round
//  threat_ahead: consult threats (rounds.mjs) whose first round is within the lead time plus THREAT_EXTRA_ROUNDS,
//                unless the plan's answer for them is already met; one request for all threats in that span
//  moab_window:  a window of MOAB-class rounds (plan-v1.mjs moabWindows) starts within the lead time plus
//                MOAB_LEAD_ROUNDS; once per window
//  review:       the plan's review_round (default REVIEW_EVERY rounds after its request) has come
// At most MAX_CONSULTS requests per match; after that only match_start asks.
import {upcomingThreats} from './rounds.mjs';
import {MOAB_LEAD_ROUNDS} from './moab.mjs';
import {moabWindows, planTargets} from './plan-v1.mjs';

export const PRIORITY_V1 = {match_start: 4, big_leak: 3, threat_ahead: 2, moab_window: 2, review: 1};
export const TRIGGERS_V1 = {BIG_LEAK_SHARE: 0.05, THREAT_EXTRA_ROUNDS: 2, REVIEW_EVERY: 10, MAX_CONSULTS: 36, OPENING_TIMEOUT_MS: 300_000};
const MOAB_THREATS = ['moab', 'bfb', 'fortified_moab', 'zomg', 'ddt', 'bad'];

// context: {lead, livesAtRoundStart, openingTimeoutMs}
export function claudeTrigger(state, plan, status, context = {}) {
 if (!state.in_game || state.match.result) return null;
 const match = state.match.id, now = state.round.number, lead = context.lead ?? 2;
 const start = state.match.start_round ?? 1, end = state.match.end_round ?? 100;
 const make = (reason, key, extra = {}) => ({reason, key: `${match}:${key}`, priority: PRIORITY_V1[reason], ...extra});
 const keys = Object.keys(status.asked ?? {}).filter(k => k.startsWith(`${match}:`)).map(k => k.slice(match.length + 1));
 const asked = key => keys.includes(key);
 if (!plan || plan.match_id !== match) {
  // Waited for once, before the first round; after a timeout the request stays posted and play goes on.
  const blocking = Boolean(state.round.before_first_wave) && !asked('match_start');
  return make('match_start', 'match_start', blocking ? {blocking: true, timeoutMs: context.openingTimeoutMs ?? TRIGGERS_V1.OPENING_TIMEOUT_MS} : {});
 }
 if (keys.length >= TRIGGERS_V1.MAX_CONSULTS) return null;

 const lost = context.livesAtRoundStart != null ? context.livesAtRoundStart - state.lives : 0;
 const bigLeak = Math.max(1, Math.ceil(TRIGGERS_V1.BIG_LEAK_SHARE * (state.starting_lives ?? 100)));
 if (lost > bigLeak && !asked(`leak:${now}`)) return make('big_leak', `leak:${now}`, {detail: {round: now, lives_lost: lost, threshold: bigLeak}});

 const windowAsked = round => keys.some(k => { const m = /^moab:(\d+)-(\d+)$/.exec(k); return m && Number(m[1]) <= round && round <= Number(m[2]); });
 const threatAsked = id => keys.some(k => k.startsWith('threat:') && k.slice(7).split('+').includes(id));
 const targets = planTargets(plan, state);
 const met = id => plan.threats.some(t => t.threat === id && targets.find(x => x.item.id === t.answer)?.done);
 const threats = upcomingThreats(now - 1, {within: lead + TRIGGERS_V1.THREAT_EXTRA_ROUNDS, start, end, consultOnly: true})
  .filter(t => !threatAsked(t.id) && !met(t.id) && !(MOAB_THREATS.includes(t.id) && windowAsked(t.round)));
 if (threats.length) return make('threat_ahead', `threat:${threats.map(t => t.id).join('+')}`, {detail: {threats: threats.map(t => ({threat: t.id, round: t.round}))}});

 const window = moabWindows(start, end).find(w => w.to >= now && w.from - now <= lead + MOAB_LEAD_ROUNDS);
 if (window && !asked(`moab:${window.from}-${window.to}`)) return make('moab_window', `moab:${window.from}-${window.to}`, {detail: {from: window.from, to: window.to}});

 const review = plan.review_round ?? (plan.round_at ?? now) + TRIGGERS_V1.REVIEW_EVERY;
 if (now >= review && !asked(`review:${plan.request_id}`)) return make('review', `review:${plan.request_id}`);
 return null;
}
