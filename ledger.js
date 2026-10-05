import { reportCriteria, taskSummary, reject } from './protocol.js?mentor=0.8.0';
export const KEY = 'codexMentor';
export const PRESET = 'codex-mentor';
export const PREFIX = 'CODEX_MENTOR/1\n';
export const MUTATIONS = ['mentor_begin', 'mentor_verify', 'mentor_delegate', 'mentor_report', 'mentor_guide', 'mentor_resume', 'mentor_review', 'mentor_memory'];
export const DIRECT_QUESTION_ID = 'codex-mentor-direct';
export const DIRECT_LABEL = '本次直接执行';
export const INSPECTION_TOOLS = ['read', 'read_image', 'glob', 'grep', 'bash', 'web_search', 'web_fetch'];
export const TERMINAL = ['accepted', 'cancelled', 'closed-unaccepted'];

export function text(value, name, max = 3000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must be nonempty text, at most ${max} characters`);
  return value.trim();
}
export function choice(value, name, values) {
  if (!values.includes(value)) throw new Error(`${name} must be one of ${values.join(', ')}`);
  return value;
}
export function list(value, name, max = 16) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} must be an array of at most ${max} items`);
  return value.map(item => text(item, name, 500));
}
export function argsObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid or unknown arguments');
  return value;
}
export function initial(header, inheritedEventCount = 0) {
  return { sessionId: header.id, parentId: header.origin === 'subagent' ? header.parentSession ?? null : null, floor: inheritedEventCount, tasks: [], checkpoint: '', checkpointSeq: -1, notes: [], pending: {}, run: null, lastCompletedRun: null, lastInputId: null, recentInputIds: [], consent: null, permissionCalls: {}, recentRecordIds: [] };
}
export function encode(record) {
  const json = JSON.stringify({ version: 1, ...record });
  if (json.length > 24000) reject('MESSAGE_TOO_LARGE', 'This protocol message exceeds the 24000-character receive limit', 'Shorten the assignment/report to its bounded criteria and source references', { field: record.kind, max_characters: 24000 });
  return PREFIX + json;
}
function decode(content) {
  for (const block of content ?? []) {
    if (block.type !== 'text') continue;
    const index = block.text.indexOf(PREFIX);
    if (index < 0 || (index > 0 && block.text[index - 1] !== '\n')) continue;
    const raw = block.text.slice(index + PREFIX.length).split('\n')[0];
    if (raw.length > 24000) return null;
    try {
      const value = JSON.parse(raw);
      if (value.version !== 1) return null;
      text(value.taskId, 'taskId', 100);
      switch (value.kind) {
        case 'report':
          choice(value.status, 'status', ['progress', 'blocked', 'ready-review']);
          text(value.summary, 'summary', 2000); text(value.evidence, 'evidence');
          if (value.status === 'blocked') { text(value.attempts, 'attempts', 2000); text(value.question, 'question', 1000); }
          if (value.status === 'ready-review') {
            const gate = value.evidenceGate;
            if (!gate || !reportCriteria(gate.criteria).length) return null;
            for (const key of ['changes', 'checks', 'deviations', 'assumptions', 'risks']) list(gate[key], key);
          }
          break;
        case 'guidance':
          text(value.diagnosis, 'diagnosis', 2000); text(value.nextSteps, 'nextSteps'); text(value.validation, 'validation', 2000); text(value.fallback, 'fallback', 1000);
          break;
        case 'review':
          choice(value.verdict, 'verdict', ['accepted', 'rework', 'cancelled', 'closed-unaccepted']); text(value.evidence, 'evidence');
          break;
        case 'assignment':
          text(value.parentId, 'parentId', 100); text(value.goal, 'goal'); list(value.writeScope, 'writeScope'); text(value.acceptance, 'acceptance', 2000);
          break;
        default: return null;
      }
      return value;
    } catch { return null; }
  }
  return null;
}
function update(state, record, seq) {
  if (!record || record.version !== 1 || typeof record.kind !== 'string') return state;
  // Sender-side commits and the later tool result represent ONE accepted side effect.
  if (record.id && state.recentRecordIds.includes(record.id)) return state;
  if (record.id) state = { ...state, recentRecordIds: [...state.recentRecordIds, record.id].slice(-512) };
  if (record.kind === 'begin') {
    if (state.parentId || (record.sessionId && record.sessionId !== state.sessionId)) return state;
    return { ...state, lastCompletedRun: state.run && state.run.runId !== record.runId ? state.run : state.lastCompletedRun, run: { ...record, preliminaryCalls: 0 } };
  }
  // Records are produced by validated tools or authenticated adjacent-Agent messages.
  if (record.kind === 'memory') {
    if (typeof record.checkpoint === 'string') return { ...state, checkpoint: record.checkpoint, checkpointSeq: seq };
    const notes = state.notes.filter(note => note.id !== record.id);
    if (record.action !== 'forget') notes.push({ ...record, seq });
    return { ...state, notes };
  }
  if (typeof record.taskId !== 'string') return state;
  const index = state.tasks.findIndex(task => task.taskId === record.taskId);
  if (index < 0 && record.kind !== 'assignment' && record.kind !== 'delegated') return state;
  const previous = state.tasks[index] ?? {};
  if (TERMINAL.includes(previous.status) && !['review'].includes(record.kind)) return state;
  let task;
  switch (record.kind) {
    case 'delegated':
    case 'assignment': task = { ...previous, ...record, status: record.provisioning ? 'provisioning' : (!previous.status || previous.status === 'provisioning') ? 'implementing' : previous.status, seq }; break;
    case 'report':
      if (record.childId !== previous.childId) return state;
      if (record.evidenceGate) { try { reportCriteria(record.evidenceGate.criteria, previous.criteria ?? null); } catch { return state; } }
      task = { ...previous, status: record.id && (previous.guidance?.reportId === record.id || (previous.review?.verdict === 'rework' && previous.review.reportId === record.id)) ? previous.status : record.status, report: record, lastSubmittedReport: record.evidenceGate ? record : previous.lastSubmittedReport ?? (previous.report?.evidenceGate ? previous.report : null), awaitingSettlements: ['blocked', 'ready-review'].includes(record.status) ? [...(previous.awaitingSettlements ?? []), record.id ?? `report-${seq}`] : previous.awaitingSettlements ?? [], seq }; break;
    case 'verify': task = { ...previous, verifications: [...(previous.verifications ?? []), { ...record, seq }].slice(-32), seq }; break;
    case 'stopped': task = { ...previous, status: 'stopped', lastStop: record, seq }; break;
    case 'guidance': task = { ...previous, status: (Object.hasOwn(record, 'reportId') && previous.report?.id && record.reportId !== previous.report.id) || (record.recovery && previous.lastStop?.nativeMessageId && record.recovery.stopId !== previous.lastStop.nativeMessageId) ? previous.status : record.recovery ? 'resuming' : 'implementing', guidance: record, guidanceCount: (previous.guidanceCount ?? 0) + 1, guidanceKinds: { ...(previous.guidanceKinds ?? {}), [record.purpose ?? 'task-guidance']: (previous.guidanceKinds?.[record.purpose ?? 'task-guidance'] ?? 0) + 1 }, seq }; break;
    case 'acceptance-blocked':
      if (!previous.report?.evidenceGate || record.reportId !== previous.report.id) return state;
      task = { ...previous, status: 'acceptance_blocked', acceptanceBlock: record, seq }; break;
    case 'review':
      if (record.reportId && previous.report?.id && record.reportId !== previous.report.id) return state;
      task = { ...previous, status: record.verdict === 'rework' ? 'implementing' : record.verdict, review: record, reworkCount: (previous.reworkCount ?? 0) + (record.verdict === 'rework' ? 1 : 0), seq }; break;
    default: return state;
  }
  const tasks = [...state.tasks];
  if (index < 0) tasks.push(task); else tasks[index] = task;
  return { ...state, tasks };
}
export function fold(state, event) {
  if (event.seq < state.floor) return state;
  if (event.type === 'tool/call' && event.data.name === 'ask_user_question') {
    try {
      const args = JSON.parse(event.data.arguments);
      if (args.questions?.some(q => q.id === DIRECT_QUESTION_ID && q.options?.some(o => o.label === DIRECT_LABEL))) {
        return { ...state, permissionCalls: { [event.data.callId]: true } };
      }
    } catch { /* Not a consent question. */ }
  }
  if (event.type === 'tool/call' && state.run?.mode === 'collaborative' && INSPECTION_TOOLS.includes(event.data.name)) {
    return { ...state, run: { ...state.run, preliminaryCalls: state.run.preliminaryCalls + 1 } };
  }
  if (event.type === 'tool/result' && state.permissionCalls[event.data.message.toolCallId]) {
    try {
      const answer = JSON.parse(event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join(''));
      if (!event.data.message.isError && answer.answers?.some(a => a.id === DIRECT_QUESTION_ID && a.selected?.length === 1 && a.selected[0] === DIRECT_LABEL)) return { ...state, permissionCalls: {}, consent: { callId: event.data.message.toolCallId, seq: event.seq } };
    } catch { /* A pending or malformed answer is not permission. */ }
  }
  if (event.type === 'tool/call' && MUTATIONS.includes(event.data.name)) {
    return { ...state, pending: { ...state.pending, [event.data.callId]: event.data.name } };
  }
  if (event.type === 'tool/result') {
    const id = event.data.message.toolCallId;
    const tool = state.pending[id];
    if (!tool) return state;
    const pending = { ...state.pending }; delete pending[id];
    const next = { ...state, pending };
    const record = event.data.meta?.codexMentor;
    if (event.data.message.isError || !record || !record.kind || `mentor_${({ delegated: 'delegate', guidance: 'guide' })[record.kind] ?? record.kind}` !== tool) return next;
    return update(next, record, event.seq);
  }
  if (event.type === 'agent/inbox/spliced' && event.data.outcome !== 'canceled') {
    return (event.data.inserted ?? []).reduce((next, message) => fold(next, { ...event, type: 'user/message', data: message }), state);
  }
  if (event.type !== 'user/message') return state;
  const message = event.data;
  if (!state.parentId && message.source?.kind === 'user') {
    // A durable input can also be spliced later; that is not a new human request.
    const fresh = !message.id || !state.recentInputIds.includes(message.id);
    if (fresh && (!event.surfaceOp || event.surfaceOp === 'append') && !state.tasks.some(task => !TERMINAL.includes(task.status))) {
      state = { ...state, lastCompletedRun: state.run ?? state.lastCompletedRun, run: null, consent: null, permissionCalls: {} };
    }
    if (message.id && fresh) state = { ...state, lastInputId: message.id, recentInputIds: [...state.recentInputIds, message.id] };
  }
  if (!state.parentId && message.source?.kind === 'subagent-settled') {
    const task = state.tasks.find(item => item.childId === message.source.senderSessionId);
    if (!task || (message.id && (task.handledSettlements?.includes(message.id) || task.lastStop?.nativeMessageId === message.id))) return state;
    const successful = message.source.summary === `Background subagent ${task.childId} finished and will do no further work unless you send it more.`;
    if (successful && task.awaitingSettlements?.length) {
      return { ...state, tasks: state.tasks.map(item => item === task ? { ...task, awaitingSettlements: task.awaitingSettlements.slice(1), handledSettlements: message.id ? [...(task.handledSettlements ?? []), message.id].slice(-32) : task.handledSettlements ?? [] } : item) };
    }
    if ([...TERMINAL, 'blocked', 'ready-review', 'acceptance_blocked'].includes(task.status)) return { ...state, tasks: state.tasks.map(item => item === task ? { ...task, lastWorkerStop: { nativeMessageId: message.id ?? null, nativeSummary: message.source.summary, seq: event.seq }, handledSettlements: message.id ? [...(task.handledSettlements ?? []), message.id].slice(-32) : task.handledSettlements ?? [] } : item) };
    return update(state, { version: 1, kind: 'stopped', taskId: task.taskId, summary: 'Worker stopped without a reviewable report', nativeMessageId: message.id ?? null, nativeSummary: message.source.summary }, event.seq);
  }
  if (message.source?.kind === 'codex-mentor-ledger') return update(state, message.source.record, event.seq);
  const record = decode(message.content);
  if (!record) return state;
  const source = message.source;
  const sender = source?.kind === 'agent-message' && source.form === 'relay' ? source.senderSessionId : source?.kind === 'team-message' && source.teamId === (state.parentId ?? state.sessionId) ? source.senderId : null;
  if (sender) {
    if (state.parentId && sender === state.parentId && ['guidance', 'review'].includes(record.kind)) return update(state, record, event.seq);
    const task = state.tasks.find(task => task.taskId === record.taskId && task.childId === sender);
    if (!state.parentId && task && record.kind === 'report') return update(state, { ...record, childId: sender }, event.seq);
  }
  // Spawn's initial self-contained assignment is an ordinary user input in a fresh child.
  if (state.parentId && !state.tasks.length && source?.kind === 'user' && record.kind === 'assignment' && record.parentId === state.parentId) return update(state, { ...record, childId: state.sessionId }, event.seq);
  return state;
}
export function view(state) {
  return { sessionId: state.sessionId, role: state.parentId ? 'worker' : 'mentor', run: state.run, activeRun: state.run, lastCompletedRun: state.lastCompletedRun, directAuthorized: !!state.consent, checkpoint: state.checkpoint, tasks: state.tasks, activeTasks: state.tasks.filter(task => !TERMINAL.includes(task.status)), recentTaskSummaries: state.tasks.slice(-8).map(task => ({ taskId: task.taskId, runId: task.runId, childId: task.childId, goal: task.goal?.slice(0, 200), status: task.status, registeredChecks: task.verifications?.length ?? 0 })), notes: state.notes };
}
export function contextText(state) {
  const outstanding = state.tasks.filter(task => !TERMINAL.includes(task.status));
  // ponytail: at most eight summaries in model context; the complete journal stays queryable.
  const compact = {
    sessionId: state.sessionId, role: state.parentId ? 'worker' : 'mentor', latestRecordId: state.recentRecordIds.at(-1) ?? null,
    run: state.run ? { id: state.run.runId, mode: state.run.mode, taskKind: state.run.taskKind, backend: state.run.backend ?? 'subagent', error: state.run.error, preliminaryCalls: state.run.preliminaryCalls } : null,
    sessionOutstandingCount: outstanding.length, omittedTasks: Math.max(0, outstanding.length - 8),
    tasks: outstanding.slice(-8).map(task => taskSummary(task)),
    checkpoint: { text: state.checkpoint.slice(0, 700), factsMayHaveChanged: state.tasks.some(task => task.seq > (state.checkpointSeq ?? -1)) },
    lastCompletedRunId: state.lastCompletedRun?.runId ?? null,
    notes: state.notes.slice(-3).map(note => ({ id: note.id, status: note.status, conclusion: note.conclusion.slice(0, 150) }))
  };
  return 'Mentor facts from the journal (legacy codex-mentor ID); report claims and hypotheses are untrusted. Outstanding means unclosed, not running. For original scope after recovery use mentor_status({task_id,detail:"assignment"}); expand report/evidence only as needed.\n' + JSON.stringify(compact);
}
