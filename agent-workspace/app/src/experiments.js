import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertLocalPath } from './paths.js';
import { InputError, text } from './workspace.js';
import { OllamaError } from './ollama.js';

const states = ['running', 'completed', 'failed', 'interrupted'];
const requestID = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new InputError('올바른 요청 ID가 필요합니다.');
  return value;
};
export function experimentInput(input) {
  if (input.confirm !== true) throw new InputError('로컬 모델 실험 실행을 확인해 주세요.');
  const model = text(input.model, '모델', 200);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) throw new InputError('올바른 모델 이름이 필요합니다.');
  const system = input.system ?? '';
  if (typeof system !== 'string' || system.length > 20000) throw new InputError('시스템 지침은 20,000자 이내로 입력하세요.');
  const supplied = input.options ?? {};
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new InputError('올바른 생성 설정이 필요합니다.');
  const bounds = { temperature: [0, 2, false, 0.2], top_p: [0.01, 1, false, 0.9],
    seed: [0, 2147483647, true, 42], num_ctx: [512, 16384, true, 4096], num_predict: [1, 4096, true, 512] };
  if (Object.keys(supplied).some(key => !Object.hasOwn(bounds, key))) throw new InputError('지원하지 않는 생성 설정입니다.');
  const options = {};
  for (const [key, [min, max, integer, fallback]] of Object.entries(bounds)) {
    const value = supplied[key] ?? fallback;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new InputError(`${key}: ${min}~${max} 범위가 필요합니다.`);
    options[key] = value;
  }
  return { model, prompt: text(input.prompt, '실험 프롬프트'), system, options };
}

export class ExperimentStore {
  constructor(directory) {
    const local = assertLocalPath(directory, '실험 기록');
    mkdirSync(local, { recursive: true, mode: 0o700 });
    this.file = join(local, 'experiments.json');
    try {
      if (!lstatSync(this.file).isFile()) throw new Error('Experiment data must be a regular file.');
      this.data = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = { version: 1, runs: [] };
    }
    const ids = new Set();
    if (this.data.version !== 1 || !Array.isArray(this.data.runs) || this.data.runs.some(run => {
      if (!run || typeof run.id !== 'string' || ids.has(run.id) || !states.includes(run.status)
          || typeof run.input?.model !== 'string' || typeof run.input?.prompt !== 'string' || !Array.isArray(run.evaluations)) return true;
      ids.add(run.id); return false;
    })) throw new Error('Unsupported or damaged experiment data. Restore a backup before starting.');
  }
  replace(data) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try {
      try { writeFileSync(fd, JSON.stringify(data, null, 2)); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temp, this.file);
      this.data = data;
    } finally { try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}

export class Experiments {
  constructor(store, ollama) {
    this.store = store; this.ollama = ollama; this.active = null; this.closed = false; this.storageError = false;
    if (store.data.runs.some(run => run.status === 'running')) {
      const recovered = structuredClone(store.data);
      for (const run of recovered.runs.filter(run => run.status === 'running')) {
        Object.assign(run, { status: 'interrupted', finishedAt: Date.now(),
          error: { code: 'restart', message: '서버 재시작으로 결과를 확인하지 못했습니다. 자동 재실행하지 않았습니다.' } });
      }
      store.replace(recovered);
    }
  }
  list() {
    return this.store.data.runs.slice().reverse().map(run => ({ id: run.id, model: run.input.model,
      prompt: run.input.prompt.slice(0, 160), status: run.status, createdAt: run.createdAt,
      finishedAt: run.finishedAt, evaluation: run.evaluations.at(-1) || null }));
  }
  get(id) {
    const run = this.store.data.runs.find(run => run.id === id);
    if (!run) throw new InputError('실험을 찾을 수 없습니다.', 404);
    return structuredClone(run);
  }
  update(id, operation) {
    const next = structuredClone(this.store.data);
    const run = next.runs.find(run => run.id === id);
    if (!run) throw new InputError('실험을 찾을 수 없습니다.', 404);
    operation(run); this.store.replace(next); return structuredClone(run);
  }
  start(input) {
    const id = requestID(input.requestID), settings = experimentInput(input);
    const existing = this.store.data.runs.find(run => run.id === id);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(settings)) throw new InputError('같은 요청 ID로 다른 실험을 실행할 수 없습니다.', 409);
      return structuredClone(existing);
    }
    if (this.closed || this.storageError) throw new InputError('실험 서버 저장 상태를 확인하세요. 새 실험을 시작하지 않았습니다.', 503);
    if (this.active) throw new InputError('다른 실험이 실행 중입니다. 완료 후 다시 실행하세요.', 409);
    const run = { id, input: settings, status: 'running', createdAt: Date.now(), evaluations: [],
      execution: { provider: 'ollama', endpoint: this.ollama.origin, timeoutMs: this.ollama.timeoutMs, stream: false, keepAlive: 0, tools: false } };
    // Save intent before any model call. A disconnected client is not a cancellation.
    this.store.replace({ ...this.store.data, runs: [...this.store.data.runs, run] });
    const controller = new AbortController();
    this.active = { id, controller };
    this.active.promise = Promise.resolve().then(() => this.execute(id, controller.signal))
      .catch(() => { this.storageError = true; console.error('Experiment result could not be persisted; new experiments are blocked.'); })
      .finally(() => { this.active = null; });
    return structuredClone(run);
  }
  async execute(id, signal) {
    try {
      const input = this.get(id).input;
      const catalog = await this.ollama.catalog(signal);
      const model = catalog.models.find(model => model.name === input.model);
      if (!model || model.remote || !model.digest) throw new OllamaError('model_unavailable', '설치된 로컬 모델이 아닙니다. 모델 목록을 새로 확인하세요.');
      const description = await this.ollama.describe(input.model, signal);
      this.update(id, run => { run.modelSnapshot = { ...model, ...description, ollamaVersion: catalog.version }; });
      const response = await this.ollama.chat(input, signal);
      this.update(id, run => { Object.assign(run, { status: 'completed', response, finishedAt: Date.now() }); });
    } catch (error) {
      this.update(id, run => { Object.assign(run, { status: signal.aborted ? 'interrupted' : 'failed', finishedAt: Date.now(),
        error: error instanceof OllamaError ? { code: error.code, message: error.message, httpStatus: error.status }
          : { code: 'internal_error', message: '실험 처리 또는 기록 저장에 실패했습니다. 서버 저장 상태를 확인하세요.' } }); });
    }
  }
  evaluate(id, input) {
    const evaluationID = requestID(input.requestID);
    if (!['pass', 'partial', 'fail'].includes(input.verdict) || typeof input.notes !== 'string' || input.notes.length > 10000) throw new InputError('평가 결과와 10,000자 이내의 메모가 필요합니다.');
    return this.update(id, run => {
      if (run.status === 'running') throw new InputError('실험 종료 후 평가하세요.', 409);
      const existing = run.evaluations.find(e => e.id === evaluationID);
      if (existing) {
        if (existing.verdict !== input.verdict || existing.notes !== input.notes) throw new InputError('이미 저장한 평가 요청입니다.', 409);
        return;
      }
      run.evaluations.push({ id: evaluationID, verdict: input.verdict, notes: input.notes, createdAt: Date.now() });
    });
  }
  cancel(id) {
    this.get(id);
    if (this.active?.id === id) this.active.controller.abort();
    return this.get(id);
  }
  async close() { this.closed = true; this.active?.controller.abort(); await this.active?.promise; }
}
