/**
 * Area: ROUTING - on-device vs cloud decisions.
 * core: routeDoc / groundedConfidence / reconcileMedication / reconcileLab / runPipeline
 * parsing: fieldsBelowThreshold
 * apps/web: hybridVerify stage, exercised with mocked Nano + Firebase.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { core, parsing } from '../src/core.ts';
import { EgressSpy } from '../src/egress.ts';
import { installNanoMock, type NanoMock } from '../src/mocks/nano.ts';
import { qa } from '../src/mocks/firebase-ai-sdk.ts';
import { localStage } from '../src/mocks/stages.ts';

const C = core.mod;
const T = { acceptOnDevice: 0.85, humanReview: 0.5 };
const med = (name: string, confidence: number | undefined, extra: object = {}) => ({ name, strength: '500 mg', confidence, ...extra });
const doc = (meds: any[], labs: any[] = []) => ({ documentType: 'prescription', medications: meds, labResults: labs });
const SRC = 'Tab Metformin 500 mg 1-0-1\nTab Zifi 500 mg BD\nHb 13.5 g/dL';

describe.skipIf(!C.routeDoc)('ROUTING: core routeDoc thresholds', () => {
  it('ROUTE-01 confidence exactly at acceptOnDevice is accepted on-device (>= boundary)', () => {
    expect(C.routeDoc(doc([med('Metformin', 0.85)]), SRC, T).meds[0].decision).toBe('accept_on_device');
  });
  it('ROUTE-02 confidence just below threshold goes to cloud', () => {
    expect(C.routeDoc(doc([med('Metformin', 0.8499)]), SRC, T).meds[0].decision).toBe('send_to_cloud');
  });
  it('ROUTE-03 missing self-reported confidence is treated as uncertain (cloud)', () => {
    expect(C.routeDoc(doc([med('Metformin', undefined)]), SRC, T).meds[0].decision).toBe('send_to_cloud');
  });
  it('ROUTE-04 NaN confidence is treated as uncertain (cloud), never accepted', () => {
    expect(C.routeDoc(doc([med('Metformin', Number.NaN)]), SRC, T).meds[0].decision).toBe('send_to_cloud');
  });
  it('ROUTE-05 out-of-range confidence (1.7 / -0.2) is clamped or rejected, not trusted', () => {
    const r = C.routeDoc(doc([med('Metformin', 1.7), med('Zifi', -0.2)]), SRC, T);
    expect(r.meds[0].confidence).toBeLessThanOrEqual(1);
    expect(r.meds[1].confidence).toBeGreaterThanOrEqual(0);
  });
  it('ROUTE-06 a confident but ungrounded (hallucinated) entity is sent to cloud', () => {
    const r = C.routeDoc(doc([med('Augmentin', 0.99, { strength: '625 mg' })]), SRC, T);
    expect(r.meds[0].grounded).toBe(false);
    expect(r.meds[0].decision).toBe('send_to_cloud');
  });
  it('ROUTE-07 thresholds from Remote Config are honoured (acceptOnDevice 0.6)', () => {
    expect(C.routeDoc(doc([med('Metformin', 0.65)]), SRC, { acceptOnDevice: 0.6, humanReview: 0.3 }).meds[0].decision).toBe('accept_on_device');
  });
  it('ROUTE-08 toCloud counts meds + labs routed to cloud', () => {
    const r = C.routeDoc(doc([med('Metformin', 0.9), med('Zifi', 0.4)], [{ test: 'Hb', value: '13.5', confidence: 0.3 }]), SRC, T);
    expect(r.toCloud).toBe(2);
  });
  it('ROUTE-09 empty document routes nothing', () => {
    expect(C.routeDoc(doc([]), '', T).toCloud).toBe(0);
  });
});

describe.skipIf(!C.reconcileMedication)('ROUTING: core device/cloud reconciliation', () => {
  it('ROUTE-10 agreement after permitted normalisation (BD vs 1-0-1, 500mg vs 500 mg) is accepted', () => {
    expect(C.reconcileMedication({ name: 'Zifi', strength: '500mg', frequency: 'BD' }, { name: 'Zifi', strength: '500 mg', frequency: '1-0-1', confidence: 0.9 }, T).decision).toBe('accept_on_device');
  });
  it('ROUTE-11 disagreement on a critical field goes to human confirm', () => {
    expect(C.reconcileMedication({ name: 'Zifi', frequency: 'BD' }, { name: 'Zifi', frequency: 'TDS', confidence: 0.9 }, T).decision).toBe('human_confirm');
  });
  it('ROUTE-12 dose that differs only in case/spacing ("1 tab" vs "1 Tab") is not a disagreement', () => {
    const r = C.reconcileMedication({ name: 'Zifi', dose: '1 tab' }, { name: 'Zifi', dose: '1 Tab', confidence: 0.9 }, T);
    expect(r.disagreements).toEqual([]);
  });
  it('ROUTE-13 route (a critical field in the scorer) disagreement is caught (oral vs IV)', () => {
    const r = C.reconcileMedication({ name: 'Pantoprazole', route: 'oral' }, { name: 'Pantoprazole', route: 'IV', confidence: 0.95 }, T);
    expect(r.decision).toBe('human_confirm');
  });
  it('ROUTE-14 cloud missing the entity -> human confirm, device value kept', () => {
    const d = { name: 'Zifi' };
    expect(C.reconcileMedication(d, undefined, T)).toMatchObject({ decision: 'human_confirm', value: d });
  });
  it('ROUTE-15 low cloud confidence (< humanReview) -> human confirm', () => {
    expect(C.reconcileLab({ test: 'Hb', value: '13.5' }, { test: 'Hb', value: '13.5', confidence: 0.3 }, T).decision).toBe('human_confirm');
  });
  it('ROUTE-16 lab value 13.50 vs 13.5 agrees; 13.5 vs 15.3 disagrees', () => {
    expect(C.reconcileLab({ test: 'Hb', value: '13.50' }, { test: 'Hb', value: '13.5', confidence: 0.9 }, T).decision).toBe('accept_on_device');
    expect(C.reconcileLab({ test: 'Hb', value: '13.5' }, { test: 'Hb', value: '15.3', confidence: 0.9 }, T).decision).toBe('human_confirm');
  });
});

describe.skipIf(!parsing.mod.fieldsBelowThreshold)('ROUTING: parsing fieldsBelowThreshold', () => {
  const ext = (o: Partial<any> = {}) => ({
    documentType: 'prescription', documentTypeConfidence: 0.95,
    rawText: 'Patient: Rajesh Kumar Mob 9876543210\nTab Zifi 200 mg BD 5 days',
    medications: [{ name: 'Zifi', nameConfidence: 0.95, dose: '200 mg', doseConfidence: 0.849, frequency: 'BD', frequencyConfidence: 0.85, duration: null, durationConfidence: 0.9 }],
    labResults: [], ...o,
  });
  it('ROUTE-20 strict "<" threshold at the agreed 0.85: 0.849 routed, 0.85 not routed', () => {
    const paths = parsing.mod.fieldsBelowThreshold(ext()).map((f: any) => f.path);
    expect(paths).toContain('medications[0].dose');
    expect(paths).not.toContain('medications[0].frequency');
  });
  it('ROUTE-21 includeUnreadable routes null values even when confident', () => {
    expect(parsing.mod.fieldsBelowThreshold(ext(), { includeUnreadable: true }).map((f: any) => f.path)).toContain('medications[0].duration');
  });
  it('ROUTE-22 routed payload never carries rawText or patient identifiers', () => {
    const json = JSON.stringify(parsing.mod.fieldsBelowThreshold(ext(), { threshold: 1 }));
    expect(json).not.toMatch(/Rajesh|9876543210/);
  });
  it('ROUTE-23 NaN confidence is routed (never silently accepted)', () => {
    const e = ext(); e.medications[0].nameConfidence = Number.NaN;
    expect(parsing.mod.fieldsBelowThreshold(e).map((f: any) => f.path)).toContain('medications[0].name');
  });
});

describe('ROUTING: core and parsing agree on the cloud threshold', () => {
  it.skipIf(!C.DEFAULT_THRESHOLDS)('ROUTE-25 core default thresholds match the agreed policy: acceptOnDevice 0.85, humanReview 0.5', () => {
    expect(C.DEFAULT_THRESHOLDS).toMatchObject({ acceptOnDevice: 0.85, humanReview: 0.5 });
  });
  it.skipIf(!C.DEFAULT_THRESHOLDS || !parsing.mod.DEFAULT_CLOUD_ROUTE_THRESHOLD)('ROUTE-24 one routing threshold, not two (core acceptOnDevice vs parsing DEFAULT_CLOUD_ROUTE_THRESHOLD)', () => {
    expect(parsing.mod.DEFAULT_CLOUD_ROUTE_THRESHOLD).toBe(C.DEFAULT_THRESHOLDS.acceptOnDevice);
  });
});

describe.skipIf(!C.runPipeline)('ROUTING: core runPipeline mechanics', () => {
  it('ROUTE-30 records site per stage and sums metrics into totals', async () => {
    const a = localStage('a', 'ocr', (d) => ({ kind: 'text', text: 'x' }), { site: 'on_device', metrics: { latencyMs: 5, costUsd: 0, bytesSent: 0 } });
    const b = localStage('b', 'structure', (d) => ({ kind: 'fields', doc: doc([]) }), { site: 'in_cloud', metrics: { latencyMs: 7, costUsd: 0.002, bytesSent: 1234 } });
    const run = await C.runPipeline({ id: 'p', name: 'p', stages: [a, b] }, { kind: 'text', text: 'in' }, { docId: 'd' });
    expect(run.steps.map((s: any) => s.site)).toEqual(['on_device', 'in_cloud']);
    expect(run.totals).toMatchObject({ latencyMs: 12, costUsd: 0.002, bytesSent: 1234 });
  });
  it('ROUTE-31 input-kind mismatch fails the run with a clear error and keeps the partial trace', async () => {
    const a = localStage('a', 'ocr', () => ({ kind: 'text', text: 'x' }));
    const imgOnly = { ...localStage('img', 'ocr', (d) => d), accepts: ['image'] };
    const run = await C.runPipeline({ id: 'p', name: 'p', stages: [a, imgOnly] }, { kind: 'text', text: 'in' }, { docId: 'd' });
    expect(run.failed).toBe(true);
    expect(run.error).toMatch(/does not accept/);
    expect(run.steps).toHaveLength(1);
  });
  it('ROUTE-32 a throwing stage is recorded with its error and the run stops', async () => {
    const boom = { ...localStage('boom', 'verify', () => { throw new Error('kaput'); }) };
    const after = localStage('after', 'verify', (d) => d);
    const run = await C.runPipeline({ id: 'p', name: 'p', stages: [boom, after] }, { kind: 'text', text: 'in' }, { docId: 'd' });
    expect(run.failed).toBe(true);
    expect(run.steps.map((s: any) => s.stageId)).toEqual(['boom']);
    expect(run.steps[0].error).toBe('kaput');
  });
  it('ROUTE-33 totals include the latency of the stage that failed', async () => {
    let t = 0; const now = () => (t += 10);
    const boom = localStage('boom', 'verify', () => { throw new Error('x'); });
    const run = await C.runPipeline({ id: 'p', name: 'p', stages: [boom] }, { kind: 'text', text: 'in' }, { docId: 'd', now });
    expect(run.totals.latencyMs).toBe(run.steps[0].metrics.latencyMs);
  });
  it('ROUTE-34 readingText returns the OCR text, not the de-identified text', () => {
    const run = { steps: [
      { stageKind: 'deid', output: { kind: 'text', text: '[NAME]' } },
      { stageKind: 'ocr', output: { kind: 'text', text: 'Rajesh' } },
    ] };
    expect(C.readingText(run)).toBe('Rajesh');
  });
});

// apps/web hybridVerify stage with mocks
let web: any; try { web = await import('../../apps/web/src/stages.ts'); } catch { web = undefined; }
describe.skipIf(!web?.hybridVerify)('ROUTING: apps/web hybridVerify (Nano + Firebase mocked)', () => {
  let spy: EgressSpy; let nano: NanoMock;
  beforeEach(() => { spy = new EgressSpy().install().respond(() => ({})); nano = installNanoMock(); const R = qa(); R.nano = nano; R.calls = []; });
  afterEach(() => { spy.uninstall(); nano.uninstall(); });
  const input = (meds: any[]) => ({ kind: 'fields', doc: doc(meds), text: SRC });

  it('ROUTE-40 only low-confidence entity names are listed in the cloud request', async () => {
    qa().cloudReply = () => JSON.stringify(doc([{ name: 'Zifi', strength: '500 mg', frequency: 'BD', confidence: 0.9 }]));
    await web.hybridVerify(T).run(input([med('Metformin', 0.95), med('Zifi', 0.5)]), { runId: 'r', docId: 'd' });
    const body = spy.records[0]!.body;
    expect(body).toMatch(/Only return entries for these items: \{\\"medications\\":\[\\"Zifi\\"\]/);
  });
  it('ROUTE-41 the cloud answer replaces only routed entities; on-device ones are untouched', async () => {
    qa().cloudReply = () => JSON.stringify(doc([{ name: 'Zifi', strength: '500 mg', frequency: 'BD', confidence: 0.9 }, { name: 'Metformin', strength: '1000 mg', confidence: 0.9 }]));
    const r = await web.hybridVerify(T).run(input([med('Metformin', 0.95), med('Zifi', 0.5, { frequency: 'BD' })]), { runId: 'r', docId: 'd' });
    expect(r.output.doc.medications[0].strength).toBe('500 mg');
    expect(r.site).toBe('in_cloud');
  });
  it('ROUTE-42 cloud disagreement adds a HUMAN CONFIRM abstention', async () => {
    qa().cloudReply = () => JSON.stringify(doc([{ name: 'Zifi', strength: '500 mg', frequency: 'TDS', confidence: 0.9 }]));
    const r = await web.hybridVerify(T).run(input([med('Zifi', 0.5, { frequency: 'BD' })]), { runId: 'r', docId: 'd' });
    expect(r.output.doc.abstentions.join(' ')).toMatch(/HUMAN CONFIRM medication "Zifi": frequency/);
  });
  it('ROUTE-43 cloud returning the same drug with a form prefix ("Tab. Zifi" vs "Zifi") still reconciles instead of "cloud_missing"', async () => {
    qa().cloudReply = () => JSON.stringify(doc([{ name: 'Tab. Zifi', strength: '500 mg', confidence: 0.9 }]));
    const r = await web.hybridVerify(T).run(input([med('Zifi', 0.5)]), { runId: 'r', docId: 'd' });
    expect(r.output.doc.abstentions.join(' ')).not.toMatch(/cloud_missing/);
  });
  it('ROUTE-44 malformed cloud JSON does not crash the stage (falls back to device values + human confirm)', async () => {
    qa().cloudReply = () => 'Sorry, I cannot help with that.';
    const r = await web.hybridVerify(T).run(input([med('Zifi', 0.5)]), { runId: 'r', docId: 'd' }).catch((e: Error) => ({ thrown: e.message }));
    expect(r).not.toHaveProperty('thrown');
  });
});
