import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

export const DISCUSSION_LIMITS = Object.freeze({ participants: 16, maxRounds: 8, topic: 1000, text: 2000, conclusion: 2000, summaryItems: 8, summaryText: 500, page: 8 });
const L = DISCUSSION_LIMITS;
const identity = z.string().min(1).max(200);
const memberSchema = z.object({ nativeName: identity, memberId: identity, sessionId: identity }).strict();
const notificationSchema = z.object({ id: identity, target: identity, kind: z.enum(['invite', 'post', 'round', 'closed']), round: z.number().int().min(1).max(L.maxRounds), status: z.enum(['pending', 'queued', 'failed']), messageId: identity.optional(), error: z.string().min(1).max(500).optional() }).strict();
const roomSchema = z.object({
  id: identity, revision: z.number().int().min(1), projectId: identity, rootSessionId: identity,
  topic: z.string().min(1).max(L.topic), participants: z.array(identity).min(1).max(L.participants),
  round: z.number().int().min(1).max(L.maxRounds), maxRounds: z.number().int().min(1).max(L.maxRounds), status: z.enum(['open', 'closed']),
  posts: z.array(z.object({ id: identity, memberId: identity, author: identity, round: z.number().int().min(1).max(L.maxRounds), text: z.string().min(1).max(L.text), source: identity, time: z.iso.datetime() }).strict()).max(L.participants * L.maxRounds),
  conclusion: z.string().max(L.conclusion), dissent: z.array(z.string().min(1).max(L.summaryText)).max(L.summaryItems), nextSteps: z.array(z.string().min(1).max(L.summaryText)).max(L.summaryItems),
  notifications: z.array(notificationSchema).max(L.participants * (2 * L.maxRounds + 1)),
  members: z.array(memberSchema).min(1).max(L.participants), leader: memberSchema,
  operations: z.array(z.object({ id: identity, actor: identity, action: z.enum(['create', 'post', 'advance', 'close']), fingerprint: identity }).strict()).max(2 + L.participants * L.maxRounds + L.maxRounds - 1),
  skipped: z.array(z.object({ round: z.number().int().min(1).max(L.maxRounds), participants: z.array(identity).max(L.participants), reason: z.string().min(1).max(500) }).strict()).max(L.maxRounds - 1),
}).strict();
const spec = defineDomain({ name: 'codex_mentor_discussions', version: 1, layout: 'per-record', tables: { rooms: domainTable(roomSchema) } });

