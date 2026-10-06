import z from '@deepseek-ai/schemastery';

export const name = 'codex-mentor-count-quota-migration';
export const inject = ['configEditor', 'agents'];
export const Config = z.object({ applied: z.boolean().default(false) });
const fields = [['subagent', ['maxActiveSubagents']], ['agent-team', ['maxMembers', 'maxTasks']]];

// One-time operator-requested migration: bundle defaults cannot override profile-owned quotas.
// Ordinary config edits may reload services, so never do this around resident child agents.
export async function removeProfileCountQuotas(ctx, ownId) {
  const editor = ctx.configEditor;
  const residentChildren = () => ctx.agents.list().some(agent => agent.session.header.origin === 'subagent');
  const find = id => editor.entries().find(entry => entry.options.id === id);
  for (const [id, keys] of fields) {
    const entry = find(id);
    if (!entry) {
      if (id === 'agent-team' && !ctx.get('agentTeams')) continue; // Do not enable absent Teams.
      throw new Error(`Count quota migration cannot find the active ${id} entry`);
    }
    if (keys.every(key => entry.options.config?.[key] === Number.MAX_SAFE_INTEGER)) continue;
    if (residentChildren()) throw new Error('Count quotas remain pending: resident child agents must not be reloaded; restart before retrying');
    await editor.edit(entry, current => ({ ...current, ...Object.fromEntries(keys.map(key => [key, Number.MAX_SAFE_INTEGER])) }));
    if (!keys.every(key => find(id)?.options.config?.[key] === Number.MAX_SAFE_INTEGER)) throw new Error(`A higher-priority layer still limits ${id}; migration was not completed`);
  }
  const own = find(ownId);
  if (!own) throw new Error('Count quota migration cannot persist its completion marker');
  await editor.edit(own, current => ({ ...current, applied: true }));
}

export function apply(ctx, config) {
  if (config.applied) return;
  const ready = ctx.get('appReady');
  if (!ready) throw new Error('Count quota migration requires launcher readiness; it does not reload a running application');
  const ownId = ctx.fiber.entry.options.id;
  ctx.effect(() => {
    let closed = false;
    const off = ready.onReady(() => {
      if (!closed) void removeProfileCountQuotas(ctx, ownId).catch(error => ctx.logger.error(`Count quota migration pending: ${error.message}`));
    });
    return () => { closed = true; off(); };
  });
}
