import { posix, win32 } from 'node:path';
import { reject } from './protocol.js';

const MAX_INPUT = 20 * 1024 * 1024;
const PDF_LIMITATIONS = [
  'Text-layer extraction only; no OCR is performed.',
  'Formulas, figures, reading order and layout may be lost or misrepresented.'
];

export function parseMaterialReadArgs(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['start_page', 'end_page', 'offset', 'limit'].includes(key))) {
    reject('MATERIAL_INVALID_RANGE', 'Only start_page, end_page, offset and limit are accepted', 'Correct the read parameters');
  }
  const start_page = args.start_page ?? 1, end_page = args.end_page ?? start_page;
  const offset = args.offset ?? 0, limit = args.limit ?? 8000;
  for (const [field, value, minimum] of [['start_page', start_page, 1], ['end_page', end_page, 1], ['offset', offset, 0], ['limit', limit, 1]]) {
    if ((Object.hasOwn(args, field) && args[field] == null) || !Number.isSafeInteger(value) || value < minimum) {
      reject('MATERIAL_INVALID_RANGE', `${field} must be a safe integer of at least ${minimum}`, 'Correct the read range', { field });
    }
  }
  if (end_page < start_page || end_page - start_page >= 10 || limit > 12000) {
    reject('MATERIAL_INVALID_RANGE', 'Read at most 10 ordered PDF pages and 12000 characters', 'Use a smaller valid range');
  }
  return { start_page, end_page, offset, limit };
}

function service(ctx, key, code = 'MATERIAL_SERVICE_UNAVAILABLE') {
  const value = ctx.get(key);
  if (!value) reject(code, `Native ${key} service is unavailable`, 'Ask the Leader to configure the required native service', { service: key });
  return value;
}

function sizeCheck(size) {
  if (size > MAX_INPUT) reject('MATERIAL_TOO_LARGE', 'Material exceeds the 20 MiB input limit', 'Share a smaller material');
}

async function rootTarget(ctx, agent, signal) {
  const fs = service(ctx, 'fs');
  const cwd = agent.session.header.cwd ?? process.cwd();
  const root = await fs.resolve(cwd, { signal });
  const info = await fs.stat(root, signal);
  if (info?.type !== 'directory') reject('MATERIAL_WORKSPACE_UNAVAILABLE', 'Workspace root is not an available directory', 'Ask the Leader to restore the workspace');
  return { fs, root, cwd: fs.processPath(root) };
}

async function inputBytes(ctx, agent, material, signal) {
  const source = material.source;
  if (source?.kind === 'attachment') {
    const ref = source.ref;
    if (!ref || typeof ref.attachmentId !== 'string' || !ref.attachmentId || typeof ref.name !== 'string' || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) {
      reject('MATERIAL_INVALID_SOURCE', 'An immutable attachment reference is required', 'Ask the Leader to select a registered attachment');
    }
    sizeCheck(ref.bytes);
    const attachments = service(ctx, 'attachments'), chunks = [];
    let size = 0;
    // Exhaust the authorized stream: its final iteration verifies hash and size.
    for await (const chunk of attachments.readFileStream(ref, signal)) {
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new Error('Invalid attachment stream chunk');
      size += chunk.byteLength;
      sizeCheck(size);
      chunks.push(Buffer.from(chunk));
    }
    if (size !== ref.bytes) reject('MATERIAL_INTEGRITY_FAILED', 'Attachment size does not match its immutable reference', 'Ask the Leader to re-upload the material');
    return Buffer.concat(chunks, size);
  }
  if (source?.kind !== 'workspace' || typeof source.path !== 'string' || !source.path || source.path.includes('\0') || posix.isAbsolute(source.path) || win32.isAbsolute(source.path) || /^[A-Za-z]:/.test(source.path) || source.path.split(/[\\/]/).includes('..')) {
    reject('MATERIAL_INVALID_SOURCE', 'A workspace-relative path or immutable attachment reference is required', 'Ask the Leader to select a registered material');
  }
  const { fs, root, cwd } = await rootTarget(ctx, agent, signal);
  // Resolve again on EVERY read; a previously shared symlink may have changed.
  const target = await fs.resolve(source.path, { cwd, signal });
  if (!fs.contains(root, target)) reject('MATERIAL_OUTSIDE_WORKSPACE', 'Material resolves outside the canonical workspace root', 'Ask the Leader to share a contained workspace file');
  const info = await fs.stat(target, signal);
  if (info?.type !== 'file') reject('MATERIAL_NOT_FILE', 'Material is not an available regular file', 'Ask the Leader to select a regular file');
  sizeCheck(info.size);
  const bytes = await fs.readBytes(target, signal, MAX_INPUT);
  sizeCheck(bytes.byteLength);
  return bytes;
}

