import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { dirname, resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || specifier === 'zod') ? runtime.resolve(specifier) : specifier, context); } });
const { Context } = await import('@deepseek-ai/cordis');
const { openProjectMemory, projectMemoryDomain, PROJECT_MEMORY_LIMITS: L, ProjectMemoryError } = await import('../project-memory.js');
const leader = { projectId: '/fixtures/project-a', memberId: null, role: 'leader', sessionId: 'root-a', taskId: 'task-a' };
const worker = { ...leader, memberId: 'analyst', role: 'worker', sessionId: 'child-a' };
const peer = { ...worker, memberId: 'reviewer', sessionId: 'child-b' };
const user = { ...leader, role: 'user', sessionId: 'user-a' };
const note = (conclusion, extra = {}) => ({ action: 'note', conclusion, ...extra });
const failure = code => error => error instanceof ProjectMemoryError && error.code === code;

async function mount(root) {
  const ctx = new Context();
  try {
    for (const [name, config] of [['dsh-storage', {}], ['dsh-storage-json', { root }], ['dsh-storage-domain', { backend: 'json' }]]) {
      const mod = await import('@deepseek-ai/' + name);
      await ctx.plugin(mod.default ?? mod, config);
    }
    const memory = await openProjectMemory(ctx.storageDomain);
    return { ctx, memory, async close() { await memory.close(); await ctx.fiber.dispose(); } };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-memory-'));
  let host;
  t.after(async () => {
    try { if (host) await host.close(); }
    finally {
      const target = resolve(root);
      assert.equal(dirname(target), resolve(tmpdir()));
      assert.match(basename(target), /^dsh-project-memory-/);
      await rm(target, { recursive: true, force: true });
    }
  });
  host = await mount(root);
  return { root, get ctx() { return host.ctx; }, get memory() { return host.memory; }, async restart() { await host.close(); host = await mount(root); } };
}
function stored(f, projectId = leader.projectId) {
  return f.ctx.storageDomain.get(projectMemoryDomain.name).table('projects')
    .get(createHash('sha256').update(projectId).digest('hex'));
}

// These mount only native storage plugins: no agents, models, projects or credentials.
test('native storageDomain owns one versioned handle and survives a full JSON-backed Host restart', async t => {
  const f = await fixture(t), memory = f.memory;
  assert.equal(projectMemoryDomain.version, 1);
  await assert.rejects(openProjectMemory(f.ctx.storageDomain), e => e.code === 'already-open');
  const record = await memory.mutate(worker, note('Durable observation', { evidence: 'fixture check', operationId: 'first-note' }));
  await memory.upsertMember(leader, { memberId: worker.memberId, description: 'Fixture analyst', expertise: ['validation'], incarnations: [{ rootSessionId: leader.sessionId, childSessionId: worker.sessionId, nativeName: 'analyst-native', route: { provider: 'fixture', model: 'fixture-model' }, writeScope: [] }] });
  await f.restart();
  assert.deepEqual(f.memory.read(worker, record.id), record);
  assert.equal(f.memory.getMember(leader.projectId, worker.memberId).incarnations[0].childSessionId, worker.sessionId);
  assert.deepEqual(await f.memory.mutate(worker, note('Durable observation', { evidence: 'fixture check', operationId: 'first-note' })), record);
  assert.throws(() => memory.snapshot(leader.projectId), e => e.code === 'closed');
});

test('authority stamps cannot be spoofed, fields are validated, and verification requires evidence', async t => {
  const { memory } = await fixture(t);
  for (const override of [{ author: { role: 'leader' } }, { projectId: 'foreign' }]) {
    await assert.rejects(memory.mutate(worker, note('spoof', override)), failure('invalid-request'));
  }
  await assert.rejects(memory.mutate({ ...worker, memberId: null }, note('no identity')), failure('forbidden'));
  await assert.rejects(memory.mutate(worker, note('verify', { status: 'verified', evidence: 'claim' })), failure('forbidden'));
  await assert.rejects(memory.mutate(leader, note('verify', { status: 'verified' })), failure('invalid-request'));
  await assert.rejects(memory.mutate(leader, note('verify', { status: 'verified', evidence: '   ' })), failure('invalid-request'));
  await assert.rejects(memory.mutate(leader, note(' ')), failure('invalid-request'));
  await assert.rejects(memory.mutate(leader, note('x'.repeat(L.conclusion + 1))), failure('invalid-request'));
  const record = await memory.mutate(worker, note('original', { evidence: 'fixture' }));
  assert.deepEqual(record.author, { memberId: worker.memberId, role: 'worker', sessionId: worker.sessionId });
  assert.deepEqual(record.source, { sessionId: worker.sessionId, taskId: worker.taskId });
  assert.equal(record.revision, 1);
  await assert.rejects(memory.mutate(worker, { action: 'revise', id: record.id, conclusion: 'missing CAS' }), failure('invalid-request'));
  await assert.rejects(memory.mutate(worker, { action: 'forget', id: record.id }), failure('invalid-request'));
  for (const extra of [{ memberId: peer.memberId }, { scope: 'member' }, { author: leader }]) {
    await assert.rejects(memory.mutate(worker, { action: 'revise', id: record.id, expected_revision: 1, conclusion: 'changed', ...extra }), failure('invalid-request'));
  }
  const confirmed = await memory.mutate(leader, { action: 'confirm', id: record.id, expected_revision: 1 });
  assert.equal(confirmed.status, 'verified');
  assert.deepEqual(confirmed.author, record.author);
  assert.deepEqual(confirmed.source, record.source);
  assert.equal(confirmed.history.at(-1).author.role, 'leader');
  const ownUpdate = await memory.mutate(worker, { action: 'revise', id: record.id, expected_revision: 2, conclusion: 'new own observation' });
  assert.equal(ownUpdate.status, 'hypothesis', 'workers may revise their own notes but cannot inherit verification');
  const changed = await memory.mutate(user, { action: 'revise', id: record.id, expected_revision: 3, conclusion: 'curated revision' });
  assert.equal(changed.status, 'hypothesis', 'new text cannot silently inherit verification');
  assert.deepEqual(changed.author, record.author);
  await assert.rejects(memory.mutate(leader, { action: 'confirm', id: changed.id, expected_revision: 4, evidence: '' }), failure('invalid-request'));
  const ownVerified = await memory.mutate(worker, note('own erasable note', { evidence: 'fixture' }));
  await memory.mutate(leader, { action: 'confirm', id: ownVerified.id, expected_revision: 1 });
  assert.deepEqual(await memory.mutate(worker, { action: 'forget', id: ownVerified.id, expected_revision: 2 }), { id: ownVerified.id, revision: 3, deleted: true });
});

test('workers may observe common notes and change only their own notes across native incarnations', async t => {
  const { memory } = await fixture(t);
  const own = await memory.mutate(worker, note('worker observation'));
  const other = await memory.mutate(peer, note('peer observation'));
  const curated = await memory.mutate(leader, note('leader observation'));
  assert.equal(memory.snapshot(leader.projectId, { memberId: worker.memberId }).total, 3);
  assert.ok(memory.read(worker, other.id));
  for (const r of [other, curated]) {
    for (const action of ['revise', 'invalidate', 'forget']) {
      await assert.rejects(memory.mutate(worker, { action, id: r.id, expected_revision: 1, ...(action === 'revise' ? { conclusion: 'unauthorized change' } : {}) }), failure('forbidden'));
    }
  }
  await assert.rejects(memory.mutate(worker, { action: 'confirm', id: own.id, expected_revision: 1, evidence: 'unsupported authority' }), failure('forbidden'));
  const incarnation = { ...worker, sessionId: 'child-a-next', taskId: 'task-next' };
  const revised = await memory.mutate(incarnation, { action: 'revise', id: own.id, expected_revision: 1, conclusion: 'same logical writer' });
  assert.equal(revised.revision, 2);
  assert.deepEqual(revised.author, own.author);
  const invalid = await memory.mutate(incarnation, { action: 'invalidate', id: own.id, expected_revision: 2, evidence: 'counterexample fixture' });
  assert.equal(invalid.status, 'invalidated');
  assert.deepEqual(await memory.mutate(incarnation, { action: 'forget', id: own.id, expected_revision: 3 }), { id: own.id, revision: 4, deleted: true });
  assert.equal(memory.read(worker, own.id), null);
});

test('project isolation and member privacy apply to direct reads, query totals, mutations and history', async t => {
  const { memory } = await fixture(t);
  const common = await memory.mutate(worker, note('shared fixture'));
  const privateRecord = await memory.mutate(peer, note('PRIVATE-SECRET', { scope: 'member', conditions: 'private condition' }));
  const ownPrivate = await memory.mutate(worker, note('OWN-PRIVATE', { scope: 'member' }));
  assert.equal(memory.read(worker, privateRecord.id), null);
  assert.equal(memory.read(leader, privateRecord.id).conclusion, 'PRIVATE-SECRET');
  assert.equal(memory.snapshot(leader.projectId, { memberId: worker.memberId }).total, 2);
  assert.equal(memory.snapshot(leader.projectId).total, 3);
  assert.equal(memory.snapshot(leader.projectId, { memberId: worker.memberId, query: 'PRIVATE-SECRET' }).total, 0);
  assert.ok(!JSON.stringify(memory.snapshot(leader.projectId, { memberId: worker.memberId })).includes('PRIVATE-SECRET'));
  await assert.rejects(memory.mutate(worker, note('other-private', { scope: 'member', memberId: peer.memberId })), failure('forbidden'));
  await assert.rejects(memory.mutate(worker, { action: 'forget', id: privateRecord.id, expected_revision: 1 }), failure('not-found'));
  const foreign = { ...leader, projectId: '/fixtures/project-b' };
  for (const r of [common, privateRecord, ownPrivate]) {
    assert.equal(memory.read(foreign, r.id), null);
    await assert.rejects(memory.mutate(foreign, { action: 'revise', id: r.id, expected_revision: 1, conclusion: 'foreign' }), failure('not-found'));
  }
  await memory.upsertMember(leader, { memberId: worker.memberId, description: 'project-a identity' });
  assert.deepEqual(memory.members(foreign.projectId), []);
  assert.equal(memory.getMember(foreign.projectId, worker.memberId), null);
  assert.equal(memory.snapshot(foreign.projectId).total, 0);
  const stamped = await memory.mutate(leader, note('leader private for peer', { scope: 'member', memberId: peer.memberId }));
  assert.equal(memory.read(worker, stamped.id), null);
  assert.ok(memory.read(peer, stamped.id));
  await assert.rejects(memory.mutate(peer, { action: 'revise', id: stamped.id, expected_revision: 1, conclusion: 'not my authorship' }), failure('forbidden'));
});

test('native table.update serializes concurrent CAS and first-project initialization without lost writes', async t => {
  const f = await fixture(t), memory = f.memory;
  const first = await Promise.all(Array.from({ length: 12 }, (_, i) => memory.mutate(worker, note(`concurrent ${i}`))));
  assert.equal(memory.snapshot(leader.projectId, { limit: 32 }).total, first.length);
  const original = first[0];
  const results = await Promise.allSettled(['left', 'right'].map(conclusion => memory.mutate(worker, { action: 'revise', id: original.id, expected_revision: 1, conclusion })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const conflict = results.find(r => r.status === 'rejected').reason;
  assert.equal(conflict.code, 'revision-conflict');
  assert.deepEqual(conflict.detail, { id: original.id, expectedRevision: 1, currentRevision: 2 });
  assert.equal(memory.read(worker, original.id).history.length, 2);
  await Promise.all(['alpha', 'beta'].map(memberId => memory.upsertMember(leader, { memberId })));
  assert.equal(memory.members(leader.projectId).length, 2);
  await f.restart();
  assert.equal(f.memory.snapshot(leader.projectId, { limit: 32 }).total, 12);
  assert.equal(f.memory.read(worker, original.id).revision, 2);
});

test('snapshots bound text/results, search full visible text and paginate without exposing mutable native values', async t => {
  const { memory } = await fixture(t);
  const conclusion = 'x'.repeat(800) + 'SEARCH-TAIL';
  const large = await memory.mutate(worker, note(conclusion, { evidence: 'e'.repeat(700), conditions: 'c'.repeat(400) }));
  for (let i = 0; i < 5; i++) await memory.mutate(worker, note(`small-${i}`));
  const filtered = memory.snapshot(leader.projectId, { memberId: worker.memberId, query: 'search-tail', limit: 2 });
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.memories[0].truncated, ['conclusion', 'evidence', 'conditions']);
  assert.equal(filtered.memories[0].conclusion.length, 600);
  assert.equal(filtered.memories[0].history, undefined);
  assert.equal(filtered.memories[0].operations, undefined);
  assert.equal(memory.read(worker, large.id).conclusion, conclusion);
  const pages = [0, 2, 4].map(offset => memory.snapshot(leader.projectId, { offset, limit: 2 }));
  assert.deepEqual(pages.map(p => p.nextOffset), [2, 4, null]);
  assert.equal(new Set(pages.flatMap(p => p.memories.map(r => r.id))).size, 6);
  assert.deepEqual(memory.snapshot(leader.projectId, { offset: 100 }).memories, []);
  assert.throws(() => memory.snapshot(leader.projectId, { limit: 33 }), failure('invalid-request'));
  assert.throws(() => memory.snapshot(leader.projectId, { offset: -1 }), failure('invalid-request'));
  assert.throws(() => memory.snapshot(leader.projectId, { query: 'x'.repeat(257) }), failure('invalid-request'));
  const copy = memory.read(worker, large.id);
  copy.conclusion = 'tamper'; copy.author.role = 'user'; copy.history.length = 0;
  assert.equal(memory.read(worker, large.id).conclusion, conclusion);
  assert.equal(memory.read(worker, large.id).author.role, 'worker');
  assert.equal(memory.read(worker, large.id).history.length, 1);
});

test('bounded revision receipts make retries idempotent and forgetting scrubs text/history durably', async t => {
  const f = await fixture(t), memory = f.memory;
  const input = note('secret initial', { scope: 'member', evidence: 'secret evidence', conditions: 'secret conditions', operationId: 'create' });
  let record = await memory.mutate(worker, input);
  assert.deepEqual(await memory.mutate(worker, input), record);
  assert.equal(memory.snapshot(leader.projectId).total, 1);
  await assert.rejects(memory.mutate(worker, { ...input, conclusion: 'different' }), failure('operation-conflict'));
  const modify = { action: 'revise', id: record.id, expected_revision: 1, conclusion: 'secret revised', operationId: 'revision-1' };
  record = await memory.mutate(worker, modify);
  assert.deepEqual(await memory.mutate(worker, modify), record, 'receipt takes precedence over stale original CAS');
  await assert.rejects(memory.mutate(worker, { ...modify, conclusion: 'different' }), failure('operation-conflict'));
  for (let i = 0; i < 20; i++) record = await memory.mutate(worker, { action: 'revise', id: record.id, expected_revision: record.revision, conclusion: `secret revision ${i}`, operationId: `step-${i}` });
  assert.equal(record.history.length, L.history);
  assert.equal(stored(f).memories[0].operations.length, L.operations);
  const forget = { action: 'forget', id: record.id, expected_revision: record.revision, operationId: 'delete' };
  const deleted = await memory.mutate(worker, forget);
  assert.deepEqual(deleted, { id: record.id, revision: record.revision + 1, deleted: true });
  assert.deepEqual(await memory.mutate(worker, forget), deleted);
  assert.equal(memory.read(leader, record.id), null);
  assert.equal(memory.snapshot(leader.projectId, { query: 'secret' }).total, 0);
  assert.deepEqual(stored(f).memories[0].history, []);
  assert.ok(!JSON.stringify(stored(f)).includes('secret'));
  await assert.rejects(memory.mutate(worker, { action: 'forget', id: record.id, expected_revision: record.revision }), failure('revision-conflict'));
  await assert.rejects(memory.mutate(worker, { action: 'revise', id: record.id, expected_revision: deleted.revision, conclusion: 'resurrect' }), failure('not-found'));
  await f.restart();
  assert.equal(f.memory.read(worker, record.id), null);
  assert.deepEqual(await f.memory.mutate(worker, forget), deleted);
  assert.ok(!JSON.stringify(stored(f)).includes('secret'));
});

test('member descriptors preserve logical identity, merge bounded native references and are Host-curated', async t => {
  const f = await fixture(t), memory = f.memory;
  await assert.rejects(memory.upsertMember(worker, { memberId: worker.memberId }), failure('forbidden'));
  await assert.rejects(memory.upsertMember(leader, { memberId: worker.memberId, projectId: 'spoof' }), failure('invalid-request'));
  await assert.rejects(memory.upsertMember(leader, { memberId: worker.memberId, description: 'x'.repeat(1601) }), failure('invalid-request'));
  await assert.rejects(memory.upsertMember(leader, { memberId: worker.memberId, expertise: Array(17).fill('skill') }), failure('invalid-request'));
  let descriptor = await memory.upsertMember(leader, { memberId: worker.memberId, description: 'Reusable analyst', expertise: 'testing' });
  assert.deepEqual(descriptor.expertise, ['testing']);
  for (let i = 0; i < L.incarnations + 3; i++) descriptor = await memory.upsertMember(leader, { memberId: worker.memberId, incarnations: [{ rootSessionId: `root-${i}`, childSessionId: `child-${i}`, nativeName: `native-${i}`, route: { provider: 'fixture', model: 'small', maxTokens: 100, reasoningEffort: 'low' }, writeScope: ['fixture.js'] }] });
  assert.equal(descriptor.incarnations.length, L.incarnations);
  assert.equal(descriptor.description, 'Reusable analyst');
  assert.deepEqual(descriptor.expertise, ['testing']);
  const last = descriptor.incarnations.at(-1);
  const updated = await memory.upsertMember(user, { memberId: worker.memberId, incarnations: [{ ...last, writeScope: [] }] });
  assert.equal(updated.incarnations.length, L.incarnations);
  assert.deepEqual(updated.incarnations.at(-1).writeScope, []);
  const result = memory.members(leader.projectId); result[0].incarnations.length = 0;
  assert.equal(memory.getMember(leader.projectId, worker.memberId).incarnations.length, L.incarnations);
  const preview = memory.snapshot(leader.projectId).members[0];
  assert.equal(preview.incarnationCount, L.incarnations);
  assert.equal(preview.incarnations, undefined);
  await f.restart();
  assert.deepEqual(f.memory.getMember(leader.projectId, worker.memberId), updated);
});

test('domain schema validates stored records on native open and rejects corruption rather than silently dropping it', async t => {
  const f = await fixture(t);
  const record = await f.memory.mutate(worker, note('valid schema fixture'));
  const raw = structuredClone(stored(f));
  assert.equal(projectMemoryDomain.tables.projects.valueSchema.safeParse({ ...raw, schemaVersion: 2 }).success, false);
  await f.memory.close();
  await assert.rejects(f.ctx.storageDomain.open({ ...projectMemoryDomain, version: 2 }), e => e.code === 'version-mismatch');
  const reopened = await openProjectMemory(f.ctx.storageDomain);
  raw.memories[0].author.role = 'administrator';
  assert.equal(projectMemoryDomain.tables.projects.valueSchema.safeParse(raw).success, false);
  const table = f.ctx.storageDomain.get(projectMemoryDomain.name).table('projects');
  const key = createHash('sha256').update(leader.projectId).digest('hex');
  // Exercise rc.2's real open validation (its direct put intentionally bypasses it).
  await table.put(key, raw);
  await reopened.close();
  await assert.rejects(openProjectMemory(f.ctx.storageDomain), e => e.code === 'invalid-record' && e.detail.table === 'projects');
  assert.equal(record.revision, 1);
});
