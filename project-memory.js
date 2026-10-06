import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

export const PROJECT_MEMORY_LIMITS = Object.freeze({
  conclusion: 12000, evidence: 12000, conditions: 4000,
  history: 12, operations: 16, page: 32, incarnations: 32
});
const L = PROJECT_MEMORY_LIMITS;
const identifier = z.string().trim().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/);
const text = max => z.string().max(max);
const role = z.enum(['leader', 'worker', 'user']);
const status = z.enum(['hypothesis', 'verified', 'invalidated']);
const action = z.enum(['note', 'revise', 'confirm', 'invalidate', 'forget']);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime();
const authorSchema = z.strictObject({ memberId: identifier.nullable(), role, sessionId: identifier });
const authoritySchema = authorSchema.extend({ projectId: identifier, taskId: identifier.nullish() });
const historySchema = z.strictObject({
  revision, action, status, author: authorSchema, updatedAt: timestamp, conclusion: text(160)
});
const operationSchema = z.strictObject({
  operationId: identifier, actor: text(64), fingerprint: text(64), revision
});
const memorySchema = z.strictObject({
  id: identifier, revision, scope: z.enum(['project', 'member']), memberId: identifier.nullable(),
  conclusion: text(L.conclusion), evidence: text(L.evidence), conditions: text(L.conditions), status,
  author: authorSchema, updatedAt: timestamp,
  source: z.strictObject({ sessionId: identifier, taskId: identifier.nullable() }),
  history: z.array(historySchema).max(L.history), operations: z.array(operationSchema).max(L.operations),
  deleted: z.boolean()
}).refine(r => r.scope === 'member' ? r.memberId !== null : r.memberId === null, 'Scope/member mismatch')
  .refine(r => r.deleted ? !r.conclusion && !r.evidence && !r.conditions && !r.history.length : !!r.conclusion.trim(), 'Invalid note/tombstone')
  .refine(r => r.status !== 'verified' || !!r.evidence.trim(), 'Verified notes require evidence');
const routeSchema = z.union([
  text(512),
  z.strictObject({
    provider: identifier, model: identifier, maxTokens: z.number().int().positive().optional(),
    reasoningEffort: text(128).optional()
  })
]);
const incarnationSchema = z.strictObject({
  rootSessionId: identifier, childSessionId: identifier, nativeName: identifier.nullish().transform(v => v ?? null),
  route: routeSchema.nullish().transform(v => v ?? null),
  writeScope: z.array(text(1024)).max(64).default([])
});
const memberSchema = z.strictObject({
  memberId: identifier, description: text(1600), expertise: z.array(text(160)).max(16),
  incarnations: z.array(incarnationSchema).max(L.incarnations), updatedAt: timestamp
});
const projectSchema = z.strictObject({
  schemaVersion: z.literal(1), projectId: identifier,
  memories: z.array(memorySchema), members: z.array(memberSchema)
}).refine(p => new Set(p.memories.map(r => r.id)).size === p.memories.length, 'Duplicate memory id')
  .refine(p => new Set(p.members.map(r => r.memberId)).size === p.members.length, 'Duplicate member id');

export const projectMemoryDomain = defineDomain({
  name: 'codex_mentor_project_memory', version: 1, layout: 'single',
  tables: { projects: domainTable(projectSchema) }
});

