import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { readMaterial, parseMaterialReadArgs } from '../material-reader.js';

const runtime = createRequire(resolve(process.env.DSH_RUNTIME_DIR ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh'), 'package.json'));
registerHooks({ resolve(specifier, context, next) { return next((specifier.startsWith('@deepseek-ai/') || specifier === 'zod') ? runtime.resolve(specifier) : specifier, context); } });
const MAX_INPUT = 20 * 1024 * 1024;
const agent = { id: 'material-fixture', session: { header: { cwd: '/fixture/workspace' } } };
const pdfBytes = Buffer.from('%PDF-1.4\n%%EOF\n');
const code = expected => error => {
  assert.equal(error.name, 'MentorProtocolError');
  assert.equal(error.code, expected);
  assert.equal(error.diagnostic.code, expected);
  assert.ok(error.diagnostic.reason && error.diagnostic.required_action);
  return true;
};

function fixture(bytes = Buffer.from('hello UTF-8 世界'), options = {}) {
  const calls = { streams: 0, exhausted: false, resolve: [], readBytes: [], spawn: [], confine: [], executable: [], terminated: 0 };
  const source = options.workspace ? { kind: 'workspace', path: 'material.txt' } : { kind: 'attachment', ref: { attachmentId: 'fixture-immutable-ref', name: options.name ?? 'material.txt', bytes: bytes.length } };
  const material = { id: 'M1', name: options.name ?? 'material.txt', source };
  const target = path => ({ targetKey: path, displayPath: path });
  const fs = {
    async resolve(path, opts) { calls.resolve.push({ path, opts }); return target(path === agent.session.header.cwd ? path : options.escape ? '/outside/private.txt' : '/fixture/workspace/material.txt'); },
    contains(parent, child) { return child.targetKey.startsWith(parent.targetKey + '/'); },
    async stat(item, signal) { assert.ok(signal instanceof AbortSignal); return item.targetKey === agent.session.header.cwd ? { type: 'directory', version: 'fixture-root' } : { type: 'file', version: 'fixture-file', size: options.size ?? bytes.length }; },
    processPath(item) { return item.displayPath; },
    async readBytes(item, signal, maxBytes) { calls.readBytes.push({ item, signal, maxBytes }); return bytes; }
  };
  const attachments = {
    async *readFileStream(ref, signal) {
      calls.streams++; assert.equal(ref, source.ref); assert.ok(signal instanceof AbortSignal);
      yield bytes.subarray(0, Math.min(3, bytes.length));
      yield bytes.subarray(Math.min(3, bytes.length));
      if (options.streamError) throw options.streamError;
      calls.exhausted = true;
    }
  };
  const subprocess = {
    async resolveExecutable(command, env, signal) { calls.executable.push({ command, env, signal }); if (options.parserError) throw options.parserError; return '/usr/bin/pdftotext'; },
    spawn(spec) {
      calls.spawn.push(spec);
      assert.equal(calls.exhausted, !options.workspace, 'Authorized attachment iteration finishes before process sees bytes');
      let complete;
      const done = new Promise(resolveDone => { complete = resolveDone; });
      const received = [];
      const stdin = new Writable({ write(chunk, _encoding, callback) { received.push(Buffer.from(chunk)); callback(); }, final(callback) {
        assert.deepEqual(Buffer.concat(received), bytes);
        complete({ exitCode: options.exitCode ?? 0, signal: options.exitSignal ?? null }); callback();
      } });
      const output = text => ({ readFrom(offset) { assert.equal(offset, 0); return { text, nextOffset: Buffer.byteLength(text), lossy: !!options.lossy }; } });
      return { stdin, done, collected: { stdout: output(options.stdout ?? 'Page one text\n\f'), stderr: output(options.stderr ?? '') }, terminate() { calls.terminated++; } };
    }
  };
  const sandbox = {
    async confine(argv, policy, signal) {
      calls.confine.push({ argv, policy, signal });
      if (options.sandboxError) throw options.sandboxError;
      return { argv: options.passthrough ? argv : ['/native/read-only-runner', '--', ...argv], enforcement: options.enforcement ?? 'full', denialSignatures: ['permission denied'], runnerFailureRules: [{ allowedExitCodes: [125], fatalSignatures: ['runner failed'], informationalLines: ['runner failed (informational)'] }] };
    }
  };
  const services = { fs, attachments, subprocess, sandbox };
  return { ctx: { get: key => services[key] }, services, material, calls };
}

function tinyPdf(pages = ['Fixture first page', 'Fixture second page']) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  for (let index = 0; index < pages.length; index++) {
    const stream = pages[index] ? `BT /F1 18 Tf 50 100 Td (${pages[index]}) Tj ET\n` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  let pdf = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function nativeKernel(cwd) {
  const { Context } = await import('@deepseek-ai/cordis');
  const ctx = new Context();
  for (const name of ['dsh-fs-local', 'dsh-subprocess-local', 'dsh-sandbox-local']) {
    const mod = await import('@deepseek-ai/' + name);
    await ctx.plugin(mod.default ?? mod, name === 'dsh-fs-local' ? { cwd } : {});
  }
  return ctx;
}

async function cleanFixture(root) {
  const target = resolve(root);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^dsh-material-reader-/);
  await rm(target, { recursive: true, force: true });
}

test('UTF-8 attachment reads exhaust the verified stream and paginate only bounded text', async () => {
  const f = fixture(Buffer.from('a'.repeat(20000)));
  const result = await readMaterial(f.ctx, agent, f.material, {});
  assert.equal(f.calls.exhausted, true); assert.equal(f.calls.streams, 1);
  assert.equal(result.kind, 'text'); assert.equal(result.text.length, 8000);
  assert.equal(result.truncated, true); assert.equal(result.nextOffset, 8000);
  assert.equal(result.status, 'ok'); assert.equal(result.materialId, 'M1');
  assert.equal(result.scope.offsetUnit, 'UTF-16 code units');
  const next = await readMaterial(f.ctx, agent, f.material, { offset: result.nextOffset, limit: 12000 });
  assert.equal(next.text.length, 12000); assert.equal(next.truncated, false); assert.equal(next.nextOffset, null);
  assert.equal(f.calls.spawn.length, 0);
  const unicode = fixture(Buffer.from('Hello 世界!'));
  assert.equal((await readMaterial(unicode.ctx, agent, unicode.material, { offset: 6, limit: 2 })).text, '世界');
});

test('invalid ranges fail structurally, including null, noninteger, negative and over-limit values', async () => {
  assert.deepEqual(parseMaterialReadArgs({ start_page: 4 }), { start_page: 4, end_page: 4, offset: 0, limit: 8000 });
  assert.equal(parseMaterialReadArgs({ start_page: 1, end_page: 10, limit: 12000 }).end_page, 10);
  for (const args of [null, [], { limit: 0 }, { limit: 12001 }, { offset: -1 }, { offset: 0.5 }, { start_page: 0 }, { end_page: 0 }, { start_page: 2, end_page: 1 }, { end_page: 11 }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { limit: '5' }, { limit: null }, { arbitrary: true }]) assert.throws(() => parseMaterialReadArgs(args), code('MATERIAL_INVALID_RANGE'));
  const f = fixture();
  await assert.rejects(readMaterial(f.ctx, agent, f.material, { offset: 999 }), code('MATERIAL_INVALID_RANGE'));
  await assert.rejects(readMaterial(f.ctx, agent, f.material, { start_page: 1 }), code('MATERIAL_INVALID_RANGE'));
});

test('arbitrary binary and invalid UTF-8 never become lossy text', async () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('binary\0data'), Buffer.from('PK\x03\x04zip'), Buffer.from([0x89, 0x50, 0x4e, 0x47])]) {
    const f = fixture(bytes);
    await assert.rejects(readMaterial(f.ctx, agent, f.material, {}), code('MATERIAL_UNSUPPORTED_FORMAT'));
  }
});

