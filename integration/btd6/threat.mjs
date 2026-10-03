// threat_short: Lead and camo readiness under automatic round start (docs/ARCHITECTURE.md, "threat_short").
// claude-v1 revision 4 lost at round 28 of Hard Standard, the first Lead round (6 Leads in 5 s), with no tower
// that pops Lead (log 2026-09-30T20-45-16-989Z). v3's check knew it: the question showed "missing: lead" and
// no_start_short removed "Start round", which auto-start never offers, so nothing made a Lead-popping purchase.
// The rule, from THREAT_LEAD_ROUNDS before a round the towers can't handle for Lead or camo (the facts that
// feed "missing": estimate.mjs roundCheck lead === false or camo === false, with reach):
//  - the purchases that make the check pass for that property are tagged (details.threat: the properties
//    they add) and move to the front, those adding the most missing properties first, then the cheapest, then
//    the most pops per dollar;
//  - while one of them is on offer (so affordable), "Wait" and "Start round" are removed; other purchases stay;
//  - while none is affordable, the rule saves for the cheapest: every purchase is removed and "Wait" (or "Start
//    round", between rounds) is kept or put back, recorded with saving (its cost) and for (its ID). The cheapest
//    comes from the options built with no cash limit (candidates.mjs buildCandidates on the floor's catalog, spots
//    and paths). Not under leak pressure, which needs pops now. In the claude-v1 loss no Lead answer was ever on
//    offer in rounds 25 to 28 (cash $27 to $280; the cheapest, a Wizard's 1-1-0, cost $325), because each $200 to
//    $280 went on other purchases; without the saving part the rule would not have fired there;
//  - the rule is recorded with the round, the missing properties and the round each is due. Floor rules only; the plan policies list it in rules-v1.mjs SURVIVAL_RULES, and the
// tower cap's exception reads the tags (policy-v6.mjs applyTowerCap).
// Kinds (THREAT_KINDS_V2, from btd6-jev-v6 revision 3, btd6-playbook-v5 revision 7 and btd6-claude-v1 revision 6):
//  - camo_lead: camo Lead bloons need one tower that sees camo and pops Lead (roundCheck camo_lead; round 59 on Hard);
//  - burst: the pops over the round's densest 10 s fall short (roundCheck burst; round 78, which ended 3 of the 4
//    current-era losses with pops measured). One purchase rarely closes it, so a purchase adds it when it raises the
//    window's estimate, and those purchases go most pops per dollar first; there is no saving part for it, and while
//    moab_short has put MOAB damage first (moabFirst) a burst gap alone leaves the options as they are.
// Revisions before those use THREAT_KINDS (Lead and camo).
// Burst answer order (THREAT_BURST_AHEAD, from btd6-jev-v6 revision 4, btd6-playbook-v5 revision 8 and btd6-claude-v1
// revision 7): purchases that add only burst go highest burst-ratio gain per dollar first (details.burst_gain: the due round's
// burst can_pop after the purchase minus before, over that window's needs); those that add a check kind keep the cheapest-first
// order, and saving (check kinds only) still targets the cheapest answer. Burst is checked THREAT_BURST_ROUNDS (3) ahead, the
// same window as Lead and camo. An 8-round window was replayed on the logs on 2026-10-01 and dropped: against a round 8 ahead
// the defence nearly always looks short, so the rule fired all game (1,887 waits removed in 24 runs, 1,392 before round 60)
// and set the plan policies' filters aside (docs/PLAN.md).
// Camo capacity (THREAT_KINDS_V3, from btd6-jev-v6 revision 5, btd6-playbook-v5 revision 9 and btd6-claude-v1 revision 8):
// camo_capacity is due at a round within THREAT_LEAD_ROUNDS that has camo bloons (rounds.json camo_rbe) and whose camo margin
// (estimate.mjs camoCheck, the one graded speed's --camo-margin reads: reach, Quincy's level, the margin for the lives left) is
// below CAMO_CAPACITY_AT. In series 6, v6 lost twice at round 56 (camo Rainbows) with a camo margin below 1.0, and the
// purchases it made in rounds 50 to 56 added no camo capacity; camo-replay.mjs flags both from round 53. A purchase adds it
// when it raises that round's camo can_pop (details.camo_gain: the margin it adds), and those go highest camo_gain per dollar
// first. It is a rate kind like burst: no saving, and none while moab_short has put MOAB damage first. Order of kinds: a purchase
// that adds a check kind (Lead, camo, camo Lead) first, then camo_capacity, then burst only.
// Lead capacity (THREAT_KINDS_V4, from btd6-jev-v6 revision 12, btd6-playbook-v5 revision 16 and btd6-claude-v1 revision 15):
// lead_capacity is camo_capacity for Lead. It is due at a round within THREAT_LEAD_ROUNDS that has Lead bloons (any Lead
// variant: estimate.mjs leadRbe, each bloon's full RBE with its children) and whose Lead margin (estimate.mjs
// leadCheck: the Lead-capable towers' pops with reach against that RBE times the lives margin) is below LEAD_CAPACITY_AT.
// CHIMPS series 1g match 1 (v6 revision 11) lost at round 28 to its 6 Leads: the yes-or-no Lead check passed after one
// Lead-popping upgrade at round 25, the whole-round margin was 2.46, and 96 of 138 RBE were popped; that defence's Lead
// margin for round 28 was below 1.0 (fixtures/lead-capacity-r28.json). A purchase adds it when it raises the round's Lead
// can_pop (details.lead_gain: the margin it adds); those go highest lead_gain per dollar first. It is a rate kind for the
// order and the binding, as camo_capacity: binding with one life (THREAT_KEEP, and revision 11's choice under the tower cap),
// order only with more lives. Saving (savesFor): with lives <= 1 it saves as the check kinds do, keeping only the pass
// options while the cheapest Lead-capacity answer in the pool is out of reach (in the fixture's match no Lead answer was
// affordable after round 25, and the cash went on Glue Gunner, Wizard 0-0-0 and Skywarden placements); leak pressure stops
// the saving as it does theirs. While moab_short has put MOAB damage first (moabFirst) it is set aside as camo_capacity is,
// with any number of lives: no answers put first and no saving. With more lives it never saves. Order of kinds: check kinds, then
// camo_capacity, then lead_capacity, then burst only. The Lead and camo Lead checks are unchanged and still come first.
// No DDTs in the Lead RBE (from btd6-jev-v6 revision 15, btd6-playbook-v5 revision 19 and btd6-claude-v1 revision 18):
// revisions 12 to 14 counted DDTs as Lead bloons (leadDdt: true gives that). In CHIMPS series 1h match 2 (v6 revision 14,
// log 2026-10-01T23-52-01) round 95's Lead RBE was mostly its 30 camo DDTs, and the rule saved for a $405 Bomb Shooter,
// which pops Lead but can't damage a DDT (Black), at about 70 decisions in rounds 92 to 95 (fixtures/lead-capacity-r95.json).
// DDTs are left to the MOAB check's DDT-capable figure (moab.mjs, from v6 revision 13).
// camo_capacity on the camo rate (camoRate, Model B of camo.mjs; from btd6-jev-v6 revision 21, btd6-playbook-v5 revision 25
// and btd6-claude-v1 revision 24): due when the camo-capable towers' pops per second (can_pop over roundSeconds) against the
// camo RBE per second over the camo spawn stretch plus DWELL_SECONDS (data/camo-timing.json; needs, with the lives margin, over
// camo.mjs camoWindow) is below CAMO_CAPACITY_AT, instead of the camo margin; camo_gain is the rate ratio a purchase adds. The
// look-ahead, the order and the binding with one life are unchanged. The rate ratio is the camo margin times the round's
// window over its seconds, so within one round the answers keep their order; they change where another round becomes due.
// The camo model replay (camo-replay.mjs --models, 139 logs since 2026-09-30T10-00): below 1.0 the camo margin flagged 25 CHIMPS
// camo rounds and caught 18 of the 35 that lost lives, the rate 93 and 29; the camo losses at rounds 37 and 78 had margins of
// 2.28 and 1.29 and rates of 0.42 and 0.12. Graded speed's +camo keeps the camo margin. camoRate: false gives v6 revision 20.
import {roundCheck, camoCheck, leadCheck, roundSeconds} from './estimate.mjs';
import {camoWindow, camoTimingOf} from './camo.mjs';
import {after, withReach} from './policy-v3.mjs';
import {buildCandidates} from './candidates.mjs';

