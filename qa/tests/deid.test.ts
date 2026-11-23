/**
 * Area: DEID - no PII/PHI may ever reach the cloud.
 * Unit level: every exported de-identifier vs the adversarial corpus.
 * System level: the real apps/web Stages run through core's runPipeline with
 * Gemini Nano + Firebase AI Logic mocked; the EgressSpy inspects every byte.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { core, parsing, pick } from '../src/core.ts';
import { EgressSpy } from '../src/egress.ts';
import { FULL_RX, PII_CASES, findLeaks, type PiiCase } from '../src/pii.ts';
import { installNanoMock, type NanoMock } from '../src/mocks/nano.ts';
import { qa } from '../src/mocks/firebase-ai-sdk.ts';
import { firebaseStructureStage, nanoOcrStage, tinyPng } from '../src/mocks/stages.ts';

type Deid = (s: string) => { text: string };
const impls: [string, Deid | undefined][] = [
  ['core', core.mod.deidentify as Deid | undefined],
  ['parsing', parsing.mod.deidentify as Deid | undefined],
];
const CASES: PiiCase[] = [...PII_CASES, FULL_RX];

describe('DEID: exported de-identifiers', () => {
  it('DEID-00 at least one de-identifier is exported publicly', () => {
    expect(pick('deidentify')).toBeTypeOf('function');
  });

  for (const [who, fn] of impls) {
    describe.skipIf(!fn)(`DEID [${who}] adversarial corpus`, () => {
      it.each(CASES.map((c) => [c.id, c.title, c] as const))(`DEID-${who}-%s %s: no identifier survives`, (_id, _t, c) => {
        const out = fn!(c.text).text;
        const leaks = findLeaks(out, c.pii);
        const l2 = leaks.map((l) => `${l.type}:${l.value} (${l.how})`);
        expect(l2, `leaked ${JSON.stringify(l2)} in output ${JSON.stringify(out)}`).toEqual([]);
      });
      it.each(CASES.filter((c) => c.keep.length).map((c) => [c.id, c] as const))(`DEID-${who}-KEEP-%s clinical content survives (no over-redaction)`, (_id, c) => {
        const out = fn!(c.text).text;
        for (const k of c.keep) expect(out, `"${k}" was redacted`).toContain(k);
      });
      it(`DEID-${who}-IDEM de-identifying twice is stable (placeholders are not re-redacted or mangled)`, () => {
        const once = fn!(FULL_RX.text).text;
        expect(fn!(once).text).toBe(once);
      });
      it(`DEID-${who}-LAB lab tables with long numbers are not mistaken for IDs`, () => {
        const t = 'Platelet Count 250000 /cumm 150000-450000\nTLC 7800 /cumm\nHbA1c 7.8 %\nVitamin B12 245 pg/mL 211-911';
        expect(fn!(t).text).toBe(t);
      });
    });
  }
  it.skipIf(!!parsing.mod.deidentify)('DEID-parsing-EXPORT @med-ocr/parsing exports its de-identifier (src/deid exists but is not in the public index)', () => {
    expect(parsing.mod.deidentify).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// System level: apps/web Stages through core.runPipeline with mocked Nano/Firebase
// ---------------------------------------------------------------------------
let web: any;
try { web = await import('../../apps/web/src/stages.ts'); } catch (e) { web = { __error: (e as Error).message }; }
const runPipeline = core.mod.runPipeline as (p: any, i: any, o: any) => Promise<any>;

/** What Nano returns: transcript for the read prompt, JSON for the structure prompt. */
function scriptNano(nano: NanoMock, transcript: string, doc: object) {
  nano.set({ respond: (p) => (p.includes('Extract medications') ? JSON.stringify(doc) : transcript) });
}
const LOWCONF_DOC = { documentType: 'prescription', labResults: [], medications: [
  { name: 'Metformin', strength: '500 mg', frequency: '1-0-1', confidence: 0.95 },
  { name: 'Telmisartan', strength: '40mg', frequency: 'OD', confidence: 0.55 }, // below 0.85 -> cloud verify
] };
const CLEAN_RX = 'Rx\n1. Tab. Metformin 500 mg 1-0-1 x 30 days\n2. Tab. Telmisartan 40mg OD after food\nHbA1c 7.8 %';
const HIGHCONF_DOC = { ...LOWCONF_DOC, medications: LOWCONF_DOC.medications.map((m) => ({ ...m, confidence: 0.97 })) };
/** What Nano would emit if it obeyed READ_PROMPT perfectly (it is only asked to redact names, phones, ABHA/Aadhaar, reg nos). */
const OBEDIENT_TRANSCRIPT = FULL_RX.text.replace('Rajesh Kumar', '[REDACTED]').replace('+91 98765 43210', '[REDACTED]').replace('2345 6789 0123', '[REDACTED]');

