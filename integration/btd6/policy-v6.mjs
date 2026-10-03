// Policy btd6-jev-v6: Jev alone, v4 plus majority wait and a tower cap (docs/ARCHITECTURE.md, "Policy btd6-jev-v6").
// A v4 run on the 31-spot catalog (fixed 5x, ruleset v2) lost at round 51 after waiting at 14 of its last
// 15 decisions while its cash rose from $2,656 to $20,593. Over the run, 31 of its 58 waits in the group
// question had less than half of Jev's probability, with the rest spread over up to 15 purchase groups. It
// also spread its cash over towers without upgrades (14 towers with 10 upgrade tiers in all at round 35).
// What changes from v4 (policy-v4.mjs):
//  - majority wait (core/hierarchical.mjs majorityWait, set in game.mjs MAJORITY_WAIT): in the group and flat
//    questions a pick of "Wait" is replaced by the most probable purchase when more than half of Jev's
//    probability is on purchases (starting the next round is not a purchase). btd6-playbook-v5 revision 3 and btd6-claude-v1 revision 2 used the same rule; from v5 revision 4 and claude-v1 revision 3 they count only on-plan purchases (game.mjs planMajorityWait);
//  - tower cap: while TOWER_CAP (12) or more towers other than the hero are placed, placements other than
//    the hero are removed (rule `tower_cap`). Exception (rule `tower_cap_exception`): a v4 survival rule
//    (SURVIVAL_RULES) has removed "Wait" and no upgrade is affordable. When the cap would leave no purchase
//    and v3's no_wait_behind had removed "Wait", "Wait" is offered again (wait_restored). btd6-playbook-v5
//    revision 5 and btd6-claude-v1 revision 4 apply the same cap (applyTowerCap) after their plan filters.
//  - revision 2 (V6_REVISION; revision 1, unrecorded, is the version of series 3): v4's rules run with
//    threat_short (threat.mjs), and the cap's exception covers placements that add a missing Lead or camo
//    answer when no upgrade adds it (below).
//  - revision 3: threat_short also checks camo Lead and burst (threat.mjs THREAT_KINDS_V2), and the estimate counts
//    the Monkey Ace at its measured share (towers.mjs GLOBAL_SHARE).
//  - revision 4: the tower table (data/towers.json 922e6b5e918c: on-damage projectiles such as the Sniper's shrapnel counted, the Skywarden at one weapon of its stance-swapped pair, the Bomb Shooter's ring clusters at half) changes every estimate behind its decisions; threat_short orders burst adders by burst-ratio gain per dollar
//    (threat.mjs THREAT_BURST_AHEAD), the same order as revision 3's pops per dollar in effect. Logging only: the
//    bloon summary in logged states (bridge 0.3.15); the --camo-margin speed option changes only the speed.
//  - revision 5: threat_short also checks camo capacity (threat.mjs THREAT_KINDS_V3, camo_capacity): a round within 3 rounds
//    with camo bloons whose camo margin is below 1.0 puts the purchases that raise it first and removes waiting.
//  - revision 6: with one life, rounds up to 10 need 3.0 times their RBE instead of 1.5 (estimate.mjs margin,
//    EARLY_ONE_LIFE_MARGIN), in every check that reads the lives margin (roundCheck, camoCheck, burst, moabCheck).
//  - revision 7: early_short (early.mjs): with one life, while the current or next round (both up to 10) is short, the
//    affordable purchases with the highest corrected capacity gain per dollar (data/early-ratios.json) go first and
//    waiting and starting the round are removed. The cap passes an answering placement only when no upgrade answers.
//  - revision 8: early_short binds: only answers within 0.8 of the best gain per dollar (and Lead, camo and camo Lead answers) stay, and unmeasured types are not answers (early.mjs EARLY_KEEP).
//  - revision 9: with one life, threat_short binds: while a gap has an affordable answer, the options are reduced to the deciding
//    gap's answers (Lead, camo and camo Lead: all of them; camo capacity and burst: within 0.8 of the best gain per dollar;
//    threat.mjs bindAnswers). In CHIMPS series 1d Jev bought other towers with a $215 camo answer affordable and lost at round 24.
//  - revision 10: with one life, the cap's exception passes only placements that add a missing Lead, camo or camo Lead
//    (threat_short's check kinds, ONE_LIFE_PASS); camo_capacity, burst and early_short answers must be upgrades while the cap
//    applies (applyTowerCap oneLife). In CHIMPS series 1e the binding answers kept taking cheap placements through the
//    exception: the two round-78 losses had 27 and 36 towers at round 75, with 10 Bomb Shooters or 9 Ninjas at 0-0-0.
//  - revision 11: with one life and the cap in force, a binding on camo_capacity, burst or early_short chooses among the
//    answers the cap allows (affordable upgrades, and placements the plan arms exempt), within the keep factor of the best
//    of those; when there are none, its placement answers pass the cap as in revision 9 (applyTowerCap bindUnderCap). In
//    CHIMPS series 1f match 1 revision 10's binding kept only four Ninja placements, the cap removed them, and the rules
//    chose "Wait" 27 times in a row from round 48 while cash rose from $482 to $11,090; the match was lost at round 51.
//  - revision 12: threat_short also checks Lead capacity (threat.mjs THREAT_KINDS_V4, lead_capacity): a round within 3
//    rounds with Lead bloons (any Lead variant, and DDTs) whose Lead margin (estimate.mjs leadCheck: the Lead-capable
//    towers' pops with reach against those bloons' full RBE times the lives margin) is below 1.0 puts the purchases that
//    raise it first, by Lead-margin gain per dollar; with one life it binds as camo_capacity does, including revision 11's
//    choice under the cap, and while no answer is affordable it saves for the cheapest, as the Lead check does; while moab_short
//    fires it is set aside as camo_capacity is. In CHIMPS series 1g match 1 revision 11 lost at round 28 to its 6 Leads after one Lead-popping
//    upgrade made the yes-or-no Lead check pass (whole margin 2.46, 96 of 138 RBE popped). threatKinds: THREAT_KINDS_V3
//    gives revision 11.
//  - revision 13: DDT-capable MOAB damage (moab.mjs setDdtCheck, hitsDdt): in moabCheck a DDT, and the DDTs inside a BAD,
//    count only the MOAB damage of towers with an attack that sees camo and pops Lead and Black (data/towers-ddt.json).
//    The check takes the toughest need for each bloon's own damage figure, so a DDT round gets its own; moab_short,
//    moab_outrun, graded speed and the MOAB gains that order answers (policy-v4.mjs withMoab) use it. Other MOAB-class
//    bloons are unchanged. In CHIMPS series 1g match 2 revision 11 measured 116 MOAB damage per second on round 90's DDTs
//    against an estimate of 110 that counted every tower (rated 1.4), and 172 to 246 on rounds 88, 89, 91 and 92; it lost
//    at round 93 to camo DDTs. The session sets it (session.mjs); setDdtCheck(false) gives revision 12.
//  - revision 14: with one life and the cap in force, a burst binding with no affordable allowed answer steps aside for that
//    decision (applyTowerCap burstStandAside): threat_short only orders the options and the cap removes placements as usual,
//    so Jev buys upgrades or waits. camo_capacity, lead_capacity and early_short keep revision 11's placement pass, since a
//    camo or Lead gap can need a new tower. In CHIMPS series 1g match 3 (lost at round 90 with 38 towers) 15 of the 17
//    placement passes were burst gaps, each a $200-400 tower that raised the burst ratio by about 0.01.
//    burstStandAside: false gives revision 13.
//  - revision 15: lead_capacity's Lead RBE counts only Lead bloons that aren't MOAB-class (Lead and its camo, fortified and
//    regrow variants); DDTs, including those inside a BAD, are left to revision 13's DDT-capable figure (estimate.mjs leadRbe,
//    threat.mjs). In CHIMPS series 1h match 2 revision 14 lost at round 95, whose Lead RBE was mostly its 30 camo DDTs, after
//    saving for a $405 Bomb Shooter (pops Lead, can't damage a DDT) at about 70 decisions in rounds 92 to 95.
//    threatOptions: {...THREAT_BURST_AHEAD, leadDdt: true} gives revision 14.
//  - revision 16: with one life, moab_short binds (policy-v4.mjs moabBinding): while a short MOAB-class round within its lead
//    has an affordable purchase that adds MOAB damage for it (revision 13's per-round gain), the options are reduced to
//    threat_short's Lead, camo and camo Lead answers, first, and the MOAB adders within 0.8 (THREAT_KEEP) of the best MOAB gain
//    per dollar. Under the cap revision 11's choice applies (capBinding): affordable upgrade answers first, placements only when
//    none. With no affordable MOAB adder nothing changes. In CHIMPS series 1h match 3 revision 14 lost at round 40 after
//    moab_short flagged it from round 36 and removed only "Wait" (fixtures/moab-bind-r40.json). moabBinding: false gives revision 15.
//  - revision 17: three changes (policy-v4.mjs, moab.mjs, threat.mjs). (1) moab_short binds only while the short round's ratio is
//    below 0.5 (MOAB_BIND_RATIO, moabBindBelow); from 0.5 to 1 it removes "Wait" and "Start round" and orders the MOAB adders, as
//    v4 does, and the cap doesn't choose for it. Revision 16 bound at 29% of the rebuilt decisions of the CHIMPS v6 logs under the
//    pinned factor 1.27, which runs low for CHIMPS. (2) moab_short looks 10 rounds ahead for rounds with DDTs (moab.mjs
//    MOAB_DDT_LEAD_ROUNDS, setMoabDdtLead, set by the session; other MOAB-class rounds keep 4, and so does the graded speed), and
//    with one life, below 0.5 and with no affordable DDT-capable purchase, it saves for the cheapest one in the pool, keeping only
//    the pass options (moabSaving; leak pressure stops it). The round-90 losses of series 1h had nothing affordable that hit DDTs
//    in their last rounds. (3) lead_capacity is due below a Lead margin of 0.5 instead of 1.0 (threat.mjs LEAD_CAPACITY_AT).
//    moabBindBelow: Infinity, moabSaving: false, threatOptions.leadAt: LEAD_CAPACITY_AT_R12 and setMoabDdtLead(MOAB_LEAD_ROUNDS)
//    give revision 16.
//  - revision 18: lead_capacity is due below a Lead margin of 1.0 again, as in revisions 12 to 16 (threat.mjs LEAD_CAPACITY_AT).
//    In CHIMPS run 2026-10-02T04-44-47 (revision 17) lead_capacity stayed off at a round-28 Lead margin of 0.62; Jev bought
//    Dart Monkeys and the match was lost at round 28 to Leads. Every revision 12 to 14 match passed round 28.
//    threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R17} gives revision 17.
//  - revision 19: two changes to moab_short's DDT binding and saving (policy-v4.mjs). (1) With one life, while the short round
//    has DDTs and moab_short binds or saves, threat_short's camo_capacity and lead_capacity answers that are affordable and
//    within 0.8 (THREAT_KEEP) of their kind's best gain per dollar stay, after the Lead, camo and camo Lead answers and before
//    the MOAB adders or the pass options (moabCapacity); threat_short evaluates those two kinds for it while moab_short has
//    adders. Under the cap they are answers of the binding (capBinding keeps those the cap allows). (2) The DDT saving targets
//    the cheapest purchase that adds at least a quarter of the short round's gap (DDT_GAP_SHARE, ddtGapShare); without one it
//    doesn't save. Series 1j (revision 18): camo_capacity was deferred to moab_short up to 27 times a match, three of the five
//    losses leaked camo regrowing Ceramics first, and four matches saved for a $16,200 Dart 5-0-2 credited with about 3 damage per
//    second (match 2: 40.9 to 43.8 against 99.3 needed). Rounds without DDTs, and so Hard Standard, are unchanged.
//    moabCapacity: false and ddtGapShare: 0 give revision 18.
//  - revision 20: the DDT check's capacity and need together (moab.mjs, both set by the session). (1) The DDT-capable figure
//    counts support effects (setDdtSupport): Village MIB and Radar Scanner coverage and camo removers upstream such as Shimmer.
//    (2) In rounds with DDTs the need is deadline-based (setDdtNeed): for every interval from one MOAB-class bloon's spawn to
//    another's deadline, the health due inside it over its length, with the DDT part against the DDT-capable figure; the
//    toughest interval sets the need. Measured DDT damage was 3.7 times today's figure at the median (37 CHIMPS DDT records
//    since 2026-10-01T20-00) and 1.9 times the support figure; the per-bloon need asked the same 99.3 for round 95 (30 camo DDTs
//    over 20 s with 50 Fortified MOABs) as for round 90 (3 DDTs). Rounds without DDTs, and so Hard Standard, keep the figure and the need.
//    (3) With one life the binding and the DDT saving target the nearest due round with a ratio below 0.5, not the weakest
//    (policy-v4.mjs moabNearest): series 1k match 4 (revision 19) saved at rounds 89 to 92 for $34,560 upgrades aimed at rounds
//    99 and 100 and lost at round 93 with $85.
//    (4) The DDT saving targets the pool purchase with the most DDT gain per dollar for its round, ties to the cheaper
//    (policy-v4.mjs ddtSaveBest): the cheapest adders were a $595 Alchemist (gain 0.1 to 0.4) and the $16,200 Dart 5-0-2 (gain
//    2 to 3), while $2,400 Sniper upgrades added about 21.
//    (5) Revision 19's two options are off again (moabCapacity: false, ddtGapShare: 0, as revision 18): in series 1k, of the
//    matches that reached round 80, revision 18 reached rounds 95, 93 and 95 and revision 19 rounds 93 and 90. They stay
//    switchable and independent of (1) to (4).
//    setDdtSupport(false), setDdtNeed(false), moabNearest: false and ddtSaveBest: false give revision 18; with moabCapacity: true and
//    ddtGapShare: DDT_GAP_SHARE as well, revision 19.
//  - revision 21: threat_short's camo_capacity on the camo rate (threat.mjs camoRate, THREAT_OPTIONS_R21): due when the
//    camo-capable towers' pops per second against the camo RBE per second over the camo spawn stretch plus 8 s, times the lives
//    margin, is below 1.0, instead of the camo margin; camo answers ranked by the rate ratio they add per dollar. Look-ahead and
//    binding unchanged; graded speed's +camo keeps the camo margin. Series 1k lost at rounds 33, 37 and 78 to camo with no camo
//    rule firing; below 1.0 the rate caught 29 of the 35 CHIMPS camo rounds that lost lives, the camo margin 18 (camo-replay.mjs
//    --models), and the losses at rounds 37 and 78 had margins of 2.28 and 1.29 and rates of 0.42 and 0.12. Applies on Hard
//    Standard and in zero-leak mode too. With one life, a camo_capacity or lead_capacity round before moab_short's short round
//    isn't set aside by moab_short (policy-v4.mjs capacityNearer): its binding stands and moab_short neither binds nor saves
//    over it; in the replay the rate's camo_capacity was set aside at round 36 (round 40 in view) before the round-37 loss and
//    at rounds 76 and 77 (round 80) before the round-78 loss. With one life camo_capacity binds, and takes precedence over
//    moab_short, only when its best affordable answer adds at least 5% of the gap to 1.0 (threat.mjs CAMO_BIND_GAP_SHARE,
//    camoBindShare; otherwise it only orders its answers): before the round-78 loss the answers added about 0.002 each against a
//    gap of 0.88. threatOptions: THREAT_BURST_AHEAD and capacityNearer: false give revision 20.
//  - revision 22: (1) The DDT saving saves only for a pool purchase it can reach before its round (policy-v4.mjs ddtReach): its
//    cost is at most the cash plus the expected income of the rounds that complete before that round starts (income.mjs, the
//    median CHIMPS cash income per round measured from the logs, data/income-chimps.json); among those, the most gain per
//    dollar, ties to the cheaper. With none reachable it doesn't save, and moab_short orders as between ratios 0.5 and 1.
//    Series 1l matches 4 and 8 and series 1k match 4 saved for $23,220 to $34,560 upgrades with cash peaking at $7,000 to
//    $17,500, and lost at round 93. (2) With one life, a camo_capacity (past the 5% bar) or lead_capacity round that is the
//    same as moab_short's short round keeps its answers under moab_short's binding and saving, after the check answers and
//    before the MOAB adders or the pass options (policy-v4.mjs capacitySame, threat.mjs capacityAt); revision 21's nearer
//    round still goes first. Series 1l matches 4 and 8 lost at round 93 to camo regrowing Ceramics while camo_capacity for
//    round 93 was deferred to the DDT saving. ddtReach: false and capacitySame: false give revision 21.
// The question and grouping are v4's.
import {floorRulesV4, groupOptionsV4, jevQuestionV4, MOAB_BIND_RATIO, DDT_GAP_SHARE} from './policy-v4.mjs';
import {THREAT_KINDS_V4, THREAT_OPTIONS_R21} from './threat.mjs';

