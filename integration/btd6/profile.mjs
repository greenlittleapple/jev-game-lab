// The saved-profile guard. The bridge's /api/v1/profile reads the account's persisted profile fields
// (not the unlock checks the override patches). The runner snapshots it when a run starts and ends and
// compares the two: rank, XP, tower XP, knowledge points, medals and stats may change through normal
// play, but a tower, hero or upgrade that appears in the saved unlocked or acquired lists during a run
// is a profile write, which the run log records as a warning and the scorecard flags, unless the run
// earned it (explainUnlocks below).

const LISTS = [['towers', 'unlocked_towers'], ['heroes', 'unlocked_heroes'], ['upgrades', 'acquired_upgrades']];

// What goes into the run log and series.jsonl: the full lists and the XP figures.
export function profileSnapshot(p) {
 return {observed_at: p.observed_at ?? null, bridge_version: p.bridge_version ?? null, unlock_all: p.unlock_all ?? null,
  rank: p.rank ?? null, xp: p.xp ?? null, veteran_rank: p.veteran_rank ?? null, knowledge_points: p.knowledge_points ?? null,
  unlocked_towers: p.unlocked_towers ?? [], unlocked_heroes: p.unlocked_heroes ?? [], acquired_upgrades: p.acquired_upgrades ?? [],
  acquired_knowledge: p.acquired_knowledge ?? [], tower_xp: p.tower_xp ?? {}};
}

const added = (before, after) => { const had = new Set(before ?? []); return [...new Set(after ?? [])].filter(id => !had.has(id)).sort(); };

// The ranks at which the game gives a hero for free (the splash after the rank-up; ARCHITECTURE.md, screens).
// Profile ranks count from 1: Gwendolin's splash was seen as the profile went from rank 13 to 14. Towers
// have no rank table here: they come from the rank-up tower pick or their own unlock splash.
export const HERO_UNLOCK_RANKS = {Gwendolin: 14, StrikerJones: 21, ObynGreenfoot: 28};

// The screens of a run that can explain an unlock: {kind, id} with id the unlocked hero or tower when known.
// From the guard's own profile_screen records (with IDs) and, for older logs, the forced dismiss_popup
// dispatches (kind only).
const SCREEN_KINDS = ['level_up', 'hero_unlock_notice', 'tower_unlock_notice', 'tower_unlock_choice'];
export function screensFromEvents(events) {
 const out = [];
 for (const e of events ?? []) {
  if (e.kind === 'profile_screen' && SCREEN_KINDS.includes(e.popup)) out.push({kind: e.popup, id: e.unlocked ?? null});
  else if (e.kind === 'dispatch' && e.command?.action === 'dismiss_popup' && SCREEN_KINDS.includes(e.command.popup)) out.push({kind: e.command.popup, id: null});
 }
 return out;
}

// "GwendolinUnlockUI" -> "Gwendolin" (the bridge's UnlockSplashKinds.UnlockedId).
export const unlockedId = menuName => typeof menuName === 'string' && menuName.endsWith('UnlockUI') && menuName.length > 8 ? menuName.slice(0, -8) : null;

// What a screen over the match says about unlocks, or null: the ID on an unlock splash, the pick on the tower pick.
export function screenRecord(popup) {
 if (!popup || !SCREEN_KINDS.includes(popup.kind)) return null;
 const id = popup.kind === 'tower_unlock_choice' ? popup.options?.[0] ?? null
  : popup.kind === 'level_up' ? null : unlockedId(popup.menu_name);
 return {kind: popup.kind, id};
}

// Splits the added IDs into earned and unexplained. A hero is earned by its hero_unlock_notice, or by a
// rank-up screen with a rank increase that passes its unlock rank; a tower by its tower_unlock_notice or a
// tower pick of it. Upgrades are never earned: the runner doesn't buy them, and the game gives none at a rank-up.
export function explainUnlocks(added, screens, start, end) {
 const earned = {towers: [], heroes: []}, by = {}, writes = {towers: [], heroes: [], upgrades: [...(added.upgrades ?? [])]};
 const seen = (kind, id) => screens.some(s => s.kind === kind && s.id === id);
 const rankUp = screens.some(s => s.kind === 'level_up');
 const from = start?.rank, to = end?.rank;
 for (const id of added.heroes ?? []) {
  const rank = HERO_UNLOCK_RANKS[id];
  if (seen('hero_unlock_notice', id)) { earned.heroes.push(id); by[id] = 'unlock screen'; }
  else if (rankUp && rank != null && from != null && to != null && from < rank && rank <= to) { earned.heroes.push(id); by[id] = 'rank-up'; }
  else writes.heroes.push(id);
 }
 for (const id of added.towers ?? []) {
  if (seen('tower_unlock_notice', id)) { earned.towers.push(id); by[id] = 'unlock screen'; }
  else if (seen('tower_unlock_choice', id)) { earned.towers.push(id); by[id] = 'tower pick'; }
  else writes.towers.push(id);
 }
 return {writes, earned, earned_by: by};
}

// start, end: snapshots. screens: screensFromEvents' records for the run. writes: IDs that appeared in the
// unlocked or acquired lists with nothing in the run to explain them; any makes profile_write true.
// earned: towers and heroes the run's screens and rank-up explain (earned_by: how). changes: what normal
// play may change, for the record.
export function profileDiff(start, end, screens = []) {
 const addedIds = Object.fromEntries(LISTS.map(([key, field]) => [key, added(start[field], end[field])]));
 const {writes, earned, earned_by} = explainUnlocks(addedIds, screens, start, end);
 const towerXp = Object.entries(end.tower_xp ?? {}).map(([tower, xp]) => ({tower, gained: (xp ?? 0) - (start.tower_xp?.[tower] ?? 0)}))
  .filter(t => t.gained !== 0).sort((a, b) => a.tower.localeCompare(b.tower));
 const delta = key => end[key] != null && start[key] != null ? end[key] - start[key] : null;
 return {
  profile_write: Object.values(writes).some(ids => ids.length > 0), writes, earned, earned_by,
  changes: {rank: delta('rank'), rank_from: start.rank ?? null, rank_to: end.rank ?? null, xp: delta('xp'), knowledge_points: delta('knowledge_points'),
   new_knowledge: added(start.acquired_knowledge, end.acquired_knowledge), tower_xp: towerXp},
 };
}

