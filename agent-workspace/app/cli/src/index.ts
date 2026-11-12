export { runDoctor, baseDiagnostics, ollamaDiagnostics, formatDoctor, summarizeTailscale } from './doctor.ts';
export type { DoctorOptions, DoctorReport, DiagnosticCheck, CheckStatus } from './doctor.ts';
export { planPreparation, prepare, renderPlan, renderPlist, validateOrigin, shellQuote, LABEL } from './prepare.ts';
export type { PreparationOptions, PreparationBundle, PlistSettings, PlanSettings } from './prepare.ts';
export { canonicalPath, assertLocalPath } from './paths.ts';
export { findBinary, findOpenCode, executable } from './runtime-config.ts';
