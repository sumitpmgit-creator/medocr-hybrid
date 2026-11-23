// SPDX-License-Identifier: Apache-2.0
import {
  emptyMetrics,
  newRunId,
  type Pipeline,
  type PipelineRun,
  type Stage,
  type StageContext,
  type StageData,
  type StageMetrics,
  type StageResult,
} from '@med-ocr/core';

function addMetrics(a: StageMetrics, b: StageMetrics): StageMetrics {
  return {
    latencyMs: a.latencyMs + b.latencyMs,
    costUsd: a.costUsd + b.costUsd,
    bytesSent: a.bytesSent + b.bytesSent,
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
  };
}

export interface ProgressOpts {
  docId: string;
  runId?: string;
  signal?: AbortSignal;
  now?: () => number;
  onStageStart?: (stage: Stage, index: number, total: number) => void;
  onStageDone?: (result: StageResult, index: number, total: number) => void;
}

/** Same contract as core `runPipeline`, with per-stage progress callbacks for the UI. */
export async function runPipelineWithProgress(
  pipeline: Pipeline,
  input: StageData,
  opts: ProgressOpts,
): Promise<PipelineRun> {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const runId = opts.runId ?? newRunId(pipeline.id);
  const steps: StageResult[] = [];
  let current = input;
  let totals = emptyMetrics();
  const total = pipeline.stages.length;
  const ctx: StageContext = { runId, docId: opts.docId, signal: opts.signal };

  for (let index = 0; index < pipeline.stages.length; index++) {
    const stage = pipeline.stages[index]!;
    if (!stage.accepts.includes(current.kind)) {
      const error = `Stage ${stage.id} does not accept input kind "${current.kind}"`;
      return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt: new Date().toISOString(), steps, final: current, totals, failed: true, error };
    }
    opts.onStageStart?.(stage, index, total);
    const t0 = now();
    try {
      const res = await stage.run(current, ctx);
      if (!res.metrics.latencyMs) res.metrics.latencyMs = now() - t0;
      steps.push(res);
      totals = addMetrics(totals, res.metrics);
      opts.onStageDone?.(res, index, total);
      if (res.error) {
        return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt: new Date().toISOString(), steps, final: current, totals, failed: true, error: res.error };
      }
      current = res.output;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const failed: StageResult = {
        stageId: stage.id, stageKind: stage.kind, site: 'local_code', output: current,
        metrics: { ...emptyMetrics(), latencyMs: now() - t0 }, error,
      };
      steps.push(failed);
      opts.onStageDone?.(failed, index, total);
      return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt: new Date().toISOString(), steps, final: current, totals, failed: true, error };
    }
  }
  return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt: new Date().toISOString(), steps, final: current, totals, failed: false };
}