test('input limits enforce metadata, actual streams, bytes and native FS failures', async () => {
  const declared = fixture(); declared.material.source.ref.bytes = MAX_INPUT + 1;
  await assert.rejects(readMaterial(declared.ctx, agent, declared.material, {}), code('MATERIAL_TOO_LARGE'));
  assert.equal(declared.calls.streams, 0);
  const stream = fixture(Buffer.alloc(MAX_INPUT + 1)); stream.material.source.ref.bytes = MAX_INPUT;
  await assert.rejects(readMaterial(stream.ctx, agent, stream.material, {}), code('MATERIAL_TOO_LARGE'));
  const workspace = fixture(undefined, { workspace: true, size: MAX_INPUT + 1 });
  await assert.rejects(readMaterial(workspace.ctx, agent, workspace.material, {}), code('MATERIAL_TOO_LARGE'));
  assert.equal(workspace.calls.readBytes.length, 0);
  const grown = fixture(undefined, { workspace: true });
  grown.services.fs.readBytes = async () => { throw Object.assign(new Error('Native limit'), { code: 'FS_TOO_LARGE' }); };
  await assert.rejects(readMaterial(grown.ctx, agent, grown.material, {}), code('MATERIAL_TOO_LARGE'));
  const boundary = fixture(Buffer.alloc(MAX_INPUT, 0x61));
  assert.equal((await readMaterial(boundary.ctx, agent, boundary.material, { limit: 1 })).text, 'a');
});

