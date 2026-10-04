import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || specifier === 'zod') ? runtime.resolve(specifier) : specifier, context); } });
const { Context } = await import('@deepseek-ai/cordis');
const { LlmAdapter, createUserMessage } = await import('@deepseek-ai/dsh-llm');
const mentor = await import('../index.js');
const { KEY, fold, initial, view, encode } = await import('../ledger.js');
const { cooperation } = await import('../experience.js');
const fixture = fileURLToPath(new URL('./fixtures/contract.txt', import.meta.url));
const stateOf = (ctx, agent) => ctx.sessionProjections.stateOf(agent.session, KEY);
const FINAL = 'Native Flash Team fixture accepted independently.';

async function* response(name, args) {
  const block = name ? { type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) } : { type: 'text', text: args };
  yield { type: 'block-start', index: 0, blockType: block.type };
  if (name) yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments };
  else yield { type: 'text-delta', index: 0, text: args };
  yield { type: 'block-end', index: 0, block };
  yield { type: 'finish', reason: { kind: name ? 'tool-calls' : 'stop' } };
}

class TeamAdapter extends LlmAdapter {
  constructor(ctx) {
    super(); this.ctx = ctx; this.calls = []; this.steps = new Map(); this.seenBoard = new Map(); this.read = new Set(); this.rosterRead = false;
    this.staffed = new Promise(resolve => { this.releaseStaffing = resolve; });
  }
  model(provider, id) { return { provider, id, name: 'Scripted native Team fixture', context: { contextWindow: 1000000 }, reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }; }
  async listModels(provider) { return [this.model(provider, provider === 'openai-codex' ? 'gpt-6.1-sol' : 'deepseek-flash')]; }
  async resolveModel(provider, model) { return this.model(provider, model); }
  async *stream(options) {
    const agent = this.ctx.agents.get(options.sessionId), state = stateOf(this.ctx, agent), member = this.ctx.agentTeams.membership(agent);
    const step = this.steps.get(agent.id) ?? 0; this.steps.set(agent.id, step + 1);
    this.calls.push({ sessionId: agent.id, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort });
    assert.ok(step < 45, 'Finite scripted Team loop exceeded bound: ' + JSON.stringify({ id: agent.id, step, state }).slice(0, 8000));
    const names = options.tools.map(tool => tool.name);
    for (const name of ['team_task_get', 'team_task_update', 'list_agents', 'send_message']) assert.ok(names.includes(name), name + ' must be actual native Team tool');
    if (member.role === 'teammate') {
      assert.equal(options.provider, 'deepseek-official'); assert.equal(options.model, 'deepseek-flash');
      assert.ok(names.includes('mentor_report')); assert.ok(!names.includes('mentor_delegate'));
      await this.staffed; // Hold all three workers until real native staffing exceeds the configured subagent limit.
      const task = state.tasks[0]; assert.ok(task?.teamTaskId, 'Assignment admitted with linked native task before inference');
      const native = this.ctx.agentTeams.getTask(agent, task.teamTaskId);
      if (native.status === 'pending') {
        if (this.seenBoard.get(agent.id) !== native.revision) {
          this.seenBoard.set(agent.id, native.revision);
          yield* response('team_task_get', { task_id: native.id }); return;
        }
        yield* response('team_task_update', { task_id: native.id, expected_revision: native.revision, action: 'claim' }); return;
      }
      assert.equal(native.ownerName, task.teamName); assert.equal(native.status, 'in_progress');
      if (!this.read.has(agent.id)) { this.read.add(agent.id); yield* response('read', { file_path: fixture }); return; }
      if (task.teamName === 'flash-a' && !task.guidance) {
        yield* response('mentor_report', { task_id: task.taskId, status: 'blocked', summary: 'Need contract interpretation', evidence: 'AC1 was read from the fixture', attempts: 'Inspected fixture; have not guessed the required behavior', question: 'Does AC1 require rejecting invalid input?' }); return;
      }
      yield* response('mentor_report', { task_id: task.taskId, status: 'ready-review', summary: task.guidance ? 'Contract inspection corrected after guidance' : 'Contract inspected; awaiting independent review', evidence: 'Read the contract fixture; no source edits', changes: [], checks: ['Read contract fixture AC1 and AC2'], criteria: [{ id: 'AC1', status: 'PASS', evidence: 'Fixture contract requires rejecting invalid parser input', scope: 'Contract inspection only; no implementation tested' }, { id: 'AC2', status: 'PASS', evidence: 'Audit only, no source edits', scope: 'Owned fixture reads and native task controls only' }], risks: [] }); return;
    }
    assert.equal(options.provider, 'openai-codex'); assert.equal(options.model, 'gpt-6.1-sol');
    if (!state.run) { yield* response('mentor_begin', { mode: 'collaborative', task_kind: 'overview', task: 'Native Agent Teams overview fixture, three disjoint investigations' }); return; }
    assert.equal(state.run.backend, 'team');
    if (state.tasks.length < 3) {
      const index = state.tasks.length;
      yield* response('mentor_delegate', { name: ['flash-a', 'flash-b', 'flash-c'][index], reasoning_effort: ['high', 'low', 'default'][index], goal: 'Independent read-only contract inspection ' + index, write_scope: [], acceptance: 'AC1 contract rejects invalid input; AC2 audit performs no writes', criteria: [{ id: 'AC1', description: 'Contract specifies invalid parser input rejection' }, { id: 'AC2', description: 'Audit performs no source writes' }] }); return;
    }
    this.releaseStaffing();
    if (!this.rosterRead) { this.rosterRead = true; yield* response('list_agents', {}); return; }
    const blocked = state.tasks.find(task => task.status === 'blocked');
    if (blocked) { yield* response('mentor_guide', { task_id: blocked.taskId, purpose: 'task-guidance', diagnosis: 'Hypothesis: AC1 states the invalid-input contract', next_steps: 'Use the fixture AC1 text; do not implement or edit source', validation: 'AC1 explicitly says reject invalid parser input', fallback: 'Report any contradictory source instead of guessing' }); return; }
    const correction = state.tasks.find(task => task.teamName === 'flash-b' && task.status === 'ready-review' && !task.guidance);
    if (correction) { assert.equal(this.ctx.agentTeams.getTask(agent, correction.teamTaskId).status, 'completed'); yield* response('mentor_guide', { task_id: correction.taskId, purpose: 'report-correction', diagnosis: 'State inspection scope more explicitly', next_steps: 'Reclaim the reopened native task and submit a corrected report', validation: 'Report distinguishes contract inspection from implementation testing', fallback: 'Report blocked if the native task cannot be claimed' }); return; }
    const stopped = state.tasks.find(task => task.status === 'stopped');
    if (stopped) {
      const rows = this.trace?.filter(row => row.sessionId === stopped.childId && ['user/message', 'agent/inbox/spliced', 'turn/start', 'turn/end', 'tool/call'].includes(row.event.type)).map(row => { const data = row.event.data; return { seq: row.event.seq, type: row.event.type, source: data.source && { kind: data.source.kind, senderId: data.source.senderId, recordKind: data.source.record?.kind, status: data.source.record?.status }, inserted: data.inserted?.map(message => ({ kind: message.source?.kind, recordKind: message.source?.record?.kind, text: message.content.filter(block => block.type === 'text').map(block => block.text).join('').slice(0, 1000) })), name: data.name, arguments: data.arguments, reason: data.reason }; });
      throw new Error('Reported worker became stopped after guidance: ' + JSON.stringify({ task: stopped.teamName, calls: this.calls.filter(call => call.sessionId === stopped.childId), rows }).slice(-16000));
    }
    const ready = state.tasks.find(task => task.status === 'ready-review');
    if (ready) {
      assert.equal(this.ctx.agentTeams.getTask(agent, ready.teamTaskId).status, 'completed', 'Native submitted state must precede Mentor acceptance');
      const checks = ready.verifications?.filter(check => !check.isError && check.readyReportId === ready.report.id) ?? [];
      if (!checks.length) { yield* response('mentor_verify', { task_id: ready.taskId, tool: 'read', arguments: { file_path: fixture }, kind: 'static-read', label: 'Independent AC1/AC2 inspection' }); return; }
      const verification_ids = checks.map(check => check.id);
      yield* response('mentor_review', { task_id: ready.taskId, verdict: 'accepted', report_reliable: true, verification_ids, assessments: ['AC1', 'AC2'].map(criterion => ({ criterion, passed: true, expected: criterion === 'AC1' ? 'Contract specifies invalid input rejection' : 'Inspection is read-only', observed: criterion === 'AC1' ? 'Independent read found reject invalid parser input' : 'Fixture says audit only; trace contains only reads/task controls/reports', interpretation: 'Accept the bounded contract inspection, not an implementation test result', scope: 'Owned test fixture only; no production project or credentials', verification_ids })), evidence: 'Mentor independently read the fixture and interpreted both criteria' }); return;
    }
    yield* (state.tasks.every(task => task.status === 'accepted') ? response(null, FINAL) : response('mentor_wait', {}));
  }
}

