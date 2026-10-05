import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || specifier === 'zod') ? runtime.resolve(specifier) : specifier, context); } });
const { Context } = await import('@deepseek-ai/cordis');
const mentor = await import('../index.js');
const { LlmAdapter, createUserMessage } = await import('@deepseek-ai/dsh-llm');
const { KEY, fold, initial, view } = await import('../ledger.js');
const { cooperation, summaryText } = await import('../experience.js');
const { readFile, mkdtemp, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join, basename } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { randomUUID } = await import('node:crypto');
const fixture = fileURLToPath(new URL('./fixtures/contract.txt', import.meta.url));
const stateOf = (ctx, agent) => ctx.sessionProjections.stateOf(agent.session, KEY);

async function* response(name, args) {
  const block = name ? { type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) } : { type: 'text', text: args };
  yield { type: 'block-start', index: 0, blockType: block.type };
  if (name) yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments };
  else yield { type: 'text-delta', index: 0, text: args };
  yield { type: 'block-end', index: 0, block };
  yield { type: 'finish', reason: { kind: name ? 'tool-calls' : 'stop' } };
}

function until(ctx, agent, predicate, action) {
  let off;
  const promise = new Promise((resolve, reject) => {
    off = ctx.on('session/event', (session, event) => {
      if (event.type === 'tool/result' && event.data.message.isError) reject(new Error(JSON.stringify(event.data.message.content)));
      if (event.type === 'turn/end' && event.data.reason?.kind === 'error') reject(new Error(JSON.stringify(event.data)));
      if (session.id === agent.id && predicate(stateOf(ctx, agent))) resolve();
    });
    Promise.resolve().then(action).catch(reject);
  });
  return promise.finally(() => off());
}

class ScriptedAdapter extends LlmAdapter {
  constructor(ctx) { super(); this.ctx = ctx; this.steps = new Map(); this.calls = []; }
  async listModels(provider) { return (provider === 'openai-codex' ? ['gpt-6.1-sol'] : ['deepseek-flash', 'deepseek-chat']).map(id => ({ provider, id, name: 'Scripted test model' })); }
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 1000000 } }; }
  stream(options) {
    this.calls.push({ provider: options.provider, model: options.model, sessionId: options.sessionId });
    const agent = this.ctx.agents.get(options.sessionId), state = stateOf(this.ctx, agent);
    const step = this.steps.get(agent.id) ?? 0; this.steps.set(agent.id, step + 1);
    if (step > 20) throw new Error('Scripted turn exceeded bound: ' + JSON.stringify({ agent: agent.id, state, messages: options.messages.slice(-3) }).slice(0, 12000));
    const names = options.tools.map(tool => tool.name);
    assert.ok(!names.includes('spawn_teammate'));
    if (agent.session.header.origin === 'subagent') {
      assert.ok(names.includes('mentor_report')); assert.ok(!names.includes('mentor_delegate'));
      const task = state.tasks[0]; assert.ok(task, 'assignment admitted before worker model call');
      if (step === 0) return response('read', { file_path: fixture });
      if (task.goal.endsWith('A') && !task.guidance) return response('mentor_report', { task_id: task.taskId, status: 'blocked', summary: 'Need contract decision', evidence: 'Read fixture AC1 and AC2', attempts: 'Inspected fixture; invalid-input behavior remains unspecified for this scenario', question: 'Should invalid input be rejected?' });
      return response('mentor_report', { task_id: task.taskId, status: 'ready-review', summary: 'Read-only audit completed', evidence: 'Read fixture; no source changes', changes: [], checks: ['read contract fixture: AC1/AC2 inspected'], criteria: [{ id: 'AC1', status: 'PASS', evidence: 'Fixture requires rejecting invalid input', scope: 'Contract inspection only; no implementation tested' }, { id: 'AC2', status: 'PASS', evidence: 'No source changes; only fixture read', scope: 'Read-only fixture audit, no production project inspected' }], risks: [] });
    }
    assert.ok(names.includes('mentor_begin')); assert.ok(names.includes('mentor_verify'));
    if (!state.run) return response('mentor_begin', { mode: 'collaborative', task: 'Two independent read-only audit investigations' });
    if (state.tasks.length < 2) return response('mentor_delegate', { goal: `Independent read-only audit ${state.tasks.length ? 'B' : 'A'}`, write_scope: [], acceptance: 'AC1 reject invalid input; AC2 no source edits', criteria: [{ id: 'AC1', description: 'Reject invalid input as specified by the fixture contract' }, { id: 'AC2', description: 'Audit only; no source edits' }] });
    const blocked = state.tasks.find(task => task.status === 'blocked');
    if (blocked) return response('mentor_guide', { task_id: blocked.taskId, diagnosis: 'Hypothesis: the fixture establishes rejection', next_steps: 'Check AC1 in the fixture; do not edit project source', validation: 'AC1 explicitly requires rejecting invalid input', fallback: 'Report conflicting contract text instead of guessing' });
    const ready = state.tasks.find(task => task.status === 'ready-review');
    if (ready) {
      const checks = ready.verifications?.filter(check => !check.isError && check.readyReportId === ready.report.id) ?? [];
      return checks.length ? response('mentor_review', { task_id: ready.taskId, verdict: 'accepted', verification_ids: checks.map(check => check.id), report_reliable: true, assessments: ['AC1', 'AC2'].map(criterion => ({ criterion, passed: true, expected: criterion === 'AC1' ? 'Reject invalid input' : 'No source writes', observed: 'Independent read of fixture contract; both clauses present', interpretation: 'Fixture satisfies the assigned contract inspection, not an implementation proof', scope: 'Native fixture only, no production project inspected', verification_ids: checks.map(check => check.id) })), evidence: 'Independently read contract; AC1/AC2 confirmed; no source changes in this fixture scenario' }) : response('mentor_verify', { task_id: ready.taskId, tool: 'read', arguments: { file_path: fixture }, label: 'Independently inspect AC1/AC2, not worker assertion' });
    }
    return state.tasks.every(task => task.status === 'accepted') ? response(null, 'Native fixture audit finished.') : response('mentor_wait', {});
  }
}