test('final attachment hash/size errors expose neither prefix text nor parser input', async () => {
  const f = fixture(pdfBytes, { name: 'fixture.pdf', streamError: Object.assign(new Error('private raw integrity diagnostic'), { code: 'ATTACHMENT_CORRUPT' }) });
  await assert.rejects(readMaterial(f.ctx, agent, f.material, {}), error => { code('MATERIAL_INTEGRITY_FAILED')(error); assert.ok(!error.message.includes('private raw')); return true; });
  assert.equal(f.calls.spawn.length, 0); assert.equal(f.calls.exhausted, false);
  const mismatch = fixture(); mismatch.material.source.ref.bytes++;
  await assert.rejects(readMaterial(mismatch.ctx, agent, mismatch.material, {}), code('MATERIAL_INTEGRITY_FAILED'));
});

test('workspace containment uses canonical native targets, fresh resolution and bounded readBytes', async () => {
  const f = fixture(undefined, { workspace: true });
  await readMaterial(f.ctx, agent, f.material, {}); await readMaterial(f.ctx, agent, f.material, {});
  assert.equal(f.calls.resolve.filter(call => call.path === 'material.txt').length, 2);
  assert.equal(f.calls.resolve.filter(call => call.path === agent.session.header.cwd).length, 2);
  assert.ok(f.calls.readBytes.every(call => call.maxBytes === MAX_INPUT && call.signal instanceof AbortSignal));
  const escape = fixture(undefined, { workspace: true, escape: true });
  await assert.rejects(readMaterial(escape.ctx, agent, escape.material, {}), code('MATERIAL_OUTSIDE_WORKSPACE'));
  assert.equal(escape.calls.readBytes.length, 0);
  for (const path of ['/etc/passwd', '../private.txt', 'dir/../../outside', 'C:\\private.txt', 'C:private.txt', '\\\\server\\share', 'x\0y']) {
    f.material.source.path = path;
    await assert.rejects(readMaterial(f.ctx, agent, f.material, {}), code('MATERIAL_INVALID_SOURCE'));
  }
});

