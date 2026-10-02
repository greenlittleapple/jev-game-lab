// Computes the spot catalog for the map of the open match and saves it for the runner.
//   npm run btd6:spots -- --map Tutorial --confirm [--count 30] [--step 6] [--bounds minX,maxX,minY,maxY]
//   npm run btd6:spots -- --map Tutorial --dry-run    (the simulated game; writes under .private/btd6/dry-run/spots)
// It needs a fresh match on that map with no towers placed (npm run btd6:bridge -- start ...). The
// placement checks change nothing in the game; each tower the ruleset allows is checked over the grid
// in requests of at most 400 points.
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {bridgeClient, DEFAULT_PORT} from './bridge-client.mjs';
import {computeSpotCatalog, saveSpotCatalog, DEFAULT_BOUNDS, DEFAULT_STEP, DEFAULT_SPOT_COUNT} from './spot-catalog.mjs';
import {MAP_ALIASES} from './match-flow.mjs';
import {fakeGame} from './fake-bridge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const dryRun = argv.includes('--dry-run');

try {
 const map = MAP_ALIASES[flag('--map')] ?? flag('--map');
 if (!map || (!dryRun && !argv.includes('--confirm'))) throw Error(`Usage: npm run btd6:spots -- --map <map ID> (--confirm | --dry-run) [--count ${DEFAULT_SPOT_COUNT}] [--step 6] [--bounds minX,maxX,minY,maxY]`);
 const count = Number(flag('--count') ?? DEFAULT_SPOT_COUNT);
 if (!Number.isInteger(count) || count < 4 || count > 60) throw Error('--count must be a whole number from 4 to 60.');
 const step = Number(flag('--step') ?? DEFAULT_STEP);
 if (!(step >= 2 && step <= 50)) throw Error('--step must be between 2 and 50.');
 let bounds = DEFAULT_BOUNDS;
 if (flag('--bounds')) {
  const [minX, maxX, minY, maxY] = flag('--bounds').split(',').map(Number);
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) throw Error('--bounds is minX,maxX,minY,maxY.');
  bounds = {minX, maxX, minY, maxY};
 }
 let bridge;
 if (dryRun) {
  const fake = fakeGame({savedGame: false});
  bridge = fake.bridge;
  // Put the simulated game in a match on the map.
  for (const c of [{action: 'dismiss_popup', popup: 'title_screen', button: 'start', expect: {popup_class: 'TitleScreen'}},
   {action: 'dismiss_popup', popup: 'modded_client_notice', button: 'continue', expect: {popup_class: 'ModdingPopup'}},
   {action: 'dismiss_popup', popup: 'modded_client_notice', button: 'continue', expect: {popup_class: 'ModdingPopup'}},
   {action: 'start_match', map, difficulty: 'Hard', mode: 'Clicks', hero: 'Quincy'}]) await bridge.command({command_id: crypto.randomUUID(), ...c});
  while (!(await bridge.state().catch(() => null))?.in_game);
 } else bridge = bridgeClient({port: Number(process.env.BTD6_BRIDGE_PORT ?? DEFAULT_PORT)});
 const catalog = await computeSpotCatalog(bridge, {map, bounds, step, count,
  onTower: (tower, valid, total) => console.log(`${tower}: ${valid} of ${total} points valid`)});
 const file = await saveSpotCatalog(resolve(root, dryRun ? '.private/btd6/dry-run/spots' : '.private/btd6/spots'), catalog);
 console.log(`${catalog.spots.length} spots for ${catalog.map} (reference ${catalog.reference.tower}, range ${catalog.reference.radius}):`);
 for (const s of catalog.spots) console.log(` ${s.id} (${s.x}, ${s.y}): ${Math.round(100 * s.share)}% of the track, from ${Math.round(100 * (s.from ?? 0))}% to ${Math.round(100 * (s.to ?? 0))}%`);
 const none = catalog.towers.filter(t => !t.spots.length).map(t => t.id);
 if (none.length) console.log(`No catalog spot is valid for: ${none.join(', ')}.`);
 console.log(`Saved ${file}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
