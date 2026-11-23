// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { usageFromResponse } from './usage';

describe('usageFromResponse', () => {
  it('adds thoughtsTokenCount to output tokens when present', () => {
    const u = usageFromResponse({
      response: {
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 15 },
      },
    });
    expect(u.inputTokens).toBe(100);
    expect(u.candidatesTokenCount).toBe(20);
    expect(u.thoughtsTokenCount).toBe(15);
    expect(u.outputTokens).toBe(35);
  });

  it('treats missing thoughts as zero and still reports candidates', () => {
    const u = usageFromResponse({
      response: { usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 } },
    });
    expect(u.thoughtsTokenCount).toBe(0);
    expect(u.outputTokens).toBe(3);
  });

  it('is zero when usageMetadata is absent', () => {
    expect(usageFromResponse({ response: {} })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      thoughtsTokenCount: 0,
      candidatesTokenCount: 0,
    });
  });
});
