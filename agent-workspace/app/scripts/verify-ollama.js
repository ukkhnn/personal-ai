import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Ollama } from '../src/ollama.js';
import { ExperimentStore, Experiments } from '../src/experiments.js';

export function verificationArguments(args) {
  if (!args.includes('--allow-inference')) throw new Error('Live inference requires --allow-inference, --model and a fresh --output directory.');
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--allow-inference') continue;
    if (!['--model', '--output'].includes(key) || values[key] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: --allow-inference --model NAME --output DIRECTORY');
    values[key] = args[++index];
  }
  if (!values['--model'] || !values['--output']) throw new Error('Explicit --model and --output are required.');
  return { model: values['--model'], directory: resolve(values['--output']) };
}

export async function verifyOllama(args) {
  const { model, directory } = verificationArguments(args);
  if (existsSync(join(directory, 'experiments.json'))) throw new Error('Output already contains experiments; choose a fresh directory.');
  const experiments = new Experiments(new ExperimentStore(directory), new Ollama(process.env.OLLAMA_URL));
  try {
    const id = randomUUID();
    experiments.start({ requestID: id, confirm: true, model, prompt: 'Reply with exactly M3_OLLAMA_OK and nothing else.',
      system: 'Follow the requested output format exactly.', options: { temperature: 0, top_p: 1, seed: 42, num_ctx: 2048, num_predict: 32 } });
    await experiments.active.promise;
    const run = experiments.get(id);
    const passed = run.status === 'completed' && run.response.text.trim() === 'M3_OLLAMA_OK';
    experiments.evaluate(id, { requestID: randomUUID(), verdict: passed ? 'pass' : 'fail',
      notes: 'Verification script: exact response, after trimming outer whitespace, must equal M3_OLLAMA_OK. This is a smoke check, not a quality benchmark.' });
    const missingID = randomUUID();
    experiments.start({ requestID: missingID, confirm: true, model: 'm3-intentionally-missing:verification', prompt: 'Must not run a missing model.' });
    await experiments.active.promise;
    const missing = experiments.get(missingID);
    const restored = new Experiments(new ExperimentStore(directory), experiments.ollama);
    const retained = restored.get(id).evaluations.length === 1 && restored.get(missingID).error?.code === 'model_unavailable';
    console.log(JSON.stringify({ model, status: run.status, exactResponse: passed, restore: retained,
      expectedFailure: missing.error?.code, durationMs: run.finishedAt - run.createdAt, metrics: run.response?.metrics,
      digest: run.modelSnapshot?.digest, ollamaVersion: run.modelSnapshot?.ollamaVersion, output: join(directory, 'experiments.json') }, null, 2));
    if (!passed || !retained) throw new Error('Live verification did not pass; inspect the saved experiment records.');
  } finally { await experiments.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyOllama(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
