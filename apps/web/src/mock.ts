// SPDX-License-Identifier: Apache-2.0
/**
 * Offline mock stages that implement the same core Stage contract as the
 * live Firebase pipelines, so the demo, review queue, receipt, and
 * comparison screen all run without Nano or a Firebase project.
 */
import {
  utf8Bytes,
  type ClinicalDoc,
  type Pipeline,
  type Reference,
  type RoutingThresholds,
  type Stage,
  type StageData,
  type StageResult,
} from '@med-ocr/core';
import { estimateCloudUsd } from './accounting';
import {
  CLOUD_TIMEOUT_MS,
  INVALID_JSON_STATUS,
  OFFLINE_STATUS,
  TIMEOUT_STATUS,
  cloudAbortSignal,
  flagFieldsForHumanConfirm,
  isCloudReachable,
  isNetworkFailure,
  isTimeoutOrAbort,
  readCloudJsonWithRetry,
  readRequestBytes,
  structureRequestBytes,
} from './cloud-call';
import { tryAssertSafeForCloud } from './cloud-guard';
import { executeHybridVerify } from './hybrid-verify-logic';
import { CLOUD_MODEL } from './firebase';
import {
  CLOUD_BASELINE_LABEL,
  CLOUD_BASELINE_PIPELINE_ID,
  IMAGE_EGRESS_NOTE_PREFIX,
  META_CLOUD_EGRESS,
  META_NO_EGRESS,
  READ_PROMPT,
  STRUCTURE_PROMPT,
  deidStage,
} from './stages';

export const SAMPLE_TRANSCRIPT = `Sunrise Diagnostics
Patient: Anita Rao  Age: 42  Sex: F
Collection date: 2026-03-12  Sample ID: LAB-88421
Physician: Dr. Mehta

Rx
1. Amoxicillin 500 mg  1-0-1  5 days
2. Pantoprazole 40 mg  1-0-0  14 days

Labs
Hemoglobin  13.2 g/dL  (12.0-15.0)
WBC         8.1 x10^3/uL
Platelet count  242 x10^3/uL
`;

/** De-identified / PHI-free transcript so assertSafeForCloud lets the mock cloud path run. */
export const CLEAN_CLOUD_TRANSCRIPT = `Rx
1. Amoxicillin 500 mg  1-0-1  5 days
2. Pantoprazole 40 mg  1-0-0  14 days

Labs
Hemoglobin  13.2 g/dL  (12.0-15.0)
WBC         8.1 x10^3/uL
Platelet count  242 x10^3/uL
`;

export const SAMPLE_REFERENCE_DOC: ClinicalDoc = {
  documentType: 'lab_report',
  medications: [
    { name: 'Amoxicillin', strength: '500 mg', dose: '500 mg', frequency: '1-0-1', duration: '5 days', confidence: 1 },
    { name: 'Pantoprazole', strength: '40 mg', dose: '40 mg', frequency: '1-0-0', duration: '14 days', confidence: 1 },
  ],
  labResults: [
    { test: 'Hemoglobin', value: '13.2', unit: 'g/dL', referenceRange: '12.0-15.0', flag: 'normal', confidence: 1 },
    { test: 'WBC', value: '8.1', unit: 'x10^3/uL', confidence: 1 },
    { test: 'Platelet count', value: '242', unit: 'x10^3/uL', confidence: 1 },
  ],
};

export const SAMPLE_REFERENCE: Reference = {
  docId: 'sample-lab-1',
  text: SAMPLE_TRANSCRIPT,
  doc: SAMPLE_REFERENCE_DOC,
};

