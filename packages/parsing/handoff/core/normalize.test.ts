// SPDX-License-Identifier: Apache-2.0
/**
 * Drop-in tests for packages/core/src/normalize.ts (this file lives in
 * packages/core/test/ when the pair is copied over).
 *
 * Goldens match the original core normaliser so field scores do not shift.
 * A second describe block lists every output that differs from core.
 */
import { describe, expect, it } from 'vitest';
import {
  BRAND_ALIASES_COMPLETE,
  DRUG_ALIASES,
  DRUG_ALIASES_COMPLETE,
  NORMALIZATION_VERSION,
  normalizeDuration,
  normalizeDrugName,
  normalizeFrequency,
  normalizeGeneric,
  normalizeName,
  normalizeNumber,
  normalizeStrength,
  normalizeText,
  normalizeUnit,
} from '../src/normalize.js';

describe('normalizeFrequency', () => {
  it('maps the abbreviations the field-scorer test relies on', () => {
    expect(normalizeFrequency('BD')).toBe('1-0-1');
    expect(normalizeFrequency('twice daily')).toBe('1-0-1');
    expect(normalizeFrequency('1 - 0 - 1')).toBe('1-0-1');
    expect(normalizeFrequency('T.D.S.')).toBe('1-1-1');
  });

  it('matches core goldens for the shared table and dashed patterns', () => {
    const goldens: [string | null | undefined, string][] = [
      [null, ''], [undefined, ''], ['', ''],
      ['BD', '1-0-1'], ['bd', '1-0-1'], ['B.D.', '1-0-1'], ['bid', '1-0-1'], ['B.I.D.', '1-0-1'],
      ['twice daily', '1-0-1'], ['twice a day', '1-0-1'],
      ['1 - 0 - 1', '1-0-1'], ['1-0-1', '1-0-1'], ['1–0–1', '1-0-1'], ['1 x 0 x 1', '1-0-1'],
      ['T.D.S.', '1-1-1'], ['TDS', '1-1-1'], ['TID', '1-1-1'], ['thrice daily', '1-1-1'],
      ['three times a day', '1-1-1'],
      ['OD', '1-0-0'], ['QD', '1-0-0'], ['once daily', '1-0-0'], ['once a day', '1-0-0'],
      ['daily', '1-0-0'], ['1-0-0', '1-0-0'], ['0-0-1', '0-0-1'],
      ['QID', '1-1-1-1'], ['four times a day', '1-1-1-1'], ['1-1-1-1', '1-1-1-1'],
      ['HS', '0-0-1'], ['at night', '0-0-1'], ['at bedtime', '0-0-1'],
      ['SOS', 'sos'], ['PRN', 'sos'], ['as needed', 'sos'],
      ['STAT', 'stat'], ['stat', 'stat'],
      ['1/2-0-1', '1/2-0-1'], ['2-2-2', '2-2-2'], ['0-0-2', '0-0-2'], ['1-1-1', '1-1-1'],
      ['  BD  ', '1-0-1'],
    ];
    for (const [input, expected] of goldens) {
      expect(normalizeFrequency(input), String(input)).toBe(expected);
    }
  });

  it('does not equate distinct tablet-count patterns or STAT with SOS', () => {
    expect(normalizeFrequency('0-0-1')).not.toBe(normalizeFrequency('1-0-1'));
    expect(normalizeFrequency('1-0-0')).not.toBe(normalizeFrequency('1-0-1'));
    expect(normalizeFrequency('1-0-1')).not.toBe(normalizeFrequency('1-1-1'));
    expect(normalizeFrequency('STAT')).not.toBe(normalizeFrequency('SOS'));
  });
});

