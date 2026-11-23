// SPDX-License-Identifier: Apache-2.0
/**
 * Cost model. PRICES ARE PLACEHOLDERS: confirm current per-token pricing for the pinned
 * cloud model on the Gemini Developer API pricing page before quoting any number.
 */
export interface Price { inputPerMTokUsd: number; outputPerMTokUsd: number }

export const PRICES: Record<string, Price> = {
  'gemini-3.5-flash-lite': { inputPerMTokUsd: 0, outputPerMTokUsd: 0 }, // TODO: fill from official pricing page
  'gemini-nano-on-device': { inputPerMTokUsd: 0, outputPerMTokUsd: 0 },
};

export function costUsd(model: string, inputTokens = 0, outputTokens = 0): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.inputPerMTokUsd + outputTokens * p.outputPerMTokUsd) / 1e6;
}
