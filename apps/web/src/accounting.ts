// SPDX-License-Identifier: Apache-2.0
/**
 * Display-side cost and byte accounting on top of a core PipelineRun.
 *
 * Display cost prefers the USD recorded on the run, which stages compute with
 * `@med-ocr/core` `costUsd()` (official paid-tier rates, mirroring
 * `benchmarks/pricing.json`, retrieved 2026-11-23). If a run still reports $0
 * (for example a mock without token counts), these same rates from
 * `benchmarks/pricing.json` are shown as an estimate. Thinking tokens are
 * billed at the output rate and must already be folded into outputTokens.
 */
import { costUsd, type PipelineRun, type StageMetrics, type StageResult } from '@med-ocr/core';
import pricing from '../../../benchmarks/pricing.json';
import { CLOUD_MODEL } from './firebase';

const FLASH_LITE = pricing.models['gemini-3.5-flash-lite'];
if (!FLASH_LITE) throw new Error('benchmarks/pricing.json is missing gemini-3.5-flash-lite rates');

export const DEMO_CLOUD_INPUT_USD_PER_MILLION = FLASH_LITE.input_per_1m_usd;
export const DEMO_CLOUD_OUTPUT_USD_PER_MILLION = FLASH_LITE.output_per_1m_usd;
export const PRICING_SOURCE = pricing.source;
export const PRICING_RETRIEVED = pricing.retrieved;

export interface UsageView {
  bytesSent: number;
  bytesLocal: number;
  /** Cost recorded on the run (from core). */
  costUsd: number;
  /** Demo estimate when core prices are still 0. */
  estimatedUsd: number;
  inputTokens: number;
  outputTokens: number;
  usedEstimate: boolean;
}

export function estimateCloudUsd(inputTokens: number, outputTokens: number): number {
  const input = (Math.max(0, inputTokens) / 1_000_000) * DEMO_CLOUD_INPUT_USD_PER_MILLION;
  const output = (Math.max(0, outputTokens) / 1_000_000) * DEMO_CLOUD_OUTPUT_USD_PER_MILLION;
  return Math.round((input + output) * 1e8) / 1e8;
}

export function metricsFromSteps(steps: readonly StageResult[]): StageMetrics {
  return steps.reduce(
    (acc, step) => ({
      latencyMs: acc.latencyMs + step.metrics.latencyMs,
      costUsd: acc.costUsd + step.metrics.costUsd,
      bytesSent: acc.bytesSent + step.metrics.bytesSent,
      inputTokens: (acc.inputTokens ?? 0) + (step.metrics.inputTokens ?? 0),
      outputTokens: (acc.outputTokens ?? 0) + (step.metrics.outputTokens ?? 0),
    }),
    { latencyMs: 0, costUsd: 0, bytesSent: 0, inputTokens: 0, outputTokens: 0 } satisfies StageMetrics,
  );
}

export function usageFromRun(run: PipelineRun): UsageView {
  const totals = run.totals.bytesSent || run.totals.inputTokens ? run.totals : metricsFromSteps(run.steps);
  const inputTokens = totals.inputTokens ?? 0;
  const outputTokens = totals.outputTokens ?? 0;
  const recorded = totals.costUsd;
  const fallback = estimateCloudUsd(inputTokens, outputTokens);
  const usedEstimate = recorded === 0 && fallback > 0;
  const bytesSent = totals.bytesSent;
  const localSteps = run.steps.filter((step) => step.metrics.bytesSent === 0);
  // Local "bytes" are the on-device payloads we can observe (raw response sizes).
  const bytesLocal = localSteps.reduce((sum, step) => sum + (step.raw ? utf8Length(step.raw) : 0), 0);
  return {
    bytesSent,
    bytesLocal,
    costUsd: recorded,
    estimatedUsd: usedEstimate ? fallback : recorded,
    inputTokens,
    outputTokens,
    usedEstimate,
  };
}

export function cloudCostOrEstimate(inputTokens: number, outputTokens: number): { usd: number; estimated: boolean } {
  const recorded = costUsd(CLOUD_MODEL, inputTokens, outputTokens);
  if (recorded > 0) return { usd: recorded, estimated: false };
  const estimated = estimateCloudUsd(inputTokens, outputTokens);
  return { usd: estimated, estimated: estimated > 0 };
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
