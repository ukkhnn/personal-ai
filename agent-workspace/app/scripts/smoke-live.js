// Explicit opt-in only. This uses existing OpenCode credentials for two model
// turns (three with LIVE_PARALLEL_TEST=1), in disposable Git repositories.
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { Workspace } from '../src/workspace.js';
import { launchRuntime } from '../src/opencode.js';
import { createApp } from '../src/server.js';
import { git } from '../src/git.js';

class SmokeError extends Error {}
if (process.env.LIVE_MODEL_TEST !== '1') throw new SmokeError('Set LIVE_MODEL_TEST=1 to opt into a small billable integration test. No model was called.');
const timeoutSeconds = Number(process.env.LIVE_TIMEOUT_SECONDS || 180);
if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 600) throw new SmokeError('LIVE_TIMEOUT_SECONDS must be an integer from 10 to 600.');
const parallel = process.env.LIVE_PARALLEL_TEST === '1';
const dir = await mkdtemp(join(tmpdir(), 'personal-ai-live-'));
const repo = join(dir, 'fixture'), data = join(dir, 'data');
let instance, workspace, server;
const report = { kind: 'live-model', status: 'failed', parallel, startedAt: new Date().toISOString(), verified: [], tasks: [] };
const checked = (condition, message) => { if (!condition) throw new SmokeError(message); };

