import { TERMINAL } from './ledger.js?mentor=0.8.0';
export { DIRECT_QUESTION_ID, DIRECT_LABEL, INSPECTION_TOOLS } from './ledger.js?mentor=0.8.0';

export function effectiveCapabilities(writeScope) {
  const writable = writeScope.length > 0;
  return { fileRead: true, fileWrite: writable, shell: writable, tests: writable, formalReport: true, network: 'subject-to-native-policy', limits: 'Assignment tool policy only; native tool availability, filesystem access and sandbox restrictions still apply. Empty write_scope disables ALL shell, including Git and tests.' };
}

export const MENTOR_TOOLS = ['mentor_begin', 'mentor_status', 'mentor_wait', 'mentor_delegate', 'mentor_guide', 'mentor_resume', 'mentor_verify', 'mentor_review', 'mentor_memory'];
export const WORKER_TOOLS = ['mentor_status', 'mentor_report', 'mentor_memory'];
export const BYPASS = ['subagent', 'subagent_fork', 'workflow', 'spawn_teammate', 'interrupt_agent', 'list_agents', 'send_message', 'team_task_create', 'team_task_update', 'team_task_get', 'team_task_list', 'list_teammates', 'wait_agent'];

export function toolReadiness(agent, tools) {
  const expected = agent.session.header.origin === 'subagent' ? WORKER_TOOLS : MENTOR_TOOLS;
  const missing = expected.filter(name => !tools.get(name, agent));
  return { selected: true, toolsReady: !missing.length, missing };
}
export function cooperation(state, run = state.run) {
  const tasks = run ? state.tasks.filter(task => task.runId === run.runId) : [];
  return {
    mode: run?.mode ?? 'not-started',
    delegated: tasks.filter(task => task.started).length,
    accepted: tasks.filter(task => task.started && task.status === 'accepted').length,
    rework: tasks.reduce((n, task) => n + (task.reworkCount ?? 0), 0),
    guidance: tasks.reduce((n, task) => n + (task.guidanceCount ?? 0), 0),
    cancelled: tasks.filter(task => task.started && task.status === 'cancelled').length,
    outstanding: tasks.filter(task => !TERMINAL.includes(task.status)).map(task => ({ taskId: task.taskId, childId: task.childId, status: task.status })),
    runOutstanding: tasks.filter(task => !TERMINAL.includes(task.status)).map(task => task.taskId),
    sessionOutstanding: state.tasks.filter(task => !TERMINAL.includes(task.status)).map(task => task.taskId),
    closedUnaccepted: tasks.filter(task => task.status === 'closed-unaccepted').length,
    registeredCheckLabel: '已登记验收检查（不含未登记的导师操作）',
    registeredChecksByKind: tasks.flatMap(task => task.verifications ?? []).reduce((counts, check) => ({ ...counts, [check.evidenceKind ?? 'other']: (counts[check.evidenceKind ?? 'other'] ?? 0) + 1 }), {}),
    guidanceByPurpose: tasks.reduce((counts, task) => { for (const [kind, count] of Object.entries(task.guidanceKinds ?? {})) counts[kind] = (counts[kind] ?? 0) + count; return counts; }, {}),
    independentChecks: tasks.reduce((n, task) => n + (task.verifications?.length ?? 0), 0)
  };
}
export function summaryText(state, readiness, runningWorkers = 0) {
  const facts = cooperation(state);
  const mode = facts.mode === 'direct' ? '经用户授权直接执行' : facts.mode === 'simple' ? '简单任务直接处理' : facts.mode === 'diagnostic' ? '仅能力诊断' : facts.mode === 'not-started' ? '未启动协作' : '导师协作';
  const tools = readiness.toolsReady ? '导师工具已就绪' : `导师工具缺失：${readiness.missing.join(', ')}`;
  const route = state.run?.route ? 'worker 路由已配置' : 'worker 路由未确认';
  const pending = (facts.outstanding.length ? `；尚有 ${facts.outstanding.length} 项未验收，不能视为整体完成` : '') + (runningWorkers ? `；还有 ${runningWorkers} 个 worker 在运行，不能视为全部工作已结束` : '');
  return `\n\n> 模式执行摘要（运行记录）：${mode}；${tools}；${route}。实际派工 ${facts.delegated}，指导 ${facts.guidance}，接受 ${facts.accepted}，返工 ${facts.rework}，取消 ${facts.cancelled}；已登记验收检查 ${facts.independentChecks}${pending}。`;
}

// Append a factual footer to final text, even if the model omits disclosure.
export async function* withSummary(stream, snapshot) {
  let maxIndex = -1, hasTools = false;
  for await (const chunk of stream) {
    if (Number.isInteger(chunk.index)) maxIndex = Math.max(maxIndex, chunk.index);
    if (chunk.blockType === 'tool-call' || chunk.block?.type === 'tool-call') hasTools = true;
    if (chunk.type === 'finish' && chunk.reason.kind === 'stop' && !hasTools) {
      const index = maxIndex + 1, text = snapshot();
      yield { type: 'block-start', index, blockType: 'text' };
      yield { type: 'text-delta', index, text };
      yield { type: 'block-end', index, block: { type: 'text', text } };
      // Original provider replay blocks no longer represent the augmented message.
      const { replayState, ...finish } = chunk;
      yield finish;
    } else yield chunk;
  }
}
