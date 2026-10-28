import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { InputError } from './workspace.js';

const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const hash = value => createHash('sha256').update(value).digest();
async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new InputError('JSON 요청이 필요합니다.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 100000) throw new InputError('요청이 너무 큽니다.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new InputError('올바른 JSON 객체가 필요합니다.'); }
}

export function createApp(workspace, runtime, password) {
  const sessions = new Map(); let attempts = [];
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
    };
    try {
      const port = req.socket.localPort;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) throw new InputError('허용되지 않은 호스트입니다.', 403);
      const origin = `http://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw new InputError('다른 사이트의 요청은 허용하지 않습니다.', 403);
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && assets[path]) {
        const [file, type] = assets[path];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(await readFile(new URL(`../public/${file}`, import.meta.url)));
      }
      if (req.method === 'POST' && path === '/api/login') {
        attempts = attempts.filter(t => t > Date.now() - 60000);
        if (attempts.length >= 10) throw new InputError('잠시 후 다시 로그인하세요.', 429);
        attempts.push(Date.now());
        const input = await body(req);
        if (typeof input.password !== 'string' || !timingSafeEqual(hash(input.password), hash(password))) throw new InputError('접속 암호가 일치하지 않습니다.', 401);
        const token = randomBytes(32).toString('base64url');
        for (const [key, expiry] of sessions) if (expiry < Date.now()) sessions.delete(key);
        sessions.set(token, Date.now() + 12 * 3600000);
        res.setHeader('Set-Cookie', `workspace=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
        return json({ ok: true });
      }
      const token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('workspace='))?.slice(10);
      if (!token || !(sessions.get(token) > Date.now())) throw new InputError('로그인이 필요합니다.', 401);
      if (req.method === 'POST' && path === '/api/logout') {
        sessions.delete(token); res.setHeader('Set-Cookie', 'workspace=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json({ ok: true });
      }
      if (req.method === 'GET' && path === '/api/state') {
        const { projects, templates, tasks } = workspace.data;
        return json({ projects, templates, tasks: tasks.map(({ messages, ...task }) => ({ ...task, messageCount: messages.length })) });
      }
      if (req.method === 'GET' && path === '/api/runtime') {
        return json({ health: await runtime.health(), providers: await runtime.catalog() });
      }
      if (req.method === 'POST' && path === '/api/projects') return json(await workspace.addProject(await body(req)), 201);
      if (req.method === 'POST' && path === '/api/templates') return json(await workspace.addTemplate(await body(req)), 201);
      if (req.method === 'POST' && path === '/api/tasks') return json(await workspace.createTask(await body(req)), 201);
      const route = path.match(/^\/api\/tasks\/([a-zA-Z0-9-]+)(?:\/(messages|stop|resume|permissions|questions|changes))?$/);
      if (route) {
        const [, id, action] = route;
        if (req.method === 'GET' && !action) return json(workspace.task(id));
        if (req.method === 'GET' && action === 'changes') return json(await workspace.changes(id));
        if (req.method === 'POST') {
          const input = await body(req);
          if (action === 'messages') return json(await workspace.enqueue(id, input), 202);
          if (action === 'stop') return json(await workspace.stop(id));
          if (action === 'resume') return json(await workspace.resume(id));
          if (action === 'permissions') return json(await workspace.approve(id, input.id, input.reply));
          if (action === 'questions') return json(await workspace.answer(id, input.id, input.answers));
        }
      }
      throw new InputError('요청한 경로가 없습니다.', 404);
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error instanceof InputError ? error.status : 502;
      json({ error: error instanceof InputError ? error.message : '요청을 완료하지 못했습니다. 실행 상태와 로컬 서버 로그를 확인하세요.' }, status);
      if (!(error instanceof InputError)) console.error(error.message);
    }
  });
}
