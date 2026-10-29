import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findOpenCode } from '../src/runtime-config.js';

test('existing and explicitly configured engines take precedence over the local fallback', t => {
  const root = mkdtempSync(join(tmpdir(), 'engine-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'opencode');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n'); chmodSync(bin, 0o700);
  assert.equal(findOpenCode({ PATH: root }, root), bin);
  assert.equal(findOpenCode({ PATH: '', OPENCODE_BIN: bin }, root), bin);
  assert.throws(() => findOpenCode({ PATH: root, OPENCODE_BIN: '/missing-engine' }, root), /OPENCODE_BIN/);
  mkdirSync(join(root, '.opencode/bin'), { recursive: true });
  const userBin = join(root, '.opencode/bin/opencode');
  writeFileSync(userBin, 'fixture'); chmodSync(userBin, 0o700);
  assert.equal(findOpenCode({ PATH: '' }, root), userBin);
});