function selectModel(providers) {
  const providerID = process.env.LIVE_PROVIDER_ID, modelID = process.env.LIVE_MODEL_ID;
  const candidates = providers.flatMap(provider => provider.models.map(model => ({ providerID: provider.id, modelID: model.id })))
    .filter(model => (!providerID || model.providerID === providerID) && (!modelID || model.modelID === modelID));
  checked(candidates.length > 0, 'No matching connected model. Check existing OpenCode authentication and LIVE_PROVIDER_ID / LIVE_MODEL_ID.');
  checked(candidates.length === 1, 'Choose a connected model explicitly with LIVE_PROVIDER_ID and LIVE_MODEL_ID; this smoke will not guess a billable model.');
  return candidates[0];
}
function safeDiffApproval(request) {
  if (request.permission !== 'bash' || !Array.isArray(request.patterns) || !request.patterns.length) return false;
  const command = request.metadata?.command;
  if (command !== undefined && command.trim() !== 'git diff --stat') return false;
  // A wildcard alone is insufficient evidence of the exact command requested.
  return request.patterns.every(pattern => /^(?:git diff|git diff --stat)$/.test(pattern)
    || (pattern === 'git diff *' && command?.trim() === 'git diff --stat'));
}
function client(base) {
  let cookie;
  return async (path, input) => {
    const response = await fetch(base + '/api' + path, {
      method: input === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const value = await response.json();
    checked(response.ok, `Application request failed: ${path.replace(/\/tasks\/[^/]+/, '/tasks/:id')} (HTTP ${response.status}). See the retained fixture state.`);
    return value;
  };
}
try {
  await mkdir(repo, { mode: 0o700 }); await mkdir(data, { mode: 0o700 });
  await git(repo, ['init', '-b', 'main']);
  await writeFile(join(repo, 'README.md'), 'Temporary integration fixture.\n');
  await git(repo, ['add', '.']);
  await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  instance = await launchRuntime(data);
  workspace = new Workspace(new Store(data), instance.runtime, data);
  const password = randomBytes(24).toString('base64url');
  server = createApp(workspace, instance.runtime, password);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const desktop = client(base), mobile = client(base);
  await Promise.all([desktop('/login', { password }), mobile('/login', { password })]);
  report.verified.push('two independent authenticated HTTP clients (local simulation of client devices)');
  const catalog = await desktop('/runtime');
  const model = selectModel(catalog.providers);
  report.runtimeVersion = catalog.health.version;
  report.model = model;
  const project = await desktop('/projects', { directory: repo });
  const template = await desktop('/templates', {
    name: 'Live smoke', model,
    prompt: 'Follow the tiny test exactly. No subagents. No network tools.',
    memory: 'This is a disposable test fixture.',
  });
  const task = await desktop('/tasks', { projectID: project.id, templateID: template.id, title: 'Live integration smoke' });
  checked(task.sessionID, 'OpenCode session creation failed. See the retained fixture state.');
  const tasks = [task];
  if (parallel) {
    const second = await mobile('/tasks', { projectID: project.id, templateID: template.id, title: 'Live parallel smoke' });
    checked(second.sessionID && second.sessionID !== task.sessionID && second.branch !== task.branch, 'Parallel task did not get an independent session and branch.');
    tasks.push(second);
  }
  report.verified.push('project registration, template/model selection, independent task worktree');
  const first = { requestID: 'smoke-1', text: 'Use a file editing tool to create smoke.txt containing exactly hello-workspace followed by a newline. Append the line Verified from task worktree. to README.md. Then run exactly git diff --stat using the shell tool. No other shell commands. Reply briefly when done.' };
  const retries = await Promise.all([
    desktop(`/tasks/${task.id}/messages`, first), mobile(`/tasks/${task.id}/messages`, first),
  ]);
  checked(retries[0].id === retries[1].id, 'Duplicate request was not deduplicated.');
  await mobile(`/tasks/${task.id}/messages`, { requestID: 'smoke-2', text: 'Read smoke.txt using a file reading tool and reply with its contents only. Do not change any files or run commands.' });
  if (parallel) await mobile(`/tasks/${tasks[1].id}/messages`, { requestID: 'parallel-1', text: 'Use a file editing tool to create parallel.txt containing exactly isolated-worktree followed by a newline. Do not run shell commands. Reply briefly when done.' });
  workspace.start();
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = '', approved = 0, completed = false;
  while (Date.now() < deadline) {
    await delay(1000);
    const states = await Promise.all(tasks.map(current => mobile(`/tasks/${current.id}`)));
    report.tasks = states.map(current => ({ id: current.id, status: current.status, queue: current.queue.map(message => message.status) }));
    const state = report.tasks.map(current => `${current.status}: ${current.queue.join(',')}`).join(' | ');
    if (state !== last) { console.log(state); last = state; }
    for (const current of states) {
      checked(!['failed', 'interrupted', 'setup_failed', 'uncertain'].includes(current.status), 'Task did not complete safely. Inspect the retained fixture state before retrying.');
      checked(!current.questions.length, 'Unexpected agent question; no answer was supplied automatically.');
      for (const permission of current.permissions) {
        checked(current.id === task.id && safeDiffApproval(permission), 'Unexpected permission request; no approval was granted. Inspect the retained fixture state.');
        await mobile(`/tasks/${current.id}/permissions`, { id: permission.id, reply: 'once' });
        approved++;
      }
    }
    if (states.every(current => current.queue.length && current.queue.every(message => message.status === 'completed'))) {
      checked(approved > 0, 'No command approval boundary was exercised.');
      checked((await readFile(join(task.directory, 'smoke.txt'), 'utf8')) === 'hello-workspace\n', 'Primary worktree output differed from the expected result.');
      const changes = await mobile(`/tasks/${task.id}/changes`);
      checked(changes.status.includes('smoke.txt'), 'Primary output was absent from the change listing.');
      checked(changes.diff.includes('+Verified from task worktree.'), 'Tracked file content was absent from the diff.');
      checked(states[0].queue.length === 2, 'Expected exactly two queued turns in the primary task.');
      const followUpID = states[0].queue[1].runtimeID;
      const answer = states[0].messages.filter(message => message.info.role === 'assistant' && message.info.parentID === followUpID)
        .flatMap(message => message.parts.filter(part => part.type === 'text').map(part => part.text)).join('\n').trim();
      checked(answer === 'hello-workspace', 'Follow-up answer did not match the file contents.');
      report.verified.push('duplicate request deduplication, follow-up queue and answer, command approval from second client, file result, tracked diff and change listing');
      if (parallel) {
        checked((await readFile(join(tasks[1].directory, 'parallel.txt'), 'utf8')) === 'isolated-worktree\n', 'Parallel worktree output differed from the expected result.');
        const otherChanges = await desktop(`/tasks/${tasks[1].id}/changes`);
        checked(otherChanges.status.includes('parallel.txt') && !otherChanges.status.includes('smoke.txt') && !changes.status.includes('parallel.txt'), 'Parallel task changes were not isolated.');
        report.verified.push('two real model tasks executed with isolated branches, sessions and results');
      }
      checked((await git(repo, ['status', '--porcelain'])) === '', 'Fixture source checkout was changed.');
      const reconnect = client(base);
      await reconnect('/login', { password });
      const restored = await reconnect(`/tasks/${task.id}`);
      checked(restored.sessionID === task.sessionID && restored.queue.length === 2 && restored.queue.every(message => message.status === 'completed'), 'Client reconnection did not show the same completed task.');
      report.verified.push('new authenticated client reconnects to the same task');
      completed = true;
      break;
    }
  }
  checked(completed, `Timed out after ${timeoutSeconds}s. Active fixture tasks will be stopped; inspect state before retrying to avoid duplicate billable work.`);
  report.status = 'passed';
} catch (error) {
  // Never print provider responses, prompts, permission commands, or credentials.
  report.error = error instanceof SmokeError ? error.message : 'Live smoke could not finish. Run doctor and inspect the retained private fixture state/logs; provider responses are not printed.';
  console.error(`FAIL (live model): ${report.error}`);
  process.exitCode = 1;
} finally {
  if (workspace) {
    try { await workspace.close(); }
    catch { report.cleanupWarning = 'Workspace shutdown could not be confirmed cleanly. Check the retained fixture before rerunning.'; }
    for (const task of workspace.data.tasks) {
      if (task.current) {
        try { await workspace.stop(task.id); }
        catch { report.cleanupWarning = 'An active fixture task could not be confirmed stopped. Check its OpenCode session before rerunning.'; }
      }
    }
  }
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (instance) {
    try { await instance.close(); }
    catch { report.cleanupWarning = 'Runtime shutdown could not be confirmed. Check its process before rerunning.'; }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(dir, 'smoke-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  if (report.status === 'passed') console.log('PASS (live model): authenticated clients, queued turns, approval and isolated file results. Physical remote devices and Tailscale were not exercised.');
  if (report.cleanupWarning) console.error(report.cleanupWarning);
  console.log(`Fixture and safe result report retained at ${dir}`);
}
