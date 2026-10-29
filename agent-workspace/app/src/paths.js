import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Resolve existing ancestors too: a not-yet-created folder can be inside an
// iCloud directory through a symlink. Git metadata must be local as well.
export function canonicalPath(path) {
  const missing = [];
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(current.slice(parent.length).replace(/^\//, ''));
    current = parent;
  }
  return join(realpathSync(current), ...missing);
}
export function assertLocalPath(path, label = '실행 경로') {
  const actual = canonicalPath(path);
  for (const candidate of [resolve(path), actual]) {
    if (/(?:^|\/)Library\/Mobile Documents(?:\/|$)/i.test(candidate)
        || /(?:^|\/)Library\/CloudStorage(?:\/|$)/i.test(candidate)) {
      throw new Error(`${label}: iCloud·클라우드 공유 폴더 밖의 로컬 경로를 사용하세요.`);
    }
  }
  return actual;
}