async function kernel(tempRoot) {
  const ctx = new Context();
  for (const name of ['cordis-plugin-loader', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-agent-preset-registry', 'dsh-subagent', 'dsh-subagent-spawn-in-process']) {
    const mod = await import('@deepseek-ai/' + name);
    await ctx.plugin(mod.default ?? mod, name === 'dsh-agent-preset-registry' ? { default: 'standard' } : {});
  }
  for (const [name, config] of [['dsh-session-persistence-jsonl', { root: tempRoot, compression: 'none' }], ['dsh-session-query-sqlite', { path: ':memory:', openAt: 'never' }], ['dsh-experimental-agent-team', {}], ['dsh-experimental-tool-agent-team', {}]]) {
    const mod = await import('@deepseek-ai/' + name); await ctx.plugin(mod.default ?? mod, config);
  }
  await ctx.plugin(mentor, { maxConcurrentWorkers: 1 });
  await ctx.agentPresets.register({ id: 'standard', plugins: [] });
  await ctx.agentPresets.register({ id: 'codex-mentor', plugins: [{ id: 'mentor-capability-guard', name: new URL('../capability-guard.js', import.meta.url).href }, { id: 'persona', name: runtime.resolve('@deepseek-ai/dsh-persona'), config: { prefix: 'Codex Mentor native Team fixture' } }] });
  return ctx;
}

function untilAccepted(ctx, agent, action) {
  let off, timer;
  return new Promise((resolvePromise, reject) => {
    timer = setTimeout(() => reject(new Error('Native Team fixture timed out: ' + JSON.stringify(stateOf(ctx, agent)).slice(0, 12000))), 12000);
    off = ctx.on('session/event', (session, event) => {
      if (event.type === 'tool/result' && event.data.message.isError) reject(new Error('Native tool failed in ' + session.id + ': ' + JSON.stringify(event.data.message.content)));
      if (event.type === 'turn/end' && ['error', 'blocked'].includes(event.data.reason?.kind)) reject(new Error('Native turn failed in ' + session.id + ': ' + JSON.stringify(event.data)));
      const state = stateOf(ctx, agent);
      if (session.id === agent.id && state?.tasks.length === 3 && state.tasks.every(task => task.status === 'accepted')) resolvePromise();
    });
    Promise.resolve().then(action).catch(reject);
  }).finally(() => { clearTimeout(timer); off?.(); });
}

test('native Agent Teams pins Flash/effort, claims tasks, tutors/corrects reports, accepts independently and cold-replays stable identities', { timeout: 20000 }, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-mentor-team-native-'));
  let ctx;
  try {
    ctx = await kernel(tempRoot);
    assert.equal(ctx.agentTeams.supportsAgentOptions, true, 'Runtime extension is mandatory; no fake Team or subagent fallback');
    const adapter = new TeamAdapter(ctx), readActors = [], trace = [];
    adapter.trace = trace;
    ctx.llm.registerAdapter(['openai-codex', 'deepseek-official'], adapter);
    ctx.tools.register({ name: 'read', description: 'Read owned contract fixture.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'], additionalProperties: false }, output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: async (args, exec) => { assert.equal(args.file_path, fixture); readActors.push(exec.agent.id); return { text: await readFile(fixture, 'utf8') }; } });
    const off = ctx.on('session/event', (session, event) => trace.push({ sessionId: session.id, event }));
    const handle = await ctx.agents.create({ sessionId: 'native-flash-team-mentor', agentOptions: { provider: 'openai-codex', model: 'gpt-6.1-sol' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); } });
    await untilAccepted(ctx, handle.agent, () => handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use native Agent Teams for three read-only fixture investigations.' }] })));
    await ctx.subagents.drainContinuableDescendants([handle.agent]); await handle.agent.whenIdle();
    const actual = stateOf(ctx, handle.agent), facts = cooperation(actual), tasks = actual.tasks;
    assert.equal(actual.run.taskKind, 'overview'); assert.equal(actual.run.backend, 'team');
    assert.equal(facts.delegated, 3); assert.equal(facts.accepted, 3); assert.equal(facts.guidance, 2);
    assert.equal(facts.guidanceByPurpose['task-guidance'], 1); assert.equal(facts.guidanceByPurpose['report-correction'], 1);
    assert.equal(facts.independentChecks, 3); assert.equal(readActors.filter(id => id === handle.agent.id).length, 3);
    const roster = ctx.agentTeams.listMembers(handle.agent).filter(row => row.role === 'teammate');
    assert.equal(roster.length, 3, 'Team staffing is not fixed to maxConcurrentWorkers=1 or overview one-worker subagent budget');
    const identity = tasks.map(task => ({ taskId: task.taskId, childId: task.childId, teamTaskId: task.teamTaskId, teamName: task.teamName, route: task.route, reasoningDecision: task.reasoningDecision }));
    for (const task of tasks) {
      const row = roster.find(row => row.name === task.teamName); assert.equal(row.id, task.childId); // Model labels are checked after cold replay so metadata failures do not hide recovery evidence.
      const native = ctx.agentTeams.getTask(handle.agent, task.teamTaskId); assert.equal(native.status, 'completed'); assert.equal(native.ownerName, task.teamName);
      const calls = adapter.calls.filter(call => call.sessionId === task.childId); assert.ok(calls.length > 0);
      assert.ok(calls.every(call => call.model === 'deepseek-flash' && call.provider === 'deepseek-official' && call.reasoningEffort === (task.teamName === 'flash-a' ? 'high' : 'low')));
      assert.equal(task.route.reasoningEffort, task.teamName === 'flash-a' ? 'high' : 'low');
      assert.deepEqual(task.criteria.map(({ id }) => id), ['AC1', 'AC2']);
      assert.deepEqual(task.report.evidenceGate.criteria.map(({ id, status }) => ({ id, status })), [{ id: 'AC1', status: 'PASS' }, { id: 'AC2', status: 'PASS' }]);
      assert.deepEqual(task.review.assessments.map(({ criterion }) => criterion), ['AC1', 'AC2']);
      assert.equal(task.review.reportReliable, true); assert.equal(task.review.assessments.length, 2); assert.ok(task.review.assessments.every(item => item.criterionSatisfied));
      assert.ok(trace.some(({ sessionId, event }) => sessionId === task.childId && event.type === 'tool/call' && event.data.name === 'team_task_update' && JSON.parse(event.data.arguments).action === 'claim'));
      assert.ok(trace.some(({ sessionId, event }) => sessionId === task.childId && event.type === 'tool/result' && event.data.meta?.codexMentor?.kind === 'report'));
    }
    assert.ok(trace.some(({ sessionId, event }) => sessionId === handle.agent.id && event.type === 'user/message' && event.data.source?.kind === 'team-message' && event.data.source.senderId === tasks[0].childId), 'Formal reports are delivered with native authenticated sender identity');
    assert.ok(!trace.some(({ event }) => event.type === 'tool/call' && event.data.name === 'spawn_teammate'), 'No raw spawn bypass or GPT teammate creation');
    const spoof = { ...tasks[0].report, id: randomUUID(), summary: 'Unauthenticated sibling report' };
    const spoofed = fold(actual, { type: 'user/message', seq: handle.agent.session.snapshotEvents().at(-1).seq + 1, data: { source: { kind: 'team-message', teamId: handle.agent.id, senderId: tasks[1].childId, senderName: tasks[1].teamName }, content: [{ type: 'text', text: encode(spoof) }] } });
    assert.deepEqual(view(spoofed), view(actual), 'A real sibling identity cannot submit another member\'s formal report');
    const denied = await ctx.tools.execute({ callId: randomUUID(), name: 'spawn_teammate', arguments: { name: 'forbidden-member', description: 'Must never spawn', prompt: 'Do not run', context: 'fresh' }, agent: handle.agent, signal: new AbortController().signal });
    assert.equal(denied.isError, true, 'Raw native teammate spawn stays denied by Mentor guard');
    assert.equal(ctx.agentTeams.listMembers(handle.agent).length, 4, 'Raw spawn denial creates no extra roster entry');
    assert.deepEqual(view(handle.agent.session.snapshotEvents().reduce(fold, initial(handle.agent.session.header))), view(actual));
    const finals = handle.agent.session.snapshotEvents().filter(event => event.type === 'assistant/message').map(event => event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    assert.equal(finals.filter(text => text === FINAL).length, 1);
    assert.equal(adapter.calls.filter(call => call.model === 'deepseek-flash').length, 16, 'Three native get/claim/read/report sequences plus blocked guidance and reopened report correction; no extra inference on submission or acceptance');
    const callsBefore = adapter.calls.length;
    await handle.dispose();
    const resumed = await ctx.agents.resume({ resumeSessionId: 'native-flash-team-mentor', setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'codex-mentor'); } });
    assert.deepEqual(stateOf(ctx, resumed.agent).tasks.map(task => ({ taskId: task.taskId, childId: task.childId, teamTaskId: task.teamTaskId, teamName: task.teamName, route: task.route, reasoningDecision: task.reasoningDecision })), identity);
    assert.deepEqual(cooperation(stateOf(ctx, resumed.agent)), facts);
    const coldRoster = ctx.agentTeams.listMembers(resumed.agent).filter(row => row.role === 'teammate');
    assert.deepEqual(coldRoster.map(row => ({ id: row.id, name: row.name })), roster.map(row => ({ id: row.id, name: row.name })));
    assert.equal(adapter.calls.length, callsBefore, 'Accepted cold recovery causes no additional model inference');
    await resumed.dispose(); off();
    assert.deepEqual(roster.map(row => row.model), ['deepseek-flash', 'deepseek-flash', 'deepseek-flash'], JSON.stringify({ liveRoster: roster, coldRoster, actualRequests: adapter.calls.filter(call => call.model === 'deepseek-flash') }));
    assert.deepEqual(coldRoster.map(row => row.model), ['deepseek-flash', 'deepseek-flash', 'deepseek-flash'], 'Native cold roster must preserve actual Flash model labels');
  } finally {
    await ctx?.fiber.dispose();
    const target = resolve(tempRoot); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^dsh-mentor-team-native-/);
    await rm(target, { recursive: true, force: true });
  }
});
