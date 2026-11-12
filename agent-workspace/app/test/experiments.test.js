import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ollama } from '../src/ollama.js';
import { ExperimentStore, Experiments } from '../src/experiments.js';
import { createApp } from '../src/server.js';
import { handlerFetch } from './helpers/handler-client.js';
import { PendingExperiment } from '../public/experiments.js';
import { verificationArguments } from '../scripts/verify-ollama.js';

const input = (id = 'experiment-one') => ({ requestID: id, confirm: true, model: 'qwen2.5:3b', prompt: 'Return M3 OK.', options: { num_predict: 20 } });
const metadata = { version: 'test', models: [{ name: 'qwen2.5:3b', digest: 'test-digest', details: { format: 'gguf' } }] };
function fixture(t, fetcher) {
  const directory = mkdtempSync(join(tmpdir(), 'm3-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const defaultFetch = async (url, options) => {
    calls.push({ path: new URL(url).pathname, options });
    const path = new URL(url).pathname;
    if (path === '/api/version') return Response.json({ version: 'test' });
    if (path === '/api/tags') return Response.json({ models: metadata.models });
    if (path === '/api/show') return Response.json({ capabilities: ['completion'], details: { format: 'gguf' }, parameters: 'temperature 0.8' });
    return Response.json({ model: 'qwen2.5:3b', message: { role: 'assistant', content: 'M3 OK.' }, done: true, done_reason: 'stop', eval_count: 4, eval_duration: 100000000 });
  };
  const ollama = new Ollama(undefined, { fetcher: fetcher ? (url, options) => fetcher(url, options, defaultFetch) : defaultFetch });
  const store = new ExperimentStore(directory), experiments = new Experiments(store, ollama);
  t.after(() => experiments.close());
  return { directory, store, experiments, ollama, calls };
}
const finish = experiments => experiments.active?.promise;

test('M3 saves intent before inference and deduplicates response loss across restart', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(t, async (url, options, next) => { if (url.endsWith('/api/chat')) await gate; return next(url, options); });
  const run = f.experiments.start(input());
  assert.equal(JSON.parse(readFileSync(f.store.file)).runs[0].status, 'running');
  assert.equal(f.experiments.start(input()).id, run.id);
  assert.throws(() => f.experiments.start({ ...input(), prompt: 'different' }), { status: 409 });
  assert.throws(() => f.experiments.start(input('other')), { status: 409 });
  release(); await finish(f.experiments);
  const saved = f.experiments.get(run.id);
  assert.equal(saved.status, 'completed'); assert.equal(saved.modelSnapshot.digest, 'test-digest');
  assert.equal(saved.response.text, 'M3 OK.'); assert.equal(saved.response.metrics.eval_count, 4);
  const chat = f.calls.filter(call => call.path === '/api/chat'); assert.equal(chat.length, 1);
  const body = JSON.parse(chat[0].options.body);
  assert.equal(body.stream, false); assert.equal(body.keep_alive, 0); assert.equal(body.tools, undefined);
  assert.equal(body.options.seed, 42); assert.equal(body.options.num_predict, 20);
  assert.equal(chat[0].options.headers.authorization, undefined); assert.equal(chat[0].options.redirect, 'error');
  assert.equal(statSync(f.store.file).mode & 0o777, 0o600);
  const restored = new Experiments(new ExperimentStore(f.directory), f.ollama);
  assert.equal(restored.start(input()).status, 'completed'); assert.equal(restored.active, null);
});

test('M3 records unavailable models and refuses remote aliases without inference', async t => {
  const f = fixture(t, (url, options, next) => url.endsWith('/api/show')
    ? Response.json({ remote_model: 'secret-cloud-alias', details: { format: 'gguf' }, capabilities: ['completion'] }) : next(url, options));
  f.experiments.start(input()); await finish(f.experiments);
  assert.equal(f.experiments.get('experiment-one').error.code, 'unsupported_model');
  f.experiments.start({ ...input('missing'), model: 'missing:latest' }); await finish(f.experiments);
  assert.equal(f.experiments.get('missing').error.code, 'model_unavailable');
  assert.equal(f.calls.filter(call => call.path === '/api/chat').length, 0);
});

