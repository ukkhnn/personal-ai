import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { Workspace } from '../src/workspace.js';
import { git } from '../src/git.js';
import { FakeRuntime } from './helpers/fake-runtime.js';

// Real HTTP, authentication, Git worktrees, and disk persistence; model execution
// is deliberately simulated. These tests do not prove remote device connectivity.
const password = 'http-integration-only-password';
class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async request(path, input, expected = 200) {
    const response = await fetch(this.base + '/api' + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { origin: this.base, 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    const value = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return value;
  }
  login() { return this.request('/login', { password }); }
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'personal-ai-http-test-'));
  const repo = join(dir, 'repo'), data = join(dir, 'data');
  const runtime = new FakeRuntime();
  let server, workspace;
  async function close() {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (workspace) await workspace.close();
    server = null; workspace = null;
  }
  t.after(async () => { await close(); await rm(dir, { recursive: true, force: true }); });
  await mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'hello.txt'), 'original\n');
  await git(repo, ['add', '.']);
  await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  const f = {
    dir, repo, data, runtime,
    get workspace() { return workspace; },
    async restart() {
      await close();
      workspace = new Workspace(new Store(data), runtime, data);
      server = createApp(workspace, runtime, password);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      this.base = `http://127.0.0.1:${server.address().port}`;
    },
    client() { return new Client(this.base); },
    async create(client, title = 'HTTP integration') {
      const project = await client.request('/projects', { directory: repo }, 201);
      const template = await client.request('/templates', {
        name: 'Development', model: { providerID: 'deepseek', modelID: 'test' },
        prompt: 'Stay in the worktree.', memory: 'Explicit fixture context.',
      }, 201);
      const task = await client.request('/tasks', { projectID: project.id, templateID: template.id, title }, 201);
      assert.equal(task.status, 'idle');
      return { project, template, task };
    },
  };
  await f.restart();
  return f;
}

