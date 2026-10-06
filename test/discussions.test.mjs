import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || specifier === 'zod') ? runtime.resolve(specifier) : specifier, context); } });
const { Context } = await import('@deepseek-ai/cordis');
const { openDiscussions, DISCUSSION_LIMITS: L } = await import('../discussions.js');
const roster = [
  { nativeName: 'leader', memberId: 'm-root', sessionId: 'root' },
  { nativeName: 'worker-a', memberId: 'm-a', sessionId: 's-a' },
  { nativeName: 'reusable-b', memberId: 'm-b', sessionId: 's-b' },
];
const authority = (name = 'leader', overrides = {}) => ({ projectId: 'project-a', rootSessionId: 'root', ...roster.find(row => row.nativeName === name), role: name === 'leader' ? 'leader' : 'worker', roster, ...overrides });
const leader = authority(), a = authority('worker-a'), b = authority('reusable-b');
const newRootRoster = [{ nativeName: 'leader', memberId: 'm-new', sessionId: 'new-root' }, { nativeName: 'worker-new', memberId: 'm-new-worker', sessionId: 's-new-worker' }];
const newRoot = authority('leader', { rootSessionId: 'new-root', sessionId: 'new-root', memberId: 'm-new', roster: newRootRoster });
const code = expected => error => { assert.equal(error.code, expected, error.message); return true; };

