// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_THRESHOLDS, type ClinicalDoc, type StageContext } from '@med-ocr/core';
import { afterEach, describe, expect, it } from 'vitest';
import { setCloudReachableForTests } from './cloud-call';
import { FIELDS_SENT_TO_CLOUD_PREFIX } from './hybrid-verify-logic';
import { mockCloudGenerateCalls, mockHybridVerify, setMockCloudBehavior } from './mock';
import { buildPrivacyReceipt } from './receipt';

const ctx: StageContext = { runId: 'bug-026', docId: 'bug-026' };
const source = 'Amoxicillin 500 mg 1-0-1 5 days\nPantoprazole 40 mg 1-0-0 14 days\nHemoglobin 13.2 g/dL\nCRP 4.1 mg/L';

afterEach(() => {
  setMockCloudBehavior('ok');
  setCloudReachableForTests(undefined);
});

function doc(partial: Partial<ClinicalDoc> & Pick<ClinicalDoc, 'medications' | 'labResults'>): ClinicalDoc {
  return { documentType: 'lab_report', abstentions: [], ...partial };
}

describe('BUG-026: hybrid sends only mid-confidence field snippets', () => {
  it('makes zero cloud calls and zero bytes when every field is >= 0.85', async () => {
    const high = doc({
      medications: [{ name: 'Amoxicillin', strength: '500 mg', confidence: 0.97 }],
      labResults: [{ test: 'Hemoglobin', value: '13.2', unit: 'g/dL', confidence: 0.96 }],
    });
    const result = await mockHybridVerify(DEFAULT_THRESHOLDS).run({ kind: 'fields', doc: high, text: source }, ctx);
    expect(mockCloudGenerateCalls).toBe(0);
    expect(result.metrics.bytesSent).toBe(0);
    expect(result.site).toBe('local_code');
    expect(result.notes?.join('\n')).toContain(`${FIELDS_SENT_TO_CLOUD_PREFIX}0`);
    const receipt = buildPrivacyReceipt({
      runId: 'bug-026', pipelineId: 'hybrid', docId: 'bug-026', startedAt: new Date().toISOString(),
      steps: [result], final: result.output, totals: result.metrics, failed: false,
    });
    expect(receipt.fieldsSentToCloud).toBe(0);
    expect(receipt.totalBytesSent).toBe(0);
  });

  it('sends only mid-band fields (0.5–0.85) as de-identified snippets', async () => {
    const mixed = doc({
      medications: [
        { name: 'Amoxicillin', strength: '500 mg', confidence: 0.97 },
        { name: 'Pantoprazole', strength: '40 mg', dose: '20 mg', confidence: 0.58 },
      ],
      labResults: [{ test: 'Hemoglobin', value: '13.2', unit: 'g/dL', confidence: 0.96 }],
    });
    const result = await mockHybridVerify(DEFAULT_THRESHOLDS).run({ kind: 'fields', doc: mixed, text: source }, ctx);
    expect(mockCloudGenerateCalls).toBeGreaterThanOrEqual(1);
    expect(result.metrics.bytesSent).toBeGreaterThan(0);
    expect(result.notes?.join('\n')).toContain(`${FIELDS_SENT_TO_CLOUD_PREFIX}1`);
    expect(result.notes?.join('\n')).toMatch(/Pantoprazole/);
    expect(result.notes?.join('\n')).not.toMatch(/snippet for "Amoxicillin"/);
    if (result.output.kind !== 'fields') throw new Error('expected fields');
    expect(result.output.doc.medications.find((m) => m.name === 'Amoxicillin')?.confidence).toBe(0.97);
    const receipt = buildPrivacyReceipt({
      runId: 'bug-026', pipelineId: 'hybrid', docId: 'bug-026', startedAt: new Date().toISOString(),
      steps: [result], final: result.output, totals: result.metrics, failed: false,
    });
    expect(receipt.fieldsSentToCloud).toBe(1);
  });

  it('sends fields below 0.5 to human confirm and does not call the cloud for them', async () => {
    const low = doc({
      medications: [{ name: 'Amoxicillin', strength: '500 mg', confidence: 0.97 }],
      labResults: [{ test: 'CRP', value: '4.1', unit: 'mg/L', confidence: 0.32 }],
    });
    const result = await mockHybridVerify(DEFAULT_THRESHOLDS).run({ kind: 'fields', doc: low, text: source }, ctx);
    expect(mockCloudGenerateCalls).toBe(0);
    expect(result.metrics.bytesSent).toBe(0);
    expect(result.notes?.join('\n')).toContain(`${FIELDS_SENT_TO_CLOUD_PREFIX}0`);
    if (result.output.kind !== 'fields') throw new Error('expected fields');
    expect(result.output.doc.abstentions?.join('\n')).toMatch(/HUMAN CONFIRM lab "CRP"/);
    expect(result.output.doc.labResults.find((l) => l.test === 'CRP')?.value).toBe('4.1');
  });
});
