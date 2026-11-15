export interface GenerationOptions {
  temperature: number;
  top_p: number;
  seed: number;
  num_ctx: number;
  num_predict: number;
}

export interface ExperimentInput {
  model: string;
  prompt: string;
  system: string;
  options: GenerationOptions;
}

export interface LocalModel {
  name: string;
  digest?: string;
  size?: number;
  modifiedAt?: string;
  details?: Record<string, unknown>;
  remote: boolean;
}

export interface ModelDescription {
  details: Record<string, unknown>;
  capabilities: string[];
  parameters: string;
  template: string;
  system: string;
  modelInfo: Record<string, unknown>;
}

export const metricNames = ['total_duration', 'load_duration', 'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration'] as const;
export type MetricName = typeof metricNames[number];
export interface TextResponse {
  model?: string;
  createdAt?: string;
  text: string;
  thinking: string;
  doneReason: string;
  metrics: Partial<Record<MetricName, number>>;
}

// A text experiment cannot acquire OpenCode's session/tool execution interface.
export interface TextExperimentRuntime {
  readonly kind: 'local-text';
  origin: string;
  timeoutMs: number;
  catalog(signal?: AbortSignal): Promise<{ version: string; models: LocalModel[] }>;
  describe(model: string, signal?: AbortSignal): Promise<ModelDescription>;
  chat(input: ExperimentInput, signal?: AbortSignal): Promise<TextResponse>;
}

export type ModelSnapshot = LocalModel & ModelDescription & { digest: string; remote: false; ollamaVersion: string };
export interface Evaluation {
  id: string;
  verdict: 'pass' | 'partial' | 'fail';
  notes: string;
  createdAt: number;
}
export interface Execution {
  provider: 'ollama';
  endpoint: string;
  timeoutMs: number;
  stream: false;
  keepAlive: 0;
  tools: false;
}
interface RunBase {
  id: string;
  input: ExperimentInput;
  createdAt: number;
  evaluations: Evaluation[];
  execution: Execution;
}
export interface RunningRun extends RunBase {
  status: 'running';
  modelSnapshot?: ModelSnapshot;
  finishedAt?: never;
  response?: never;
  error?: never;
}
export interface CompletedRun extends RunBase {
  status: 'completed';
  modelSnapshot: ModelSnapshot;
  finishedAt: number;
  response: TextResponse;
  error?: never;
}
export interface FailedRun extends RunBase {
  status: 'failed' | 'interrupted';
  modelSnapshot?: ModelSnapshot;
  finishedAt: number;
  response?: never;
  error: { code: string; message: string; httpStatus?: number };
}
export type ExperimentRun = RunningRun | CompletedRun | FailedRun;
export interface ExperimentData { version: 1; runs: ExperimentRun[] }
