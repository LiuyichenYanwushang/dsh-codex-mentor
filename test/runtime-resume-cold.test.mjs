import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { dirname, resolve, join, basename } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || specifier === 'zod') ? runtime.resolve(specifier) : specifier, context); } });
const { Context } = await import('@deepseek-ai/cordis');
const { LlmAdapter } = await import('@deepseek-ai/dsh-llm');
const mentor = await import('../index.js');
const { KEY, fold, initial, view } = await import('../ledger.js');
const stateOf = (ctx, agent) => ctx.sessionProjections.stateOf(agent.session, KEY);
async function* reply(name, args) {
  const block = name ? { type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) } : { type: 'text', text: args };
  yield { type: 'block-start', index: 0, blockType: block.type };
  if (name) yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments };
  else yield { type: 'text-delta', index: 0, text: args };
  yield { type: 'block-end', index: 0, block };
  yield { type: 'finish', reason: { kind: name ? 'tool-calls' : 'stop' } };
}
class InterruptedAdapter extends LlmAdapter {
  constructor(ctx) { super(); this.ctx = ctx; this.steps = new Map(); this.calls = []; }
  async listModels(provider) { return [{ provider, id: provider === 'openai-codex' ? 'gpt-6.1-sol' : 'deepseek-flash', name: 'Scripted continuation fixture' }]; }
  async resolveModel(provider, id) { return { provider, id, name: 'Scripted continuation fixture', context: { contextWindow: 1000000 } }; }
  async *stream(options) {
    const agent = this.ctx.agents.get(options.sessionId), state = stateOf(this.ctx, agent);
    this.calls.push({ id: agent.id, provider: options.provider, model: options.model });
    if (!state.parentId) return yield* reply(null, 'Recovery is handled explicitly by the mentor fixture.');
    assert.equal(options.provider, 'deepseek-official'); assert.equal(options.model, 'deepseek-flash');
    const step = this.steps.get(agent.id) ?? 0; this.steps.set(agent.id, step + 1);
    assert.ok(step < 4, 'Bounded continuation fixture');
    if (step === 0) return yield* reply('mentor_memory', { action: 'checkpoint', checkpoint: 'checkpoint-before-simulated-provider-interruption' });
    if (step === 1) throw new Error('Simulated provider interruption; not a diagnosis of the user failure');
    assert.equal(state.checkpoint, 'checkpoint-before-simulated-provider-interruption');
    assert.equal(state.tasks[0].guidance.purpose, 'lifecycle-repair');
    assert.match(state.tasks[0].guidance.nextSteps, /^继续生成/);
    return yield* reply('mentor_report', { task_id: state.tasks[0].taskId, status: 'ready-review', summary: 'Recovered original checkpoint', evidence: 'Scripted fixture only; no external provider inference or implementation accepted', changes: [], checks: [], criteria: ['AC1: PASS; original checkpoint recovered'], risks: [] });
  }
}
function observe(ctx, agent, predicate, action) {
  let off;
  const done = new Promise((resolve, reject) => {
    off = ctx.on('session/event', (session, event) => {
      if (event.type === 'tool/result' && event.data.message.isError) reject(new Error(JSON.stringify(event.data.message.content)));
      if (session.id === agent.id && predicate(stateOf(ctx, agent))) resolve();
    });
    Promise.resolve().then(action).catch(reject);
  });
  return done.finally(() => off());
}
test('mentor_resume cold-restores the same failed Flash child and checkpoint without accepting it', { timeout: 10000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-mentor-resume-cold-')), ctx = new Context();
  try {
    for (const name of ['cordis-plugin-loader', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-agent-preset-registry', 'dsh-subagent', 'dsh-subagent-spawn-in-process']) {
      const mod = await import('@deepseek-ai/' + name);
      await ctx.plugin(mod.default ?? mod, name === 'dsh-agent-preset-registry' ? { default: 'standard' } : {});
    }
    const persistence = await import('@deepseek-ai/dsh-session-persistence-jsonl');
    await ctx.plugin(persistence.default ?? persistence, { root: temp, compression: 'none' });
    const query = await import('@deepseek-ai/dsh-session-query-sqlite');
    await ctx.plugin(query.default ?? query, { path: ':memory:', openAt: 'never' });
    await ctx.plugin(mentor, {});
    await ctx.agentPresets.register({ id: 'standard', plugins: [] });
    await ctx.agentPresets.register({ id: 'codex-mentor', plugins: [{ id: 'guard', name: new URL('../capability-guard.js', import.meta.url).href }, { id: 'persona', name: runtime.resolve('@deepseek-ai/dsh-persona'), config: { prefix: 'Codex Mentor' } }] });
    const adapter = new InterruptedAdapter(ctx);
    ctx.llm.registerAdapter(['openai-codex', 'deepseek-official'], adapter);
    const setup = async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); };
    let handle = await ctx.agents.create({ sessionId: 'cold-continuation-mentor', agentOptions: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, setup });
    const execute = (agent, name, args) => ctx.tools.execute({ agent, callId: randomUUID(), name, arguments: args, signal: new AbortController().signal });
    assert.ok(ctx.tools.get('mentor_resume', handle.agent));
    await observe(ctx, handle.agent, state => state.tasks[0]?.status === 'stopped', async () => {
      const result = await execute(handle.agent, 'mentor_delegate', { goal: 'Recoverable read-only fixture', write_scope: [], acceptance: 'AC1: original checkpoint recovered' });
      assert.equal(result.isError, false, JSON.stringify(result));
    });
    await ctx.subagents.drainContinuableDescendants([handle.agent]); await handle.agent.whenIdle();
    const before = stateOf(ctx, handle.agent).tasks[0];
    assert.equal(before.status, 'stopped'); assert.equal(before.report, undefined);
    const identity = { taskId: before.taskId, childId: before.childId, runId: before.runId, route: before.route };
    await handle.dispose();
    assert.equal(ctx.agents.get(identity.childId), undefined, 'Actual child is absent before native cold continuation');
    handle = await ctx.agents.resume({ resumeSessionId: 'cold-continuation-mentor', setup });
    assert.equal(stateOf(ctx, handle.agent).tasks[0].status, 'stopped');
    let continuation;
    await observe(ctx, handle.agent, state => state.tasks[0]?.status === 'ready-review', async () => {
      continuation = await execute(handle.agent, 'mentor_resume', { task_id: identity.taskId });
      assert.equal(continuation.isError, false, JSON.stringify(continuation));
      assert.equal(continuation.value.outcome, 'requested');
      assert.equal(continuation.value.childSessionId, identity.childId);
    });
    await ctx.subagents.drainContinuableDescendants([handle.agent]); await handle.agent.whenIdle();
    const recovered = stateOf(ctx, handle.agent), task = recovered.tasks[0];
    assert.equal(recovered.tasks.length, 1, 'No replacement task or worker was spawned');
    assert.deepEqual({ taskId: task.taskId, childId: task.childId, runId: task.runId, route: task.route }, identity);
    assert.equal(task.status, 'ready-review'); assert.equal(task.review, undefined);
    assert.equal(task.guidanceKinds['lifecycle-repair'], 1);
    assert.equal(adapter.calls.filter(call => call.id === identity.childId).length, 3);
    assert.deepEqual(view(handle.agent.session.snapshotEvents().reduce(fold, initial(handle.agent.session.header))), view(recovered));
    await handle.dispose();
  } finally {
    await ctx.fiber.dispose();
    const target = resolve(temp); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^dsh-mentor-resume-cold-/);
    await rm(target, { recursive: true, force: true });
  }
});
