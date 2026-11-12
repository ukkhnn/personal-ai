import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'paw install smoke '));
const prefix = join(root, 'installed'), home = join(root, 'home'), binaries = join(root, 'bin');
const requests = [];
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  response.setHeader('content-type', 'application/json');
  if (request.url === '/api/version') response.end(JSON.stringify({ version: '1.2.3' }));
  else if (request.url === '/api/tags') response.end(JSON.stringify({ models: [{ name: 'fixture:small' }] }));
  else { response.statusCode = 404; response.end('{}'); }
});

function run(file, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    execFile(file, args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') { reject(error); return; }
      resolveResult({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

try {
  for (const directory of [prefix, home, binaries]) mkdirSync(directory);
  // Install and execute without the developer's HOME, config, credentials or tool PATH.
  const env = { HOME: home, PATH: `${binaries}:${dirname(process.execPath)}:/usr/bin:/bin`,
    XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'),
    WORKSPACE_DATA_DIR: join(home, 'state'), TAILSCALE_BIN: join(binaries, 'not-installed'),
    npm_config_cache: join(root, 'npm-cache'), npm_config_update_notifier: 'false' };
  for (const name of ['git', 'opencode', 'ollama']) {
    writeFileSync(join(binaries, name), '#!/usr/bin/env node\nconsole.log("fixture version 1.2.3");\n', { mode: 0o700 });
  }
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run this check through npm run test:package.');
  const packed = await run(process.execPath, [npm, 'pack', '--workspace', '@personal-ai/workspace-cli', '--json', '--ignore-scripts', '--pack-destination', root], { cwd: app, env });
  assert.equal(packed.code, 0, packed.stderr);
  const [metadata] = JSON.parse(packed.stdout);
  assert.ok(metadata.files.some(file => file.path === 'dist/bin.js'));
  assert.ok(metadata.files.some(file => file.path === 'README.md'));
  assert.ok(metadata.files.every(file => !file.path.startsWith('src/') && !file.path.startsWith('test/') && !file.path.includes('.env')));
  const tarball = join(root, metadata.filename);
  const installed = await run(process.execPath, [npm, 'install', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: home, env });
  assert.equal(installed.code, 0, installed.stderr);
  const bin = join(prefix, 'node_modules', '.bin', 'paw');
  const invoke = args => run(bin, args, { cwd: home, env });
  const help = await invoke(['--help']);
  assert.equal(help.code, 0, help.stderr); assert.match(help.stdout, /paw doctor/);
  const version = await invoke(['--version']);
  assert.equal(version.stdout.trim(), metadata.version);
  const invalid = await invoke(['unknown', '--json']);
  assert.equal(invalid.code, 2); assert.equal(JSON.parse(invalid.stderr).error.code, 'command_error');

  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  env.OLLAMA_URL = `http://127.0.0.1:${server.address().port}`;
  const doctor = await invoke(['doctor', '--json', '--require-ollama']);
  assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.version, 1); assert.equal(report.ok, true);
  assert.ok(report.checks.some(check => check.code === 'ollama.server' && check.status === 'pass'));
  assert.deepEqual(requests, ['GET /api/version', 'GET /api/tags']);

  const fixtureApp = join(root, 'app with spaces'), output = join(root, 'review bundle');
  mkdirSync(join(fixtureApp, 'src'), { recursive: true });
  writeFileSync(join(fixtureApp, 'src/main.js'), '// Installation smoke fixture; never executed.\n');
  const initArgs = ['init', '--app-dir', fixtureApp, '--output', output, '--json'];
  const dryRun = await invoke([...initArgs, '--dry-run']);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  const plan = JSON.parse(dryRun.stdout);
  assert.equal(plan.dryRun, true); assert.equal(existsSync(output), false);
  const created = await invoke(initArgs);
  assert.equal(created.code, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).dryRun, false);
  assert.deepEqual(readdirSync(output).sort(), Object.keys(plan.files).sort());
  for (const [name, contents] of Object.entries(plan.files)) {
    assert.equal(readFileSync(join(output, name), 'utf8'), contents);
    assert.equal(statSync(join(output, name)).mode & 0o777, 0o600);
  }
  assert.equal(existsSync(join(home, 'state')), false, 'init must not create runtime state');
  const duplicate = await invoke(initArgs);
  assert.equal(duplicate.code, 2, 'existing preparation files must never be overwritten');
  assert.equal(JSON.parse(created.stdout).outputDirectory, realpathSync(output));
  console.log('CLI tarball installed offline; help, errors, read-only diagnostics, dry-run and private output verified.');
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
  rmSync(root, { recursive: true, force: true });
}