export const JEV_POLICY_V6 = 'btd6-jev-v6';
export const TOWER_CAP = 12;
// The policy's code revision, recorded in run_start (policy_revision).
export const V6_REVISION = 22;
// v4 rules whose removal of "Wait" lifts the tower cap for that decision.
export const SURVIVAL_RULES = ['leak_pressure', 'moab_short', 'no_start_short'];

// Threat kinds whose answering placements the cap still passes with one life (from v6 revision 10, btd6-playbook-v5
// revision 14 and btd6-claude-v1 revision 13): the check kinds, not the rate kinds (camo_capacity, lead_capacity, burst) or early_short.
export const ONE_LIFE_PASS = ['lead', 'camo', 'camo_lead'];

const isWait = c => c.details?.kind === 'wait';
const buys = c => c.details?.kind === 'place' || c.details?.kind === 'upgrade';

// Towers counted against the cap: every placed tower except the hero.
export const cappedTowers = state => (state.towers ?? []).filter(t => !t.is_hero).length;

// The tower cap on the options a policy's rules left. all: the options before any rule (to find "Wait");
// kept: the options left; floorRules: the floor rules' records (the survival exception reads them);
// exempt(c): placements the cap keeps (btd6-playbook-v5 and btd6-claude-v1 exempt on-plan placements, rules-v1.mjs).
// threat_short (threat.mjs) is a survival need for the cap only through its own tags: when it fired and no kept
// upgrade adds the missing property, placements that add it (details.threat) stay, recorded as tower_cap_exception
// with survival ['threat_short'] and the placements removed; other placements are still capped.
// oneLife (from v6 revision 10, v5 revision 14, claude-v1 revision 13; false gives the earlier revisions): with lives <= 1
// that exception passes only placements that add a check kind (ONE_LIFE_PASS), and early_short's answering placements
// (details.early) are capped like any other, so the rate kinds and early_short are answered by upgrades. The record carries
// one_life_removed: the answering placements the earlier exception would have passed. When the cap leaves no purchase,
// "Wait" comes back as before if a rule removed it; with nothing left the cap does not apply.
// bindUnderCap (from v6 revision 11, v5 revision 15, claude-v1 revision 14; false gives revision 10's cap): with lives <= 1,
// a binding on a rate kind (camo_capacity, burst), early_short's binding or (from v6 revision 16, v5 revision 20, claude-v1
// revision 19) moab_short's (the rule's answers, threat.mjs withBindAnswers)
// chooses again among the answers the cap allows: affordable upgrades and uncapped (exempt or hero) placements, those within
// the binding's keep factor of the best of them by its gain per dollar, plus the answers it always keeps (early_short's Lead,
// camo and camo Lead answers). The tower_cap record carries cap_binding {rule, kind, allowed, kept}. When the answers hold none
// the cap allows, the binding's placement answers pass: tower_cap_exception with placement_pass: true. Either way the
// binding's answers are never all removed, so "Wait" is not left alone while the binding has an answer.
// burstStandAside (from v6 revision 14, v5 revision 18, claude-v1 revision 17; false gives revision 13's cap): a burst binding
// whose answers hold none the cap allows gets no placement pass. It steps aside for that decision: the options are threat_short's
// order-only ones (threat.mjs withBindAnswers unbound), and the cap applies to them as without a binding (affordable upgrades
// stay; "Wait" comes back if no purchase is left). The record carries burst_stand_aside: true. camo_capacity, lead_capacity
// and early_short bindings keep the placement pass.
// Returns null when the cap does not apply, else {candidates, rule} with the tower_cap or tower_cap_exception record.
export function applyTowerCap(state, all, kept, floorRules = [], context = {}, {cap = TOWER_CAP, exempt = () => false, oneLife = true, bindUnderCap = true, burstStandAside = true} = {}) {
 if (!state.in_game || state.popup || !(cap > 0)) return null;
 const towers = cappedTowers(state);
 const heroes = new Set((context.catalog ?? []).filter(t => t.is_hero).map(t => t.id));
 const capped = c => c.details?.kind === 'place' && !heroes.has(c.details.tower) && !exempt(c);
 if (towers < cap || !kept.some(capped)) return null;
 const one = oneLife && state.lives <= 1;
 // The placement pass (revision 11), kept for a burst binding that steps aside only when the cap would leave nothing.
 let pass = null, aside = {};
 if (one && bindUnderCap) {
  const bound = capBinding(state, kept, floorRules, capped);
  if (bound) {
   const {next, record} = bound;
   const passed = {candidates: next, rule: {kind: 'tower_cap_exception', towers, cap, survival: [record.rule], removed: kept.length - next.length, placement_pass: true}};
   if (record.placement_pass && !(burstStandAside && record.kind === 'burst')) return passed;
   if (record.placement_pass) {
    // Revision 14: the burst binding steps aside; threat_short's order-only options, then the cap as without a binding.
    pass = passed; aside = {burst_stand_aside: true};
    kept = bound.unbound ?? kept;
   } else {
    const dropped = kept.filter(c => !next.some(n => n.id === c.id) && oldPassFor(kept, floorRules, capped)(c)).length;
    return {candidates: next, rule: {kind: 'tower_cap', removed: kept.filter(c => !next.some(n => n.id === c.id)).length, towers, cap, cap_binding: record, ...(dropped ? {one_life_removed: dropped} : {})}};
   }
  }
 }
 const wait = all.find(isWait);
 const waitRemoved = Boolean(wait) && !kept.includes(wait);
 const survival = floorRules.filter(r => SURVIVAL_RULES.includes(r.kind)).map(r => r.kind);
 const upgrade = kept.some(c => c.details?.kind === 'upgrade' && c.details.cost <= state.cash);
 if (waitRemoved && survival.length && !upgrade) return {candidates: kept, rule: {kind: 'tower_cap_exception', towers, cap, survival, ...aside}};
 const checkTag = c => (c.details?.threat ?? []).some(k => ONE_LIFE_PASS.includes(k));
 const exceptionFor = exceptionTest(kept, floorRules, capped);
 // The answering placements the earlier exception passed and this one removes (one life only).
 const oldPass = oldPassFor(kept, floorRules, capped);
 const branches = one ? [['threat_short', checkTag]] : [['threat_short', threatTag], ['early_short', earlyTag]];
 // threat_short's tags first, then early_short's (details.early, early.mjs) in the same way.
 for (const [kind, tag] of branches) {
  if (!exceptionFor(kind, tag)) continue;
  const next = kept.filter(c => !capped(c) || tag(c));
  const dropped = one ? kept.filter(c => !next.includes(c) && oldPass(c)).length : 0;
  return {candidates: next, rule: {kind: 'tower_cap_exception', towers, cap, survival: [kind], removed: kept.length - next.length, ...(dropped ? {one_life_removed: dropped} : {}), ...aside}};
 }
 let next = kept.filter(c => !capped(c));
 const restore = waitRemoved && !next.some(buys);
 if (restore) next = [...next, wait];
 if (!next.length) return pass;
 const dropped = one ? kept.filter(oldPass).length : 0;
 return {candidates: next, rule: {kind: 'tower_cap', removed: kept.filter(capped).length, towers, cap, ...(restore ? {wait_restored: true} : {}), ...(dropped ? {one_life_removed: dropped} : {}), ...aside}};
}

