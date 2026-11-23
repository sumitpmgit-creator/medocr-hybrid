import { describe, expect, it } from 'vitest';
import {
  scoreFields, alignRecords, parseNumber, parseQuantity, parseReferenceRange, canonicalUnit, compareValues,
  classifyNumericError, numbersEqual, rangesEqual, mergePRF, NORMALIZATION_RULES_VERSION, type ClinicalDoc,
} from '../src/index.js';

const rx = (medications: ClinicalDoc['medications']): ClinicalDoc => ({ documentType: 'prescription', medications, labResults: [] });
const lab = (labResults: ClinicalDoc['labResults']): ClinicalDoc => ({ documentType: 'lab_report', medications: [], labResults });

describe('value parsing and normalisation edge cases', () => {
  it('numbers', () => {
    expect(parseNumber('12.50')).toBe(12.5);
    expect(parseNumber('1,000')).toBe(1000);
    expect(parseNumber('−3.2')).toBe(-3.2);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('12.5 H')).toBeUndefined();
    expect(parseNumber('1,00')).toBeUndefined(); // not a thousands group: refuse to guess
    expect(numbersEqual(4.5, 4.5000000001)).toBe(true);
    expect(numbersEqual(4.5, 4.6)).toBe(false);
    expect(numbersEqual(4.5, 4.6, { abs: 0.1 })).toBe(true);
    expect(numbersEqual(100, 104, { rel: 0.05 })).toBe(true);
  });
  it('unit aliases reuse normalize.ts', () => {
    expect(canonicalUnit('MG')).toBe('mg');
    expect(canonicalUnit('milligram')).toBe('mg');
    expect(canonicalUnit('milligrams')).toBe('mg');
    expect(canonicalUnit('µg')).toBe('mcg');
    expect(canonicalUnit('μg')).toBe('mcg'); // Greek mu
    expect(canonicalUnit('mL')).toBe('ml');
    expect(canonicalUnit('g/dL')).toBe('g/dl');
    expect(canonicalUnit('mg')).not.toBe(canonicalUnit('mcg'));
  });
  it('quantities', () => {
    expect(parseQuantity('500MG')).toMatchObject({ value: 500, unit: 'mg' });
    expect(parseQuantity('0.5 g')).toMatchObject({ value: 0.5, unit: 'g' });
    expect(parseQuantity('1,000 IU')).toMatchObject({ value: 1000, unit: 'iu' });
    expect(parseQuantity('one tablet')).toBeUndefined();
  });
  it('reference ranges', () => {
    expect(parseReferenceRange('4.5-11.0')).toEqual({ low: 4.5, high: 11, lowInclusive: true, highInclusive: true });
    expect(parseReferenceRange('4.5 – 11.0 x10^3/µL')).toMatchObject({ low: 4.5, high: 11 });
    expect(parseReferenceRange('4.5 to 11')).toMatchObject({ low: 4.5, high: 11 });
    expect(parseReferenceRange('<5')).toEqual({ high: 5, lowInclusive: true, highInclusive: false });
    expect(parseReferenceRange('≤ 5.0')).toEqual({ high: 5, lowInclusive: true, highInclusive: true });
    expect(parseReferenceRange('Up to 5')).toMatchObject({ high: 5, highInclusive: true });
    expect(parseReferenceRange('>40 mg/dL')).toEqual({ low: 40, lowInclusive: false, highInclusive: true, unit: 'mg/dl' });
    expect(parseReferenceRange('-2 to 2')).toMatchObject({ low: -2, high: 2 });
    expect(parseReferenceRange('11-4.5')).toBeUndefined();
    expect(parseReferenceRange('see note')).toBeUndefined();
    expect(rangesEqual(parseReferenceRange('4.5-11.0')!, parseReferenceRange('4.50 - 11 g/dL')!)).toBe(true);
    expect(rangesEqual(parseReferenceRange('<5')!, parseReferenceRange('<=5')!)).toBe(false);
  });
  it('frequency aliases, but never 0-0-1 = 1-0-1', () => {
    expect(compareValues('frequency', 'BD', 'BID')).toBe('normalized');
    expect(compareValues('frequency', 'twice daily', '1-0-1')).toBe('normalized');
    expect(compareValues('frequency', 'TDS', 'tid')).toBe('normalized');
    expect(compareValues('frequency', '0-0-1', '1-0-1')).toBe('mismatch');
    expect(compareValues('frequency', 'OD', 'BD')).toBe('mismatch');
  });
  it('clinically significant differences are never normalised away', () => {
    expect(compareValues('quantity', '5 mg', '50 mg')).toBe('mismatch');
    expect(compareValues('quantity', '500 mg', '500 mcg')).toBe('mismatch');
    expect(compareValues('quantity', '625 mg', '625MG')).toBe('normalized');
    expect(compareValues('quantity', '625 mg', '625 mg')).toBe('exact');
    expect(compareValues('number', '12.50', '12.5')).toBe('normalized');
    expect(compareValues('number', '12.5', '1.25')).toBe('mismatch');
    expect(compareValues('range', '4.5-11.0', '4.5 - 11')).toBe('normalized');
  });
  it('numeric error classification', () => {
    expect(classifyNumericError('5 mg', '50 mg')).toBe('magnitude');
    expect(classifyNumericError('12.5', '1.25')).toBe('decimal');
    expect(classifyNumericError('0.5 mg', '5 mg')).toBe('decimal');
    expect(classifyNumericError('500 mg', '500 mcg')).toBe('unit');
    expect(classifyNumericError('500 mg', '650 mg')).toBe('value');
    expect(classifyNumericError('500 mg', '500 mg')).toBeUndefined();
    expect(classifyNumericError('BD', 'TDS')).toBeUndefined();
    expect(NORMALIZATION_RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('record alignment', () => {
  it('Hungarian beats greedy on crossed similarities', () => {
    // greedy would pair r0-p0 (0.9) and leave r1 with p1 (0.1, below threshold); optimal pairs r0-p1, r1-p0.
    const S = [[0.9, 0.8], [0.85, 0.1]];
    const a = alignRecords([0, 1], [0, 1], (r, p) => S[r]![p]!, 0.5);
    expect(a.pairs.map((p) => [p.refIndex, p.predIndex])).toEqual([[0, 1], [1, 0]]);
    expect(a.unmatchedRef).toEqual([]);
  });
  it('rectangular inputs and thresholds', () => {
    const a = alignRecords(['a', 'b', 'c'], ['b'], (r, p) => (r === p ? 1 : 0), 0.7);
    expect(a.pairs).toEqual([{ refIndex: 1, predIndex: 0, similarity: 1 }]);
    expect(a.unmatchedRef).toEqual([0, 2]);
    expect(alignRecords([], ['x'], () => 1).unmatchedPred).toEqual([0]);
  });
  it('same drug twice with different strengths aligns by strength, in any order', () => {
    const ref = rx([{ name: 'Metformin', strength: '500 mg', frequency: 'BD' }, { name: 'Metformin', strength: '1000 mg', frequency: 'OD' }]);
    const pred = rx([{ name: 'Metformin', strength: '1000 mg', frequency: 'OD' }, { name: 'Metformin', strength: '500 mg', frequency: 'BD' }]);
    const s = scoreFields(ref, pred);
    expect(s.f1).toBe(1);
    expect(s.alignment.medication.pairs.map((p) => [p.refIndex, p.predIndex])).toEqual([[0, 1], [1, 0]]);
    expect(s.duplicateEntities).toBe(0);
  });
  it('counts duplicate predicted entities', () => {
    const s = scoreFields(rx([{ name: 'Pan', strength: '40 mg' }]), rx([{ name: 'Pan', strength: '40 mg' }, { name: 'PAN', strength: '40 mg' }]));
    expect(s.duplicateEntities).toBe(1);
    expect(s.comparisons.filter((c) => c.entityUnmatched).every((c) => c.outcome === 'unsupported')).toBe(true);
  });
});

describe('per-field P/R/F1 and exact vs normalised', () => {
  const gold: ClinicalDoc = {
    documentType: 'other',
    medications: [
      { name: 'Augmentin', strength: '625 mg', frequency: 'BD' },
      { name: 'Pantoprazole', strength: '40 mg', frequency: 'OD' },
      { name: 'Dolo', strength: '650 mg', frequency: 'SOS' },
    ],
    labResults: [
      { test: 'Haemoglobin', value: '12.5', unit: 'g/dL', referenceRange: '13.0-17.0' },
      { test: 'WBC', value: '7200', unit: '/cumm', referenceRange: '4000-11000' },
      { test: 'HbA1c', value: '6.1', unit: '%', referenceRange: '<5.7' },
    ],
  };
  const pred: ClinicalDoc = {
    documentType: 'other',
    medications: [
      { name: 'Augmentin', strength: '625MG', frequency: 'twice daily' }, // normalised matches
      { name: 'Pantoprazole', strength: '40 mg', frequency: 'BD' },        // wrong frequency
      // Dolo omitted
      { name: 'Azithromycin', strength: '500 mg', frequency: 'OD' },       // hallucinated
    ],
    labResults: [
      { test: 'Haemoglobin', value: '1.25', unit: 'g/dL', referenceRange: '13-17' }, // decimal error
      { test: 'WBC', value: '7,200', unit: '/cumm', referenceRange: '4000 - 11000' },
      { test: 'HbA1c', value: '6.1', unit: '%', referenceRange: '< 5.7' },
    ],
  };
  const s = scoreFields(gold, pred);

  it('headline fields', () => {
    expect(s.benchmarkFields.drug).toMatchObject({ tp: 2, fp: 1, fn: 1, exact: 2, normalized: 0 });
    expect(s.benchmarkFields.drug.precision).toBeCloseTo(2 / 3);
    expect(s.benchmarkFields.drug.recall).toBeCloseTo(2 / 3);
    expect(s.benchmarkFields.dose).toMatchObject({ tp: 2, fp: 1, fn: 1, exact: 1, normalized: 1 });
    expect(s.benchmarkFields.frequency).toMatchObject({ tp: 1, fp: 2, fn: 2, exact: 0, normalized: 1 });
    expect(s.benchmarkFields.value).toMatchObject({ tp: 2, fp: 1, fn: 1, exact: 1, normalized: 1 });
    expect(s.benchmarkFields.unit).toMatchObject({ tp: 3, fp: 0, fn: 0, exact: 3 });
    expect(s.benchmarkFields.unit.f1).toBe(1);
    expect(s.benchmarkFields.referenceRange).toMatchObject({ tp: 3, exact: 0, normalized: 3 });
    expect(s.benchmarkFields.test.f1).toBe(1);
    expect(s.benchmarkFields.frequency.exactMatchRate).toBe(0);
    expect(s.benchmarkFields.frequency.normalizedMatchRate).toBeCloseTo(1 / 3);
  });
  it('perField keys and backwards-compatible aggregates', () => {
    expect(Object.keys(s.perField)).toEqual(expect.arrayContaining(['medication.name', 'medication.strength', 'lab.value', 'lab.referenceRange']));
    expect(s.passesSafetyScreen).toBe(false);
    expect(s.missingRequired).toBe(1); // Dolo name
    expect(s.strictExactMatchRate).toBeLessThan(s.exactMatchRate);
    expect(s.rulesVersion).toBe(NORMALIZATION_RULES_VERSION);
    const correct = s.comparisons.filter((c) => c.outcome === 'correct');
    expect(correct.every((c) => c.match === 'exact' || c.match === 'normalized')).toBe(true);
  });
  it('mergePRF micro-averages across documents', () => {
    const m = mergePRF([s.benchmarkFields.drug, s.benchmarkFields.drug]);
    expect(m).toMatchObject({ tp: 4, fp: 2, fn: 2 });
    expect(m.f1).toBeCloseTo(2 / 3);
    expect(mergePRF([])).toMatchObject({ precision: 1, recall: 1 });
  });
  it('numeric tolerance is opt-in', () => {
    const g = lab([{ test: 'Creatinine', value: '1.10' }]);
    const p = lab([{ test: 'Creatinine', value: '1.12' }]);
    expect(scoreFields(g, p).benchmarkFields.value.tp).toBe(0);
    expect(scoreFields(g, p, { tolerance: { abs: 0.05 } }).benchmarkFields.value.tp).toBe(1);
  });
  it('empty documents score perfectly', () => {
    const e = scoreFields(rx([]), rx([]));
    expect(e.f1).toBe(1);
    expect(e.benchmarkFields.drug).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });
});
