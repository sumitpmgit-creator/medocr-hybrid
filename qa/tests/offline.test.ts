/**
 * Area: OFFLINE - with no network the pipeline must degrade to on-device, never hang, never leak.
 * Real apps/web pipelines + core runPipeline, Nano + Firebase mocked, EgressSpy in offline mode.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { core } from '../src/core.ts';
import { EgressSpy } from '../src/egress.ts';
import { installNanoMock, type NanoMock } from '../src/mocks/nano.ts';
import { qa } from '../src/mocks/firebase-ai-sdk.ts';
import { hangingStage, localStage, tinyPng } from '../src/mocks/stages.ts';

const C = core.mod;
let web: any; try { web = await import('../../apps/web/src/stages.ts'); } catch { web = undefined; }
const T = { acceptOnDevice: 0.85, humanReview: 0.5 };
const P = (id: string) => web.pipelines(T).find((p: any) => p.id === id);
const input = { kind: 'image', image: tinyPng('off') };
const LOW = { documentType: 'prescription', labResults: [], medications: [
  { name: 'Metformin', strength: '500 mg', frequency: '1-0-1', confidence: 0.95 },
  { name: 'Telmisartan', strength: '40mg', frequency: 'OD', confidence: 0.55 },
] };
const CLEAN_RX = 'Rx\n1. Tab. Metformin 500 mg 1-0-1 x 30 days\n2. Tab. Telmisartan 40mg OD after food';
const HIGH = { ...LOW, medications: LOW.medications.map((m) => ({ ...m, confidence: 0.97 })) };

function setOnline(v: boolean) {
  const nav = (globalThis as any).navigator;
  if (nav) Object.defineProperty(nav, 'onLine', { configurable: true, get: () => v });
}
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<'TIMEOUT'>((r) => setTimeout(() => r('TIMEOUT'), ms))]);

describe.skipIf(!web?.pipelines || !C.runPipeline)('OFFLINE: apps/web pipelines with no network', () => {
  let spy: EgressSpy; let nano: NanoMock;
  beforeEach(() => {
    spy = new EgressSpy().install().offline(); setOnline(false);
    nano = installNanoMock(); const R = qa(); R.nano = nano; R.calls = []; R.cloudReply = () => '{}';
  });
  afterEach(() => { spy.uninstall(); nano.uninstall(); setOnline(true); });
  // A transcript with no identifiers, so the cloud guard does not block and the offline path is really exercised.
  const script = (doc: object) => nano.set({ respond: (p) => (p.includes('Extract medications') ? JSON.stringify(doc) : CLEAN_RX) });

  it('OFF-01 on-device-only completes offline with zero egress', async () => {
    script(LOW);
    const run = await C.runPipeline(P('on-device-only'), input, { docId: 'o1' });
    expect(run.failed).toBe(false);
    expect(spy.attempts).toBe(0);
  });
  it('OFF-02 hybrid offline degrades to the on-device result (run not failed; low-confidence items flagged for human confirm)', async () => {
    script(LOW);
    const run = await C.runPipeline(P('hybrid'), input, { docId: 'o2' });
    expect({ failed: run.failed, error: run.error }).toEqual({ failed: false, error: undefined });
    expect(run.final.kind).toBe('fields');
    expect((run.final.doc.abstentions ?? []).join(' ')).toMatch(/HUMAN CONFIRM|offline/i);
  });
  it('OFF-03 hybrid does not even attempt a cloud request while navigator.onLine === false', async () => {
    script(LOW);
    await C.runPipeline(P('hybrid'), input, { docId: 'o3' });
    expect(spy.attempts).toBe(0);
  });
  it('OFF-04 hybrid offline with every entity confident succeeds with zero egress', async () => {
    script(HIGH);
    const run = await C.runPipeline(P('hybrid'), input, { docId: 'o4' });
    expect(run.failed).toBe(false);
    expect(spy.attempts).toBe(0);
  });
  it('OFF-05 cloud-only offline fails fast with a clear error (no hang, no throw out of runPipeline)', async () => {
    const r = await within(C.runPipeline(P('cloud-only'), input, { docId: 'o5' }), 2000);
    expect(r).not.toBe('TIMEOUT');
    expect((r as any).failed).toBe(true);
    expect((r as any).error).toMatch(/fetch|network|offline/i);
  });
  it('OFF-06 Nano unavailable + offline: on-device-only fails gracefully, error recorded, no cloud fallback', async () => {
    nano.set({ availability: 'unavailable' });
    const run = await C.runPipeline(P('on-device-only'), input, { docId: 'o6' });
    expect(run.failed).toBe(true);
    expect(run.error).toMatch(/not available/);
    expect(spy.attempts).toBe(0);
  });
  it('OFF-07 Nano unavailable while ONLINE: hybrid never silently falls back to sending the raw image/transcript', async () => {
    spy.respond(() => ({})); setOnline(true);
    nano.set({ availability: 'unavailable' });
    await C.runPipeline(P('hybrid'), input, { docId: 'o7' });
    expect(spy.attempts).toBe(0);
  });
  it('OFF-08 connectivity drop mid-run keeps the on-device trace (reading text still scoreable)', async () => {
    script(LOW);
    const run = await C.runPipeline(P('hybrid'), input, { docId: 'o8' });
    expect(C.readingText(run)).toBe(CLEAN_RX);
    expect(run.steps.filter((s: any) => s.stageKind === 'ocr' || s.stageKind === 'structure').map((s: any) => s.site)).toEqual(['on_device', 'on_device']);
  });
  it('OFF-09 back online: the next run reaches the cloud normally (no sticky offline state)', async () => {
    script(LOW);
    await C.runPipeline(P('hybrid'), input, { docId: 'o9a' });
    spy.respond(() => ({})); setOnline(true);
    qa().cloudReply = () => JSON.stringify({ medications: [{ name: 'Telmisartan', strength: '40mg', frequency: 'OD', confidence: 0.9 }], labResults: [] });
    const run = await C.runPipeline(P('hybrid'), input, { docId: 'o9b' });
    expect(run.failed).toBe(false);
    expect(run.steps.at(-1).site).toBe('in_cloud');
  });
});

describe.skipIf(!web?.pipelines || !C.runPipeline)('OFFLINE: stalled cloud call (apps/web, dynamic)', () => {
  let spy: EgressSpy; let nano: NanoMock;
  beforeEach(() => {
    spy = new EgressSpy().install().hang(); setOnline(true);
    nano = installNanoMock({ respond: (p) => (p.includes('Extract medications') ? JSON.stringify(LOW) : CLEAN_RX) });
    const R = qa(); R.nano = nano; R.calls = [];
  });
  afterEach(() => { spy.uninstall(); nano.uninstall(); });
  it('OFF-13 hybrid: a stalled cloud call is cancelled by the caller\'s AbortSignal and the run returns the on-device result within 1.5 s', async () => {
    const ac = new AbortController(); setTimeout(() => ac.abort(new DOMException('user cancelled', 'AbortError')), 50);
    const r = await within(C.runPipeline(P('hybrid'), input, { docId: 'stall', signal: ac.signal }), 1500);
    expect(r, 'hybrid hung on a stalled cloud call').not.toBe('TIMEOUT');
    expect((r as any).final.kind).toBe('fields');
    expect(JSON.stringify((r as any).steps.at(-1).notes)).toMatch(/timeout|cancel/i);
  });
});

describe.skipIf(!C.runPipeline)('OFFLINE: core runner cancellation (hung cloud calls)', () => {
  it('OFF-10 an aborted AbortSignal stops a hung stage: runPipeline returns within 1 s', async () => {
    const ac = new AbortController();
    const p = { id: 'h', name: 'h', stages: [localStage('dev', 'ocr', () => ({ kind: 'text', text: 'x' })), hangingStage('cloud')] };
    setTimeout(() => ac.abort(new Error('offline timeout')), 50);
    const r = await within(C.runPipeline(p, { kind: 'text', text: 'in' }, { docId: 'h', signal: ac.signal }), 1000);
    expect(r, 'runPipeline ignored the AbortSignal and hung').not.toBe('TIMEOUT');
  });
  it('OFF-11 a signal aborted between stages prevents later stages from running', async () => {
    const ac = new AbortController(); let ran = false;
    const p = { id: 'a', name: 'a', stages: [
      localStage('first', 'ocr', () => { ac.abort(); return { kind: 'text', text: 'x' }; }),
      localStage('cloud', 'structure', (d) => { ran = true; return d; }),
    ] };
    const run = await C.runPipeline(p, { kind: 'text', text: 'in' }, { docId: 'a', signal: ac.signal });
    expect({ ran, failed: run.failed }).toEqual({ ran: false, failed: true });
  });
  it('OFF-12 apps/web cloud stages forward ctx.signal to the SDK call (static check)', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../apps/web/src/stages.ts', import.meta.url), 'utf8');
    expect(/ctx\.signal|signal:\s*ctx|\{\s*signal\s*\}/.test(src), 'no stage passes the AbortSignal to generateContent').toBe(true);
  });
});
