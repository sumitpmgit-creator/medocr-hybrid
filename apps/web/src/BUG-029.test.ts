// SPDX-License-Identifier: Apache-2.0
import type { StageContext } from '@med-ocr/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLEAN_CLOUD_TRANSCRIPT } from './mock';
import { costUsd } from '@med-ocr/core';

const generateContent = vi.fn();

vi.mock('firebase/ai', () => ({
  getGenerativeModel: () => ({ generateContent }),
  InferenceMode: {
    ONLY_ON_DEVICE: 'only_on_device',
    ONLY_IN_CLOUD: 'only_in_cloud',
    PREFER_ON_DEVICE: 'prefer_on_device',
    PREFER_IN_CLOUD: 'prefer_in_cloud',
  },
}));

vi.mock('./firebase', () => ({
  CLOUD_MODEL: 'gemini-3.5-flash-lite',
  firebase: () => ({ ai: {}, app: {} }),
}));

const ctx: StageContext = { runId: 'bug-029', docId: 'bug-029' };

describe('BUG-029: cloud-structure records usageMetadata tokens and cost', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({ documentType: 'lab_report', medications: [], labResults: [], abstentions: [] }),
        usageMetadata: { promptTokenCount: 41, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
      },
    });
  });

  it('feeds prompt, candidates, and thoughts tokens into metrics and cost', async () => {
    const { cloudStructure } = await import('./stages');
    const result = await cloudStructure.run({ kind: 'text', text: CLEAN_CLOUD_TRANSCRIPT }, ctx);
    expect(generateContent).toHaveBeenCalled();
    expect(result.metrics.inputTokens).toBe(41);
    expect(result.metrics.outputTokens).toBe(15);
    expect(result.metrics.costUsd).toBe(costUsd('gemini-3.5-flash-lite', 41, 15));
    expect(result.metrics.costUsd).toBeGreaterThan(0);
    expect(result.notes?.join('\n')).toMatch(/thoughtsTokenCount=5/);
  });
});