const threatTag = c => (c.details?.threat?.length ?? 0) > 0;
const earlyTag = c => (c.details?.early ?? 0) > 0;
// Whether revision 9's exception fires for a floor rule: it ran, no kept upgrade has its tag, and a capped placement has.
const exceptionTest = (kept, floorRules, capped) => (kind, tag) => floorRules.some(r => r.kind === kind)
 && !kept.some(c => c.details?.kind === 'upgrade' && tag(c)) && kept.some(c => capped(c) && tag(c));
// The placements revision 9's exception passed: threat_short's answers, else early_short's.
function oldPassFor(kept, floorRules, capped) {
 const exceptionFor = exceptionTest(kept, floorRules, capped);
 return c => capped(c) && ((exceptionFor('threat_short', threatTag) && threatTag(c)) || (!exceptionFor('threat_short', threatTag) && exceptionFor('early_short', earlyTag) && earlyTag(c)));
}

// The one-life binding under the cap (applyTowerCap bindUnderCap). Returns null when no rate-kind or early_short binding
// left a capped placement among the options, else {next, record}. moab_short's binding (policy-v4.mjs moabBinding) is chosen
// the same way, with kind 'moab_short'; the camo and Lead capacity answers it keeps for a DDT round (answers.also, from v6
// revision 19) are answers too, and stay when the cap allows them.
function capBinding(state, kept, floorRules, capped) {
 const rule = [...floorRules].reverse().find(r => r.binding === true && r.answers && (r.kind === 'early_short' || r.kind === 'moab_short' || (r.kind === 'threat_short' && r.binding_kind !== 'check')));
 if (!rule) return null;
 const {list, value, keep, always, also = []} = rule.answers;
 const isAnswer = c => list.some(a => a.id === c.id) || also.some(a => a.id === c.id);
 if (!kept.some(c => capped(c) && isAnswer(c))) return null;
 const kind = rule.kind === 'threat_short' ? rule.binding_kind : rule.kind;
 const allowed = list.filter(c => !capped(c) && value(c) != null && (c.details?.kind !== 'upgrade' || !(c.details.cost > state.cash)));
 if (!allowed.length) {
  const next = kept.filter(c => !capped(c) || isAnswer(c) || always.some(a => a.id === c.id));
  return {next, record: {rule: rule.kind, kind, placement_pass: true}, unbound: rule.answers.unbound};
 }
 const best = Math.max(...allowed.map(value));
 const chosen = allowed.filter(c => value(c) >= best * keep);
 const first = [...always, ...also.filter(a => !capped(a))].filter(a => kept.some(c => c.id === a.id));
 const next = [...first, ...chosen.filter(c => !first.some(a => a.id === c.id))];
 return {next, record: {rule: rule.kind, kind, allowed: allowed.length, keep, best: +best.toFixed(5), kept: next.map(c => c.id)}};
}