// Rounds ahead the rule looks (the lead time). In the round data (data/rounds.json) the first camo round is 24
// and the first Lead round 28; towers aren't sold, so once a tower handles one the rule stays quiet for it.
// Rounds 25 to 27 are short (14 to 34 s), so 3 rounds of income before round 28 (as MOAB_LEAD_ROUNDS' 4 before
// round 40) is what a cheap answer needs: a Wizard's x-1-x, a Bomb Shooter, a Dart Monkey's x-x-2 for camo.
export const THREAT_LEAD_ROUNDS = 3;
export const THREAT_KINDS = ['lead', 'camo'];
export const THREAT_KINDS_V2 = ['lead', 'camo', 'camo_lead', 'burst'];
export const THREAT_KINDS_V3 = ['lead', 'camo', 'camo_lead', 'camo_capacity', 'burst'];
export const THREAT_KINDS_V4 = ['lead', 'camo', 'camo_lead', 'camo_capacity', 'lead_capacity', 'burst'];
// camo_capacity is due below this camo margin (camoCheck ratio).
export const CAMO_CAPACITY_AT = 1.0;
// The camo rate's scale for a round (camoRate): the camo window over the round's seconds, so the rate ratio is the camo margin
// times it (camo.mjs modelB); null without camo timing, where the camo margin stands.
export const camoRateScale = round => { const w = camoWindow(camoTimingOf(round)), s = roundSeconds(round); return w > 0 && s > 0 ? w / s : null; };
// The revisions of each policy with camoRate (from CAMO_RATE_FROM); camoRateFor: whether a run of that policy and revision used it.
export const CAMO_RATE_FROM = {'btd6-jev-v6': 21, 'btd6-playbook-v5': 25, 'btd6-claude-v1': 24};
export const camoRateFor = (policy, revision = 0) => Object.hasOwn(CAMO_RATE_FROM, policy) && (revision ?? 0) >= CAMO_RATE_FROM[policy];
// lead_capacity is due below this Lead margin (leadCheck ratio): 1.0, as in btd6-jev-v6 revisions 12 to 16, again from
// btd6-jev-v6 revision 18, btd6-playbook-v5 revision 22 and btd6-claude-v1 revision 21; LEAD_CAPACITY_AT_R17 (0.5) in v6
// revision 17, v5 revision 21 and claude-v1 revision 20 (threatOptions.leadAt). Revision 17 chose 0.5 from the Lead-margin
// buckets of the CHIMPS logs (4 of 7 rounds below 0.5 lost lives, all at round 28; from 0.5 to 1, 1 of 12, at round 95, from
// DDTs). Its first CHIMPS match had a round-28 Lead margin of 0.62, so lead_capacity stayed off, bought Dart Monkeys and lost
// at round 28 to Leads; every revision 12 to 14 match passed round 28. LEAD_CAPACITY_AT_R12 is the same 1.0.
export const LEAD_CAPACITY_AT = 1.0;
export const LEAD_CAPACITY_AT_R12 = 1.0;
export const LEAD_CAPACITY_AT_R17 = 0.5;
// Rounds ahead burst is checked from the revisions above (the same as THREAT_LEAD_ROUNDS), and their options for
// applyThreatShort and floorRulesV4.
export const THREAT_BURST_ROUNDS = THREAT_LEAD_ROUNDS;
export const THREAT_BURST_AHEAD = {burstLead: THREAT_BURST_ROUNDS, burstGain: true};
// camo_capacity's binding on the camo rate needs an answer that closes this share of the gap (camoBindShare): the best affordable
// answer's camo_gain (rate gain) must be at least CAMO_BIND_GAP_SHARE x (CAMO_CAPACITY_AT - the rate). Before the round-78 camo loss
// of series 1k match 3 the answers raised the rate by about 0.002 each against a gap of 0.88, and in the revision 21 replay camo
// binding in CHIMPS rounds 61 to 80 rose from 0 to 1,001 of 4,033 decisions (binding that often hurt revision 16).
export const CAMO_BIND_GAP_SHARE = 0.05;
// The threat options from btd6-jev-v6 revision 21, btd6-playbook-v5 revision 25 and btd6-claude-v1 revision 24: THREAT_BURST_AHEAD
// with camo_capacity on the camo rate and its gap guard (camoBindShare: 0 turns the guard off). THREAT_BURST_AHEAD gives the
// revisions before.
export const THREAT_OPTIONS_R21 = {...THREAT_BURST_AHEAD, camoRate: true, camoBindShare: CAMO_BIND_GAP_SHARE};
// Kinds a purchase adds by raising a rate rather than by passing a check.
const RATE_KINDS = ['camo_capacity', 'lead_capacity', 'burst'];
// The first revision of each policy whose Lead RBE leaves DDTs out; leadDdtFor: whether a run of that policy and revision
// counted them (the dashboard and the replays; earlier revisions of these policies had no lead_capacity or counted DDTs).
export const LEAD_NO_DDT_FROM = {'btd6-jev-v6': 15, 'btd6-playbook-v5': 19, 'btd6-claude-v1': 18};
export const leadDdtFor = (policy, revision = 0) => Object.hasOwn(LEAD_NO_DDT_FROM, policy) && (revision ?? 0) < LEAD_NO_DDT_FROM[policy];
// The revisions of each policy with lead_capacity at LEAD_CAPACITY_AT_R17 (0.5): from LEAD_HALF_FROM to before LEAD_ONE_FROM;
// leadAtFor: the threshold a run of that policy and revision used (the dashboard). Other revisions used 1.0.
export const LEAD_HALF_FROM = {'btd6-jev-v6': 17, 'btd6-playbook-v5': 21, 'btd6-claude-v1': 20};
export const LEAD_ONE_FROM = {'btd6-jev-v6': 18, 'btd6-playbook-v5': 22, 'btd6-claude-v1': 21};
export const leadAtFor = (policy, revision = 0) => Object.hasOwn(LEAD_HALF_FROM, policy) && (revision ?? 0) >= LEAD_HALF_FROM[policy] && (revision ?? 0) < LEAD_ONE_FROM[policy] ? LEAD_CAPACITY_AT_R17 : LEAD_CAPACITY_AT;
const isRate = k => RATE_KINDS.includes(k);
// Kinds that save when no answer is affordable: the check kinds, and lead_capacity with lives <= 1 while moab_short hasn't put
// MOAB damage first (from btd6-jev-v6 revision 12).
const savesFor = (state, moabFirst = false) => k => !isRate(k) || (k === 'lead_capacity' && state.lives <= 1 && !moabFirst);