test('M3 timeout is persisted and duplicate retry never calls the model again', async t => {
  let attempts = 0;
  const f = fixture(t, (url, options, next) => {
    if (!url.endsWith('/api/chat')) return next(url, options);
    attempts++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  f.ollama.timeoutMs = 15;
  // Keep the event loop alive: AbortSignal.timeout uses an unref'ed timer.
  const timer = setTimeout(() => {}, 1000); t.after(() => clearTimeout(timer));
  f.experiments.start(input()); await finish(f.experiments);
  assert.equal(f.experiments.get('experiment-one').error.code, 'timeout');
  assert.equal(f.experiments.start(input()).status, 'failed'); assert.equal(attempts, 1);
});

test('M3 hides provider error bodies and rejects unfinished/tool responses', async t => {
  const f = fixture(t, (url, options, next) => url.endsWith('/api/chat') ? new Response('private prompt and token', { status: 500 }) : next(url, options));
  f.experiments.start(input()); await finish(f.experiments);
  const run = f.experiments.get('experiment-one'); assert.equal(run.error.httpStatus, 500);
  assert.doesNotMatch(JSON.stringify(run), /private prompt and token/);
  f.ollama.fetcher = async () => Response.json({ done: false, message: { role: 'assistant', content: 'partial' } });
  await assert.rejects(f.ollama.chat(input()), { code: 'invalid_response' });
  f.ollama.fetcher = async () => Response.json({ done: true, message: { role: 'assistant', content: '', tool_calls: [{}] } });
  await assert.rejects(f.ollama.chat(input()), { code: 'invalid_response' });
});

test('M3 requires opt-in, bounded settings and literal loopback before accessing services', t => {
  const f = fixture(t);
  for (const origin of ['https://ollama.com', 'http://localhost:11434', 'http://127.0.0.1:11434/path', 'http://user:secret@127.0.0.1', 'http://127.0.0.1/#x']) assert.throws(() => new Ollama(origin), /loopback/);
  for (const bad of [{ confirm: false }, { model: '' }, { options: { num_predict: -1 } }, { options: { num_ctx: 999999 } }, { options: { seed: 1.2 } }, { options: { arbitrary: 1 } }]) assert.throws(() => f.experiments.start({ ...input(), ...bad }), { status: 400 });
  assert.equal(f.calls.length, 0); assert.equal(f.store.data.runs.length, 0);
});

test('M3 restart preserves running intent as interrupted and never auto-replays', t => {
  const f = fixture(t);
  f.store.replace({ version: 1, runs: [{ id: 'old', status: 'running', input: { model: 'local', prompt: 'old' }, evaluations: [] }] });
  const restored = new Experiments(new ExperimentStore(f.directory), f.ollama);
  assert.equal(restored.get('old').status, 'interrupted'); assert.equal(restored.get('old').error.code, 'restart');
  assert.equal(f.calls.length, 0);
});

test('M3 cancellation and shutdown persist interruption without claiming server calculation stopped', async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, (url, options, next) => {
    if (!url.endsWith('/api/chat')) return next(url, options);
    entered(); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  f.experiments.start(input()); await started;
  f.experiments.cancel('experiment-one'); await finish(f.experiments);
  assert.equal(f.experiments.get('experiment-one').status, 'interrupted');
  assert.match(f.experiments.get('experiment-one').error.message, /종료 여부는 확인되지/);
  await f.experiments.close(); assert.throws(() => f.experiments.start(input('new')), { status: 503 });
});

test('M3 evaluations append, deduplicate and survive restoring the store', async t => {
  const f = fixture(t); f.experiments.start(input());
  assert.throws(() => f.experiments.evaluate('experiment-one', { requestID: 'review', verdict: 'pass', notes: '' }), { status: 409 });
  await finish(f.experiments);
  const evaluation = { requestID: 'review', verdict: 'pass', notes: 'Expected literal matches.' };
  f.experiments.evaluate('experiment-one', evaluation); f.experiments.evaluate('experiment-one', evaluation);
  assert.throws(() => f.experiments.evaluate('experiment-one', { ...evaluation, verdict: 'fail' }), { status: 409 });
  f.experiments.evaluate('experiment-one', { ...evaluation, requestID: 'review-2', verdict: 'partial' });
  const restored = new Experiments(new ExperimentStore(f.directory), f.ollama);
  assert.equal(restored.get('experiment-one').evaluations.length, 2);
  assert.equal(restored.list()[0].evaluation.verdict, 'partial');
});

test('M3 fails closed on damaged storage and never sends before durable intent', t => {
  const f = fixture(t); f.store.replace = () => { throw new Error('disk full'); };
  assert.throws(() => f.experiments.start(input()), /disk full/); assert.equal(f.calls.length, 0);
  writeFileSync(f.store.file, '{broken'); assert.throws(() => new ExperimentStore(f.directory));
  assert.equal(readFileSync(f.store.file, 'utf8'), '{broken');
  rmSync(f.store.file); const other = join(f.directory, 'other'); writeFileSync(other, '{"version":1,"runs":[]}'); symlinkSync(other, f.store.file);
  assert.throws(() => new ExperimentStore(f.directory), /regular file/);
});

test('M3 authenticated handler shares experiment records across independent clients and denies cross-origin writes', async t => {
  const f = fixture(t);
  const server = createApp({ data: { projects: [], templates: [], tasks: [] } }, {}, 'm3-test-password-only', { experiments: f.experiments });
  const fetcher = handlerFetch(server), base = 'http://127.0.0.1:4310';
  const request = (path, cookie, data, origin = base) => fetcher(base + path, { headers: { ...(cookie ? { cookie } : {}), origin, 'content-type': 'application/json' }, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) });
  assert.equal((await request('/api/experiments')).status, 401);
  const login = async () => (await request('/api/login', null, { password: 'm3-test-password-only' })).headers.get('set-cookie').split(';')[0];
  const [first, second] = await Promise.all([login(), login()]);
  assert.equal((await request('/api/experiments', first, input(), 'https://elsewhere.invalid')).status, 403);
  const response = await request('/api/experiments', first, input()); assert.equal(response.status, 202);
  assert.equal((await response.json()).status, 'running'); await finish(f.experiments);
  assert.equal((await (await request('/api/experiments/experiment-one', second)).json()).status, 'completed');
  await request('/api/experiments/experiment-one/evaluations', second, { requestID: 'e1', verdict: 'pass', notes: 'second client' });
  assert.equal((await (await request('/api/experiments/experiment-one', first)).json()).evaluations[0].notes, 'second client');
  assert.equal((await request('/api/experiments/pull', first, { model: 'other' })).status, 404);
  assert.equal(f.calls.filter(call => call.path === '/api/chat').length, 1);
});

test('M3 browser reload retains exact pending input and blocks execution when persistence fails', () => {
  const map = new Map(), storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
  const first = new PendingExperiment(storage), original = first.prepare(input(), () => 'retained');
  const restored = new PendingExperiment(storage);
  assert.deepEqual(restored.prepare({ ...input(), prompt: 'new' }, () => 'other'), original);
  restored.acknowledge('wrong'); assert.equal(restored.read().requestID, 'retained');
  restored.acknowledge('retained'); assert.equal(restored.read(), null);
  const blocked = new PendingExperiment({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  assert.throws(() => blocked.prepare(input(), () => 'id'), /quota/);
});

test('M3 live verification requires explicit inference opt-in, model and output before service access', () => {
  assert.throws(() => verificationArguments([]), /allow-inference/);
  assert.throws(() => verificationArguments(['--allow-inference']), /Explicit/);
  assert.throws(() => verificationArguments(['--allow-inference', '--model', 'm', '--output', '--oops']), /Usage/);
  assert.equal(verificationArguments(['--allow-inference', '--model', 'm', '--output', '/tmp/m3']).model, 'm');
});
