import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || ['zod', 'js-yaml'].includes(specifier)) ? runtime.resolve(specifier) : specifier, context); } });
const yaml = runtime('js-yaml');
const schema = yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: expression => ({ __jsExpr: expression }) }));

export async function readPreset() {
  const patches = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema });
  return patches[0].insert.find(row => row.id === 'preset-codex-mentor');
}

test('every active preset plugin satisfies its installed native Config schema', async () => {
  const preset = await readPreset();
  const validated = [];
  async function visit(rows) {
    for (const row of rows) {
      const disabled = row.disabled?.__jsExpr ? Function('process', `return (${row.disabled.__jsExpr})`)(process) : row.disabled;
      if (disabled) continue;
      if (row.group) { await visit(row.config); continue; }
      const mod = await import(row.name.startsWith('dsh-codex-mentor/') ? new URL('../' + row.name.split('/')[1] + '.js', import.meta.url).href : runtime.resolve(row.name));
      const Config = mod.Config ?? mod.default?.Config;
      if (Config) assert.doesNotThrow(() => Config(row.config), `${row.id} (${row.name}) native Config`);
      validated.push(row.id);
    }
  }
  await visit(preset.config.plugins);
  assert.ok(validated.includes('tool-fs-search'));
  assert.ok(validated.includes('mentor-compaction'));
});

test('one portable bundle contains the versioned Host and declares Codex Connect', async () => {
  const patchUrl = new URL('../cordis.patch.yml', import.meta.url);
  const patches = yaml.load(await readFile(patchUrl, 'utf8'), { schema });
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const host = patches[0].insert.find(row => row.id === 'codex-mentor-host');
  const entry = new URL(host.name, patchUrl);
  assert.equal(entry.pathname, new URL(`../host-${pkg.version}.js`, import.meta.url).pathname);
  const wrapper = await readFile(entry, 'utf8');
  assert.ok(wrapper.includes(`./index.js?mentor=${pkg.version}`), 'upgrades must load a fresh Host module');
  assert.ok(pkg.peerDependencies['dsh-codex-connect']);
  assert.ok(!JSON.stringify(patches).includes('file:///'), 'no hard-coded profile or machine path');
});