const spends = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';

// The gaps from this round to THREAT_LEAD_ROUNDS after it (burstLead rounds for burst; lead by default): {round, missing,
// rounds: {lead: 28}, ratios: {burst: 0.9}}, round being the nearest, or null when the towers handle every one. ratios: the
// burst ratio of the round it is due; can_pop and needs: its burst can_pop, which a purchase must raise to add burst, and
// that window's needs.
// leadDdt: count DDTs in lead_capacity's Lead RBE (v6 revisions 12 to 14); the result carries it, not enumerable, for threatEffect.
// leadAt: lead_capacity's threshold (LEAD_CAPACITY_AT, as in v6 revisions 12 to 16; LEAD_CAPACITY_AT_R17 gives v6 revision 17); the result carries
// it, not enumerable, for the record. camoRate: camo_capacity on the camo rate (camoRateScale); the result then carries
// camoScale and camoMargin (the camo margin), not enumerable, for threatEffect and the record.
export function threatShort(state, paths = [], {lead = THREAT_LEAD_ROUNDS, kinds = THREAT_KINDS, burstLead = lead, leadDdt = false, leadAt = LEAD_CAPACITY_AT, camoRate = false} = {}) {
 const now = state.round.number, ahead = k => now + (k === 'burst' ? burstLead : lead);
 const last = Math.min(state.match?.end_round ?? 100, Math.max(...kinds.map(ahead)));
 const rounds = {}, ratios = {}, canPop = {}, needs = {};
 let camo = null;
 for (let r = now; r <= last; r++) {
  const c = roundCheck(state.towers, r, {lives: state.lives, paths, useReach: true});
  if (!c) continue;
  for (const k of kinds) if (r <= ahead(k) && c[k] === false && !(k in rounds)) {
   rounds[k] = r;
   if (k === 'burst') { ratios.burst = c.burst_facts.ratio; canPop.burst = c.burst_facts.can_pop; needs.burst = c.burst_facts.needs; }
  }
  if (kinds.includes('camo_capacity') && r <= ahead('camo_capacity') && !('camo_capacity' in rounds)) {
   const m = camoCheck(state.towers, r, {lives: state.lives, paths});
   const scale = camoRate && m ? camoRateScale(r) : null;
   const ratio = m ? (scale != null ? +(m.can_pop / m.needs * scale).toFixed(2) : m.ratio) : null;
   if (m && ratio < CAMO_CAPACITY_AT) {
    rounds.camo_capacity = r; ratios.camo_capacity = ratio; canPop.camo_capacity = m.can_pop; needs.camo_capacity = m.needs;
    if (camoRate) camo = {scale: scale ?? 1, margin: m.ratio};
   }
  }
  if (kinds.includes('lead_capacity') && r <= ahead('lead_capacity') && !('lead_capacity' in rounds)) {
   const m = leadCheck(state.towers, r, {lives: state.lives, paths, ddt: leadDdt});
   if (m && m.ratio < leadAt) { rounds.lead_capacity = r; ratios.lead_capacity = m.ratio; canPop.lead_capacity = m.can_pop; needs.lead_capacity = m.needs; }
  }
 }
 const missing = kinds.filter(k => k in rounds);
 if (!missing.length) return null;
 const short = {round: Math.min(...missing.map(k => rounds[k])), missing, rounds, ...(Object.keys(ratios).length ? {ratios, can_pop: canPop, needs} : {})};
 if (leadDdt) Object.defineProperty(short, 'leadDdt', {value: true, enumerable: false});
 Object.defineProperty(short, 'leadAt', {value: leadAt, enumerable: false});
 if (camo && 'camo_capacity' in rounds) {
  Object.defineProperty(short, 'camoScale', {value: camo.scale, enumerable: false});
  Object.defineProperty(short, 'camoMargin', {value: camo.margin, enumerable: false});
 }
 return short;
}