test('PDF parser gets only fixed argv, read-only policy, full verified stdin, bounded output and no spill', async () => {
  const f = fixture(pdfBytes, { name: 'untrusted name; shell.pdf', stdout: 'page text'.repeat(2000) });
  const result = await readMaterial(f.ctx, agent, f.material, {});
  assert.equal(result.kind, 'pdf'); assert.equal(result.text.length, 8000);
  assert.equal(result.scope.start_page, 1); assert.equal(result.scope.end_page, 1);
  assert.ok(result.limitations.some(text => /no OCR/.test(text)));
  assert.ok(result.limitations.some(text => /Formulas, figures.*layout/.test(text)));
  const wrap = f.calls.confine[0], spec = f.calls.spawn[0];
  assert.deepEqual(wrap.argv, ['/usr/bin/pdftotext', '-f', '1', '-l', '1', '-enc', 'UTF-8', '-', '-']);
  assert.deepEqual(wrap.policy, { mode: 'read-only', workspaceRoot: '/fixture/workspace', sessionId: agent.id });
  assert.deepEqual(spec.argv, ['/native/read-only-runner', '--', ...wrap.argv]);
  assert.deepEqual(spec.stdio, { stdin: 'pipe', stdout: { maxBytes: 128 * 1024 }, stderr: { maxBytes: 2048 } });
  assert.equal(spec.graceMs, 1000); assert.ok(spec.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(spec).sort(), ['argv', 'cwd', 'graceMs', 'signal', 'stdio']);
  assert.equal(f.calls.executable[0].command, 'pdftotext'); assert.equal(f.calls.executable[0].env, undefined);
  await readMaterial(f.ctx, agent, f.material, { start_page: 2, end_page: 4, offset: 1, limit: 10 });
  assert.deepEqual(f.calls.confine[1].argv.slice(1), ['-f', '2', '-l', '4', '-enc', 'UTF-8', '-', '-']);
});

test('empty PDF output is no_text/extraction_not_proven, never an OCR or empty-page proof', async () => {
  const f = fixture(pdfBytes, { stdout: '\n\f\n' });
  const result = await readMaterial(f.ctx, agent, f.material, {});
  assert.equal(result.kind, 'pdf'); assert.equal(result.status, 'no_text');
  assert.ok(result.limitations.some(text => /extraction_not_proven/.test(text)));
  assert.equal(result.scope.extraction, 'text_layer_only');
});

test('PDF malformed, nonzero, bad-page and lossy extraction outputs fail closed', async () => {
  for (const [options, expected] of [
    [{ exitCode: 1, stderr: 'secret raw pdf failure' }, 'MATERIAL_PDF_INVALID'],
    [{ stderr: 'Syntax Error: broken xref', stdout: 'partial secret text' }, 'MATERIAL_PDF_INVALID'],
    [{ stderr: 'Syntax Warning: broken catalog' }, 'MATERIAL_PDF_INVALID'],
    [{ exitSignal: 'SIGTERM' }, 'MATERIAL_PDF_INVALID'],
    [{ exitCode: 99, stderr: 'Wrong page range given' }, 'MATERIAL_INVALID_RANGE'],
    [{ lossy: true, stdout: 'retained tail is not the requested prefix' }, 'MATERIAL_EXTRACTION_TOO_LARGE']
  ]) {
    const f = fixture(pdfBytes, options);
    await assert.rejects(readMaterial(f.ctx, agent, f.material, {}), error => { code(expected)(error); assert.ok(!error.message.includes('secret')); return true; });
  }
  const named = fixture(Buffer.from('not PDF'), { name: 'broken.pdf' });
  await assert.rejects(readMaterial(named.ctx, agent, named.material, {}), code('MATERIAL_PDF_INVALID'));
  assert.equal(named.calls.spawn.length, 0);
});