async function kernel(root) {
  const ctx = new Context();
  try {
    for (const [name, config] of [['dsh-storage', {}], ['dsh-storage-json', { root }], ['dsh-storage-domain', { backend: 'json' }]]) {
      const mod = await import('@deepseek-ai/' + name);
      await ctx.plugin(mod.default ?? mod, config);
    }
    const store = await openDiscussions(ctx.storageDomain);
    return { ctx, store };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mentor-discussions-'));
  let native;
  try {
    native = await kernel(root);
    await run(native.store, native.ctx, async () => {
      await native.store.close(); await native.ctx.fiber.dispose();
      native = await kernel(root);
      return native.store;
    });
  } finally {
    if (native) { await native.store.close(); await native.ctx.fiber.dispose(); }
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dsh-mentor-discussions-'));
    await rm(root, { recursive: true, force: true });
  }
}
const create = (store, extra = {}, auth = leader) => store.mutate(auth, { action: 'create', topic: 'Compare two bounded implementation choices', participants: ['worker-a', 'reusable-b'], ...extra });
const post = (store, auth, room, text = 'Independent statement', extra = {}) => store.mutate(auth, { action: 'post', id: room.id, expected_revision: room.revision, round: room.round, text, ...extra });
const advance = (store, room, extra = {}, auth = leader) => store.mutate(auth, { action: 'advance', id: room.id, expected_revision: room.revision, ...extra });
const close = (store, room, extra = {}, auth = leader) => store.mutate(auth, { action: 'close', id: room.id, expected_revision: room.revision, conclusion: 'Choose the simpler option; this is discussion, not verification.', ...extra });

test('native domain restart retains room, immutable actor source and pending/queued/failed receipts without resending', async () => fixture(async (store, ctx, restart) => {
  let result = await create(store, { operation_id: 'create-restart' });
  assert.equal(result.room.revision, 1); assert.equal(result.room.maxRounds, 2);
  assert.deepEqual(result.notifications.map(item => item.target), ['worker-a', 'reusable-b']);
  assert.ok(result.notifications.every(item => item.status === 'pending' && item.kind === 'invite'));
  const id = result.room.id, first = result.notifications[0], second = result.notifications[1];
  result = await store.recordDelivery(leader, id, first.id, { status: 'queued', messageId: 'native-journal-message-1' });
  assert.equal(result.room.revision, 2); assert.deepEqual(result.notifications, []);
  result = await store.recordDelivery(leader, id, second.id, { status: 'failed', error: 'Native actor unavailable' });
  assert.equal(result.room.revision, 3);
  result = await post(store, a, result.room, 'Original independent statement', { operation_id: 'first-statement' });
  assert.equal(result.notifications[0].target, 'leader'); assert.equal(result.notifications[0].status, 'pending');
  assert.equal(result.room.posts[0].source, a.sessionId); assert.equal(result.room.posts[0].author, a.nativeName);
  assert.ok(result.room.posts[0].time.endsWith('Z'));
  const before = store.read(leader, id);
  before.posts[0].text = 'Do not mutate stored objects';
  store = await restart();
  const room = store.read(leader, id);
  assert.equal(room.posts[0].text, 'Original independent statement');
  assert.deepEqual(room.notifications.map(item => item.status), ['queued', 'failed', 'pending']);
  assert.equal(room.notifications[0].messageId, 'native-journal-message-1');
  assert.equal(room.notifications[1].error, 'Native actor unavailable');
  result = await create(store, { operation_id: 'create-restart' });
  assert.equal(result.room.id, id); assert.equal(result.room.revision, room.revision);
  assert.equal(result.replayed, true); assert.deepEqual(result.notifications, [], 'Unconfirmed native delivery is never automatically retried');
  assert.equal(ctx.storageDomain, undefined, 'Old fixture native storage service was disposed');
}));

test('round one hides other workers independent initial statements; advance publishes them and later reads stay paged', async () => fixture(async store => {
  let { room } = await create(store);
  room = (await post(store, a, room, 'A original reasoning')).room;
  assert.deepEqual(store.read(b, room.id).posts, []);
  assert.equal(store.list(b).rooms[0].postCount, 0);
  room = (await post(store, b, room, 'B independent dissent')).room;
  assert.deepEqual(store.read(a, room.id).posts.map(item => item.author), ['worker-a']);
  assert.deepEqual(store.read(b, room.id).posts.map(item => item.author), ['reusable-b']);
  assert.equal(store.read(leader, room.id).posts.length, 2);
  assert.equal(store.read({ ...leader, role: 'user' }, room.id).posts.length, 2);
  const next = await advance(store, room);
  assert.equal(next.room.round, 2); assert.ok(next.notifications.every(item => item.kind === 'round' && item.round === 2));
  assert.equal(store.read(a, room.id).posts.length, 2);
  assert.equal(store.read(b, room.id).posts.length, 2);
}));

test('project/native-root isolation permits closed project history but never old-room resumption or roster identity transfer', async () => fixture(async store => {
  let { room } = await create(store);
  const otherProject = { ...leader, projectId: 'project-b' };
  assert.throws(() => store.read(otherProject, room.id), code('FOREIGN_PROJECT'));
  await assert.rejects(advance(store, room, {}, otherProject), code('FOREIGN_PROJECT'));
  assert.deepEqual(store.list(otherProject).rooms, []);
  assert.throws(() => store.read(newRoot, room.id), code('FOREIGN_ROOT'));
  await assert.rejects(close(store, room, {}, newRoot), code('FOREIGN_ROOT'));
  assert.deepEqual(store.list(newRoot).rooms, []);
  const replaced = { ...a, sessionId: 's-replacement', roster: roster.map(row => row.nativeName === a.nativeName ? { ...row, sessionId: 's-replacement' } : row) };
  await assert.rejects(post(store, replaced, room), code('NOT_PARTICIPANT'));
  await assert.rejects(post(store, { ...a, memberId: b.memberId }, room), code('INVALID_AUTHORITY'));
  room = (await post(store, a, room, 'Retain this closed history')).room;
  room = (await close(store, room)).room;
  assert.equal(store.read(newRoot, room.id).status, 'closed');
  const newWorker = { ...newRoot, ...newRootRoster[1], role: 'worker' };
  assert.equal(store.read(newWorker, room.id).posts[0].text, 'Retain this closed history');
  assert.equal(store.list(newRoot).rooms[0].id, room.id);
  await assert.rejects(advance(store, room, {}, newRoot), code('FOREIGN_ROOT'));
  await assert.rejects(store.recordDelivery(newRoot, room.id, room.notifications[0].id, { status: 'queued', messageId: 'wrong-root' }), code('FOREIGN_ROOT'));
  await assert.rejects(close(store, room, {}, otherProject), code('FOREIGN_PROJECT'));
}));

test('only actual roster participants post once per current round; control is leader/user-only and overrides are rejected', async () => fixture(async store => {
  for (const action of ['resume', '__proto__', 'constructor']) await assert.rejects(store.mutate(leader, { action }), code('INVALID_REQUEST'));
  await assert.rejects(create(store, {}, a), code('FORBIDDEN'));
  await assert.rejects(create(store, { participants: ['invented-agent'] }), code('UNKNOWN_PARTICIPANT'));
  await assert.rejects(create(store, { participants: ['worker-a', 'worker-a'] }), code('INVALID_REQUEST'));
  let { room } = await create(store);
  await assert.rejects(post(store, leader, room), code('NOT_PARTICIPANT'));
  for (const overrides of [{ author: 'worker-a' }, { memberId: 'm-a' }, { projectId: 'project-b' }, { rootSessionId: 'other-root' }, { sessionId: 's-a' }]) {
    await assert.rejects(post(store, b, room, 'Forged author override', overrides), code('INVALID_REQUEST'));
  }
  room = (await post(store, a, room)).room;
  await assert.rejects(post(store, a, room), code('DUPLICATE_SPEAKER'));
  await assert.rejects(advance(store, room, {}, a), code('FORBIDDEN'));
  await assert.rejects(close(store, room, {}, b), code('FORBIDDEN'));
  room = (await advance(store, room, { skip_missing: true, reason: 'B unavailable for this round' }, { ...leader, role: 'user' })).room;
  await assert.rejects(post(store, b, room, 'Late round-one reply', { round: 1 }), code('LATE_POST'));
  room = (await close(store, room)).room;
  await assert.rejects(post(store, b, room), code('ROOM_CLOSED'));
}));

test('missing responses require explicit reasoned skip; maxRounds 1..8 makes free chat finite', async () => fixture(async store => {
  for (const maxRounds of [0, 9, 2.5]) await assert.rejects(create(store, { maxRounds }), code('INVALID_REQUEST'));
  let { room } = await create(store, { maxRounds: 2 });
  await assert.rejects(advance(store, room), error => { assert.equal(error.code, 'MISSING_RESPONSES'); assert.deepEqual(error.detail.missing, ['worker-a', 'reusable-b']); return true; });
  await assert.rejects(advance(store, room, { skip_missing: true }), code('INVALID_REQUEST'));
  await assert.rejects(advance(store, room, { skip_missing: true, reason: ' ' }), code('INVALID_REQUEST'));
  await assert.rejects(advance(store, room, { skip_missing: 'yes', reason: 'bad boolean' }), code('INVALID_REQUEST'));
  await assert.rejects(advance(store, room, { reason: 'Implicit skip is not allowed' }), code('INVALID_REQUEST'));
  room = (await advance(store, room, { skip_missing: true, reason: 'Explicit leader decision after fixture unavailability' })).room;
  assert.deepEqual(room.skipped, [{ round: 1, participants: ['worker-a', 'reusable-b'], reason: 'Explicit leader decision after fixture unavailability' }]);
  await assert.rejects(advance(store, room, { skip_missing: true, reason: 'No infinite third round' }), code('MAX_ROUNDS'));
  const single = (await create(store, { maxRounds: 1 })).room;
  await assert.rejects(advance(store, single, { skip_missing: true, reason: 'One is the maximum' }), code('MAX_ROUNDS'));
}));

test('native table-update CAS admits one concurrent writer and durable operation_id retries never add posts or effects', async () => fixture(async (store, _ctx, restart) => {
  let { room } = await create(store, { operation_id: 'concurrent-create' });
  const result = await Promise.allSettled([post(store, a, room, 'A wins or loses', { operation_id: 'a-one' }), post(store, b, room, 'B wins or loses', { operation_id: 'b-one' })]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  const failure = result.find(item => item.status === 'rejected').reason;
  assert.equal(failure.code, 'STALE_REVISION'); assert.deepEqual(failure.detail, { expected: 1, actual: 2 });
  const winner = result.find(item => item.status === 'fulfilled').value;
  room = store.read(leader, room.id);
  const auth = room.posts[0].author === a.nativeName ? a : b;
  const operation_id = auth === a ? 'a-one' : 'b-one';
  store = await restart();
  const retried = await post(store, auth, { ...room, revision: 1 }, room.posts[0].text, { operation_id });
  assert.equal(retried.replayed, true); assert.equal(retried.room.revision, winner.room.revision);
  assert.equal(retried.room.posts.length, 1); assert.deepEqual(retried.notifications, []);
  await assert.rejects(post(store, auth, room, 'Changed payload under same key', { operation_id }), code('OPERATION_CONFLICT'));
  const concurrentCreates = await Promise.all([create(store, { operation_id: 'same-create' }), create(store, { operation_id: 'same-create' })]);
  assert.equal(concurrentCreates[0].room.id, concurrentCreates[1].room.id);
  assert.equal(concurrentCreates.filter(item => item.replayed).length, 1);
  assert.equal(store.list(leader).total, 2);
  await assert.rejects(create(store, { operation_id: 'same-create', topic: 'Different topic under same key' }), code('OPERATION_CONFLICT'));
}));

test('close preserves dissent, original statements and next steps across restart; it never writes verified project memory', async () => fixture(async (store, ctx, restart) => {
  let { room } = await create(store);
  room = (await post(store, a, room, 'Prefer A because it is simpler')).room;
  room = (await post(store, b, room, 'Dissent: B has stronger isolation')).room;
  const before = structuredClone(store.read(leader, room.id).posts);
  const dissent = ['reusable-b dissents: B has stronger isolation; do not erase this objection.'];
  const nextSteps = ['Run independent verification before promoting any fact to project memory.'];
  const result = await close(store, room, { dissent, nextSteps, operation_id: 'close-with-dissent' });
  assert.equal(result.room.status, 'closed'); assert.deepEqual(result.room.posts, before);
  assert.deepEqual(result.room.dissent, dissent); assert.deepEqual(result.room.nextSteps, nextSteps);
  assert.ok(result.notifications.every(item => item.kind === 'closed'));
  assert.equal(ctx.storageDomain.get('codex-mentor-project-memory'), undefined);
  assert.equal(Object.hasOwn(result.room, 'verified'), false);
  store = await restart();
  room = store.read(leader, room.id);
  assert.deepEqual(room.dissent, dissent); assert.deepEqual(room.posts, before);
  const replay = await close(store, { ...room, revision: 3 }, { dissent, nextSteps, operation_id: 'close-with-dissent' });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.notifications, []);
}));

test('delivery stores only native queue/failure outcomes, serializes against CAS and does not imply read or progress', async () => fixture(async store => {
  let { room, notifications } = await create(store);
  const effect = notifications[0];
  await assert.rejects(store.recordDelivery(a, room.id, effect.id, { status: 'queued', messageId: 'native-1' }), code('FORBIDDEN'));
  for (const result of [{ status: 'read' }, { status: 'pending' }, { status: 'queued' }, { status: 'failed' }, { status: 'queued', messageId: 'native-1', progress: 'complete' }]) {
    await assert.rejects(store.recordDelivery(leader, room.id, effect.id, result), code('INVALID_REQUEST'));
  }
  await assert.rejects(store.recordDelivery(leader, room.id, 'absent', { status: 'failed', error: 'No notification' }), code('NOTIFICATION_NOT_FOUND'));
  room = (await store.recordDelivery(leader, room.id, effect.id, { status: 'failed', error: 'Explicit native failure' })).room;
  room = (await store.recordDelivery(leader, room.id, effect.id, { status: 'queued', messageId: 'native-1' })).room;
  const revision = room.revision;
  const repeated = await store.recordDelivery(leader, room.id, effect.id, { status: 'queued', messageId: 'native-1' });
  assert.equal(repeated.room.revision, revision); assert.deepEqual(repeated.notifications, []);
  assert.equal(repeated.room.notifications[0].error, undefined);
  assert.equal(repeated.room.notifications[0].status, 'queued');
  assert.equal(repeated.room.posts.length, 0); assert.equal(repeated.room.status, 'open');
  await assert.rejects(store.recordDelivery(leader, room.id, effect.id, { status: 'queued', messageId: 'native-2' }), code('DELIVERY_CONFLICT'));
  await assert.rejects(store.recordDelivery(leader, room.id, effect.id, { status: 'failed', error: 'Do not overwrite proof of queue' }), code('DELIVERY_CONFLICT'));
  await assert.rejects(post(store, a, { ...room, revision: 1 }), code('STALE_REVISION'));
}));

test('bounded texts, posts and list/read pages retain complete logs only behind explicit finite paging', async () => fixture(async store => {
  await assert.rejects(create(store, { topic: 'x'.repeat(L.topic + 1) }), code('INVALID_REQUEST'));
  await assert.rejects(create(store, { participants: Array(L.participants + 1).fill('worker-a') }), code('INVALID_REQUEST'));
  let { room } = await create(store, { maxRounds: L.maxRounds });
  await assert.rejects(post(store, a, room, 'x'.repeat(L.text + 1)), code('INVALID_REQUEST'));
  for (let round = 1; round <= L.maxRounds; round++) {
    room = (await post(store, a, room, `A round ${round}`)).room;
    room = (await post(store, b, room, `B round ${round}`)).room;
    if (round < L.maxRounds) room = (await advance(store, room)).room;
  }
  const tail = store.read(leader, room.id);
  assert.equal(tail.posts.length, L.page); assert.equal(tail.postCount, 16); assert.equal(tail.postOffset, 8); assert.equal(tail.nextPostOffset, null);
  const first = store.read(leader, room.id, { offset: 0, limit: 3 });
  assert.equal(first.posts.length, 3); assert.equal(first.postOffset, 0); assert.equal(first.nextPostOffset, 3);
  assert.equal(store.read(leader, room.id, { offset: 15, limit: 8 }).posts.length, 1);
  assert.throws(() => store.read(leader, room.id, { limit: 9 }), code('INVALID_REQUEST'));
  assert.throws(() => store.list(leader, { offset: -1 }), code('INVALID_REQUEST'));
  await assert.rejects(close(store, room, { dissent: Array(L.summaryItems + 1).fill('dissent') }), code('INVALID_REQUEST'));
  await assert.rejects(close(store, room, { nextSteps: ['x'.repeat(L.summaryText + 1)] }), code('INVALID_REQUEST'));
  for (let i = 0; i < 9; i++) await create(store, { topic: `Small room ${i}` });
  const listed = store.list(leader);
  assert.equal(listed.rooms.length, 8); assert.equal(listed.total, 10); assert.equal(listed.nextOffset, 8);
  assert.equal(store.list(leader, { offset: listed.nextOffset }).rooms.length, 2);
  assert.equal(Object.hasOwn(listed.rooms[0], 'posts'), false);
  await store.close(); await store.close();
  assert.throws(() => store.read(leader, room.id), code('CLOSED'));
  await assert.rejects(create(store), code('CLOSED'));
}));
