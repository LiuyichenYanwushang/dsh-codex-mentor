import z from '@deepseek-ai/schemastery';
import { z as stateZ } from 'zod';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope';
import { KEY, PRESET, TERMINAL, initial, fold, view, contextText, encode, text, choice, list, argsObject } from './ledger.js?mentor=0.7.0';
import { MENTOR, WORKER } from './prompts.js?mentor=0.7.0';
import { toolReadiness, cooperation, effectiveCapabilities, BYPASS, DIRECT_QUESTION_ID, DIRECT_LABEL, INSPECTION_TOOLS } from './experience.js?mentor=0.7.0';

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
import { reject, contractCriteria, reportCriteria, taskSummary, permissions, evidenceReuse } from './protocol.js?mentor=0.7.0';
const contractSchema = { type: 'array', items: object({ id: str('Immutable short ASCII ID, e.g. A.'), description: str('Exact bounded acceptance requirement.') }), description: '1–16 immutable criteria; omitted means one AC1 for acceptance. IDs, not titles, bind reports and assessments.' };
const resultCriteriaSchema = { type: 'array', items: { oneOf: [object({ id: str('Exact assignment criterion ID.'), status: enumeration(['PASS', 'FAIL', 'UNVERIFIED'], 'Worker claim only, never mentor acceptance.'), evidence: str('Observed result or attributed source.'), scope: str('Coverage, source date/version and what was not verified.') }), str('Legacy tasks without fixed criteria only.') ] }, description: 'For ready-review: one structured result per immutable assignment ID. Put correction history in deviations, not extra criteria.' };

