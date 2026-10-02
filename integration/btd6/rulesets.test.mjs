import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_RULESET, RULESETS, allowedCatalog, bridgeAtLeast, findRuleset, rulesetProblem, requireAllUnlocks, runMetadata, rulesetId} from './rulesets.mjs';
import {round21, preRound, catalog} from './fixtures/index.mjs';

test('btd6-open-v1 allows every tower and only its hero', () => {
 const v1 = RULESETS['btd6-open-v1'];
 const ids = allowedCatalog(v1, catalog).map(t => t.id);
 assert.ok(ids.includes('Quincy') && !ids.includes('Gwendolin'));
 assert.deepEqual(ids.filter(id => id !== 'Quincy'), catalog.filter(t => !t.is_hero).map(t => t.id), 'every non-hero tower, locked or not; the candidates check unlocks');
 assert.deepEqual(allowedCatalog({...v1, towers: ['DartMonkey'], hero: null}, catalog).map(t => t.id), ['Quincy', 'DartMonkey', 'Gwendolin']);
});

// The towers whose attack needs a point or the cursor (aim.mjs), in a shop that has them.
const aimShop = [...catalog, ...['DartlingGunner', 'MortarMonkey', 'HeliPilot', 'MonkeyAce'].map(id => ({id, cost: 800, range: 30, is_hero: false, unlocked: true}))];

test('the default ruleset, btd6-open-v2, leaves out the Dartling Gunner, Mortar Monkey and Heli Pilot; v3 aims them', () => {
 assert.equal(rulesetId(DEFAULT_RULESET), 'btd6-open-v2');
 const v2 = allowedCatalog(RULESETS['btd6-open-v2'], aimShop).map(t => t.id);
 for (const id of ['DartlingGunner', 'MortarMonkey', 'HeliPilot']) assert.ok(!v2.includes(id), id);
 assert.ok(v2.includes('MonkeyAce') && v2.includes('DartMonkey'), 'the Ace keeps its default circle');
 const v3 = allowedCatalog(RULESETS['btd6-open-v3'], aimShop).map(t => t.id);
 for (const id of ['DartlingGunner', 'MortarMonkey', 'HeliPilot']) assert.ok(v3.includes(id), id);
 assert.deepEqual([findRuleset(null), findRuleset('v3'), findRuleset('3'), findRuleset('v2'), findRuleset('btd6-open-v1')].map(rulesetId), ['btd6-open-v2', 'btd6-open-v3', 'btd6-open-v3', 'btd6-open-v2', 'btd6-open-v1']);
 assert.throws(() => findRuleset('v9'), /Unknown ruleset v9/);
 // v3 needs a bridge that can aim.
 assert.match(rulesetProblem(RULESETS['btd6-open-v3'], {...round21(), bridge_version: '0.3.13'}), /needs bridge 0.3.14/, 'set_targeting was fixed in 0.3.14');
 assert.equal(rulesetProblem(RULESETS['btd6-open-v3'], {...round21(), bridge_version: '0.3.14'}), null);
 assert.equal(rulesetProblem(RULESETS['btd6-open-v2'], {...round21(), bridge_version: '0.3.11'}), null, 'v2 runs on 0.3.11');
 assert.deepEqual([bridgeAtLeast('0.3.12', '0.3.12'), bridgeAtLeast('0.4.0', '0.3.12'), bridgeAtLeast('0.3.9', '0.3.12'), bridgeAtLeast(null, '0.3.12')], [true, true, false, false]);
});

test('a match with Double Cash, or without unlock_all when BTD6_REQUIRE_ALL_UNLOCKS is set, does not meet the ruleset', () => {
 assert.equal(rulesetProblem(DEFAULT_RULESET, round21()), null);
 assert.equal(rulesetProblem(DEFAULT_RULESET, {...round21(), unlock_all: false}, {allUnlocks: false}), null, 'the account' + "'" + 's own unlocks are enough by default');
 assert.match(rulesetProblem(DEFAULT_RULESET, {...round21(), unlock_all: false}, {allUnlocks: true}), /BTD6_REQUIRE_ALL_UNLOCKS is set/);
 assert.equal(rulesetProblem(DEFAULT_RULESET, round21(), {allUnlocks: true}), null);
 assert.deepEqual([requireAllUnlocks({}), requireAllUnlocks({BTD6_REQUIRE_ALL_UNLOCKS: '1'})], [false, true]);
 assert.match(rulesetProblem(DEFAULT_RULESET, {...round21(), match: {...round21().match, double_cash_used: true}}), /excludes Double Cash/);
 assert.equal(rulesetProblem(DEFAULT_RULESET, {in_game: false, screen: 'menu'}), null);
});

test('each run records the setup, ruleset and unlock_all', () => {
 assert.deepEqual(runMetadata(preRound(), DEFAULT_RULESET, 'btd6-strategist-v0'), {
  setup: {map: 'Tutorial', difficulty: 'Hard', mode: 'Standard', mode_name: 'Standard', start_round: 3, end_round: 80},
  ruleset: {id: 'btd6-open-v2', name: 'btd6-open', version: 2, excluded: ['DartlingGunner', 'MortarMonkey', 'HeliPilot'], aimed: false}, unlock_all: true, double_cash_used: null,
  speed: null, conditions: {auto_start: true, fast_forward: false, multiplier: null, speed: 1},
  bridge_version: '0.1.0', game_version: '56.3', policy: 'btd6-strategist-v0'});
});
