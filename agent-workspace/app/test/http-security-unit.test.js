import test from 'node:test';
import assert from 'node:assert/strict';
import { requestContext } from '../src/http-security.js';

const publicOrigin = 'https://mini.example-tailnet.ts.net';
const localOrigin = 'http://127.0.0.1:4310';
function request(headers = {}, method = 'GET') {
  return { method, url: '/', socket: { remoteAddress: '127.0.0.1', localPort: 4310 },
    headers: { host: '127.0.0.1:4310', ...headers } };
}
const denied = callback => assert.throws(callback, error => error.status === 403);

// These tests need no listening socket. They do not replace real HTTP tests or
// prove which headers a particular browser/extension actually sent.
test('direct navigation and same-origin requests pass the origin policy', () => {
  for (const site of [undefined, 'none', 'same-origin']) {
    assert.equal(requestContext(request({ 'sec-fetch-site': site }), publicOrigin).origin, localOrigin);
  }
  assert.equal(requestContext(request({ origin: localOrigin, 'sec-fetch-site': 'same-origin' }, 'POST'), publicOrigin).origin, localOrigin);
});

test('cross-site navigation and extension origins remain denied even on GET', () => {
  for (const site of ['cross-site', 'same-site']) {
    denied(() => requestContext(request({ 'sec-fetch-site': site }), publicOrigin));
    denied(() => requestContext(request({ origin: localOrigin, 'sec-fetch-site': site }), publicOrigin));
  }
  for (const origin of ['null', 'chrome-extension://test', 'http://localhost:4310', 'https://untrusted.invalid']) {
    denied(() => requestContext(request({ origin }), publicOrigin));
  }
});

test('every mutating method requires an exact origin regardless of fetch metadata', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const origin of [undefined, 'null', publicOrigin]) {
      denied(() => requestContext(request({ origin, 'sec-fetch-site': 'same-origin' }, method), publicOrigin));
    }
    assert.equal(requestContext(request({ origin: localOrigin }, method), publicOrigin).origin, localOrigin);
  }
});

test('HTTPS proxy trust and Funnel rejection also hold without an HTTP listener', () => {
  const host = new URL(publicOrigin).host;
  const headers = { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', origin: publicOrigin };
  assert.deepEqual(requestContext(request(headers, 'POST'), publicOrigin),
    { origin: publicOrigin, secure: true, cookieName: '__Host-workspace' });
  for (const patch of [{ host: 'attacker.invalid' }, { 'x-forwarded-host': 'attacker.invalid' },
    { 'x-forwarded-proto': 'http' }, { 'tailscale-funnel-request': '?1' }, { origin: localOrigin }]) {
    denied(() => requestContext(request({ ...headers, ...patch }, 'POST'), publicOrigin));
  }
  denied(() => requestContext(request(headers), null));
});