function runnerFailed(confined, exitCode, stderr) {
  if (exitCode === 0 || exitCode == null) return false;
  const lines = stderr.split(/\r?\n/).map(line => line.trim().toLowerCase());
  return confined.runnerFailureRules.some(rule => (!rule.allowedExitCodes || rule.allowedExitCodes.includes(exitCode)) && lines.some(line => !rule.informationalLines?.some(info => line === info.trim().toLowerCase()) && rule.fatalSignatures.some(signature => line.includes(signature.toLowerCase()))));
}

async function pdfText(ctx, agent, bytes, range, signal) {
  const subprocess = service(ctx, 'subprocess', 'MATERIAL_PARSER_UNAVAILABLE');
  const sandbox = service(ctx, 'sandbox', 'MATERIAL_SANDBOX_UNAVAILABLE');
  let executable;
  try { executable = await subprocess.resolveExecutable('pdftotext', undefined, signal); }
  catch (error) {
    signal.throwIfAborted();
    reject('MATERIAL_PARSER_UNAVAILABLE', 'Native pdftotext executable is unavailable', 'Ask the Leader to configure pdftotext');
  }
  const { cwd } = await rootTarget(ctx, agent, signal);
  const argv = [executable, '-f', String(range.start_page), '-l', String(range.end_page), '-enc', 'UTF-8', '-', '-'];
  let confined;
  try { confined = await sandbox.confine(argv, { mode: 'read-only', workspaceRoot: cwd, sessionId: agent.id }, signal); }
  catch (error) {
    signal.throwIfAborted();
    reject('MATERIAL_SANDBOX_UNAVAILABLE', 'Read-only PDF sandbox is unavailable', 'Ask the Leader to repair native read-only confinement');
  }
  if (confined.enforcement !== 'full' || !Array.isArray(confined.argv) || !confined.argv.length || confined.argv.every((part, index) => part === argv[index]) && confined.argv.length === argv.length) {
    reject('MATERIAL_SANDBOX_UNAVAILABLE', 'Full read-only PDF confinement was not provided', 'Ask the Leader to configure a fully enforcing sandbox');
  }
  signal.throwIfAborted();
  let handle, settled = false;
  try {
    handle = subprocess.spawn({ argv: confined.argv, cwd, stdio: { stdin: 'pipe', stdout: { maxBytes: 128 * 1024 }, stderr: { maxBytes: 2048 } }, graceMs: 1000, signal });
    // pdftotext can close stdin early on invalid input. Drain its outcome before
    // classifying that failure; never surface unhandled EPIPE or parser output.
    let inputError;
    const onError = error => { inputError = error; };
    if (!handle.stdin) throw new Error('PDF process stdin unavailable');
    handle.stdin.on('error', onError);
    try {
      handle.stdin.end(bytes);
      const outcome = await handle.done;
      settled = true;
      signal.throwIfAborted();
      const stdout = handle.collected.stdout.readFrom(0), stderr = handle.collected.stderr.readFrom(0);
      if (runnerFailed(confined, outcome.exitCode, stderr.text)) reject('MATERIAL_SANDBOX_UNAVAILABLE', 'PDF sandbox runner failed before extraction', 'Ask the Leader to repair native read-only confinement');
      if (outcome.exitCode !== 0 || outcome.signal) {
        if (confined.denialSignatures.some(signature => stderr.text.toLowerCase().includes(signature.toLowerCase()))) reject('MATERIAL_SANDBOX_DENIED', 'Read-only sandbox denied PDF extraction', 'Ask the Leader to inspect the sandbox; do not retry unconfined');
        if (/wrong page range|first page.*last page/i.test(stderr.text)) reject('MATERIAL_INVALID_RANGE', 'PDF page range is outside this document', 'Select pages present in the document');
        reject('MATERIAL_PDF_INVALID', 'PDF extraction failed or the document is malformed', 'Ask the Leader to share a valid, unencrypted PDF', { exitCode: outcome.exitCode });
      }
      if (inputError || /syntax (?:error|warning)|couldn.t read xref|invalid xref|may not be a pdf/i.test(stderr.text)) reject('MATERIAL_PDF_INVALID', 'PDF parser reported malformed input', 'Ask the Leader to share a valid PDF');
      // Native collection retains the TAIL on overflow, not the requested head.
      if (stdout.lossy || stderr.lossy) reject('MATERIAL_EXTRACTION_TOO_LARGE', 'Bounded PDF output was incomplete', 'Read fewer pages or ask the Leader to share a smaller excerpt');
      // Default pdftotext emits one form feed per page, but silently clamps -l.
      const emittedPages = stdout.text.split('\f').length - 1;
      if (emittedPages && emittedPages < range.end_page - range.start_page + 1) reject('MATERIAL_INVALID_RANGE', 'PDF end_page is beyond the document', 'Select pages present in the document');
      return stdout.text;
    } finally { handle.stdin.off('error', onError); }
  } catch (error) {
    signal.throwIfAborted();
    if (error?.name === 'MentorProtocolError') throw error;
    reject('MATERIAL_SANDBOX_UNAVAILABLE', 'Confined PDF process could not complete', 'Ask the Leader to check the native parser and sandbox');
  } finally {
    if (handle && !settled) { handle.terminate(); handle.done.catch(() => {}); }
  }
}

