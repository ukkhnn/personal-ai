import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

export function executable(path: string): string | null {
  try { accessSync(path, constants.X_OK); return resolve(path); } catch { return null; }
}

export function findOpenCode(env: NodeJS.ProcessEnv = process.env, home = homedir(), appDirectory?: string): string {
  const lookup = (name: string): string | null => name.includes('/') ? executable(name)
    : (env.PATH || '').split(delimiter).filter(Boolean).map(p => executable(join(p, name))).find(p => p !== null) ?? null;
  if (env.OPENCODE_BIN) {
    const found = lookup(env.OPENCODE_BIN);
    if (!found) throw new Error('OPENCODE_BIN executable is unavailable. Check the configured local path.');
    return found;
  }
  const existing = lookup('opencode') || executable(join(home, '.opencode/bin/opencode')) || executable(join(home, '.local/bin/opencode'));
  if (existing) return existing;
  if (appDirectory) {
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const local = join(appDirectory, `tools/opencode/node_modules/opencode-${platform}-${process.arch}/bin/opencode${process.platform === 'win32' ? '.exe' : ''}`);
    const found = executable(local);
    if (found) return found;
  }
  throw new Error('OpenCode is unavailable. Reuse an existing OPENCODE_BIN or run npm run setup:runtime from the workspace app directory.');
}

export function findBinary(name: string, env: NodeJS.ProcessEnv = process.env, home = homedir(), appDirectory?: string): string | null {
  if (name === 'opencode') { try { return findOpenCode(env, home, appDirectory); } catch { return null; } }
  const override = name === 'tailscale' ? env.TAILSCALE_BIN : name === 'ollama' ? env.OLLAMA_BIN : undefined;
  const requested = override || name;
  const candidates = requested.includes('/') ? [requested] : [
    ...(env.PATH || '').split(delimiter).filter(Boolean).map(dir => join(dir, requested)),
    ...(!override && name === 'tailscale' ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : []),
  ];
  for (const candidate of candidates) { const found = executable(candidate); if (found) return found; }
  return null;
}
