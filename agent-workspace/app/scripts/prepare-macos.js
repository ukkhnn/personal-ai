import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { prepare as createPreparation, planPreparation } from '../cli/src/prepare.ts';
export { LABEL, renderPlan, renderPlist, shellQuote, validateOrigin } from '../cli/src/prepare.ts';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function prepare(options = {}) {
  return createPreparation({ ...options, appDirectory: options.appDirectory || appDirectory });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      ...Object.fromEntries(['output', 'origin', 'env-file', 'data-dir', 'opencode'].map(key => [key, { type: 'string' }])),
      'dry-run': { type: 'boolean' },
    }, allowPositionals: false });
    if (values['dry-run']) console.log(JSON.stringify(planPreparation({ ...values, appDirectory }), null, 2));
    else console.log(`Prepared files: ${prepare(values)}\nNo software installed, LaunchAgent loaded, or network settings changed.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
