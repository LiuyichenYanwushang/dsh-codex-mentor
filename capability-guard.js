import { toolReadiness } from './experience.js';

export const name = 'codex-mentor-capability-guard';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx) {
  ctx.tools.guard(exec => {
    if (!exec.agent || exec.name.startsWith('mentor_') || exec.name === 'ask_user_question') return;
    const status = toolReadiness(exec.agent, ctx.tools);
    if (!status.toolsReady) return `Codex Mentor is selected but tools are missing: ${status.missing.join(', ')}. Only diagnosis or asking the user is allowed; do not silently execute the task.`;
  });
  ctx.systemPrompt.context({ name: 'codex-mentor:capabilities', order: 840, text: ({ agent }) => {
    if (!agent) return '';
    const status = toolReadiness(agent, ctx.tools);
    return `Codex Mentor capability state: ${JSON.stringify(status)}. Selection is not readiness or worker startup. If tools are missing, disclose what cannot run BEFORE working; ask whether to repair, explicitly switch to direct execution, or only diagnose. Native Agent Teams is valid only through the ready Mentor integration; never substitute untracked teammates for missing Mentor tools.`;
  } });
}
