import { InputError } from './workspace.js';

const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function normalizePublicOrigin(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('WORKSPACE_PUBLIC_ORIGIN must be an HTTPS ts.net origin.');
  const input = value.trim();
  let url;
  try { url = new URL(input); } catch { throw new Error('WORKSPACE_PUBLIC_ORIGIN must be an HTTPS ts.net origin.'); }
  if (!/^https:\/\/[^/?#\\]+\/?$/i.test(input) || url.protocol !== 'https:' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net$/.test(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || input.includes('?') || input.includes('#') || input.includes('\\')) {
    throw new Error('WORKSPACE_PUBLIC_ORIGIN must be an HTTPS ts.net origin without credentials, path, query or fragment.');
  }
  return url.origin;
}

// Tailscale Serve preserves Host for TCP HTTP backends. Forwarded headers never
// expand the allowed host list; the app must still listen only on loopback.
export function requestContext(request, publicOrigin) {
  if (!loopbackAddresses.has(request.socket.remoteAddress)) throw new InputError('로컬 프록시 연결만 허용합니다.', 403);
  const host = request.headers.host;
  const port = request.socket.localPort;
  const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const remote = publicOrigin && host === new URL(publicOrigin).host;
  let origin;
  if (remote) {
    if (request.headers['x-forwarded-proto'] !== 'https' ||
        (request.headers['x-forwarded-host'] && request.headers['x-forwarded-host'] !== host) ||
        request.headers['tailscale-funnel-request']) {
      throw new InputError('Tailscale HTTPS 연결이 필요합니다.', 403);
    }
    origin = publicOrigin;
  } else {
    if (!localHosts.includes(host) || request.headers['x-forwarded-proto'] || request.headers['x-forwarded-host']) {
      throw new InputError('허용되지 않은 호스트입니다.', 403);
    }
    origin = `http://${host}`;
  }
  const requestOrigin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  if ((requestOrigin !== undefined && requestOrigin !== origin) || fetchSite === 'cross-site' || fetchSite === 'same-site' ||
      (mutatingMethods.has(request.method) && requestOrigin !== origin)) {
    throw new InputError('같은 출처의 요청만 허용합니다.', 403);
  }
  if (!request.url.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) {
    throw new InputError('올바른 요청 경로가 필요합니다.', 400);
  }
  return { origin, secure: Boolean(remote), cookieName: remote ? '__Host-workspace' : 'workspace' };
}

export function sessionCookie(context, token, maxAge = 43200) {
  return `${context.cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${context.secure ? '; Secure' : ''}`;
}

export function sessionToken(request, context) {
  const cookies = (request.headers.cookie || '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${context.cookieName}=`));
  if (cookies.length !== 1) return null;
  const token = cookies[0].slice(context.cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
