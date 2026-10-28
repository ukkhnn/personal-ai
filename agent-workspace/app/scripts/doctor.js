import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

console.log(`Node ${process.version}`);
for (const binary of ['git', process.env.OPENCODE_BIN || 'opencode']) {
  try { console.log(`${binary}: ${execFileSync(binary, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()}`); }
  catch { console.log(`${binary}: not available`); process.exitCode = 1; }
}
console.log(`OpenCode user config: ${existsSync(join(homedir(), '.config/opencode/opencode.json')) ? 'present (not printed)' : 'not found at default path'}`);
console.log(`Data directory: ${process.env.WORKSPACE_DATA_DIR || join(homedir(), '.local/share/personal-ai')}`);
console.log('Credentials are never copied into the project. Start the app to inspect connected model names.');
