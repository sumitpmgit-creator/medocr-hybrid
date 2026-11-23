// BUG-010 (qa/BUG_LOG.md, SCORE-26/27): matching must be order-independent for repeated names.
import { describe, expect, it } from 'vitest';
import { scoreFields, type ClinicalDoc } from '../src/index.js';

describe('BUG-010: optimal (Hungarian) alignment for duplicate names', () => {
  it('reordered CBC rows with the same test name score F1 = 1 and pass the safety screen', () => {
    const ref: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: [
      { test: 'Neutrophils', value: '60', unit: '%' },
      { test: 'Neutrophils', value: '3.6', unit: '10^3/uL' },
    ] };
    const pred: ClinicalDoc = { ...ref, labResults: [...ref.labResults].reverse() };
    const s = scoreFields(ref, pred);
    expect(s.f1).toBe(1);
    expect(s.passesSafetyScreen).toBe(true);
  });
  it('same drug at two strengths, reversed', () => {
    const ref: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [
      { name: 'Metformin', strength: '500 mg', frequency: '1-0-1' },
      { name: 'Metformin', strength: '1000 mg', frequency: '0-0-1' },
    ] };
    const s = scoreFields(ref, { ...ref, medications: [...ref.medications].reverse() });
    expect(s.f1).toBe(1);
    expect(s.passesSafetyScreen).toBe(true);
  });
  it('alignment is independent of prediction order for every permutation of three rows', () => {
    const rows = [
      { test: 'Hb', value: '12.5', unit: 'g/dL' },
      { test: 'Hb', value: '7.8', unit: 'mmol/L' },
      { test: 'WBC', value: '7200', unit: 'cells/cumm' },
    ];
    const ref: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: rows };
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const p of perms) {
      expect(scoreFields(ref, { ...ref, labResults: p.map((i) => rows[i]!) }).f1, p.join()).toBe(1);
    }
  });
});
