export class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function text(value: unknown, name: string, max = 20000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`${name}: 1~${max}자 이내로 입력하세요.`);
  return value.trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