// The missing properties a purchase adds: those the check for their round passes after it; a rate kind (burst) when
// the purchase raises the round's ratio.
export const threatAdds = (state, c, short, paths = []) => threatEffect(state, c, short, paths).adds;
// threatAdds plus burst_gain: the burst ratio the purchase adds for the round burst is due (null when it adds none).
// camo_gain: the camo margin it adds for the round camo_capacity is due (null when it adds none); lead_gain: the same for
// lead_capacity's Lead margin. With camoRate (short.camoScale) camo_gain is the camo rate ratio it adds.
export function threatEffect(state, c, short, paths = []) {
 if (!spends(c) || !short) return {adds: [], burst_gain: null, camo_gain: null, lead_gain: null};
 const towers = after(state, c);
 let gain = null, camoGain = null, leadGain = null;
 const adds = short.missing.filter(k => {
  if (k === 'camo_capacity' || k === 'lead_capacity') {
   const check = k === 'camo_capacity' ? camoCheck : leadCheck;
   const added = (check(towers, short.rounds[k], {lives: state.lives, paths, ddt: short.leadDdt === true})?.can_pop ?? 0) - short.can_pop[k];
   if (added > 0 && short.needs?.[k] > 0) { if (k === 'camo_capacity') camoGain = added / short.needs[k] * (short.camoScale ?? 1); else leadGain = added / short.needs[k]; }
   return added > 0;
  }
  const check = roundCheck(towers, short.rounds[k], {lives: state.lives, paths, useReach: true});
  if (!isRate(k)) return check?.[k] === true;
  const added = (check?.burst_facts?.can_pop ?? 0) - short.can_pop[k];
  if (added > 0 && short.needs?.[k] > 0) gain = added / short.needs[k];
  return added > 0;
 });
 return {adds, burst_gain: gain, camo_gain: camoGain, lead_gain: leadGain};
}

