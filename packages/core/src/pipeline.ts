// SPDX-License-Identifier: Apache-2.0
import type { Pipeline, PipelineRun, StageData, StageMetrics, StageResult } from './types.js';

export function emptyMetrics(): StageMetrics {
  return { latencyMs: 0, costUsd: 0, bytesSent: 0, inputTokens: 0, outputTokens: 0 };
}

function addMetrics(a: StageMetrics, b: StageMetrics): StageMetrics {
  return {
    latencyMs: a.latencyMs + b.latencyMs,
    costUsd: a.costUsd + b.costUsd,
    bytesSent: a.bytesSent + b.bytesSent,
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
  };
}

let counter = 0;
export function newRunId(prefix = 'run'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/**
 * Runs stages in order. Every intermediate output is kept so each stage can be scored
 * (Benchmark A after reading, Benchmark B after structuring) and errors attributed.
 * A failing stage stops the run but the partial trace is returned (rerun-failed-only later).
 */
export async function runPipeline(
  pipeline: Pipeline,
  input: StageData,
  opts: { docId: string; runId?: string; config?: Record<string, unknown>; signal?: AbortSignal; now?: () => number },
): Promise<PipelineRun> {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const runId = opts.runId ?? newRunId(pipeline.id);
  const steps: StageResult[] = [];
  let current = input;
  let totals = emptyMetrics();
  for (const stage of pipeline.stages) {
    if (!stage.accepts.includes(current.kind)) {
      const error = `Stage ${stage.id} does not accept input kind "${current.kind}"`;
      return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt: new Date().toISOString(), steps, final: current, totals, failed: true, error };
    }
    const t0 = now();
    try {
      const res = await stage.run(current, { runId, docId: opts.docId, config: opts.config, signal: opts.signal });
      if (!res.metrics.latencyMs) res.metrics.latencyMs = now() - t0;
      steps.push(res);
      totals = addMetrics(totals, res.metrics);
      if (res.error) {
        return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt: new Date().toISOString(), steps, final: current, totals, failed: true, error: res.error };
      }
      current = res.output;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      steps.push({ stageId: stage.id, stageKind: stage.kind, site: 'local_code', output: current, metrics: { ...emptyMetrics(), latencyMs: now() - t0 }, error });
      return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt: new Date().toISOString(), steps, final: current, totals, failed: true, error };
    }
  }
  return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt: new Date().toISOString(), steps, final: current, totals, failed: false };
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