test('HTTP simulated smoke: two clients share login, project, template, queued work, approval, question and changes', async t => {
  const f = await fixture(t), desktop = f.client(), mobile = f.client();
  await desktop.request('/state', undefined, 401);
  await Promise.all([desktop.login(), mobile.login()]);
  assert.notEqual(desktop.cookie, mobile.cookie, 'each client has a distinct authenticated session');
  const catalog = await desktop.request('/runtime');
  assert.equal(catalog.health.version, 'fake-test-runtime');
  const { project, template, task } = await f.create(desktop);
  const sameProject = await mobile.request('/projects', { directory: f.repo }, 201);
  assert.equal(sameProject.id, project.id);
  const state = await mobile.request('/state');
  assert.equal(state.projects.length, 1);
  assert.equal(state.templates[0].id, template.id);
  assert.equal(state.tasks[0].id, task.id);
  assert.equal(state.tasks[0].messageCount, 0);
  assert.equal(state.tasks[0].messages, undefined);
  assert.equal(task.template.prompt, 'Stay in the worktree.');
  assert.equal(task.template.memory, 'Explicit fixture context.');

  const path = `/tasks/${task.id}`;
  const first = { requestID: 'shared-request', text: 'Make the requested change.' };
  const retries = await Promise.all([
    desktop.request(path + '/messages', first, 202),
    mobile.request(path + '/messages', first, 202),
  ]);
  assert.equal(retries[0].id, retries[1].id);
  await mobile.request(path + '/messages', { ...first, text: 'Different content with the same ID.' }, 409);
  await mobile.request(path + '/messages', { requestID: 'mobile-follow-up', text: 'Check the result.' }, 202);
  await f.workspace.tick(task.id);
  assert.equal(f.runtime.sent.length, 1);
  const running = f.workspace.task(task.id), session = f.runtime.sessions.get(task.sessionID);
  session.permissions = [{ id: 'permission-1', sessionID: task.sessionID, permission: 'bash', patterns: ['git diff --stat'] }];
  await f.workspace.tick(task.id);
  assert.equal((await mobile.request(path)).status, 'waiting_approval');
  await mobile.request(path + '/permissions', { id: 'not-pending', reply: 'once' }, 409);
  await mobile.request(path + '/permissions', { id: 'permission-1', reply: 'always' }, 400);
  await mobile.request(path + '/permissions', { id: 'permission-1', reply: 'once' });
  await desktop.request(path + '/permissions', { id: 'permission-1', reply: 'once' }, 409);
  assert.deepEqual(f.runtime.replies, [{ task: task.id, id: 'permission-1', reply: 'once' }]);

  await writeFile(join(task.directory, 'hello.txt'), 'changed through the task\n');
  await writeFile(join(task.directory, 'result.txt'), 'new result\n');
  f.runtime.finish(running);
  await f.workspace.tick(task.id);
  assert.equal(f.runtime.sent.length, 2);
  assert.equal(running.queue[0].status, 'completed');
  session.questions = [{ id: 'question-1', sessionID: task.sessionID, questions: [{ question: 'Keep this result?', options: [{ label: 'Keep' }] }] }];
  await f.workspace.tick(task.id);
  assert.equal((await desktop.request(path)).status, 'waiting_input');
  await desktop.request(path + '/questions', { id: 'question-1', answers: [] }, 400);
  await desktop.request(path + '/questions', { id: 'question-1', answers: [['Keep']] });
  assert.deepEqual(f.runtime.answers, [{ task: task.id, id: 'question-1', answers: [['Keep']] }]);
  f.runtime.finish(running);
  await f.workspace.tick(task.id);
  assert.equal((await mobile.request(path)).status, 'completed');
  assert.deepEqual(running.queue.map(message => message.status), ['completed', 'completed']);
  const changes = await mobile.request(path + '/changes');
  assert.match(changes.status, /hello\.txt/);
  assert.match(changes.status, /result\.txt/);
  assert.match(changes.diff, /changed through the task/);
  assert.equal(await readFile(join(f.repo, 'hello.txt'), 'utf8'), 'original\n');

  await desktop.request('/logout', {});
  await desktop.request(path, undefined, 401);
  assert.equal((await mobile.request(path)).id, task.id, 'logging out one client does not log out another');
  const reconnect = f.client();
  await reconnect.login();
  assert.deepEqual((await reconnect.request(path)).queue, running.queue);
  assert.equal(f.runtime.sent.length, 2, 'client reconnection does not restart completed work');
});

test('HTTP simulated parallel work: approvals and stop/resume are isolated per task', async t => {
  const f = await fixture(t), desktop = f.client(), mobile = f.client();
  await Promise.all([desktop.login(), mobile.login()]);
  const { project, template } = await f.create(desktop, 'Unused setup task');
  const [a, b] = await Promise.all([
    desktop.request('/tasks', { projectID: project.id, templateID: template.id, title: 'First parallel task' }, 201),
    mobile.request('/tasks', { projectID: project.id, templateID: template.id, title: 'Second parallel task' }, 201),
  ]);
  assert.notEqual(a.branch, b.branch);
  assert.notEqual(a.sessionID, b.sessionID);
  await Promise.all([
    desktop.request(`/tasks/${a.id}/messages`, { requestID: 'a-1', text: 'First work.' }, 202),
    mobile.request(`/tasks/${b.id}/messages`, { requestID: 'b-1', text: 'Second work.' }, 202),
  ]);
  await Promise.all([f.workspace.tick(a.id), f.workspace.tick(b.id)]);
  assert.equal(f.runtime.sent.length, 2);
  await writeFile(join(a.directory, 'hello.txt'), 'task a\n');
  await writeFile(join(b.directory, 'hello.txt'), 'task b\n');
  f.runtime.sessions.get(a.sessionID).permissions = [{ id: 'approve-a', sessionID: a.sessionID }];
  f.runtime.sessions.get(b.sessionID).permissions = [{ id: 'approve-b', sessionID: b.sessionID }];
  await Promise.all([f.workspace.tick(a.id), f.workspace.tick(b.id)]);
  await mobile.request(`/tasks/${b.id}/permissions`, { id: 'approve-a', reply: 'once' }, 409);
  await desktop.request(`/tasks/${a.id}/permissions`, { id: 'approve-a', reply: 'reject' });
  await mobile.request(`/tasks/${b.id}/permissions`, { id: 'approve-b', reply: 'once' });
  assert.deepEqual(f.runtime.replies.map(reply => [reply.task, reply.reply]), [[a.id, 'reject'], [b.id, 'once']]);
  await mobile.request(`/tasks/${a.id}/messages`, { requestID: 'a-2', text: 'Continue after a pause.' }, 202);
  await desktop.request(`/tasks/${a.id}/stop`, {});
  await Promise.all([f.workspace.tick(a.id), f.workspace.tick(b.id)]);
  const stopped = await mobile.request(`/tasks/${a.id}`);
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(stopped.queue.map(message => message.status), ['cancelled', 'queued']);
  assert.equal((await desktop.request(`/tasks/${b.id}`)).status, 'running');
  assert.equal(f.runtime.sent.length, 2);
  f.runtime.finish(f.workspace.task(b.id));
  await f.workspace.tick(b.id);
  await mobile.request(`/tasks/${a.id}/resume`, {});
  await f.workspace.tick(a.id);
  assert.equal(f.runtime.sent.length, 3);
  f.runtime.finish(f.workspace.task(a.id));
  await f.workspace.tick(a.id);
  assert.equal((await desktop.request(`/tasks/${a.id}`)).status, 'completed');
  assert.equal((await mobile.request(`/tasks/${b.id}`)).status, 'completed');
  assert.match((await mobile.request(`/tasks/${a.id}/changes`)).diff, /task a/);
  assert.match((await desktop.request(`/tasks/${b.id}/changes`)).diff, /task b/);
  assert.equal(await readFile(join(f.repo, 'hello.txt'), 'utf8'), 'original\n');
});