async function kernel(installMentor = true) {
  const ctx = new Context();
  for (const name of ['cordis-plugin-loader', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-agent-preset-registry', 'dsh-subagent', 'dsh-subagent-spawn-in-process']) {
    const mod = await import('@deepseek-ai/' + name);
    await ctx.plugin(mod.default ?? mod, name === 'dsh-agent-preset-registry' ? { default: 'standard' } : {});
  }
  if (installMentor) await ctx.plugin(mentor, {});
  await ctx.agentPresets.register({ id: 'standard', plugins: [] });
  await ctx.agentPresets.register({ id: 'codex-mentor', plugins: [{ id: 'mentor-capability-guard', name: new URL('../capability-guard.js', import.meta.url).href }, { id: 'persona', name: runtime.resolve('@deepseek-ai/dsh-persona'), config: { prefix: 'Codex Mentor' } }] });
  return ctx;
}

test('real Agent creation and preset switching expose mentor tools, not only persona', async () => {
  const ctx = await kernel();
  try {
    const handle = await ctx.agents.create({ sessionId: 'native-mentor', agentOptions: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); } });
    const names = ctx.tools.schemas(handle.agent).map(item => item.name);
    assert.ok(names.includes('mentor_delegate'), JSON.stringify(names));
    assert.ok(names.includes('mentor_status'));
    await ctx.agentPresets.select(handle.agent, 'standard');
    assert.ok(!ctx.tools.get('mentor_delegate', handle.agent));
    await ctx.agentPresets.select(handle.agent, 'codex-mentor');
    assert.ok(ctx.tools.get('mentor_delegate', handle.agent));
    await handle.dispose();
  } finally { await ctx.fiber.dispose(); }
});

