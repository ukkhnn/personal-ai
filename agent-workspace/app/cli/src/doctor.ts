import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertLocalPath } from './paths.ts';
import { findBinary } from './runtime-config.ts';
export { findBinary } from './runtime-config.ts';

export type ProbeResult = { ok: true; output: string } | { ok: false; reason: 'timed out' | 'unavailable or not running' };
export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface DiagnosticCheck { code: string; status: CheckStatus; message: string; action?: string }
export interface DoctorReport { version: 1; ok: boolean; checks: DiagnosticCheck[] }
export interface DoctorOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  appDirectory?: string;
  cwd?: string;
  requireOllama?: boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const versionOf = (value: string): string | undefined => value.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];

function ollamaCliVersion(binary: string, env: NodeJS.ProcessEnv): string | undefined {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, TERM: env.TERM || 'dumb', SHLVL: '1' } });
  if (result.status !== 0) return undefined;
  // Ollama can print the server version first and the client mismatch warning on stderr.
  // Return only the validated version, never either stream's raw content.
  const output = `${result.stdout}\n${result.stderr}`;
  return output.match(/client version is (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1] ?? versionOf(result.stdout);
}

export function probe(binary: string, args: string[], env: NodeJS.ProcessEnv = process.env): ProbeResult {
  try {
    return { ok: true, output: execFileSync(binary, args, {
      encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, TERM: env.TERM || 'dumb', SHLVL: '1' },
    }) };
  } catch (error) {
    return { ok: false, reason: record(error).code === 'ETIMEDOUT' ? 'timed out' : 'unavailable or not running' };
  }
}

export function summarizeTailscale(status: unknown, serve: unknown, port = 4310) {
  const statusRecord = record(status), self = record(statusRecord.Self), serveRecord = record(serve);
  const dnsName = typeof self.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : '';
  const origin = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/i.test(dnsName) ? `https://${dnsName.toLowerCase()}` : null;
  const backendState = typeof statusRecord.BackendState === 'string' && ['Running', 'Stopped', 'NeedsLogin', 'NeedsMachineAuth', 'Starting', 'NoState', 'InUseOtherUser'].includes(statusRecord.BackendState) ? statusRecord.BackendState : 'unknown';
  const web = record(serveRecord.Web);
  const endpoint = origin ? record(web[`${new URL(origin).hostname}:443`]) : {};
  const handler = record(record(endpoint.Handlers)['/']);
  return {
    backendState, online: self.Online === true, origin,
    workspaceProxy: Boolean(origin && handler.Proxy === `http://127.0.0.1:${port}`),
    serveConfigured: Object.keys(record(serveRecord.TCP)).length > 0 || Object.keys(web).length > 0,
    funnelEnabled: Object.values(record(serveRecord.AllowFunnel)).some(value => value === true),
  };
}

export function baseDiagnostics(options: DoctorOptions = {}): DoctorReport {
  const env = options.env ?? process.env, home = options.home ?? homedir();
  const checks: DiagnosticCheck[] = [];
  const add = (code: string, status: CheckStatus, message: string, action?: string) => checks.push({ code, status, message, ...(action ? { action } : {}) });
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const supported = major > 22 || (major === 22 && minor >= 19);
  add('node.version', supported ? 'pass' : 'fail', `Node ${process.version}`, supported ? undefined : 'Install Node 22.19 or newer.');
  for (const name of ['git', 'opencode']) {
    const binary = findBinary(name, env, home, options.appDirectory);
    const result = binary ? probe(binary, ['--version'], env) : null;
    const required = name === 'git' || !env.OPENCODE_URL;
    add(`${name}.binary`, result?.ok ? 'pass' : required ? 'fail' : 'warn',
      result?.ok ? `${name}: ${versionOf(result.output) || 'available'}` : `${name}: ${result?.reason || 'not found'}`,
      result?.ok ? undefined : name === 'opencode' ? 'Set OPENCODE_BIN or run npm run setup:runtime in the workspace app directory.' : 'Install Git and check PATH.');
  }
  if (env.OPENCODE_URL) add('opencode.attachment', 'warn', 'Existing OpenCode endpoint configured; connectivity is checked at app startup.');
  const configRoot = env.XDG_CONFIG_HOME || join(home, '.config');
  const dataRoot = env.XDG_DATA_HOME || join(home, '.local/share');
  const configs = [join(configRoot, 'opencode/opencode.json'), join(configRoot, 'opencode/opencode.jsonc'), ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : [])];
  const configPresent = Boolean(env.OPENCODE_CONFIG_CONTENT) || configs.some(existsSync);
  add('opencode.config', configPresent ? 'pass' : 'warn', `OpenCode config: ${configPresent ? 'present' : 'not found'} (contents not read)`);
  const authPresent = existsSync(join(dataRoot, 'opencode/auth.json'));
  add('opencode.auth', authPresent ? 'pass' : 'warn', `OpenCode auth: ${authPresent ? 'present' : 'not found'} (contents not read)`, authPresent ? undefined : 'Configure a provider before starting a development task; environment-based credentials may also be used.');
  for (const [code, path] of [
    ['paths.app', options.appDirectory || options.cwd || process.cwd()],
    ['paths.data', env.WORKSPACE_DATA_DIR || join(home, '.local/share/personal-ai')],
  ] as const) {
    try { assertLocalPath(path); add(code, 'pass', 'Local filesystem path.'); }
    catch { add(code, 'fail', 'Path is unavailable or belongs to cloud storage.', 'Choose a local path outside iCloud and CloudStorage, including symlink targets.'); }
  }
  const remote = Boolean(env.WORKSPACE_PUBLIC_ORIGIN), tailscale = findBinary('tailscale', env, home);
  if (!tailscale) add('tailscale.binary', remote ? 'fail' : 'warn', 'Tailscale not found.', 'Local operation is available; install Tailscale to use remote HTTPS.');
  else {
    const status = probe(tailscale, ['status', '--json'], env), serve = probe(tailscale, ['serve', 'status', '--json'], env);
    if (!status.ok || !serve.ok) add('tailscale.status', remote ? 'fail' : 'warn', 'Tailscale status unavailable.', 'Start Tailscale and check login; no settings were changed.');
    else {
      try {
        const statusData: unknown = JSON.parse(status.output), serveData: unknown = JSON.parse(serve.output);
        if (!isRecord(statusData) || !isRecord(serveData)) throw new Error('Invalid status');
        const info = summarizeTailscale(statusData, serveData, Number(env.PORT || 4310));
        const ready = info.online && info.origin === env.WORKSPACE_PUBLIC_ORIGIN && info.workspaceProxy;
        add('tailscale.status', remote && !ready ? 'fail' : info.online ? 'pass' : 'warn', `Tailscale ${info.backendState}; online=${info.online}, workspace HTTPS proxy=${info.workspaceProxy}.`, remote && !ready ? 'Check WORKSPACE_PUBLIC_ORIGIN and the Serve proxy for the workspace port.' : undefined);
        add('tailscale.funnel', info.funnelEnabled ? 'fail' : 'pass', `Public Funnel ${info.funnelEnabled ? 'enabled' : 'off'}.`, info.funnelEnabled ? 'Disable public Funnel exposure before using the workspace.' : undefined);
      } catch { add('tailscale.status', remote ? 'fail' : 'warn', 'Tailscale JSON status invalid; raw output omitted.'); }
    }
  }
  return { version: 1, ok: !checks.some(check => check.status === 'fail'), checks };
}