function fail(code, message, detail) { throw Object.assign(new Error(message), { code, ...(detail ? { detail } : {}) }); }
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_REQUEST', 'Invalid or unknown discussion arguments');
  return value;
}
function text(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_REQUEST', `${field} must be nonempty text, at most ${max} characters`);
  return value.trim();
}
function number(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_REQUEST', `${field} must be an integer between ${min} and ${max}`);
  return value;
}
function summaries(value, field) {
  if (!Array.isArray(value) || value.length > L.summaryItems) fail('INVALID_REQUEST', `${field} must contain at most ${L.summaryItems} items`);
  return value.map(item => text(item, field, L.summaryText));
}
function authorityOf(value) {
  object(value, ['projectId', 'rootSessionId', 'sessionId', 'memberId', 'nativeName', 'role', 'roster']);
  const authority = { ...value };
  for (const field of ['projectId', 'rootSessionId', 'sessionId', 'memberId', 'nativeName']) authority[field] = text(value[field], field);
  if (!['leader', 'worker', 'user'].includes(value.role) || !Array.isArray(value.roster)) fail('INVALID_AUTHORITY', 'Host-derived role and native roster are required');
  authority.roster = value.roster.map(row => memberSchema.parse(row));
  for (const field of ['nativeName', 'memberId', 'sessionId']) if (new Set(authority.roster.map(row => row[field])).size !== authority.roster.length) fail('INVALID_AUTHORITY', `Native roster has duplicate ${field}`);
  if (authority.role !== 'user' && !authority.roster.some(row => matches(row, authority))) fail('INVALID_AUTHORITY', 'Actor must match its actual native roster identity');
  if (authority.role === 'leader' && authority.sessionId !== authority.rootSessionId) fail('INVALID_AUTHORITY', 'Leader must be the exact native root');
  return authority;
}
function matches(member, authority) { return member.nativeName === authority.nativeName && member.memberId === authority.memberId && member.sessionId === authority.sessionId; }
function control(authority) { if (!['leader', 'user'].includes(authority.role)) fail('FORBIDDEN', 'Only the leader or user may create, advance, close or record delivery'); }
function scope(authority, room, mutation = false) {
  if (room.projectId !== authority.projectId) fail('FOREIGN_PROJECT', 'Discussion belongs to another project');
  if (room.rootSessionId !== authority.rootSessionId && (mutation || room.status !== 'closed')) fail('FOREIGN_ROOT', 'Another native root may read closed history, but cannot resume or mutate this discussion');
  if (!mutation && room.status === 'closed') return;
  if (authority.role === 'worker' && !room.members.some(member => matches(member, authority))) fail('NOT_PARTICIPANT', 'Worker must be a named participant with the original native identity');
}
function page(options = {}) {
  object(options, ['offset', 'limit']);
  return { offset: number(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: number(options.limit ?? L.page, 'limit', 1, L.page) };
}
function visiblePosts(authority, room) {
  return authority.role === 'worker' && room.status === 'open' && room.round === 1
    ? room.posts.filter(post => post.memberId === authority.memberId && post.source === authority.sessionId)
    : room.posts;
}
function view(authority, room, options) {
  const posts = visiblePosts(authority, room);
  const { offset, limit } = options ?? { offset: Math.max(0, posts.length - L.page), limit: L.page };
  const { members, leader, operations, notifications, ...record } = room;
  const receipts = authority.role === 'worker' ? notifications.filter(item => item.target === authority.nativeName) : notifications;
  return structuredClone({ ...record, posts: posts.slice(offset, offset + limit), postCount: posts.length, postOffset: offset, nextPostOffset: offset + limit < posts.length ? offset + limit : null, notifications: receipts.slice(-L.page), notificationCount: receipts.length });
}
function effects(room, targets, kind) {
  return targets.map(target => ({ id: randomUUID(), target, kind, round: room.round, status: 'pending' }));
}
function participantTargets(room, authority) { return room.participants.filter(name => name !== authority.nativeName); }
function operation(request, authority) {
  if (request.operation_id === undefined) return null;
  const id = text(request.operation_id, 'operation_id');
  const payload = Object.fromEntries(Object.keys(request).sort().filter(key => !['operation_id', 'expected_revision'].includes(key)).map(key => [key, request[key]]));
  return { id, actor: createHash('sha256').update(JSON.stringify([authority.memberId, authority.sessionId])).digest('hex'), action: request.action, fingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
function replay(room, op) {
  const prior = op && room.operations.find(item => item.id === op.id && item.actor === op.actor);
  if (prior && (prior.action !== op.action || prior.fingerprint !== op.fingerprint)) fail('OPERATION_CONFLICT', 'operation_id was already committed with different arguments');
  return !!prior;
}

/** Host-only authority must be resolved by the shared tools/UI adapter, never from caller arguments.
 * No transport or automatic retries: pending may mean a native send committed before a crash.
 * Native queue acknowledgement is not a read receipt, actor progress, or verified memory.
 */
export async function openDiscussions(storageDomain) {
  if (!storageDomain?.open) fail('STORAGE_UNAVAILABLE', 'Native storageDomain is required');
  const domain = await storageDomain.open(spec);
  const rooms = domain.table('rooms');
  // ponytail: serialize create checks in this one process; native domains already reject a second open.
  let creates = Promise.resolve();
  let closing = false;
  let disposal;
  function get(authority, id, mutation = false) {
    const room = rooms.get(text(id, 'id'));
    if (!room) fail('NOT_FOUND', 'Discussion not found');
    scope(authority, room, mutation);
    return room;
  }
  function active() { if (closing) fail('CLOSED', 'Discussion store is closed'); }
  return {
    list(authority, options = {}) {
      active(); authority = authorityOf(authority);
      const { offset, limit } = page(options);
      const available = [...rooms.entries()].map(([, room]) => room).filter(room => room.projectId === authority.projectId && (room.status === 'closed' || (room.rootSessionId === authority.rootSessionId && (authority.role !== 'worker' || room.members.some(member => matches(member, authority))))));
      return structuredClone({ rooms: available.slice(offset, offset + limit).map(room => ({ id: room.id, revision: room.revision, projectId: room.projectId, rootSessionId: room.rootSessionId, topic: room.topic.slice(0, 240), participants: room.participants, round: room.round, maxRounds: room.maxRounds, status: room.status, postCount: visiblePosts(authority, room).length, conclusion: room.conclusion.slice(0, 240) })), total: available.length, nextOffset: offset + limit < available.length ? offset + limit : null });
    },
    // No unbounded log endpoint. Optional paging reads at most eight visible posts per call.
    read(authority, id, options) {
      active(); authority = authorityOf(authority);
      return view(authority, get(authority, id), options === undefined ? undefined : page(options));
    },
    async mutate(authority, request) {
      active(); authority = authorityOf(authority);
      object(request, ['action', 'id', 'topic', 'participants', 'maxRounds', 'round', 'text', 'expected_revision', 'skip_missing', 'reason', 'conclusion', 'dissent', 'nextSteps', 'operation_id']);
      const keys = {
        create: ['action', 'topic', 'participants', 'maxRounds', 'expected_revision', 'operation_id'],
        post: ['action', 'id', 'round', 'text', 'expected_revision', 'operation_id'],
        advance: ['action', 'id', 'expected_revision', 'skip_missing', 'reason', 'operation_id'],
        close: ['action', 'id', 'expected_revision', 'conclusion', 'dissent', 'nextSteps', 'operation_id'],
      };
      if (!Object.hasOwn(keys, request.action)) fail('INVALID_REQUEST', 'Discussion action must be create, post, advance or close');
      object(request, keys[request.action]);
      request = structuredClone(request);
      const op = operation(request, authority);
      if (request.action === 'create') {
        control(authority);
        if (request.expected_revision !== undefined && request.expected_revision !== 0) fail('STALE_REVISION', 'A new discussion requires expected_revision 0');
        const topic = text(request.topic, 'topic', L.topic);
        const maxRounds = number(request.maxRounds ?? 2, 'maxRounds', 1, L.maxRounds);
        if (!Array.isArray(request.participants) || !request.participants.length || request.participants.length > L.participants) fail('INVALID_REQUEST', `Choose 1..${L.participants} actual native participants`);
        const participants = request.participants.map(name => text(name, 'participant'));
        if (new Set(participants).size !== participants.length) fail('INVALID_REQUEST', 'Participants must be unique');
        const members = participants.map(name => {
          const row = authority.roster.find(member => member.nativeName === name);
          if (!row) fail('UNKNOWN_PARTICIPANT', `Participant ${name} is not in the actual native roster`);
          return row;
        });
        const leader = authority.roster.find(member => member.sessionId === authority.rootSessionId);
        if (!leader) fail('INVALID_AUTHORITY', 'Actual native roster must contain the root leader');
        const id = op ? createHash('sha256').update(JSON.stringify([authority.projectId, authority.rootSessionId, op.actor, op.id])).digest('hex') : randomUUID();
        const pending = creates.then(async () => {
          const existing = rooms.get(id);
          if (existing) {
            scope(authority, existing, true);
            if (!replay(existing, op)) fail('OPERATION_CONFLICT', 'Discussion ID already exists');
            return { room: view(authority, existing), notifications: [], replayed: true };
          }
          let room = { id, revision: 1, projectId: authority.projectId, rootSessionId: authority.rootSessionId, topic, participants, round: 1, maxRounds, status: 'open', posts: [], conclusion: '', dissent: [], nextSteps: [], notifications: [], members, leader, operations: op ? [op] : [], skipped: [] };
          const notifications = effects(room, participantTargets(room, authority), 'invite');
          room = roomSchema.parse({ ...room, notifications });
          await rooms.put(id, room);
          return { room: view(authority, room), notifications: structuredClone(notifications) };
        });
        creates = pending.then(() => {}, () => {});
        return pending;
      }
      const id = text(request.id, 'id');
      get(authority, id, true);
      if (request.action !== 'post') control(authority);
      number(request.expected_revision, 'expected_revision', 1, Number.MAX_SAFE_INTEGER);
      let notifications = [], replayed = false;
      const room = await rooms.update(id, current => {
        scope(authority, current, true);
        if (replay(current, op)) { replayed = true; return current; }
        if (request.expected_revision !== current.revision) fail('STALE_REVISION', `Stale discussion revision: expected ${request.expected_revision}, actual ${current.revision}`, { expected: request.expected_revision, actual: current.revision });
        if (current.status !== 'open') fail('ROOM_CLOSED', 'Discussion is closed; create a new room instead');
        let next = structuredClone(current);
        switch (request.action) {
          case 'post': {
            if (!next.members.some(member => matches(member, authority))) fail('NOT_PARTICIPANT', 'Only a named participant may post its own statement');
            number(request.round, 'round', 1, L.maxRounds);
            if (request.round !== next.round) fail('LATE_POST', `Only current round ${next.round} accepts statements`);
            if (next.posts.some(post => post.round === next.round && post.author === authority.nativeName)) fail('DUPLICATE_SPEAKER', 'Each participant may post one independent statement per round');
            next.posts.push({ id: randomUUID(), memberId: authority.memberId, author: authority.nativeName, round: next.round, text: text(request.text, 'text', L.text), source: authority.sessionId, time: new Date().toISOString() });
            notifications = effects(next, authority.nativeName === next.leader.nativeName ? [] : [next.leader.nativeName], 'post');
            break;
          }
          case 'advance': {
            if (request.skip_missing !== undefined && typeof request.skip_missing !== 'boolean') fail('INVALID_REQUEST', 'skip_missing must be boolean');
            if (request.reason !== undefined && !request.skip_missing) fail('INVALID_REQUEST', 'reason requires explicit skip_missing');
            const reason = request.skip_missing ? text(request.reason, 'reason', 500) : '';
            if (next.round >= next.maxRounds) fail('MAX_ROUNDS', 'Maximum rounds reached; close this bounded discussion');
            const missing = next.participants.filter(name => !next.posts.some(post => post.round === next.round && post.author === name));
            if (missing.length && !request.skip_missing) fail('MISSING_RESPONSES', 'All participants must respond before advancing, or explicitly skip_missing with a reason', { missing });
            if (missing.length) next.skipped.push({ round: next.round, participants: missing, reason });
            next.round++;
            notifications = effects(next, participantTargets(next, authority), 'round');
            break;
          }
          case 'close':
            next.status = 'closed';
            next.conclusion = text(request.conclusion, 'conclusion', L.conclusion);
            next.dissent = summaries(request.dissent ?? next.dissent, 'dissent');
            next.nextSteps = summaries(request.nextSteps ?? next.nextSteps, 'nextSteps');
            notifications = effects(next, participantTargets(next, authority), 'closed');
            break;
        }
        next.revision++;
        next.notifications.push(...notifications);
        if (op) next.operations.push(op);
        return roomSchema.parse(next);
      });
      return { room: view(authority, room), notifications: structuredClone(notifications), ...(replayed ? { replayed: true } : {}) };
    },
    async recordDelivery(authority, id, notificationId, result) {
      active(); authority = authorityOf(authority); control(authority);
      id = text(id, 'id');
      get(authority, id, true);
      notificationId = text(notificationId, 'notificationId');
      object(result, ['status', 'messageId', 'error']);
      let receipt;
      if (result.status === 'queued') {
        object(result, ['status', 'messageId']);
        receipt = { status: 'queued', messageId: text(result.messageId, 'messageId') };
      } else if (result.status === 'failed') {
        object(result, ['status', 'error']);
        receipt = { status: 'failed', error: text(result.error, 'error', 500) };
      } else fail('INVALID_REQUEST', 'Delivery result must be queued with a native messageId, or failed with an error');
      const room = await rooms.update(id, current => {
        scope(authority, current, true);
        const index = current.notifications.findIndex(item => item.id === notificationId);
        if (index < 0) fail('NOTIFICATION_NOT_FOUND', 'Notification not found');
        const previous = current.notifications[index];
        if (previous.status === receipt.status && previous.messageId === receipt.messageId && previous.error === receipt.error) return current;
        if (previous.status === 'queued') fail('DELIVERY_CONFLICT', 'A confirmed native queue acknowledgement cannot be overwritten');
        const next = structuredClone(current);
        const { messageId, error, ...base } = next.notifications[index];
        next.notifications[index] = { ...base, ...receipt };
        next.revision++;
        return roomSchema.parse(next);
      });
      return { room: view(authority, room), notifications: [] };
    },
    close() {
      closing = true;
      disposal ??= creates.then(() => domain.close());
      return disposal;
    },
  };
}
