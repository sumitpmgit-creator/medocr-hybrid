// SPDX-License-Identifier: Apache-2.0
/**
 * Sage's EgressSpy (qa/src/egress.ts) counts UTF-8 bytes of the fetch body only.
 * The QA firebase-ai mock serializes
 *   { model, contents: [{ role: 'user', parts }], generationConfig }
 * and POSTs it with headers { 'content-type': 'application/json' }.
 * We count that same serialized body plus the request headers, so the
 * receipt and comparison number stays within 10% of the spy (DEID-E2E-07)
 * while including header bytes the parent asked for.
 */
import { DEFAULT_THRESHOLDS, runPipeline, type StageContext } from '@med-ocr/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLOUD_REQUEST_HEADERS,
  CLOUD_STRUCTURE_GENERATION_CONFIG,
  cloudRequestBytes,
  headerBytes,
  serializeCloudGenerateBody,
  setCloudReachableForTests,
  structureRequestBytes,
  utf8ByteLength,
} from './cloud-call';
import { CLOUD_MODEL } from './firebase';
import {
  CLEAN_CLOUD_TRANSCRIPT,
  mockCloudStructure,
  setMockCloudBehavior,
} from './mock';
import { buildPrivacyReceipt } from './receipt';
import { deidStage, STRUCTURE_PROMPT } from './stages';

const ctx: StageContext = { runId: 'bug-012', docId: 'deid-e2e-07' };
const cleanText = { kind: 'text' as const, text: CLEAN_CLOUD_TRANSCRIPT };

afterEach(() => {
  setMockCloudBehavior('ok');
  setCloudReachableForTests(undefined);
});

/** Body-only spy, matching EgressSpy.totalBytes / bodyToString for a string body. */
function spyBodyBytes(body: string): number {
  return Buffer.byteLength(body, 'utf8');
}

describe('BUG-012: bytes sent from the serialized request body plus headers', () => {
  it('matches Sage’s fetch-spy body serialization, plus request header bytes', () => {
    const prompt = STRUCTURE_PROMPT + 'Hemoglobin 13.2 g/dL\nAmoxicillin 500 mg';
    const parts = [{ text: prompt }];
    const body = serializeCloudGenerateBody(CLOUD_MODEL, parts, CLOUD_STRUCTURE_GENERATION_CONFIG);
    const parsed = JSON.parse(body) as { model: string; contents: unknown; generationConfig: unknown };
    expect(parsed.model).toBe(CLOUD_MODEL);
    expect(parsed.contents).toEqual([{ role: 'user', parts }]);
    expect(parsed.generationConfig).toEqual(CLOUD_STRUCTURE_GENERATION_CONFIG);
    expect(body).toContain('responseJsonSchema');
    expect(body).toContain('responseMimeType');

    const spyBytes = spyBodyBytes(body);
    const headers = headerBytes(CLOUD_REQUEST_HEADERS);
    expect(headers).toBe(utf8ByteLength('content-type: application/json\r\n'));
    expect(cloudRequestBytes(body)).toBe(spyBytes + headers);
    expect(structureRequestBytes(prompt)).toBe(spyBytes + headers);

    // DEID-E2E-07: self-reported figure within 10% of the spy’s body-only total.
    const reported = cloudRequestBytes(body);
    const ratio = reported / spyBytes;
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    expect(ratio).toBeLessThanOrEqual(1.1);
    // And strictly larger than the old utf8Bytes(prompt)-only undercount.
    expect(reported).toBeGreaterThan(utf8ByteLength(prompt));
  });

  it('uses that number on the structure step, the receipt, and comparison-style totals', async () => {
    const result = await mockCloudStructure.run(cleanText, ctx);
    expect(result.error).toBeUndefined();
    expect(result.site).toBe('in_cloud');
    expect(result.metrics.bytesSent).toBeGreaterThan(0);

    const expected = structureRequestBytes(STRUCTURE_PROMPT + CLEAN_CLOUD_TRANSCRIPT);
    expect(result.metrics.bytesSent).toBe(expected);

    const run = await runPipeline(
      { id: 'hybrid', name: 'structure only', stages: [deidStage, mockCloudStructure] },
      cleanText,
      { docId: 'deid-e2e-07' },
    );
    expect(run.failed).toBe(false);
    expect(run.totals.bytesSent).toBe(expected);
    const receipt = buildPrivacyReceipt(run);
    expect(receipt.totalBytesSent).toBe(expected);
    expect(receipt.leftDevice.some((item) => item.bytes === expected)).toBe(true);

    const spyBytes = spyBodyBytes(
      serializeCloudGenerateBody(
        CLOUD_MODEL,
        [{ text: STRUCTURE_PROMPT + CLEAN_CLOUD_TRANSCRIPT }],
        CLOUD_STRUCTURE_GENERATION_CONFIG,
      ),
    );
    expect(Math.abs(receipt.totalBytesSent - spyBytes) / spyBytes).toBeLessThanOrEqual(0.1);
  });
});
