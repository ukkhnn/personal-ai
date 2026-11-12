import { isRecord } from './input.ts';
import { metricNames } from './experiment-types.ts';
import type { ExperimentInput, LocalModel, ModelDescription, TextExperimentRuntime, TextResponse } from './experiment-types.ts';

export class OllamaError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message); this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export function ollamaOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Ollama URL must be a literal loopback HTTP origin.');
  }
  return url.origin;
}

function invalid(): never { throw new OllamaError('invalid_response', 'Ollama 응답 형식이 올바르지 않습니다.'); }
function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid();
  return value;
}
function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalid();
  return value;
}

// The application only sends these fixed operations to a literal loopback origin.
const operations = ['/api/version', '/api/tags', '/api/show', '/api/chat'] as const;
type Operation = typeof operations[number];
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
export class Ollama implements TextExperimentRuntime {
  readonly kind = 'local-text';
  origin: string;
  fetcher: Fetcher;
  timeoutMs: number;
  constructor(origin = 'http://127.0.0.1:11434', { fetcher = globalThis.fetch, timeoutMs = 180000 }: { fetcher?: Fetcher; timeoutMs?: number } = {}) {
    this.origin = ollamaOrigin(origin);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error('Invalid Ollama timeout.');
    this.fetcher = fetcher; this.timeoutMs = timeoutMs;
  }
  async request(path: Operation, body?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!operations.includes(path)) throw new Error('Unsupported Ollama operation.');
    const timeout = AbortSignal.timeout(body && path === '/api/chat' ? this.timeoutMs : 10000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetcher(`${this.origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: combined,
        headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new OllamaError('http_error', `Ollama HTTP ${response.status}`, response.status);
      }
      if (!response.body) invalid();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 8 * 1024 * 1024) {
            await reader.cancel();
            throw new OllamaError('response_too_large', 'Ollama 응답 크기 제한을 초과했습니다.');
          }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      let data: unknown;
      try { data = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { throw new OllamaError('invalid_response', 'Ollama JSON 응답을 읽지 못했습니다.'); }
      if (!isRecord(data) || data.error) invalid();
      return data;
    } catch (error) {
      if (signal?.aborted) throw new OllamaError('aborted', '실험 연결을 중단했습니다. 서버 계산 종료 여부는 확인되지 않았습니다.');
      if (timeout.aborted) throw new OllamaError('timeout', 'Ollama 응답 시간이 초과됐습니다. 자동 재시도하지 않습니다.');
      if (error instanceof OllamaError) throw error;
      throw new OllamaError('unavailable', 'Ollama에 연결하지 못했습니다. 맥미니의 Ollama 실행 상태를 확인하세요.');
    }
  }
  async catalog(signal?: AbortSignal): Promise<{ version: string; models: LocalModel[] }> {
    const [version, tags] = await Promise.all([this.request('/api/version', undefined, signal), this.request('/api/tags', undefined, signal)]);
    if (typeof version.version !== 'string' || !Array.isArray(tags.models)) invalid();
    const models = tags.models.map((entry: unknown): LocalModel => {
      if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name) invalid();
      const digest = optionalString(entry.digest), modifiedAt = optionalString(entry.modified_at);
      const details = optionalRecord(entry.details);
      const size = entry.size;
      if (size !== undefined && (typeof size !== 'number' || !Number.isFinite(size) || size < 0)) invalid();
      if (entry.remote_model !== undefined && typeof entry.remote_model !== 'string') invalid();
      if (entry.remote_host !== undefined && typeof entry.remote_host !== 'string') invalid();
      return {
        name: entry.name, ...(digest === undefined ? {} : { digest }), ...(size === undefined ? {} : { size }),
        ...(modifiedAt === undefined ? {} : { modifiedAt }), ...(details === undefined ? {} : { details }),
        remote: !!(entry.remote_model || entry.remote_host || /(?:[:-])cloud\b/i.test(entry.name)),
      };
    });
    return { version: version.version, models };
  }
  async describe(model: string, signal?: AbortSignal): Promise<ModelDescription> {
    const data = await this.request('/api/show', { model }, signal);
    const remoteModel = optionalString(data.remote_model), remoteHost = optionalString(data.remote_host);
    if (remoteModel || remoteHost || /(?:[:-])cloud\b/i.test(model) || !isRecord(data.details)
        || typeof data.details.format !== 'string' || !data.details.format
        || !Array.isArray(data.capabilities) || !data.capabilities.includes('completion')) {
      throw new OllamaError('unsupported_model', '로컬 텍스트 생성 모델만 실험할 수 있습니다.');
    }
    const capabilities = data.capabilities.map((value: unknown) => { if (typeof value !== 'string') invalid(); return value; });
    return { details: data.details, capabilities, parameters: optionalString(data.parameters) ?? '',
      template: optionalString(data.template) ?? '', system: optionalString(data.system) ?? '', modelInfo: optionalRecord(data.model_info) ?? {} };
  }
  async chat(input: ExperimentInput, signal?: AbortSignal): Promise<TextResponse> {
    const data = await this.request('/api/chat', { model: input.model, stream: false, keep_alive: 0,
      messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: input.prompt }],
      options: input.options,
    }, signal);
    if (data.done !== true || !isRecord(data.message) || data.message.role !== 'assistant' || typeof data.message.content !== 'string'
        || (data.message.tool_calls !== undefined && (!Array.isArray(data.message.tool_calls) || data.message.tool_calls.length !== 0))) {
      throw new OllamaError('invalid_response', '완료된 텍스트 응답을 확인하지 못했습니다.');
    }
    const metrics: TextResponse['metrics'] = {};
    for (const key of metricNames) {
      const value = data[key];
      if (value !== undefined) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid();
        metrics[key] = value;
      }
    }
    const model = optionalString(data.model), createdAt = optionalString(data.created_at);
    return { ...(model === undefined ? {} : { model }), ...(createdAt === undefined ? {} : { createdAt }),
      text: data.message.content, thinking: optionalString(data.message.thinking) ?? '',
      doneReason: optionalString(data.done_reason) ?? 'unknown', metrics };
  }
}
