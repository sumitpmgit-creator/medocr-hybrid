// Synthetic data only: every name and number below is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPhi, findLeaks, survives, maskValue } from '../src/phi.ts';

const REF = `DISCHARGE NOTE
Patient’s name: Zara Q. Testova
Hospital No: 2099/ZZ/001
DOB: 01/02/1990
Phone: +91 98765 43210
Aadhaar 1234 5678 9012
Diagnosis: Fever
Date: 23/02/25
Cefuroxime 500mg bd x 5/7
Doctor’s name: Dr Quill Fakename
Signature: -
Requested by: Dr Imaginary Person`;

test('extracts each identifier type by the documented rules', () => {
  const items = extractPhi({ referenceText: REF });
  const byType = (t: string) => items.filter((i) => i.type === t).map((i) => i.value);
  assert.deepEqual(byType('patient_name'), ['Zara Q. Testova']);
  assert.deepEqual(byType('clinician_name').sort(), ['Imaginary Person', 'Quill Fakename']);
  assert.deepEqual(byType('record_id'), ['2099/ZZ/001']);
  assert.deepEqual(byType('dob'), ['01/02/1990']);
  assert.deepEqual(byType('national_id'), ['1234 5678 9012']);
  assert.deepEqual(byType('phone'), ['+91 98765 43210']);
  // not identifiers: service date, dosing, empty signature
  assert.ok(!items.some((i) => i.value.includes('23/02/25') || i.value.includes('5/7') || i.value === '-'));
});

test('initials and IDs survive across punctuation/spacing changes; redaction removes them', () => {
  assert.ok(survives({ value: 'E.J' }, 'patient name: e j , ward 3'));
  assert.ok(survives({ value: '2099/ZZ/001' }, 'Hospital no 2099 ZZ 001'));
  assert.ok(!survives({ value: '2099/ZZ/001' }, 'Hospital no [ID]'));
  assert.ok(!survives({ value: 'E.J' }, 'eject the tray')); // token match, not substring
});

test('leak counting over de-id output and cloud payloads', () => {
  const items = extractPhi({ referenceText: REF });
  const deidOut = REF.replace('Zara Q. Testova', '[NAME]').replace('+91 98765 43210', '[PHONE]');
  const leaks = findLeaks(items, [deidOut]);
  assert.equal(items.length, 7);
  assert.equal(leaks.length, 5); // name and phone removed; ids, dob, aadhaar, clinicians survive
  assert.deepEqual(findLeaks(items, ['{"contents":"[NAME] [ID] [DOB]"}']), []);
});

test('structured phi in the manifest takes precedence', () => {
  const items = extractPhi({ referenceText: REF, phi: [{ type: 'patient_name', value: 'Someone Else' }] });
  assert.deepEqual(items.map((i) => i.value), ['Someone Else']);
});

test('masking never contains the value', () => {
  const m = maskValue({ type: 'patient_name', value: 'Zara Testova', rule: 'x' });
  assert.equal(m.masked, '************');
  assert.ok(!JSON.stringify(m).includes('Testova'));
});

import { pickOcr, pickDeid } from '../src/stage-select.ts';
test('stage selection: raw OCR by name, never the de-id output', () => {
  const steps = [
    { stageId: 'nano-read', stageKind: 'ocr', text: 'Patient name: Zara' },
    { stageId: 'nano-deid', stageKind: 'deid', text: 'Patient name: [NAME]' },
    { stageId: 'nano-structure', stageKind: 'structure' },
  ];
  assert.deepEqual(pickOcr(steps, 'final'), { text: 'Patient name: Zara', source: 'stage:nano-read' });
  assert.deepEqual(pickDeid(steps), { texts: ['Patient name: [NAME]'], stageIds: ['nano-deid'] });
  // kind-only deid stage, ocr found by kind
  assert.equal(pickOcr([{ stageId: 'x', stageKind: 'deid', text: 'a' }, { stageId: 'y', stageKind: 'ocr', text: 'b' }], undefined).text, 'b');
  assert.deepEqual(pickDeid([{ stageId: 'nano-read', stageKind: 'ocr', text: 'a' }]).texts, []);
  assert.equal(pickOcr([], 'fallback').source, 'output.text (no OCR stage in trace)');
});
