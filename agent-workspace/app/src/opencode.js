import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findOpenCode } from './runtime-config.js';

export class RuntimeError extends Error {
  constructor(status, operation) {
    super(`OpenCode ${operation}: HTTP ${status}`);
    this.status = status;
  }
}

// All engine-specific paths and request shapes live here. Never return provider
// configuration or credential objects to the browser.
export class OpenCode {
  constructor(url, password, username = 'opencode') {
    this.url = new URL(url);
    if (this.url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(this.url.hostname)
        || this.url.username || this.url.password || this.url.pathname !== '/' || this.url.search) {
      throw new Error('OpenCode URL must be a loopback HTTP origin.');
    }
    if (!password) throw new Error('A local OpenCode server password is required.');
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }
  async request(path, { directory, body, method = 'GET' } = {}) {
    const url = new URL(path, this.url);
    if (directory) url.searchParams.set('directory', directory);
    const response = await fetch(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: this.authorization, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new RuntimeError(response.status, path.split('?')[0]);
    if (response.status === 204) return null;
    return response.json();
  }
  health() { return this.request('/global/health'); }
  async catalog() {
    const providers = await this.request('/provider');
    const connected = new Set(providers.connected || []);
    return providers.all.filter(p => connected.has(p.id)).map(p => ({
      id: p.id, name: p.name,
      models: Object.entries(p.models || {}).map(([id, m]) => ({ id, name: m.name || id })),
    }));
  }
  create(directory, title) {
    return this.request('/session', { method: 'POST', directory, body: {
      title,
      // This first integration does NOT claim to enforce a shell sandbox.
      // Ask for shell execution until project-only install policy is validated.
      permission: [
        { permission: '*', pattern: '*', action: 'ask' },
        ...['read', 'glob', 'grep', 'list', 'edit', 'todowrite', 'todoread'].map(permission => ({ permission, pattern: '*', action: 'allow' })),
        { permission: 'external_directory', pattern: '*', action: 'ask' },
        { permission: 'task', pattern: '*', action: 'deny' },
      ],
    } });
  }
  send(task, message) {
    return this.request(`/session/${task.sessionID}/prompt_async`, {
      method: 'POST', directory: task.directory, body: {
        messageID: message.runtimeID, model: task.template.model,
        system: [
          'Work only in this task worktree. Do not merge, push, deploy, or change global/system configuration. Ask before shell commands. Do not launch subagents.',
          task.template.prompt,
          task.template.memory ? `User-selected project context:\n${task.template.memory}` : '',
        ].filter(Boolean).join('\n\n'),
        parts: [{ type: 'text', text: message.text }],
      },
    });
  }
  async snapshot(task) {
    const directory = task.directory;
    const [messages, states, permissions, questions] = await Promise.all([
      this.request(`/session/${task.sessionID}/message`, { directory }),
      this.request('/session/status', { directory }),
      this.request('/permission', { directory }),
      this.request('/question', { directory }),
    ]);
    return {
      messages, status: states[task.sessionID]?.type || 'idle',
      permissions: permissions.filter(p => p.sessionID === task.sessionID),
      questions: questions.filter(q => q.sessionID === task.sessionID),
    };
  }
  abort(task) { return this.request(`/session/${task.sessionID}/abort`, { method: 'POST', directory: task.directory, body: {} }); }
  reply(task, id, reply) { return this.request(`/permission/${encodeURIComponent(id)}/reply`, { method: 'POST', directory: task.directory, body: { reply } }); }
  answer(task, id, answers) { return this.request(`/question/${encodeURIComponent(id)}/reply`, { method: 'POST', directory: task.directory, body: { answers } }); }
}

export async function launchRuntime(dataDirectory, env = process.env) {
  if (env.OPENCODE_URL) {
    const runtime = new OpenCode(env.OPENCODE_URL, env.OPENCODE_SERVER_PASSWORD, env.OPENCODE_SERVER_USERNAME);
    await runtime.health();
    return { runtime, close: async () => {} };
  }
  const binary = findOpenCode(env);
  const password = randomBytes(32).toString('base64url');
  const log = openSync(join(dataDirectory, 'opencode.log'), 'a', 0o600);
  const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: dataDirectory,
    env: { ...env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: 'opencode' },
    stdio: ['ignore', 'pipe', log],
  });
  closeSync(log);
  let output = '', startError;
  child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-8000); });
  child.on('error', e => { startError = e; });
  const close = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    for (let n = 0; n < 30 && child.exitCode === null; n++) await delay(100);
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  try {
    for (let n = 0; n < 200; n++) {
      if (startError) throw startError;
      if (child.exitCode !== null) throw new Error('OpenCode stopped during startup. See the private runtime log.');
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        const runtime = new OpenCode(match[0], password);
        await runtime.health();
        return { runtime, close };
      }
      await delay(100);
    }
    throw new Error('OpenCode startup timed out.');
  } catch (error) { await close(); throw error; }
}