test('Agent-local competing tools must not abort mentor registration on GUI selection', async () => {
  const ctx = await kernel();
  try {
    const handle = await ctx.agents.create({ sessionId: 'agent-local-tool-selection', agentOptions: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard'); } });
    handle.agent.ctx.tools.register({ name: 'spawn_teammate', description: 'Agent-local bridge tool.', parameters: { type: 'object' }, output: { schema: { type: 'object' }, render: () => [] }, execute: async () => ({}) });
    await ctx.agentPresets.select(handle.agent, 'codex-mentor');
    assert.ok(ctx.tools.get('mentor_begin', handle.agent), 'own bridge tools are not restrictable globals; they must not cause partial setup rollback');
    const forbidden = await ctx.tools.execute({ callId: randomUUID(), name: 'spawn_teammate', arguments: {}, agent: handle.agent, signal: new AbortController().signal });
    assert.equal(forbidden.isError, true, 'own competing tools stay blocked, not silently allowed');
    await handle.dispose();
  } finally { await ctx.fiber.dispose(); }
});

test('selecting the already-mounted mentor preset preserves its actual tools', async () => {
  const ctx = await kernel();
  try {
    const handle = await ctx.agents.create({ sessionId: 'same-preset-selection', agentOptions: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); } });
    assert.ok(ctx.tools.get('mentor_begin', handle.agent));
    await ctx.agentPresets.select(handle.agent, 'codex-mentor');
    assert.ok(ctx.tools.get('mentor_begin', handle.agent), 'same-preset selection must not delete freshly reinstalled tools');
    await handle.dispose();
  } finally { await ctx.fiber.dispose(); }
});

test('native tool failure renders structured acceptance diagnostics and replay retains the submitted report', async () => {
  const ctx = await kernel();
  try {
    const handle = await ctx.agents.create({ sessionId: 'native-acceptance-diagnostic-fixture', agentOptions: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); } });
    // SDK boundary fixture, not a real worker, independent check, or external inference.
    const record = { version: 1, kind: 'delegated', id: 'fixture-assignment', taskId: 'fixture-task', childId: 'fixture-child', started: true, writeScope: [], criteria: [{ id: 'A', description: 'Bounded source overview' }] };
    handle.agent.inject(createUserMessage({ source: { kind: 'codex-mentor-ledger', record }, content: [] }));
    handle.agent.inject(createUserMessage({ source: { kind: 'codex-mentor-ledger', record: { version: 1, kind: 'report', id: 'fixture-report', childId: 'fixture-child', taskId: 'fixture-task', status: 'ready-review', summary: 'Delivered fixture', evidence: 'SDK fixture only', evidenceGate: { changes: [], checks: [], criteria: [{ id: 'A', status: 'PASS', evidence: 'Synthetic fixture', scope: 'No execution claimed' }], deviations: [], assumptions: [], risks: [] } } }, content: [] }));
    const failure = await ctx.tools.execute({ callId: randomUUID(), name: 'mentor_review', arguments: { task_id: 'fixture-task', verdict: 'accepted', report_reliable: true, evidence: 'Cannot endorse missing assertions', verification_ids: [], assessments: [] }, agent: handle.agent, signal: new AbortController().signal });
    assert.equal(failure.isError, true);
    const diagnostic = JSON.parse(failure.content.find(block => block.type === 'text').text);
    assert.equal(diagnostic.code, 'ASSESSMENT_MISSING'); assert.equal(diagnostic.criterion_id, 'A'); assert.ok(diagnostic.required_action);
    const current = stateOf(ctx, handle.agent).tasks[0];
    assert.equal(current.status, 'acceptance_blocked'); assert.equal(current.report.id, 'fixture-report');
    assert.equal(current.acceptanceBlock.diagnostic.code, 'ASSESSMENT_MISSING');
    const replay = handle.agent.session.snapshotEvents().reduce(fold, initial(handle.agent.session.header));
    assert.deepEqual(replay.tasks, stateOf(ctx, handle.agent).tasks, 'diagnosis is a recoverable journal fact');
    await handle.dispose();
  } finally { await ctx.fiber.dispose(); }
});

