import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LABEL, prepare, renderPlan, renderPlist, shellQuote, validateOrigin } from '../scripts/prepare-macos.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'personal-ai-ops-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('LaunchAgent uses separate arguments, XML escaping and a private external env file', t => {
  const root = fixture(t), appDirectory = join(root, `app & <test> "quote" 'single'`);
  const envFile = join(root, 'private settings/server.env');
  const options = { appDirectory, dataDirectory: join(root, 'local state'), envFile, origin: 'https://mini.example.ts.net', node: '/usr/bin/node', opencode: join(root, 'Open Code/bin/opencode'), path: '/usr/bin:/bin' };
  const plist = renderPlist(options);
  assert.match(plist, /app &amp; &lt;test&gt; &quot;quote&quot; &apos;single&apos;/);
  assert.match(plist, /<string>--env-file-if-exists=.*private settings\/server.env<\/string>/);
  assert.match(plist, /<key>WORKSPACE_PUBLIC_ORIGIN<\/key><string>https:\/\/mini\.example\.ts\.net<\/string>/);
  assert.doesNotMatch(plist, /WORKSPACE_PASSWORD|OPENCODE_SERVER_PASSWORD|\/bin\/sh/);
  assert.match(plist, /<key>Umask<\/key><integer>63<\/integer>/);
  if (process.platform === 'darwin') {
    const file = join(root, 'test.plist'); writeFileSync(file, plist);
    execFileSync('/usr/bin/plutil', ['-lint', file]);
  }
});

test('reviewable shell commands preserve spaces, apostrophes and metacharacters', () => {
  const value = `a 'quoted' path & $(echo UNEXPECTED) "*"`;
  assert.equal(execFileSync('/bin/sh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' }), value);
});

test('remote operation preparation requires an exact default-port Tailscale HTTPS origin', () => {
  assert.equal(validateOrigin('https://mini.tail123.ts.net'), 'https://mini.tail123.ts.net');
  for (const invalid of ['http://mini.tail123.ts.net', 'https://mini.tail123.ts.net/', 'https://mini.tail123.ts.net:443', 'https://mini.tail123.ts.net:8443', 'https://mini.tail123.ts.net/path', 'https://mini.tail123.ts.net?x=1', 'https://user@mini.tail123.ts.net', 'https://mini.ts.net.evil.test', 'https://example.com']) assert.throws(() => validateOrigin(invalid));
  const plan = renderPlan({ outputDirectory: '/tmp/out', appDirectory: '/tmp/app', dataDirectory: '/tmp/data', envFile: '/tmp/private.env', node: '/usr/bin/node' });
  assert.match(plan, /Remote activation command withheld/);
  assert.doesNotMatch(plan, /serve --bg/);
});

test('preparation refuses shared directories and symlink aliases before writing', t => {
  const root = fixture(t), cloud = join(root, 'Library/Mobile Documents/shared');
  mkdirSync(cloud, { recursive: true });
  const alias = join(root, 'innocent-name'); symlinkSync(cloud, alias);
  for (const output of [join(cloud, 'output'), join(alias, 'output')]) {
    assert.throws(() => prepare({ output, appDirectory: join(root, 'app'), 'data-dir': join(root, 'data') }), /iCloud/);
    assert.equal(existsSync(output), false);
  }
  assert.throws(() => renderPlist({ appDirectory: cloud, dataDirectory: join(root, 'data'), envFile: join(root, 'private.env') }), /iCloud/);
});

test('preparation writes only a private review bundle and preserves env and existing bundles', t => {
  const root = fixture(t), output = join(root, 'review bundle'), envFile = join(root, 'private.env');
  writeFileSync(envFile, 'WORKSPACE_PASSWORD=secret-do-not-copy\n');
  const options = { output, appDirectory: join(root, 'app'), 'data-dir': join(root, 'state'), 'env-file': envFile, origin: 'https://mini.tail123.ts.net' };
  prepare(options);
  assert.deepEqual(readdirSync(output).sort(), [`${LABEL}.plist`, 'remote-plan.txt', 'server.env.example'].sort());
  assert.equal(existsSync(join(root, 'state')), false);
  for (const file of readdirSync(output)) {
    assert.equal(statSync(join(output, file)).mode & 0o777, 0o600);
    assert.doesNotMatch(readFileSync(join(output, file), 'utf8'), /secret-do-not-copy/);
  }
  assert.equal(readFileSync(envFile, 'utf8'), 'WORKSPACE_PASSWORD=secret-do-not-copy\n');
  assert.throws(() => prepare(options), /already exists/);
});