test('HTTP restart and runtime reconnect preserve queue and history without duplicate delivery', async t => {
  const f = await fixture(t), desktop = f.client();
  await desktop.login();
  const { task } = await f.create(desktop);
  const path = `/tasks/${task.id}`;
  await desktop.request(path + '/messages', { requestID: 'before-restart', text: 'First instruction.' }, 202);
  await desktop.request(path + '/messages', { requestID: 'after-restart', text: 'Queued instruction.' }, 202);
  await f.workspace.tick(task.id);
  await f.workspace.tick(task.id);
  const before = await desktop.request(path);
  assert.equal(before.messages.length, 1);
  assert.equal(f.runtime.sent.length, 1);
  await f.restart();
  desktop.base = f.base;
  await desktop.request(path, undefined, 401);
  await desktop.login();
  const restored = await desktop.request(path);
  assert.equal(restored.sessionID, task.sessionID);
  assert.equal(restored.directory, task.directory);
  assert.deepEqual(restored.queue, before.queue);
  assert.deepEqual(restored.messages, before.messages);
  await f.workspace.tick(task.id);
  assert.equal(f.runtime.sent.length, 1);

  const snapshot = f.runtime.snapshot.bind(f.runtime);
  f.runtime.snapshot = async () => { throw new Error('Simulated engine offline'); };
  await f.workspace.tick(task.id);
  const offline = await desktop.request(path);
  assert.equal(offline.runtimeAvailable, false);
  assert.equal(offline.status, 'running');
  assert.deepEqual(offline.messages, before.messages);
  assert.equal(f.runtime.sent.length, 1);
  f.runtime.snapshot = snapshot;
  f.runtime.finish(f.workspace.task(task.id));
  await f.workspace.tick(task.id);
  assert.equal(f.runtime.sent.length, 2);
  await desktop.request(path + '/messages', { requestID: 'after-restart', text: 'Queued instruction.' }, 202);
  assert.equal(f.workspace.task(task.id).queue.length, 2);
  f.runtime.finish(f.workspace.task(task.id));
  await f.workspace.tick(task.id);
  const complete = await desktop.request(path);
  assert.equal(complete.runtimeAvailable, true);
  assert.equal(complete.status, 'completed');
  assert.deepEqual(complete.queue.map(message => message.status), ['completed', 'completed']);
  assert.equal(f.runtime.sent.length, 2);
});
