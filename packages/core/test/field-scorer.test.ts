import { describe, expect, it } from 'vitest';
import { scoreFields, normalizeFrequency, normalizeStrength, type ClinicalDoc } from '../src/index.js';

const ref: ClinicalDoc = {
  documentType: 'prescription',
  medications: [
    { name: 'Augmentin', strength: '625 mg', frequency: 'BD', duration: '5 days' },
    { name: 'Pan', strength: '40 mg', frequency: 'OD' },
  ],
  labResults: [],
};

describe('normalisers', () => {
  it('frequency abbreviations map to canonical patterns', () => {
    expect(normalizeFrequency('BD')).toBe('1-0-1');
    expect(normalizeFrequency('twice daily')).toBe('1-0-1');
    expect(normalizeFrequency('1 - 0 - 1')).toBe('1-0-1');
    expect(normalizeFrequency('T.D.S.')).toBe('1-1-1');
  });
  it('strength ignores spacing and unit spelling', () => {
    expect(normalizeStrength('625 mg')).toBe(normalizeStrength('625MG'));
    expect(normalizeStrength('5 mcg')).toBe(normalizeStrength('5µg'));
  });
});

describe('scoreFields', () => {
  it('perfect prediction with permitted normalisation', () => {
    const pred: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [
      { name: 'Tab. Augmentin', strength: '625MG', frequency: '1-0-1', duration: '5 days' },
      { name: 'PAN', strength: '40mg', frequency: 'once daily' },
    ] };
    const s = scoreFields(ref, pred);
    expect(s.f1).toBe(1);
    expect(s.passesSafetyScreen).toBe(true);
    expect(s.comparisons.some((c) => c.formattingOnly)).toBe(true);
  });
  it('one wrong frequency fails the safety screen even with high F1', () => {
    const pred: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [
      { name: 'Augmentin', strength: '625 mg', frequency: 'TDS', duration: '5 days' },
      { name: 'Pan', strength: '40 mg', frequency: 'OD' },
    ] };
    const s = scoreFields(ref, pred);
    expect(s.f1).toBeGreaterThan(0.8);
    expect(s.passesSafetyScreen).toBe(false);
    expect(s.comparisons.find((c) => c.outcome === 'wrong')?.field).toBe('frequency');
  });
  it('missing medication and invented medication', () => {
    const pred: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [
      { name: 'Augmentin', strength: '625 mg', frequency: 'BD', duration: '5 days' },
      { name: 'Crocin', strength: '500 mg' },
    ] };
    const s = scoreFields(ref, pred);
    expect(s.missingRequired).toBe(1);
    expect(s.unsupported).toBe(2);
    expect(s.recall).toBeLessThan(1);
    expect(s.precision).toBeLessThan(1);
  });
  it('labs: numeric value compare', () => {
    const r: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: [{ test: 'Haemoglobin', value: '12.50', unit: 'g/dL' }] };
    const p: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: [{ test: 'Haemoglobin', value: '12.5', unit: 'g/dl' }] };
    expect(scoreFields(r, p).f1).toBe(1);
    const p2: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: [{ test: 'Haemoglobin', value: '1.25', unit: 'g/dL' }] };
    expect(scoreFields(r, p2).passesSafetyScreen).toBe(false);
  });
});
