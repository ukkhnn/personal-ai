import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import {
  createPermissionDecision, settlePermissionDecision, permissionDecisionHistory, assertNewPermissionDecision,
} from '../src/core/permission-decisions.ts';

const sending = () => createPermissionDecision('request-1', 'once', {
  id: 'request-1', permission: 'bash', patterns: ['git diff *'], metadata: { command: 'git diff --stat' },
}, 100);

test('permission decisions settle without modifying the saved sending record and cannot settle twice', () => {
  const original = sending();
  for (const status of ['applied', 'uncertain']) {
    const result = settlePermissionDecision(original, status, 110);
    assert.equal(result.status, status);
    assert.equal(result.updatedAt, 110);
    assert.equal(original.status, 'sending');
    assert.equal(Object.hasOwn(original, 'updatedAt'), false);
    assert.throws(() => settlePermissionDecision(result, 'applied'), /Only a sending/);
    assert.throws(() => assertNewPermissionDecision([result], result.id), error => error.status === 409);
  }
  assert.throws(() => assertNewPermissionDecision([original], original.id), error => error.status === 409);
  assert.throws(() => createPermissionDecision('request-1', 'once', { id: 'different-task' }), error => error.status === 409);
  assert.throws(() => createPermissionDecision('request-1', 'always', { id: 'request-1' }), error => error.status === 400);
  assert.throws(() => createPermissionDecision('request-1', 'once', { id: 'request-1', patterns: [null] }), error => error.status === 502);
});

test('permission history accepts old missing fields but rejects ambiguous or incomplete decisions', () => {
  assert.deepEqual(permissionDecisionHistory(undefined), []);
  const legacy = createPermissionDecision('old-request', 'reject', { id: 'old-request' }, 100);
  assert.equal(permissionDecisionHistory([legacy])[0].permission, undefined);
  const valid = settlePermissionDecision(sending(), 'applied', 110);
  const parsed = permissionDecisionHistory([valid]);
  assert.deepEqual(parsed, [valid]);
  parsed[0].patterns.push('new');
  assert.deepEqual(valid.patterns, ['git diff *']);
  for (const invalid of [
    null, {}, [null], [{ ...valid, status: 'approved' }], [{ ...valid, updatedAt: undefined }],
    [{ ...valid, status: 'sending' }], [{ ...valid, reply: 'always' }], [{ ...valid, createdAt: -1 }],
    [{ ...valid, patterns: ['read', 1] }], [{ ...valid, command: {} }], [valid, valid],
  ]) assert.throws(() => permissionDecisionHistory(invalid), /damaged permission decision/);
});

test('damaged permission records fail before startup or save and preserve the existing file', t => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-ai-decisions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  store.data.tasks.push({ id: 'legacy-task' });
  store.save();
  assert.equal(new Store(directory).data.tasks.length, 1);
  const before = readFileSync(store.file, 'utf8');
  store.data.tasks[0].permissionDecisions = [{ ...sending(), status: 'applied' }];
  assert.throws(() => store.save(), /damaged permission decision/);
  assert.equal(readFileSync(store.file, 'utf8'), before);
  const invalid = JSON.stringify(store.data);
  writeFileSync(store.file, invalid);
  assert.throws(() => new Store(directory), /damaged permission decision/);
  assert.equal(readFileSync(store.file, 'utf8'), invalid);
});
