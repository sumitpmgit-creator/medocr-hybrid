import { describe, expect, it } from 'vitest';
import {
  assertSafeForCloud,
  deidentify,
  utf8Bytes,
  UnsafeForCloudError,
} from '../src/deid.js';

// All fixtures are synthetic. No real patient data.

const CORE_FIXTURE =
  'Patient Name: Ravi Kumar Sharma\nPh: +91 98765 43210\nABHA: 12-3456-7890-1234\nAadhaar 1234 5678 9012\nravi@abdm\nDr. Anil Mehta Reg. No: MCI/12345\nTab Dolo 650 BD';

describe('deidentify', () => {
  it('redacts Indian identifiers', () => {
    const r = deidentify(CORE_FIXTURE);
    expect(r.text).not.toMatch(/Ravi|98765|3456-7890|5678 9012|ravi@abdm|Anil|MCI\/12345/);
    expect(r.text).toContain('Tab Dolo 650 BD');
    expect(r.redactions.phone).toBe(1);
    expect(r.redactions.abha_number).toBe(1);
    expect(r.redactions.aadhaar).toBe(1);
    expect(r.total).toBeGreaterThanOrEqual(6);
  });

  it('leaves lab values alone', () => {
    const t = 'Haemoglobin 12.5 g/dL 13.0-17.0\nPlatelets 250000 /cumm';
    expect(deidentify(t).text).toBe(t);
  });

  it('counts bytes', () => {
    expect(utf8Bytes('दवा')).toBe(9);
  });

  it('emits core placeholders and records original-text spans', () => {
    const r = deidentify(CORE_FIXTURE);
    expect(r.text).toContain('[NAME]');
    expect(r.text).toContain('[PHONE]');
    expect(r.text).toContain('[ABHA_NUMBER]');
    expect(r.text).toContain('[AADHAAR]');
    expect(r.text).toContain('[ABHA_ADDRESS]');
    expect(r.text).toContain('[REG_NO]');
    expect(r.spans?.length).toBe(r.total);
    const name = r.spans?.find((s) => s.type === 'name');
    expect(name).toBeDefined();
    expect(CORE_FIXTURE.slice(name!.start, name!.end)).toBe('Ravi Kumar Sharma');
    expect(r.text).toMatch(/Ph:\s*\[PHONE\]/);
    expect(r.text).toMatch(/Reg\. No:\s*\[REG_NO\]/);
  });

  it('redacts addresses and labelled PIN codes without eating lab counts', () => {
    const input =
      'Address: Flat 3B, Green Park, New Delhi - 110016\n\nPIN: 411001\nPlatelet Count 250000';
    const r = deidentify(input);
    expect(r.text).toContain('[ADDRESS]');
    expect(r.text).toContain('[PIN]');
    expect(r.text).toContain('250000');
    expect(r.text).not.toMatch(/110016|411001|Green Park/);
  });

  it('replaces DOB with [DOB] and other calendar dates with [DATE], leaving ages', () => {
    const dob = deidentify('DOB: 14/03/1987 and Born on 14th March 1987');
    expect(dob.text).not.toMatch(/14\/03\/1987|14th March 1987/);
    expect(dob.text).toContain('[DOB]');
    const dates = deidentify('Date: 12-11-2026  Collected: 20/11/2026');
    expect(dates.text).not.toMatch(/12-11-2026|20\/11\/2026/);
    expect(dates.text).toContain('[DATE]');
    expect(deidentify('Age/Sex: 38Y/M').text).toBe('Age/Sex: 38Y/M');
  });

  it('redacts month-name dates as [DATE], or [DOB] in a birth context', () => {
    const cases: [string, string][] = [
      ['Sample collected on 12-Oct-2026 08:15', '12-Oct-2026'],
      ['Collected 12 Oct 2026', '12 Oct 2026'],
      ['Report 12/October/2026', '12/October/2026'],
      ['Follow up Oct 12, 2026', 'Oct 12, 2026'],
      ['Review on 12th October 2026', '12th October 2026'],
      ['Seen Sept 3 2026', 'Sept 3 2026'],
    ];
    for (const [input, leak] of cases) {
      const r = deidentify(input);
      expect(r.text, input).not.toContain(leak);
      expect(r.text, input).toContain('[DATE]');
      expect(r.text, input).not.toContain('[DOB]');
    }
    expect(deidentify('Sample collected on 12-Oct-2026 08:15').text).toContain('08:15');

    const dob = deidentify('DOB: 12-Oct-1987 and Born on 3 Sept 1987');
    expect(dob.text).not.toMatch(/12-Oct-1987|3 Sept 1987/);
    expect(dob.text).toContain('[DOB]');
    expect(dob.text).not.toContain('[DATE]');

    // Month words without a day and year, plus dose and lab values, must survive.
    expect(deidentify('Results may vary in March or Dec').text).toBe(
      'Results may vary in March or Dec',
    );
    expect(deidentify('Tab Metformin 500 mg 1-0-1').text).toBe('Tab Metformin 500 mg 1-0-1');
    expect(deidentify('Hemoglobin 13.5 g/dL').text).toBe('Hemoglobin 13.5 g/dL');
  });

  it('redacts BUG-001 formats', () => {
    const cases: [string, string][] = [
      ['Hyderabad 500 080', '500 080'],
      ['Mobile：９８７６５４３２１０', '９８７６５４３２１０'],
      ['Callon9876543210forreports', '9876543210'],
      ['रोगी: अनीता शर्मा', 'अनीता शर्मा'],
      ['sunita devi w/o ramesh yadav', 'sunita devi'],
      ['Hospital number: 2023/BF/057', '2023/BF/057'],
      ['UID:2345.6789.0123', '2345.6789.0123'],
      ['PAN abcpk1234f', 'abcpk1234f'],
      ['mail: rajesh.kumar87 [at] gmail [dot] com', 'rajesh.kumar87'],
    ];
    for (const [input, leak] of cases) {
      const r = deidentify(input);
      expect(r.text.toLowerCase(), input).not.toContain(leak.toLowerCase());
    }
  });

  it('does not let a patient name swallow the next line of clinical text', () => {
    const r = deidentify('Patient Name: Rajesh Kumar\nHemoglobin 13.5 g/dL');
    expect(r.text).toContain('[NAME]');
    expect(r.text).toContain('Hemoglobin 13.5 g/dL');
  });
});

describe('assertSafeForCloud', () => {
  it('passes after deidentify and on clean clinical text', () => {
    expect(() => assertSafeForCloud(deidentify(CORE_FIXTURE).text)).not.toThrow();
    expect(() => assertSafeForCloud('Tab Metformin 500 mg 1-0-1')).not.toThrow();
  });

  it('throws when residual identifiers, dates or DOB remain', () => {
    expect(() => assertSafeForCloud('Call 9876543210')).toThrow(UnsafeForCloudError);
    expect(() => assertSafeForCloud('DOB: 14/03/1987')).toThrow(UnsafeForCloudError);
    expect(() => assertSafeForCloud('Visit 12-11-2026')).toThrow(UnsafeForCloudError);
    expect(() => assertSafeForCloud('Sample collected on 12-Oct-2026')).toThrow(UnsafeForCloudError);
  });
});