describe.skipIf(!web?.pipelines)('DEID: end-to-end through apps/web pipelines (Nano + Firebase mocked)', () => {
  let spy: EgressSpy; let nano: NanoMock;
  beforeEach(() => {
    spy = new EgressSpy().install().respond(() => ({}));
    nano = installNanoMock();
    const R = qa(); R.nano = nano; R.calls = [];
    R.cloudReply = () => JSON.stringify({ documentType: 'prescription', labResults: [], medications: [{ name: 'Telmisartan', strength: '40mg', frequency: 'OD', confidence: 0.9 }] });
  });
  afterEach(() => { spy.uninstall(); nano.uninstall(); });
  const P = (id: string) => web.pipelines({ acceptOnDevice: 0.85, humanReview: 0.5 }).find((p: any) => p.id === id);
  const input = { kind: 'image', image: tinyPng('rx') };

  it('DEID-E2E-01 hybrid: Nano leaves PII in the transcript -> cloud-verify payload contains no PII', async () => {
    scriptNano(nano, FULL_RX.text, LOWCONF_DOC);
    const run = await runPipeline(P('hybrid'), input, { docId: 'full' });
    if (spy.attempts === 0) expect(JSON.stringify(run.final), 'cloud call skipped without a HUMAN CONFIRM / blocked flag').toMatch(/HUMAN CONFIRM|blocked/i);
    const leaks = spy.leaks(FULL_RX.pii).map((l) => `${l.type}:${l.value}`);
    expect(leaks, `leaked ${JSON.stringify(leaks)}; stage notes ${JSON.stringify(run.steps.map((s: any) => s.notes))}`).toEqual([]);
  });

  it('DEID-E2E-02 hybrid: even if Nano obeys READ_PROMPT perfectly, DOB/address/PIN must not reach the cloud', async () => {
    scriptNano(nano, OBEDIENT_TRANSCRIPT, LOWCONF_DOC);
    await runPipeline(P('hybrid'), input, { docId: 'obedient' });
    const leaks = spy.leaks(FULL_RX.pii).map((l) => `${l.type}:${l.value}`);
    expect(leaks, `leaked ${JSON.stringify(leaks)}`).toEqual([]);
  });

  it('DEID-E2E-03 hybrid: no image bytes are ever sent to the cloud', async () => {
    scriptNano(nano, FULL_RX.text, LOWCONF_DOC);
    await runPipeline(P('hybrid'), input, { docId: 'img' });
    expect(spy.binaryEgress()).toEqual([]);
  });

  it('DEID-E2E-04 hybrid: all entities confident and grounded -> zero bytes leave the device', async () => {
    scriptNano(nano, FULL_RX.text, HIGHCONF_DOC);
    const run = await runPipeline(P('hybrid'), input, { docId: 'hi' });
    expect(run.failed).toBe(false);
    expect(spy.attempts).toBe(0);
    expect(run.totals.bytesSent).toBe(0);
  });

  it('DEID-E2E-05 on-device-only: zero egress', async () => {
    scriptNano(nano, FULL_RX.text, LOWCONF_DOC);
    const run = await runPipeline(P('on-device-only'), input, { docId: 'dev' });
    expect(run.failed).toBe(false);
    expect(spy.attempts).toBe(0);
  });

  it('DEID-E2E-06 cloud-only: raw document image and raw transcript must not be uploaded for user documents', async () => {
    R_cloudTranscript(FULL_RX.text);
    await runPipeline(P('cloud-only'), input, { docId: 'cloud' });
    expect({ imageUploads: spy.binaryEgress().length, leaks: spy.leaks(FULL_RX.pii).length }).toEqual({ imageUploads: 0, leaks: 0 });
  });

  it('DEID-E2E-08 hybrid: residual identifiers that neither de-identifier nor the cloud guard knows (DOB, spaced PIN, unlabelled lowercase name, glued phone) must not reach the cloud', async () => {
    const t = 'sunita devi w/o ramesh yadav\nDOB 14/03/1987  Hyderabad 500 080\nCallon9876543210forreports\nRx\nTab. Metformin 500 mg 1-0-1\nTab. Telmisartan 40mg OD';
    const pii = [{ type: 'name', value: 'sunita devi' }, { type: 'dob', value: '14/03/1987' }, { type: 'pincode', value: '500080' }, { type: 'phone', value: '9876543210' }] as const;
    scriptNano(nano, t, LOWCONF_DOC);
    await runPipeline(P('hybrid'), input, { docId: 'residual' });
    const leaks = spy.leaks(pii as any).map((l) => `${l.type}:${l.value}`);
    expect(leaks, `leaked ${JSON.stringify(leaks)} (cloud attempts: ${spy.attempts})`).toEqual([]);
  });

  // One residual identifier at a time, so the fail-closed guard is not tripped by some other identifier in the same text.
  it.each([
    ['DOB', 'DOB: 14/03/1987', { type: 'dob', value: '14/03/1987' }],
    ['DOB-words', 'Born on 14th March 1987', { type: 'dob', value: '14th March 1987' }],
    ['PIN-spaced', 'Hyderabad 500 080', { type: 'pincode', value: '500080' }],
    ['phone-fullwidth', 'Mobile：９８７６５４３２１０', { type: 'phone', value: '9876543210' }],
    ['phone-glued', 'Callon9876543210forreports', { type: 'phone', value: '9876543210' }],
    ['name-devanagari', 'रोगी: अनीता शर्मा', { type: 'name', value: 'अनीता शर्मा' }],
    ['name-lowercase', 'sunita devi', { type: 'name', value: 'sunita devi' }],
    ['hospital-number', 'Hospital number: 2023/BF/057', { type: 'mrn', value: '2023/BF/057' }],
    ['aadhaar-dotted', 'UID:2345.6789.0123', { type: 'aadhaar', value: '234567890123' }],
    ['PAN', 'PAN abcpk1234f', { type: 'pan', value: 'ABCPK1234F' }],
  ] as const)('DEID-E2E-09 %s alone in the transcript does not reach the cloud (core deid + parsing guard together)', async (_k, line, p) => {
    scriptNano(nano, `${line}\n${CLEAN_RX}`, LOWCONF_DOC);
    await runPipeline(P('hybrid'), input, { docId: 'one' });
    const leaks = spy.leaks([p as any]);
    expect(leaks.length, `"${line}" reached the cloud (attempts ${spy.attempts})`).toBe(0);
  });

  it('DEID-E2E-07 reported bytesSent matches bytes actually observed on the wire (within 10%)', async () => {
    scriptNano(nano, CLEAN_RX, LOWCONF_DOC);
    const run = await runPipeline(P('hybrid'), input, { docId: 'bytes' });
    const observed = spy.totalBytes;
    expect(observed).toBeGreaterThan(0);
    const ratio = run.totals.bytesSent / observed;
    expect(ratio, `reported=${run.totals.bytesSent} observed=${observed}`).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThanOrEqual(1.1);
  });
});
function R_cloudTranscript(t: string) { qa().cloudReply = (body: any) => (body.generationConfig?.responseMimeType === 'application/json' ? '{"medications":[],"labResults":[]}' : t); }

