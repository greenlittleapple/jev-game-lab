import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile, readdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {modsOff, modsOn, modsStatus, LOADER_ITEMS, VERIFY_URL} from './mods-toggle.mjs';

// A stand-in game folder in a temp directory; the real install is never touched by the tests.
async function fakeInstall(t) {
 const root = await mkdtemp(join(tmpdir(), 'jev-mods-'));
 t.after(() => rm(root, {recursive: true, force: true}));
 const gameDir = join(root, 'game'), backupDir = join(root, 'backup');
 await mkdir(join(gameDir, 'BloonsTD6_Data', 'Plugins'), {recursive: true});
 await writeFile(join(gameDir, 'BloonsTD6.exe'), 'exe');
 await writeFile(join(gameDir, 'version.dll'), 'loader');
 for (const dir of ['MelonLoader', 'Mods', 'Plugins', 'UserData', 'UserLibs', 'Btd6ModHelper']) {
  await mkdir(join(gameDir, dir));
  await writeFile(join(gameDir, dir, 'file.txt'), dir);
 }
 return {gameDir, backupDir, isRunning: async () => false};
}

test('off moves every loader item out and on moves it back, contents intact', async t => {
 const install = await fakeInstall(t);
 assert.equal((await modsStatus(install)).state, 'on');
 const off = await modsOff(install);
 assert.equal(off.changed, true);
 assert.deepEqual(off.items, LOADER_ITEMS);
 assert.ok(off.message.includes(VERIFY_URL), 'the message gives the Steam verify step');
 assert.deepEqual((await readdir(install.gameDir)).sort(), ['BloonsTD6.exe', 'BloonsTD6_Data'], 'the game\'s own Plugins folder stays');
 assert.equal((await modsStatus(install)).state, 'off');
 assert.equal((await modsOff(install)).changed, false, 'running it again changes nothing');
 const on = await modsOn(install);
 assert.equal(on.changed, true);
 assert.equal(await readFile(join(install.gameDir, 'Mods', 'file.txt'), 'utf8'), 'Mods');
 assert.equal((await modsStatus(install)).state, 'on');
});

test('it refuses while the game runs, without the game, on conflicts, and a dry run moves nothing', async t => {
 const install = await fakeInstall(t);
 await assert.rejects(modsOff({...install, isRunning: async () => true}), /BTD6 is running/);
 await assert.rejects(modsOff({...install, gameDir: install.backupDir}), /BloonsTD6\.exe was not found/);
 await assert.rejects(modsOff({...install, gameDir: undefined}), /Set BTD6_DIR/);
 const dry = await modsOff({...install, dryRun: true});
 assert.equal(dry.changed, false);
 assert.match(dry.message, /^Would move version\.dll, MelonLoader/);
 assert.equal((await modsStatus(install)).state, 'on');
 await mkdir(join(install.backupDir, 'Mods'), {recursive: true});
 await assert.rejects(modsOff(install), /backup folder already holds Mods/);
 await rm(join(install.backupDir, 'Mods'), {recursive: true});
 await modsOff(install);
 await writeFile(join(install.gameDir, 'version.dll'), 'a fresh loader install');
 await assert.rejects(modsOn(install), /game folder already has version\.dll/);
 assert.equal((await modsStatus(install)).state, 'mixed');
});