export const ON_DEVICE_DOC: ClinicalDoc = {
  documentType: 'lab_report',
  medications: [
    {
      name: 'Amoxicillin', strength: '500 mg', dose: '500 mg', frequency: '1-0-1', duration: '5 days',
      confidence: 0.96,
      bbox: { x: 0.08, y: 0.36, w: 0.7, h: 0.08 },
    },
    {
      name: 'Pantoprazole', strength: '40 mg', dose: '20 mg', frequency: '1-0-0', duration: '14 days',
      confidence: 0.58,
      bbox: { x: 0.08, y: 0.44, w: 0.7, h: 0.08 },
    },
  ],
  labResults: [
    { test: 'Hemoglobin', value: '13.8', unit: 'g/dL', referenceRange: '12.0-15.0', flag: 'normal', confidence: 0.62, bbox: { x: 0.08, y: 0.58, w: 0.7, h: 0.07 } },
    { test: 'WBC', value: '8.1', unit: 'x10^3/uL', confidence: 0.93, bbox: { x: 0.08, y: 0.66, w: 0.7, h: 0.07 } },
    { test: 'Platelet count', value: '242', unit: 'x10^3/uL', confidence: 0.9, bbox: { x: 0.08, y: 0.74, w: 0.7, h: 0.07 } },
  ],
  abstentions: [],
};

export const CLOUD_DOC: ClinicalDoc = {
  documentType: 'lab_report',
  medications: [
    { name: 'Amoxicillin', strength: '500 mg', dose: '500 mg', frequency: '1-0-1', duration: '5 days', confidence: 0.98 },
    { name: 'Pantoprazole', strength: '40 mg', dose: '40 mg', frequency: '1-0-0', duration: '14 days', confidence: 0.94 },
  ],
  labResults: [
    { test: 'Hemoglobin', value: '13.2', unit: 'g/dL', referenceRange: '12.0-15.0', flag: 'normal', confidence: 0.95 },
    { test: 'WBC', value: '8.1', unit: 'x10^3/uL', confidence: 0.97 },
    { test: 'Platelet count', value: '242', unit: 'x10^3/uL', confidence: 0.96 },
  ],
  abstentions: [],
};

const ON_DEVICE_TRANSCRIPT = SAMPLE_TRANSCRIPT
  .replace('Hemoglobin  13.2', 'Hemoglobin  13.8')
  .replace('Pantoprazole 40 mg', 'Pantoprazole 20 mg');

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

function tokensFrom(text: string): number {
  return Math.max(1, Math.ceil(utf8Bytes(text) / 4));
}

export type MockCloudBehavior = 'ok' | 'invalid-json' | 'invalid-json-once' | 'timeout' | 'fetch-error' | 'hang';

let mockBehavior: MockCloudBehavior = 'ok';
let mockTimeoutMs = CLOUD_TIMEOUT_MS;
export let mockCloudGenerateCalls = 0;

export function setMockCloudBehavior(next: MockCloudBehavior = 'ok', opts?: { timeoutMs?: number }): void {
  mockBehavior = next;
  mockCloudGenerateCalls = 0;
  mockTimeoutMs = opts?.timeoutMs ?? CLOUD_TIMEOUT_MS;
}

async function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

async function mockGenerateCloudText(_prompt: string, signal: AbortSignal): Promise<string> {
  mockCloudGenerateCalls += 1;
  if (mockBehavior === 'hang' || mockBehavior === 'timeout') await waitForAbort(signal);
  if (mockBehavior === 'fetch-error') throw new TypeError('Failed to fetch');
  if (mockBehavior === 'invalid-json') return 'Sorry, I cannot help with that.';
  if (mockBehavior === 'invalid-json-once' && mockCloudGenerateCalls === 1) return 'Sorry, I cannot help with that.';
  return JSON.stringify(CLOUD_DOC);
}

function onDeviceFallback(reason: string, status: string, input: Extract<StageData, { kind: 'text' | 'fields' }>): StageResult {
  const source = 'text' in input && input.kind === 'text' ? input.text : (input.kind === 'fields' ? (input.text ?? '') : '');
  const base = input.kind === 'fields' ? structuredClone(input.doc) : structuredClone(ON_DEVICE_DOC);
  const doc = flagFieldsForHumanConfirm(base, reason, source);
  return {
    stageId: '',
    stageKind: input.kind === 'fields' ? 'verify' : 'structure',
    site: 'on_device',
    output: { kind: 'fields', doc, text: input.kind === 'text' ? input.text : input.text, image: input.image },
    notes: [reason, `status:${status}`],
    metrics: { latencyMs: 0, costUsd: 0, bytesSent: 0 },
  };
}

