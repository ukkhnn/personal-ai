import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createApp } from '../src/server.js';
import { normalizePublicOrigin, requestContext } from '../src/http-security.js';

const publicOrigin = 'https://mini.example-tailnet.ts.net';
const publicHost = new URL(publicOrigin).host;
const password = 'test-password-for-remote-only';

async function fixture(t, options = { publicOrigin }) {
  const workspace = { data: { projects: [{ id: 'shared-project' }], templates: [], tasks: [] } };
  const runtime = { health: async () => ({ healthy: true }), catalog: async () => [] };
  const server = createApp(workspace, runtime, password, options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = (path, { method = 'GET', headers = {}, data } = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end(data);
  });
  const remoteHeaders = { host: publicHost, 'x-forwarded-host': publicHost, 'x-forwarded-proto': 'https' };
  const login = (headers = {}) => call('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...headers }, data: JSON.stringify({ password }),
  });
  return { call, login, remoteHeaders, base, port };
}
const cookieOf = response => response.headers['set-cookie'][0].split(';')[0];

// Emulates the TCP HTTP backend headers in Tailscale's reverseProxy.ServeHTTP
// and addProxyForwardedHeaders (ipn/ipnlocal/serve.go); no proxy headers grant login.
test('Tailscale HTTPS uses a secure host cookie and the same authenticated workspace', async t => {
  const { call, login, remoteHeaders } = await fixture(t);
  assert.equal((await call('/api/system', { headers: remoteHeaders })).status, 401);
  assert.equal((await call('/api/state', { headers: { ...remoteHeaders, 'tailscale-user-login': 'someone@example.com' } })).status, 401);
  const remoteLogin = await login({ ...remoteHeaders, origin: publicOrigin });
  assert.equal(remoteLogin.status, 200);
  assert.match(remoteLogin.headers['set-cookie'][0], /^__Host-workspace=/);
  assert.match(remoteLogin.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure$/);
  assert.doesNotMatch(remoteLogin.headers['set-cookie'][0], /Domain=/);
  assert.equal(remoteLogin.headers['strict-transport-security'], 'max-age=31536000');
  const remoteCookie = cookieOf(remoteLogin);
  const remoteState = await call('/api/state', { headers: { ...remoteHeaders, cookie: remoteCookie } });
  const localLogin = await login();
  assert.equal(localLogin.status, 200);
  assert.doesNotMatch(localLogin.headers['set-cookie'][0], /Secure/);
  assert.equal(localLogin.headers['strict-transport-security'], undefined);
  const localState = await call('/api/state', { headers: { cookie: cookieOf(localLogin) } });
  assert.deepEqual(JSON.parse(remoteState.body), JSON.parse(localState.body));
  const system = await call('/api/system', { headers: { ...remoteHeaders, cookie: remoteCookie } });
  const data = JSON.parse(system.body);
  assert.equal(data.publicOrigin, publicOrigin);
  assert.equal(data.access, 'tailscale');
  assert.equal(data.authentication, 'password');
  assert.ok(data.sessionExpiresAt > Date.now());
});

test('proxy headers cannot broaden the allowlist, downgrade HTTPS, or enable Funnel', async t => {
  const { call, remoteHeaders, port } = await fixture(t);
  const badHeaders = [
    { ...remoteHeaders, host: 'attacker.invalid' },
    { ...remoteHeaders, host: `${publicHost}.attacker.invalid` },
    { ...remoteHeaders, 'x-forwarded-host': 'attacker.invalid' },
    { ...remoteHeaders, 'x-forwarded-proto': 'http' },
    { ...remoteHeaders, 'x-forwarded-proto': 'https,http' },
    { host: publicHost },
    { host: `127.0.0.1:${port}`, 'x-forwarded-host': publicHost, 'x-forwarded-proto': 'https' },
    { ...remoteHeaders, 'tailscale-funnel-request': '?1' },
    { host: 'attacker.invalid', forwarded: `host=${publicHost};proto=https` },
  ];
  for (const headers of badHeaders) assert.equal((await call('/', { headers })).status, 403);
  assert.equal((await call('/', { headers: remoteHeaders })).status, 200);
  const localOnly = await fixture(t, {});
  assert.equal((await localOnly.call('/', { headers: remoteHeaders })).status, 403);
  assert.equal((await call('https://attacker.invalid/api/state', { headers: remoteHeaders })).status, 400);
});

