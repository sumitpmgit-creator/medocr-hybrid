import { readFileSync } from 'node:fs';

export interface ModelPrice { input_per_1m_usd: number; output_per_1m_usd: number }
export interface Pricing {
  source: string;
  retrieved: string;
  tier: string;
  notes: string[];
  on_device_usd_per_call: number;
  models: Record<string, ModelPrice>;
}

export interface Usage { model: string; promptTokens: number; outputTokens: number }

export function loadPricing(path: string): Pricing {
  return JSON.parse(readFileSync(path, 'utf8')) as Pricing;
}

/**
 * Cost of one sample from token usage the pipeline reports (Firebase AI Logic usageMetadata).
 * Returns null when a cloud call happened but no usage was reported, or the model is not in pricing.json:
 * we never invent token counts.
 */
export function costOf(usage: Usage[] | undefined, cloudRequests: number, pricing: Pricing): { usd: number | null; reason?: string } {
  const u = usage ?? [];
  if (u.length === 0) {
    return cloudRequests === 0 ? { usd: 0 } : { usd: null, reason: 'cloud request made but pipeline reported no token usage' };
  }
  let usd = 0;
  for (const x of u) {
    const p = pricing.models[x.model] ?? pricing.models[x.model.replace(/^models\//, '')];
    if (!p) return { usd: null, reason: `model ${x.model} not in benchmarks/pricing.json` };
    usd += (x.promptTokens / 1e6) * p.input_per_1m_usd + (x.outputTokens / 1e6) * p.output_per_1m_usd;
  }
  return { usd };
}
