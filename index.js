import z from '@deepseek-ai/schemastery';
import { z as stateZ } from 'zod';
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope';
import { KEY, PRESET, TERMINAL, initial, fold, view, contextText, encode, text, choice, list, argsObject } from './ledger.js';
import { MENTOR, WORKER } from './prompts.js';
import { toolReadiness, cooperation, summaryText, withSummary, BYPASS, DIRECT_QUESTION_ID, DIRECT_LABEL, INSPECTION_TOOLS } from './experience.js';

export const name = 'codex-mentor';
export const inject = ['tools', 'systemPrompt', 'sessionProjections', 'subagents', 'agents', 'agentPresets', 'llm'];
export const Config = z.object({
  workerProvider: z.string().default('auto'),
  workerModel: z.string().default('deepseek-flash'),
  workerMaxTokens: z.number().step(1).min(1024).max(384000).default(384000),
  maxConcurrentWorkers: z.number().step(1).min(1).max(8).default(3),
  requireGptMentor: z.boolean().default(true)
});
const str = description => ({ type: 'string', description });
const enumeration = (values, description) => ({ type: 'string', enum: values, description });
const strings = description => ({ type: 'array', items: { type: 'string' }, description });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

export function apply(ctx, config) {
  ctx.sessionProjections.register({
    key: KEY, stateVersion: 2,
    stateSchema: stateZ.object({ sessionId: stateZ.string(), parentId: stateZ.string().nullable(), floor: stateZ.number().int().nonnegative(), tasks: stateZ.array(stateZ.any()), checkpoint: stateZ.string(), notes: stateZ.array(stateZ.any()), pending: stateZ.record(stateZ.string(), stateZ.string()), run: stateZ.any().nullable(), consent: stateZ.any().nullable(), permissionCalls: stateZ.record(stateZ.string(), stateZ.boolean()), recentRecordIds: stateZ.array(stateZ.string()) }),
    init: initial, apply: fold
  });
  function state(agent) {
    const result = ctx.sessionProjections.stateOf(agent.session, KEY);
    if (!result) throw new Error('Codex Mentor task memory is unavailable');
    return result;
  }
  async function routes(signal) {
    const providers = ctx.llm.listProviders();
    const candidates = config.workerProvider === 'auto' ? ['deepseek-account', 'deepseek-official'] : [config.workerProvider];
    const diagnostics = [];
    for (const provider of candidates) {
      if (!providers.some(item => item.id === provider)) { diagnostics.push(`${provider}: not registered`); continue; }
      try {
        const models = await ctx.llm.listModels(provider);
        if (!models.some(item => item.id === config.workerModel)) { diagnostics.push(`${provider}: ${config.workerModel} not advertised; configure credentials/model route in Settings → Models`); continue; }
        await ctx.llm.resolveCallConfig({ provider, model: config.workerModel, maxTokens: config.workerMaxTokens }, signal);
        return { provider, model: config.workerModel, maxTokens: config.workerMaxTokens };
      } catch (error) {
        if (signal?.aborted) throw error;
        diagnostics.push(`${provider}: catalog or configuration unavailable (${error.code ?? error.name})`);
      }
    }
    throw new Error('Flash worker unavailable. ' + diagnostics.join('; ') + '. No GPT fallback was used.');
  }
  async function diagnostics(signal) {
    let worker;
    try { worker = { ready: true, route: await routes(signal), inferenceTested: false }; }
    catch (error) { worker = { ready: false, error: error.message }; }
    const providers = ctx.llm.listProviders();
    const mentorModels = providers.some(item => item.id === 'openai-codex') ? await ctx.llm.listModels('openai-codex') : [];
    const presets = await ctx.agentPresets.list();
    return { version: '0.4.1', flashCapabilities: { contextWindow: 1000000, maxOutputTokens: 384000, configuredOutputBudget: config.workerMaxTokens }, preset: presets.find(item => item.id === PRESET) ?? null, worker, mentor: { provider: 'openai-codex', models: mentorModels.map(item => item.id), inferenceTested: false }, liveSessions: (ctx.agents.list?.() ?? []).filter(agent => ctx.agentPresets.composedPreset(agent.ctx) === PRESET).map(agent => ({ sessionId: agent.id, role: agent.session.header.origin === 'subagent' ? 'worker' : 'mentor', ...toolReadiness(agent, ctx.tools), workerRouteReady: worker.ready, initializationError: failures.get(agent.id) ?? null, cooperation: cooperation(state(agent)) })), memory: 'Session-log projection; compression cannot erase recorded task facts. Session-scoped, not a cross-project vector database.' };
  }
  ctx.inject(['cordisInspect'], inner => {
    inner.effect(() => inner.cordisInspect.register({
      manifest: { id: 'CodexMentor', description: 'Read-only installed mentor-mode diagnostics and scoped task memory.', methods: [
        { name: 'diagnostics', description: 'Check preset activation and exact model catalogs without model inference or reading credentials.', inputSchema: object({}), outputSchema: { type: 'object' } },
        { name: 'state', description: 'Read task memory for the requesting mentor-mode Agent only.', inputSchema: object({}), outputSchema: { type: 'object' } }
      ] },
      async query(method, input, { agent, signal }) {
        argsObject(input ?? {}, []);
        if (method === 'diagnostics') return diagnostics(signal);
        if (method === 'state' && ctx.agentPresets.composedPreset(agent.ctx) === PRESET) return view(state(agent));
        throw new Error('Task memory is available only inside Codex Mentor sessions');
      }
    }));
  });

  ctx.on('llm/stream', (options, next) => {
    const agent = options.sessionId ? ctx.agents.get(options.sessionId) : undefined;
    if (!agent || options.purpose || agent.session.header.origin === 'subagent' || ctx.agentPresets.composedPreset(agent.ctx) !== PRESET) return next();
    return withSummary(next(), () => {
      const current = state(agent), running = current.tasks.filter(task => task.started && ctx.agents.get(task.childId)?.status === 'running').length;
      return summaryText(current, toolReadiness(agent, ctx.tools), running);
    });
  });

  const resources = new Map(), failures = new Map();
  function release(agent) {
    const disposers = resources.get(agent.id) ?? [];
    resources.delete(agent.id);
    return Promise.all(disposers.map(dispose => dispose()));
  }
  ctx.effect(() => () => Promise.all([...resources.keys()].map(id => release({ id }))), 'mentor.agent-resources');
  ctx.on('agent/disposed', ({ agent }) => { failures.delete(agent.id); return release(agent); });
  ctx.on('agent-preset/selected', sessionId => {
    const agent = ctx.agents.get(sessionId);
    if (!agent) return;
    // Scope effects remove synchronously; their returned promises only drain cleanup.
    void release(agent).catch(error => ctx.logger('codex-mentor').error(error));
    configure(agent);
  });
  ctx.on('agent/created', ({ agent }) => { configure(agent); });
  // Host activation does not replay creation events for already-live Agents.
  for (const agent of ctx.agents.list?.() ?? []) configure(agent);
  function configure(agent) {
    if (ctx.agentPresets.composedPreset(agent.ctx) !== PRESET || resources.has(agent.id)) return;
    const child = agent.session.header.origin === 'subagent';
    const disposers = [];
    resources.set(agent.id, disposers);
    try { install(agent, child, disposers); failures.delete(agent.id); }
    catch (error) { failures.set(agent.id, error.message); ctx.logger('codex-mentor').error(`Agent ${agent.id} mentor initialization: ${error.message}`); void release(agent).catch(() => {}); throw error; }
  }
  function install(agent, child, disposers) {
    const scoped = agent.ctx.extend?.({ fiber: ctx.fiber }) ?? agent.ctx;
    const owned = setup => { const dispose = scoped.effect(setup); disposers.push(dispose); };
    owned(() => scoped.systemPrompt.context({ name: 'codex-mentor:ledger', order: 850, text: () => contextText(state(agent)) }));
    if (!child) owned(() => scoped.systemPrompt.section({ name: 'codex-mentor:protocol', order: 100, text: MENTOR, interpolate: false }));
    if (child) {
      const readonlyTools = new Set(['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'skill', 'cordis_inspect_list', 'cordis_inspect_query', 'mentor_report', 'mentor_status', 'mentor_memory', 'send_message', 'list_agents', 'ask_user_question', 'todo_write']);
      owned(() => scoped.tools.guard(execution => {
        const assignment = state(agent).tasks[0];
        if (!assignment) return execution.name === 'mentor_status' ? undefined : 'Assignment not yet admitted; recover it with mentor_status';
        if (TERMINAL.includes(assignment.status) && execution.name !== 'mentor_status') return 'This assignment is closed';
        if (['blocked', 'ready-review'].includes(assignment.status) && !['mentor_status', 'mentor_memory'].includes(execution.name)) return 'Awaiting tutor guidance or review; a local ledger notice does not authorize more work.';
        if (!assignment.writeScope.length && !readonlyTools.has(execution.name)) return 'Read-only assignment: mutation and shell tools are disabled';
      }));
      owned(() => scoped.on('agent/pre-step', async (_payload, next) => {
        if (state(agent).tasks.some(item => [...TERMINAL, 'blocked', 'ready-review'].includes(item.status))) return { kind: 'reject' };
        return next();
      }));
      owned(() => scoped.on('agent/request', async (_payload, next) => {
        const selected = await next();
        const route = state(agent).tasks[0]?.route;
        if (route && (selected.provider !== route.provider || selected.model !== route.model)) throw new Error('This worker is pinned to its recorded Flash route; changing its model is not allowed.');
        return selected;
      }));
    }
    if (!child && config.requireGptMentor) owned(() => scoped.on('agent/request', async (_payload, next) => {
      const selected = await next();
      if (selected.provider !== 'openai-codex' || !selected.model.startsWith('gpt-')) throw new Error('Codex Mentor requires a GPT model. Select your GPT model in the session model picker; other sessions/defaults were not changed.');
      return selected;
    }));
    // restrict() masks inherited tools, not an Agent's own bridge registrations.
    const bypass = BYPASS;
    const inheritedScope = scopeParentOf(scopeOf(agent.ctx));
    const deny = bypass.filter(tool => ctx.tools.get(tool, inheritedScope));
    if (deny.length) owned(() => scoped.tools.restrict({ deny }));
    owned(() => scoped.tools.guard(execution => bypass.includes(execution.name) ? 'Use the mentor protocol; alternate delegation is disabled in this mode' : undefined));
    if (!child) owned(() => scoped.tools.guard(execution => {
      if (execution.name.startsWith('mentor_') || ['ask_user_question', 'skill', 'todo_write'].includes(execution.name)) return;
      const current = state(agent), readiness = toolReadiness(agent, ctx.tools);
      if (!readiness.toolsReady) return `Mentor tools are missing: ${readiness.missing.join(', ')}. Diagnose or ask the user; no silent fallback.`;
      if (!current.run || current.run.mode === 'diagnostic') return 'Before task execution use mentor_begin; diagnose missing capability or obtain explicit user permission for direct execution.';
      if (current.run.mode === 'collaborative' && !cooperation(current).delegated) {
        if (!INSPECTION_TOOLS.includes(execution.name) || current.run.preliminaryCalls > 3) return 'Only three preliminary inspections are allowed before real delegation. Use mentor_delegate or obtain user consent for direct execution; do not complete the task alone.';
      }
    }));
    function tool(toolName, description, parameters, execute) {
      owned(() => scoped.tools.register({
        name: toolName, description, parameters,
        output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }], presentationMeta: (_args, value) => value.record ? { codexMentor: value.record } : {} },
        async execute(args, exec) {
          if (exec.agent !== agent) throw new Error('Wrong Agent scope');
          argsObject(args, Object.keys(parameters.properties));
          const value = await execute(args, exec);
          if (['memory', 'begin', 'verify'].includes(value.record?.kind)) commit(value.record);
          return value;
        }
      }));
    }
    function task(id) {
      const value = state(agent).tasks.find(item => item.taskId === text(id, 'task_id', 100));
      if (!value) throw new Error('Unknown task_id; call mentor_status');
      return value;
    }
    function commit(record) {
      record.id ??= randomUUID();
      const summary = `Codex Mentor: ${record.kind} ${record.taskId ?? ''}`.trim();
      agent.inject(createUserMessage({ source: { kind: 'codex-mentor-ledger', form: 'notice', summary, record }, content: [{ type: 'text', text: summary }] }));
    }
    async function send(target, record, signal) {
      record.id ??= randomUUID();
      const messageId = await ctx.subagents.sendMessage(agent, target, [{ type: 'text', text: encode(record) }], { signal });
      commit(record);
      return messageId;
    }
    tool('mentor_status', 'Read durable task memory after compaction or resume. Omit task_id for a compact directory; supply it for full assignment, blocker, guidance and review evidence.', object({ task_id: str('Optional task id for full details.') }, []), async args => {
      const result = view(state(agent));
      const selected = args.task_id ? [task(args.task_id)] : result.tasks.map(item => ({ taskId: item.taskId, childId: item.childId, goal: item.goal?.slice(0, 400), writeScope: item.writeScope, status: item.status, question: item.report?.question ?? '', next: item.guidance?.nextSteps?.slice(0, 700) ?? '' }));
      let workerRoute;
      try { workerRoute = { ready: true, route: await routes() }; } catch (error) { workerRoute = { ready: false, error: error.message }; }
      return { ...result, capabilities: { ...toolReadiness(agent, ctx.tools), worker: workerRoute }, cooperation: cooperation(state(agent)), tasks: selected, notes: result.notes.map(({ evidence, ...note }) => ({ ...note, evidence: evidence?.slice(0, 500) ?? '' })), activity: selected.map(item => ({ taskId: item.taskId, childId: item.childId, activity: ctx.agents.get(item.childId)?.status ?? 'not-live' })) };
    });
    tool('mentor_memory', 'Update a concise session checkpoint or a scoped note. Verified notes require mentor evidence; forget removes a stale note, not its audit trail.', object({
      action: enumeration(['checkpoint', 'note', 'forget'], 'Operation.'),
      checkpoint: str('For checkpoint: current goal, unresolved decisions, failed attempts, ownership, next steps; at most 3000 characters.'),
      id: str('For note/forget: stable note id, at most 80 characters.'),
      conclusion: str('For note: concise observation or hypothesis.'),
      status: enumeration(['hypothesis', 'verified', 'invalidated'], 'For note: validation state; workers may not write verified notes.'),
      evidence: str('For note: check/result/source establishing this state; required for verified notes.'),
      scope: str('For note: applicability and conditions that invalidate it.')
    }, ['action']), async args => {
      const action = choice(args.action, 'action', ['checkpoint', 'note', 'forget']);
      if (action === 'checkpoint') return { record: { version: 1, kind: 'memory', checkpoint: text(args.checkpoint, 'checkpoint') } };
      const id = text(args.id, 'id', 80);
      if (action === 'forget') return { record: { version: 1, kind: 'memory', action, id } };
      const status = choice(args.status, 'status', ['hypothesis', 'verified', 'invalidated']);
      if (child && status === 'verified') throw new Error('Only the mentor may approve verified notes');
      if (!state(agent).notes.some(item => item.id === id) && state(agent).notes.length >= 20) throw new Error('Note limit is 20; forget obsolete notes first');
      return { record: { version: 1, kind: 'memory', id, status, conclusion: text(args.conclusion, 'conclusion', 1000), evidence: args.evidence ? text(args.evidence, 'evidence', 2000) : status === 'verified' ? text(args.evidence, 'evidence') : '', scope: text(args.scope, 'scope', 600) } };
    });
    if (child) {
      tool('mentor_report', 'Send progress, a specific blocked question, or ready-review evidence to your direct tutor. Blocked pauses dependent work and ends this turn; guidance can resume you.', object({
        task_id: str('Assignment task id.'), status: enumeration(['progress', 'blocked', 'ready-review'], 'Work state; ready-review is not accepted.'),
        summary: str('Observed state or change summary, at most 2000 characters.'), evidence: str('Paths, checks and actual results, at most 3000 characters.'),
        attempts: str('For blocked: distinct attempts and results, or why no safe attempt is allowed.'), question: str('For blocked: specific decision or diagnostic help needed.'),
        changes: strings('For ready-review: changed files, or [] for read-only work.'), checks: strings('For ready-review: exact commands/manual checks and actual outcomes; [] if none were run.'), criteria: strings('For ready-review: each acceptance criterion with PASS/FAIL/UNVERIFIED and evidence.'), deviations: strings('Optional implementation choices differing from the initial approach and why.'), assumptions: strings('Optional newly introduced assumptions.'), risks: strings('For ready-review: remaining risks, or [] if none are known.')
      }, ['task_id', 'status', 'summary', 'evidence']), async (args, exec) => {
        const assignment = task(args.task_id);
        if (TERMINAL.includes(assignment.status)) throw new Error('Assignment is already closed');
        const status = choice(args.status, 'status', ['progress', 'blocked', 'ready-review']);
        const record = { version: 1, kind: 'report', taskId: assignment.taskId, childId: agent.id, status, summary: text(args.summary, 'summary', 2000), evidence: text(args.evidence, 'evidence'), attempts: status === 'blocked' ? text(args.attempts, 'attempts', 2000) : '', question: status === 'blocked' ? text(args.question, 'question', 1000) : '' };
        record.evidenceGate = status === 'ready-review' ? { changes: list(args.changes, 'changes'), checks: list(args.checks, 'checks'), criteria: list(args.criteria, 'criteria'), deviations: list(args.deviations ?? [], 'deviations'), assumptions: list(args.assumptions ?? [], 'assumptions'), risks: list(args.risks, 'risks') } : null;
        if (record.evidenceGate && !record.evidenceGate.criteria.length) throw new Error('Evidence Gate requires acceptance-criterion results');
        const messageId = await send(agent.session.header.parentSession, record, exec.signal);
        if (status !== 'progress') exec.concludeTurn();
        return { record, messageId, delivery: 'accepted, not a tutor reply' };
      });
      return;
    }
    async function begin(args, exec) {
      const mode = choice(args.mode, 'mode', ['collaborative', 'simple', 'direct', 'diagnostic']);
      const own = state(agent), readiness = toolReadiness(agent, ctx.tools);
      if (own.run?.mode === mode && mode !== 'diagnostic') return { run: own.run, ...readiness };
      if (own.tasks.some(item => !TERMINAL.includes(item.status))) throw new Error('Recover existing tasks with mentor_status; do not silently switch their execution mode.');
      if (mode === 'direct' && !own.consent) throw new Error(`Direct execution requires a real user answer. Use ask_user_question with question id "${DIRECT_QUESTION_ID}" and options "修复导师能力后继续", "${DIRECT_LABEL}", "只做能力诊断"; no answer or a skipped answer is not permission.`);
      let route = null, error = '';
      if (mode === 'collaborative' && readiness.toolsReady) {
        try { route = await routes(exec.signal); } catch (failure) { error = failure.message; }
      }
      if (!readiness.toolsReady) error = `Missing tools: ${readiness.missing.join(', ')}`;
      const record = { version: 1, kind: 'begin', runId: randomUUID(), mode: error ? 'diagnostic' : mode, task: text(args.task, 'task', 1000), route, error, consent: mode === 'direct' ? own.consent : null };
      commit(record);
      return { record, ...readiness, workerRouteReady: !!route, workerStarted: false, choices: error ? ['修复导师能力后继续', DIRECT_LABEL, '只做能力诊断'] : [] };
    }
    tool('mentor_begin', 'Check actual capabilities before execution. Non-trivial work uses collaborative; simple covers brief questions or tiny tasks. Direct requires an actual user consent answer; diagnostic does not authorize task execution.', object({ mode: enumeration(['collaborative', 'simple', 'direct', 'diagnostic'], 'Execution mode for this task.'), task: str('Task boundary and why this mode applies, at most 1000 characters.') }), begin);
    tool('mentor_verify', 'Run one independent local inspection/check and save its actual result against a task. Accepted reviews must cite these check ids, run after the latest ready-review report. Failed checks are recorded, never treated as passing.', object({ task_id: str('Task being independently checked.'), tool: enumeration(['read', 'read_image', 'glob', 'grep', 'bash', 'web_fetch'], 'Native inspection/check tool to execute.'), arguments: { type: 'object', additionalProperties: true, description: 'Arguments for that native tool, validated by its own schema and policy.' }, label: str('Which criterion this check evaluates, at most 500 characters.') }), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const name = choice(args.tool, 'tool', ['read', 'read_image', 'glob', 'grep', 'bash', 'web_fetch']);
      const result = await scoped.tools.execute({ callId: randomUUID(), rootCallId: exec.rootCallId, parent: exec.token, name, arguments: args.arguments, agent, signal: exec.signal });
      const record = { version: 1, kind: 'verify', taskId: assignment.taskId, id: randomUUID(), label: text(args.label, 'label', 500), tool: name, arguments: args.arguments, output: JSON.stringify(result.value ?? result.error ?? null).slice(0, 6000), isError: !!(result.isError || (name === 'bash' && (result.value?.kind !== 'foreground' || result.value.exitCode !== 0 || result.value.timedOut || result.value.aborted))), readyReportId: assignment.status === 'ready-review' ? assignment.report?.id ?? '' : '' };
      return { record, checkId: record.id, actualResult: record.output, isError: record.isError };
    });
    tool('mentor_delegate', 'Start a fixed-model Flash worker with a self-contained assignment and return its durable id. Runs in the background; reports can ask for tutor guidance.', object({
      goal: str('Self-contained task and relevant context, at most 3000 characters.'), write_scope: strings('Workspace-relative files/directories the worker may edit; empty means read-only. No globs, absolute paths or parent traversal.'),
      acceptance: str('Concrete acceptance criteria with identifiers, at most 2000 characters.'), constraints: str('Architectural boundaries and restrictions, at most 2000 characters.'),
      invariants: strings('Optional conditions that must never be violated.'), interfaces: strings('Optional input/output and compatibility contracts.'), failure_tests: strings('Optional boundary/failure cases to validate.'), open_questions: strings('Optional choices left to worker exploration.'), mathematical_model: str('Optional core objects, states, constraints or algorithm definitions; omit for routine tasks.')
    }, ['goal', 'write_scope', 'acceptance']), async (args, exec) => {
      if (!state(agent).run) await begin({ mode: 'collaborative', task: args.goal }, exec);
      const own = state(agent);
      if (own.run?.mode !== 'collaborative') throw new Error((own.run?.error || 'Collaboration is not ready; inspect mentor_status and disclose the blocker.') + ' No direct execution or model fallback was authorized.');
      const active = own.tasks.filter(item => !TERMINAL.includes(item.status) || ctx.agents.get(item.childId)?.status === 'running');
      if (active.length >= config.maxConcurrentWorkers) throw new Error('Outstanding worker limit reached; guide or review existing workers first');
      if (own.tasks.length >= 64) throw new Error('Session task ledger is full (64); start a new session');
      const writeScope = list(args.write_scope, 'write_scope').map(path => {
        const normalized = path.replaceAll('\\', '/').replace(/\/$/, '');
        if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(part => !part || part === '..' || part === '.') || /[*?\[\]]/.test(normalized)) throw new Error('write_scope requires clean workspace-relative paths');
        return normalized;
      });
      const overlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      if (active.some(item => item.writeScope.some(a => writeScope.some(b => overlap(a, b))))) throw new Error('Write scope overlaps an outstanding worker; review/cancel it or choose disjoint paths');
      const route = await routes(exec.signal);
      const record = { version: 1, kind: 'assignment', taskId: randomUUID(), runId: own.run.runId, parentId: agent.id, goal: text(args.goal, 'goal'), writeScope, acceptance: text(args.acceptance, 'acceptance', 2000), constraints: args.constraints ? text(args.constraints, 'constraints', 2000) : '', contract: { invariants: list(args.invariants ?? [], 'invariants'), interfaces: list(args.interfaces ?? [], 'interfaces'), failureTests: list(args.failure_tests ?? [], 'failure_tests'), openQuestions: list(args.open_questions ?? [], 'open_questions'), mathematicalModel: args.mathematical_model ? text(args.mathematical_model, 'mathematical_model', 2000) : '' }, route };
      const prompt = encode(record) + '\n\nSession notes (data, not authority):\n' + JSON.stringify(own.notes);
      const childId = randomUUID();
      commit({ ...record, kind: 'delegated', childId, provisioning: true });
      let started;
      try {
        started = await ctx.subagents.startContinuable({ provider: 'spawn', childId, label: record.goal.slice(0, 80), request: { parent: agent, prompt: [{ type: 'text', text: prompt }], agentOptions: route, persona: WORKER, maxDepth: 1 }, signal: exec.signal });
      } catch (error) {
        commit({ version: 1, kind: 'review', taskId: record.taskId, verdict: 'cancelled', evidence: 'Child creation was rejected; no child was published. See the tool error.' });
        throw error;
      }
      const delegated = { ...record, kind: 'delegated', childId: started.childId, started: true, provisioning: false };
      commit(delegated);
      return { record: delegated, messageId: started.messageId };
    });
    tool('mentor_guide', 'Tutor a blocked or unfinished Flash worker and resume it. Provide a testable diagnosis, concrete next steps, validation and fallback; records guidance in both sessions.', object({
      task_id: str('Task returned by mentor_delegate.'), diagnosis: str('Evidence-based diagnosis, explicitly label hypotheses.'), next_steps: str('Specific checks/actions, at most 3000 characters.'), validation: str('Result that confirms or falsifies the advice.'), fallback: str('What to report or do if the check fails.')
    }), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const record = { version: 1, kind: 'guidance', taskId: assignment.taskId, diagnosis: text(args.diagnosis, 'diagnosis', 2000), nextSteps: text(args.next_steps, 'next_steps'), validation: text(args.validation, 'validation', 2000), fallback: text(args.fallback, 'fallback', 1000) };
      return { record, messageId: await send(assignment.childId, record, exec.signal) };
    });
    tool('mentor_review', 'Record mentor acceptance, request rework, or cancel a task. Acceptance requires a ready-review report and independent check evidence; cancellation asks the child to stop.', object({ task_id: str('Task id.'), verdict: enumeration(['accepted', 'rework', 'cancelled'], 'Acceptance decision.'), evidence: str('Independent checks/results, rework instructions, or cancellation reason.'), verification_ids: strings('For accepted: actual successful mentor_verify check ids for the latest ready-review report.') }, ['task_id', 'verdict', 'evidence']), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const verdict = choice(args.verdict, 'verdict', ['accepted', 'rework', 'cancelled']);
      if (verdict === 'accepted' && (assignment.status !== 'ready-review' || !assignment.report?.evidenceGate?.checks.length)) throw new Error('Acceptance requires a ready-review report with check evidence');
      const verificationIds = list(args.verification_ids ?? [], 'verification_ids');
      if (verdict === 'accepted' && (!verificationIds.length || verificationIds.some(id => !assignment.verifications?.some(check => check.id === id && !check.isError && check.readyReportId && check.readyReportId === assignment.report?.id)))) throw new Error('Acceptance requires actual successful mentor_verify checks after the latest ready-review report; worker assertions and invented check ids are not independent verification.');
      const record = { version: 1, kind: 'review', taskId: assignment.taskId, verdict, verificationIds, evidence: text(args.evidence, 'evidence') };
      const messageId = await send(assignment.childId, record, exec.signal);
      if (verdict === 'cancelled') ctx.subagents.interrupt(assignment.childId, { kind: 'ancestor', agent });
      return { record, messageId };
    });
  }
}