export function apply(ctx, config) {
  ctx.sessionProjections.register({
    key: KEY, stateVersion: 6,
    stateSchema: stateZ.object({ sessionId: stateZ.string(), parentId: stateZ.string().nullable(), floor: stateZ.number().int().nonnegative(), tasks: stateZ.array(stateZ.any()), checkpoint: stateZ.string(), checkpointSeq: stateZ.number().int().default(-1), notes: stateZ.array(stateZ.any()), pending: stateZ.record(stateZ.string(), stateZ.string()), run: stateZ.any().nullable(), lastCompletedRun: stateZ.any().nullable(), lastInputId: stateZ.string().nullable(), recentInputIds: stateZ.array(stateZ.string()), consent: stateZ.any().nullable(), permissionCalls: stateZ.record(stateZ.string(), stateZ.boolean()), recentRecordIds: stateZ.array(stateZ.string()) }),
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
        return await ctx.llm.resolveCallConfig({ provider, model: config.workerModel, maxTokens: config.workerMaxTokens }, signal);
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
    return { version: '0.7.0', backend: ctx.get?.('agentTeams') ? 'team' : 'subagent', nativeTeams: { enabled: !!ctx.get?.('agentTeams'), modelOptionsSupported: ctx.get?.('agentTeams')?.supportsAgentOptions === true }, flashCapabilities: { contextWindow: 1000000, maxOutputTokens: 384000, configuredOutputBudget: config.workerMaxTokens }, preset: presets.find(item => item.id === PRESET) ?? null, worker, mentor: { provider: 'openai-codex', models: mentorModels.map(item => item.id), inferenceTested: false }, liveSessions: (ctx.agents.list?.() ?? []).filter(agent => ctx.agentPresets.composedPreset(agent.ctx) === PRESET).map(agent => ({ sessionId: agent.id, role: agent.session.header.origin === 'subagent' ? 'worker' : 'mentor', ...toolReadiness(agent, ctx.tools), workerRouteReady: worker.ready, initializationError: failures.get(agent.id) ?? null, cooperation: cooperation(state(agent)) })), memory: 'Session-log projection; compression cannot erase recorded task facts. Session-scoped, not a cross-project vector database.' };
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
        if (!assignment.writeScope.length && !readonlyTools.has(execution.name) && !(assignment.backend === 'team' && ['team_task_get', 'team_task_list', 'team_task_update', 'wait_agent', 'list_agents', 'send_message'].includes(execution.name))) return 'Read-only assignment: mutation and shell tools are disabled';
      }));
      owned(() => scoped.on('agent/pre-step', async (_payload, next) => {
        const decision = await next();
        if (decision.kind === 'reject') return decision;
        if (state(agent).tasks.some(item => [...TERMINAL, 'blocked', 'ready-review'].includes(item.status))) return { kind: 'enter', messages: [] };
        return { ...decision, messages: decision.messages.filter(message => message.source?.kind !== 'codex-mentor-ledger') };
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
        return assignment && (assignment.handledSettlements?.includes(message.id) || [...TERMINAL, 'blocked', 'ready-review', 'acceptance_blocked'].includes(assignment.status)) && source.summary === `Background subagent ${source.senderSessionId} finished and will do no further work unless you send it more.`;
      };
      const decision = await next();
      if (decision.kind === 'reject') return decision;
      if (payload.messages?.length && payload.messages.every(redundant)) return { kind: 'enter', messages: [] };
      return { ...decision, messages: decision.messages.filter(message => message.source?.kind !== 'codex-mentor-ledger' && !redundant(message)).map(message => {
        const source = message.source;
        const assignment = source?.kind === 'subagent-settled' && state(agent).tasks.find(item => item.childId === source.senderSessionId);
        const submitted = assignment?.report?.evidenceGate ? assignment.report : assignment?.lastSubmittedReport;
        if (submitted || assignment?.status === 'cancelled') return { ...message, content: [{ type: 'text', text: `Worker ${assignment.childId}: report ${submitted?.id ?? 'none'} ${submitted ? 'was SUBMITTED' : 'was not submitted'}; latest update=${assignment.report?.status ?? 'none'}, mentor acceptance/lifecycle=${assignment.status}. Native notice does not erase delivered reports or imply project failure: ${source.summary}${assignment.status === 'stopped' ? `; fresh/reworked work remains incomplete, manual same-session resume is mentor_resume({task_id:"${assignment.taskId}"})` : ''}` }] };
        if (assignment?.status !== 'stopped') return message;
        return { ...message, content: [{ type: 'text', text: `Worker ${assignment.childId} stopped WITHOUT a reviewable report. Task ${assignment.taskId} remains incomplete; its failure cause is unconfirmed. Native notice: ${source.summary}. To request 继续生成 in the SAME session, call mentor_resume({task_id:"${assignment.taskId}"}); check existing changes and jobs before repeating work. Delivery is not progress or acceptance. Use mentor_guide for a diagnosed repair or cancel explicitly.` }] };
      }) };
    }));
    if (!child && config.requireGptMentor) owned(() => scoped.on('agent/request', async (_payload, next) => {
      const selected = await next();
      if (selected.provider !== 'openai-codex' || !selected.model.startsWith('gpt-')) throw new Error('Codex Mentor requires a GPT model. Select your GPT model in the session model picker; other sessions/defaults were not changed.');
      return selected;
    }));
    // restrict() masks inherited tools, not an Agent's own bridge registrations.
    const teamControls = new Set(['list_agents', 'send_message', 'interrupt_agent', 'team_task_create', 'team_task_update', 'team_task_get', 'team_task_list', 'wait_agent']);
    const bypass = BYPASS.filter(name => !teamControls.has(name));
    const inheritedScope = scopeParentOf(scopeOf(agent.ctx));
    const deny = bypass.filter(tool => ctx.tools.get(tool, inheritedScope));
    if (deny.length) owned(() => scoped.tools.restrict({ deny }));
    owned(() => scoped.tools.guard(execution => bypass.includes(execution.name) || (teamControls.has(execution.name) && backend() !== 'team') ? 'Use mentor_delegate for fixed Flash members; alternate delegation is disabled in this mode' : undefined));
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
        output: { schema: { type: 'object' }, render: (_args, value) => {
          const { record, actualResult, ...rest } = value;
          const compact = record?.kind === 'verify' ? { ...rest, taskId: record.taskId, reportId: record.readyReportId, output: record.output.slice(0, 3000), outputTruncated: !!record.outputTruncated || record.output.length > 3000, fullEvidence: { task_id: record.taskId, detail: 'evidence', check_id: record.id } } : record?.kind === 'begin' ? { ...rest, runId: record.runId, mode: record.mode, taskKind: record.taskKind, backend: record.backend, route: record.route, error: record.error } : record ? { ...rest, recordId: record.id, taskId: record.taskId ?? null, kind: record.kind, ...(record.kind === 'delegated' ? { criteria: record.criteria, permissions: record.permissions, route: record.route } : {}), ...(record.kind === 'review' ? { verdict: record.verdict } : {}), ...(record.kind === 'report' ? { status: record.status } : {}) } : value;
          return [{ type: 'text', text: JSON.stringify(compact) }];
        }, presentationMeta: (_args, value) => value.record ? { codexMentor: value.record } : {} },
        finalizeContent(_exec, result) {
          if (!result.isError) return;
          try { const diagnostic = JSON.parse(result.error.message); if (diagnostic.code && diagnostic.reason && diagnostic.required_action) return [{ type: 'text', text: JSON.stringify(diagnostic) }]; } catch { /* Native policy/runtime failures keep their own renderer. */ }
        },
        async execute(args, exec) {
          if (exec.agent !== agent) throw new Error('Wrong Agent scope');
          argsObject(args, Object.keys(parameters.properties));
          try {
            const value = await execute(args, exec);
            if (['memory', 'begin', 'verify'].includes(value.record?.kind)) commit(value.record);
            return value;
          } catch (error) {
            if (toolName === 'mentor_review' && args.verdict === 'accepted' && error.diagnostic) {
              const assignment = task(args.task_id);
              commit({ version: 1, kind: 'acceptance-blocked', taskId: assignment.taskId, reportId: error.diagnostic.report_id ?? assignment.report?.id ?? null, diagnostic: error.diagnostic });
            }
            throw error;
          }
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
    function backend() {
      const own = state(agent);
      if (own.run) return own.run.backend ?? 'subagent';
      if (child && own.tasks[0]) return own.tasks[0].backend ?? 'subagent';
      return ctx.get?.('agentTeams') ? 'team' : 'subagent';
    }
    function teams() {
      const service = ctx.get?.('agentTeams');
      if (service?.supportsAgentOptions !== true) throw new Error('Native Agent Teams needs the model-options API extension; no GPT teammate or subagent fallback was started.');
      return service;
    }
    async function send(target, record, signal) {
      record.id ??= randomUUID();
      let messageId;
      const assignment = target === agent.session.header.parentSession ? state(agent).tasks[0] : state(agent).tasks.find(item => item.childId === target);
      if (assignment?.backend === 'team') {
        const recipient = target === agent.session.header.parentSession ? 'lead' : assignment.teamName;
        if (!recipient) throw new Error('No native Team member is linked to this assignment');
        const delivered = await teams().sendMessage(agent, { target: recipient, content: [{ type: 'text', text: encode(record) }], signal });
        messageId = delivered.messageId;
        record.delivery = delivered.status;
      } else {
        messageId = await ctx.subagents.sendMessage(agent, target, [{ type: 'text', text: encode(record) }], { signal });
        record.delivery = 'accepted';
      }
      commit(record);
      return messageId;
    }
    tool('mentor_status', 'Read compact task facts, latest report ID, acceptance blocker and next action. Expand only the assignment, report, evidence or history you need.', object({ task_id: str('Optional task to select. Selection alone does not expand its history.'), detail: enumeration(['summary', 'assignment', 'report', 'evidence', 'history', 'full'], 'Default summary. Use assignment after recovery; evidence with check_id retrieves one saved check.'), check_id: str('For detail=evidence: exact verification ID; omit for a short verification directory.') }, []), async args => {
      const own = state(agent), selected = args.task_id ? [task(args.task_id)] : own.tasks;
      const detail = choice(args.detail ?? 'summary', 'detail', ['summary', 'assignment', 'report', 'evidence', 'history', 'full']);
      const current = args.task_id ? selected[0] : null;
      const pageSize = 8, page = args.task_id ? selected : selected.slice(-pageSize);
      const cwd = resolve(agent.session.header.cwd ?? process.cwd());
      if (['assignment', 'report', 'evidence'].includes(detail) && !current) reject('TASK_REQUIRED', 'This expansion needs one task ID', 'Select a task from the summary directory', { field: 'task_id' });
      if (detail === 'assignment') return { taskId: current.taskId, runId: current.runId, childId: current.childId, taskKind: current.taskKind ?? own.run?.taskKind ?? 'other', goal: current.goal, writeScope: current.writeScope, permissions: permissions(current.writeScope), acceptance: current.acceptance, criteria: current.criteria ?? null, contract: current.contract ?? {}, constraints: current.constraints ?? '', route: current.route, latestGuidance: current.guidance ?? null, checkpoint: own.checkpoint, checkpointMayBeStale: own.tasks.some(item => item.seq > (own.checkpointSeq ?? -1)) };
      if (detail === 'report') return { taskId: current.taskId, report: current.report ?? null, acceptance: taskSummary(current).acceptance };
      if (detail === 'evidence') {
        const checks = current.verifications ?? [];
        if (args.check_id) { const check = checks.find(item => item.id === args.check_id); if (!check) reject('VERIFICATION_NOT_FOUND', 'No such check belongs to this task', 'Use the evidence directory IDs', { verification_id: args.check_id }); return { taskId: current.taskId, check, reuse: evidenceReuse(check, current, cwd) }; }
        return { taskId: current.taskId, checks: checks.map(check => ({ id: check.id, label: check.label, execution_status: check.execution_status ?? (check.isError ? 'failed' : 'succeeded'), reportId: check.readyReportId ?? null, reuse: evidenceReuse(check, current, cwd) })) };
      }
      if (detail === 'full') { const { activeRun, activeTasks, ...result } = view(own); return { ...result, tasks: selected }; }
      if (detail === 'history') return { lastCompletedRun: own.lastCompletedRun, lastRunCooperation: cooperation(own, own.lastCompletedRun), recentTasks: own.tasks.slice(-8).map(item => taskSummary(item, ctx.agents.get(item.childId)?.status ?? 'not-live')) };
      let workerRoute;
      try { const route = await routes(); const info = await ctx.llm.resolveModelInfo(route.provider, route.model); workerRoute = { ready: true, route, reasoning: info.reasoning ?? null }; } catch (error) { workerRoute = { ready: false, error: error.message }; }
      const service = ctx.get?.('agentTeams');
      const team = backend() === 'team' ? { ready: service?.supportsAgentOptions === true, role: service?.tryMembership(agent)?.role ?? null, meaning: 'Native completed=submitted, not independently accepted.' } : null;
      const recovery = child ? [] : selected.filter(item => item.status === 'stopped').map(item => ({ taskId: item.taskId, available: !recovering.has(item.taskId) && ctx.agents.get(item.childId)?.status !== 'running', tool: 'mentor_resume', arguments: { task_id: item.taskId }, message: '继续生成' }));
      const run = own.run ? { runId: own.run.runId, mode: own.run.mode, taskKind: own.run.taskKind, task: own.run.task, error: own.run.error } : null;
      return { sessionId: own.sessionId, role: child ? 'worker' : 'mentor', run, backend: backend(), team, capabilities: { ...toolReadiness(agent, ctx.tools), worker: workerRoute }, tasks: page.map(item => taskSummary(item, ctx.agents.get(item.childId)?.status ?? 'not-live')), taskDirectory: !args.task_id && selected.length > pageSize ? selected.map(item => ({ taskId: item.taskId, status: item.status })) : [], omittedTaskDetails: Math.max(0, selected.length - page.length), cooperation: { ...cooperation(own), outstanding: cooperation(own).outstanding.map(item => item.taskId) }, recovery, checkpoint: { text: own.checkpoint.slice(0, 1000), taskFactsMayHaveChanged: own.tasks.some(item => item.seq > (own.checkpointSeq ?? -1)), meaning: 'Decisions and hypotheses only; task facts above are authoritative.' }, expansion: { detail: ['assignment', 'report', 'evidence', 'history', 'full'], task_id: current?.taskId ?? null } };
    });
    if (!child) tool('mentor_wait', 'Yield this turn while selected Mentor workers are pending. Their formal reports or stop notices resume this session; no Agent Teams polling is needed.', object({ task_ids: strings('Tasks to await; omit for all outstanding tasks.') }, []), async (args, exec) => {
      const ids = list(args.task_ids ?? [], 'task_ids');
      const tasks = ids.length ? ids.map(task) : state(agent).tasks.filter(item => !TERMINAL.includes(item.status));
      const actionable = tasks.filter(item => [...TERMINAL, 'blocked', 'ready-review', 'acceptance_blocked', 'stopped'].includes(item.status));
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
        changes: strings('For ready-review: changed files, or [] for read-only work.'), checks: strings('For ready-review: exact commands/manual checks and actual outcomes; [] if none were run.'), criteria: resultCriteriaSchema, deviations: strings('Optional implementation choices differing from the initial approach and why.'), assumptions: strings('Optional newly introduced assumptions.'), risks: strings('For ready-review: remaining risks, or [] if none are known.')
      }, ['task_id', 'status', 'summary', 'evidence']), async (args, exec) => {
        const assignment = task(args.task_id);
        if (TERMINAL.includes(assignment.status)) throw new Error('Assignment is already closed');
        const status = choice(args.status, 'status', ['progress', 'blocked', 'ready-review']);
        const record = { version: 1, kind: 'report', taskId: assignment.taskId, childId: agent.id, status, summary: text(args.summary, 'summary', 2000), evidence: text(args.evidence, 'evidence'), attempts: status === 'blocked' ? text(args.attempts, 'attempts', 2000) : '', question: status === 'blocked' ? text(args.question, 'question', 1000) : '' };
        record.evidenceGate = status === 'ready-review' ? { changes: list(args.changes, 'changes'), checks: list(args.checks, 'checks'), criteria: reportCriteria(args.criteria, assignment.criteria ?? null), deviations: list(args.deviations ?? [], 'deviations'), assumptions: list(args.assumptions ?? [], 'assumptions'), risks: list(args.risks, 'risks') } : null;
        if (record.evidenceGate && !record.evidenceGate.criteria.length) throw new Error('Evidence Gate requires acceptance-criterion results');
        record.id = randomUUID(); encode(record); // Validate the receive limit before changing native board state.
        if (status === 'ready-review' && assignment.backend === 'team') {
          const latest = teams().getTask(agent, assignment.teamTaskId);
          if (latest.status !== 'completed') {
            if (latest.ownerName !== assignment.teamName || latest.status !== 'in_progress') throw new Error('Get and claim your linked native Team task before submitting work');
            await teams().updateTask(agent, { taskId: latest.id, expectedRevision: latest.revision, action: 'complete' });
          }
        }
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
        try { if (ctx.get?.('agentTeams')) teams(); route = await routes(exec.signal); } catch (failure) { error = failure.message; }
      }
      if (!readiness.toolsReady) error = `Missing tools: ${readiness.missing.join(', ')}`;
      const record = { version: 1, kind: 'begin', sessionId: agent.id, runId: randomUUID(), taskKind: args.task_kind ? choice(args.task_kind, 'task_kind', ['overview', 'review', 'implementation', 'audit', 'other']) : /audit|审计/i.test(args.task) ? 'audit' : /overview|概览|目前.*情况|当前.*状态/i.test(args.task) ? 'overview' : 'other', mode: error ? 'diagnostic' : mode, backend: ctx.get?.('agentTeams') ? 'team' : 'subagent', task: text(args.task, 'task', 1000), route, error, consent: mode === 'direct' ? own.consent : null };
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
    tool('mentor_verify', 'Execute an independent check and retain its result. Execution success is NOT a passed criterion; interpret it in mentor_review. Named inputs can bind file-reading evidence to its actual target and execution directory for later reuse; Shell/network/search evidence still requires the latest report.', object({ task_id: str('Task being independently checked.'), kind: enumeration(['test-execution', 'historical-log', 'static-read', 'version-check', 'other'], 'Evidence source category; default other, not a claim that a test passed.'), tool: enumeration(['read', 'read_image', 'glob', 'grep', 'bash', 'web_fetch'], 'Native inspection/check tool to execute.'), arguments: { type: 'object', additionalProperties: true, description: 'Arguments for that native tool, validated by its own schema and policy.' }, label: str('Question this execution supplies evidence for, at most 500 characters.'), input_paths: strings('Optional complete list of workspace-relative files determining this check, including configuration/data dependencies. Hashed through native shell policy before and after execution; only unchanged read-only inputs qualify for reuse.'), incremental_reason: str('For an overview after four registered checks: explain what NEW uncertainty this check resolves; do not repeat unchanged readings to debug report formatting.') }, ['task_id', 'tool', 'arguments', 'label']), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const label = text(args.label, 'label', 500), incrementalReason = args.incremental_reason ? text(args.incremental_reason, 'incremental_reason', 1000) : '';
      if ((assignment.taskKind ?? state(agent).run?.taskKind) === 'overview' && (assignment.verifications?.length ?? 0) >= 4 && !args.incremental_reason) reject('OVERVIEW_CHECK_BUDGET', 'The default overview budget is 2–4 purposeful checks; four are already registered', 'Stop once version, main entry, current blocker and source timeliness are clear, or explain the new uncertainty with incremental_reason', { task_id: assignment.taskId, registered_checks: assignment.verifications.length });
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
      const executionStatus = result.value?.kind === 'promoted' && result.value.jobId ? 'running' : result.value?.aborted ? 'cancelled' : (result.isError || (name === 'bash' && (result.value?.kind !== 'foreground' || result.value.exitCode !== 0 || result.value.timedOut))) ? 'failed' : 'succeeded';
      const isError = ['failed', 'cancelled'].includes(executionStatus), succeeded = executionStatus === 'succeeded';
      const record = { version: 1, kind: 'verify', taskId: assignment.taskId, id: randomUUID(), label, evidenceKind: args.kind ? choice(args.kind, 'kind', ['test-execution', 'historical-log', 'static-read', 'version-check', 'other']) : 'other', tool: name, arguments: args.arguments, output: JSON.stringify(result.value ?? result.error ?? null), isError, execution_status: executionStatus, executionSucceeded: succeeded, jobId: result.value?.jobId ?? null, criterionSatisfied: null, inputs: stable ? after : null, inputScope: paths, executionScope, directInput, readyReportId: ['ready-review', 'acceptance_blocked'].includes(assignment.status) ? assignment.report?.id ?? '' : '', incrementalReason };
      return { record, checkId: record.id, isError, execution_status: executionStatus, executionSucceeded: succeeded, criterionSatisfied: null, reusableInputs: stable, scopeLimit: 'Only declared file inputs were fingerprinted. Use mentor_status detail=evidence with check_id for the complete native result; execution success is not criterion satisfaction.' };
    });
    tool('mentor_delegate', 'Start a fixed-model Flash worker with a self-contained assignment and return its durable id. Runs in the background; reports can ask for tutor guidance.', object({
      name: str('Optional permanent lower-kebab-case native teammate name; generated when omitted.'), reasoning_effort: str('Required for native Teams: an advertised Flash effort id from mentor_status, or "default" to deliberately choose its model default. Optional for subagents.'),
      goal: str('Self-contained task and relevant context, at most 3000 characters.'), write_scope: strings('Workspace-relative write scope. [] disables ALL mutation and shell tools, including Git, hashes and tests; assign those checks to the mentor. No globs, absolute paths or parent traversal.'),
      required_capabilities: { type: 'array', items: enumeration(['fileRead', 'fileWrite', 'shell', 'tests', 'formalReport'], 'Required assignment capability.'), description: 'Optional execution requirements; unsupported capabilities are rejected before worker creation.' },
      acceptance: str('Overall bounded acceptance requirement, at most 2000 characters. Not parsed for IDs.'), criteria: contractSchema, constraints: str('Architectural boundaries and restrictions, at most 2000 characters.'),
      invariants: strings('Optional conditions that must never be violated.'), interfaces: strings('Optional input/output and compatibility contracts.'), failure_tests: strings('Optional boundary/failure cases to validate.'), open_questions: strings('Optional choices left to worker exploration.'), mathematical_model: str('Optional core objects, states, constraints or algorithm definitions; omit for routine tasks.')
    }, ['goal', 'write_scope', 'acceptance']), async (args, exec) => {
      if (!state(agent).run) await begin({ mode: 'collaborative', task: args.goal }, exec);
      const own = state(agent);
      if (own.run?.mode !== 'collaborative') throw new Error((own.run?.error || 'Collaboration is not ready; inspect mentor_status and disclose the blocker.') + ' No direct execution or model fallback was authorized.');
      const active = own.tasks.filter(item => !TERMINAL.includes(item.status) || ctx.agents.get(item.childId)?.status === 'running');
      if (own.run.backend !== 'team' && active.length >= config.maxConcurrentWorkers) throw new Error('Outstanding worker limit reached; guide or review existing workers first');
      if (own.tasks.length >= 64) throw new Error('Session task ledger is full (64); start a new session');
      const writeScope = list(args.write_scope, 'write_scope').map(path => {
        const normalized = path.replaceAll('\\', '/').replace(/\/$/, '');
        if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(part => !part || part === '..' || part === '.') || /[*?\[\]]/.test(normalized)) throw new Error('write_scope requires clean workspace-relative paths');
        return normalized;
      });
      const capabilities = effectiveCapabilities(writeScope);
      const required = list(args.required_capabilities ?? [], 'required_capabilities');
      if (required.some(key => capabilities[key] !== true)) throw new Error('Assignment requires unavailable capabilities: ' + required.filter(key => capabilities[key] !== true).join(', ') + '. Empty write_scope disables shell/Git/tests; allocate these checks to the mentor.');
      if (own.run.backend !== 'team' && own.run.taskKind === 'overview' && own.tasks.some(item => item.runId === own.run.runId && item.started)) throw new Error('Overview budget is one worker. Narrow the question and sample its important claims instead of duplicating its reading.');
      const overlap = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      if (active.some(item => item.writeScope.some(a => writeScope.some(b => overlap(a, b))))) throw new Error('Write scope overlaps an outstanding worker; review/cancel it or choose disjoint paths');
      const selectedBackend = own.run.backend ?? 'subagent';
      if (selectedBackend === 'team') teams();
      if (selectedBackend === 'team' && !args.reasoning_effort) throw new Error('The mentor must choose reasoning_effort for each teammate; use an advertised effort or "default".');
      let route = await routes(exec.signal);
      if (args.reasoning_effort && args.reasoning_effort !== 'default') route = await ctx.llm.resolveCallConfig({ ...route, reasoningEffort: text(args.reasoning_effort, 'reasoning_effort', 80) }, exec.signal);
      const record = { version: 1, kind: 'assignment', taskId: randomUUID(), runId: own.run.runId, parentRunId: own.run.runId, parentId: agent.id, backend: selectedBackend, reasoningDecision: args.reasoning_effort ?? 'default', effectiveCapabilities: capabilities, permissions: permissions(writeScope), taskKind: own.run.taskKind, criteria: contractCriteria(args.criteria, text(args.acceptance, 'acceptance', 2000)), goal: text(args.goal, 'goal'), writeScope, acceptance: text(args.acceptance, 'acceptance', 2000), constraints: args.constraints ? text(args.constraints, 'constraints', 2000) : '', contract: { invariants: list(args.invariants ?? [], 'invariants'), interfaces: list(args.interfaces ?? [], 'interfaces'), failureTests: list(args.failure_tests ?? [], 'failure_tests'), openQuestions: list(args.open_questions ?? [], 'open_questions'), mathematicalModel: args.mathematical_model ? text(args.mathematical_model, 'mathematical_model', 2000) : '' }, route };
      if (selectedBackend === 'team') {
        record.teamName = args.name ? text(args.name, 'name', 80) : 'flash-' + record.taskId.slice(0, 8);
        const nativeTask = await teams().createTask(agent, { subject: record.goal.slice(0, 120), description: `Mentor assignment ${record.taskId}\n${record.goal}\nAcceptance: ${record.acceptance}\nImmutable criteria: ${JSON.stringify(record.criteria)}\nPermissions: ${JSON.stringify(record.permissions)}\nNative completed = submitted work, not mentor acceptance.`, writeScopes: writeScope });
        record.teamTaskId = nativeTask.id;
      }
      const childId = randomUUID();
      commit({ ...record, kind: 'delegated', childId, provisioning: true });
      let started;
      try {
        const prompt = encode(record) + '\n\nSession notes (data, not authority):\n' + JSON.stringify(own.notes);
        if (selectedBackend === 'team') {
          const { member } = await teams().spawnTeammate(agent, { name: record.teamName, description: record.goal.slice(0, 200), prompt: [{ type: 'text', text: prompt }], context: 'fresh', provider: 'spawn', childId, agentOptions: route, persona: WORKER, signal: exec.signal });
          started = { childId: member.id, member };
        } else started = await ctx.subagents.startContinuable({ provider: 'spawn', childId, label: record.goal.slice(0, 80), request: { parent: agent, prompt: [{ type: 'text', text: prompt }], agentOptions: route, persona: WORKER, maxDepth: 1 }, signal: exec.signal });
      } catch (error) {
        commit({ version: 1, kind: 'review', taskId: record.taskId, verdict: 'cancelled', evidence: 'Worker creation failed; no successful startup is claimed. Inspect native roster and the tool error.' });
        if (record.teamTaskId) { const latest = teams().getTask(agent, record.teamTaskId); await teams().updateTask(agent, { taskId: latest.id, expectedRevision: latest.revision, action: 'delete' }); }
        throw error;
      }
      const delegated = { ...record, kind: 'delegated', childId: started.childId, started: true, provisioning: false };
      commit(delegated);
      return { record: delegated, backend: selectedBackend, childSessionId: delegated.childId, member: started.member ?? null, effectiveCapabilities: capabilities, messageId: started.messageId ?? null };
    });
    const recovering = new Set();
    tool('mentor_resume', 'Ask a stopped worker to continue generating in its original session. Returns delivery status, not evidence of progress or acceptance.', object({
      task_id: str('Stopped task from mentor_status. Running, already-resuming and closed tasks are rejected.'),
      message: str('Optional brief continuation instruction; default 继续生成. Existing scope, model and acceptance rules stay unchanged. At most 1000 characters.')
    }, ['task_id']), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Closed task cannot resume; acceptance or cancellation is not undone.');
      if (assignment.status !== 'stopped' || recovering.has(assignment.taskId) || ctx.agents.get(assignment.childId)?.status === 'running') throw new Error('Resume only a stopped, non-running worker; do not send duplicate continuation requests.');
      const message = args.message === undefined ? '继续生成' : text(args.message, 'message', 1000);
      const record = { version: 1, kind: 'guidance', taskId: assignment.taskId, reportId: assignment.report?.id ?? null, purpose: 'lifecycle-repair', recovery: { stopId: assignment.lastStop?.nativeMessageId ?? null }, diagnosis: 'The worker stopped. Its failure cause is unconfirmed; this continuation request is not a network diagnosis.', nextSteps: `${message}\nRecover the original assignment, checkpoint and latest guidance with mentor_status. Use permitted tools to check existing changes and outstanding jobs before doing more work; do not blindly repeat a write, delete unreviewed changes or start duplicate jobs. Preserve the original model, scope and constraints.`, validation: 'Report newly observed progress, a specific blocker, or a formal ready-review report. Delivery and running activity do not prove successful recovery or acceptance.', fallback: 'If the provider still fails, a job is active, or the recovery point is unsafe, report blocked with observed evidence and ask the mentor; do not retry indefinitely.' };
      recovering.add(assignment.taskId);
      try {
        if (assignment.backend === 'team') { const latest = teams().getTask(agent, assignment.teamTaskId); if (latest.status === 'completed') await teams().updateTask(agent, { taskId: latest.id, expectedRevision: latest.revision, action: 'reopen' }); }
        const messageId = await send(assignment.childId, record, exec.signal);
        return { taskId: assignment.taskId, childSessionId: assignment.childId, outcome: record.delivery === 'queued' ? 'queued' : 'requested', messageId, guidanceId: record.id, taskStatus: task(assignment.taskId).status, acceptance: 'unchanged', next: 'Wait for a fresh formal report or stop notice; delivery is not proof of progress.' };
      } catch (error) {
        if (exec.signal.aborted) throw error;
        const code = typeof error.code === 'string' && /^[A-Z0-9_-]{1,80}$/.test(error.code) ? error.code : 'RESUME_DELIVERY_FAILED';
        return { taskId: assignment.taskId, childSessionId: assignment.childId, outcome: 'failed', taskStatus: task(assignment.taskId).status, failure: { code, retryable: 'unknown', summary: 'Native continuation delivery was not confirmed. No replacement worker was created.' }, next: 'Inspect session/provider availability before another manual attempt; do not claim the task resumed.' };
      } finally { recovering.delete(assignment.taskId); }
    });
    tool('mentor_guide', 'Tutor a blocked or unfinished Flash worker and resume it. Provide a testable diagnosis, concrete next steps, validation and fallback; records guidance in both sessions.', object({
      task_id: str('Task returned by mentor_delegate.'), diagnosis: str('Evidence-based diagnosis, explicitly label hypotheses.'), next_steps: str('Specific checks/actions, at most 3000 characters.'), validation: str('Result that confirms or falsifies the advice.'), fallback: str('What to report or do if the check fails.'), purpose: enumeration(['task-guidance', 'implementation-rework', 'report-correction', 'lifecycle-repair'], 'Why the tutor is resuming this worker; recorded separately from implementation rework.')
    }, ['task_id', 'diagnosis', 'next_steps', 'validation', 'fallback']), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const record = { version: 1, kind: 'guidance', taskId: assignment.taskId, reportId: assignment.report?.id ?? null, purpose: args.purpose ? choice(args.purpose, 'purpose', ['task-guidance', 'implementation-rework', 'report-correction', 'lifecycle-repair']) : 'task-guidance', diagnosis: text(args.diagnosis, 'diagnosis', 2000), nextSteps: text(args.next_steps, 'next_steps'), validation: text(args.validation, 'validation', 2000), fallback: text(args.fallback, 'fallback', 1000) };
      if (assignment.backend === 'team') { const latest = teams().getTask(agent, assignment.teamTaskId); if (latest.status === 'completed') await teams().updateTask(agent, { taskId: latest.id, expectedRevision: latest.revision, action: 'reopen' }); }
      return { record, messageId: await send(assignment.childId, record, exec.signal) };
    });
    tool('mentor_review', 'Assess recorded execution evidence against every reported criterion, request correction, or cancel. accepted endorses the entire latest report, not selected claims; incorrect reports need rework.', object({ task_id: str('Task id.'), verdict: enumeration(['accepted', 'rework', 'cancelled', 'closed-unaccepted'], 'Acceptance decision.'), evidence: str('Interpreted evidence or specific correction/cancellation instructions.'), verification_ids: strings('For accepted: successful execution IDs. Older read-only evidence needs unchanged fingerprints of all declared inputs.'), report_reliable: { type: 'boolean', description: 'For accepted: explicitly confirm the whole final report is reliable. Do not set true when excluding errors; request a corrected report instead.' }, assessments: { type: 'array', maxItems: 16, description: 'For accepted: one explicit assertion per report criterion. Reading a failed log successfully does not make its criterion pass.', items: object({ criterion: str('Exact immutable criterion ID from mentor_status; not its title or the whole report row.'), passed: { type: 'boolean', description: 'Whether the criterion is satisfied, distinct from execution success.' }, expected: str('Required outcome.'), observed: str('Actual facts in the execution result.'), interpretation: str('Why these facts satisfy or fail the criterion.'), scope: str('Version and coverage limits; name dependencies not checked.'), verification_ids: strings('Successful execution IDs supporting this assertion.') }) } }, ['task_id', 'verdict', 'evidence']), async (args, exec) => {
      const assignment = task(args.task_id);
      if (TERMINAL.includes(assignment.status)) throw new Error('Task is already closed');
      const verdict = choice(args.verdict, 'verdict', ['accepted', 'rework', 'cancelled', 'closed-unaccepted']);
      if (verdict === 'accepted' && (!['ready-review', 'acceptance_blocked'].includes(assignment.status) || !assignment.report?.evidenceGate)) reject('REPORT_REQUIRED', 'Acceptance requires a formal submitted ready-review report', 'Request a formal report; resuming or execution success alone is insufficient', { task_id: assignment.taskId, report_id: assignment.report?.id ?? null });
      if (verdict === 'closed-unaccepted' && !assignment.report?.evidenceGate) reject('REPORT_REQUIRED', 'Closing a submission requires an existing formal report', 'Use cancelled to actively abandon work without a submission', { task_id: assignment.taskId });
      const verificationIds = list(args.verification_ids ?? [], 'verification_ids');
      let assessments = [];
      if (verdict === 'accepted') {
        const diagnostic = { task_id: assignment.taskId, report_id: assignment.report.id };
        if (args.report_reliable !== true) reject('REPORT_RELIABILITY_UNCONFIRMED', 'The mentor has not confirmed this whole bounded report is reliable', 'Correct factual errors or coverage limits first, then set report_reliable to boolean true', { ...diagnostic, field: 'report_reliable' });
        const criteria = reportCriteria(assignment.report.evidenceGate.criteria, assignment.criteria ?? null), ids = criteria.map(item => item.id);
        const unpassed = criteria.find(item => item.status !== 'PASS');
        if (unpassed) reject('CRITERION_NOT_PASSED', `Worker criterion status is ${unpassed.status}; passed=true in an assessment does not replace the report status`, 'Correct only this result or use an explicit scoped UNVERIFIED report; do not rerun unrelated checks merely to change wording', { ...diagnostic, criterion_id: unpassed.id, worker_status: unpassed.status });
        if (!Array.isArray(args.assessments)) reject('ASSESSMENTS_REQUIRED', 'No per-criterion mentor assertions were supplied', 'Assess each immutable criterion ID exactly once', { ...diagnostic, expected_ids: ids });
        const seen = new Set();
        assessments = args.assessments.map(item => {
          argsObject(item, ['criterion', 'passed', 'expected', 'observed', 'interpretation', 'scope', 'verification_ids']);
          const criterion = text(item.criterion, 'criterion', 500), refs = list(item.verification_ids, 'verification_ids');
          if (!ids.includes(criterion)) reject('ASSESSMENT_UNKNOWN', 'The assessment ID does not match an assigned/report ID; do not paste the whole titled result', 'Use the exact ID from mentor_status', { ...diagnostic, criterion_id: criterion, expected_ids: ids });
          if (seen.has(criterion)) reject('ASSESSMENT_DUPLICATE', 'This criterion was assessed twice', 'Return one assessment for this ID', { ...diagnostic, criterion_id: criterion });
          seen.add(criterion);
          if (item.passed !== true) reject('CRITERION_ASSERTION_FAILED', 'The mentor did not conclude this criterion is satisfied', 'Request targeted rework; successful execution alone does not imply a passed criterion', { ...diagnostic, criterion_id: criterion });
          if (!refs.length) reject('CRITERION_EVIDENCE_MISSING', 'The assertion has no independent execution references', 'Reference actual successful checks supporting this specific bounded claim', { ...diagnostic, criterion_id: criterion });
          for (const id of refs) if (!verificationIds.includes(id)) reject('VERIFICATION_NOT_SELECTED', 'An assessment references a check omitted from verification_ids', 'Select this same check ID or correct the reference', { ...diagnostic, criterion_id: criterion, verification_id: id });
          const field = (key, max) => { try { return text(item[key], key, max); } catch { reject('ASSESSMENT_FIELD_INVALID', `${key} is missing, empty or too long`, 'Fill the interpreted outcome and exact coverage', { ...diagnostic, criterion_id: criterion, field: key }); } };
          return { criterion, criterionSatisfied: true, expected: field('expected', 500), observed: field('observed', 1000), interpretation: field('interpretation', 1000), scope: field('scope', 1000), verificationIds: refs };
        });
        const missing = ids.filter(id => !seen.has(id));
        if (missing.length) reject('ASSESSMENT_MISSING', 'Some criterion IDs have no mentor assessment', 'Assess these IDs; do not expand the report or recheck unrelated claims', { ...diagnostic, criterion_id: missing[0], missing_ids: missing });
        if (!verificationIds.length) reject('VERIFICATION_REQUIRED', 'There are no actual independent checks', 'Execute an appropriate mentor_verify check before acceptance', diagnostic);
        const cwd = resolve(agent.session.header.cwd ?? process.cwd());
        for (const id of verificationIds) {
          const check = assignment.verifications?.find(item => item.id === id), assertion = assessments.find(item => item.verificationIds.includes(id));
          const located = { ...diagnostic, verification_id: id, ...(assertion ? { criterion_id: assertion.criterion } : {}) };
          if (!check) reject('VERIFICATION_NOT_FOUND', 'This check is not recorded for this task', 'Use an ID from this task evidence directory', located);
          const reuse = evidenceReuse(check, assignment, cwd);
          if (reuse.reusable === false) reject(reuse.code, reuse.reason ?? 'Execution must finish successfully before it can support acceptance', reuse.required_action, located);
          if (reuse.reusable === null) {
            if (!check.inputScope.some(path => resolve(cwd, path) === check.directInput)) reject('EVIDENCE_INPUT_MISMATCH', 'Declared inputs do not include the file actually read', 'Run a fresh check with complete correct input_paths', located);
            let current;
            try { current = await fingerprint(check.inputScope, exec); } catch { reject('INPUT_FINGERPRINT_FAILED', 'Input fingerprints could not be rechecked under the native policy', 'Fix the fingerprint check or run fresh evidence against this report', located); }
            if (JSON.stringify(current) !== JSON.stringify(check.inputs)) reject('INPUTS_CHANGED', 'An acceptance input changed after the old check', 'Run fresh evidence against the latest report', located);
          }
        }
        if (task(assignment.taskId).report?.id !== assignment.report.id) reject('REPORT_CHANGED_DURING_REVIEW', 'A newer report arrived while inputs were being checked', 'Review the new report and its matching evidence', { ...diagnostic, current_report_id: task(assignment.taskId).report?.id ?? null });
      }
      const record = { version: 1, kind: 'review', taskId: assignment.taskId, verdict, reportId: assignment.report?.id ?? null, reportReliable: verdict === 'accepted', verificationIds, assessments, evidence: text(args.evidence, 'evidence') };
      if (assignment.backend === 'team') {
        const latest = teams().getTask(agent, assignment.teamTaskId);
        if (verdict === 'accepted' && latest.status !== 'completed') reject('TEAM_WORK_NOT_SUBMITTED', 'The linked native task is not completed/submitted', 'Have the worker submit the native task; completed is still not independent mentor acceptance', { task_id: assignment.taskId, team_task_id: assignment.teamTaskId });
        if (verdict === 'rework' && latest.status === 'completed') await teams().updateTask(agent, { taskId: latest.id, expectedRevision: latest.revision, action: 'reopen' });
        if (verdict === 'cancelled' && latest.status !== 'deleted') await teams().updateTask(agent, { taskId: latest.id, expectedRevision: latest.revision, action: 'delete' });
      }
      const messageId = await send(assignment.childId, record, exec.signal);
      if (['cancelled', 'closed-unaccepted'].includes(verdict)) ctx.subagents.interrupt(assignment.childId, { kind: 'ancestor', agent });
      return { record, messageId };
    });
  }
}
