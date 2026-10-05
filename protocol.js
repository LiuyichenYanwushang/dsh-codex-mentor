// Acceptance facts are structured; legacy text is decoded only for old assignments.
export function reject(code, reason, required_action, details = {}) {
  const diagnostic = { code, ...details, reason, required_action };
  throw Object.assign(new Error(JSON.stringify(diagnostic)), { name: 'MentorProtocolError', code, diagnostic });
}
function nonempty(value, field, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) reject('INVALID_FIELD', `${field} must be nonempty text of at most ${max} characters`, `Correct ${field}`, { field });
  return value.trim();
}
function array(value, field) {
  if (!Array.isArray(value) || !value.length || value.length > 16) reject('INVALID_CRITERIA', `${field} requires 1–16 entries`, 'Supply the assigned criterion IDs', { field });
  return value;
}
export function contractCriteria(value, acceptance) {
  const rows = value ?? [{ id: 'AC1', description: acceptance }];
  const seen = new Set();
  return array(rows, 'criteria').map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['id', 'description'].includes(key))) reject('INVALID_CRITERION', 'Each contract entry contains id and description only', 'Correct the contract entry', { field: `criteria[${index}]` });
    const id = nonempty(row.id, `criteria[${index}].id`, 32);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) reject('INVALID_CRITERION_ID', 'IDs must start with an ASCII letter and contain only letters, digits, _ or -', 'Choose a stable short ID', { criterion_id: id });
    if (seen.has(id)) reject('CRITERION_DUPLICATE', 'Contract IDs must be unique', 'Remove the duplicate before delegation', { criterion_id: id });
    seen.add(id);
    return { id, description: nonempty(row.description, `criteria[${index}].description`, 1000) };
  });
}
export function reportCriteria(value, contract = null) {
  const seen = new Set(), expected = contract?.map(row => row.id);
  const rows = array(value, 'report.criteria').map((row, index) => {
    if (typeof row === 'string' && !contract) {
      const text = nonempty(row, `criteria[${index}]`, 1000), match = text.match(/^([^:：]+)[:：]\s*(PASS|FAIL|UNVERIFIED)\b/i);
      row = { id: text.split(/[:：]/)[0].trim(), status: match ? match[2].toUpperCase() : 'UNVERIFIED', evidence: text, scope: 'Legacy report text; no additional coverage is implied.' };
    }
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['id', 'status', 'evidence', 'scope'].includes(key))) reject('REPORT_FORMAT_INVALID', 'Each result must contain id, status, evidence and scope; titles are not IDs', 'Return structured results using the immutable assignment IDs', { field: `criteria[${index}]`, expected_ids: expected ?? [] });
    const id = nonempty(row.id, `criteria[${index}].id`, contract ? 32 : 500);
    if (seen.has(id)) reject('CRITERION_DUPLICATE', 'A report criterion appears more than once', 'Return each assigned ID exactly once', { criterion_id: id });
    if (expected && !expected.includes(id)) reject('CRITERION_UNKNOWN', 'This ID is not in the immutable assignment', 'Remove the extra result; put correction history in deviations, not new criteria', { criterion_id: id, expected_ids: expected });
    seen.add(id);
    if (!['PASS', 'FAIL', 'UNVERIFIED'].includes(row.status)) reject('CRITERION_STATUS_INVALID', 'Status must be PASS, FAIL or UNVERIFIED', 'Set an explicit worker-claim status; PASS is not mentor acceptance', { criterion_id: id, field: `criteria[${index}].status` });
    return { id, status: row.status, evidence: nonempty(row.evidence, `criteria[${index}].evidence`, 1500), scope: nonempty(row.scope, `criteria[${index}].scope`, 1000) };
  });
  const missing = expected?.filter(id => !seen.has(id)) ?? [];
  if (missing.length) reject('CRITERION_MISSING', 'The report omits assigned criteria', 'Return results for these IDs, including UNVERIFIED where necessary', { criterion_id: missing[0], missing_ids: missing });
  return rows;
}
export function permissions(writeScope) {
  const writable = !!writeScope?.length;
  return { file_read: 'allowed', file_write: writable ? 'allowed' : 'denied', shell: writable ? 'allowed' : 'denied', tests: writable ? 'allowed' : 'denied' };
}
export function evidenceReuse(check, task, cwd) {
  if (check.execution_status === 'running') return { reusable: false, code: 'VERIFICATION_RUNNING', required_action: 'Collect the job completion before using it for acceptance' };
  if (check.isError || check.executionSucceeded === false) return { reusable: false, code: 'VERIFICATION_FAILED', required_action: 'Run a successful independent check and interpret its result' };
  if (task.report?.id && check.readyReportId === task.report.id) return { reusable: true, basis: 'latest-report' };
  const eligible = !task.writeScope?.length && check.inputs?.length && check.inputScope?.length && ['read', 'read_image'].includes(check.tool) && check.executionScope === cwd && check.directInput;
  return eligible ? { reusable: null, code: 'FINGERPRINT_RECHECK_REQUIRED', required_action: 'Acceptance will recheck all declared input fingerprints', basis: 'read-only-inputs' } : { reusable: false, code: 'EVIDENCE_NOT_REUSABLE', required_action: 'Run a fresh check against the latest report', reason: 'Older-report evidence lacks a complete eligible read-only input binding' };
}
export function taskSummary(task, activity = 'not-live') {
  const submission = task.report?.evidenceGate ? task.report : task.lastSubmittedReport?.evidenceGate ? task.lastSubmittedReport : null;
  const submitted = !!submission;
  let criteria;
  try { criteria = task.criteria ?? reportCriteria(task.report?.evidenceGate?.criteria).map(({ id }) => ({ id })); } catch { criteria = task.criteria ?? []; }
  return {
    taskId: task.taskId ?? null, runId: task.runId ?? null, childId: task.childId ?? null, goal: task.goal?.slice(0, 200) ?? '', status: task.status,
    workerModel: task.route ? { provider: task.route.provider ?? null, model: task.route.model ?? null, maxTokens: task.route.maxTokens ?? null, selection: task.modelSelection ?? 'recorded' } : null,
    execution: { activity, stoppedWithoutReport: task.status === 'stopped' && !submitted },
    report: { state: submitted ? 'submitted' : task.report ? task.report.status : 'none', id: submission?.id ?? task.report?.id ?? null, latestUpdateStatus: task.report?.status ?? null, latestUpdateId: task.report?.id ?? null },
    acceptance: { state: task.status === 'accepted' ? 'accepted' : task.status === 'acceptance_blocked' ? 'acceptance_blocked' : task.status === 'closed-unaccepted' ? 'closed-unaccepted' : task.status === 'cancelled' ? 'cancelled' : 'not-accepted', diagnostic: task.acceptanceBlock && task.report?.id && task.acceptanceBlock.reportId === task.report.id ? task.acceptanceBlock.diagnostic : null },
    criteria: criteria.map(({ id, description }) => ({ id, ...(description ? { description: description.slice(0, 200) } : {}) })),
    blocker: task.report?.status === 'blocked' ? task.report.question?.slice(0, 500) ?? '' : '', next: task.guidance?.nextSteps?.slice(0, 400) ?? '', latestVerificationId: task.verifications?.at(-1)?.id ?? null,
    permissions: permissions(task.writeScope), registeredChecks: task.verifications?.length ?? 0
  };
}