test('mutations require an exact Origin including login and logout', async t => {
  const { call, login, remoteHeaders, base } = await fixture(t);
  for (const origin of [undefined, 'null', 'http://' + publicHost, 'https://other.example-tailnet.ts.net', base]) {
    const headers = { ...remoteHeaders, 'content-type': 'application/json' };
    if (origin !== undefined) headers.origin = origin;
    const result = await call('/api/login', { method: 'POST', headers, data: JSON.stringify({ password }) });
    assert.equal(result.status, 403);
  }
  const result = await login({ ...remoteHeaders, origin: publicOrigin });
  const cookie = cookieOf(result);
  assert.equal((await call('/api/logout', { method: 'POST', headers: { ...remoteHeaders, cookie } })).status, 403);
  for (const fetchSite of ['cross-site', 'same-site']) {
    assert.equal((await call('/api/state', { headers: { ...remoteHeaders, cookie, 'sec-fetch-site': fetchSite } })).status, 403);
  }
  assert.equal((await call('/api/state', { headers: { ...remoteHeaders, cookie, origin: 'https://attacker.invalid' } })).status, 403);
  const logout = await call('/api/logout', { method: 'POST', headers: { ...remoteHeaders, cookie, origin: publicOrigin } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'][0], /^__Host-workspace=;.*Max-Age=0; Secure$/);
  assert.equal((await call('/api/state', { headers: { ...remoteHeaders, cookie } })).status, 401);
});

test('sessions cannot cross local hosts or be replayed across local and HTTPS origins', async t => {
  const { call, login, remoteHeaders, port } = await fixture(t);
  const localCookie = cookieOf(await login());
  const remoteCookie = cookieOf(await login({ ...remoteHeaders, origin: publicOrigin }));
  const attempts = [
    { host: `localhost:${port}`, cookie: localCookie },
    { cookie: remoteCookie },
    { cookie: remoteCookie.replace('__Host-workspace=', 'workspace=') },
    { ...remoteHeaders, cookie: localCookie },
    { ...remoteHeaders, cookie: localCookie.replace('workspace=', '__Host-workspace=') },
    { ...remoteHeaders, cookie: `${remoteCookie}; ${remoteCookie}` },
  ];
  for (const headers of attempts) assert.equal((await call('/api/state', { headers })).status, 401);
  const replacement = await login({ ...remoteHeaders, origin: publicOrigin, cookie: remoteCookie });
  assert.equal(replacement.status, 200);
  assert.equal((await call('/api/state', { headers: { ...remoteHeaders, cookie: remoteCookie } })).status, 401);
  assert.equal((await call('/api/state', { headers: { ...remoteHeaders, cookie: cookieOf(replacement) } })).status, 200);
  assert.equal((await call('/api/state', { headers: { cookie: localCookie } })).status, 200);
});

test('remote configuration rejects insecure, ambiguous and non-tailnet origins', () => {
  assert.equal(normalizePublicOrigin(undefined), null);
  assert.equal(normalizePublicOrigin(publicOrigin + '/'), publicOrigin);
  assert.equal(normalizePublicOrigin(publicOrigin + ':8443'), publicOrigin + ':8443');
  for (const input of [
    'http://' + publicHost, 'https://example.com', 'https://ts.net',
    publicOrigin + '.attacker.invalid', 'https://user:pass@' + publicHost,
    publicOrigin + '/path', publicOrigin + '/path/..', publicOrigin + '?', publicOrigin + '#fragment',
    publicOrigin + '/\\path', '*', {},
  ]) assert.throws(() => normalizePublicOrigin(input), /WORKSPACE_PUBLIC_ORIGIN/);
  assert.throws(() => requestContext({ socket: { remoteAddress: '100.64.0.1' } }, publicOrigin), /로컬 프록시/);
});
