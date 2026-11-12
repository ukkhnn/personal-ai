import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertLocalPath } from '../paths.js';
import { InputError, isRecord } from './input.ts';
import { OllamaError } from './ollama.ts';
import { experimentData, experimentInput, requestID } from './experiment-schema.ts';
import type { ExperimentData, ExperimentRun, FailedRun, RunningRun, TextExperimentRuntime } from './experiment-types.ts';
export { experimentInput } from './experiment-schema.ts';
export type { ExperimentData, ExperimentRun } from './experiment-types.ts';

export class ExperimentStore {
  file: string;
  data: ExperimentData;
  constructor(directory: string) {
    const local = assertLocalPath(directory, '실험 기록');
    mkdirSync(local, { recursive: true, mode: 0o700 });
    this.file = join(local, 'experiments.json');
    let data: unknown;
    try {
      if (!lstatSync(this.file).isFile()) throw new Error('Experiment data must be a regular file.');
      data = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error;
      data = { version: 1, runs: [] };
    }
    this.data = experimentData(data);
  }
  replace(data: ExperimentData): void {
    const checked = experimentData(data), temp = `${this.file}.${randomUUID()}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try {
      try { writeFileSync(fd, JSON.stringify(checked, null, 2)); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temp, this.file);
      this.data = checked;
    } catch (error) {
      // Preserve the write/rename failure if temporary-file cleanup also fails.
      try { unlinkSync(temp); } catch {}
      throw error;
    }
  }
}

export class Experiments {
  store: ExperimentStore;
  ollama: TextExperimentRuntime;
  active: { id: string; controller: AbortController; promise?: Promise<void> } | null = null;
  closed = false;
  storageError = false;
  constructor(store: ExperimentStore, ollama: TextExperimentRuntime) {
    if (ollama.kind !== 'local-text') throw new Error('Experiments require a local text-only runtime.');
    this.store = store; this.ollama = ollama;
    if (store.data.runs.some(run => run.status === 'running')) {
      store.replace({ ...store.data, runs: store.data.runs.map((run): ExperimentRun => run.status === 'running' ? {
        ...run, status: 'interrupted', finishedAt: Date.now(),
        error: { code: 'restart', message: '서버 재시작으로 결과를 확인하지 못했습니다. 자동 재실행하지 않았습니다.' },
      } : run) });
    }
  }
  list() {
    return this.store.data.runs.slice().reverse().map(run => ({ id: run.id, model: run.input.model,
      prompt: run.input.prompt.slice(0, 160), status: run.status, createdAt: run.createdAt,
      finishedAt: run.finishedAt, evaluation: run.evaluations.at(-1) || null }));
  }
  get(id: string): ExperimentRun {
    const run = this.store.data.runs.find(run => run.id === id);
    if (!run) throw new InputError('실험을 찾을 수 없습니다.', 404);
    return structuredClone(run);
  }
  private update(id: string, operation: (run: ExperimentRun) => ExperimentRun): ExperimentRun {
    const next = structuredClone(this.store.data), index = next.runs.findIndex(run => run.id === id);
    const previous = next.runs[index];
    if (!previous) throw new InputError('실험을 찾을 수 없습니다.', 404);
    const run = operation(previous);
    next.runs[index] = run; this.store.replace(next); return structuredClone(run);
  }
  start(input: unknown): ExperimentRun {
    if (!isRecord(input)) throw new InputError('올바른 실험 요청이 필요합니다.');
    const id = requestID(input.requestID), settings = experimentInput(input);
    const existing = this.store.data.runs.find(run => run.id === id);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(settings)) throw new InputError('같은 요청 ID로 다른 실험을 실행할 수 없습니다.', 409);
      return structuredClone(existing);
    }
    if (this.closed || this.storageError) throw new InputError('실험 서버 저장 상태를 확인하세요. 새 실험을 시작하지 않았습니다.', 503);
    if (this.active) throw new InputError('다른 실험이 실행 중입니다. 완료 후 다시 실행하세요.', 409);
    const run: RunningRun = { id, input: settings, status: 'running', createdAt: Date.now(), evaluations: [],
      execution: { provider: 'ollama', endpoint: this.ollama.origin, timeoutMs: this.ollama.timeoutMs, stream: false, keepAlive: 0, tools: false } };
    this.store.replace({ ...this.store.data, runs: [...this.store.data.runs, run] });
    const controller = new AbortController();
    this.active = { id, controller };
    this.active.promise = Promise.resolve().then(() => this.execute(id, controller.signal))
      .catch(() => { this.storageError = true; console.error('Experiment result could not be persisted; new experiments are blocked.'); })
      .finally(() => { this.active = null; });
    return structuredClone(run);
  }
  private running(run: ExperimentRun): RunningRun {
    if (run.status !== 'running') throw new Error('Experiment is no longer running.');
    return run;
  }
  private async execute(id: string, signal: AbortSignal): Promise<void> {
    try {
      const input = this.get(id).input;
      const catalog = await this.ollama.catalog(signal);
      const model = catalog.models.find(model => model.name === input.model);
      if (!model || model.remote || !model.digest) throw new OllamaError('model_unavailable', '설치된 로컬 모델이 아닙니다. 모델 목록을 새로 확인하세요.');
      const description = await this.ollama.describe(input.model, signal);
      const modelSnapshot = { ...model, digest: model.digest, remote: false as const, ...description, ollamaVersion: catalog.version };
      this.update(id, run => ({ ...this.running(run), modelSnapshot }));
      const response = await this.ollama.chat(input, signal);
      this.update(id, run => ({ ...this.running(run), status: 'completed', modelSnapshot, response, finishedAt: Date.now() }));
    } catch (error) {
      const failure: FailedRun['error'] = error instanceof OllamaError
        ? { code: error.code, message: error.message, ...(error.status === undefined ? {} : { httpStatus: error.status }) }
        : { code: 'internal_error', message: '실험 처리 또는 기록 저장에 실패했습니다. 서버 저장 상태를 확인하세요.' };
      this.update(id, run => ({ ...this.running(run), status: signal.aborted ? 'interrupted' : 'failed', finishedAt: Date.now(), error: failure }));
    }
  }
  evaluate(id: string, input: unknown): ExperimentRun {
    if (!isRecord(input)) throw new InputError('올바른 평가 요청이 필요합니다.');
    const evaluationID = requestID(input.requestID), { verdict, notes } = input;
    if ((verdict !== 'pass' && verdict !== 'partial' && verdict !== 'fail') || typeof notes !== 'string' || notes.length > 10000) throw new InputError('평가 결과와 10,000자 이내의 메모가 필요합니다.');
    return this.update(id, run => {
      if (run.status === 'running') throw new InputError('실험 종료 후 평가하세요.', 409);
      const existing = run.evaluations.find(e => e.id === evaluationID);
      if (existing) {
        if (existing.verdict !== verdict || existing.notes !== notes) throw new InputError('이미 저장한 평가 요청입니다.', 409);
        return run;
      }
      return { ...run, evaluations: [...run.evaluations, { id: evaluationID, verdict, notes, createdAt: Date.now() }] };
    });
  }
  cancel(id: string): ExperimentRun {
    this.get(id);
    if (this.active?.id === id) this.active.controller.abort();
    return this.get(id);
  }
  async close(): Promise<void> { this.closed = true; this.active?.controller.abort(); await this.active?.promise; }
}