const perDollar = c => (c.details.pops ?? 0) / (c.details.cost || 1);
// Burst-ratio gain per dollar, where the rule recorded the gain (THREAT_BURST_AHEAD's burstGain); null otherwise.
export const burstPerDollar = c => c.details.burst_gain != null ? c.details.burst_gain / (c.details.cost || 1) : null;
const rateOrder = (a, b) => burstPerDollar(a) != null && burstPerDollar(b) != null ? burstPerDollar(b) - burstPerDollar(a) : perDollar(b) - perDollar(a);
export const threatChecks = c => c.details.threat.filter(k => !isRate(k)).length;
const checks = threatChecks;
// Most missing properties covered (Lead, camo, camo Lead), then the cheapest (the one affordable soonest, which leaves the
// most cash for pops), then most pops per dollar. Purchases that only add burst: most pops per dollar, or with
// burst_gain recorded (THREAT_BURST_AHEAD) the highest burst-ratio gain per dollar.
// Camo-margin gain per dollar (details.camo_gain, camo_capacity); null when the purchase adds no camo capacity.
export const camoPerDollar = c => c.details.camo_gain != null && c.details.threat?.includes('camo_capacity') ? c.details.camo_gain / (c.details.cost || 1) : null;
// Lead-margin gain per dollar (details.lead_gain, lead_capacity); null when the purchase adds no Lead capacity.
export const leadPerDollar = c => c.details.lead_gain != null && c.details.threat?.includes('lead_capacity') ? c.details.lead_gain / (c.details.cost || 1) : null;
// Among purchases that add no check kind: those that add camo_capacity first, highest camo gain per dollar first; then those
// that add lead_capacity, highest Lead gain per dollar first; then burst.
const byValue = (value, next) => (a, b) => {
 const x = value(a), y = value(b);
 if (x != null && y != null) return y - x;
 if (x != null || y != null) return x != null ? -1 : 1;
 return next(a, b);
};
const camoOrder = byValue(camoPerDollar, byValue(leadPerDollar, rateOrder));
export const threatOrder = (a, b) => checks(b) - checks(a) || (checks(a) || checks(b) ? (a.details.cost ?? 1e9) - (b.details.cost ?? 1e9) || perDollar(b) - perDollar(a) : camoOrder(a, b));

const isPass = c => c.details?.kind === 'wait' || c.details?.kind === 'start_round';

// Every purchase the floor's context could offer at any cash (placements at the free spots, the next tiers), for the
// cheapest answer to save for. context: {catalog, freeSpots, freeSpotsFor, paths}; [] without a catalog.
export function answerPool(state, context = {}) {
 if (!context.catalog?.length) return [];
 const open = {...state, cash: Number.MAX_SAFE_INTEGER, towers: state.towers.map(t => ({...t, next_upgrades: t.next_upgrades ?? []}))};
 return buildCandidates(open, {catalog: context.catalog, freeSpots: context.freeSpotsFor ?? context.freeSpots ?? [], paths: context.paths ?? []}).filter(spends);
}

