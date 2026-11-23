import { describe, expect, it } from 'vitest';
import pricing from '../../../benchmarks/pricing.json' with { type: 'json' };
import { costUsd, PRICES, ON_DEVICE_MODEL, UnknownModelPriceError, priceFor } from '../src/index.js';

describe('cost model', () => {
  it('mirrors benchmarks/pricing.json for every model, both directions', () => {
    const json = pricing.models as Record<string, { input_per_1m_usd: number; output_per_1m_usd: number }>;
    for (const [model, p] of Object.entries(json)) {
      expect(PRICES[model], model).toEqual({ inputPerMTokUsd: p.input_per_1m_usd, outputPerMTokUsd: p.output_per_1m_usd });
    }
    const coreOnly = Object.keys(PRICES).filter((m) => !(m in json));
    expect(coreOnly).toEqual([ON_DEVICE_MODEL]);
    expect(PRICES[ON_DEVICE_MODEL]).toEqual({ inputPerMTokUsd: pricing.on_device_usd_per_call, outputPerMTokUsd: 0 });
  });

  it('gemini-3.5-flash-lite is nonzero: $0.30/1M in, $2.50/1M out', () => {
    // 10,000 in * 0.30/1e6 = 0.003 ; 2,000 out * 2.50/1e6 = 0.005
    expect(costUsd('gemini-3.5-flash-lite', 10_000, 2_000)).toBeCloseTo(0.008, 12);
    expect(costUsd('gemini-3.5-flash-lite', 1_000_000, 0)).toBeCloseTo(0.30, 12);
    expect(costUsd('gemini-3.5-flash-lite', 0, 1_000_000)).toBeCloseTo(2.50, 12);
  });

  it('thinking tokens are billed at the output rate', () => {
    // 1,000 in = 0.0003 ; (500 out + 1,500 thinking) * 2.50/1e6 = 0.005
    expect(costUsd('gemini-3.5-flash-lite', 1_000, 500, 1_500)).toBeCloseTo(0.0053, 12);
    expect(costUsd('gemini-3.5-flash-lite', 1_000, 500, 1_500)).toBeCloseTo(costUsd('gemini-3.5-flash-lite', 1_000, 2_000), 15);
  });

  it('on-device Nano costs 0', () => {
    expect(costUsd(ON_DEVICE_MODEL, 5_000, 5_000, 5_000)).toBe(0);
  });

  it('unknown models fail loudly instead of returning $0', () => {
    expect(() => costUsd('gemini-9-imaginary', 10, 10)).toThrow(UnknownModelPriceError);
    expect(() => costUsd('toString', 10, 10)).toThrow(UnknownModelPriceError);
    expect(priceFor('gemini-9-imaginary')).toBeUndefined();
  });

  it('rejects negative or non-finite token counts', () => {
    expect(() => costUsd('gemini-3.5-flash-lite', -1, 0)).toThrow(RangeError);
    expect(() => costUsd('gemini-3.5-flash-lite', 0, Number.NaN)).toThrow(RangeError);
  });
});
