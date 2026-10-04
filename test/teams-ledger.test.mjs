import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, fold, encode } from '../ledger.js';
const record = (state, value, seq = 1) => fold(state, { type: 'user/message', seq, data: { source: { kind: 'codex-mentor-ledger', record: { version: 1, ...value } } } });
const peer = (state, senderId, value, teamId = 'lead') => fold(state, { type: 'user/message', seq: 20, data: { source: { kind: 'team-message', teamId, senderId, senderName: senderId, messageId: 'msg' }, content: [{ type: 'text', text: 'Peer message\n' + encode(value) }] } });
function lead() {
  return record(initial({ id: 'lead' }), { kind: 'delegated', backend: 'team', taskId: 'task', childId: 'flash', started: true, goal: 'Inspect', writeScope: [], acceptance: 'AC1: sourced' });
}
const report = { kind: 'report', taskId: 'task', status: 'ready-review', summary: 'Inspected', evidence: 'contract source', evidenceGate: { changes: [], checks: [], criteria: ['AC1: PASS'], deviations: [], assumptions: [], risks: [] } };
test('native peer attribution accepts only the linked Flash member in the correct Team', () => {
  const state = lead();
  assert.equal(peer(state, 'stranger', report), state);
  assert.equal(peer(state, 'flash', report, 'another-team'), state);
  assert.equal(peer(state, 'flash', { kind: 'review', taskId: 'task', verdict: 'accepted', evidence: 'self accepted' }), state);
  const admitted = peer(state, 'flash', report);
  assert.equal(admitted.tasks[0].status, 'ready-review');
  assert.equal(admitted.tasks[0].report.childId, 'flash');
});
test('native completed is not Mentor acceptance and does not alter formal task state', () => {
  const state = lead();
  const after = fold(state, { type: 'tool/result', seq: 21, data: { message: { toolCallId: 'board-call', content: [{ type: 'text', text: JSON.stringify({ task: { status: 'completed' } }) }] } } });
  assert.equal(after, state);
  assert.equal(peer(state, 'flash', report).tasks[0].status, 'ready-review');
});
test('native tutoring resumes only from the exact parent Lead', () => {
  const assignment = { kind: 'assignment', taskId: 'task', parentId: 'lead', backend: 'team', goal: 'Inspect', writeScope: [], acceptance: 'AC1: sourced' };
  let worker = fold(initial({ id: 'flash', origin: 'subagent', parentSession: 'lead' }), { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: encode(assignment) }] } });
  worker = record(worker, { kind: 'report', ...report, childId: 'flash', status: 'blocked' });
  const guidance = { kind: 'guidance', taskId: 'task', diagnosis: 'Hypothesis', nextSteps: 'Read contract', validation: 'Requirement observed', fallback: 'Report missing source' };
  assert.equal(peer(worker, 'other-member', guidance), worker);
  const resumed = peer(worker, 'lead', guidance);
  assert.equal(resumed.tasks[0].status, 'implementing');
  assert.equal(resumed.tasks[0].guidance.nextSteps, 'Read contract');
});
test('a fast Lead reply fences a delayed local report commit', () => {
  let worker = record(initial({ id: 'flash', origin: 'subagent', parentSession: 'lead' }), { kind: 'assignment', taskId: 'task', childId: 'flash', parentId: 'lead', goal: 'Inspect', writeScope: [], acceptance: 'AC1' });
  worker = record(worker, { id: 'guide', kind: 'guidance', taskId: 'task', reportId: 'old-report', diagnosis: 'hypothesis', nextSteps: 'Continue', validation: 'observed', fallback: 'ask' });
  worker = record(worker, { ...report, id: 'old-report', childId: 'flash', status: 'blocked' });
  assert.equal(worker.tasks[0].status, 'implementing', 'late blocked commit cannot overwrite already accepted guidance');
  assert.equal(worker.tasks[0].report.id, 'old-report');
  worker = record(worker, { ...report, id: 'new-report', childId: 'flash' });
  assert.equal(worker.tasks[0].status, 'ready-review', 'a genuinely new report still updates state');
});
test('a delayed report-turn settlement cannot stop guided work, but a later report-less turn can', () => {
  let state = record(lead(), { ...report, id: 'old-report', childId: 'flash', status: 'blocked' });
  state = record(state, { id: 'guide', kind: 'guidance', taskId: 'task', reportId: 'old-report', nextSteps: 'Continue' });
  const settlement = id => ({ type: 'user/message', seq: 30, data: { id, source: { kind: 'subagent-settled', senderSessionId: 'flash', summary: 'Background subagent flash finished and will do no further work unless you send it more.' } } });
  state = fold(state, settlement('old-stop'));
  assert.equal(state.tasks[0].status, 'implementing');
  assert.equal(state.tasks[0].awaitingSettlements.length, 0);
  assert.equal(fold(state, settlement('old-stop')), state, 'inbox/history replay consumes one native settlement only once');
  assert.equal(fold(state, settlement('new-reportless-stop')).tasks[0].status, 'stopped');
});
test('a report or new failure overtaking resume delivery is not erased by its late local commit', () => {
  const stopped = (state, id) => fold(state, { type: 'user/message', seq: 21, data: { id, source: { kind: 'subagent-settled', senderSessionId: 'flash', summary: 'failed before closing' } } });
  const guidance = { id: 'resume', kind: 'guidance', taskId: 'task', reportId: null, recovery: { stopId: 'old-stop' }, purpose: 'lifecycle-repair' };
  const old = stopped(lead(), 'old-stop');
  const submitted = record(old, { ...report, id: 'fresh-report', childId: 'flash' });
  assert.equal(record(submitted, guidance).tasks[0].status, 'ready-review', 'explicit null reportId still fences a new formal report');
  const newFailure = stopped(old, 'new-stop');
  assert.equal(record(newFailure, guidance).tasks[0].status, 'stopped', 'fresh failure after retry remains actionable');
  const resumed = record(old, guidance);
  assert.equal(resumed.tasks[0].status, 'resuming', 'delivery is not an implementing/progress claim');
  assert.equal(stopped(resumed, 'old-stop'), resumed, 'duplicated old native failure is ignored');
  assert.equal(stopped(resumed, 'another-stop').tasks[0].status, 'stopped');
});
