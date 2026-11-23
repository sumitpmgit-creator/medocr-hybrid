// SPDX-License-Identifier: Apache-2.0
import { type StageContext } from '@med-ocr/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  INVALID_JSON_STATUS,
  STRICT_JSON_INSTRUCTION,
  parseCloudJson,
  readCloudJsonWithRetry,
  setCloudReachableForTests,
} from './cloud-call';
import {
  CLEAN_CLOUD_TRANSCRIPT,
  CLOUD_DOC,
  mockCloudGenerateCalls,
  mockCloudStructure,
  setMockCloudBehavior,
} from './mock';

const ctx: StageContext = { runId: 'bug-008', docId: 'bug-008' };
const cleanText = { kind: 'text' as const, text: CLEAN_CLOUD_TRANSCRIPT };

afterEach(() => {
  setMockCloudBehavior('ok');
  setCloudReachableForTests(undefined);
});

describe('BUG-008: invalid cloud JSON retries once, then human review', () => {
  it('does not crash when the reply is not JSON, and returns null instead', () => {
    expect(parseCloudJson('Sorry, I cannot help with that.')).toBeNull();
    expect(parseCloudJson('```json\n{"documentType":"other","medications":[],"labResults":[]}\n```')?.documentType).toBe('other');
  });

  it('retries once with a stricter JSON instruction, then succeeds', async () => {
    const calls: string[] = [];
    const { doc, retried } = await readCloudJsonWithRetry(async (prompt) => {
      calls.push(prompt);
      if (calls.length === 1) return 'Sorry, I cannot help with that.';
      return JSON.stringify(CLOUD_DOC);
    }, 'PROMPT');
    expect(retried).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain(STRICT_JSON_INSTRUCTION);
    expect(doc?.medications[0]?.name).toBe('Amoxicillin');
  });

  it('retries once in the hybrid structure stage and keeps the result successful', async () => {
    setMockCloudBehavior('invalid-json-once');
    const result = await mockCloudStructure.run(cleanText, ctx);
    expect(result.error).toBeUndefined();
    expect(mockCloudGenerateCalls).toBe(2);
    expect(result.site).toBe('in_cloud');
    expect(result.notes?.join('\n')).toMatch(/Retried once/);
    if (result.output.kind !== 'fields') throw new Error('expected fields');
    expect(result.output.doc.medications.find((m) => m.name === 'Pantoprazole')?.dose).toBe('40 mg');
  });

  it('sends the field to human review and does not crash if the retry is also invalid', async () => {
    setMockCloudBehavior('invalid-json');
    const result = await mockCloudStructure.run(cleanText, ctx);
    expect(result.error).toBeUndefined();
    expect(mockCloudGenerateCalls).toBe(2);
    expect(result.site).toBe('on_device');
    expect(result.notes?.join('\n')).toContain(INVALID_JSON_STATUS);
    expect(result.notes?.join('\n')).toContain('status:invalid-json');
    if (result.output.kind !== 'fields') throw new Error('expected fields');
    expect(result.output.doc.medications.find((m) => m.name === 'Pantoprazole')?.dose).toBe('20 mg');
    expect(result.output.doc.abstentions?.join('\n')).toMatch(/HUMAN CONFIRM/);
  });
});
