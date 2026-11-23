// SPDX-License-Identifier: Apache-2.0
/** Benchmark C: end-to-end summary per pipeline (accuracy + time + cost + bytes + referrals). */
import type { PipelineRun, Reference } from './types.js';
import { readingText } from './pipeline.js';
import { cer, wer, normalizeText, omissionInvention, numericAccuracy, tokenizeWords } from './text-metrics.js';
import { mergePRF, scoreFields, type BenchmarkField, type FieldPRF } from './field-scorer.js';
import { scoringRulesId } from './clinical-values.js';
import { normalizeFrequency } from './normalize.js';
import type { RunRecord } from './runner.js';
import { attributeErrors } from './attribution.js';
import { ErrorRegister, type ErrorRegisterSummary } from './error-register.js';

/** Benchmark A bundle for one transcription (spec §A). */
export interface TranscriptionScore {
  cer: number;
  wer: number;
  /** Whole document identical after whitespace normalisation */
  exactMatch: boolean;
  omissionRate: number;
  inventionRate: number;
  numericAccuracy: number;
  /** Share of reference dosing abbreviations (OD, BD, TDS, SOS, HS...) reproduced; null if none */
  abbreviationAccuracy: number | null;
}

const ABBREV = /^(od|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat|ac|pc|qd|nocte)$/i;

export function scoreTranscription(reference: string, hypothesis: string): TranscriptionScore {
  const oi = omissionInvention(reference, hypothesis);
  const toks = (t: string) => tokenizeWords(normalizeText(t, { lowercase: true, stripPunctuation: true }));
  const ref = toks(reference).filter((w) => ABBREV.test(w));
  const pool = toks(hypothesis).filter((w) => ABBREV.test(w)).map((w) => normalizeFrequency(w));
  let hit = 0;
  for (const w of ref) { const k = pool.indexOf(normalizeFrequency(w)); if (k >= 0) { hit++; pool.splice(k, 1); } }
  return {
    cer: cer(reference, hypothesis).rate,
    wer: wer(reference, hypothesis).rate,
    exactMatch: normalizeText(reference) === normalizeText(hypothesis),
    omissionRate: oi.omissionRate,
    inventionRate: oi.inventionRate,
    numericAccuracy: numericAccuracy(reference, hypothesis),
    abbreviationAccuracy: ref.length ? hit / ref.length : null,
  };
}

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
  /** Benchmark A details when a reference transcription exists */
  transcription?: TranscriptionScore;
  /** Benchmark B headline field P/R/F1 when reference fields exist */
  benchmarkFields?: Record<BenchmarkField, FieldPRF>;
  /** Benchmark C operational details when the run has a RunRecord */
  retries?: number;
  timedOut?: boolean;
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
  /** Latency distribution over all docs (spec §G) */
  latencyMs?: { p50: number; p90: number; p95: number; p99: number };
  /** Failed docs / docs (failed docs stay in the denominator for accuracy, spec §8) */
  failureRate?: number;
  timeoutRate?: number;
  /** Retries per doc */
  retryRate?: number;
  /** Micro-averaged headline field scores across docs */
  benchmarkFields?: Record<BenchmarkField, FieldPRF>;
  meanTranscription?: Partial<Record<'omissionRate' | 'inventionRate' | 'numericAccuracy' | 'exactMatchRate', number>>;
  register?: ErrorRegisterSummary;
  /** Normalisation/comparison rules the scores were computed under */
  rulesId?: string;
}

/** Nearest-rank percentile of `xs` (p in 0..100). */
export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function scoreRun(run: PipelineRun, ref: Reference | undefined, register?: ErrorRegister): DocScore {
  const s: DocScore = { docId: run.docId, runId: run.runId, latencyMs: run.totals.latencyMs, costUsd: run.totals.costUsd, bytesSent: run.totals.bytesSent, failed: run.failed };
  const text = readingText(run);
  if (ref?.text !== undefined && text !== undefined) {
    s.transcription = scoreTranscription(ref.text, text);
    s.cer = s.transcription.cer;
    s.wer = s.transcription.wer;
  }
  const record = (run as PipelineRun & { record?: RunRecord }).record;
  if (record) {
    s.retries = record.retries;
    s.timedOut = record.stages.some((st) => st.status === 'timed_out');
  }
  if (ref?.doc && run.final.kind === 'fields') {
    const fs = scoreFields(ref.doc, run.final.doc);
    s.fieldF1 = fs.f1;
    s.passesSafetyScreen = fs.passesSafetyScreen;
    s.benchmarkFields = fs.benchmarkFields;
    register?.record({ runId: run.runId, pipelineId: run.pipelineId, docId: run.docId }, attributeErrors(run, ref.doc), fs.expected);
  }
  return s;
}

export function summarize(pipelineId: string, runs: PipelineRun[], refs: Map<string, Reference>): PipelineSummary {
  const reg = new ErrorRegister();
  const scores = runs.map((r) => scoreRun(r, refs.get(r.docId), reg));
  const def = <T>(xs: (T | undefined)[]) => xs.filter((x): x is T => x !== undefined);
  const safety = def(scores.map((s) => s.passesSafetyScreen));
  const bf = def(scores.map((s) => s.benchmarkFields));
  const tr = def(scores.map((s) => s.transcription));
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
    latencyMs: { p50: percentile(scores.map((x) => x.latencyMs), 50), p90: percentile(scores.map((x) => x.latencyMs), 90), p95: percentile(scores.map((x) => x.latencyMs), 95), p99: percentile(scores.map((x) => x.latencyMs), 99) },
    failureRate: scores.length ? scores.filter((x) => x.failed).length / scores.length : 0,
    timeoutRate: scores.length ? scores.filter((x) => x.timedOut).length / scores.length : 0,
    retryRate: scores.length ? scores.reduce((a, x) => a + (x.retries ?? 0), 0) / scores.length : 0,
    ...(bf.length ? { benchmarkFields: Object.fromEntries(Object.keys(bf[0]!).map((k) => [k, mergePRF(bf.map((b) => b[k as BenchmarkField]))])) as Record<BenchmarkField, FieldPRF> } : {}),
    ...(tr.length ? { meanTranscription: { omissionRate: mean(tr.map((t) => t.omissionRate)), inventionRate: mean(tr.map((t) => t.inventionRate)), numericAccuracy: mean(tr.map((t) => t.numericAccuracy)), exactMatchRate: mean(tr.map((t) => (t.exactMatch ? 1 : 0))) } } : {}),
    register: reg.summary(),
    rulesId: scoringRulesId(),
  };
}
