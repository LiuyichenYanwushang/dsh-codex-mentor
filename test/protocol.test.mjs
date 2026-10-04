import test from 'node:test';
import assert from 'node:assert/strict';
import { contractCriteria, reportCriteria, reject, evidenceReuse, taskSummary, permissions } from '../protocol.js';

const contract = Object.freeze([
  Object.freeze({ id: 'AC1', description: 'Inspect entry points' }),
  Object.freeze({ id: 'AC2', description: 'Verify dependencies' }),
]);
const row = (id, status = 'PASS') => ({ id, status, evidence: 'Independent check recorded', scope: 'Declared inputs only' });
const reportTask = () => ({
  taskId: 'task-1', runId: 'run-1', childId: 'child-1', goal: 'Inspect the project',
  status: 'reported', criteria: contract, writeScope: [],
  report: { id: 'report-2', status: 'submitted', evidenceGate: { criteria: contract.map(({ id }) => row(id)) } },
  verifications: [{ id: 'check-1' }],
});
const oldRead = () => ({
  readyReportId: 'report-1', execution_status: 'completed', executionSucceeded: true,
  tool: 'read', executionScope: '/workspace', directInput: true,
  inputs: [{ path: '/workspace/entry.js', fingerprint: 'old-fingerprint' }], inputScope: ['/workspace/entry.js'],
});

function diagnostic(fn, expected) {
  assert.throws(fn, error => {
    assert.equal(error.name, 'MentorProtocolError');
    assert.deepEqual(JSON.parse(error.message), error.diagnostic);
    assert.equal(error.code, error.diagnostic.code);
    assert.equal(typeof error.diagnostic.reason, 'string');
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(error.diagnostic[key], value);
    return true;
  });
}

test('reject exposes precise machine-readable JSON diagnostics', () => {
  diagnostic(() => reject('CUSTOM_REJECTION', 'Not independently checked', 'Run the required check', { criterion_id: 'AC2' }), {
    code: 'CUSTOM_REJECTION', criterion_id: 'AC2', required_action: 'Run the required check',
  });
});

test('contract keeps explicit IDs and descriptions without mutating assignment input', () => {
  const normalized = contractCriteria(contract, 'Ignored fallback');
  assert.deepEqual(normalized, contract);
  assert.notEqual(normalized, contract);
  assert.notEqual(normalized[0], contract[0]);
  const mutableInput = [{ ...contract[0] }];
  const snapshot = contractCriteria(mutableInput);
  mutableInput[0].id = 'Changed';
  mutableInput[0].description = 'Changed';
  assert.deepEqual(snapshot, [contract[0]]);
  assert.deepEqual(contractCriteria([{ id: 'Stable_ID-2', description: 'A: natural title; preserve it' }]), [
    { id: 'Stable_ID-2', description: 'A: natural title; preserve it' },
  ]);
});

test('omitted contract defaults to AC1 rather than guessing IDs from acceptance text', () => {
  const description = 'A: 项目定位、入口、依赖与模块概览';
  assert.deepEqual(contractCriteria(undefined, description), [{ id: 'AC1', description }]);
  diagnostic(() => contractCriteria([description]), {
    code: 'INVALID_CRITERION', required_action: 'Correct the contract entry',
  });
  diagnostic(() => contractCriteria([{ id: description, description: 'Do not infer A' }]), {
    code: 'INVALID_CRITERION_ID', criterion_id: description, required_action: 'Choose a stable short ID',
  });
});

test('contract rejects duplicate IDs and unexpected entry fields', () => {
  diagnostic(() => contractCriteria([contract[0], contract[0]]), {
    code: 'CRITERION_DUPLICATE', criterion_id: 'AC1', required_action: 'Remove the duplicate before delegation',
  });
  diagnostic(() => contractCriteria([{ ...contract[0], status: 'PASS' }]), {
    code: 'INVALID_CRITERION', required_action: 'Correct the contract entry',
  });
});

