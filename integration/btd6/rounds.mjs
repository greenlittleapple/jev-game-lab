// Round facts for the standard round set (not Alternate Bloons Rounds), as the game displays round
// numbers. From the BTD6 Mod Helper game-data export for version 56.0 (Btd6ModHelper/btd6-game-data,
// Rounds/DefaultRoundSet and Mods/*.json); the 56.1 to 56.3 patch notes list no round or cost changes.
// Checked 2026-09-29 against Blooncyclopedia (https://www.bloonswiki.com/).
export const DIFFICULTIES = {
 Easy: {start: 1, end: 40, lives: 200},
 Medium: {start: 1, end: 60, lives: 150},
 Hard: {start: 3, end: 80, lives: 100},
};
// Modes that change the round range or lives. CHIMPS's internal mode ID is "Clicks".
export const MODES = {
 Impoppable: {start: 6, end: 100, lives: 1},
 Clicks: {start: 6, end: 100, lives: 1, name: 'CHIMPS', noSelling: true},
};

// First round each bloon property or MOAB-class bloon appears. consult: whether its approach asks
// the strategist (the others only appear in briefs and in Jev's threats_ahead).
export const THREATS = [
 {id: 'regrow', round: 17, label: 'first Regrow bloons', consult: false},
 {id: 'black', round: 20, label: 'first Black bloons', consult: false},
 {id: 'white', round: 22, label: 'first White bloons', consult: false},
 {id: 'camo', round: 24, label: 'first Camo bloon (one Camo Green)', consult: true},
 {id: 'purple', round: 25, label: 'first Purple bloons', consult: true},
 {id: 'zebra', round: 26, label: 'first Zebra bloons', consult: false},
 {id: 'lead', round: 28, label: 'first Lead bloons', consult: true},
 {id: 'rainbow', round: 35, label: 'first Rainbow bloons', consult: false},
 {id: 'ceramic', round: 38, label: 'first Ceramic bloons', consult: true},
 {id: 'moab', round: 40, label: 'first MOAB', consult: true},
 {id: 'fortified', round: 45, label: 'first Fortified bloons (Fortified Leads)', consult: true},
 {id: 'camo_lead', round: 59, label: 'first Camo Lead bloons', consult: true},
 {id: 'bfb', round: 60, label: 'first BFB', consult: true},
 {id: 'fortified_moab', round: 62, label: 'first Fortified MOAB', consult: true},
 {id: 'zomg', round: 80, label: 'first ZOMG', consult: true},
 {id: 'ddt', round: 90, label: 'first DDTs (always camo)', consult: true},
 {id: 'bad', round: 100, label: 'the BAD', consult: true},
];
export const THREAT_IDS = THREATS.map(t => t.id);

// The standard mode's ID is expected to be "Standard" or the difficulty's own name; the first
// spike reads it from a live match.
export function modeName(difficulty, mode) {
 if (!mode || mode === 'Standard' || mode === difficulty) return 'Standard';
 return MODES[mode]?.name ?? mode;
}

// {start, end, lives, name} for a difficulty and mode; a special mode overrides the difficulty.
export function roundRange(difficulty, mode) {
 const base = DIFFICULTIES[difficulty] ?? null, special = MODES[mode] ?? null;
 if (!base && !special) return null;
 return {...base, ...special, name: modeName(difficulty, mode)};
}

// Threats that first appear after `round` and no later than round + within, inside the match.
export function upcomingThreats(round, {within = 10, start = 1, end = 100, consultOnly = false} = {}) {
 return THREATS.filter(t => t.round > round && t.round <= round + within && t.round >= start && t.round <= end && (!consultOnly || t.consult));
}
