import { describe, expect, it } from 'vitest';
import { deidentify, routeDoc, reconcileMedication, groundedConfidence, utf8Bytes } from '../src/index.js';

describe('deidentify', () => {
  it('redacts Indian identifiers', () => {
    const r = deidentify('Patient Name: Ravi Kumar Sharma\nPh: +91 98765 43210\nABHA: 12-3456-7890-1234\nAadhaar 1234 5678 9012\nravi@abdm\nDr. Anil Mehta Reg. No: MCI/12345\nTab Dolo 650 BD');
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
  it('counts bytes', () => { expect(utf8Bytes('दवा')).toBe(9); });
});

describe('routing', () => {
  it('ungrounded values get low confidence even if model is confident', () => {
    expect(groundedConfidence(0.99, ['Augmentin'], 'Tab Pan 40').confidence).toBeLessThanOrEqual(0.4);
    expect(groundedConfidence(0.95, ['Augmentin', '625 mg'], 'Tab Augmentin 625 mg').confidence).toBe(0.95);
  });
  it('routes low-confidence entities to cloud', () => {
    const r = routeDoc({ documentType: 'prescription', labResults: [], medications: [
      { name: 'Augmentin', strength: '625 mg', confidence: 0.95 },
      { name: 'Zifi', strength: '200 mg', confidence: 0.6 },
    ] }, 'Augmentin 625 mg ; Zifi 200 mg');
    expect(r.meds.map((m) => m.decision)).toEqual(['accept_on_device', 'send_to_cloud']);
    expect(r.toCloud).toBe(1);
  });
  it('disagreement between device and cloud goes to human', () => {
    expect(reconcileMedication({ name: 'Zifi', frequency: 'BD' }, { name: 'Zifi', frequency: 'TDS', confidence: 0.9 }).decision).toBe('human_confirm');
    expect(reconcileMedication({ name: 'Zifi', frequency: 'BD' }, { name: 'Zifi', frequency: '1-0-1', confidence: 0.9 }).decision).toBe('accept_on_device');
  });
});
