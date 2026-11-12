import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ollamaDiagnostics, baseDiagnostics } from '../src/doctor.ts';
import { planPreparation, prepare } from '../src/prepare.ts';

const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'paw-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const envFor = root => ({ PATH: root, TAILSCALE_BIN: 'missing-test-tailscale', HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data') });
function binary(root, name, output) {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\ncat <<'PAW_OUTPUT'\n${output}\nPAW_OUTPUT\n`, { mode: 0o700 });
  return path;
}

test('readiness diagnostics issue metadata GETs only and report an empty catalog without inventing a failed download', async t => {
  const root = fixture(t), calls = [];
  const checks = await ollamaDiagnostics({ env: envFor(root), home: root, requireOllama: true, fetcher: async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.endsWith('/api/version') ? { version: '0.40.16' } : { models: [] });
  } });
  assert.deepEqual(calls.map(call => call.url), ['http://127.0.0.1:11434/api/version', 'http://127.0.0.1:11434/api/tags']);
  assert.ok(calls.every(call => call.init.redirect === 'error' && !call.init.body && !call.init.method));
  assert.equal(checks.find(check => check.code === 'ollama.models').status, 'fail');
  assert.match(checks.find(check => check.code === 'ollama.models').action, /does not prove a download failed/);
});

test('doctor never follows nonlocal Ollama origins and never echoes provider error bodies', async t => {
  const root = fixture(t); let calls = 0;
  const invalid = await ollamaDiagnostics({ env: { ...envFor(root), OLLAMA_URL: 'https://secret@example.com/' }, fetcher: async () => { calls++; throw new Error('bad'); } });
  assert.equal(calls, 0); assert.equal(invalid[0].status, 'fail');
  assert.doesNotMatch(JSON.stringify(invalid), /secret@example/);
  const failed = await ollamaDiagnostics({ env: envFor(root), home: root, fetcher: async () => new Response('SECRET_PROVIDER_ERROR', { status: 500 }) });
  assert.equal(failed[0].status, 'warn'); assert.doesNotMatch(JSON.stringify(failed), /SECRET_PROVIDER_ERROR/);
});

test('requiring Ollama fails when tags contain only cloud models or malformed remote markers', async t => {
  const root = fixture(t);
  const models = [
    { name: 'fixture:cloud' }, { name: 'fixture-cloud:latest' },
    { name: 'remote-model', remote_model: 'fixture' },
    { name: 'remote-host', remote_host: 'https://ollama.com' },
    { name: 'malformed-model', remote_model: false },
    { name: 'malformed-host', remote_host: null },
  ];
  const checks = await ollamaDiagnostics({ env: envFor(root), home: root, requireOllama: true,
    fetcher: async url => Response.json(url.endsWith('/api/version') ? { version: '0.40.16' } : { models }) });
  const modelCheck = checks.find(check => check.code === 'ollama.models');
  assert.equal(modelCheck.status, 'fail');
  assert.equal(modelCheck.message, '0 installed local model(s).');
});

test('doctor separates timeout and CLI/server version mismatch from model inference', async t => {
  const root = fixture(t);
  const timeout = await ollamaDiagnostics({ env: envFor(root), home: root, requireOllama: true, fetcher: async () => { throw new DOMException('secret', 'TimeoutError'); } });
  assert.equal(timeout[0].code, 'ollama.timeout'); assert.equal(timeout[0].status, 'fail');
  const ollama = join(root, 'ollama');
  writeFileSync(ollama, '#!/bin/sh\nprintf "ollama version is 0.22.0\\n"\nprintf "Warning: client version is 0.40.16 SECRET_STDERR\\n" >&2\n', { mode: 0o700 });
  const checks = await ollamaDiagnostics({ env: { ...envFor(root), PATH: `${root}:/usr/bin:/bin`, OLLAMA_BIN: ollama }, home: root, fetcher: async url => Response.json(url.endsWith('/api/version') ? { version: '0.22.0' } : { models: [{ name: 'qwen' }] }) });
  assert.equal(checks.find(check => check.code === 'ollama.version').status, 'warn');
  assert.match(checks.find(check => check.code === 'ollama.version').message, /0.40.16.*0.22.0/);
  assert.doesNotMatch(JSON.stringify(checks), /SECRET_STDERR/);
});

test('base diagnostics preserve stable codes and omit credentials and raw binary output', t => {
  const root = fixture(t);
  for (const name of ['git', 'opencode']) binary(root, name, 'SECRET_TOOL_VALUE version 1.2.3');
  const report = baseDiagnostics({ env: { ...envFor(root), PATH: `${root}:/usr/bin:/bin`, OPENCODE_CONFIG_CONTENT: 'SECRET_INLINE_CONFIG', OPENCODE_SERVER_PASSWORD: 'SECRET_PASSWORD', WORKSPACE_PUBLIC_ORIGIN: 'https://mini.tail123.ts.net' }, home: root, cwd: root });
  assert.equal(report.version, 1);
  assert.ok(report.checks.some(check => check.code.startsWith('tailscale.') && check.status === 'fail'));
  assert.doesNotMatch(JSON.stringify(report), /SECRET_TOOL_VALUE|SECRET_INLINE_CONFIG|SECRET_PASSWORD/);
});

test('dry-run returns the exact review files without creating a directory, then preparation preserves existing config', t => {
  const root = fixture(t), appDirectory = join(root, 'application'), output = join(root, 'review'), envFile = join(root, 'server.env');
  mkdirSync(appDirectory); writeFileSync(envFile, 'WORKSPACE_PASSWORD=SECRET_EXISTING_PASSWORD');
  const options = { appDirectory, output, 'data-dir': join(root, 'state'), 'env-file': envFile };
  const bundle = planPreparation(options);
  assert.equal(existsSync(output), false); assert.equal(existsSync(join(root, 'state')), false);
  assert.doesNotMatch(JSON.stringify(bundle), /SECRET_EXISTING_PASSWORD/);
  prepare(options);
  for (const [name, contents] of Object.entries(bundle.files)) assert.equal(readFileSync(join(output, name), 'utf8'), contents);
  assert.equal(readFileSync(envFile, 'utf8'), 'WORKSPACE_PASSWORD=SECRET_EXISTING_PASSWORD');
  assert.throws(() => planPreparation(options), /already exists/);
});

test('init CLI rejects missing application, unknown options and existing dangling output symlinks', t => {
  const root = fixture(t);
  for (const args of [['init', '--output', join(root, 'out')], ['doctor', '--password', 'SECRET_ARGUMENT'], ['wat']]) {
    const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: envFor(root), cwd: root });
    assert.equal(result.status, 2); assert.doesNotMatch(result.stderr, /SECRET_ARGUMENT/);
  }
  const appDirectory = join(root, 'app'); mkdirSync(join(appDirectory, 'src'), { recursive: true }); writeFileSync(join(appDirectory, 'src/main.js'), '');
  const output = join(root, 'review');
  const dryRun = spawnSync(process.execPath, [bin, 'init', '--app-dir', appDirectory, '--output', output, '--dry-run', '--json'], { encoding: 'utf8', env: envFor(root), cwd: root });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).dryRun, true); assert.equal(existsSync(output), false);
  mkdirSync(output); symlinkSync(join(root, 'absent'), join(output, 'server.env.example'));
  assert.throws(() => planPreparation({ appDirectory, output }), /already exists/);
  assert.deepEqual(readdirSync(output), ['server.env.example']);
});
