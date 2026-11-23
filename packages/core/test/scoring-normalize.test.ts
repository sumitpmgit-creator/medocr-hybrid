import { describe, expect, it } from 'vitest';
import { scoreFields, compareValues, parseNumber, canonicalDrugName, canonicalUnit, scoringRulesId, NORMALIZATION_VERSION, NORMALIZATION_RULES_VERSION, type ClinicalDoc } from '../src/index.js';

const rx = (medications: ClinicalDoc['medications']): ClinicalDoc => ({ documentType: 'prescription', medications, labResults: [] });

describe('scorer uses normalize.ts (Rachel) for drug names, durations and units', () => {
  it('generic aliases count, brand mapping does not', () => {
    expect(canonicalDrugName('Tab. PCM 500')).toBe('paracetamol');
    expect(compareValues('drug', 'PCM', 'Paracetamol')).toBe('normalized');
    expect(compareValues('drug', 'Dolo', 'Paracetamol')).toBe('mismatch'); // brand→generic is a substitution, not a match
    const s = scoreFields(rx([{ name: 'Paracetamol', strength: '500 mg', frequency: 'TDS' }]), rx([{ name: 'Tab PCM', strength: '500mg', frequency: 'tid' }]));
    expect(s.f1).toBe(1);
    expect(s.benchmarkFields.drug).toMatchObject({ tp: 1, normalized: 1 });
  });
  it('durations', () => {
    expect(compareValues('duration', '5 days', 'x 5 d')).toBe('normalized');
    expect(compareValues('duration', '5 days', 'for 5 days')).toBe('normalized');
    expect(compareValues('duration', '5 days', '7 days')).toBe('mismatch');
  });
  it('gm/dL = g/dL and Indian digit grouping', () => {
    expect(canonicalUnit('gm/dL')).toBe(canonicalUnit('g/dL'));
    expect(compareValues('unit', 'gm/dL', 'g/dl')).toBe('normalized');
    expect(parseNumber('2,50,000')).toBe(250000);
    expect(parseNumber('1,00,00,000')).toBe(10000000);
    expect(compareValues('number', '2,50,000', '250000')).toBe('normalized');
    expect(compareValues('number', '2,50,000', '25000')).toBe('mismatch');
    const g: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: [{ test: 'Platelets', value: '2,50,000', unit: 'cells/cu.mm', referenceRange: '1,50,000-4,50,000' }] };
    const p: ClinicalDoc = { documentType: 'lab_report', medications: [], labResults: [{ test: 'Platelets', value: '250000', unit: '/cumm', referenceRange: '150000 - 450000' }] };
    expect(scoreFields(g, p).f1).toBe(1);
  });
  it('scores carry both rule versions', () => {
    const s = scoreFields(rx([]), rx([]));
    expect(s.normalizationVersion).toBe(NORMALIZATION_VERSION);
    expect(s.rulesVersion).toBe(NORMALIZATION_RULES_VERSION);
    expect(s.rulesId).toBe(scoringRulesId());
    expect(s.rulesId).toBe(`compare@${NORMALIZATION_RULES_VERSION}+normalize@${NORMALIZATION_VERSION}`);
  });
});