// The rule on the options another rule set left. Returns {candidates, rule} (rule null when it doesn't fire).
// Purchases without reach details get them (withReach), so the pops tie-break has figures.
// all: the options before any rule (to put "Wait" back when saving); pool: every purchase at any cash (answerPool),
// or a function returning it (called only when no answer is affordable), or null to skip saving; pressure: v3's leak pressure status.
// kinds: THREAT_KINDS (the default) or THREAT_KINDS_V2. burstLead: rounds ahead for burst (lead by default; THREAT_BURST_AHEAD
// sets THREAT_BURST_ROUNDS); burstGain: record each burst adder's burst_gain, which orders those that add only burst.
// binding (btd6-jev-v6 revision 9, btd6-playbook-v5 revision 13, btd6-claude-v1 revision 12): with lives <= 1, the
// options are reduced to the deciding gap's answers (bindAnswers); the result also carries unbound, the order-only
// {candidates, rule}, for early_short (policy-v4.mjs floorRulesV4). leadDdt: as threatShort (true gives v6 revisions 12 to 14);
// leadAt and camoRate: as threatShort. capacityUnderMoab (policy-v4.mjs moabCapacity, from btd6-jev-v6 revision 19, btd6-playbook-v5 revision 23
// and btd6-claude-v1 revision 22): with moabFirst, camo_capacity and lead_capacity are still evaluated (only a burst gap alone
// leaves the options as they are), so moab_short's DDT binding and saving can keep their answers (capacityAnswers). Saving is
// unchanged: lead_capacity still doesn't save while moabFirst.
// capacityBefore (policy-v4.mjs capacityNearer, from btd6-jev-v6 revision 21, btd6-playbook-v5 revision 25 and btd6-claude-v1
// revision 24): with moabFirst, moab_short's short round. When only rate kinds are missing and camo_capacity or lead_capacity
// is due at a round before it, those kinds (the ones due before it) are evaluated as without moabFirst; burst stays aside and
// saving is unchanged (none while moabFirst). The rule then records before_moab (that round) and the result carries nearer: true.
// camoBindShare (THREAT_OPTIONS_R21; with camoRate only): with one life camo_capacity binds only when its best affordable answer
// (a known cost within the cash) adds at least camoBindShare x (CAMO_CAPACITY_AT - the rate) to the rate (camoBindWeak). Otherwise
// it only orders its answers first, as with two or more lives, and the rule records camo_bind_held: {gain, need}; under
// capacityBefore it isn't evaluated at that decision (camo_capacity stays set aside for moab_short). lead_capacity is unchanged.
// capacityAt (policy-v4.mjs capacitySame, from btd6-jev-v6 revision 22, btd6-playbook-v5 revision 26 and btd6-claude-v1
// revision 25): with moabFirst, moab_short's short round. When only rate kinds are missing, no capacityBefore round applies and
// camo_capacity or lead_capacity is due at that round, those kinds are evaluated as without moabFirst (camo_capacity only past
// camoBindShare's bar, as under capacityBefore), so moab_short's binding and saving can keep their answers (capacityAnswers);
// burst stays aside and saving is unchanged. The rule then records at_moab (that round).
export function applyThreatShort(state, candidates, options = {}) {
 const {paths = [], lead = THREAT_LEAD_ROUNDS, kinds = THREAT_KINDS, burstLead = lead, burstGain = false, all = candidates, pool = null, pressure = null, moabFirst = false, binding = false, leadDdt = false, leadAt = LEAD_CAPACITY_AT, camoRate = false, capacityUnderMoab = false, capacityBefore = null, capacityAt = null, camoBindShare = 0} = options;
 if (!state.in_game || state.popup) return {candidates, rule: null};
 const short = threatShort(state, paths, {lead, kinds, burstLead, leadDdt, leadAt, camoRate});
 const near = moabFirst && capacityBefore != null && short && short.missing.every(isRate)
  ? short.missing.filter(k => (k === 'camo_capacity' || k === 'lead_capacity') && short.rounds[k] < capacityBefore) : [];
 if (near.length) { short.missing = near; short.round = Math.min(...near.map(k => short.rounds[k])); }
 const same = !near.length && moabFirst && capacityAt != null && short && short.missing.every(isRate)
  ? short.missing.filter(k => (k === 'camo_capacity' || k === 'lead_capacity') && short.rounds[k] === capacityAt) : [];
 if (same.length) { short.missing = same; short.round = capacityAt; }
 if (!short || (!near.length && !same.length && moabFirst && short.missing.every(k => capacityUnderMoab ? k === 'burst' : isRate(k)))) return {candidates, rule: null};
 const decorated = candidates.some(c => spends(c) && !('reach' in c.details)) ? withReach(state, candidates, paths) : candidates;
 const tagged = decorated.map(c => {
  const {adds, burst_gain: gain, camo_gain: camoGain, lead_gain: leadGain} = threatEffect(state, c, short, paths);
  return adds.length ? {...c, details: {...c.details, threat: adds, ...(burstGain && gain != null ? {burst_gain: +gain.toFixed(4)} : {}),
   ...(camoGain != null ? {camo_gain: +camoGain.toFixed(4)} : {}), ...(leadGain != null ? {lead_gain: +leadGain.toFixed(4)} : {})}} : c;
 });
 const adders = tagged.filter(c => c.details?.threat?.length).sort(threatOrder);
 if (!adders.length) return saveFor(state, candidates, short, {paths, all, pool, pressure, moabFirst});
 const weak = binding && state.lives <= 1 ? camoBindWeak(state, adders, short, camoBindShare) : null;
 if (weak && (near.includes('camo_capacity') || same.includes('camo_capacity'))) {
  const others = [...near, ...same].filter(k => k !== 'camo_capacity');
  return others.length ? applyThreatShort(state, candidates, {...options, kinds: kinds.filter(k => k !== 'camo_capacity')}) : {candidates, rule: null};
 }
 const rest = tagged.filter(c => !c.details?.threat?.length && c.details?.kind !== 'wait' && c.details?.kind !== 'start_round');
 const kept = [...adders, ...rest];
 const rule = {kind: 'threat_short', removed: tagged.length - kept.length, round: short.round, missing: short.missing, rounds: short.rounds,
  adders: adders.length, first: adders[0].id, ...(near.length ? {before_moab: capacityBefore} : {}), ...(same.length ? {at_moab: capacityAt} : {}), ...(short.ratios ? {ratios: short.ratios} : {}), ...camoRecord(short), ...leadRecord(short),
  ...(camoPerDollar(adders[0]) != null && !checks(adders[0]) ? {first_camo_gain: adders[0].details.camo_gain, first_cost: adders[0].details.cost ?? null}
   : leadPerDollar(adders[0]) != null && !checks(adders[0]) ? {first_lead_gain: adders[0].details.lead_gain, first_cost: adders[0].details.cost ?? null}
   : adders[0].details.burst_gain != null ? {first_gain: adders[0].details.burst_gain, first_cost: adders[0].details.cost ?? null} : {})};
 const nearer = near.length ? {nearer: true} : {};
 if (!binding || !(state.lives <= 1)) return {candidates: kept, rule, ...nearer};
 const bound = bindAnswers(adders);
 if (bound.kind === 'camo_capacity' && weak) return {candidates: kept, rule: {...rule, camo_bind_held: weak}, ...nearer};
 const record = {...rule, removed: tagged.length - bound.kept.length, binding: true, binding_kind: bound.kind,
  binding_removed: kept.length - bound.kept.length, ...(bound.kind === 'check' ? {} : {keep: THREAT_KEEP}), kept: bound.kept.map(c => c.id)};
 if (bound.value) withBindAnswers(record, {list: adders, value: bound.value, keep: THREAT_KEEP, unbound: kept});
 return {candidates: bound.kept, rule: record, unbound: {candidates: kept, rule}, ...nearer};
}

