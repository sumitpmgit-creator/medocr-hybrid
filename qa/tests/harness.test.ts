/** Area: HARNESS - the QA instruments themselves must be trustworthy before we trust their verdicts. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EgressSpy } from '../src/egress.ts';
import { ALL_PII, FULL_RX, PII_CASES, findLeaks } from '../src/pii.ts';
import { installNanoMock, type NanoMock } from '../src/mocks/nano.ts';
import { getAI, getGenerativeModel, InferenceMode, CLOUD_URL } from '../src/mocks/firebase-ai.ts';
import { ece, levenshtein, oracleCer } from '../src/oracle.ts';

describe('HARNESS: PII leak scanner', () => {
  it.each(PII_CASES.map((c) => [c.id, c] as const))('HAR-01 %s: scanner detects every identifier in its raw case text', (_id, c) => {
    const found = findLeaks(c.text, c.pii);
    expect(found.map((f) => f.value).sort()).toEqual(c.pii.map((p) => p.value).sort());
  });

  it('HAR-02 scanner detects PII hidden in JSON-escaped, URL-encoded and base64 payloads', () => {
    const raw = FULL_RX.text;
    expect(findLeaks(JSON.stringify({ contents: [{ parts: [{ text: raw }] }] }), FULL_RX.pii).length).toBe(FULL_RX.pii.length);
    expect(findLeaks(`q=${encodeURIComponent(raw)}`, FULL_RX.pii).length).toBe(FULL_RX.pii.length);
    expect(findLeaks(JSON.stringify({ blob: Buffer.from(raw).toString('base64') }), FULL_RX.pii).length).toBe(FULL_RX.pii.length);
  });

  it('HAR-03 scanner has no false positives on properly de-identified clinical text', () => {
    const clean = [
      'Patient: [NAME_1]  Age/Sex: 38Y/M  DOB: [DATE_1]',
      'Mob: [PHONE_1]  Aadhaar: [ID_1]  [MRN_1]',
      'Addr: [ADDRESS_1]',
      '1. Tab. Metformin 500 mg 1-0-1 x 30 days',
      '2. Tab. Telmisartan 40mg OD after food',
      'HbA1c 7.8 %  Platelets 2,50,000 /cumm  Hemoglobin 13.5 g/dL',
    ].join('\n');
    expect(findLeaks(clean, ALL_PII)).toEqual([]);
  });
});

describe('HARNESS: egress spy', () => {
  let spy: EgressSpy;
  let nano: NanoMock;
  beforeEach(() => { spy = new EgressSpy().install(); nano = installNanoMock(); });
  afterEach(() => { spy.uninstall(); nano.uninstall(); });

  it('HAR-10 deny mode blocks and records real fetch', async () => {
    await expect(fetch('https://example.com/x', { method: 'POST', body: 'hello' })).rejects.toThrow(/blocked/);
    expect(spy.records).toHaveLength(1);
    expect(spy.records[0]).toMatchObject({ channel: 'fetch', bytes: 5, blocked: true });
  });

  it('HAR-11 offline mode fails like a browser with no network', async () => {
    spy.offline();
    await expect(fetch('https://example.com')).rejects.toBeInstanceOf(TypeError);
  });

  it('HAR-12 captures XHR, sendBeacon, WebSocket and node:https bodies', async () => {
    spy.respond(() => ({}));
    const xhr = new (globalThis as any).XMLHttpRequest(); xhr.open('POST', 'https://a.test'); xhr.send('x1');
    (globalThis as any).navigator?.sendBeacon?.('https://b.test', 'x2');
    new (globalThis as any).WebSocket('wss://c.test').send('x3');
    const https = (await import('node:https')).default; const req = https.request({ hostname: 'd.test', path: '/p' }); req.on('error', () => {}); req.end('x4');
    const channels = spy.records.map((r) => r.channel);
    expect(channels).toEqual(expect.arrayContaining(['xhr', 'websocket', 'node-http']));
    expect(spy.records.map((r) => r.body)).toEqual(expect.arrayContaining(['x1', 'x3', 'x4']));
  });

  it('HAR-13 flags image parts in a cloud payload as binary egress', async () => {
    spy.respond(() => ({ text: 'ok' }));
    await fetch(CLOUD_URL, { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: 'A'.repeat(64) } }] }] }) });
    expect(spy.binaryEgress()).toHaveLength(1);
  });

  it('HAR-14 Firebase mock PREFER_ON_DEVICE silently falls back to cloud when Nano is unavailable (the hazard our DEID tests guard against)', async () => {
    spy.respond(() => ({ text: '{}' }));
    nano.set({ availability: 'unavailable' });
    const m = getGenerativeModel(getAI(), { mode: InferenceMode.PREFER_ON_DEVICE, nano });
    const r = await m.generateContent(FULL_RX.text);
    expect(r.response.inferenceSource).toBe('in_cloud');
    expect(spy.leaks(FULL_RX.pii).length).toBe(FULL_RX.pii.length);
  });

  it('HAR-15 Firebase mock ONLY_ON_DEVICE never touches the network', async () => {
    const m = getGenerativeModel(getAI(), { mode: InferenceMode.ONLY_ON_DEVICE, nano });
    const r = await m.generateContent(FULL_RX.text);
    expect(r.response.inferenceSource).toBe('on_device');
    expect(spy.attempts).toBe(0);
    nano.set({ availability: 'unavailable' });
    await expect(m.generateContent('x')).rejects.toThrow(/not available/);
    expect(spy.attempts).toBe(0);
  });

  it('HAR-16 Firebase mock PREFER_IN_CLOUD falls back to Nano when offline', async () => {
    spy.offline();
    const m = getGenerativeModel(getAI(), { mode: InferenceMode.PREFER_IN_CLOUD, nano });
    const r = await m.generateContent('hello');
    expect(r.response.inferenceSource).toBe('on_device');
    expect(spy.attempts).toBe(1); // it tried the cloud first: that attempt is itself egress
  });
});

describe('HARNESS: oracles', () => {
  it('HAR-20 reference Levenshtein matches textbook values', () => {
    expect(levenshtein([...'kitten'], [...'sitting'])).toBe(3);
    expect(levenshtein([...''], [...'abc'])).toBe(3);
    expect(oracleCer('abcd', 'abcd')).toBe(0);
  });
  it('HAR-21 ECE is 0 for perfectly calibrated and large for over-confident scores', () => {
    expect(ece([0.25, 0.25, 0.25, 0.25], [1, 0, 0, 0])).toBeCloseTo(0, 6);
    expect(ece([0.95, 0.95, 0.95, 0.95], [0, 0, 0, 1])).toBeCloseTo(0.7, 6);
  });
});
