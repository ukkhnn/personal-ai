// Text-only experiments. No credentials, downloads, tools or arbitrary proxy paths.
export class OllamaError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

export class Ollama {
  constructor(origin = 'http://127.0.0.1:11434', { fetcher = globalThis.fetch, timeoutMs = 180000 } = {}) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Ollama URL must be a literal loopback HTTP origin.');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error('Invalid Ollama timeout.');
    this.origin = url.origin; this.fetcher = fetcher; this.timeoutMs = timeoutMs;
  }
  async request(path, body, signal) {
    const timeout = AbortSignal.timeout(body && path === '/api/chat' ? this.timeoutMs : 10000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetcher(`${this.origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: combined,
        headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new OllamaError('http_error', `Ollama HTTP ${response.status}`, response.status);
      }
      // Bound responses, including model metadata, without logging prompt/error bodies.
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) throw new OllamaError('response_too_large', 'Ollama 응답 크기 제한을 초과했습니다.');
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { throw new OllamaError('invalid_response', 'Ollama JSON 응답을 읽지 못했습니다.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new OllamaError('invalid_response', 'Ollama 응답 형식이 올바르지 않습니다.');
      return data;
    } catch (error) {
      if (signal?.aborted) throw new OllamaError('aborted', '실험 연결을 중단했습니다. 서버 계산 종료 여부는 확인되지 않았습니다.');
      if (timeout.aborted) throw new OllamaError('timeout', 'Ollama 응답 시간이 초과됐습니다. 자동 재시도하지 않습니다.');
      if (error instanceof OllamaError) throw error;
      throw new OllamaError('unavailable', 'Ollama에 연결하지 못했습니다. 맥미니의 Ollama 실행 상태를 확인하세요.');
    }
  }
  async catalog(signal) {
    const [version, tags] = await Promise.all([this.request('/api/version', undefined, signal), this.request('/api/tags', undefined, signal)]);
    if (typeof version.version !== 'string' || !Array.isArray(tags.models)) throw new OllamaError('invalid_response', 'Ollama 모델 목록을 읽지 못했습니다.');
    return { version: version.version, models: tags.models.filter(m => typeof m.name === 'string').map(m => ({
      name: m.name, digest: m.digest, size: m.size, modifiedAt: m.modified_at, details: m.details,
      remote: !!(m.remote_model || m.remote_host || /(?:[:\-])cloud\b/i.test(m.name)),
    })) };
  }
  async describe(model, signal) {
    const data = await this.request('/api/show', { model }, signal);
    if (data.remote_model || data.remote_host || /(?:[:\-])cloud\b/i.test(model) || !data.details?.format
        || !Array.isArray(data.capabilities) || !data.capabilities.includes('completion')) {
      throw new OllamaError('unsupported_model', '로컬 텍스트 생성 모델만 실험할 수 있습니다.');
    }
    return { details: data.details, capabilities: data.capabilities, parameters: data.parameters || '',
      template: data.template || '', system: data.system || '', modelInfo: data.model_info || {} };
  }
  async chat(input, signal) {
    const data = await this.request('/api/chat', { model: input.model, stream: false, keep_alive: 0,
      messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), { role: 'user', content: input.prompt }],
      options: input.options,
    }, signal);
    if (data.done !== true || data.message?.role !== 'assistant' || typeof data.message.content !== 'string'
        || data.message.tool_calls?.length) throw new OllamaError('invalid_response', '완료된 텍스트 응답을 확인하지 못했습니다.');
    const metrics = {};
    for (const key of ['total_duration', 'load_duration', 'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration']) {
      if (Number.isFinite(data[key]) && data[key] >= 0) metrics[key] = data[key];
    }
    return { model: data.model, createdAt: data.created_at, text: data.message.content,
      thinking: typeof data.message.thinking === 'string' ? data.message.thinking : '',
      doneReason: data.done_reason || 'unknown', metrics };
  }
}