test('structured report preserves explicit worker claims, evidence and scope', () => {
  for (const status of ['PASS', 'FAIL', 'UNVERIFIED']) {
    const input = Object.freeze({ id: ' AC1 ', status, evidence: ' check result ', scope: ' only entry.js ' });
    assert.deepEqual(reportCriteria([input], [contract[0]]), [{ id: 'AC1', status, evidence: 'check result', scope: 'only entry.js' }]);
    assert.equal(input.id, ' AC1 ');
  }
  assert.deepEqual(reportCriteria([row('AC2'), row('AC1')], contract).map(result => result.id), ['AC2', 'AC1']);
});

test('fixed report rejects extra Rework and natural-text IDs precisely', () => {
  for (const id of ['Rework', 'A: 项目定位、入口、依赖与模块概览']) {
    diagnostic(() => reportCriteria([...contract.map(({ id }) => row(id)), row(id)], contract), {
      code: 'CRITERION_UNKNOWN', criterion_id: id, expected_ids: ['AC1', 'AC2'],
      required_action: 'Remove the extra result; put correction history in deviations, not new criteria',
    });
  }
});

test('fixed report rejects duplicate IDs precisely', () => {
  diagnostic(() => reportCriteria([row('AC1'), row('AC1'), row('AC2')], contract), {
    code: 'CRITERION_DUPLICATE', criterion_id: 'AC1', required_action: 'Return each assigned ID exactly once',
  });
});

test('fixed report diagnoses the exact missing IDs and requests explicit unverified rows', () => {
  diagnostic(() => reportCriteria([row('AC2')], contract), {
    code: 'CRITERION_MISSING', criterion_id: 'AC1', missing_ids: ['AC1'],
    required_action: 'Return results for these IDs, including UNVERIFIED where necessary',
  });
  diagnostic(() => reportCriteria([row('AC1')], [...contract, { id: 'AC3', description: 'Inspect remaining input' }]), {
    code: 'CRITERION_MISSING', criterion_id: 'AC2', missing_ids: ['AC2', 'AC3'],
    required_action: 'Return results for these IDs, including UNVERIFIED where necessary',
  });
});

test('fixed contracts reject legacy strings rather than interpreting natural-text IDs', () => {
  diagnostic(() => reportCriteria(['AC1：PASS checked'], [contract[0]]), {
    code: 'REPORT_FORMAT_INVALID', expected_ids: ['AC1'],
    required_action: 'Return structured results using the immutable assignment IDs',
  });
});

test('structured report requires valid status, evidence, scope and no extra fields', () => {
  for (const status of [undefined, 'pass', 'ACCEPTED']) {
    diagnostic(() => reportCriteria([{ ...row('AC1'), status }], [contract[0]]), {
      code: 'CRITERION_STATUS_INVALID', criterion_id: 'AC1',
      required_action: 'Set an explicit worker-claim status; PASS is not mentor acceptance',
    });
  }
  for (const field of ['evidence', 'scope']) {
    diagnostic(() => reportCriteria([{ ...row('AC1'), [field]: ' ' }], [contract[0]]), {
      code: 'INVALID_FIELD', field: `criteria[0].${field}`, required_action: `Correct criteria[0].${field}`,
    });
  }
  diagnostic(() => reportCriteria([{ ...row('AC1'), accepted: true }], [contract[0]]), {
    code: 'REPORT_FORMAT_INVALID', required_action: 'Return structured results using the immutable assignment IDs',
  });
});

test('legacy strings decode explicit statuses including Chinese colons without a fixed contract', () => {
  const texts = ['A：PASS 已检查', 'B: fail check failed', 'C：UNVERIFIED 待验证'];
  const results = reportCriteria(texts);
  assert.deepEqual(results.map(({ id, status }) => ({ id, status })), [
    { id: 'A', status: 'PASS' }, { id: 'B', status: 'FAIL' }, { id: 'C', status: 'UNVERIFIED' },
  ]);
  assert.deepEqual(results.map(({ evidence }) => evidence), texts);
  assert.ok(results.every(({ scope }) => scope === 'Legacy report text; no additional coverage is implied.'));
});

