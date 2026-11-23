// SPDX-License-Identifier: Apache-2.0
/**
 * S1: every cloud stage (cloud-verify, cloud-structure, per-field snippets)
 * receives only de-identified text, after core deidentify + assertSafeForCloud.
 */
import { assertSafeForCloud, DEFAULT_THRESHOLDS, type ClinicalDoc, type Stage, type StageContext } from '@med-ocr/core';
import { describe, expect, it } from 'vitest';
import { setCloudReachableForTests } from './cloud-call';
import { executeHybridVerify, gatedFieldPayload } from './hybrid-verify-logic';
import { mockPipelines } from './mock';
import { STRUCTURE_PROMPT, pipelines } from './stages';

function isTextCloudStage(stage: Stage): boolean {
  return (stage.meta?.runtime === 'cloud' || stage.meta?.sendsDataOffDevice === true) && stage.id !== 'cloud-read';
}

const PII_SOURCE = `CITY CARE CLINIC, Indiranagar
Patient: Rajesh Kumar   DOB: 14/03/1987
Mob: +91 98765 43210
2. Tab. Telmisartan 40mg OD after food
HbA1c 7.8 %
Report Date: 20/11/2026`;

describe('S1: every cloud stage input passed de-identification', () => {
  it('every text cloud stage in live and mock pipelines is preceded by a deid stage', () => {
    for (const p of [...pipelines(DEFAULT_THRESHOLDS), ...mockPipelines(DEFAULT_THRESHOLDS)]) {
      const ids = p.stages.map((s) => s.id);
      for (let i = 0; i < p.stages.length; i++) {
        const stage = p.stages[i]!;
        if (!isTextCloudStage(stage)) continue;
        const priorDeid = p.stages.slice(0, i).some((s) => s.kind === 'deid');
        expect(priorDeid, `${p.id}: ${stage.id} has no prior deid stage (${ids.join(' → ')})`).toBe(true);
      }
    }
  });

  it('per-field snippets are de-identified, carry [DOB]/[DATE] tokens, and pass assertSafeForCloud', () => {
    const payload = gatedFieldPayload(PII_SOURCE, 'Telmisartan');
    expect(payload.text).toContain('[DOB]');
    expect(payload.text).toContain('[DATE]');
    expect(payload.text).toContain('Telmisartan');
    expect(payload.text).not.toContain('14/03/1987');
    expect(payload.text).not.toContain('20/11/2026');
    expect(payload.text).not.toContain('Rajesh Kumar');
    expect(payload.text).not.toContain('98765 43210');
    expect(() => assertSafeForCloud(payload.text)).not.toThrow();
  });

  it('cloud-verify generate() receives only the gated, de-identified snippet', async () => {
    setCloudReachableForTests(true);
    const doc: ClinicalDoc = {
      documentType: 'prescription',
      medications: [{ name: 'Telmisartan', strength: '40mg', confidence: 0.55, sourceText: 'Tab. Telmisartan 40mg OD after food' }],
      labResults: [],
      abstentions: [],
    };
    const prompts: string[] = [];
    const ctx: StageContext = { runId: 's1-deid', docId: 's1-deid' };
    await executeHybridVerify(
      { kind: 'fields', doc, text: PII_SOURCE },
      ctx,
      {
        stageId: 'cloud-verify',
        structurePrompt: STRUCTURE_PROMPT,
        thresholds: DEFAULT_THRESHOLDS,
        costOf: () => 0,
        generate: async (prompt) => {
          prompts.push(prompt);
          return { text: JSON.stringify({ documentType: 'prescription', medications: [doc.medications[0]], labResults: [], abstentions: [] }) };
        },
      },
    );
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    for (const prompt of prompts) {
      expect(prompt).toContain('[DOB]');
      expect(prompt).toContain('[DATE]');
      expect(prompt).not.toContain('14/03/1987');
      expect(prompt).not.toContain('20/11/2026');
      expect(prompt).not.toContain('Rajesh Kumar');
      expect(prompt).not.toContain('98765 43210');
      expect(() => assertSafeForCloud(prompt)).not.toThrow();
    }
  });
});
