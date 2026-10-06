import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || specifier === 'zod') ? runtime.resolve(specifier) : specifier, context); } });
const { Context } = await import('@deepseek-ai/cordis');
const { LlmAdapter } = await import('@deepseek-ai/dsh-llm');
const mentor = await import('../index.js');
const { KEY, PRESET, currentAssignment } = await import('../ledger.js');
const { COLLAB_PREFIX } = await import('../collaboration.js');
const state = (ctx, agent) => ctx.sessionProjections.stateOf(agent.session, KEY);
async function* output(name, args) {
  const block = name ? { type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) } : { type: 'text', text: args };
  yield { type: 'block-start', index: 0, blockType: block.type };
  yield name ? { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: args };
  yield { type: 'block-end', index: 0, block };
  yield { type: 'finish', reason: { kind: name ? 'tool-calls' : 'stop' } };
}
function waitFor(ctx, predicate, timeout = 12000) {
  const origin = new Error().stack;
  if (predicate()) return Promise.resolve();
  return new Promise((done, reject) => {
    let offEvent, offDispose, offDomain;
    const check = () => { if (predicate()) { clearTimeout(timer); offEvent?.(); offDispose?.(); offDomain?.(); done(); } };
    const timer = setTimeout(() => { offEvent?.(); offDispose?.(); offDomain?.(); reject(new Error('Native collaboration predicate timed out: ' + origin + '\n' + JSON.stringify(ctx.agents.list().map(agent => ({ id: agent.id, status: agent.status, tasks: state(ctx, agent).tasks.map(task => ({ taskId: task.taskId, status: task.status, childId: task.childId })), last: agent.session.header }))).slice(0, 12000))); }, timeout);
    offEvent = ctx.on('session/event', check); offDispose = ctx.on('agent/disposed', check); offDomain = ctx.on('domain/changed', check); check();
  });
}
class Fixture extends LlmAdapter {
  constructor(ctx) { super(); this.ctx = ctx; this.calls = []; this.costs = new Map(); this.claimSeen = new Set(); this.peerSeen = new Set(); }
  async listModels(provider) { return [{ provider, id: 'deepseek-flash', name: 'Local collaboration fixture', context: { contextWindow: 1000000 } }]; }
  async resolveModel(provider, id) { return (await this.listModels(provider))[0]; }
  async *stream(options) {
    const agent = this.ctx.agents.get(options.sessionId), own = state(this.ctx, agent);
    this.calls.push({ sessionId: agent.id, provider: options.provider, model: options.model });
    const role = own.parentId ? 'worker' : 'leader';
    if (!this.costs.has(role)) {
      const added = new Set(['mentor_knowledge', 'mentor_members', 'mentor_message', 'mentor_discussion']);
      const beforeTools = structuredClone(options.tools.filter(tool => !added.has(tool.name)));
      const delegate = beforeTools.find(tool => tool.name === 'mentor_delegate');
      if (delegate) { delete delegate.parameters.properties.member_id; delete delegate.parameters.properties.reuse; }
      const config = { provider: options.provider, model: options.model };
      const before = this.ctx.tokenMeter.measure(agent.session, { config, tools: beforeTools }).totalTokens;
      const after = this.ctx.tokenMeter.measure(agent.session, { config, tools: options.tools }).totalTokens;
      this.costs.set(role, { before, after, added: after - before, kind: 'native heuristic; baseline removes four new tools and two delegation fields on the same surface' });
      if (role === 'leader') {
        const { MENTOR } = await import('../prompts.js');
        const rule = MENTOR.split('\n').find(line => line.startsWith('Review like a rigorous Linux maintainer'));
        const price = messages => messages.reduce((sum, message) => sum + this.ctx.tokenMeter.estimateMessage(message), 0);
        const baseline = options.messages.map(message => ({ ...message, content: Array.isArray(message.content) ? message.content.map(block => block.type === 'text' ? { ...block, text: block.text.replace(rule, '') } : block) : message.content }));
        const current = price(options.messages), previous = price(baseline);
        assert.ok(current > previous && current - previous < 512, 'Bounded critical-review instruction is actually model-visible');
        console.log('MAINTAINER_FIRST_TURN_PROMPT_COST', JSON.stringify({ before: previous, after: current, added: current - previous, kind: 'native fixed heuristic on the actual first Leader request; only new review paragraph removed for baseline' }));
      }
    }
    assert.ok(this.calls.length < 150, 'No infinite fixture messaging loop');
    if (!own.parentId) {
      assert.match(JSON.stringify(options.messages), /Strict with code, kind to people/);
      assert.match(JSON.stringify(options.messages), /Question your own advice too/);
      yield* output(null, 'Fixture parent observed native event.'); return;
    }
    const task = currentAssignment(own);
    assert.equal(options.provider, task.memberRoute.provider); assert.equal(options.model, task.memberRoute.model);
    if (task.status === 'implementing') {
      const board = this.ctx.agentTeams.getTask(agent, task.teamTaskId);
      if (board.status === 'pending') {
        if (!this.claimSeen.has(task.taskId)) { this.claimSeen.add(task.taskId); yield* output('team_task_get', { task_id: board.id }); return; }
        yield* output('team_task_update', { task_id: board.id, expected_revision: board.revision, action: 'claim' }); return;
      }
      yield* output('mentor_report', { task_id: task.taskId, status: 'ready-review', summary: 'Bounded fixture observation', evidence: 'Scripted SDK fixture; no production files or inference', changes: [], checks: ['Fixture contract'], criteria: [{ id: 'AC1', status: 'PASS', evidence: 'Fixture contract', scope: 'Owned test only' }], risks: [] }); return;
    }
    const roomTable = this.ctx.storageDomain.get('codex_mentor_discussions').table('rooms');
    for (const [, room] of roomTable.entries()) {
      if (room.status === 'open' && room.participants.includes(task.teamName) && !room.posts.some(post => post.author === task.teamName && post.round === room.round)) {
        yield* output('mentor_discussion', { action: 'post', id: room.id, round: room.round, expected_revision: room.revision, text: task.teamName + ': independent observation round ' + room.round }); return;
      }
    }
    const blocks = options.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(block => block.type === 'text');
    const peer = blocks.toReversed().find(block => !this.peerSeen.has(agent.id + block.text) && block.text.includes(COLLAB_PREFIX) && !block.text.includes('"kind":"discussion"'));
    if (peer) {
      this.peerSeen.add(agent.id + peer.text);
      const payload = JSON.parse(peer.text.slice(peer.text.indexOf(COLLAB_PREFIX) + COLLAB_PREFIX.length).split('\n')[0]);
      if (payload.kind === 'question' && task.teamName === 'analyst') { yield* output('mentor_message', { target: 'reviewer', kind: 'question', text: 'Check this attributed observation', thread_id: payload.threadId }); return; }
      if (payload.kind === 'question' && task.teamName === 'reviewer') { yield* output('mentor_message', { target: 'analyst', kind: 'reply', text: 'Independent concern retained', thread_id: payload.threadId }); return; }
    }
    yield* output(null, 'No task reopening or acknowledgement loop.');
  }
}
async function kernel(root, nativeTeams = true) {
  const ctx = new Context();
  for (const name of ['cordis-plugin-loader', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-agent-preset-registry', 'dsh-subagent', 'dsh-subagent-spawn-in-process', 'dsh-typert-registry', 'dsh-api-gateway', 'dsh-storage']) {
    const mod = await import('@deepseek-ai/' + name); await ctx.plugin(mod.default ?? mod, name === 'dsh-agent-preset-registry' ? { default: 'standard' } : {});
  }
  for (const [name, config] of [['dsh-storage-json', { root: join(root, 'storage') }], ['dsh-storage-domain', { backend: 'json' }], ['dsh-session-persistence-jsonl', { root: join(root, 'sessions'), compression: 'none' }], ['dsh-session-query-sqlite', { path: ':memory:', openAt: 'never' }], ['dsh-experimental-agent-team', {}], ['dsh-experimental-tool-agent-team', {}]]) {
    if (!nativeTeams && name.includes('agent-team')) continue;
    const mod = await import('@deepseek-ai/' + name); await ctx.plugin(mod.default ?? mod, config);
  }
  await ctx.plugin(mentor, {});
  await ctx.agentPresets.register({ id: 'standard', plugins: [] });
  await ctx.agentPresets.register({ id: PRESET, plugins: [{ id: 'persona', name: runtime.resolve('@deepseek-ai/dsh-persona'), config: { prefix: 'Local deterministic Mentor collaboration fixture' } }] });
  const adapter = new Fixture(ctx); ctx.llm.registerAdapter(['deepseek-official'], adapter);
  ctx.tools.register({ name: 'read', description: 'Read owned test contract', parameters: { type: 'object', properties: {}, additionalProperties: false }, output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: async () => ({ text: 'Fixture contract independently inspected' }) });
  const create = (id, cwd) => ctx.agents.create({ sessionId: id, meta: { cwd, agentPreset: PRESET }, agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash' }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, PRESET); } });
  return { ctx, adapter, create };
}
async function call(ctx, agent, name, args) {
  const result = await agent.ctx.tools.execute({ callId: randomUUID(), name, arguments: args, agent, signal: new AbortController().signal });
  assert.equal(result.isError, false, name + ': ' + JSON.stringify(result)); return result.value;
}
async function accept(ctx, root, task) {
  await waitFor(ctx, () => state(ctx, root).tasks.find(item => item.taskId === task.taskId)?.status === 'ready-review');
  const check = await call(ctx, root, 'mentor_verify', { task_id: task.taskId, tool: 'read', arguments: {}, label: 'Independent owned fixture check' });
  await call(ctx, root, 'mentor_review', { task_id: task.taskId, verdict: 'accepted', report_reliable: true, verification_ids: [check.checkId], assessments: [{ criterion: 'AC1', passed: true, expected: 'Bounded fixture observation', observed: 'Independent fixture contract', interpretation: 'Scoped observation matches', scope: 'Owned deterministic fixture only', verification_ids: [check.checkId] }], evidence: 'Independent fixture accepted, not production correctness' });
  await waitFor(ctx, () => !ctx.agents.get(task.childId));
}

test('native tools/Remote, durable member reuse, scoped memory, direct peer messages and bounded seminar interoperate', { timeout: 30000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'mentor-collaboration-native-')); let ctx;
  try {
    const project = join(temp, 'project'), foreign = join(temp, 'foreign'); await mkdir(project); await mkdir(foreign);
    const h = await kernel(temp); ctx = h.ctx;
    const handle = await h.create('collaboration-root', project), root = handle.agent;
    const begin = await call(ctx, root, 'mentor_begin', { mode: 'collaborative', task_kind: 'audit', task: 'Owned fixture collaboration' }); assert.equal(begin.collaboration.memory, true);
    const shared = await call(ctx, root, 'mentor_knowledge', { action: 'note', conclusion: 'x'.repeat(1200), evidence: 'Local fixture source', conditions: 'Only this fixture' });
    const long = await ctx.typertGateway.invoke({ namespace: 'mentorCollaboration', method: 'snapshot', args: { sessionId: root.id, query: {} } });
    assert.equal(long.memories[0].conclusion.length, 1200, 'UI edit snapshot preserves full text, not preview');
    const user = await ctx.typertGateway.invoke({ namespace: 'mentorCollaboration', method: 'memory', args: { sessionId: root.id, request: { action: 'note', scope: 'member', memberId: 'leader', conclusion: 'Leader-private note', evidence: 'Fixture' } } });
    assert.equal(user.memory.author.role, 'user');
    const first = await call(ctx, root, 'mentor_delegate', { member_id: 'analyst', name: 'analyst', reasoning_effort: 'default', goal: 'First fixture observation', write_scope: [], acceptance: 'Bounded observation' });
    await accept(ctx, root, first.record);
    const second = await call(ctx, root, 'mentor_delegate', { member_id: 'analyst', reuse: 'require', reasoning_effort: 'default', goal: 'Second immutable fixture task', write_scope: [], acceptance: 'Bounded second observation' });
    assert.equal(second.reused, true); assert.equal(second.record.childId, first.record.childId); assert.notEqual(second.record.taskId, first.record.taskId);
    await accept(ctx, root, second.record);
    assert.equal(state(ctx, root).tasks[0].status, 'accepted');
    const workerLog = await ctx.sessionQuery.readSession(first.record.childId);
    assert.equal(workerLog.events.filter(event => event.type === 'user/message' || event.type === 'agent/inbox/spliced').some(event => JSON.stringify(event.data).includes('Leader-private note')), false, 'Delegation must not expose Leader member-private notes');
    const other = await call(ctx, root, 'mentor_delegate', { member_id: 'reviewer', name: 'reviewer', reasoning_effort: 'default', goal: 'Independent reviewer fixture', write_scope: [], acceptance: 'Bounded reviewer observation' });
    await accept(ctx, root, other.record);
    const sent = await call(ctx, root, 'mentor_message', { target: 'analyst', kind: 'question', text: 'Ask reviewer without reopening work', thread_id: 'fixture-peer' }); assert.ok(sent.messageId);
    try { await waitFor(ctx, () => (state(ctx, root).peerThreads['fixture-peer'] ?? 0) >= 3); }
    catch (error) {
      const debug = await ctx.sessionQuery.readSession(first.record.childId);
      console.error('PEER_DEBUG', JSON.stringify({ sent, threads: state(ctx, root).peerThreads, calls: h.adapter.calls, tail: debug.events.slice(-14) }));
      throw error;
    }
    await waitFor(ctx, () => !ctx.agents.get(first.record.childId) && !ctx.agents.get(other.record.childId));
    assert.ok(state(ctx, root).tasks.every(task => task.status === 'accepted'));
    const created = await ctx.typertGateway.invoke({ namespace: 'mentorCollaboration', method: 'discussion', args: { sessionId: root.id, request: { action: 'create', topic: 'Independent fixture seminar', participants: ['analyst', 'reviewer'], maxRounds: 2 } } });
    const roomId = created.room.id, table = ctx.storageDomain.get('codex_mentor_discussions').table('rooms');
    await waitFor(ctx, () => table.get(roomId).posts.length === 2);
    await waitFor(ctx, () => !ctx.agents.get(first.record.childId) && !ctx.agents.get(other.record.childId));
    await root.whenIdle();
    let room = table.get(roomId);
    await call(ctx, root, 'mentor_discussion', { action: 'advance', id: roomId, expected_revision: room.revision });
    await waitFor(ctx, () => table.get(roomId).posts.length === 4);
    await waitFor(ctx, () => !ctx.agents.get(first.record.childId) && !ctx.agents.get(other.record.childId));
    await root.whenIdle();
    room = table.get(roomId);
    const closed = await ctx.typertGateway.invoke({ namespace: 'mentorCollaboration', method: 'discussion', args: { sessionId: root.id, request: { action: 'close', id: roomId, expected_revision: room.revision, conclusion: 'Provisional fixture conclusion', dissent: ['Needs independent production evidence'] } } });
    assert.equal(closed.room.status, 'closed'); assert.equal(closed.room.dissent.length, 1); assert.ok(closed.room.notifications.some(item => item.messageId));
    assert.ok(state(ctx, root).tasks.every(task => task.status === 'accepted'));
    assert.equal((await ctx.mentorCollaboration.snapshot(root.id, {}, new AbortController().signal)).discussions[0].canPost, false, 'Leader not among participants cannot post from GUI');
    const reserved = await root.ctx.tools.execute({ callId: randomUUID(), name: 'mentor_message', arguments: { target: 'analyst', kind: 'finding', text: 'No model loop', thread_id: '__proto__' }, agent: root, signal: new AbortController().signal }); assert.equal(reserved.isError, true);
    for (let i = 0; i < 8; i++) await call(ctx, root, 'mentor_message', { target: 'analyst', kind: 'finding', text: 'Bounded topic note ' + i, thread_id: 'toString' });
    assert.equal(state(ctx, root).peerThreads.toString, 8);
    const exhausted = await root.ctx.tools.execute({ callId: randomUUID(), name: 'mentor_message', arguments: { target: 'analyst', kind: 'finding', text: 'Ninth rejected', thread_id: 'toString' }, agent: root, signal: new AbortController().signal }); assert.equal(exhausted.isError, true);
    const fresh = await h.create('new-leader-root', project), wrong = await h.create('foreign-root', foreign);
    const sameProject = await ctx.mentorCollaboration.snapshot(fresh.agent.id, {}, new AbortController().signal);
    assert.equal(sameProject.project.id, long.project.id); assert.ok(sameProject.memories.some(note => note.id === shared.memory.id));
    assert.ok(sameProject.members.some(member => member.id === 'analyst' && member.current === null));
    assert.equal((await ctx.mentorCollaboration.snapshot(wrong.agent.id, {}, new AbortController().signal)).memories.length, 0);
    await assert.rejects(ctx.mentorCollaboration.discussion(fresh.agent.id, { action: 'advance', id: roomId, expected_revision: closed.room.revision }, new AbortController().signal), /root|closed/i);
    const legacy = state(ctx, root).tasks.map(task => ({ id: task.taskId, child: task.childId, status: task.status }));
    await ctx.subagents.drainContinuableDescendants([root]); await root.whenIdle();
    assert.deepEqual(state(ctx, root).tasks.map(task => ({ id: task.taskId, child: task.childId, status: task.status })), legacy);
    await handle.dispose();
    const cold = await ctx.mentorCollaboration.snapshot(root.id, {}, new AbortController().signal); assert.equal(cold.memories.find(note => note.id === shared.memory.id).conclusion.length, 1200);
    console.log('FIRST_TURN_TOOL_COST', JSON.stringify(Object.fromEntries(h.adapter.costs)));
    assert.equal(cold.permissions.canDiscuss, false); assert.equal(ctx.agents.get(root.id), undefined, 'Readonly GUI must not cold-resume old work');
  } finally {
    await ctx?.fiber.dispose(); const target = resolve(temp); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^mentor-collaboration-native-/); await rm(target, { recursive: true, force: true });
  }
});