test('missing parser/sandbox, partial or unconfined wrappers and runner failures never retry unconfined', async () => {
  for (const [options, expected] of [
    [{ parserError: new Error('not installed') }, 'MATERIAL_PARSER_UNAVAILABLE'],
    [{ sandboxError: new Error('unavailable') }, 'MATERIAL_SANDBOX_UNAVAILABLE'],
    [{ enforcement: 'partial' }, 'MATERIAL_SANDBOX_UNAVAILABLE'],
    [{ passthrough: true }, 'MATERIAL_SANDBOX_UNAVAILABLE'],
    [{ exitCode: 125, stderr: 'RUNNER FAILED: Permission denied' }, 'MATERIAL_SANDBOX_UNAVAILABLE'],
    [{ exitCode: 1, stderr: 'Permission denied' }, 'MATERIAL_SANDBOX_DENIED'],
    [{ exitCode: 125, stderr: 'runner failed (informational)' }, 'MATERIAL_PDF_INVALID']
  ]) {
    const f = fixture(pdfBytes, options);
    await assert.rejects(readMaterial(f.ctx, agent, f.material, {}), code(expected));
    assert.ok(f.calls.spawn.length <= 1);
  }
  for (const [key, expected] of [['attachments', 'MATERIAL_SERVICE_UNAVAILABLE'], ['subprocess', 'MATERIAL_PARSER_UNAVAILABLE'], ['sandbox', 'MATERIAL_SANDBOX_UNAVAILABLE']]) {
    const f = fixture(pdfBytes); delete f.services[key];
    await assert.rejects(readMaterial(f.ctx, agent, f.material, {}), code(expected));
  }
});

test('pre-abort and in-flight cancellation propagate to native services without prefix output', async () => {
  const before = fixture(), cancelled = new AbortController(); cancelled.abort(new Error('user cancelled'));
  await assert.rejects(readMaterial(before.ctx, agent, before.material, {}, cancelled.signal), code('MATERIAL_CANCELLED'));
  assert.equal(before.calls.streams, 0);
  const f = fixture(), controller = new AbortController(); let seen;
  f.services.attachments.readFileStream = async function* (_ref, signal) {
    seen = signal; yield Buffer.from('never returned');
    controller.abort(new Error('during stream'));
    signal.throwIfAborted();
  };
  await assert.rejects(readMaterial(f.ctx, agent, f.material, {}, controller.signal), code('MATERIAL_CANCELLED'));
  assert.equal(seen.aborted, true);
});

test('PDF process cancellation and spawn failures remain structured and terminate the native handle', async () => {
  const f = fixture(pdfBytes), controller = new AbortController(); let specSeen, stopped = false;
  f.services.subprocess.spawn = spec => {
    specSeen = spec;
    const done = new Promise((_, fail) => spec.signal.addEventListener('abort', () => fail(spec.signal.reason), { once: true }));
    queueMicrotask(() => controller.abort(new Error('cancel parser')));
    return { stdin: new Writable({ write(_chunk, _encoding, callback) { callback(); } }), done, terminate() { stopped = true; } };
  };
  await assert.rejects(readMaterial(f.ctx, agent, f.material, {}, controller.signal), code('MATERIAL_CANCELLED'));
  await Promise.resolve();
  assert.equal(specSeen.signal.aborted, true); assert.equal(stopped, true);
  const broken = fixture(pdfBytes);
  broken.services.subprocess.spawn = () => { throw new Error('private spawn diagnostic'); };
  await assert.rejects(readMaterial(broken.ctx, agent, broken.material, {}), error => { code('MATERIAL_SANDBOX_UNAVAILABLE')(error); assert.ok(!error.message.includes('private spawn')); return true; });
});

test('15-second deadline rejects hanging native reads and carries the same aborted signal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); let seen;
  f.services.attachments.readFileStream = async function* (_ref, signal) { seen = signal; await new Promise(() => {}); };
  const pending = readMaterial(f.ctx, agent, f.material, {});
  t.mock.timers.tick(14999); assert.equal(seen.aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(pending, code('MATERIAL_TIMEOUT'));
  assert.equal(seen.aborted, true);
});