describe('normalizeStrength / normalizeUnit / normalizeNumber / names', () => {
  it('strength ignores spacing and unit spelling (field-scorer test)', () => {
    expect(normalizeStrength('625 mg')).toBe(normalizeStrength('625MG'));
    expect(normalizeStrength('5 mcg')).toBe(normalizeStrength('5µg'));
    expect(normalizeStrength('625 mg')).toBe('625mg');
  });

  it('matches core strength goldens', () => {
    const goldens: [string | null, string][] = [
      [null, ''], ['', ''],
      ['625 mg', '625mg'], ['625MG', '625mg'], ['625mg', '625mg'],
      ['5 mcg', '5mcg'], ['5µg', '5mcg'], ['5ug', '5mcg'],
      ['500mg/5ml', '500mg/5ml'], ['500 mg / 5 ml', '500mg/5ml'],
      ['10 IU', '10iu'], ['1 g', '1g'], ['1 gm', '1g'], ['1 gms', '1g'],
      ['5 mgs', '5mg'], ['5 milligrams', '5mg'],
    ];
    for (const [input, expected] of goldens) {
      expect(normalizeStrength(input), String(input)).toBe(expected);
    }
  });

  it('matches core unit goldens that this superset does not change', () => {
    const goldens: [string | null, string][] = [
      [null, ''], ['', ''],
      ['g/dL', 'g/dl'], ['g/dl', 'g/dl'], ['g / dL', 'g/dl'], ['mg/dL', 'mg/dl'],
      ['mg', 'mg'], ['mgs', 'mg'], ['milligram', 'mg'], ['milligrams', 'mg'],
      ['mcg', 'mcg'], ['ml', 'ml'], ['mL', 'ml'], ['ML', 'ml'],
      ['IU', 'iu'], ['iu', 'iu'], ['U', 'u'], ['mmol/L', 'mmol/l'], ['  mg  ', 'mg'],
    ];
    for (const [input, expected] of goldens) {
      expect(normalizeUnit(input), String(input)).toBe(expected);
    }
  });

  it('matches core number goldens, including 1,5 → 15', () => {
    const goldens: [string | null, string][] = [
      [null, ''], ['', ''],
      ['12.50', '12.5'], ['12.5', '12.5'], ['1,000', '1000'], ['1,00,000', '100000'],
      ['1,5', '15'], ['.5', '0.5'], ['0.5', '0.5'], ['1.0', '1'],
      ['-3', '-3'], ['−3', '-3'], ['12.50 ', '12.5'], ['abc', 'abc'], ['12mg', '12mg'],
    ];
    for (const [input, expected] of goldens) {
      expect(normalizeNumber(input), String(input)).toBe(expected);
    }
  });

  it('matches core name and generic goldens (no alias expansion)', () => {
    expect(normalizeName('Tab. Augmentin')).toBe('augmentin');
    expect(normalizeName('PAN')).toBe('pan');
    expect(normalizeName('T. PCM')).toBe('t pcm');
    expect(normalizeName('C. Amox')).toBe('c amox');
    expect(normalizeName('Tab. PCM 500mg')).toBe('pcm 500mg');
    expect(normalizeName('Haemoglobin')).toBe('haemoglobin');
    expect(normalizeGeneric(null)).toBe('');
    expect(normalizeGeneric('  5   days  ')).toBe('5 days');
    expect(normalizeGeneric('x5d')).toBe('x5d');
  });

  it('does not change magnitude or convert mg/dL to mmol/L', () => {
    expect(normalizeStrength('5 mg')).not.toBe(normalizeStrength('50 mg'));
    expect(normalizeNumber('12.5')).not.toBe(normalizeNumber('1.25'));
    expect(normalizeUnit('mg/dL')).not.toBe(normalizeUnit('mmol/L'));
    expect(normalizeUnit('U')).not.toBe(normalizeUnit('IU'));
  });
});

describe('documented differences vs the original core normaliser', () => {
  it('frequency: slash- and space-separated schedules, plus extra synonyms', () => {
    expect(normalizeFrequency('1/0/1')).toBe('1-0-1');
    expect(normalizeFrequency('1 0 1')).toBe('1-0-1');
    expect(normalizeFrequency('1 / 0 / 1')).toBe('1-0-1');
    expect(normalizeFrequency('qds')).toBe('1-1-1-1');
    expect(normalizeFrequency('nocte')).toBe('0-0-1');
    expect(normalizeFrequency('bedtime')).toBe('0-0-1');
    expect(normalizeFrequency('three times daily')).toBe('1-1-1');
    expect(normalizeFrequency('if needed')).toBe('sos');
    expect(normalizeFrequency('1/2-0-1')).toBe('1/2-0-1');
  });

  it('unit and strength additions', () => {
    expect(normalizeUnit('µg')).toBe('mcg');
    expect(normalizeUnit('μg')).toBe('mcg');
    expect(normalizeUnit('ug')).toBe('mcg');
    expect(normalizeUnit('gm')).toBe('g');
    expect(normalizeUnit('gms')).toBe('g');
    expect(normalizeUnit('mg%')).toBe('mg/dl');
    expect(normalizeUnit('g%')).toBe('g/dl');
    expect(normalizeUnit('cc')).toBe('ml');
    expect(normalizeUnit('cells/cu.mm')).toBe('cells/cumm');
    expect(normalizeUnit('/µL')).toBe('/ul');
    expect(normalizeUnit('percent')).toBe('%');
    expect(normalizeStrength('5 cc')).toBe('5ml');
  });
});

describe('additions (not used by the current field scorer)', () => {
  it('exposes a version and a seed, incomplete alias table', () => {
    expect(NORMALIZATION_VERSION).toBe(1);
    expect(DRUG_ALIASES_COMPLETE).toBe(false);
    expect(BRAND_ALIASES_COMPLETE).toBe(false);
    expect(DRUG_ALIASES.pcm).toBe('paracetamol');
    expect(DRUG_ALIASES.amox).toBe('amoxicillin');
  });

  it('normalizeDuration maps 5 days / x5d / 1 wk and does not convert weeks to days', () => {
    expect(normalizeDuration('5 days')).toBe('5 d');
    expect(normalizeDuration('x5d')).toBe('5 d');
    expect(normalizeDuration('1 week')).toBe('1 wk');
    expect(normalizeDuration('1 wk')).not.toBe('7 d');
    expect(normalizeDuration(null)).toBe('');
  });

  it('normalizeDrugName strips forms and expands aliases; normalizeName does not', () => {
    expect(normalizeDrugName('Tab. PCM 500mg').canonical).toBe('paracetamol 500 mg');
    expect(normalizeName('Tab. PCM 500mg')).toBe('pcm 500mg');
    expect(normalizeDrugName('Dolo 650').name).toBe('dolo');
    expect(normalizeDrugName('Dolo 650', { mapBrands: true }).name).toBe('paracetamol');
  });

  it('transcription preset is lighter than the medication preset', () => {
    expect(normalizeText('Tab  PCM\n500mg', 'transcription')).toBe('Tab  PCM\n500mg');
    const med = normalizeText('Tab. PCM 500mg BD x5d', 'medication');
    expect(med).toContain('paracetamol');
    expect(med).toContain('1-0-1');
    expect(med).toContain('5 d');
  });
});