// camoBindShare's guard: {gain, need} when camo_capacity is due on the camo rate and no affordable answer (a known cost within
// the cash) adds at least share x (CAMO_CAPACITY_AT - the rate) to it; null otherwise (and with share 0 or without camoRate).
export function camoBindWeak(state, adders, short, share) {
 if (!(share > 0) || short.camoScale == null || !short.missing.includes('camo_capacity')) return null;
 const need = share * (CAMO_CAPACITY_AT - short.ratios.camo_capacity);
 const gains = adders.filter(c => c.details.camo_gain != null && Number.isFinite(c.details.cost) && c.details.cost <= state.cash).map(c => c.details.camo_gain);
 const gain = gains.length ? Math.max(...gains) : 0;
 return gain >= need ? null : {gain, need: +need.toFixed(4)};
}

// The binding's answers before the keep cut, on the rule record for the one-life tower cap (policy-v6.mjs applyTowerCap,
// from btd6-jev-v6 revision 11): {list: the answers in order, value(c): the gain per dollar the binding compares, keep: the
// factor, always: answers kept whatever their value, unbound (threat_short only): the rule's order-only options, which a
// burst binding falls back to when it steps aside under the cap, from btd6-jev-v6 revision 14}. Not enumerable, so the run log and record comparisons leave it out.
export function withBindAnswers(rule, answers) {
 return Object.defineProperty(rule, 'answers', {value: {always: [], ...answers}, enumerable: false});
}