test('legacy title regression is UNVERIFIED, never guessed accepted', () => {
  const text = 'A: 项目定位、入口、依赖与模块概览';
  const criteria = reportCriteria([text, 'B: finished work; PASS mentioned later']);
  assert.deepEqual(criteria.map(({ id, status }) => ({ id, status })), [
    { id: 'A', status: 'UNVERIFIED' }, { id: 'B', status: 'UNVERIFIED' },
  ]);
  const task = reportTask();
  delete task.criteria;
  task.report.evidenceGate.criteria = [text];
  assert.equal(taskSummary(task).acceptance.state, 'not-accepted');
  assert.deepEqual(taskSummary(task).criteria, [{ id: 'A' }]);
});

test('latest-report evidence is reusable only after successful completion', () => {
  const task = reportTask();
  assert.deepEqual(evidenceReuse({ readyReportId: task.report.id, executionSucceeded: true }, task, '/workspace'), {
    reusable: true, basis: 'latest-report',
  });
  for (const failure of [{ execution_status: 'running' }, { isError: true }, { executionSucceeded: false }]) {
    const result = evidenceReuse({ ...oldRead(), readyReportId: task.report.id, ...failure }, task, '/workspace');
    assert.equal(result.reusable, false);
    assert.equal(result.code, failure.execution_status === 'running' ? 'VERIFICATION_RUNNING' : 'VERIFICATION_FAILED');
    assert.equal(typeof result.required_action, 'string');
  }
});

test('absent report IDs cannot falsely bind evidence to a latest report', () => {
  for (const id of [undefined, null, '']) {
    const task = { writeScope: [], ...(id === undefined ? {} : { report: { id } }) };
    const result = evidenceReuse({ readyReportId: id }, task, '/workspace');
    assert.equal(result.reusable, false);
    assert.equal(result.code, 'EVIDENCE_NOT_REUSABLE');
  }
});

test('eligible old read-only fingerprints remain unknown until a fresh recheck', () => {
  for (const tool of ['read', 'read_image']) {
    assert.deepEqual(evidenceReuse({ ...oldRead(), tool }, reportTask(), '/workspace'), {
      reusable: null, code: 'FINGERPRINT_RECHECK_REQUIRED', basis: 'read-only-inputs',
      required_action: 'Acceptance will recheck all declared input fingerprints',
    });
  }
  for (const failure of [{ execution_status: 'running' }, { isError: true }, { executionSucceeded: false }]) {
    assert.equal(evidenceReuse({ ...oldRead(), ...failure }, reportTask(), '/workspace').reusable, false);
  }
});

test('old evidence without every eligible read-only binding is not reusable', () => {
  for (const change of [{ inputs: [] }, { inputScope: [] }, { tool: 'bash' }, { executionScope: '/other' }, { directInput: false }]) {
    const result = evidenceReuse({ ...oldRead(), ...change }, reportTask(), '/workspace');
    assert.equal(result.reusable, false);
    assert.equal(result.code, 'EVIDENCE_NOT_REUSABLE');
    assert.equal(result.required_action, 'Run a fresh check against the latest report');
  }
  assert.equal(evidenceReuse(oldRead(), { ...reportTask(), writeScope: ['/workspace'] }, '/workspace').reusable, false);
});

test('permissions separate read-only assignments from declared writes', () => {
  const readOnly = { file_read: 'allowed', file_write: 'denied', shell: 'denied', tests: 'denied' };
  assert.deepEqual(permissions(), readOnly);
  assert.deepEqual(permissions([]), readOnly);
  assert.deepEqual(permissions(['/workspace/output']), { file_read: 'allowed', file_write: 'allowed', shell: 'allowed', tests: 'allowed' });
});