async function readSelected(ctx, agent, material, args, signal) {
  signal.throwIfAborted();
  const range = parseMaterialReadArgs(args);
  if (!material || typeof material.id !== 'string' || !material.id || typeof material.name !== 'string') reject('MATERIAL_INVALID_SOURCE', 'A selected registered material is required', 'Ask the Leader to select a registered material');
  const bytes = await inputBytes(ctx, agent, material, signal);
  signal.throwIfAborted();
  const pdfHeader = Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-';
  const kind = pdfHeader || /\.pdf$/i.test(material.name) ? 'pdf' : 'text';
  let text;
  if (kind === 'pdf') {
    if (!pdfHeader) reject('MATERIAL_PDF_INVALID', 'Named PDF lacks a PDF header', 'Ask the Leader to share a valid PDF');
    text = await pdfText(ctx, agent, bytes, range, signal);
  } else {
    if (Object.hasOwn(args ?? {}, 'start_page') || Object.hasOwn(args ?? {}, 'end_page')) reject('MATERIAL_INVALID_RANGE', 'Page parameters apply only to PDF materials', 'Use offset and limit for UTF-8 text');
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { reject('MATERIAL_UNSUPPORTED_FORMAT', 'Material is neither a PDF nor valid UTF-8 text', 'Share a PDF with a text layer or UTF-8 text'); }
    if (/[\u0000-\u0008\u000e-\u001f\u007f]/.test(text)) reject('MATERIAL_UNSUPPORTED_FORMAT', 'Binary material is unsupported', 'Share a PDF with a text layer or UTF-8 text');
  }
  signal.throwIfAborted();
  if (range.offset > text.length) reject('MATERIAL_INVALID_RANGE', 'Offset is outside the extracted text range', 'Use an offset within the selected pages or text', { extractedLength: text.length });
  const end = Math.min(text.length, range.offset + range.limit), truncated = end < text.length;
  const noText = kind === 'pdf' && !text.trim();
  return {
    materialId: material.id, name: material.name, kind, text: text.slice(range.offset, end), truncated,
    nextOffset: truncated ? end : null, status: noText ? 'no_text' : 'ok',
    scope: { source: material.source.kind, ...(kind === 'pdf' ? { start_page: range.start_page, end_page: range.end_page, extraction: 'text_layer_only' } : {}), offset: range.offset, limit: range.limit, offsetUnit: 'UTF-16 code units' },
    limitations: kind === 'pdf' ? [...PDF_LIMITATIONS, ...(noText ? ['extraction_not_proven: no text was extracted; this does not prove the pages are empty.'] : [])] : []
  };
}

// Authorization and registry selection belong to the Leader, not this helper.
export async function readMaterial(ctx, agent, material, args = {}, signal) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('Material read deadline exceeded')), 15000);
  const active = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let onAbort;
  const aborted = new Promise((_, fail) => {
    onAbort = () => fail(active.reason);
    if (active.aborted) onAbort();
    else active.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([readSelected(ctx, agent, material, args, active), aborted]); }
  catch (error) {
    const fields = { materialId: material?.id ?? null };
    if (active.aborted) reject(signal?.aborted ? 'MATERIAL_CANCELLED' : 'MATERIAL_TIMEOUT', signal?.aborted ? 'Material read cancelled' : 'Material read exceeded its 15-second deadline', 'Retry only when the read is still needed', fields);
    if (error?.name === 'MentorProtocolError') throw error;
    if (error?.code === 'FS_TOO_LARGE') reject('MATERIAL_TOO_LARGE', 'Material exceeds the 20 MiB input limit', 'Share a smaller material', fields);
    if (error?.code === 'ATTACHMENT_CORRUPT') reject('MATERIAL_INTEGRITY_FAILED', 'Immutable attachment verification failed', 'Ask the Leader to re-upload the material', fields);
    reject('MATERIAL_READ_FAILED', 'Native material read failed; no content was returned', 'Ask the Leader to check the registered material and native read service', fields);
  } finally {
    clearTimeout(timer);
    active.removeEventListener('abort', onAbort);
  }
}
