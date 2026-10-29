import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function executable(path) {
  try { accessSync(path, constants.X_OK); return resolve(path); } catch { return null; }
}
export function findOpenCode(env = process.env, home = homedir()) {
  const lookup = name => name.includes('/') ? executable(name)
    : (env.PATH || '').split(delimiter).filter(Boolean).map(p => executable(join(p, name))).find(Boolean);
  if (env.OPENCODE_BIN) {
    const found = lookup(env.OPENCODE_BIN);
    if (!found) throw new Error('OPENCODE_BIN executable is unavailable. Check the configured local path.');
    return found;
  }
  const existing = lookup('opencode') || executable(join(home, '.opencode/bin/opencode')) || executable(join(home, '.local/bin/opencode'));
  if (existing) return existing;
  // Use the native optional package directly; npm lifecycle scripts are not needed.
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const local = fileURLToPath(new URL(`../tools/opencode/node_modules/opencode-${platform}-${process.arch}/bin/opencode${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
  if (executable(local)) return local;
  throw new Error('OpenCode is unavailable. Reuse an existing OPENCODE_BIN or run npm run setup:runtime for the pinned project-local engine.');
}
