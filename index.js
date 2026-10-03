import z from '@deepseek-ai/schemastery';
import { z as stateZ } from 'zod';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope';
import { KEY, PRESET, TERMINAL, initial, fold, view, contextText, encode, text, choice, list, argsObject } from './ledger.js?mentor=0.5.0';
import { MENTOR, WORKER } from './prompts.js?mentor=0.5.0';
import { toolReadiness, cooperation, effectiveCapabilities, BYPASS, DIRECT_QUESTION_ID, DIRECT_LABEL, INSPECTION_TOOLS } from './experience.js?mentor=0.5.0';

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
    key: KEY, stateVersion: 3,
    stateSchema: stateZ.object({ sessionId: stateZ.string(), parentId: stateZ.string().nullable(), floor: stateZ.number().int().nonnegative(), tasks: stateZ.array(stateZ.any()), checkpoint: stateZ.string(), notes: stateZ.array(stateZ.any()), pending: stateZ.record(stateZ.string(), stateZ.string()), run: stateZ.any().nullable(), lastCompletedRun: stateZ.any().nullable(), lastInputId: stateZ.string().nullable(), recentInputIds: stateZ.array(stateZ.string()), consent: stateZ.any().nullable(), permissionCalls: stateZ.record(stateZ.string(), stateZ.boolean()), recentRecordIds: stateZ.array(stateZ.string()) }),
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
    return { version: '0.5.0', flashCapabilities: { contextWindow: 1000000, maxOutputTokens: 384000, configuredOutputBudget: config.workerMaxTokens }, preset: presets.find(item => item.id === PRESET) ?? null, worker, mentor: { provider: 'openai-codex', models: mentorModels.map(item => item.id), inferenceTested: false }, liveSessions: (ctx.agents.list?.() ?? []).filter(agent => ctx.agentPresets.composedPreset(agent.ctx) === PRESET).map(agent => ({ sessionId: agent.id, role: agent.session.header.origin === 'subagent' ? 'worker' : 'mentor', ...toolReadiness(agent, ctx.tools), workerRouteReady: worker.ready, initializationError: failures.get(agent.id) ?? null, cooperation: cooperation(state(agent)) })), memory: 'Session-log projection; compression cannot erase recorded task facts. Session-scoped, not a cross-project vector database.' };
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
        const decision = await next();
        if (decision.kind === 'reject') return decision;
        if (state(agent).tasks.some(item => [...TERMINAL, 'blocked', 'ready-review'].includes(item.status))) return { kind: 'enter', messages: [] };
        return decision;
      }));
      owned(() => scoped.on('agent/request', async (_payload, next) => {
        const selected = await next();
        const route = state(agent).tasks[0]?.route;
        if (route && (selected.provider !== route.provider || selected.model !== route.model)) throw new Error('This worker is pinned to its recorded Flash route; changing its model is not allowed.');
        return selected;
      }));
    }
    if (!child) owned(() => scoped.on('agent/pre-step', async (payload, next) => {
      const redundant = message => {
        const source = message.source;
        if (source?.kind !== 'subagent-settled') return false;
        const assignment = state(agent).tasks.find(item => item.childId === source.senderSessionId);
        return assignment && [...TERMINAL, 'blocked', 'ready-review'].includes(assignment.status) && source.summary === `Background subagent ${source.senderSessionId} finished and will do no further work unless you send it more.`;
      };
      const decision = await next();
      if (decision.kind === 'reject') return decision;
      if (payload.messages?.length && payload.messages.every(redundant)) return { kind: 'enter', messages: [] };
      return { ...decision, messages: decision.messages.filter(message => !redundant(message)).map(message => {
        const source = message.source;
        const assignment = source?.kind === 'subagent-settled' && state(agent).tasks.find(item => item.childId === source.senderSessionId);
        if (assignment?.status !== 'stopped' || !source.summary.includes('finished and will do no further work')) return message;
        return { ...message, content: [{ type: 'text', text: `Worker ${assignment.childId} stopped WITHOUT a reviewable report. Task ${assignment.taskId} remains incomplete. Request a formal report with mentor_guide or cancel it; do not accept a closing message.` }] };
      }) };
    }));
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
      const selected = args.task_id ? [task(args.task_id)] : result.tasks.map(item => ({ taskId: item.taskId, childId: item.childId, goal: item.goal?.slice(0, 400), writeScope: item.writeScope, effectiveCapabilities: effectiveCapabilities(item.writeScope), status: item.status, question: item.report?.question ?? '', next: item.guidance?.nextSteps?.slice(0, 700) ?? '' }));
      let workerRoute;
      try { workerRoute = { ready: true, route: await routes() }; } catch (error) { workerRoute = { ready: false, error: error.message }; }
      return { ...result, capabilities: { ...toolReadiness(agent, ctx.tools), worker: workerRoute }, cooperation: cooperation(state(agent)), lastRunCooperation: cooperation(state(agent), state(agent).lastCompletedRun), tasks: selected, notes: result.notes.map(({ evidence, ...note }) => ({ ...note, evidence: evidence?.slice(0, 500) ?? '' })), activity: selected.map(item => ({ taskId: item.taskId, childId: item.childId, activity: ctx.agents.get(item.childId)?.status ?? 'not-live' })) };
    });
    if (!child) tool('mentor_wait', 'Yield this turn while selected Mentor workers are pending. Their formal reports or stop notices resume this session; no Agent Teams polling is needed.', object({ task_ids: strings('Tasks to await; omit for all outstanding tasks.') }, []), async (args, exec) => {
      const ids = list(args.task_ids ?? [], 'task_ids');
      const tasks = ids.length ? ids.map(task) : state(agent).tasks.filter(item => !TERMINAL.includes(item.status));
      const actionable = tasks.filter(item => [...TERMINAL, 'blocked', 'ready-review', 'stopped'].includes(item.status));
      const waiting = tasks.length > 0 && actionable.length === 0;
      if (waiting) exec.concludeTurn();
      return { waiting, resumeOn: waiting ? 'formal report or native stop notice' : null, tasks: tasks.map(item => ({ taskId: item.taskId, status: item.status, report: item.report ? { id: item.report.id, summary: item.report.summary } : null })) };
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
      const record = { version: 1, kind: 'begin', sessionId: agent.id, runId: randomUUID(), taskKind: args.task_kind ? choice(args.task_kind, 'task_kind', ['overview', 'review', 'implementation', 'audit', 'other']) : /audit|审计/i.test(args.task) ? 'audit' : /overview|概览|目前.*情况|当前.*状态/i.test(args.task) ? 'overview' : 'other', mode: error ? 'diagnostic' : mode, task: text(args.task, 'task', 1000), route, error, consent: mode === 'direct' ? own.consent : null };
      commit(record);
      return { record, ...readiness, workerRouteReady: !!route, workerStarted: false, choices: error ? ['修复导师能力后继续', DIRECT_LABEL, '只做能力诊断'] : [] };
    }
    tool('mentor_begin', 'Check actual capabilities before execution. Non-trivial work uses collaborative; simple covers brief questions or tiny tasks. Direct requires an actual user consent answer; diagnostic does not authorize task execution.', object({ mode: enumeration(['collaborative', 'simple', 'direct', 'diagnostic'], 'Execution mode for this task.'), task: str('Task boundary and stopping condition, at most 1000 characters.'), task_kind: enumeration(['overview', 'review', 'implementation', 'audit', 'other'], 'Task level. overview has a one-worker budget; stop once version, scope, blockers and evidence sources are clear.') }, ['mode', 'task']), begin);
    const nativeCheck = (name, args, exec) => scoped.tools.execute({ callId: randomUUID(), rootCallId: exec.rootCallId, parent: exec.token, name, arguments: args, agent, signal: exec.signal });
    async function fingerprint(paths, exec) {
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      const script = 'const fs=require("node:fs"),crypto=require("node:crypto");console.log(JSON.stringify(process.argv.slice(1).map(path=>({path,sha256:crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex")}))))';
      const result = await nativeCheck('bash', { command: `${quote(process.execPath)} -e ${quote(script)} -- ${paths.map(quote).join(' ')}`, description: 'Fingerprint named acceptance inputs', workdir: agent.session.header.cwd ?? process.cwd(), timeoutMs: 10000 }, exec);
      if (result.isError || result.value?.kind !== 'foreground' || result.value.exitCode !== 0 || result.value.timedOut || result.value.aborted || result.value.stdout?.truncated) throw new Error('Input fingerprint failed; no evidence reuse was authorized');
      const values = JSON.parse(result.value.stdout.text.trim());
      if (!Array.isArray(values) || values.length !== paths.length || values.some((item, i) => item.path !== paths[i] || !/^[a-f0-9]{64}$/.test(item.sha256))) throw new Error('Invalid input fingerprint result');
      return values;
    }
    tool('mentor_verify', 'Execute an independent check and retain its result. Execution success is NOT a passed criterion; interpret it in mentor_review. Named inputs can bind file-reading evidence to its actual target and execution directory for later reuse; Shell/network/search evidence still requires the latest report.', object({ task_id: str('Task being independently checked.'), kind: enumeration(['test-execution', 'historical-log', 'static-read', 'version-check', 'other'], 'Evidence source category; default other, not a claim that a test passed.'), tool: enumeration(['read', 'read_image', 'glob', 'grep', 'bash', 'web_fetch'], 'Native inspection/check tool to execute.'), arguments: { type: 'object', additionalProperties: true, description: 'Arguments for that native tool, validated by its own schema and policy.' }, label: str('Question this execution supplies evidence for, at most 500 characters.'), input_paths: strings('Optional complete list of workspace-relative files determining this check, including configuration/data dependencies. Hashed through native shell policy before and after execution; only unchanged read-only inputs qualify for reuse.') }, ['task_id', 'tool', 'arguments', 'label']), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const name = choice(args.tool, 'tool', ['read', 'read_image', 'glob', 'grep', 'bash', 'web_fetch']);
      const paths = list(args.input_paths ?? [], 'input_paths');
      if (paths.some(path => path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('input_paths requires clean workspace-relative file paths');
      const executionScope = resolve(agent.session.header.cwd ?? process.cwd());
      const directInput = ['read', 'read_image'].includes(name) && typeof args.arguments?.file_path === 'string' ? resolve(executionScope, args.arguments.file_path) : null;
      const reusableScope = !!directInput && paths.some(path => resolve(executionScope, path) === directInput);
      if (paths.length && !reusableScope) throw new Error('Cross-report reuse currently supports file reads only; input_paths must include the actual read/read_image target. Shell/network/search dependencies cannot be inferred safely.');
      const before = paths.length ? await fingerprint(paths, exec) : null;
      const result = await nativeCheck(name, args.arguments, exec);
      const after = paths.length ? await fingerprint(paths, exec) : null;
      const stable = !!before && JSON.stringify(before) === JSON.stringify(after);
      const isError = !!(result.isError || (name === 'bash' && (result.value?.kind !== 'foreground' || result.value.exitCode !== 0 || result.value.timedOut || result.value.aborted)));
      const record = { version: 1, kind: 'verify', taskId: assignment.taskId, id: randomUUID(), label: text(args.label, 'label', 500), evidenceKind: args.kind ? choice(args.kind, 'kind', ['test-execution', 'historical-log', 'static-read', 'version-check', 'other']) : 'other', tool: name, arguments: args.arguments, output: JSON.stringify(result.value ?? result.error ?? null).slice(0, 6000), isError, executionSucceeded: !isError, criterionSatisfied: null, inputs: stable ? after : null, inputScope: paths, executionScope, directInput, readyReportId: assignment.status === 'ready-review' ? assignment.report?.id ?? '' : '' };
      return { record, checkId: record.id, actualResult: record.output, isError, executionSucceeded: !isError, criterionSatisfied: null, reusableInputs: stable, scopeLimit: 'Only the declared file inputs were fingerprinted; remote state, environment, omitted dependencies and changed claims need new evidence.' };
    });
    tool('mentor_delegate', 'Start a fixed-model Flash worker with a self-contained assignment and return its durable id. Runs in the background; reports can ask for tutor guidance.', object({
      goal: str('Self-contained task and relevant context, at most 3000 characters.'), write_scope: strings('Workspace-relative write scope. [] disables ALL mutation and shell tools, including Git, hashes and tests; assign those checks to the mentor. No globs, absolute paths or parent traversal.'),
      required_capabilities: { type: 'array', items: enumeration(['fileRead', 'fileWrite', 'shell', 'tests', 'formalReport'], 'Required assignment capability.'), description: 'Optional execution requirements; unsupported capabilities are rejected before worker creation.' },
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
      const capabilities = effectiveCapabilities(writeScope);
      const required = list(args.required_capabilities ?? [], 'required_capabilities');
      if (required.some(key => capabilities[key] !== true)) throw new Error('Assignment requires unavailable capabilities: ' + required.filter(key => capabilities[key] !== true).join(', ') + '. Empty write_scope disables shell/Git/tests; allocate these checks to the mentor.');
      if (own.run.taskKind === 'overview' && own.tasks.some(item => item.runId === own.run.runId && item.started)) throw new Error('Overview budget is one worker. Narrow the question and sample its important claims instead of duplicating its reading.');
      const overlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      if (active.some(item => item.writeScope.some(a => writeScope.some(b => overlap(a, b))))) throw new Error('Write scope overlaps an outstanding worker; review/cancel it or choose disjoint paths');
      const route = await routes(exec.signal);
      const record = { version: 1, kind: 'assignment', taskId: randomUUID(), runId: own.run.runId, parentRunId: own.run.runId, parentId: agent.id, effectiveCapabilities: capabilities, goal: text(args.goal, 'goal'), writeScope, acceptance: text(args.acceptance, 'acceptance', 2000), constraints: args.constraints ? text(args.constraints, 'constraints', 2000) : '', contract: { invariants: list(args.invariants ?? [], 'invariants'), interfaces: list(args.interfaces ?? [], 'interfaces'), failureTests: list(args.failure_tests ?? [], 'failure_tests'), openQuestions: list(args.open_questions ?? [], 'open_questions'), mathematicalModel: args.mathematical_model ? text(args.mathematical_model, 'mathematical_model', 2000) : '' }, route };
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
      return { record: delegated, childSessionId: delegated.childId, effectiveCapabilities: capabilities, messageId: started.messageId };
    });
    tool('mentor_guide', 'Tutor a blocked or unfinished Flash worker and resume it. Provide a testable diagnosis, concrete next steps, validation and fallback; records guidance in both sessions.', object({
      task_id: str('Task returned by mentor_delegate.'), diagnosis: str('Evidence-based diagnosis, explicitly label hypotheses.'), next_steps: str('Specific checks/actions, at most 3000 characters.'), validation: str('Result that confirms or falsifies the advice.'), fallback: str('What to report or do if the check fails.'), purpose: enumeration(['task-guidance', 'implementation-rework', 'report-correction', 'lifecycle-repair'], 'Why the tutor is resuming this worker; recorded separately from implementation rework.')
    }, ['task_id', 'diagnosis', 'next_steps', 'validation', 'fallback']), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const record = { version: 1, kind: 'guidance', taskId: assignment.taskId, purpose: args.purpose ? choice(args.purpose, 'purpose', ['task-guidance', 'implementation-rework', 'report-correction', 'lifecycle-repair']) : 'task-guidance', diagnosis: text(args.diagnosis, 'diagnosis', 2000), nextSteps: text(args.next_steps, 'next_steps'), validation: text(args.validation, 'validation', 2000), fallback: text(args.fallback, 'fallback', 1000) };
      return { record, messageId: await send(assignment.childId, record, exec.signal) };
    });
    tool('mentor_review', 'Assess recorded execution evidence against every reported criterion, request correction, or cancel. accepted endorses the entire latest report, not selected claims; incorrect reports need rework.', object({ task_id: str('Task id.'), verdict: enumeration(['accepted', 'rework', 'cancelled'], 'Acceptance decision.'), evidence: str('Interpreted evidence or specific correction/cancellation instructions.'), verification_ids: strings('For accepted: successful execution IDs. Older read-only evidence needs unchanged fingerprints of all declared inputs.'), report_reliable: { type: 'boolean', description: 'For accepted: explicitly confirm the whole final report is reliable. Do not set true when excluding errors; request a corrected report instead.' }, assessments: { type: 'array', maxItems: 16, description: 'For accepted: one explicit assertion per report criterion. Reading a failed log successfully does not make its criterion pass.', items: object({ criterion: str('Report criterion identifier (text before its colon).'), passed: { type: 'boolean', description: 'Whether the criterion is satisfied, distinct from execution success.' }, expected: str('Required outcome.'), observed: str('Actual facts in the execution result.'), interpretation: str('Why these facts satisfy or fail the criterion.'), scope: str('Version and coverage limits; name dependencies not checked.'), verification_ids: strings('Successful execution IDs supporting this assertion.') }) } }, ['task_id', 'verdict', 'evidence']), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const verdict = choice(args.verdict, 'verdict', ['accepted', 'rework', 'cancelled']);
      if (verdict === 'accepted' && (assignment.status !== 'ready-review' || !assignment.report?.evidenceGate)) throw new Error('Acceptance requires a formal ready-review report');
      const verificationIds = list(args.verification_ids ?? [], 'verification_ids');
      let assessments = [];
      if (verdict === 'accepted') {
        const checks = verificationIds.map(id => assignment.verifications?.find(check => check.id === id && !check.isError));
        if (!checks.length || checks.some(check => !check)) throw new Error('Acceptance requires actual successful mentor_verify execution IDs');
        for (const check of checks) {
          if (check.readyReportId === assignment.report.id) continue;
          if (assignment.writeScope.length || !check.inputs || !check.inputScope?.length || !['read', 'read_image'].includes(check.tool) || check.executionScope !== resolve(agent.session.header.cwd ?? process.cwd()) || !check.inputScope.some(path => resolve(check.executionScope, path) === check.directInput) || JSON.stringify(await fingerprint(check.inputScope, exec)) !== JSON.stringify(check.inputs)) throw new Error('Evidence must match the latest ready-review report or unchanged fingerprinted inputs of a read-only assignment');
        }
        const criteria = assignment.report.evidenceGate.criteria;
        if (args.report_reliable !== true || criteria.some(item => !/^[^:：]+[:：]\s*PASS\b/i.test(item))) throw new Error('Acceptance endorses the whole report; correct errors/unverified criteria before accepting');
        if (!Array.isArray(args.assessments) || args.assessments.length !== criteria.length) throw new Error('Acceptance requires explicit assertions for every report criterion; execution success alone is insufficient');
        const ids = criteria.map(item => item.split(/[:：]/)[0].trim());
        if (new Set(ids).size !== ids.length) throw new Error('Report criterion identifiers must be unique');
        assessments = args.assessments.map(item => {
          argsObject(item, ['criterion', 'passed', 'expected', 'observed', 'interpretation', 'scope', 'verification_ids']);
          const criterion = text(item.criterion, 'criterion', 500), refs = list(item.verification_ids, 'verification_ids');
          if (!ids.includes(criterion) || item.passed !== true || !refs.length || refs.some(id => !verificationIds.includes(id))) throw new Error('Each criterion must pass an interpreted assertion supported by the selected actual execution IDs');
          return { criterion, criterionSatisfied: true, expected: text(item.expected, 'expected', 500), observed: text(item.observed, 'observed', 1000), interpretation: text(item.interpretation, 'interpretation', 1000), scope: text(item.scope, 'scope', 1000), verificationIds: refs };
        });
        if (new Set(assessments.map(item => item.criterion)).size !== ids.length) throw new Error('Every criterion must be assessed exactly once');
      }
      const record = { version: 1, kind: 'review', taskId: assignment.taskId, verdict, reportId: assignment.report?.id ?? null, reportReliable: verdict === 'accepted', verificationIds, assessments, evidence: text(args.evidence, 'evidence') };
      const messageId = await send(assignment.childId, record, exec.signal);
      if (verdict === 'cancelled') ctx.subagents.interrupt(assignment.childId, { kind: 'ancestor', agent });
      return { record, messageId };
    });
  }
}
