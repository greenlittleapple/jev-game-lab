// Which code a run used, for run_start and the series file (logging only; nothing decides on these fields).
// lab_commit: the short hash of HEAD in the checkout this code runs from. code_commit: the short hash of the
// last commit that touched core/, integration/ or package.json, so doc-only commits don't split runs.
// code_dirty: whether tracked files under those paths differ from HEAD. Git runs from the repository root of
// this file's checkout; if any git call fails, every field is null.
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CODE_PATHS = ['core', 'integration', 'package.json'];
const NONE = Object.freeze({lab_commit: null, code_commit: null, code_dirty: null});

const runGit = (args, cwd) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: true});

// git(args, cwd) returns stdout; injectable for tests.
export function codeProvenance({from = dirname(fileURLToPath(import.meta.url)), git = runGit} = {}) {
 try {
  const root = git(['rev-parse', '--show-toplevel'], from).trim();
  if (!root) return {...NONE};
  const lab = git(['rev-parse', '--short', 'HEAD'], root).trim();
  const code = git(['log', '-1', '--format=%h', '--', ...CODE_PATHS], root).trim();
  const status = git(['status', '--porcelain', '--untracked-files=no', '--', ...CODE_PATHS], root);
  return {lab_commit: lab || null, code_commit: code || null, code_dirty: status.trim().length > 0};
 } catch {
  return {...NONE};
 }
}
