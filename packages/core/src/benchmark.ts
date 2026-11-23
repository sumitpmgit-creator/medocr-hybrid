// SPDX-License-Identifier: Apache-2.0
/** Benchmark C: end-to-end summary per pipeline (accuracy + time + cost + bytes + referrals). */
import type { PipelineRun, Reference } from './types.js';
import { readingText } from './pipeline.js';
import { cer, wer } from './text-metrics.js';
import { scoreFields } from './field-scorer.js';
import { attributeErrors } from './attribution.js';
import { ErrorRegister } from './error-register.js';

export interface DocScore {
  docId: string;
  runId: string;
  cer?: number;
  wer?: number;
  fieldF1?: number;
  passesSafetyScreen?: boolean;
  latencyMs: number;
  costUsd: number;
  bytesSent: number;
  failed: boolean;
}

export interface PipelineSummary {
  pipelineId: string;
  docs: number;
  failed: number;
  meanCER?: number;
  meanWER?: number;
  meanFieldF1?: number;
  safetyPassRate?: number;
  criticalPer100Docs: number;
  meanLatencyMs: number;
  totalCostUsd: number;
  totalBytesSent: number;
  errorsByStage: Record<string, number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function scoreRun(run: PipelineRun, ref: Reference | undefined, register?: ErrorRegister): DocScore {
  const s: DocScore = { docId: run.docId, runId: run.runId, latencyMs: run.totals.latencyMs, costUsd: run.totals.costUsd, bytesSent: run.totals.bytesSent, failed: run.failed };
  const text = readingText(run);
  if (ref?.text !== undefined && text !== undefined) {
    s.cer = cer(ref.text, text).rate;
    s.wer = wer(ref.text, text).rate;
  }
  if (ref?.doc && run.final.kind === 'fields') {
    const fs = scoreFields(ref.doc, run.final.doc);
    s.fieldF1 = fs.f1;
    s.passesSafetyScreen = fs.passesSafetyScreen;
    register?.record({ runId: run.runId, pipelineId: run.pipelineId, docId: run.docId }, attributeErrors(run, ref.doc), fs.expected);
  }
  return s;
}

export function summarize(pipelineId: string, runs: PipelineRun[], refs: Map<string, Reference>): PipelineSummary {
  const reg = new ErrorRegister();
  const scores = runs.map((r) => scoreRun(r, refs.get(r.docId), reg));
  const def = <T>(xs: (T | undefined)[]) => xs.filter((x): x is T => x !== undefined);
  const safety = def(scores.map((s) => s.passesSafetyScreen));
  return {
    pipelineId,
    docs: scores.length,
    failed: scores.filter((s) => s.failed).length,
    meanCER: mean(def(scores.map((s) => s.cer))),
    meanWER: mean(def(scores.map((s) => s.wer))),
    meanFieldF1: mean(def(scores.map((s) => s.fieldF1))),
    safetyPassRate: safety.length ? safety.filter(Boolean).length / safety.length : undefined,
    criticalPer100Docs: reg.per100Docs('critical'),
    meanLatencyMs: mean(scores.map((s) => s.latencyMs)) ?? 0,
    totalCostUsd: scores.reduce((a, s) => a + s.costUsd, 0),
    totalBytesSent: scores.reduce((a, s) => a + s.bytesSent, 0),
    errorsByStage: reg.byStage(),
  };
}