test('activating the Host after a mentor session exists repairs its actual tool surface', async () => {
  const ctx = await kernel(false);
  try {
    const handle = await ctx.agents.create({ sessionId: 'existing-mentor', agentOptions: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); } });
    assert.equal(ctx.tools.get('mentor_delegate', handle.agent), undefined);
    ctx.tools.register({ name: 'read', description: 'Readiness fixture.', parameters: { type: 'object' }, output: { schema: { type: 'object' }, render: () => [] }, execute: async () => ({}) });
    const unavailable = await ctx.tools.execute({ callId: randomUUID(), name: 'read', arguments: {}, agent: handle.agent, signal: new AbortController().signal });
    assert.equal(unavailable.isError, true, 'preset guard blocks work even when Host is absent');
    const host = ctx.plugin(mentor, {}); await host;
    assert.ok(ctx.tools.get('mentor_delegate', handle.agent), 'Host activation must initialize already-live mentor Agents');
    await host.dispose(); await host.inertia;
    assert.equal(ctx.tools.get('mentor_delegate', handle.agent), undefined, 'Host-owned tools unload without disposing Agent');
    await ctx.plugin(mentor, {});
    assert.equal(ctx.tools.schemas(handle.agent).filter(tool => tool.name === 'mentor_delegate').length, 1, 'reload repairs once, without duplicate tools');
    await handle.dispose();
  } finally { await ctx.fiber.dispose(); }
});

