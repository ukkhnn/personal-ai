import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findOpenCode as locate } from '../cli/src/runtime-config.ts';
export { executable } from '../cli/src/runtime-config.ts';

export function findOpenCode(env = process.env, home = homedir()) {
  return locate(env, home, fileURLToPath(new URL('..', import.meta.url)));
}
