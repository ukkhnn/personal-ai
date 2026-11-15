import type { CompletedRun, ExperimentRun, TextExperimentRuntime } from '../../src/core/experiment-types.ts';

declare const missingResponse: Omit<CompletedRun, 'response'>;
// @ts-expect-error A completed record must contain the actual model response.
const completed: CompletedRun = missingResponse;
void completed;

declare const run: ExperimentRun;
// @ts-expect-error A running or failed record cannot guarantee a text response.
void run.response.text;
if (run.status === 'completed') {
  run.response.text.toUpperCase();
}

declare const textRuntime: TextExperimentRuntime;
// @ts-expect-error Text-only experiments cannot create development sessions.
textRuntime.create('/tmp/project', 'task');
// @ts-expect-error Text-only experiments do not expose permission decisions.
textRuntime.permission('request', 'once');
