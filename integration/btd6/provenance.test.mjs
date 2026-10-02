import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codeProvenance, CODE_PATHS} from './provenance.mjs';

// A git stand-in that answers each command from a table and records the calls.
const fakeGit = answers => {
 const calls = [];
 const git = (args, cwd) => { calls.push({args, cwd}); const a = answers[args[0] + ' ' + args[1]]; if (a instanceof Error) throw a; return a; };
 return {git, calls};
};

test('provenance: HEAD, the last code commit and whether tracked code differs, run from the repository root', () => {
 const {git, calls} = fakeGit({'rev-parse --show-toplevel': '/repo\n', 'rev-parse --short': 'abc1234\n', 'log -1': 'def5678\n', 'status --porcelain': ' M integration/btd6/runner.mjs\n'});
 assert.deepEqual(codeProvenance({from: '/repo/integration/btd6', git}), {lab_commit: 'abc1234', code_commit: 'def5678', code_dirty: true});
 assert.equal(calls[0].cwd, '/repo/integration/btd6');
 assert.ok(calls.slice(1).every(c => c.cwd === '/repo'), 'later calls run from the root');
 assert.deepEqual(calls[2].args, ['log', '-1', '--format=%h', '--', ...CODE_PATHS]);
 assert.deepEqual(calls[3].args, ['status', '--porcelain', '--untracked-files=no', '--', ...CODE_PATHS]);
});

test('provenance: a clean tree is code_dirty false', () => {
 const {git} = fakeGit({'rev-parse --show-toplevel': '/repo\n', 'rev-parse --short': 'abc1234\n', 'log -1': 'def5678\n', 'status --porcelain': ''});
 assert.equal(codeProvenance({from: '/repo', git}).code_dirty, false);
});

test('provenance: a failing git gives null for every field instead of throwing', () => {
 const {git} = fakeGit({'rev-parse --show-toplevel': '/repo\n', 'rev-parse --short': Error('not a git repository')});
 assert.deepEqual(codeProvenance({from: '/repo', git}), {lab_commit: null, code_commit: null, code_dirty: null});
 assert.deepEqual(codeProvenance({from: '/repo', git: () => { throw Error('git not found'); }}), {lab_commit: null, code_commit: null, code_dirty: null});
});

test('provenance: this checkout gives short hashes and a boolean', () => {
 const p = codeProvenance();
 assert.match(p.lab_commit, /^[0-9a-f]{7,}$/);
 assert.match(p.code_commit, /^[0-9a-f]{7,}$/);
 assert.equal(typeof p.code_dirty, 'boolean');
});
