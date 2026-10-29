import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBinary, probe, summarizeTailscale } from '../scripts/doctor.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'personal-ai-doctor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Tailscale diagnostics expose only operation metadata and flag public Funnel', () => {
  const info = summarizeTailscale({ BackendState: 'Running', Self: { Online: true, DNSName: 'mini.tail123.ts.net.' }, User: { Secret: 'do-not-print' }, AuthURL: 'https://secret' }, {
    TCP: { 443: { HTTPS: true } },
    Web: { 'mini.tail123.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4310' } } } },
    AllowFunnel: { 'mini.tail123.ts.net:443': true },
  });
  assert.equal(info.origin, 'https://mini.tail123.ts.net');
  assert.equal(info.workspaceProxy, true); assert.equal(info.funnelEnabled, true);
  assert.doesNotMatch(JSON.stringify(info), /do-not-print|https:\/\/secret/);
  assert.equal(summarizeTailscale({ Self: { DNSName: 'bad\nname.ts.net' } }, {}).origin, null);
  assert.equal(summarizeTailscale({}, {}).workspaceProxy, false);
});

test('probes hide tool errors and binary overrides resolve without a shell', t => {
  const root = fixture(t), binary = join(root, 'custom-tailscale');
  writeFileSync(binary, '#!/bin/sh\nprintf "sensitive credential" >&2\nexit 1\n', { mode: 0o700 });
  assert.equal(findBinary('tailscale', { TAILSCALE_BIN: 'custom-tailscale', PATH: root }), binary);
  assert.deepEqual(probe(binary, []), { ok: false, reason: 'unavailable or not running' });
  assert.equal(findBinary('tailscale', { TAILSCALE_BIN: 'missing;echo dangerous', PATH: root }), null);
});
