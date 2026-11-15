import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertLocalPath } from './paths.js';

const exec = promisify(execFile);
export async function git(directory, args) {
  return (await exec('git', ['-C', directory, ...args], {
    maxBuffer: 4 * 1024 * 1024, timeout: 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })).stdout.trimEnd();
}
export async function repository(path) {
  const actual = assertLocalPath(await realpath(path), '프로젝트');
  const root = await git(actual, ['rev-parse', '--show-toplevel']);
  if (await realpath(root) !== actual) throw new Error('프로젝트 저장소의 최상위 폴더를 지정하세요.');
  await git(actual, ['rev-parse', '--verify', 'HEAD']);
  const common = await git(actual, ['rev-parse', '--git-common-dir']);
  assertLocalPath(resolve(actual, common), 'Git 공용 저장소');
  return actual;
}
export async function createWorktree(project, dataDirectory, id) {
  await repository(project.directory); // Revalidate saved paths before every mutation.
  const parent = assertLocalPath(join(dataDirectory, 'worktrees'), '작업 폴더');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = join(parent, id);
  const branch = `workspace/${id}`;
  const baseCommit = await git(project.directory, ['rev-parse', 'HEAD']);
  await git(project.directory, ['worktree', 'add', '-b', branch, directory, baseCommit]);
  return { directory, branch, baseCommit };
}
export async function changes(directory) {
  const [status, diff] = await Promise.all([
    git(directory, ['status', '--short']),
    git(directory, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']),
  ]);
  return { status, diff }; // New files are listed; their contents are not read implicitly.
}
