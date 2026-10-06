import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('@deepseek-ai/') ? runtime.resolve(specifier) : specifier, context); } });
const { apply, removeProfileCountQuotas } = await import('../count-quota-migration.js');
const ownId = 'mentor-count-quota-migration';
function fixture() {
  const entries = [
    { options: { id: 'subagent', config: { maxDepth: 3, maxActiveSubagents: 30 } } },
    { options: { id: 'agent-team', config: { maxMembers: 8, maxTasks: 256, maxPendingMessagesPerMember: 17, maxMessageBytes: 12345, disposalTimeoutMs: 4321 } } },
    { options: { id: ownId, config: { applied: false } } }
  ], edits = [];
  const ctx = { agents: { list: () => [] }, get: key => key === 'agentTeams' ? {} : undefined, configEditor: { entries: () => entries, async edit(entry, derive) { edits.push(entry.options.id); entry.options.config = derive(structuredClone(entry.options.config)); } } };
  return { ctx, entries, edits };
}
test('native editor clears higher-priority 8/30 count quotas once, preserving depth and unrelated fields', async () => {
  const f = fixture(), original = structuredClone(f.entries[1].options.config);
  await removeProfileCountQuotas(f.ctx, ownId);
  assert.deepEqual(f.entries[0].options.config, { maxDepth: 3, maxActiveSubagents: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(f.entries[1].options.config, { ...original, maxMembers: Number.MAX_SAFE_INTEGER, maxTasks: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(f.edits, ['subagent', 'agent-team', ownId]); assert.equal(f.entries[2].options.config.applied, true);
  apply({ get() { throw new Error('Must not repeat a completed migration'); } }, { applied: true });
});
test('count edits never reload resident workers and never enable absent Teams', async () => {
  const f = fixture(); f.ctx.agents.list = () => [{ session: { header: { origin: 'subagent' } }, status: 'idle' }];
  await assert.rejects(removeProfileCountQuotas(f.ctx, ownId), /resident child/); assert.deepEqual(f.edits, []);
  const absent = fixture(); absent.entries.splice(1, 1); absent.ctx.get = () => undefined;
  await removeProfileCountQuotas(absent.ctx, ownId); assert.deepEqual(absent.edits, ['subagent', ownId]);
});
test('a higher-priority refusal leaves migration pending instead of claiming unlimited staffing', async () => {
  const f = fixture(); f.ctx.configEditor.edit = async entry => { f.edits.push(entry.options.id); };
  await assert.rejects(removeProfileCountQuotas(f.ctx, ownId), /higher-priority layer/);
  assert.equal(f.entries[2].options.config.applied, false); assert.deepEqual(f.edits, ['subagent']);
  const cancelled = fixture(); let ready, cleanup;
  cancelled.ctx.fiber = { entry: cancelled.entries[2] }; cancelled.ctx.logger = { error: assert.fail };
  cancelled.ctx.get = key => key === 'appReady' ? { onReady(fn) { ready = fn; return () => {}; } } : undefined;
  cancelled.ctx.effect = fn => { cleanup = fn(); };
  apply(cancelled.ctx, { applied: false }); cleanup(); ready(); await Promise.resolve(); assert.deepEqual(cancelled.edits, []);
});
