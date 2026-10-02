// Turns the mod loader off and on by moving its files between the BTD6 folder and a backup folder.
// It never deletes anything and refuses to run while the game is open.
//   npm run btd6:mods -- status | off | on [--dry-run] [--game-dir <BTD6 dir>] [--backup-dir <dir>]
// BTD6_DIR and BTD6_MODS_BACKUP_DIR (from .env) set the folders. The backup folder must be on the
// same drive as the game, so each move is a rename.
// Switching back to the main Ninja Kiwi account (docs/BTD6-SPIKE-PLAN.md): log out of the mod
// account, close the game, run "off", verify the game files in Steam (steam://validate/960090),
// then log in to the main account.
import {mkdir, readdir, rename, stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Everything MelonLoader 0.7 and BTD6 Mod Helper add to the game folder.
export const LOADER_ITEMS = ['version.dll', 'MelonLoader', 'Mods', 'Plugins', 'UserData', 'UserLibs', 'Btd6ModHelper'];
export const GAME_EXE = 'BloonsTD6.exe';
export const VERIFY_URL = 'steam://validate/960090';

export async function gameRunning() {
 if (process.platform !== 'win32') throw Error('The process check is implemented for Windows only.');
 const {stdout} = await promisify(execFile)('tasklist', ['/FI', `IMAGENAME eq ${GAME_EXE}`, '/NH', '/FO', 'CSV'], {windowsHide: true});
 return stdout.toLowerCase().includes(`"${GAME_EXE.toLowerCase()}"`);
}

async function checkGameDir(gameDir) {
 if (!gameDir) throw Error('Set BTD6_DIR (or pass --game-dir) to the BTD6 install folder.');
 if (!(await stat(join(gameDir, GAME_EXE)).catch(() => null))?.isFile()) throw Error(`${GAME_EXE} was not found in ${gameDir}.`);
}

async function present(dir) {
 const names = new Set(await readdir(dir).catch(() => []));
 return LOADER_ITEMS.filter(item => names.has(item));
}

export async function modsStatus({gameDir, backupDir}) {
 await checkGameDir(gameDir);
 const inGame = await present(gameDir), inBackup = await present(backupDir);
 const state = inGame.length && !inBackup.length ? 'on' : !inGame.length && inBackup.length ? 'off' : !inGame.length ? 'no loader files found' : 'mixed';
 return {state, inGame, inBackup};
}

// Moves every item in `items` from `from` to `to`; stops at the first failure and reports what moved.
async function moveAll(items, from, to) {
 const moved = [];
 for (const item of items) {
  try { await rename(join(from, item), join(to, item)); moved.push(item); }
  catch (error) {
   const hint = error.code === 'EXDEV' ? ' The backup folder must be on the same drive as the game; set BTD6_MODS_BACKUP_DIR.' : '';
   throw Object.assign(Error(`Moving ${item} failed (${error.code ?? error.message}). Moved so far: ${moved.join(', ') || 'nothing'}.${hint}`), {moved});
  }
 }
 return moved;
}

export async function modsOff({gameDir, backupDir, isRunning = gameRunning, dryRun = false}) {
 await checkGameDir(gameDir);
 const items = await present(gameDir);
 if (!items.length) return {changed: false, message: 'Mods are already off: no loader files in the game folder.'};
 const conflicts = await present(backupDir);
 if (conflicts.length) throw Error(`The backup folder already holds ${conflicts.join(', ')}. Resolve that by hand before turning mods off.`);
 if (await isRunning()) throw Error('BTD6 is running. Close the game first.');
 if (dryRun) return {changed: false, items, message: `Would move ${items.join(', ')} to ${backupDir}.`};
 await mkdir(backupDir, {recursive: true});
 const moved = await moveAll(items, gameDir, backupDir);
 return {changed: true, items: moved, message: `Moved ${moved.join(', ')} to ${backupDir}. Mods are off. Before logging in to the main account, verify the game files in Steam: ${VERIFY_URL}`};
}

export async function modsOn({gameDir, backupDir, isRunning = gameRunning, dryRun = false}) {
 await checkGameDir(gameDir);
 const items = await present(backupDir);
 if (!items.length) return {changed: false, message: 'Nothing to restore: the backup folder holds no loader files.'};
 const conflicts = await present(gameDir);
 if (conflicts.length) throw Error(`The game folder already has ${conflicts.join(', ')}. Resolve that by hand before turning mods on.`);
 if (await isRunning()) throw Error('BTD6 is running. Close the game first.');
 if (dryRun) return {changed: false, items, message: `Would move ${items.join(', ')} back to ${gameDir}.`};
 const moved = await moveAll(items, backupDir, gameDir);
 return {changed: true, items: moved, message: `Moved ${moved.join(', ')} back. Mods are on. Launch the game only while logged in to the mod account.`};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
 const options = {gameDir: flag('--game-dir') ?? process.env.BTD6_DIR, dryRun: args.includes('--dry-run'),
  backupDir: flag('--backup-dir') ?? process.env.BTD6_MODS_BACKUP_DIR ?? resolve(root, '.private/btd6/mods-off')};
 const command = args[0];
 try {
  if (command === 'status') {
   const s = await modsStatus(options);
   console.log(`Mods: ${s.state}. In the game folder: ${s.inGame.join(', ') || 'none'}. In the backup folder: ${s.inBackup.join(', ') || 'none'}.`);
  } else if (command === 'off') console.log((await modsOff(options)).message);
  else if (command === 'on') console.log((await modsOn(options)).message);
  else { console.error('Usage: mods-toggle status | off | on [--dry-run] [--game-dir <dir>] [--backup-dir <dir>]'); process.exitCode = 2; }
 } catch (error) { console.error(error.message); process.exitCode = 1; }
}
