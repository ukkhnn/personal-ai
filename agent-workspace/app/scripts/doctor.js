import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { accessSync, constants, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertLocalPath } from '../src/paths.js';
import { findOpenCode } from '../src/runtime-config.js';

export function findBinary(name, env = process.env, home = homedir()) {
  if (name === 'opencode') {
    try { return findOpenCode(env, home); } catch { return null; }
  }
  const override = name === 'tailscale' ? env.TAILSCALE_BIN : undefined;
  const requested = override || name;
  const candidates = requested.includes('/') ? [requested] : [
    ...(env.PATH || '').split(delimiter).filter(Boolean).map(dir => join(dir, requested)),
    ...(!override && name === 'tailscale' ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : []),
  ];
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return resolve(candidate); } catch {}
  }
  return null;
}

export function probe(binary, args) {
  try {
    return { ok: true, output: execFileSync(binary, args, {
      encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TERM: process.env.TERM || 'dumb', SHLVL: '1' },
    }) };
  } catch (error) {
    // Never echo stderr: tools can include account, URL or credential details.
    return { ok: false, reason: error.code === 'ETIMEDOUT' ? 'timed out' : 'unavailable or not running' };
  }
}

export function summarizeTailscale(status, serve, port = 4310) {
  const dnsName = typeof status?.Self?.DNSName === 'string' ? status.Self.DNSName.replace(/\.$/, '') : '';
  const origin = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/i.test(dnsName) ? `https://${dnsName.toLowerCase()}` : null;
  const backendState = ['Running', 'Stopped', 'NeedsLogin', 'NeedsMachineAuth', 'Starting', 'NoState', 'InUseOtherUser'].includes(status?.BackendState) ? status.BackendState : 'unknown';
  const expectedProxy = `http://127.0.0.1:${port}`;
  const web = serve?.Web || {};
  const workspaceProxy = Boolean(origin && web[`${new URL(origin).hostname}:443`]?.Handlers?.['/']?.Proxy === expectedProxy);
  return {
    backendState, online: status?.Self?.Online === true, origin, workspaceProxy,
    serveConfigured: Object.keys(serve?.TCP || {}).length > 0 || Object.keys(web).length > 0,
    funnelEnabled: Object.values(serve?.AllowFunnel || {}).some(value => value === true),
  };
}

export function doctor(env = process.env) {
  const output = [], home = homedir();
  let ok = true;
  const [major, minor] = process.versions.node.split('.').map(Number);
  const supported = major > 22 || (major === 22 && minor >= 19);
  output.push(`Node ${process.version}: ${supported ? 'supported' : 'requires 22.19 or newer'}`);
  ok &&= supported;
  for (const name of ['git', 'opencode']) {
    const binary = findBinary(name, env);
    const result = binary ? probe(binary, ['--version']) : { ok: false, reason: 'not installed or not on PATH' };
    const version = result.output?.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?\b/)?.[0];
    output.push(`${name}: ${result.ok ? `${version || 'available'} (${binary})` : result.reason}`);
    if (!result.ok && !(name === 'opencode' && env.OPENCODE_URL)) ok = false;
  }
  if (env.OPENCODE_URL) output.push('OpenCode attachment: configured (URL and credentials not printed; connectivity requires app startup)');
  const configRoot = env.XDG_CONFIG_HOME || join(home, '.config');
  const dataRoot = env.XDG_DATA_HOME || join(home, '.local/share');
  const configFiles = [join(configRoot, 'opencode/opencode.json'), join(configRoot, 'opencode/opencode.jsonc')];
  if (env.OPENCODE_CONFIG) configFiles.push(env.OPENCODE_CONFIG);
  output.push(`OpenCode config file: ${configFiles.some(existsSync) ? 'present' : 'not found at configured/default paths'} (contents not read)`);
  output.push(`OpenCode auth file: ${existsSync(join(dataRoot, 'opencode/auth.json')) ? 'present' : 'not found at configured/default path'} (contents not read)`);
  if (env.OPENCODE_CONFIG_CONTENT) output.push('OpenCode inline config: present (not printed)');
  for (const [label, path] of [['Application directory', process.cwd()], ['Data directory', env.WORKSPACE_DATA_DIR || join(home, '.local/share/personal-ai')]]) {
    try { output.push(`${label}: ${assertLocalPath(path, label)}`); }
    catch (error) { output.push(`${label}: ${error.message}`); ok = false; }
  }
  const tailscale = findBinary('tailscale', env);
  if (!tailscale) output.push('Tailscale: not available; local operation remains possible');
  else {
    const status = probe(tailscale, ['status', '--json']);
    const serve = probe(tailscale, ['serve', 'status', '--json']);
    if (!status.ok || !serve.ok) output.push('Tailscale: status unavailable; no network settings changed');
    else {
      try {
        const info = summarizeTailscale(JSON.parse(status.output), JSON.parse(serve.output), Number(env.PORT || 4310));
        output.push(`Tailscale: ${info.backendState}, online=${info.online}`);
        output.push(`Tailscale HTTPS origin: ${info.origin || 'unavailable until connected'}`);
        output.push(`Serve: configured=${info.serveConfigured}, workspace HTTPS proxy=${info.workspaceProxy}, Funnel=${info.funnelEnabled ? 'ENABLED; disable public exposure before use' : 'off'}`);
        if (info.funnelEnabled || (env.WORKSPACE_PUBLIC_ORIGIN && (info.origin !== env.WORKSPACE_PUBLIC_ORIGIN || !info.workspaceProxy || !info.online))) ok = false;
      } catch { output.push('Tailscale: status could not be parsed (raw output omitted)'); if (env.WORKSPACE_PUBLIC_ORIGIN) ok = false; }
    }
    if ((!status.ok || !serve.ok) && env.WORKSPACE_PUBLIC_ORIGIN) ok = false;
  }
  if (!tailscale && env.WORKSPACE_PUBLIC_ORIGIN) ok = false;
  output.push('Read-only diagnostics. No config/auth copied, provider calls made, or system settings changed.');
  return { ok, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = doctor();
  console.log(result.output.join('\n'));
  if (!result.ok) process.exitCode = 1;
}
