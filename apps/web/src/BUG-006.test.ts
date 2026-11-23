// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_THRESHOLDS, runPipeline, type ImagePayload, type StageContext } from '@med-ocr/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isNetworkFailure,
  OFFLINE_STATUS,
  setCloudReachableForTests,
} from './cloud-call';
import {
  CLEAN_CLOUD_TRANSCRIPT,
  mockCloudGenerateCalls,
  mockCloudStructure,
  mockPipelines,
  ON_DEVICE_DOC,
  setMockCloudBehavior,
} from './mock';
import { buildPrivacyReceipt } from './receipt';

const image: ImagePayload = { mimeType: 'image/png', base64: 'AAAAimagepayloadZZ==' };
const ctx: StageContext = { runId: 'bug-006', docId: 'bug-006' };
const cleanText = { kind: 'text' as const, text: CLEAN_CLOUD_TRANSCRIPT };

afterEach(() => {
  setMockCloudBehavior('ok');
  setCloudReachableForTests(undefined);
  vi.unstubAllGlobals();
});

describe('BUG-006: hybrid offline fallback', () => {
  it('classifies a fetch TypeError as a network failure', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(OFFLINE_STATUS).not.toMatch(/Failed to fetch/i);
  });

  it('does not attempt a cloud call when navigator.onLine is false, and falls back to the on-device result', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const hybrid = mockPipelines(DEFAULT_THRESHOLDS).find((p) => p.id === 'hybrid')!;
    const run = await runPipeline(hybrid, { kind: 'image', image }, { docId: 'off-02' });
    expect(mockCloudGenerateCalls).toBe(0);
    expect(run.failed).toBe(false);
    expect(run.error ?? '').not.toMatch(/Failed to fetch/i);

    const last = run.steps.at(-1)!;
    expect(last.failed).toBeFalsy();
    expect(last.metrics.bytesSent).toBe(0);
    expect(last.notes?.some((n) => n === OFFLINE_STATUS || n === 'status:offline')).toBe(true);
    expect(last.notes?.join('\n')).not.toMatch(/Failed to fetch/i);
    expect(['on_device', 'local_code']).toContain(last.site);

    const output = last.output;
    expect(output.kind).toBe('fields');
    if (output.kind !== 'fields') throw new Error('expected fields');
    expect(output.doc.medications.map((m) => m.name)).toEqual(ON_DEVICE_DOC.medications.map((m) => m.name));
    expect(output.doc.medications.find((m) => m.name === 'Pantoprazole')?.dose).toBe('20 mg');
    expect(output.doc.abstentions?.join('\n')).toMatch(/HUMAN CONFIRM/);
    expect(output.doc.abstentions?.join('\n')).toMatch(/Pantoprazole|Hemoglobin/);
    expect(output.doc.abstentions?.some((a) => a.includes('Failed to fetch'))).toBe(false);

    const receipt = buildPrivacyReceipt(run);
    expect(receipt.totalBytesSent).toBe(0);
  });

  it('falls back to the on-device result when a cloud fetch throws TypeError, and shows an offline status', async () => {
    setMockCloudBehavior('fetch-error');
    const result = await mockCloudStructure.run(cleanText, ctx);
    expect(result.error).toBeUndefined();
    expect(result.site).toBe('on_device');
    expect(result.notes?.join('\n')).toContain(OFFLINE_STATUS);
    expect(result.notes?.join('\n')).toContain('status:offline');
    expect(result.notes?.join('\n')).not.toMatch(/Failed to fetch/i);
    if (result.output.kind !== 'fields') throw new Error('expected fields');
    expect(result.output.doc.abstentions?.join('\n')).toMatch(/HUMAN CONFIRM/);
    expect(result.output.doc.medications.find((m) => m.name === 'Pantoprazole')?.dose).toBe('20 mg');
    expect(result.output.doc.medications.find((m) => m.name === 'Pantoprazole')?.confidence).toBe(0.58);
  });
});