test('native two-worker audit switches a non-Codex Leader midrun, retaining pinned Flash workers, independent acceptance and replay', { timeout: 10000 }, async t => {
  const ctx = await kernel(), readActors = [], tempRoot = await mkdtemp(join(tmpdir(), 'dsh-mentor-native-'));
  try {
    const persistence = await import('@deepseek-ai/dsh-session-persistence-jsonl');
    await ctx.plugin(persistence.default ?? persistence, { root: tempRoot, compression: 'none' });
    const query = await import('@deepseek-ai/dsh-session-query-sqlite');
    await ctx.plugin(query.default ?? query, { path: ':memory:', openAt: 'never' });
    const stops = [];
    ctx.on('subagent/end', info => stops.push({ id: info.id, stopReason: info.stopReason }));
    const adapter = new ScriptedAdapter(ctx);
    ctx.llm.registerAdapter(['openai-codex', 'deepseek-official'], adapter);
    ctx.tools.register({ name: 'read', description: 'Read the test contract fixture.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'], additionalProperties: false }, output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: async (args, exec) => { assert.equal(args.file_path, fixture); readActors.push(exec.agent.id); return { text: await readFile(fixture, 'utf8') }; } });
    ctx.tools.register({ name: 'spawn_teammate', description: 'Competing delegation fixture.', parameters: { type: 'object' }, output: { schema: { type: 'object' }, render: () => [] }, execute: async () => { throw new Error('Must not be invoked'); } });
    const originalChoice = { provider: 'deepseek-official', model: 'deepseek-chat' }, codexChoice = { provider: 'openai-codex', model: 'gpt-6.1-sol' };
    let currentChoice = originalChoice, switchedAt, switchState;
    const requests = [];
    const handle = await ctx.agents.create({ sessionId: 'native-two-worker-audit', agentOptions: originalChoice, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); } });
    handle.agent.ctx.on('agent/request', async ({ agent, signal }, next) => {
      assert.equal(agent, handle.agent, 'picker listener is root-scoped, never inherited by workers');
      assert.ok(signal instanceof AbortSignal);
      const choice = currentChoice;
      const config = await next();
      assert.ok(Object.isFrozen(config), 'native next() returns the current frozen configuration');
      assert.ok(!('messages' in config), 'request waterfall selects configuration, not message content');
      requests.push({ config, choice });
      return { ...config, ...choice };
    });
    const offPicker = ctx.on('session/event', session => {
      if (session.id !== handle.agent.id || switchedAt) return;
      const state = stateOf(ctx, handle.agent);
      if (!state.tasks.some(task => task.status === 'ready-review')) return;
      switchState = structuredClone(state);
      switchedAt = { calls: adapter.calls.length, requests: requests.length };
      currentChoice = codexChoice; // Simulate changing this session's model picker, not Agent.options.
    });
    assert.equal(ctx.tools.get('spawn_teammate', handle.agent), undefined);
    await until(ctx, handle.agent, state => state.tasks.length === 2 && state.tasks.every(task => task.status === 'accepted'), () => handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Perform two independent read-only investigations of the fixture.' }] })));
    await ctx.subagents.drainContinuableDescendants([handle.agent]);
    await handle.agent.whenIdle();
    offPicker();
    const actual = stateOf(ctx, handle.agent), facts = cooperation(actual);
    assert.ok(switchedAt, 'the first ready report changed the local picker');
    assert.equal(switchState.tasks.length, 2);
    assert.equal(actual.sessionId, switchState.sessionId);
    assert.equal(actual.run.runId, switchState.run.runId);
    assert.equal(actual.run.backend, 'subagent');
    assert.deepEqual(actual.run.route, switchState.run.route);
    const assignment = task => ({ taskId: task.taskId, childId: task.childId, parentId: task.parentId, runId: task.runId, backend: task.backend, goal: task.goal, writeScope: task.writeScope, criteria: task.criteria, route: task.route });
    assert.deepEqual(actual.tasks.map(assignment), switchState.tasks.map(assignment), 'model selection preserves task/child IDs, parent, contract, backend and original worker route');
    for (const task of switchState.tasks.filter(task => task.status === 'ready-review')) assert.deepEqual(actual.tasks.find(item => item.taskId === task.taskId).report, task.report, 'the first submitted report survives Leader switching and acceptance');
    assert.equal(facts.delegated, 2); assert.equal(facts.accepted, 2); assert.equal(facts.guidance, 1);
    assert.equal(facts.independentChecks, 2); assert.equal(facts.outstanding.length, 0);
    for (const task of actual.tasks) {
      assert.deepEqual(task.criteria.map(({ id }) => id), ['AC1', 'AC2']);
      assert.deepEqual(task.report.evidenceGate.criteria.map(({ id, status }) => ({ id, status })), [{ id: 'AC1', status: 'PASS' }, { id: 'AC2', status: 'PASS' }]);
      assert.deepEqual(task.review.assessments.map(({ criterion }) => criterion), ['AC1', 'AC2']);
      assert.equal(task.verifications.length, 1);
      const check = task.verifications[0];
      assert.equal(check.readyReportId, task.report.id);
      assert.equal(check.executionSucceeded, true); assert.equal(check.criterionSatisfied, null, 'reading the fixture is not itself acceptance');
      assert.equal(task.review.reportId, task.report.id); assert.equal(task.review.reportReliable, true);
      assert.deepEqual(task.review.verificationIds, [check.id]);
      for (const assessment of task.review.assessments) {
        assert.equal(assessment.criterionSatisfied, true);
        assert.deepEqual(assessment.verificationIds, [check.id]);
        assert.ok(assessment.observed && assessment.interpretation && assessment.scope);
      }
    }
    assert.equal(readActors.filter(id => id === handle.agent.id).length, 2, 'mentor really ran two independent checks');
    const rootCalls = adapter.calls.filter(call => call.sessionId === handle.agent.id), routeOf = ({ provider, model }) => ({ provider, model });
    const before = adapter.calls.slice(0, switchedAt.calls).filter(call => call.sessionId === handle.agent.id), after = adapter.calls.slice(switchedAt.calls).filter(call => call.sessionId === handle.agent.id);
    assert.ok(before.length && after.length, 'actual root adapter calls exist on both sides of the picker change');
    assert.ok(before.every(call => call.provider === originalChoice.provider && call.model === originalChoice.model));
    assert.ok(after.every(call => call.provider === codexChoice.provider && call.model === codexChoice.model), 'the next admitted root request uses the returned replacement');
    assert.deepEqual(rootCalls.map(routeOf), requests.map(({ choice }) => choice));
    assert.deepEqual(routeOf(requests[0].config), originalChoice, 'default mentor configuration retains the session selection');
    assert.deepEqual(routeOf(requests[switchedAt.requests].config), originalChoice, 'next() still exposes the previously committed route at the switch');
    assert.deepEqual(routeOf(requests[switchedAt.requests + 1].config), codexChoice, 'later next() exposes the replacement committed by the native loop');
    const workerCalls = adapter.calls.filter(call => call.sessionId !== handle.agent.id);
    assert.equal(new Set(workerCalls.map(call => call.sessionId)).size, 2);
    for (const call of workerCalls) {
      const task = actual.tasks.find(item => item.childId === call.sessionId);
      assert.ok(task, 'every adapter worker call belongs to the original assignment');
      assert.deepEqual(routeOf(call), routeOf(task.route));
      assert.deepEqual(routeOf(call), { provider: 'deepseek-official', model: 'deepseek-flash' });
    }
    t.diagnostic('Actual root adapter calls before picker change: ' + JSON.stringify(before));
    t.diagnostic('Actual root adapter calls after picker change: ' + JSON.stringify(after));
    const headers = handle.agent.session.snapshotEvents().filter(event => event.type === 'request/header');
    assert.deepEqual(routeOf(headers[0].data.header.config), originalChoice);
    assert.ok(headers.some(event => event.data.reason === 'change' && event.data.header.config.provider === codexChoice.provider && event.data.header.config.model === codexChoice.model), 'the replacement is durably logged by the native loop');
    assert.deepEqual(routeOf(headers.at(-1).data.header.config), codexChoice);
    const replay = handle.agent.session.snapshotEvents().reduce(fold, initial(handle.agent.session.header));
    assert.deepEqual(view(replay), view(actual));
    const messages = handle.agent.session.snapshotEvents().filter(event => event.type === 'assistant/message').map(event => event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    assert.equal(messages.filter(text => text === 'Native fixture audit finished.').length, 1, 'primary result appears once, not a statistics-only or late-notice answer');
    assert.ok(!messages.some(text => text.includes('模式执行摘要')), 'statistics do not alter the provider final');
    assert.ok(summaryText(actual, { toolsReady: true }).includes('已登记验收检查 2'));
    assert.ok(stops.length >= 3 && stops.every(info => info.stopReason === 'completed'), JSON.stringify(stops));
    assert.equal(adapter.calls.filter(call => call.model === 'deepseek-flash').length, 5, 'report pause and accepted cold resume do not invoke the worker model again');
    await handle.dispose();
    let resumed;
    try { resumed = await ctx.agents.resume({ resumeSessionId: 'native-two-worker-audit', setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); } }); }
    catch (error) { error.message += '\nLifecycle rows: ' + JSON.stringify(handle.agent.session.snapshotEvents().filter(e => ['turn/start', 'turn/end', 'step/start', 'step/end'].includes(e.type)).map(e => ({ seq: e.seq, type: e.type, data: e.data }))); throw error; }
    assert.ok(ctx.tools.get('mentor_delegate', resumed.agent));
    assert.deepEqual(cooperation(stateOf(ctx, resumed.agent)), facts, 'cold JSONL resume preserves genuine task/worker/check facts');
    assert.deepEqual(view(stateOf(ctx, resumed.agent)), view(actual), 'cold resume preserves the same parent, run, assignments, reports, criteria and reviews');
    assert.deepEqual(routeOf(resumed.agent.session.requestHeader().config), codexChoice, 'cold resume retains the selected Leader route without a live picker listener');
    assert.equal(adapter.calls.filter(call => call.model === 'deepseek-flash').length, 5);
    await resumed.dispose();
  } finally {
    await ctx.fiber.dispose();
    const target = resolve(tempRoot);
    assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^dsh-mentor-native-/);
    await rm(target, { recursive: true, force: true });
  }
});
