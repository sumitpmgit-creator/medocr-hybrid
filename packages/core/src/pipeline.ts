// SPDX-License-Identifier: Apache-2.0
import type { PipelineRun, Pipeline, StageData, StageMetrics } from './types.js';
import { runPipelineResumable, type ResumableRun, type ResumableRunOptions } from './runner.js';

export function emptyMetrics(): StageMetrics {
  return { latencyMs: 0, costUsd: 0, bytesSent: 0, inputTokens: 0, outputTokens: 0 };
}

let counter = 0;
export function newRunId(prefix = 'run'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/**
 * Runs stages in order. Every intermediate output is kept so each stage can be scored
 * (Benchmark A after reading, Benchmark B after structuring) and errors attributed.
 * A failing stage stops the run but the partial trace is returned.
 *
 * Delegates to runPipelineResumable (no checkpoint store, no retries) so both runners share one
 * implementation: AbortSignal is raced against every stage and checked between stages (BUG-007),
 * `timeoutMs` bounds each stage, and the result carries a `record` (RunRecord).
 */
export async function runPipeline(
  pipeline: Pipeline,
  input: StageData,
  opts: { docId: string; runId?: string; config?: Record<string, unknown>; signal?: AbortSignal; now?: () => number; timeoutMs?: number } & Omit<ResumableRunOptions, 'store' | 'retries' | 'force' | 'downstream'>,
): Promise<ResumableRun> {
  return runPipelineResumable(pipeline, input, opts);
}

/**
 * Text produced by the reading stage (first stage of kind ocr / ocr+structure) for Benchmark A.
 * De-identification stages are deliberately skipped so redaction is not counted as an OCR error.
 */
export function readingText(run: PipelineRun): string | undefined {
  for (const step of run.steps) {
    if (step.stageKind !== 'ocr' && step.stageKind !== 'ocr+structure') continue;
    const o = step.output;
    if (o.kind === 'text') return o.text;
    if (o.kind === 'fields' && o.text !== undefined) return o.text;
  }
  return undefined;
}