// Binding with one life: rate kinds keep answers within THREAT_KEEP of the best gain per dollar (as early.mjs EARLY_KEEP).
export const THREAT_KEEP = 0.8;
// The deciding gap is the first answer's (threatOrder). A check kind (Lead, camo, camo Lead): every answer that adds a
// check kind, in order. camo_capacity: answers within THREAT_KEEP of the best camo gain per dollar. lead_capacity (from v6
// revision 12): the same with the Lead gain per dollar. burst: answers within
// THREAT_KEEP of the best burst-ratio gain per dollar (pops per dollar when no gain was recorded). The first answer always
// stays, so the last option is never removed.
function bindAnswers(adders) {
 const first = adders[0];
 if (checks(first) > 0) return {kind: 'check', kept: adders.filter(c => checks(c) > 0)};
 const kind = camoPerDollar(first) != null ? 'camo_capacity' : leadPerDollar(first) != null ? 'lead_capacity' : 'burst';
 const value = kind === 'camo_capacity' ? camoPerDollar : kind === 'lead_capacity' ? c => camoPerDollar(c) == null ? leadPerDollar(c) : null
  : c => checks(c) === 0 && camoPerDollar(c) == null && leadPerDollar(c) == null ? burstPerDollar(c) ?? perDollar(c) : null;
 const best = value(first);
 return {kind, value, kept: adders.filter(c => c === first || (value(c) != null && value(c) >= best * THREAT_KEEP))};
}

// The camo_capacity and lead_capacity answers moab_short's DDT binding and saving keep (policy-v4.mjs moabCapacity): among the
// affordable options, those within THREAT_KEEP of their kind's best gain per dollar, by the values threat_short's own binding
// uses (bindAnswers: camo gain per dollar; Lead gain per dollar for those that add no camo capacity). Camo first, then Lead,
// each highest gain per dollar first. Options that add a check kind are left out (they stay as check answers).
export function capacityAnswers(options, cash) {
 const affordable = options.filter(c => spends(c) && !(c.details.cost > cash) && (c.details.threat?.length ?? 0) > 0 && checks(c) === 0);
 const out = [];
 for (const value of [camoPerDollar, c => camoPerDollar(c) == null ? leadPerDollar(c) : null]) {
  const list = affordable.filter(c => value(c) != null).sort((a, b) => value(b) - value(a));
  if (!list.length) continue;
  const best = value(list[0]);
  out.push(...list.filter(c => value(c) >= best * THREAT_KEEP && !out.includes(c)));
 }
 return out;
}

// The camo_capacity part of the rule's record: the round, its camo margin and the threshold; with camoRate also camo_rate,
// the rate ratio the threshold applies to.
const camoRecord = short => !('camo_capacity' in short.rounds) ? {}
 : short.camoScale != null ? {camo_capacity: {round: short.rounds.camo_capacity, camo_rate: short.ratios.camo_capacity, camo_margin: short.camoMargin, at: CAMO_CAPACITY_AT}}
 : {camo_capacity: {round: short.rounds.camo_capacity, camo_margin: short.ratios.camo_capacity, at: CAMO_CAPACITY_AT}};
// The lead_capacity part: the round, its Lead margin and the threshold.
const leadRecord = short => 'lead_capacity' in short.rounds ? {lead_capacity: {round: short.rounds.lead_capacity, lead_margin: short.ratios.lead_capacity, at: short.leadAt ?? LEAD_CAPACITY_AT}} : {};

// No answer affordable: keep only the pass options while the cheapest answer in the pool is out of reach. Only for the
// check kinds (Lead, camo, camo Lead) and, with one life, lead_capacity (savesFor): another rate kind alone doesn't save.
function saveFor(state, candidates, short, {paths, all, pool, pressure, moabFirst = false}) {
 const saves = savesFor(state, moabFirst);
 if (!pool || pressure?.active || !short.missing.some(saves)) return {candidates, rule: null};
 const list = typeof pool === 'function' ? pool() : pool;
 const checked = {...short, missing: short.missing.filter(saves)};
 // The cheapest answer: the first one affordable.
 const answers = list.map(c => ({c, adds: threatAdds(state, c, checked, paths)})).filter(x => x.adds.length)
  .map(({c, adds}) => ({...c, details: {...c.details, threat: adds}})).sort((a, b) => (a.details.cost ?? 1e9) - (b.details.cost ?? 1e9));
 const target = answers[0];
 if (!target || !(target.details.cost > state.cash)) return {candidates, rule: null};
 const passes = all.filter(isPass);
 if (!passes.length) return {candidates, rule: null};
 return {candidates: passes, rule: {kind: 'threat_short', removed: candidates.filter(c => !passes.includes(c)).length, round: short.round, missing: short.missing,
  rounds: short.rounds, ...camoRecord(short), ...leadRecord(short), adders: 0, saving: target.details.cost, for: target.id, cash: Math.floor(state.cash), ...(passes.some(c => !candidates.includes(c)) ? {restored: passes.map(c => c.id)} : {})}};
}
