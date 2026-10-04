// Opt-in patch for the exact published native Team package; no profile changes.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
if (process.argv.length !== 4 || process.argv[2] !== '--runtime') throw new Error('Usage: node scripts/patch-native-teams.mjs --runtime /absolute/path/to/@deepseek-ai/dsh');
const runtime = await realpath(resolve(process.argv[3]));
const require = createRequire(resolve(runtime, 'package.json'));
const manifest = JSON.parse(await readFile(new URL('../runtime-patches/native-team-options.json', import.meta.url), 'utf8'));
const packagePath = require.resolve(manifest.package + '/package.json');
const root = await realpath(dirname(packagePath));
const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
if (pkg.name !== manifest.package || pkg.version !== manifest.version) throw new Error('Native Team package/version mismatch; nothing changed');
const pending = [];
for (const file of manifest.files) {
  const target = await realpath(resolve(root, file.path));
  const local = relative(root, target);
  if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('Patch target escaped the native package');
  const before = await readFile(target, 'utf8');
  if (sha(before) === file.afterSha256) continue;
  if (sha(before) !== file.beforeSha256) throw new Error(`Unexpected native source hash for ${file.path}; nothing changed`);
  let after = before;
  for (const replacement of file.replacements) {
    const index = after.indexOf(replacement.before);
    if (index < 0 || after.indexOf(replacement.before, index + 1) >= 0) throw new Error(`Non-unique native patch hunk for ${file.path}; nothing changed`);
    after = after.slice(0, index) + replacement.after + after.slice(index + replacement.before.length);
  }
  if (sha(after) !== file.afterSha256) throw new Error(`Native patch output mismatch for ${file.path}; nothing changed`);
  pending.push({ target, before, after });
}
// All version/content/path checks complete before the first write.
const written = [];
try {
  for (const file of pending) {
    if (sha(await readFile(file.target, 'utf8')) !== sha(file.before)) throw new Error('Native source changed during patching');
    await writeFile(file.target, file.after);
    written.push(file);
  }
} catch (error) {
  for (const file of written.reverse()) await writeFile(file.target, file.before);
  throw error;
}
console.log(`Native Team API patch verified: ${pending.length} files changed. Start a fresh DSH process to activate it. Runtime upgrades may replace this optional patch.`);