export function validateOllamaOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Ollama must use a literal loopback HTTP origin.');
  return url.origin;
}

async function readJson(url: string, fetcher: typeof fetch, timeoutMs: number): Promise<unknown> {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Unexpected response'); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new Error('Response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function ollamaDiagnostics(options: DoctorOptions = {}): Promise<DiagnosticCheck[]> {
  const env = options.env ?? process.env, required = options.requireOllama ?? false;
  const unavailable: CheckStatus = required ? 'fail' : 'warn';
  let origin: string;
  try { origin = validateOllamaOrigin(env.OLLAMA_URL || 'http://127.0.0.1:11434'); }
  catch { return [{ code: 'ollama.origin', status: 'fail', message: 'Ollama URL is not a literal loopback HTTP origin.', action: 'Set OLLAMA_URL=http://127.0.0.1:11434.' }]; }
  const binary = findBinary('ollama', env, options.home);
  const cliVersion = binary ? ollamaCliVersion(binary, env) : undefined;
  try {
    const timeoutMs = options.timeoutMs ?? 3000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid readiness timeout');
    const versionData = record(await readJson(`${origin}/api/version`, options.fetcher ?? fetch, timeoutMs));
    const tagsData = record(await readJson(`${origin}/api/tags`, options.fetcher ?? fetch, timeoutMs));
    if (typeof versionData.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(versionData.version) || !Array.isArray(tagsData.models)) throw new Error('Invalid metadata');
    const checks: DiagnosticCheck[] = [{ code: 'ollama.server', status: 'pass', message: `Ollama server ${versionData.version} is ready.` }];
    checks.push(cliVersion && cliVersion !== versionData.version
      ? { code: 'ollama.version', status: 'warn', message: `CLI ${cliVersion} differs from server ${versionData.version}.`, action: 'Restart the existing Ollama service after an upgrade, then run doctor again.' }
      : { code: 'ollama.version', status: cliVersion ? 'pass' : 'warn', message: cliVersion ? 'CLI and server versions match.' : 'Ollama CLI version unavailable; server API is reachable.' });
    const modelCount = tagsData.models.filter(model => {
      const entry = record(model);
      if (typeof entry.name !== 'string' || !entry.name || /(?:[:-])cloud\b/i.test(entry.name)) return false;
      // Remote tags cannot run in the local-only experiment adapter. Malformed
      // remote markers are not evidence that a tag is local either.
      return [entry.remote_model, entry.remote_host].every(marker => marker === undefined || marker === '');
    }).length;
    checks.push({ code: 'ollama.models', status: modelCount ? 'pass' : unavailable, message: `${modelCount} installed local model(s).`, ...(modelCount ? {} : { action: 'Finish an ollama pull for a local model in your terminal, then retry doctor. An empty list alone does not prove a download failed.' }) });
    return checks;
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    return [{ code: timeout ? 'ollama.timeout' : 'ollama.unavailable', status: unavailable,
      message: timeout ? 'Ollama readiness request timed out.' : 'Ollama readiness could not be confirmed.',
      action: 'Check the existing Ollama service and wait for /api/version to respond before pulling a model. No models were downloaded or run.' }];
  }
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const report = baseDiagnostics(options);
  report.checks.push(...await ollamaDiagnostics(options));
  report.ok = !report.checks.some(check => check.status === 'fail');
  return report;
}

export function formatDoctor(report: DoctorReport): string {
  return report.checks.map(check => `${check.status.toUpperCase()} ${check.code}: ${check.message}${check.action ? `\n  ${check.action}` : ''}`).join('\n');
}
