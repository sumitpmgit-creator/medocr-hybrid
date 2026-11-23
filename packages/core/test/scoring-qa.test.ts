// Scoring items from Sage's QA (via Advisory): symmetric similarity, calibration export,
// reference-range numbers + units.
import { describe, expect, it } from 'vitest';
import { similarity, calibrationReport, calibrationSamples, scoreFields, compareValues, type ClinicalDoc } from '../src/index.js';

describe('symmetric similarity', () => {
  const pairs: [string, string][] = [['Augmentin', 'Augmentin 625'], ['ab', 'abcdef'], ['Pan', 'Pantoprazole'], ['दवा', 'दव'], ['', 'x'], ['Dolo 650', 'dolo650']];
  it('sim(a, b) === sim(b, a)', () => {
    for (const [a, b] of pairs) expect(similarity(a, b), `${a}|${b}`).toBe(similarity(b, a));
  });
  it('bounded in [0, 1], identity is 1, case/whitespace-insensitive', () => {
    for (const [a, b] of pairs) { const s = similarity(a, b); expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(1); }
    expect(similarity('', '')).toBe(1);
    expect(similarity('Tab  Dolo', 'tab dolo')).toBe(1);
    expect(similarity('ab', 'abcdef')).toBeCloseTo(2 / 6);
  });
});

describe('calibration export (ECE)', () => {
  it('perfectly calibrated bins give ECE 0', () => {
    const samples = [
      ...Array.from({ length: 4 }, (_, i) => ({ confidence: 0.25, correct: i === 0 })),  // acc 0.25
      ...Array.from({ length: 4 }, (_, i) => ({ confidence: 0.75, correct: i !== 0 })),  // acc 0.75
    ];
    const r = calibrationReport(samples, 10);
    expect(r.ece).toBeCloseTo(0, 12);
    expect(r.samples).toBe(8);
  });
  it('exact arithmetic for an over-confident model', () => {
    // bin [0.9,1.0]: 4 samples at 0.95 with 2 correct -> gap 0.45 ; bin [0.5,0.6): 2 at 0.55, 1 correct -> gap 0.05
    const samples = [
      { confidence: 0.95, correct: true }, { confidence: 0.95, correct: true }, { confidence: 0.95, correct: false }, { confidence: 0.95, correct: false },
      { confidence: 0.55, correct: true }, { confidence: 0.55, correct: false },
      { confidence: Number.NaN, correct: true }, { confidence: 1.2, correct: true },
    ];
    const r = calibrationReport(samples, 10);
    expect(r.dropped).toBe(2);
    expect(r.ece).toBeCloseTo((4 / 6) * 0.45 + (2 / 6) * 0.05, 12);
    expect(r.mce).toBeCloseTo(0.45, 12);
    // Brier: 2*(0.05^2) + 2*(0.95^2) + (0.45^2) + (0.55^2) over 6
    expect(r.brier).toBeCloseTo((2 * 0.0025 + 2 * 0.9025 + 0.2025 + 0.3025) / 6, 12);
    expect(r.bins[9]).toMatchObject({ count: 4, accuracy: 0.5 });
    expect(r.bins[0]).toMatchObject({ count: 0, accuracy: null });
    expect(calibrationReport([{ confidence: 1, correct: true }], 10).bins[9]!.count).toBe(1); // 1.0 lands in the last bin
    expect(() => calibrationReport([], 0)).toThrow(RangeError);
  });
  it('from a scored document, per field', () => {
    const gold: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'BD' }] };
    const pred: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'TDS', confidence: 0.9 }, { name: 'Crocin', confidence: 0.8 }] };
    const samples = calibrationSamples(scoreFields(gold, pred), pred);
    expect(samples).toEqual(expect.arrayContaining([
      { confidence: 0.9, correct: true, field: 'medication.name' },
      { confidence: 0.9, correct: false, field: 'medication.frequency' },
      { confidence: 0.8, correct: false, field: 'medication.name' },
    ]));
    const r = calibrationReport(samples);
    expect(Object.keys(r.byField!)).toEqual(['medication.frequency', 'medication.name', 'medication.strength']);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // plain JSON export
  });
});

describe('reference ranges: numbers and units', () => {
  it('bounds compare numerically and units must agree when both sides state them', () => {
    expect(compareValues('range', '13.0-17.0 g/dL', '13 - 17 gm/dl')).toBe('normalized');
    expect(compareValues('range', '13.0-17.0 g/dL', '13-17 mg/dL')).toBe('mismatch');
    expect(compareValues('range', '13.0-17.0 g/dL', '13-17')).toBe('normalized');
    expect(compareValues('range', '<200 mg/dL', '< 200 mg%')).toBe('normalized');
    expect(compareValues('range', '<5', '>5')).toBe('mismatch');
    expect(compareValues('range', '4.5-11.0', '4.5-110')).toBe('mismatch');
  });
  it('scored as a lab field', () => {
    const g: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: [{ test: 'Cholesterol', value: '180', unit: 'mg/dL', referenceRange: '<200 mg/dL' }] };
    const p: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: [{ test: 'Cholesterol', value: '180', unit: 'mg%', referenceRange: '< 200' }] };
    expect(scoreFields(g, p).benchmarkFields.referenceRange.tp).toBe(1);
    expect(scoreFields(g, p).benchmarkFields.unit.tp).toBe(1);
  });
});
