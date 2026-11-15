import test from 'node:test';
import assert from 'node:assert/strict';
import { safeApproval, validateTask, validateCompletion, main } from '../scripts/verify-m1.js';

test('M1 verification only approves an exact command owned by its session', () => {
  const request = { permission: 'bash', sessionID: 'ses1', metadata: { command: 'git diff --stat' }, patterns: ['git diff *'] };
  assert.equal(safeApproval(request, 'ses1'), true);
  for (const patch of [{ sessionID: 'other' }, { permission: 'external_directory' }, { patterns: ['*'] },
    { patterns: [] }, { patterns: ['git diff *', '*'] }, { metadata: {} }, { metadata: { command: 42 } },
    { metadata: { command: 'git diff --stat; touch unexpected' } }, { metadata: { command: 'git diff --stat\npwd' } }]) {
    assert.equal(safeApproval({ ...request, ...patch }, 'ses1'), false);
  }
});

function fixture() {
  const model = { providerID: 'deepseek', modelID: 'test' };
  const report = { taskID: 'task1', projectID: 'project1', sessionID: 'ses1', title: 'test', model };
  const task = { id: 'task1', projectID: 'project1', sessionID: 'ses1', title: 'test',
    directory: '/data/worktrees/task1', template: { model }, questions: [], status: 'completed', current: null,
    queue: [{ requestID: 'm1-edit', status: 'completed' }, { requestID: 'm1-follow-up', runtimeID: 'followup', status: 'completed' }],
    messages: [{ info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'bash',
      state: { status: 'completed', input: { command: 'git diff --stat' }, metadata: { exit: 0 } } }] },
    { info: { role: 'assistant', parentID: 'followup' }, parts: [{ type: 'text', text: 'hello-m1' }] }] };
  return { report, task };
}

test('M1 report cannot authorize another task, worktree, or changed instructions', () => {
  const { task, report } = fixture();
  assert.doesNotThrow(() => validateTask(task, report, '/data'));
  for (const patch of [{ id: 'other' }, { projectID: 'other' }, { sessionID: 'other' },
    { directory: '/data/worktrees/other' }, { status: 'uncertain' }, { questions: [{}] },
    { queue: [...task.queue, { requestID: 'unexpected' }] }, { template: { model: { providerID: 'other' } } }]) {
    assert.throws(() => validateTask({ ...task, ...patch }, report, '/data'));
  }
});

test('M1 completion needs successful execution and the actual follow-up answer', () => {
  const { task } = fixture();
  assert.doesNotThrow(() => validateCompletion(task));
  const failed = structuredClone(task); failed.messages[0].parts[0].state.metadata.exit = 1;
  const unfinished = structuredClone(task); unfinished.messages[0].parts[0].state.status = 'running';
  const duplicate = structuredClone(task); duplicate.messages.push(duplicate.messages[0]);
  const wrongAnswer = structuredClone(task); wrongAnswer.messages[1].parts[0].text = 'not the file';
  const wrongTurn = structuredClone(task); wrongTurn.messages[1].info.parentID = 'other';
  for (const value of [failed, unfinished, duplicate, wrongAnswer, wrongTurn, { ...task, current: 'active' }]) {
    assert.throws(() => validateCompletion(value));
  }
});

test('M1 refuses model calls without opt-in and an explicit model before accessing services', async () => {
  for (const env of [{}, { LIVE_MODEL_TEST: '1' }, { LIVE_PROVIDER_ID: 'deepseek', LIVE_MODEL_ID: 'test' }]) {
    await assert.rejects(() => main(['start'], env), /two billable turns/);
  }
  await assert.rejects(() => main(['approve']), /Usage/);
});