export const mockNanoRead: Stage = {
  id: 'mock-nano-read',
  name: 'Mock Nano read (on-device)',
  kind: 'ocr',
  accepts: ['image'],
  meta: META_NO_EGRESS,
  async run(input): Promise<StageResult> {
    if (input.kind !== 'image') throw new Error('image required');
    await delay();
    return {
      stageId: this.id, stageKind: 'ocr', site: 'on_device',
      output: { kind: 'text', text: ON_DEVICE_TRANSCRIPT, image: input.image },
      raw: ON_DEVICE_TRANSCRIPT,
      metrics: { latencyMs: 0, costUsd: 0, bytesSent: 0 },
    };
  },
};

export const mockNanoStructure: Stage = {
  id: 'mock-nano-structure',
  name: 'Mock Nano structure (on-device)',
  kind: 'structure',
  accepts: ['text'],
  meta: META_NO_EGRESS,
  async run(input): Promise<StageResult> {
    if (input.kind !== 'text') throw new Error('text required');
    await delay();
    const raw = JSON.stringify(ON_DEVICE_DOC);
    return {
      stageId: this.id, stageKind: 'structure', site: 'on_device',
      output: { kind: 'fields', doc: structuredClone(ON_DEVICE_DOC), text: input.text, image: input.image },
      raw,
      metrics: { latencyMs: 0, costUsd: 0, bytesSent: 0 },
    };
  },
};

export const mockCloudRead: Stage = {
  id: 'cloud-read',
  name: `Mock ${CLOUD_MODEL} read (sends the page image)`,
  kind: 'ocr',
  accepts: ['image'],
  meta: META_CLOUD_EGRESS,
  async run(input, ctx): Promise<StageResult> {
    if (input.kind !== 'image') throw new Error('image required');
    await delay();
    const imageBytes = input.image.base64.length;
    if (!isCloudReachable()) {
      return {
        stageId: this.id, stageKind: 'ocr', site: 'local_code', output: input,
        error: 'Offline: Failed to fetch',
        notes: ['status:offline'],
        metrics: { latencyMs: 0, costUsd: 0, bytesSent: 0 },
      };
    }
    const bytesSent = readRequestBytes(READ_PROMPT, input.image.base64, input.image.mimeType);
    const signal = cloudAbortSignal(ctx.signal, mockTimeoutMs);
    try {
      if (mockBehavior === 'hang' || mockBehavior === 'timeout') await waitForAbort(signal);
      if (mockBehavior === 'fetch-error') throw new TypeError('Failed to fetch');
      const inputTokens = tokensFrom(READ_PROMPT) + 258;
      const outputTokens = tokensFrom(SAMPLE_TRANSCRIPT);
      return {
        stageId: this.id, stageKind: 'ocr', site: 'in_cloud',
        output: { kind: 'text', text: SAMPLE_TRANSCRIPT, image: input.image },
        raw: SAMPLE_TRANSCRIPT,
        notes: [
          `${IMAGE_EGRESS_NOTE_PREFIX}${imageBytes}`,
          `Full page image left the device (${imageBytes} bytes in the request payload, plus the prompt).`,
        ],
        metrics: {
          latencyMs: 0, costUsd: estimateCloudUsd(inputTokens, outputTokens), bytesSent,
          inputTokens, outputTokens,
        },
      };
    } catch (err) {
      const error = isTimeoutOrAbort(err)
        ? 'Cloud timed out or was cancelled'
        : isNetworkFailure(err)
          ? 'Offline: Failed to fetch'
          : err instanceof Error ? err.message : String(err);
      return {
        stageId: this.id, stageKind: 'ocr', site: 'local_code', output: input,
        error, notes: [`status:${isTimeoutOrAbort(err) ? 'timeout' : 'offline'}`],
        metrics: { latencyMs: 0, costUsd: 0, bytesSent: 0 },
      };
    }
  },
};