export class ProjectMemoryError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ProjectMemoryError';
    this.code = code;
    if (detail) this.detail = detail;
  }
}
const fail = (code, message, detail) => { throw new ProjectMemoryError(code, message, detail); };
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) fail('invalid-request', result.error.issues.map(i => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
  return result.data;
}
function authority(value) {
  const a = parse(authoritySchema, value);
  if (a.role === 'worker' && !a.memberId) fail('forbidden', 'Worker authority requires a logical memberId');
  return a;
}
const stamp = a => ({ memberId: a.memberId, role: a.role, sessionId: a.sessionId });
const hash = value => createHash('sha256').update(value).digest('hex');
// A digest key also stays safe if the Host's project identity is a path/URL.
const projectKey = projectId => hash(projectId);
const visible = (r, memberId) => !r.deleted && (r.scope === 'project' || memberId === null || r.memberId === memberId);
function publicMemory(r) {
  if (r.deleted) return { id: r.id, revision: r.revision, deleted: true };
  const { operations, deleted, ...record } = r;
  return structuredClone(record);
}
function summary(r) {
  const record = publicMemory(r);
  const truncated = [];
  for (const [field, max] of [['conclusion', 600], ['evidence', 400], ['conditions', 240]]) {
    if (record[field].length > max) { record[field] = record[field].slice(0, max); truncated.push(field); }
  }
  delete record.history;
  return { ...record, truncated };
}
function memberSummary(m) {
  const last = m.incarnations.at(-1);
  return {
    memberId: m.memberId, description: m.description.slice(0, 400), expertise: m.expertise.slice(0, 8),
    updatedAt: m.updatedAt, incarnationCount: m.incarnations.length,
    lastIncarnation: last ? { rootSessionId: last.rootSessionId, childSessionId: last.childSessionId, nativeName: last.nativeName } : null
  };
}
const requestSchema = z.strictObject({
  action, id: identifier.optional(), scope: z.enum(['project', 'member']).optional(), memberId: identifier.nullable().optional(),
  conclusion: text(L.conclusion).optional(), evidence: text(L.evidence).optional(), conditions: text(L.conditions).optional(),
  status: status.optional(), expected_revision: revision.optional(), operationId: identifier.optional()
});
function request(value) {
  const r = parse(requestSchema, value);
  if (r.action === 'note') {
    if (r.id !== undefined || r.expected_revision !== undefined) fail('invalid-request', 'Notes get a Host-generated id and revision');
    if (!r.conclusion?.trim()) fail('invalid-request', 'A note requires a nonempty conclusion');
  } else {
    if (!r.id || r.expected_revision === undefined) fail('invalid-request', 'Modify/forget requires id and expected_revision');
    if (r.scope !== undefined || r.memberId !== undefined) fail('invalid-request', 'A note scope/member is immutable');
    if (r.conclusion !== undefined && !r.conclusion.trim()) fail('invalid-request', 'A conclusion cannot be empty');
    if (r.action === 'revise' && !['conclusion', 'evidence', 'conditions', 'status'].some(k => r[k] !== undefined)) fail('invalid-request', 'Revise requires a changed field');
    if (r.action !== 'revise' && (r.status !== undefined || r.conclusion !== undefined || r.conditions !== undefined)) fail('invalid-request', 'Only revise may change conclusion, conditions or status');
    if (r.action === 'forget' && r.evidence !== undefined) fail('invalid-request', 'Forget does not accept evidence');
  }
  return r;
}

/**
 * One Host owns this handle. snapshot/member getters are trusted Host surfaces:
 * pass the Host-derived worker memberId to snapshot, never a model-selected one.
 * null selects the privileged all-member view. read/mutate enforce authority.
 * No cross-project/record transaction guarantee; schema v1 fails closed on reopen.
 */
export async function openProjectMemory(storageDomain) {
  if (!storageDomain || typeof storageDomain.open !== 'function') fail('invalid-request', 'Native storageDomain is required');
  const domain = await storageDomain.open(projectMemoryDomain);
  const projects = domain.table('projects');
  const initializing = new Map();
  let closed = false;
  function getProject(projectId) {
    const p = projects.get(projectKey(projectId));
    if (p && p.projectId !== projectId) fail('invalid-record', 'Project storage key/identity mismatch');
    return p;
  }
  async function ensureProject(projectId) {
    if (closed) fail('closed', 'Project memory is closed');
    if (initializing.has(projectId)) return initializing.get(projectId);
    if (getProject(projectId)) return;
    // The facility permits only one open Host owner. Only first insertion needs
    // this local guard; every subsequent transform uses the native write chain.
    const pending = projects.put(projectKey(projectId), projectSchema.parse({ schemaVersion: 1, projectId, memories: [], members: [] }));
    initializing.set(projectId, pending);
    try { await pending; } finally { initializing.delete(projectId); }
  }
  async function updateProject(projectId, transform) {
    await ensureProject(projectId);
    return projects.update(projectKey(projectId), p => {
      if (p.projectId !== projectId) fail('invalid-record', 'Project storage key/identity mismatch');
      // rc.2 validates native domains at open, not put/update: validate commits here.
      return projectSchema.parse(transform(p));
    });
  }
  return {
    snapshot(projectId, { query = '', memberId = null, scope, offset = 0, limit = 8 } = {}) {
      projectId = parse(identifier, projectId);
      memberId = parse(identifier.nullable(), memberId);
      scope = parse(z.enum(['project', 'member']).optional(), scope);
      query = parse(text(256), query).trim().toLowerCase();
      offset = parse(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), offset);
      limit = parse(z.number().int().min(1).max(L.page), limit);
      const p = getProject(projectId);
      // ponytail: linear per-project search; add an index only at measured scale.
      const memories = (p?.memories ?? []).filter(r => visible(r, memberId) && (!scope || r.scope === scope) && (!query || `${r.conclusion}\n${r.evidence}\n${r.conditions}`.toLowerCase().includes(query)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      const members = (p?.members ?? []).filter(m => !query || `${m.memberId}\n${m.description}\n${m.expertise.join('\n')}`.toLowerCase().includes(query));
      return {
        memories: memories.slice(offset, offset + limit).map(summary), members: members.slice(0, limit).map(memberSummary),
        total: memories.length, nextOffset: offset + limit < memories.length ? offset + limit : null
      };
    },
    read(authorityValue, id) {
      const a = authority(authorityValue);
      id = parse(identifier, id);
      const r = getProject(a.projectId)?.memories.find(r => r.id === id);
      return r && visible(r, a.role === 'worker' ? a.memberId : null) ? publicMemory(r) : null;
    },
    async mutate(authorityValue, requestValue) {
      const a = authority(authorityValue), req = request(requestValue), actor = hash(JSON.stringify(stamp(a)));
      const fingerprint = hash(JSON.stringify(req));
      const id = req.action === 'note'
        ? (req.operationId ? hash(JSON.stringify([a.projectId, actor, req.operationId])) : randomUUID()) : req.id;
      let result;
      await updateProject(a.projectId, p => {
        const current = p.memories.find(r => r.id === id);
        if (current && !visible({ ...current, deleted: false }, a.role === 'worker' ? a.memberId : null)) fail('not-found', 'Memory not found');
        if (current && req.operationId) {
          const prior = current.operations.find(op => op.operationId === req.operationId && op.actor === actor);
          if (prior) {
            if (prior.fingerprint !== fingerprint) fail('operation-conflict', 'operationId was used with a different request');
            result = publicMemory(current);
            return p;
          }
        }
        if (req.action === 'note' && current) fail('operation-conflict', 'Note already exists; its idempotency receipt expired');
        if (req.action !== 'note' && !current) fail('not-found', 'Memory not found');
        if (a.role === 'worker') {
          if (req.action === 'confirm' || req.status === 'verified') fail('forbidden', 'Only leader/user can verify memory');
          if (current && (current.author.memberId !== a.memberId || current.author.role !== 'worker')) fail('forbidden', 'Workers may change only their own notes');
        }
        if (current && current.revision !== req.expected_revision) fail('revision-conflict', 'Memory revision changed', {
          id, expectedRevision: req.expected_revision, currentRevision: current.revision
        });
        if (current?.deleted) fail('not-found', 'Memory not found');
        const scope = current?.scope ?? req.scope ?? 'project';
        const memberId = current?.memberId ?? (scope === 'member' ? req.memberId ?? a.memberId : null);
        if (scope === 'member' && !memberId) fail('invalid-request', 'Member scope requires a memberId');
        if (req.action === 'note' && scope === 'project' && req.memberId != null) fail('invalid-request', 'Project notes have no target member');
        if (a.role === 'worker' && scope === 'member' && memberId !== a.memberId) fail('forbidden', 'Workers may write only their own member memory');
        const nextStatus = req.action === 'confirm' ? 'verified' : req.action === 'invalidate' || req.action === 'forget' ? 'invalidated' : req.status ?? 'hypothesis';
        const nextRevision = (current?.revision ?? 0) + 1, updatedAt = new Date().toISOString();
        let next = {
          id, revision: nextRevision, scope, memberId,
          conclusion: req.conclusion ?? current?.conclusion ?? '', evidence: req.evidence ?? current?.evidence ?? '',
          conditions: req.conditions ?? current?.conditions ?? '', status: nextStatus,
          author: current?.author ?? stamp(a), updatedAt,
          source: current?.source ?? { sessionId: a.sessionId, taskId: a.taskId ?? null },
          history: [...(current?.history ?? []), {
            revision: nextRevision, action: req.action, status: nextStatus, author: stamp(a), updatedAt,
            conclusion: (req.conclusion ?? current?.conclusion ?? '').slice(0, 160)
          }].slice(-L.history),
          operations: [...(current?.operations ?? []), ...(req.operationId ? [{ operationId: req.operationId, actor, fingerprint, revision: nextRevision }] : [])].slice(-L.operations),
          deleted: req.action === 'forget'
        };
        if (next.status === 'verified' && !next.evidence.trim()) fail('invalid-request', 'Verified memory requires nonempty evidence');
        if (next.deleted) next = { ...next, conclusion: '', evidence: '', conditions: '', history: [] };
        next = memorySchema.parse(next);
        result = publicMemory(next);
        return { ...p, memories: current ? p.memories.map(r => r.id === id ? next : r) : [...p.memories, next] };
      });
      return result;
    },
    members(projectId) {
      projectId = parse(identifier, projectId);
      return structuredClone(getProject(projectId)?.members ?? []);
    },
    getMember(projectId, memberId) {
      projectId = parse(identifier, projectId);
      memberId = parse(identifier, memberId);
      return structuredClone(getProject(projectId)?.members.find(m => m.memberId === memberId) ?? null);
    },
    async upsertMember(authorityValue, descriptor) {
      const a = authority(authorityValue);
      if (a.role === 'worker') fail('forbidden', 'Only leader/user may register reusable members');
      const d = parse(z.strictObject({
        memberId: identifier, description: text(1600).optional(),
        expertise: z.union([text(160), z.array(text(160)).max(16)]).optional(),
        incarnations: z.array(incarnationSchema).max(L.incarnations).optional()
      }), descriptor);
      let result;
      await updateProject(a.projectId, p => {
        const current = p.members.find(m => m.memberId === d.memberId);
        const references = [...(current?.incarnations ?? [])];
        for (const incarnation of d.incarnations ?? []) {
          const index = references.findIndex(i => i.rootSessionId === incarnation.rootSessionId && i.childSessionId === incarnation.childSessionId);
          if (index === -1) references.push(incarnation); else references[index] = incarnation;
        }
        result = memberSchema.parse({
          memberId: d.memberId, description: d.description ?? current?.description ?? '',
          expertise: d.expertise === undefined ? current?.expertise ?? [] : typeof d.expertise === 'string' ? [d.expertise] : d.expertise,
          // These are references only: trimming never removes a native teammate.
          incarnations: references.slice(-L.incarnations), updatedAt: new Date().toISOString()
        });
        return { ...p, members: current ? p.members.map(m => m.memberId === d.memberId ? result : m) : [...p.members, result] };
      });
      return structuredClone(result);
    },
    async close() {
      closed = true;
      await Promise.allSettled([...initializing.values()]);
      await domain.close();
    }
  };
}
