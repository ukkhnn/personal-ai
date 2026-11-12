import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baseDiagnostics, formatDoctor, runDoctor } from '../cli/src/doctor.ts';
import { findBinary as locate } from '../cli/src/runtime-config.ts';
export { probe, summarizeTailscale } from '../cli/src/doctor.ts';

const appDirectory = fileURLToPath(new URL('..', import.meta.url));
export function findBinary(name, env = process.env, home = homedir()) {
  return locate(name, env, home, appDirectory);
}
export function doctor(env = process.env) {
  const report = baseDiagnostics({ env, appDirectory });
  return { ok: report.ok, output: formatDoctor(report).split('\n') };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runDoctor({ appDirectory });
  console.log(formatDoctor(report));
  process.exitCode = report.ok ? 0 : 1;
}