it.skipIf(!!web?.pipelines)('DEID-E2E-00 apps/web stages import under the QA mocks', () => { expect(web.__error).toBeUndefined(); });

describe.skipIf(!web?.pipelines)('DEID: pipeline structure', () => {
  it('DEID-S01 every pipeline that contains a cloud stage runs a deid stage before it', () => {
    const bad: string[] = [];
    for (const p of web.pipelines({ acceptOnDevice: 0.85, humanReview: 0.5 })) {
      const firstCloud = p.stages.findIndex((s: any) => /cloud/i.test(s.id));
      if (firstCloud < 0) continue;
      const deidBefore = p.stages.slice(0, firstCloud).some((s: any) => s.kind === 'deid');
      if (!deidBefore) bad.push(`${p.id}: ${p.stages.map((s: any) => `${s.id}(${s.kind})`).join(' -> ')}`);
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Runner guard: core.runPipeline must not hand raw text to an in_cloud stage
// ---------------------------------------------------------------------------
describe.skipIf(!runPipeline)('DEID: core runner guard', () => {
  let spy: EgressSpy; let nano: NanoMock;
  beforeEach(() => { spy = new EgressSpy().install().respond(() => ({})); nano = installNanoMock({ respond: () => FULL_RX.text }); });
  afterEach(() => { spy.uninstall(); nano.uninstall(); });

  it('DEID-G01 runPipeline refuses (or de-identifies) when an in_cloud stage would receive text that never passed a deid stage', async () => {
    const p = { id: 'naive', name: 'naive', stages: [nanoOcrStage(nano), firebaseStructureStage(nano)] };
    const run = await runPipeline(p, { kind: 'text', text: 'scan' }, { docId: 'g1' });
    const leaked = spy.leaks(FULL_RX.pii).length;
    expect(leaked === 0 || run.failed, `leaked ${leaked} identifiers through a pipeline with no deid stage`).toBe(true);
  });
  it('DEID-G02 an image carried in StageData.image is not forwarded to an in_cloud stage', async () => {
    const p = { id: 'img', name: 'img', stages: [nanoOcrStage(nano, { keepImage: true }), firebaseStructureStage(nano)] };
    await runPipeline(p, { kind: 'image', image: tinyPng('a') }, { docId: 'g2' }).catch(() => undefined);
    expect(spy.binaryEgress()).toEqual([]);
  });
});
