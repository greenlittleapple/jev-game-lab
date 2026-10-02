// Repository check: committed files must not carry private details (local user paths, drive-letter
// install paths, personal emails, Steam IDs, API keys). Ignored folders are skipped.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {join, relative, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', '.private', 'bin', 'obj', '.vs']);
const BINARY = new Set(['.dll', '.exe', '.png', '.jpg', '.pdb', '.zip']);
const PATTERNS = [
 ['a local user folder', /[A-Za-z]:[\\/]+Users[\\/]+/i],
 ['a drive-letter install path', /[A-Za-z]:[\\/]+(?:Program Files|Games|SteamLibrary)/i],
 ['an email address other than a GitHub noreply one', /[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
 ['a Steam ID', /\b7656119\d{10}\b/],
 ['an API key value', /TYPESAFE_API_KEY\s*=\s*[^\s#]+/],
];

async function* files(dir) {
 for (const entry of await readdir(dir, {withFileTypes: true})) {
  if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) yield* files(join(dir, entry.name)); }
  // In a git worktree, .git is a file holding the main checkout's path; it is never committed.
  else if (!BINARY.has(extname(entry.name).toLowerCase()) && entry.name !== '.env' && entry.name !== '.git') yield join(dir, entry.name);
 }
}

test('no private details in the repository files', async () => {
 const found = [];
 for await (const file of files(root)) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, i) => { for (const [what, pattern] of PATTERNS) if (pattern.test(line)) found.push(`${relative(root, file)}:${i + 1}: ${what}`); });
 }
 assert.deepEqual(found, []);
});
