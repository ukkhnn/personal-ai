import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { launchRuntime } from './opencode.js';
import { Workspace } from './workspace.js';
import { createApp } from './server.js';
import { assertLocalPath } from './paths.js';
import { normalizePublicOrigin } from './http-security.js';
import { repository } from './git.js';

assertLocalPath(fileURLToPath(new URL('..', import.meta.url)), '앱 실행 저장소');
const dataDirectory = assertLocalPath(resolve(process.env.WORKSPACE_DATA_DIR || join(homedir(), '.local/share/personal-ai')), '상태 데이터');
const publicOrigin = normalizePublicOrigin(process.env.WORKSPACE_PUBLIC_ORIGIN);
const port = Number(process.env.PORT || 4310);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
chmodSync(dataDirectory, 0o700);
const lock = join(dataDirectory, 'server.pid');
try {
  const pid = Number(readFileSync(lock, 'utf8'));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid server.pid. Inspect it before starting.');
  let alive = true;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
  if (alive) throw new Error('This data directory already has a running server.');
  unlinkSync(lock);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
let instance, workspace, server, shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server) { server.close(); server.closeIdleConnections(); }
  if (workspace) await workspace.close();
  if (instance) await instance.close();
  try { if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); } catch {}
}
try {
  const codeFile = join(dataDirectory, 'access-code.txt');
  let password = process.env.WORKSPACE_PASSWORD;
  if (!password) {
    try { password = readFileSync(codeFile, 'utf8').trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!password) { password = randomBytes(24).toString('base64url'); writeFileSync(codeFile, password, { mode: 0o600 }); }
    chmodSync(codeFile, 0o600);
  }
  if (password.length < 16) throw new Error('WORKSPACE_PASSWORD must be at least 16 characters.');
  const store = new Store(dataDirectory);
  for (const record of [...store.data.projects, ...store.data.tasks]) {
    if (typeof record.directory !== 'string') throw new Error('Saved execution path is missing. Inspect the local workspace data.');
    await repository(record.directory); // Revalidate both worktree and shared Git metadata on restore.
  }
  instance = await launchRuntime(dataDirectory);
  workspace = new Workspace(store, instance.runtime, dataDirectory);
  server = createApp(workspace, instance.runtime, password, { publicOrigin });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  workspace.start();
  console.log(`Workspace: http://127.0.0.1:${port}\nRemote: ${publicOrigin || 'not configured'}\nData: ${dataDirectory}\nLogin: ${process.env.WORKSPACE_PASSWORD ? 'WORKSPACE_PASSWORD from environment' : codeFile}\nKeep this process running while tasks execute.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown().then(() => process.exit(0)); });
} catch (error) { console.error(error.message); await shutdown(); process.exitCode = 1; }
