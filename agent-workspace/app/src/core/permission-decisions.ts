import { InputError, text } from './input.ts';

export type PermissionReply = 'once' | 'reject';

interface DecisionBase {
  id: string;
  reply: PermissionReply;
  createdAt: number;
  permission?: string;
  patterns: string[];
  command: string | null;
}

export type SendingPermissionDecision = DecisionBase & { status: 'sending'; updatedAt?: never };
export type SettledPermissionDecision = DecisionBase & { status: 'applied' | 'uncertain'; updatedAt: number };
export type PermissionDecision = SendingPermissionDecision | SettledPermissionDecision;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

function damaged(): never {
  throw new Error('Unsupported or damaged permission decision data. Restore a backup before starting.');
}

export function permissionReply(value: unknown): PermissionReply {
  if (value !== 'once' && value !== 'reject') throw new InputError('한 번 승인 또는 거절을 선택하세요.');
  return value;
}

function parseDecision(value: unknown): PermissionDecision {
  if (!record(value) || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 200
      || (value.reply !== 'once' && value.reply !== 'reject') || !timestamp(value.createdAt)
      || (value.permission !== undefined && typeof value.permission !== 'string')
      || !strings(value.patterns) || (value.command !== null && typeof value.command !== 'string')) damaged();
  const base: DecisionBase = {
    id: value.id, reply: value.reply, createdAt: value.createdAt,
    ...(value.permission === undefined ? {} : { permission: value.permission }),
    patterns: [...value.patterns], command: value.command,
  };
  if (value.status === 'sending') {
    if (Object.hasOwn(value, 'updatedAt')) damaged();
    return { ...base, status: 'sending' };
  }
  if ((value.status === 'applied' || value.status === 'uncertain') && timestamp(value.updatedAt)) {
    return { ...base, status: value.status, updatedAt: value.updatedAt };
  }
  return damaged();
}

// The field was absent before durable approval history was introduced.
export function permissionDecisionHistory(value: unknown): PermissionDecision[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) damaged();
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    const decision = parseDecision(entry);
    if (ids.has(decision.id)) damaged();
    ids.add(decision.id);
    return decision;
  });
}

export function assertPermissionDecisionTasks(value: unknown): void {
  if (!Array.isArray(value)) damaged();
  for (const task of value) {
    if (!record(task)) damaged();
    permissionDecisionHistory(task.permissionDecisions);
  }
}

export function assertNewPermissionDecision(history: readonly PermissionDecision[], id: string): void {
  const previous = history.find(decision => decision.id === id);
  if (previous) throw new InputError(previous.status === 'applied'
    ? '다른 기기 또는 이전 요청에서 이미 처리했습니다. 최신 상태를 확인하세요.'
    : '승인 전달 결과를 확인해야 합니다. 중복 실행을 막기 위해 다시 전달하지 않습니다.', 409);
}

export function createPermissionDecision(id: string, reply: PermissionReply, permission: unknown, createdAt = Date.now()): SendingPermissionDecision {
  if (!record(permission) || permission.id !== id) throw new InputError('이 작업의 대기 중 승인 요청이 아닙니다.', 409);
  const patterns = permission.patterns ?? [];
  if (!strings(patterns) || (permission.permission !== undefined && typeof permission.permission !== 'string')) {
    throw new InputError('승인 요청 형식을 확인할 수 없습니다. 최신 상태를 확인하세요.', 502);
  }
  if (!timestamp(createdAt)) throw new Error('Invalid permission decision timestamp.');
  return {
    id: text(id, '승인 요청 ID', 200), reply: permissionReply(reply), status: 'sending', createdAt,
    ...(permission.permission === undefined ? {} : { permission: permission.permission }),
    patterns: [...patterns],
    command: record(permission.metadata) && typeof permission.metadata.command === 'string' ? permission.metadata.command : null,
  };
}

export function settlePermissionDecision(decision: SendingPermissionDecision, status: SettledPermissionDecision['status'], updatedAt = Date.now()): SettledPermissionDecision {
  // JS callers and persisted data still cross a runtime boundary despite TS types.
  if (parseDecision(decision).status !== 'sending' || (status !== 'applied' && status !== 'uncertain')) {
    throw new Error('Only a sending permission decision can be settled.');
  }
  if (!timestamp(updatedAt)) throw new Error('Invalid permission decision timestamp.');
  return { ...decision, status, updatedAt };
}