test('active no-Team Mentor GUI retains native durable memory without fake discussion authority', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'mentor-collaboration-native-')); let ctx;
  try {
    const h = await kernel(temp, false); ctx = h.ctx; const handle = await h.create('no-team-root', temp), root = handle.agent;
    const begin = await call(ctx, root, 'mentor_begin', { mode: 'collaborative', task: 'Owned no-Team fixture' }); assert.equal(begin.collaboration.memory, true);
    await call(ctx, root, 'mentor_knowledge', { action: 'note', conclusion: 'Memory works without native peers', evidence: 'Owned SDK fixture' });
    const snapshot = await ctx.typertGateway.invoke({ namespace: 'mentorCollaboration', method: 'snapshot', args: { sessionId: root.id, query: {} } });
    assert.equal(snapshot.memories.length, 1); assert.deepEqual(snapshot.discussions, []); assert.equal(snapshot.permissions.canDiscuss, false);
    assert.deepEqual((await call(ctx, root, 'mentor_discussion', { action: 'list' })).rooms, []); assert.equal(h.adapter.calls.length, 0);
    await handle.dispose();
  } finally {
    await ctx?.fiber.dispose(); const target = resolve(temp); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^mentor-collaboration-native-/); await rm(target, { recursive: true, force: true });
  }
});
