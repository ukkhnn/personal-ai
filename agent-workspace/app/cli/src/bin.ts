#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { formatDoctor, runDoctor } from './doctor.ts';
import { planPreparation, prepare } from './prepare.ts';

const help = `paw — Personal AI Workspace tools

Usage:
  paw doctor [--json] [--app-dir /path/to/app] [--require-ollama]
  paw init --app-dir /path/to/app --output /path/to/review [--dry-run] [--json]
           [--data-dir /path/to/state] [--env-file /path/to/server.env]
           [--origin https://device.tailnet.ts.net] [--opencode /path/to/opencode]
  paw --help
  paw --version

doctor reads local tool and service metadata; it never runs a model.
init generates a private macOS review bundle. It does not install software,
load LaunchAgents, start the server, or change Tailscale settings.
--dry-run prints all proposed files without writing them.
Exit codes: 0 success (warnings allowed), 1 failed diagnostics, 2 invalid command/setup.
Environment settings are read from the current process; .env files are not auto-loaded.
`;

class UsageError extends Error {}
function application(value: string | undefined, required: boolean): string | undefined {
  if (!value) { if (required) throw new UsageError('init requires --app-dir /absolute/path/to/workspace/app.'); return existsSync(join(process.cwd(), 'src/main.js')) ? process.cwd() : undefined; }
  if (!isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) || !existsSync(join(value, 'src/main.js'))) throw new UsageError('--app-dir must be an absolute workspace app directory containing src/main.js.');
  return value;
}

async function main(args: string[]): Promise<number> {
  if (!args.length || args[0] === '--help' || args[0] === '-h') { console.log(help); return 0; }
  if (args[0] === '--version' && args.length === 1) { console.log('0.1.0'); return 0; }
  const command = args[0];
  if (command !== 'doctor' && command !== 'init') throw new UsageError('Unknown command. Run paw --help.');
  if (args.length === 2 && ['--help', '-h'].includes(args[1] ?? '')) { console.log(help); return 0; }
  if (command === 'doctor') {
    const { values } = parseArgs({ args: args.slice(1), options: { json: { type: 'boolean' }, 'app-dir': { type: 'string' }, 'require-ollama': { type: 'boolean' } }, allowPositionals: false });
    const report = await runDoctor({ appDirectory: application(values['app-dir'], false), requireOllama: values['require-ollama'] });
    console.log(values.json ? JSON.stringify(report, null, 2) : formatDoctor(report));
    return report.ok ? 0 : 1;
  }
  const { values } = parseArgs({ args: args.slice(1), options: {
    json: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'app-dir': { type: 'string' },
    output: { type: 'string' }, 'data-dir': { type: 'string' }, 'env-file': { type: 'string' }, origin: { type: 'string' }, opencode: { type: 'string' },
  }, allowPositionals: false });
  const options = { ...values, appDirectory: application(values['app-dir'], true) };
  const bundle = planPreparation(options);
  if (values['dry-run']) console.log(values.json ? JSON.stringify({ ...bundle, dryRun: true }, null, 2)
    : Object.entries(bundle.files).map(([name, contents]) => `--- ${name} (planned) ---\n${contents}`).join('\n'));
  else {
    prepare(options);
    console.log(values.json ? JSON.stringify({ version: 1, dryRun: false, outputDirectory: bundle.outputDirectory, files: Object.keys(bundle.files) }, null, 2)
      : `Prepared ${Object.keys(bundle.files).length} files in ${bundle.outputDirectory}. No services or network settings changed.`);
  }
  return 0;
}

try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) {
  // Argument parsers/filesystem exceptions may echo secrets passed as arguments.
  const message = error instanceof UsageError ? error.message : 'Command failed. Check options, local paths and existing output files; run paw --help.';
  console.error(process.argv.includes('--json') ? JSON.stringify({ version: 1, error: { code: 'command_error', message } }) : message);
  process.exitCode = 2;
}