export const mockCloudStructure: Stage = {
  id: 'mock-cloud-structure',
  name: `Mock ${CLOUD_MODEL} structure (simulated cloud)`,
  kind: 'structure',
  accepts: ['text'],
  meta: META_CLOUD_EGRESS,
  async run(input, ctx): Promise<StageResult> {
    if (input.kind !== 'text') throw new Error('text required');
    await delay();
    const prompt = STRUCTURE_PROMPT + input.text;
    if (!isCloudReachable()) {
      const fallback = onDeviceFallback(OFFLINE_STATUS, 'offline', input);
      return { ...fallback, stageId: this.id };
    }
    const guard = tryAssertSafeForCloud(prompt);
    if (!guard.ok) {
      const fallback = onDeviceFallback(guard.message, 'blocked', input);
      return { ...fallback, stageId: this.id };
    }
    const signal = cloudAbortSignal(ctx.signal, mockTimeoutMs);
    let bytesSent = 0;
    try {
      const { doc, raw, retried } = await readCloudJsonWithRetry(async (p) => {
        bytesSent += structureRequestBytes(p);
        return mockGenerateCloudText(p, signal);
      }, prompt);
      if (!doc) {
        const fallback = onDeviceFallback(INVALID_JSON_STATUS, 'invalid-json', input);
        return { ...fallback, stageId: this.id, metrics: { ...fallback.metrics!, bytesSent } };
      }
      const inputTokens = tokensFrom(prompt);
      const outputTokens = tokensFrom(raw);
      return {
        stageId: this.id, stageKind: 'structure', site: 'in_cloud',
        output: { kind: 'fields', doc, text: input.text, image: input.image },
        raw,
        notes: [
          'Sent de-identified transcript only; no image.',
          ...(retried ? ['Retried once after a non-JSON cloud reply.'] : []),
        ],
        metrics: {
          latencyMs: 0, costUsd: estimateCloudUsd(inputTokens, outputTokens), bytesSent,
          inputTokens, outputTokens,
        },
      };
    } catch (err) {
      if (isTimeoutOrAbort(err) || isNetworkFailure(err)) {
        const reason = isTimeoutOrAbort(err) ? TIMEOUT_STATUS : OFFLINE_STATUS;
        const status = isTimeoutOrAbort(err) ? 'timeout' : 'offline';
        const fallback = onDeviceFallback(reason, status, input);
        return { ...fallback, stageId: this.id };
      }
      throw err;
    }
  },
};

export function mockHybridVerify(thresholds: RoutingThresholds): Stage {
  return {
    id: 'mock-cloud-verify',
    name: 'Mock cloud verify (de-identified snippets, mid-confidence only)',
    kind: 'verify',
    accepts: ['fields'],
    meta: META_CLOUD_EGRESS,
    async run(input: StageData, ctx): Promise<StageResult> {
      return executeHybridVerify(input, ctx, {
        stageId: this.id,
        structurePrompt: STRUCTURE_PROMPT,
        thresholds,
        timeoutMs: mockTimeoutMs,
        costOf: ({ inputTokens, outputTokens }) => estimateCloudUsd(inputTokens, outputTokens),
        generate: async (prompt, signal) => ({ text: await mockGenerateCloudText(prompt, signal) }),
      });
    },
  };
}

export function mockPipelines(thresholds: RoutingThresholds): Pipeline[] {
  return [
    { id: 'on-device-only', name: 'On-device only (mock Nano)', stages: [mockNanoRead, mockNanoStructure] },
    { id: CLOUD_BASELINE_PIPELINE_ID, name: CLOUD_BASELINE_LABEL, stages: [mockCloudRead, deidStage, mockCloudStructure] },
    { id: 'hybrid', name: 'Hybrid (mock Nano read + on-device extract; cloud only for mid-confidence fields)', stages: [mockNanoRead, mockNanoStructure, deidStage, mockHybridVerify(thresholds)] },
  ];
}