test('native Context filesystem rejects a changed symlink on the next read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-material-reader-'));
  let ctx;
  try {
    const cwd = join(root, 'workspace'); await mkdir(cwd);
    await writeFile(join(cwd, 'inside.txt'), 'synthetic inside');
    await writeFile(join(root, 'outside.txt'), 'synthetic outside; never exposed');
    const alias = join(cwd, 'alias.txt'); await symlink('inside.txt', alias);
    ctx = await nativeKernel(cwd);
    const subject = { id: 'native-material-fs', session: { header: { cwd } } };
    const material = { id: 'native-text', name: 'alias.txt', source: { kind: 'workspace', path: 'alias.txt' } };
    assert.equal((await readMaterial(ctx, subject, material, {})).text, 'synthetic inside');
    assert.equal(resolve(alias), join(cwd, 'alias.txt')); assert.equal(dirname(resolve(alias)), cwd);
    await unlink(alias); await symlink('../outside.txt', alias);
    await assert.rejects(readMaterial(ctx, subject, material, {}), code('MATERIAL_OUTSIDE_WORKSPACE'));
  } finally { await ctx?.fiber.dispose(); await cleanFixture(root); }
});

test('native installed pdftotext extracts generated two-page text-layer PDF through full read-only sandbox', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-material-reader-'));
  let ctx;
  try {
    ctx = await nativeKernel(root);
    const subject = { id: 'native-material-pdf', session: { header: { cwd: root } } };
    const bytes = tinyPdf(), f = fixture(bytes, { name: 'two-page.pdf' });
    const nativeServices = { get: key => key === 'attachments' ? f.services.attachments : ctx.get(key) };
    const specs = [], wraps = [], nativeSpawn = ctx.subprocess.spawn.bind(ctx.subprocess), nativeConfine = ctx.sandbox.confine.bind(ctx.sandbox);
    ctx.subprocess.spawn = spec => { specs.push(spec); return nativeSpawn(spec); };
    ctx.sandbox.confine = async (...args) => { const result = await nativeConfine(...args); wraps.push({ policy: args[1], result }); return result; };
    let first;
    try { first = await readMaterial(nativeServices, subject, f.material, {}); }
    catch (error) {
      if (['MATERIAL_PARSER_UNAVAILABLE', 'MATERIAL_SANDBOX_UNAVAILABLE'].includes(error.code)) { t.skip('Native parser/full sandbox unavailable: ' + error.diagnostic.reason); return; }
      throw error;
    }
    assert.match(first.text, /Fixture first page/); assert.ok(!first.text.includes('Fixture second page'));
    const both = await readMaterial(nativeServices, subject, f.material, { start_page: 1, end_page: 2 });
    assert.match(both.text, /Fixture first page/); assert.match(both.text, /Fixture second page/);
    const second = await readMaterial(nativeServices, subject, f.material, { start_page: 2 });
    assert.match(second.text, /Fixture second page/); assert.ok(!second.text.includes('Fixture first page'));
    await assert.rejects(readMaterial(nativeServices, subject, f.material, { start_page: 3 }), code('MATERIAL_INVALID_RANGE'));
    await assert.rejects(readMaterial(nativeServices, subject, f.material, { end_page: 3 }), code('MATERIAL_INVALID_RANGE'));
    const malformed = fixture(Buffer.from('%PDF-1.4\nnot a valid document'), { name: 'malformed.pdf' });
    const badServices = { get: key => key === 'attachments' ? malformed.services.attachments : ctx.get(key) };
    await assert.rejects(readMaterial(badServices, subject, malformed.material, {}), code('MATERIAL_PDF_INVALID'));
    const blank = fixture(tinyPdf(['']), { name: 'blank.pdf' });
    const blankServices = { get: key => key === 'attachments' ? blank.services.attachments : ctx.get(key) };
    assert.equal((await readMaterial(blankServices, subject, blank.material, {})).status, 'no_text');
    assert.ok(wraps.every(wrap => wrap.policy.mode === 'read-only' && wrap.result.enforcement === 'full'));
    assert.ok(specs.every(spec => !('spill' in spec.stdio.stdout) && !('spill' in spec.stdio.stderr)));
    t.diagnostic('Actual native pdftotext two-page extraction, invalid-page/malformed/blank checks; full read-only runner: ' + wraps[0].result.argv[0]);
  } finally { await ctx?.fiber.dispose(); await cleanFixture(root); }
});
