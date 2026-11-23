// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_THRESHOLDS, runPipeline, type ImagePayload } from '@med-ocr/core';
import { describe, expect, it } from 'vitest';
import { mockPipelines } from './mock';
import { buildPrivacyReceipt } from './receipt';
import {
  CLOUD_BASELINE_LABEL,
  CLOUD_BASELINE_PIPELINE_ID,
  isCloudBaselineEnabled,
  pipelines,
  cloudSafetyForPipeline,
  pipelinesForUi,
} from './stages';

const image: ImagePayload = { mimeType: 'image/png', base64: 'AAAAimagepayloadZZ==' };

describe('CONTRACT.md stage names', () => {
  it('names the baseline cloud-read → deid → cloud-structure', () => {
    const cloud = pipelines(DEFAULT_THRESHOLDS).find((p) => p.id === 'cloud-only');
    expect(cloud?.id).toBe(CLOUD_BASELINE_PIPELINE_ID);
    expect(cloud?.name).toBe('Cloud baseline (sends the image)');
    expect(cloud?.name).toBe(CLOUD_BASELINE_LABEL);
    expect(cloud?.stages.map((s) => s.id)).toEqual(['cloud-read', 'deid', 'cloud-structure']);
  });

  it('uses nano-read → nano-structure → cloud-verify for the default hybrid chain', () => {
    const hybrid = pipelines(DEFAULT_THRESHOLDS).find((p) => p.id === 'hybrid');
    expect(hybrid?.stages.map((s) => s.id)).toEqual(['nano-read', 'nano-structure', 'deid', 'cloud-verify']);
  });

  it('keeps on-device-only as nano-read → nano-structure', () => {
    const device = pipelines(DEFAULT_THRESHOLDS).find((p) => p.id === 'on-device-only');
    expect(device?.stages.map((s) => s.id)).toEqual(['nano-read', 'nano-structure']);
  });
});

describe('cloud baseline default', () => {
  it('BUG-025: upload sources never include cloud-only by default; it is on for public benchmark comparison', () => {
    expect(isCloudBaselineEnabled({ source: 'upload' })).toBe(false);
    expect(isCloudBaselineEnabled({ source: 'upload', userEnabled: false })).toBe(false);
    expect(isCloudBaselineEnabled({ source: 'upload', userEnabled: true })).toBe(true);
    expect(isCloudBaselineEnabled({ source: 'benchmark' })).toBe(true);
    expect(isCloudBaselineEnabled({ source: 'benchmark', userEnabled: false })).toBe(true);

    const uploadDefault = pipelinesForUi(DEFAULT_THRESHOLDS, { source: 'upload' }).map((p) => p.id);
    expect(uploadDefault).toEqual(['on-device-only', 'hybrid']);
    expect(uploadDefault).not.toContain('cloud-only');

    const uploadOn = pipelinesForUi(DEFAULT_THRESHOLDS, { source: 'upload', userEnabled: true }).map((p) => p.id);
    expect(uploadOn).toContain('cloud-only');

    const bench = pipelinesForUi(DEFAULT_THRESHOLDS, { source: 'benchmark' }).map((p) => p.id);
    expect(bench).toEqual(['on-device-only', 'cloud-only', 'hybrid']);
  });
});

describe('cloud baseline privacy receipt', () => {
  it('records that the full image left the device, with its byte count', async () => {
    const baseline = mockPipelines(DEFAULT_THRESHOLDS).find((p) => p.id === 'cloud-only');
    expect(baseline).toBeDefined();
    const run = await runPipeline(baseline!, { kind: 'image', image }, { docId: 'upload', cloudSafety: cloudSafetyForPipeline(baseline!) });
    expect(run.steps[0]?.stageId).toBe('cloud-read');
    const receipt = buildPrivacyReceipt(run, { now: () => new Date('2026-11-23T09:45:00+05:30') });
    expect(receipt.imagesStayLocal).toBe(false);
    expect(receipt.imageBytesSent).toBe(image.base64.length);
    const egress = receipt.leftDevice.find((item) => item.kind === 'page-image');
    expect(egress?.stageId).toBe('cloud-read');
    expect(egress?.bytes).toBe(image.base64.length);
    expect(egress?.detail).toMatch(/Full page image left the device/);
    expect(egress?.detail).toContain(String(image.base64.length));
    expect(receipt.totalBytesSent).toBeGreaterThanOrEqual(image.base64.length);
  });

  it('does not record image egress for the default hybrid chain', async () => {
    const hybrid = mockPipelines(DEFAULT_THRESHOLDS).find((p) => p.id === 'hybrid');
    const run = await runPipeline(hybrid!, { kind: 'image', image }, { docId: 'upload' });
    const receipt = buildPrivacyReceipt(run);
    expect(receipt.leftDevice.some((item) => item.kind === 'page-image')).toBe(false);
    expect(receipt.imagesStayLocal).toBe(true);
    expect(receipt.imageBytesSent).toBe(0);
    expect(run.steps.map((s) => s.stageId)).toEqual(['mock-nano-read', 'mock-nano-structure', 'deid', 'mock-cloud-verify']);
  });
});
