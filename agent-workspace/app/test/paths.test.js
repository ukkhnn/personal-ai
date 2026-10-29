import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalPath } from '../src/paths.js';
import { repository, git } from '../src/git.js';
import { Store } from '../src/store.js';

test('cloud storage is rejected through literal paths and symlink ancestors', t => {
  const base = mkdtempSync(join(tmpdir(), 'workspace-path-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const cloud = join(base, 'Library/Mobile Documents/com~apple~CloudDocs');
  mkdirSync(cloud, { recursive: true });
  symlinkSync(cloud, join(base, 'shortcut'));
  assert.throws(() => assertLocalPath(join(cloud, 'new')), /공유 폴더/);
  assert.throws(() => assertLocalPath(join(base, 'shortcut/new/data')), /공유 폴더/);
  assert.throws(() => new Store(join(base, 'shortcut/state')), /공유 폴더/);
  assert.equal(assertLocalPath(join(base, 'local/new')), join(realpathSync(base), 'local/new'));
});
test('a local worktree cannot use shared Git metadata in iCloud', async t => {
  const base = mkdtempSync(join(tmpdir(), 'workspace-git-path-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'Library/Mobile Documents/shared/repo');
  mkdirSync(repo, { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  writeFileSync(join(repo, 'file'), 'fixture');
  await git(repo, ['add', '.']);
  await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  const tree = join(base, 'local-tree');
  await git(repo, ['worktree', 'add', '-b', 'test', tree]);
  await assert.rejects(() => repository(tree), /Git 공용 저장소/);
});
