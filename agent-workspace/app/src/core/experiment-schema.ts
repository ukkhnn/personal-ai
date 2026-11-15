import { InputError, isRecord, text } from './input.ts';
import { ollamaOrigin } from './ollama.ts';
import { metricNames } from './experiment-types.ts';
import type { Evaluation, ExperimentData, ExperimentInput, ExperimentRun, GenerationOptions, ModelSnapshot, TextResponse } from './experiment-types.ts';

const bounds = {
  temperature: [0, 2, false, 0.2], top_p: [0.01, 1, false, 0.9],
  seed: [0, 2147483647, true, 42], num_ctx: [512, 16384, true, 4096], num_predict: [1, 4096, true, 512],
} as const;
const optionNames = Object.keys(bounds) as (keyof GenerationOptions)[];
export function requestID(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new InputError('올바른 요청 ID가 필요합니다.');
  return value;
}
export function experimentInput(input: unknown): ExperimentInput {
  if (!isRecord(input) || input.confirm !== true) throw new InputError('로컬 모델 실험 실행을 확인해 주세요.');
  const model = text(input.model, '모델', 200);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) throw new InputError('올바른 모델 이름이 필요합니다.');
  const system = input.system ?? '';
  if (typeof system !== 'string' || system.length > 20000) throw new InputError('시스템 지침은 20,000자 이내로 입력하세요.');
  const supplied = input.options ?? {};
  if (!isRecord(supplied)) throw new InputError('올바른 생성 설정이 필요합니다.');
  if (Object.keys(supplied).some(key => !Object.hasOwn(bounds, key))) throw new InputError('지원하지 않는 생성 설정입니다.');
  const options: GenerationOptions = { temperature: 0.2, top_p: 0.9, seed: 42, num_ctx: 4096, num_predict: 512 };
  for (const key of optionNames) {
    const [min, max, integer, fallback] = bounds[key], value = supplied[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new InputError(`${key}: ${min}~${max} 범위가 필요합니다.`);
    options[key] = value;
  }
  return { model, prompt: text(input.prompt, '실험 프롬프트'), system, options };
}

function damaged(): never { throw new Error('Unsupported or damaged experiment data. Restore a backup before starting.'); }
function record(value: unknown): Record<string, unknown> { if (!isRecord(value)) damaged(); return value; }
function string(value: unknown): string { if (typeof value !== 'string') damaged(); return value; }
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) damaged();
  return value;
}
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : string(value); }
function snapshot(value: unknown): ModelSnapshot {
  const data = record(value), details = record(data.details);
  if (!string(details.format) || data.remote !== false || !Array.isArray(data.capabilities)) damaged();
  const capabilities = data.capabilities.map(string);
  if (!capabilities.includes('completion')) damaged();
  const digest = string(data.digest);
  if (!digest) damaged();
  const size = data.size;
  if (size !== undefined && (typeof size !== 'number' || !Number.isFinite(size) || size < 0)) damaged();
  const modifiedAt = optionalString(data.modifiedAt);
  return {
    name: string(data.name), digest, remote: false, details, capabilities,
    parameters: string(data.parameters), template: string(data.template), system: string(data.system),
    modelInfo: record(data.modelInfo), ollamaVersion: string(data.ollamaVersion),
    ...(size === undefined ? {} : { size }), ...(modifiedAt === undefined ? {} : { modifiedAt }),
  };
}
function response(value: unknown): TextResponse {
  const data = record(value), rawMetrics = record(data.metrics), metrics: TextResponse['metrics'] = {};
  for (const key of metricNames) {
    const metric = rawMetrics[key];
    if (metric !== undefined) {
      if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) damaged();
      metrics[key] = metric;
    }
  }
  const model = optionalString(data.model), createdAt = optionalString(data.createdAt);
  return { text: string(data.text), thinking: string(data.thinking), doneReason: string(data.doneReason), metrics,
    ...(model === undefined ? {} : { model }), ...(createdAt === undefined ? {} : { createdAt }) };
}
function evaluations(value: unknown): Evaluation[] {
  if (!Array.isArray(value)) damaged();
  const ids = new Set<string>();
  return value.map((raw: unknown): Evaluation => {
    const item = record(raw), id = requestID(item.id);
    if (ids.has(id) || !['pass', 'partial', 'fail'].includes(string(item.verdict))) damaged();
    ids.add(id);
    const verdict = item.verdict;
    if (verdict !== 'pass' && verdict !== 'partial' && verdict !== 'fail') damaged();
    const notes = string(item.notes);
    if (notes.length > 10000) damaged();
    return { id, verdict, notes, createdAt: timestamp(item.createdAt) };
  });
}
function run(value: unknown): ExperimentRun {
  const data = record(value), rawInput = record(data.input), rawOptions = record(rawInput.options);
  if (typeof rawInput.system !== 'string' || optionNames.some(key => typeof rawOptions[key] !== 'number')) damaged();
  const input = experimentInput({ ...rawInput, confirm: true });
  const execution = record(data.execution);
  if (execution.provider !== 'ollama' || execution.stream !== false || execution.keepAlive !== 0 || execution.tools !== false) damaged();
  const endpoint = ollamaOrigin(string(execution.endpoint)), timeoutMs = timestamp(execution.timeoutMs);
  if (timeoutMs < 1 || timeoutMs > 600000) damaged();
  const base = {
    id: requestID(data.id), input, createdAt: timestamp(data.createdAt), evaluations: evaluations(data.evaluations),
    execution: { provider: 'ollama', endpoint, timeoutMs, stream: false, keepAlive: 0, tools: false } as const,
  };
  const modelSnapshot = data.modelSnapshot === undefined ? undefined : snapshot(data.modelSnapshot);
  if (modelSnapshot && modelSnapshot.name !== input.model) damaged();
  if (data.status === 'running') {
    if (data.finishedAt !== undefined || data.response !== undefined || data.error !== undefined || base.evaluations.length !== 0) damaged();
    return { ...base, status: 'running', ...(modelSnapshot === undefined ? {} : { modelSnapshot }) };
  }
  const finishedAt = timestamp(data.finishedAt);
  if (data.status === 'completed') {
    if (!modelSnapshot || data.error !== undefined) damaged();
    return { ...base, status: 'completed', modelSnapshot, finishedAt, response: response(data.response) };
  }
  if (data.status === 'failed' || data.status === 'interrupted') {
    if (data.response !== undefined) damaged();
    const rawError = record(data.error), httpStatus = rawError.httpStatus;
    if (httpStatus !== undefined && (typeof httpStatus !== 'number' || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) damaged();
    return { ...base, status: data.status, finishedAt, ...(modelSnapshot === undefined ? {} : { modelSnapshot }),
      error: { code: string(rawError.code), message: string(rawError.message), ...(httpStatus === undefined ? {} : { httpStatus }) } };
  }
  return damaged();
}

// JSON.parse yields unknown. No record reaches the store without state-specific validation.
export function experimentData(value: unknown): ExperimentData {
  try {
    const data = record(value);
    if (data.version !== 1 || !Array.isArray(data.runs)) damaged();
    const ids = new Set<string>();
    const runs = data.runs.map((value: unknown) => {
      const parsed = run(value);
      if (ids.has(parsed.id)) damaged();
      ids.add(parsed.id); return parsed;
    });
    return { version: 1, runs };
  } catch { return damaged(); }
}
