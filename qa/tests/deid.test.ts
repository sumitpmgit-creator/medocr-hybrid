/**
 * Area: DEID - no PII/PHI may ever reach the cloud.
 * Unit level: every exported de-identifier vs the adversarial corpus.
 * System level: the real apps/web Stages run through core's runPipeline with
 * Gemini Nano + Firebase AI Logic mocked; the EgressSpy inspects every byte.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { core, parsing, pick } from '../src/core.ts';
import { EgressSpy } from '../src/egress.ts';
import { FULL_RX, NOT_DATES, PII_CASES, findLeaks, type PiiCase } from '../src/pii.ts';
import { readFileSync, existsSync } from 'node:fs';
import { pkgDir } from '../src/repo.ts';
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
      // ---- Date policy (Advisory, 23 Nov 2026): DOB -> [DOB]; every other date -> [DATE]; ages may stay ----
      it.each([['DOB: 14/03/1987'], ['D.O.B 1987-03-14'], ['Born on 14th March 1987'], ['dob 14.03.87']])(`DEID-${who}-POL-01 DOB "%s" becomes the [DOB] token`, (t) => {
        const out = fn!(t).text;
        expect(out, out).toContain('[DOB]');
        expect(out, out).not.toContain('[DATE]');
      });
      it.each([['Report Date: 20/11/2026'], ['Sample collected on 12-Oct-2026'], ['Admitted 2026-11-18'], ['Review on 5th December 2026']])(`DEID-${who}-POL-02 non-DOB date "%s" becomes the [DATE] token (not [DOB])`, (t) => {
        const out = fn!(t).text;
        expect(out, out).toContain('[DATE]');
        expect(out, out).not.toContain('[DOB]');
      });
      it.each(NOT_DATES.map((t) => [t]))(`DEID-${who}-POL-03 clinical look-alike "%s" is not turned into a date/ID token`, (t) => {
        expect(fn!(t).text).toBe(t);
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

  it('DEID-E2E-04 hybrid: all entities confident and grounded -> zero bytes leave the device (confidence routing at 0.85)', async () => {
    scriptNano(nano, CLEAN_RX, HIGHCONF_DOC); // clean text, so a zero-egress result is due to routing, not the guard blocking
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

  it('DEID-E2E-06a cloud baseline (sends the page image) is excluded for user uploads unless the user enables it', () => {
    expect(web.pipelinesForUi, 'pipelinesForUi not exported').toBeTypeOf('function');
    const ids = (o: any) => web.pipelinesForUi({ acceptOnDevice: 0.85, humanReview: 0.5 }, o).map((p: any) => p.id);
    expect(ids({ source: 'upload' })).not.toContain('cloud-only');
    expect(ids({ source: 'upload', userEnabled: true })).toContain('cloud-only');
    expect(ids({ source: 'benchmark' })).toContain('cloud-only');
  });
  it('DEID-E2E-06b cloud baseline: after cloud OCR, the transcript sent for structuring carries no PII', async () => {
    R_cloudTranscript(FULL_RX.text);
    await runPipeline(P('cloud-only'), input, { docId: 'cloud' });
    const textCalls = spy.records.filter((r) => !r.binary);
    const leaks = textCalls.flatMap((r) => findLeaks(r.body, FULL_RX.pii)).map((l) => `${l.type}:${l.value}`);
    expect(leaks, `leaked ${JSON.stringify(leaks)}`).toEqual([]);
  });
  it('DEID-E2E-06c cloud baseline labels its image egress for the privacy receipt', async () => {
    R_cloudTranscript(FULL_RX.text);
    const run = await runPipeline(P('cloud-only'), input, { docId: 'cloud' });
    expect(spy.binaryEgress().length).toBe(1);
    expect(JSON.stringify(run.steps[0].notes)).toMatch(/IMAGE_EGRESS_BYTES=\d+/);
  });
  it('DEID-E2E-10 dates reach the cloud only as [DATE] / [DOB] tokens; real dates stay on the device', async () => {
    const t = `DOB: 14/03/1987\nReport Date: 20/11/2026\n${CLEAN_RX}`;
    scriptNano(nano, t, LOWCONF_DOC);
    await runPipeline(P('hybrid'), input, { docId: 'dates' });
    const sent = spy.records.map((r) => r.body).join('\n');
    const leaks = spy.leaks([{ type: 'dob', value: '14/03/1987' }, { type: 'date', value: '20/11/2026' }]).map((l) => l.value);
    expect(leaks, 'raw date reached the cloud').toEqual([]);
    if (spy.attempts > 0) { expect(sent).toContain('[DOB]'); expect(sent).toContain('[DATE]'); }
    else expect.fail('cloud call was blocked instead of sending tokens: the policy is that non-DOB dates go to the cloud as [DATE]');
  });
  it('DEID-E2E-11 when the cloud guard blocks a document, the user still gets the on-device structured fields (not an empty result)', async () => {
    scriptNano(nano, FULL_RX.text, LOWCONF_DOC);
    const run = await runPipeline(P('hybrid'), input, { docId: 'blocked' });
    expect(spy.attempts).toBe(0);
    expect(run.final.kind).toBe('fields');
    expect(run.final.doc.medications.length, JSON.stringify(run.final.doc)).toBeGreaterThan(0);
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
  it('DEID-S01 every cloud stage that receives text runs after a deid stage (the gated, labelled cloud-read image baseline is the only exemption)', () => {
    const bad: string[] = [];
    for (const p of web.pipelines({ acceptOnDevice: 0.85, humanReview: 0.5 })) {
      const firstCloud = p.stages.findIndex((s: any) => /cloud/i.test(s.id) && !(p.id === (web.CLOUD_BASELINE_PIPELINE_ID ?? 'cloud-only') && s.id === 'cloud-read'));
      if (firstCloud < 0) continue;
      const deidBefore = p.stages.slice(0, firstCloud).some((s: any) => s.kind === 'deid');
      if (!deidBefore) bad.push(`${p.id}: ${p.stages.map((s: any) => `${s.id}(${s.kind})`).join(' -> ')}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('DEID: app wiring (static)', () => {
  const f = pkgDir('apps/web/src/main.ts');
  const main = existsSync(f) ? readFileSync(f, 'utf8') : '';
  it.skipIf(!main)('DEID-S02 main.ts picks pipelines for a user upload via pipelinesForUi / isCloudBaselineEnabled (raw-image baseline off by default)', () => {
    const usesAll = /for\s*\(const\s+\w+\s+of\s+pipelines\(/.test(main);
    const usesUi = /pipelinesForUi\(|isCloudBaselineEnabled\(/.test(main);
    expect({ loopsOverAllPipelines: usesAll, usesPipelinesForUi: usesUi }).toEqual({ loopsOverAllPipelines: false, usesPipelinesForUi: true });
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
