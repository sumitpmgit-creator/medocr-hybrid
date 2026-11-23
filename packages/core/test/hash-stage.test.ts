import { describe, expect, it } from 'vitest';
import {
  canonicalJson, sha256Hex, hashValue, assertSerializable, NotSerializableError,
  defineStage, describeStage, StageRegistry, createRemoteStage, runtimeToSite, StageContractError, RemoteStageError,
  type FetchLike, type Stage, type StageData,
} from '../src/index.js';

const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: 'AAAA' } };
const ctx = { runId: 'r', docId: 'd' };

describe('hash', () => {
  it('sha256 matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
    expect(sha256Hex('दवा 500 mg')).toHaveLength(64);
  });
  it('canonicalJson sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(hashValue({ x: 1, y: 2 })).toBe(hashValue({ y: 2, x: 1 }));
  });
  it('rejects non-serialisable values', () => {
    expect(() => assertSerializable({ f: () => 1 })).toThrow(NotSerializableError);
    expect(() => assertSerializable({ n: Number.NaN })).toThrow(/non-finite/);
    expect(() => assertSerializable({ d: new Date() })).toThrow(/Date/);
    const cyc: Record<string, unknown> = {}; cyc.self = cyc;
    expect(() => assertSerializable(cyc)).toThrow(/cycle/);
    expect(() => assertSerializable([undefined])).toThrow(/undefined array item/);
    const shared = { a: 1 };
    expect(() => assertSerializable({ x: shared, y: shared })).not.toThrow(); // DAG is fine
  });
});

