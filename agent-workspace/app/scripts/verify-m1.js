// Uses the EXISTING managed server. Never launches, restarts, or stops a service.
// Separate processes intentionally leave time with no verification HTTP client.
import { readFile, writeFile, mkdir, mkdtemp, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { git } from '../src/git.js';
import { assertLocalPath } from '../src/paths.js';

class VerificationError extends Error {}
const requireCheck = (condition, message) => { if (!condition) throw new VerificationError(message); };
const baseline = 'M1 retained verification fixture.\n';
const expected = 'hello-m1\n';

export function safeApproval(permission, sessionID) {
  return permission.sessionID === sessionID && permission.permission === 'bash'
    && typeof permission.metadata?.command === 'string' && permission.metadata.command.trim() === 'git diff --stat'
    && Array.isArray(permission.patterns) && permission.patterns.length > 0
    && permission.patterns.every(pattern => ['git diff', 'git diff --stat', 'git diff *'].includes(pattern));
}

export function validateTask(task, report, dataDirectory) {
  requireCheck(task.id === report.taskID && task.projectID === report.projectID
    && task.sessionID === report.sessionID && task.title === report.title
    && task.directory === join(dataDirectory, 'worktrees', task.id)
    && task.template.model.providerID === report.model.providerID
    && task.template.model.modelID === report.model.modelID,
  'Task identity changed; no permission was approved.');
  requireCheck(task.queue.length === 2 && task.queue[0].requestID === 'm1-edit'
    && task.queue[1].requestID === 'm1-follow-up', 'Unexpected task instructions; inspect before continuing.');
  requireCheck(!task.questions.length && !['failed', 'interrupted', 'uncertain', 'setup_failed', 'stopped'].includes(task.status),
    'Task needs manual inspection; no automatic retry, resume, or stop was performed.');
}

export function validateCompletion(task) {
  requireCheck(task.status === 'completed' && !task.current && task.queue.every(message => message.status === 'completed'),
    'Task has not completed.');
  const shell = task.messages.flatMap(message => message.parts || []).filter(part => part.type === 'tool' && part.tool === 'bash');
  requireCheck(shell.length === 1 && shell[0].state?.status === 'completed'
    && shell[0].state.input?.command?.trim() === 'git diff --stat'
    && shell[0].state.metadata?.exit === 0, 'Expected exactly one successful approved shell command.');
  const answer = task.messages.filter(message => message.info.role === 'assistant'
    && message.info.parentID === task.queue[1].runtimeID)
    .flatMap(message => message.parts.filter(part => part.type === 'text').map(part => part.text)).join('\n').trim();
  requireCheck(answer === expected.trim(), 'Follow-up answer did not match the generated file.');
}

async function save(file, report) {
  await writeFile(file + '.tmp', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(file + '.tmp', file);
}

async function identity(dataDirectory) {
  const appDirectory = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
  const status = execFileSync('launchctl', ['print', `gui/${process.getuid()}/local.personal-ai.workspace`],
    { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  const pid = Number(status.match(/^\s*pid = (\d+)$/m)?.[1]);
  requireCheck(status.includes('state = running') && status.includes(`working directory = ${appDirectory}\n`)
    && status.includes(`WORKSPACE_DATA_DIR => ${dataDirectory}\n`) && pid > 0,
  'Expected LaunchAgent is not running from this checkout/data directory.');
  requireCheck(Number(await readFile(join(dataDirectory, 'server.pid'), 'utf8')) === pid, 'Service PID does not match the data directory.');
  return pid;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const [phase, reportArgument] = args;
  requireCheck(['start', 'approve', 'verify'].includes(phase) && args.length === (phase === 'start' ? 1 : 2),
    'Usage: node scripts/verify-m1.js start | approve /absolute/report.json | verify /absolute/report.json');
  if (phase === 'start') requireCheck(env.LIVE_MODEL_TEST === '1' && env.LIVE_PROVIDER_ID && env.LIVE_MODEL_ID,
    'start requires LIVE_MODEL_TEST=1 and explicit LIVE_PROVIDER_ID / LIVE_MODEL_ID (two billable turns).');
  const dataDirectory = assertLocalPath(resolve(env.WORKSPACE_DATA_DIR || join(homedir(), '.local/share/personal-ai')));
  const port = Number(env.PORT || 4310);
  requireCheck(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid PORT.');
  // Never accept a remote URL from an argument or report: credentials stay local.
  const base = `http://127.0.0.1:${port}`;
  const pid = await identity(dataDirectory);
  let cookie;
  const api = async (path, input) => {
    const response = await fetch(base + '/api' + path, {
      method: input === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    requireCheck(response.ok, `Application request returned HTTP ${response.status}; inspect locally. Response contents omitted.`);
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response.json();
  };
  // No credentials, prompts, provider errors, or cookies are logged or reported.
  await api('/login', { password: env.WORKSPACE_PASSWORD || (await readFile(join(dataDirectory, 'access-code.txt'), 'utf8')).trim() });
  try {
    const runtime = await api('/runtime');
    requireCheck(runtime.health.healthy === true, 'Runtime is not healthy.');
    if (phase === 'start') {
      const model = { providerID: env.LIVE_PROVIDER_ID, modelID: env.LIVE_MODEL_ID };
      requireCheck(runtime.providers.some(provider => provider.id === model.providerID
        && provider.models.some(item => item.id === model.modelID)), 'Explicit model is not connected.');
      const parent = assertLocalPath(join(dataDirectory, 'verification'));
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const run = await mkdtemp(join(parent, 'm1-'));
      const file = join(run, 'report.json'), fixture = join(run, 'fixture');
      const report = { kind: 'managed-m1-v1', status: 'preparing', startedAt: new Date().toISOString(),
        serverPID: pid, runtimeVersion: runtime.health.version, model, fixture,
        title: `M1 disconnect verification ${new Date().toISOString()}`,
        physicalMacBookDisconnect: 'not automatically verified', https: 'not exercised by this local runner' };
      await save(file, report);
      console.log(`Retained report: ${file}`);
      await mkdir(fixture, { mode: 0o700 });
      await git(fixture, ['init', '-b', 'main']);
      await writeFile(join(fixture, 'README.md'), baseline);
      await git(fixture, ['add', 'README.md']);
      await git(fixture, ['-c', 'user.name=M1 verification', '-c', 'user.email=m1@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '-m', 'M1 verification fixture']);
      const project = await api('/projects', { directory: fixture });
      report.projectID = project.id; await save(file, report);
      const template = await api('/templates', { name: report.title, model,
        prompt: 'Follow the tiny M1 test exactly. Stay in this worktree. No subagents, network, installation, commits or pushes.', memory: '' });
      const task = await api('/tasks', { projectID: project.id, templateID: template.id, title: report.title });
      report.taskID = task.id; report.sessionID = task.sessionID;
      await save(file, report);
      requireCheck(task.sessionID && task.status === 'idle', 'Task setup failed; retained data was not deleted.');
      await api(`/tasks/${task.id}/messages`, { requestID: 'm1-edit', text:
        'Use file editing tools to create smoke.txt containing exactly hello-m1 followed by a newline. Append exactly M1 verified. followed by a newline to README.md. Then run exactly git diff --stat using the shell tool, awaiting approval. Run no other shell commands. Reply briefly.' });
      await api(`/tasks/${task.id}/messages`, { requestID: 'm1-follow-up', text:
        'Read smoke.txt with a file reading tool and reply with its contents only. Do not modify files or run shell commands.' });
      report.status = 'started'; report.clientReleasedAt = new Date().toISOString(); await save(file, report);
      console.log('STARTED. This client exits now. Disconnect the MacBook/terminal, then reconnect and run approve with the report path.');
      return;
    }
    const file = assertLocalPath(resolve(reportArgument));
    requireCheck(file.startsWith(join(dataDirectory, 'verification') + '/') && file.endsWith('/report.json'), 'Use a retained M1 report inside the data directory.');
    const report = JSON.parse(await readFile(file, 'utf8'));
    requireCheck(report.kind === 'managed-m1-v1' && /^[a-zA-Z0-9-]+$/.test(report.taskID)
      && report.fixture === join(file.slice(0, -'/report.json'.length), 'fixture'), 'Invalid M1 report.');
    requireCheck(pid === report.serverPID, 'Server PID changed; this run cannot prove uninterrupted service.');
    const task = await api(`/tasks/${report.taskID}`);
    validateTask(task, report, dataDirectory);
    requireCheck(await readFile(join(task.directory, 'smoke.txt'), 'utf8') === expected, 'Expected generated file is not ready.');
    const changes = await api(`/tasks/${task.id}/changes`);
    requireCheck(changes.status.includes('smoke.txt') && changes.diff.includes('+M1 verified.'), 'Expected file edits are not ready.');
    requireCheck(await git(report.fixture, ['status', '--porcelain']) === ''
      && await readFile(join(report.fixture, 'README.md'), 'utf8') === baseline, 'Source fixture changed.');
    if (phase === 'approve') {
      requireCheck(report.status === 'started', 'Approval already attempted or preparation incomplete. Inspect the task; do not blindly retry.');
      requireCheck(task.status === 'waiting_approval' && task.permissions.length === 1
        && safeApproval(task.permissions[0], task.sessionID), 'Exact git diff --stat approval is not ready; no command approved.');
      report.status = 'approval-sending'; report.approvalID = task.permissions[0].id;
      report.reconnectedAt = new Date().toISOString();
      await save(file, report); // Ambiguous sends must never be silently retried.
      await api(`/tasks/${task.id}/permissions`, { id: report.approvalID, reply: 'once' });
      report.status = 'approved'; report.approvedAt = new Date().toISOString(); await save(file, report);
      console.log('APPROVED once. This client exits now. Disconnect again, then reconnect and run verify with the same report.');
      return;
    }
    requireCheck(['approved', 'passed'].includes(report.status), 'No confirmed approval; inspect task before proceeding.');
    validateCompletion(task);
    report.status = 'passed'; report.verifiedAt = new Date().toISOString();
    report.verified = ['same managed server PID across separate client processes', 'file edit and approval wait after start client exit',
      'exact shell approval and exit code 0', 'queued follow-up completed before verify client read',
      'expected file and diff', 'source fixture unchanged', 'fresh authenticated client sees same task'];
    await save(file, report);
    console.log(`PASS (managed local M1 flow). Physical disconnect and HTTPS require separate evidence. Report: ${file}`);
  } finally {
    // Revoke only this runner's session; never stop its task or the shared server.
    try { await api('/logout', {}); } catch { console.error('Verification login could not be revoked; it expires normally.'); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const code = error.cause?.code || error.code;
    const category = ['EPERM', 'EACCES'].includes(code) ? 'BLOCKED (environment permissions)'
      : ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(code) ? 'BLOCKED (connection; service failure not established)' : 'NOT VERIFIED';
    console.error(`${category}: ${error instanceof VerificationError ? error.message : 'Inspect service/environment and retained report locally; raw errors omitted.'}`);
    process.exitCode = 1;
  });
}
