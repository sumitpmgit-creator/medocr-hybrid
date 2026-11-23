// SPDX-License-Identifier: Apache-2.0
/**
 * Cost model: Gemini Developer API, Paid tier, Standard (non-batch), USD per 1M tokens,
 * text/image input. Mirrors benchmarks/pricing.json (Sage, retrieved 2026-11-23 from
 * https://ai.google.dev/gemini-api/docs/pricing). Core cannot import that file (it lives outside
 * the package and core must run in the browser), so test/cost.test.ts asserts the two agree for
 * every model. Update both together.
 *
 * Output price includes thinking tokens: pass Firebase AI Logic's usageMetadata.thoughtsTokenCount
 * as `thinkingTokens` (or add it into outputTokens yourself, never both).
 */
export interface Price { inputPerMTokUsd: number; outputPerMTokUsd: number }

export const PRICING_SOURCE = {
  url: 'https://ai.google.dev/gemini-api/docs/pricing',
  retrieved: '2026-11-23',
  tier: 'Paid tier, Standard (non-batch), USD per 1M tokens, text/image input',
} as const;

/** On-device Gemini Nano (Chrome Prompt API): no per-call API charge; device compute is not costed. */
export const ON_DEVICE_MODEL = 'gemini-nano-on-device';

export const PRICES: Record<string, Price> = {
  'gemini-2.5-flash-lite': { inputPerMTokUsd: 0.10, outputPerMTokUsd: 0.40 },
  'gemini-2.5-flash': { inputPerMTokUsd: 0.30, outputPerMTokUsd: 2.50 },
  'gemini-3.1-flash-lite': { inputPerMTokUsd: 0.25, outputPerMTokUsd: 1.50 },
  'gemini-3.5-flash-lite': { inputPerMTokUsd: 0.30, outputPerMTokUsd: 2.50 },
  'gemini-3-flash-preview': { inputPerMTokUsd: 0.50, outputPerMTokUsd: 3.00 },
  [ON_DEVICE_MODEL]: { inputPerMTokUsd: 0, outputPerMTokUsd: 0 },
};

export class UnknownModelPriceError extends Error {
  constructor(readonly model: string) {
    super(`No price for model "${model}". Add it to packages/core/src/cost.ts and benchmarks/pricing.json; refusing to report $0.`);
    this.name = 'UnknownModelPriceError';
  }
}

/** Price for `model`, or undefined if it is not priced. */
export function priceFor(model: string): Price | undefined {
  return Object.prototype.hasOwnProperty.call(PRICES, model) ? PRICES[model] : undefined;
}

/**
 * USD cost of one call. Thinking tokens are billed at the output rate.
 * Throws UnknownModelPriceError for an unpriced model (it used to return 0 silently).
 */
export function costUsd(model: string, inputTokens = 0, outputTokens = 0, thinkingTokens = 0): number {
  const p = priceFor(model);
  if (!p) throw new UnknownModelPriceError(model);
  for (const [k, v] of [['inputTokens', inputTokens], ['outputTokens', outputTokens], ['thinkingTokens', thinkingTokens]] as const) {
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`${k} must be a non-negative finite number, got ${v}`);
  }
  return (inputTokens * p.inputPerMTokUsd + (outputTokens + thinkingTokens) * p.outputPerMTokUsd) / 1e6;
}