// v4's rules, then the tower cap. context: {catalog, paths, leaks, pressure} as for v4.
// ddtReach: false and capacitySame: false give revision 21's rules; threatOptions: THREAT_BURST_AHEAD with capacityNearer: false (and those) gives revision 20's rules; moabNearest: false and ddtSaveBest: false (with setDdtSupport(false) and setDdtNeed(false)) give revision 18's rules, and with moabCapacity: true and ddtGapShare: DDT_GAP_SHARE revision 19's; threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R17} gives revision 17's rules;
// moabBindBelow: Infinity, moabSaving: false and threatOptions: {...THREAT_BURST_AHEAD, leadAt: LEAD_CAPACITY_AT_R12} (with
// setMoabDdtLead(MOAB_LEAD_ROUNDS)) give revision 16's rules; moabBinding: false gives revision 15's rules; threatOptions.leadDdt: true gives revision 14's Lead RBE; burstStandAside: false gives revision 13's cap; bindUnderCap: false gives revision 10's cap; oneLife: false revision 9's (applyTowerCap); threatBinding: false gives revision 8's rules; earlyBinding: false revision 7's; earlyShort: false revision 6's; threatShort: false revision 1's; threatKinds: THREAT_KINDS revision 2's, THREAT_KINDS_V2 revisions 3 and 4's, THREAT_KINDS_V3 revisions 5 to 11's; threatOptions: {} revision 3's.
export function floorRulesV6(state, candidates, context = {}, {cap = TOWER_CAP, threatShort = true, threatKinds = THREAT_KINDS_V4, threatOptions = THREAT_OPTIONS_R21, earlyShort = true, earlyBinding = true, threatBinding = true, oneLife = true, bindUnderCap = true, burstStandAside = true, moabBinding = true, moabBindBelow = MOAB_BIND_RATIO, moabSaving = true, moabCapacity = false, ddtGapShare = 0, moabNearest = true, ddtSaveBest = true, capacityNearer = true, ddtReach = true, capacitySame = true} = {}) {
 const base = floorRulesV4(state, candidates, context, {threatShort, threatKinds, threatOptions, earlyShort, earlyBinding, threatBinding, moabBinding, moabBindBelow, moabSaving, moabCapacity, ddtGapShare, moabNearest, ddtSaveBest, capacityNearer, ddtReach, capacitySame});
 const rules = base.constraint?.rules ?? [];
 const capped = applyTowerCap(state, candidates, base.candidates, rules, context, {cap, oneLife, bindUnderCap, burstStandAside});
 if (!capped) return base;
 return {candidates: capped.candidates, constraint: {kind: 'rules', rules: [...rules, capped.rule], removed: candidates.length - capped.candidates.length}};
}

export {groupOptionsV4 as groupOptionsV6, jevQuestionV4 as jevQuestionV6};