describe('stage metadata, defineStage, registry', () => {
  const tesseract = defineStage({
    id: 'tesseract', version: '5.4.0', kind: 'ocr', runtime: 'local-oss', inputs: ['image'],
    model: { family: 'tesseract', name: 'Tesseract OCR', license: 'Apache-2.0' }, cost: { usdPerPage: 0, basis: 'estimate' }, latency: { p50Ms: 800 },
    deterministic: true,
    run: async () => ({ output: { kind: 'text', text: 'Tab Augmentin 625 mg BD' }, metrics: { latencyMs: 5 } }),
  });

  it('describeStage fills defaults for legacy stages', () => {
    const legacy: Stage = { id: 'old', name: 'Old', kind: 'structure', accepts: ['text'], run: async () => { throw new Error('x'); } };
    expect(describeStage(legacy)).toMatchObject({ id: 'old', version: '0', runtime: 'code', inputs: ['text'], outputs: ['fields'], sendsDataOffDevice: false });
    expect(describeStage(tesseract)).toMatchObject({ version: '5.4.0', runtime: 'local-oss', model: { family: 'tesseract' }, deterministic: true });
  });

  it('defineStage fills site/kind and returns a serialisable copy', async () => {
    const r = await tesseract.run(image, ctx);
    expect(r).toMatchObject({ stageId: 'tesseract', stageKind: 'ocr', site: 'server_gpu', metrics: { latencyMs: 5, costUsd: 0, bytesSent: 0 } });
    expect(runtimeToSite('device')).toBe('on_device');
    expect(runtimeToSite('cloud')).toBe('in_cloud');
  });

  it('enforces input/output kinds and serialisability', async () => {
    await expect(tesseract.run({ kind: 'text', text: 'x' }, ctx)).rejects.toThrow(StageContractError);
    const wrongOut = defineStage({ id: 'w', version: '1', kind: 'ocr', runtime: 'code', inputs: ['image'], run: async () => ({ output: { kind: 'fields', doc: { documentType: 'other', medications: [], labResults: [] } } }) });
    await expect(wrongOut.run(image, ctx)).rejects.toThrow(/declared outputs/);
    const bad = defineStage({ id: 'b', version: '1', kind: 'ocr', runtime: 'code', inputs: ['image'], run: async () => ({ output: { kind: 'text', text: 'x' }, confidence: Number.NaN }) });
    await expect(bad.run(image, ctx)).rejects.toThrow(/non-finite/);
  });

  it('honours AbortSignal', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(tesseract.run(image, { ...ctx, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('registry creates, lists and filters stages', () => {
    const reg = new StageRegistry();
    reg.registerStage(tesseract);
    reg.register<{ size: '4B' | '9B' }>({
      meta: { id: 'qwen', version: '1', name: 'Qwen', kind: 'structure', runtime: 'local-oss', inputs: ['text', 'image'], outputs: ['fields'] },
      create: (c) => defineStage({ id: `qwen-${c.size}`, version: '1', kind: 'structure', runtime: 'local-oss', inputs: ['text'], run: async () => ({ output: { kind: 'fields', doc: { documentType: 'other', medications: [], labResults: [] } } }) }),
    });
    expect(reg.create<{ size: '4B' | '9B' }>('qwen', { size: '9B' }).id).toBe('qwen-9B');
    expect(reg.list().map((m) => m.id)).toEqual(['qwen', 'tesseract']);
    expect(reg.list({ produces: 'fields' }).map((m) => m.id)).toEqual(['qwen']);
    expect(reg.list({ kind: 'ocr', runtime: 'local-oss' }).map((m) => m.id)).toEqual(['tesseract']);
    expect(() => reg.registerStage(tesseract)).toThrow(/already registered/);
    expect(() => reg.create('surya')).toThrow(/Unknown stage "surya"/);
  });
});

describe('createRemoteStage (OSS model server adapter)', () => {
  const okFetch = (body: unknown, seen: { url?: string; body?: string; signal?: AbortSignal }[] = []): FetchLike => async (url, init) => {
    seen.push({ url, body: init.body, signal: init.signal });
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  it('PaddleOCR-style OCR server', async () => {
    const seen: { url?: string; body?: string }[] = [];
    const paddle = createRemoteStage({ id: 'paddleocr', version: 'vl-1.6', kind: 'ocr', inputs: ['image'], endpoint: 'http://gpu:8080/ocr', fetch: okFetch({ text: 'Augmentin 625', spans: [{ text: 'Augmentin 625', bbox: { x: 0, y: 0, w: 1, h: 0.1 }, confidence: 0.9 }] }, seen) });
    const r = await paddle.run(image, ctx);
    expect(r.site).toBe('server_gpu');
    expect(r.output).toMatchObject({ kind: 'text', text: 'Augmentin 625', spans: [{ confidence: 0.9 }] });
    expect(seen[0]!.url).toBe('http://gpu:8080/ocr');
    expect(JSON.parse(seen[0]!.body!)).toMatchObject({ input: { kind: 'image' } });
    expect(r.metrics.bytesSent).toBeGreaterThan(0);
  });

  it('Qwen-style structuring server, bare ClinicalDoc response, keeps OCR text', async () => {
    const qwen = createRemoteStage({ id: 'qwen', version: '3.5-4b', kind: 'structure', inputs: ['text'], endpoint: 'http://gpu/q', fetch: okFetch({ documentType: 'prescription', medications: [{ name: 'Augmentin' }], labResults: [], usage: { inputTokens: 10 } }) });
    const r = await qwen.run({ kind: 'text', text: 'Augmentin' }, ctx);
    expect(r.output.kind === 'fields' && r.output.text).toBe('Augmentin');
  });

  it('HTTP errors and malformed bodies throw', async () => {
    const f500: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'overloaded' });
    await expect(createRemoteStage({ id: 's', version: '1', kind: 'ocr', inputs: ['image'], endpoint: 'x', fetch: f500 }).run(image, ctx)).rejects.toThrow(RemoteStageError);
    await expect(createRemoteStage({ id: 's', version: '1', kind: 'ocr', inputs: ['image'], endpoint: 'x', fetch: okFetch({ nope: 1 }) }).run(image, ctx)).rejects.toThrow(/string "text"/);
  });
});