test('task summary separates stopped execution, submitted report and mentor acceptance', () => {
  for (const status of ['cancelled', 'acceptance_blocked', 'closed-unaccepted', 'accepted', 'stopped', 'reported']) {
    const task = { ...reportTask(), status };
    const summary = taskSummary(task, 'not-live');
    assert.equal(summary.status, status);
    assert.deepEqual(summary.execution, { activity: 'not-live', stoppedWithoutReport: false });
    assert.deepEqual(summary.report, { state: 'submitted', id: 'report-2', latestUpdateStatus: task.report.status ?? null, latestUpdateId: 'report-2' });
    assert.equal(summary.acceptance.state, ['stopped', 'reported'].includes(status) ? 'not-accepted' : status);
    assert.equal(summary.acceptance.diagnostic, null);
    assert.deepEqual(summary.criteria, contract);
    assert.deepEqual(summary.permissions, permissions([]));
    assert.equal(summary.latestVerificationId, 'check-1');
    assert.equal(summary.registeredChecks, 1);
  }
});

test('worker PASS does not imply mentor acceptance', () => {
  const task = reportTask();
  assert.ok(task.report.evidenceGate.criteria.every(({ status }) => status === 'PASS'));
  assert.equal(taskSummary(task, 'running').acceptance.state, 'not-accepted');
  assert.equal(taskSummary(task, 'running').execution.activity, 'running');
});

test('task summary handles stopped tasks without reports', () => {
  const summary = taskSummary({ taskId: 'new-task', status: 'stopped', writeScope: [] });
  assert.deepEqual(summary.execution, { activity: 'not-live', stoppedWithoutReport: true });
  assert.deepEqual(summary.report, { state: 'none', id: null, latestUpdateStatus: null, latestUpdateId: null });
  assert.deepEqual(summary.acceptance, { state: 'not-accepted', diagnostic: null });
  assert.deepEqual(summary.criteria, []);
});

test('task summary associates acceptance diagnostics only with the current report', () => {
  const task = { ...reportTask(), status: 'acceptance_blocked' };
  const blocked = { code: 'INDEPENDENT_CHECK_REQUIRED', criterion_id: 'AC1', required_action: 'Run a check' };
  task.acceptanceBlock = { reportId: task.report.id, diagnostic: blocked };
  assert.deepEqual(taskSummary(task).acceptance, { state: 'acceptance_blocked', diagnostic: blocked });
  task.acceptanceBlock.reportId = 'report-1';
  assert.deepEqual(taskSummary(task).acceptance, { state: 'acceptance_blocked', diagnostic: null });
});

test('task summary bounds descriptions and excludes raw execution/report outputs', () => {
  const task = reportTask();
  task.goal = 'g'.repeat(201);
  task.criteria = [{ id: 'AC1', description: 'd'.repeat(201) }];
  task.guidance = { nextSteps: 'n'.repeat(401) };
  task.report.status = 'blocked';
  task.report.question = 'q'.repeat(501);
  task.report.rawOutput = 'REPORT_RAW_OUTPUT';
  task.verifications[0].rawOutput = 'CHECK_RAW_OUTPUT';
  const summary = taskSummary(task);
  assert.equal(summary.goal.length, 200);
  assert.equal(summary.criteria[0].description.length, 200);
  assert.equal(summary.next.length, 400);
  assert.equal(summary.blocker.length, 500);
  const json = JSON.stringify(summary);
  for (const raw of ['REPORT_RAW_OUTPUT', 'CHECK_RAW_OUTPUT', 'Independent check recorded']) assert.ok(!json.includes(raw));
  assert.ok(!Object.hasOwn(summary, 'verifications'));
  assert.ok(!Object.hasOwn(summary.report, 'evidenceGate'));
});
