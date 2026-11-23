import { describe, expect, it } from 'vitest';
import { cer, wer, editCounts, numericAccuracy, omissionInvention, fuzzyContains } from '../src/index.js';

describe('CER/WER', () => {
  it('is 0 for identical strings', () => {
    expect(cer('Tab Dolo 650', 'Tab Dolo 650').rate).toBe(0);
    expect(wer('Tab Dolo 650', 'Tab Dolo 650').rate).toBe(0);
  });
  it('counts substitutions, deletions, insertions', () => {
    const c = editCounts([...'kitten'], [...'sitting']);
    expect(c.substitutions + c.deletions + c.insertions).toBe(3);
    expect(c.substitutions).toBe(2);
    expect(c.insertions).toBe(1);
  });
  it('CER = (S+D+I)/N_ref', () => {
    expect(cer('abcd', 'abxd').rate).toBeCloseTo(0.25);
    expect(cer('ab', 'abcdef').rate).toBeCloseTo(2); // can exceed 1
  });
  it('WER on words', () => {
    expect(wer('paracetamol 500 mg BD', 'paracetamol 500 mg TDS').rate).toBeCloseTo(0.25);
    expect(wer('a b c', '').rate).toBe(1);
  });
  it('normalises whitespace by default and handles empty refs', () => {
    expect(cer('a  b\n c', 'a b c').rate).toBe(0);
    expect(cer('', '').rate).toBe(0);
    expect(cer('', 'x').rate).toBe(1);
  });
  it('counts Indic code points', () => {
    expect(cer('दवा', 'दवा').rate).toBe(0);
    expect(cer('दवा', 'दव').rate).toBeGreaterThan(0);
  });
  it('numeric accuracy and omission/invention', () => {
    expect(numericAccuracy('Hb 12.5 g/dL, WBC 7200', 'Hb 12.5 g/dL, WBC 720')).toBe(0.5);
    const oi = omissionInvention('take one tablet daily', 'take tablet daily now');
    expect(oi.omissionRate).toBeCloseTo(0.25);
    expect(oi.inventionRate).toBeCloseTo(0.25);
  });
  it('fuzzyContains tolerates small OCR noise', () => {
    expect(fuzzyContains('Rx: Tab. Augmentin 625 mg BD x 5 days', 'Augmentin 625')).toBe(true);
    expect(fuzzyContains('Rx: Tab. Augmentn 625 mg', 'Augmentin 625', 0.8)).toBe(true);
    expect(fuzzyContains('Rx: Tab. Pan 40', 'Augmentin')).toBe(false);
  });
});
