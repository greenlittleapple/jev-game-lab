import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MOD_HELPER_PIN, modHelperProblem} from './pins.mjs';

test('the loaded Mod Helper must be the pinned build', () => {
 const health = mod_helper => ({version: '0.3.0', mod_helper});
 assert.equal(modHelperProblem(health({...MOD_HELPER_PIN, file: 'Btd6ModHelper.dll'})), null);
 assert.match(modHelperProblem(health({version: '3.6.9', sha256: 'cd'.repeat(32)})), /3\.6\.9 .*not the pinned 3\.6\.8/);
 assert.match(modHelperProblem(health({version: '3.6.8', sha256: 'cd'.repeat(32)})), /not the pinned/, 'same version, different build');
 assert.match(modHelperProblem({version: '0.2.0'}), /doesn't report which Mod Helper/);
 assert.equal(modHelperProblem({version: '0.2.0'}, null), null, 'a null pin turns the check off');
});