export const describeWrites = writes => LISTS.map(([key]) => writes[key]?.length ? `${key}: ${writes[key].join(', ')}` : null).filter(Boolean).join('; ');

// "by rank-up: StrikerJones; by tower pick: MonkeyAce", or '' when nothing was earned.
export function describeEarned(check) {
 const groups = new Map();
 for (const id of [...(check.earned?.heroes ?? []), ...(check.earned?.towers ?? [])]) {
  const how = check.earned_by?.[id] ?? 'unlock screen';
  groups.set(how, [...(groups.get(how) ?? []), id]);
 }
 return [...groups].map(([how, ids]) => `by ${how}: ${ids.join(', ')}`).join('; ');
}

// The CLI summary: counts and the unlocked and acquired lists.
export function profileSummary(p) {
 return {
  bridge_version: p.bridge_version ?? null, observed_at: p.observed_at ?? null,
  unlock_all: p.unlock_all ?? null,
  rank: p.rank ?? null, xp: p.xp ?? null, knowledge_points: p.knowledge_points ?? null,
  counts: {unlocked_towers: p.unlocked_towers?.length ?? 0, unlocked_heroes: p.unlocked_heroes?.length ?? 0,
   acquired_upgrades: p.acquired_upgrades?.length ?? 0, acquired_knowledge: p.acquired_knowledge?.length ?? 0,
   towers_with_xp: Object.keys(p.tower_xp ?? {}).length},
  unlocked_towers: p.unlocked_towers ?? [], unlocked_heroes: p.unlocked_heroes ?? [], acquired_upgrades: p.acquired_upgrades ?? [],
 };
}

// The guard for one run. read() -> the bridge's /profile. Logs profile_snapshot at the start and end,
// and profile_check at the end, with a warning record on a write and a note on earned unlocks. A bridge without /profile (before
// 0.3.2) logs the error, and the scorecard shows the run as unchecked.
export function profileGuard({read, log, series = null}) {
 const runs = new Map();
 const take = async () => { try { return {profile: profileSnapshot(await read())}; } catch (error) { return {error: error.message}; } };
 return {
  // Returns the snapshot (or null) for the run's series entry.
  start: async matchId => {
   const snap = await take();
   runs.set(matchId, {start: snap.profile ?? null, checked: false, screens: [], open: null});
   await log.append({kind: 'profile_snapshot', at: 'start', match_id: matchId, ...snap});
   return snap.profile ?? null;
  },
  // Called with each state's popup (or null): an unlock splash, rank-up or tower pick is recorded
  // (profile_screen) once per opening, for explaining unlocks at the end.
  screen: async (matchId, popup) => {
   const run = runs.get(matchId);
   if (!run || run.checked) return;
   const record = screenRecord(popup);
   const key = record ? `${popup.class ?? ''}|${popup.menu_name ?? ''}|${record.id ?? ''}` : null;
   if (key === run.open) return;
   run.open = key;
   if (!record) return;
   run.screens.push(record);
   await log.append({kind: 'profile_screen', match_id: matchId, popup: record.kind, unlocked: record.id});
  },
  end: async matchId => {
   const run = runs.get(matchId);
   if (!run || run.checked) return null;
   run.checked = true;
   const snap = await take();
   await log.append({kind: 'profile_snapshot', at: 'end', match_id: matchId, ...snap});
   const check = run.start && snap.profile ? {status: 'checked', ...profileDiff(run.start, snap.profile, run.screens)}
    : {status: 'unchecked', reason: snap.error ?? 'no profile snapshot at the start'};
   await log.append({kind: 'profile_check', match_id: matchId, ...check});
   if (check.profile_write) await log.append({kind: 'warning', match_id: matchId,
    message: `The saved profile gained unlocks during the run (${describeWrites(check.writes)}).`});
   if (check.earned && describeEarned(check)) await log.append({kind: 'note', match_id: matchId,
    message: `Unlocks earned during the run: ${describeEarned(check)}.`});
   await series?.append({run: matchId, kind: 'profile_check', profile_end: snap.profile ?? null, ...check});
   return check;
  },
 };
}

// A run's profile_check, re-read from its snapshots and screens when it was written before the guard
// knew about earned unlocks (no `earned` field) and both snapshots are in the events.
export function runProfileCheck(events) {
 const check = events.findLast(e => e.kind === 'profile_check');
 if (!check || check.status !== 'checked' || check.earned) return check ?? null;
 const snap = at => events.findLast(e => e.kind === 'profile_snapshot' && e.at === at && e.profile)?.profile;
 const start = snap('start'), end = snap('end');
 return start && end ? {...check, ...profileDiff(start, end, screensFromEvents(events))} : check;
}

// The scorecard's reading of a run's profile_check record: "WRITE (...)" for unexplained unlocks, else
// "earned (...)" or "unchanged".
export function profileStatus(events) {
 const check = runProfileCheck(events);
 if (!check || check.status !== 'checked') return 'unchecked';
 const earned = describeEarned(check);
 if (check.profile_write) return `WRITE (${describeWrites(check.writes)})${earned ? `; earned (${earned})` : ''}`;
 return earned ? `earned (${earned})` : 'unchanged';
}
