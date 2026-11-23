import { describe, expect, it } from 'vitest';
import {
  runPipelineResumable, MemoryCheckpointStore, checkpointKey, checkpointPrefix, defineStage,
  type ClinicalDoc, type Pipeline, type Stage, type StageData, type CheckpointRecord,
} from '../src/index.js';
import { FsCheckpointStore, type MinimalFs } from '../src/node.js';

const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: 'AAAA' } };
const doc: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'BD' }] };

function counted(id: string, kind: 'ocr' | 'structure' | 'verify', opts: { version?: string; text?: () => string; failTimes?: number } = {}) {
  const calls = { n: 0 };
  let failsLeft = opts.failTimes ?? 0;
  const stage = defineStage({
    id, version: opts.version ?? '1', kind, runtime: kind === 'ocr' ? 'local-oss' : 'cloud',
    inputs: kind === 'ocr' ? ['image'] : ['text', 'fields'],
    run: async (input) => {
      calls.n++;
      if (failsLeft > 0) { failsLeft--; throw new Error(`${id} transient`); }
      if (kind === 'ocr') return { output: { kind: 'text', text: opts.text?.() ?? 'Tab Augmentin 625 mg BD' } };
      return { output: { kind: 'fields', doc, text: input.kind === 'text' ? input.text : undefined }, metrics: { costUsd: 0.001 } };
    },
  });
  return { stage, calls };
}

const fixedClock = () => new Date('2026-11-23T10:00:00.000Z');

describe('runPipelineResumable', () => {
  it('without a store behaves like runPipeline and records timings', async () => {
    const a = counted('ocr', 'ocr'), b = counted('llm', 'structure');
    const run = await runPipelineResumable({ id: 'p', name: 'p', stages: [a.stage, b.stage] }, image, { docId: 'd1', clock: fixedClock });
    expect(run.failed).toBe(false);
    expect(run.steps).toHaveLength(2);
    expect(run.final.kind).toBe('fields');
    expect(run.totals.costUsd).toBeCloseTo(0.001);
    expect(run.record.stages.map((s) => [s.status, s.rerunReason])).toEqual([['executed', 'no_store'], ['executed', 'no_store']]);
    expect(run.record.stages[0]!.attempts).toHaveLength(1);
    expect(run.record.startedAt).toBe('2026-11-23T10:00:00.000Z');
  });

  it('resume after failure reuses completed stages and reruns only the failed one + downstream', async () => {
    const store = new MemoryCheckpointStore();
    const ocr = counted('ocr', 'ocr');
    let llmBroken = true;
    const llmCalls = { n: 0 };
    const llm: Stage = defineStage({ id: 'llm', version: '1', kind: 'structure', runtime: 'cloud', inputs: ['text'], run: async (i) => {
      llmCalls.n++;
      if (llmBroken) throw new Error('quota exceeded');
      return { output: { kind: 'fields', doc, text: i.kind === 'text' ? i.text : undefined } };
    } });
    const verify = counted('verify', 'verify');
    const p: Pipeline = { id: 'paddle+qwen', name: 'x', stages: [ocr.stage, llm, verify.stage] };

    const r1 = await runPipelineResumable(p, image, { docId: 'd1', store });
    expect(r1.failed).toBe(true);
    expect(r1.error).toBe('quota exceeded');
    expect(r1.record.stages.map((s) => s.status)).toEqual(['executed', 'failed', 'skipped']);
    expect(r1.steps).toHaveLength(2); // partial trace kept, like runPipeline
    const failedCp = await store.get(checkpointKey(p.id, 'd1', 1, 'llm'));
    expect(failedCp?.status).toBe('failed');

    llmBroken = false;
    const r2 = await runPipelineResumable(p, image, { docId: 'd1', store });
    expect(r2.failed).toBe(false);
    expect(ocr.calls.n).toBe(1); // reused
    expect(llmCalls.n).toBe(2);
    expect(verify.calls.n).toBe(1);
    expect(r2.record.stages.map((s) => [s.status, s.rerunReason])).toEqual([['reused', undefined], ['executed', 'previous_failure'], ['executed', 'upstream_rerun']]);
    expect(r2.record.stages[0]!.reusedFromRunId).toBe(r1.runId);
    expect(r2.steps).toHaveLength(3);

    const r3 = await runPipelineResumable(p, image, { docId: 'd1', store });
    expect(r3.record.reused).toBe(3);
    expect(r3.record.executed).toBe(0);
    expect(r3.final).toEqual(r2.final);
    expect(ocr.calls.n + llmCalls.n + verify.calls.n).toBe(4);
  });

  it('a stage version bump invalidates that stage and everything downstream', async () => {
    const store = new MemoryCheckpointStore();
    const ocr = counted('ocr', 'ocr'), llm1 = counted('llm', 'structure', { version: '1' }), v = counted('verify', 'verify');
    await runPipelineResumable({ id: 'p', name: 'p', stages: [ocr.stage, llm1.stage, v.stage] }, image, { docId: 'd', store });
    const llm2 = counted('llm', 'structure', { version: '2' });
    const r = await runPipelineResumable({ id: 'p', name: 'p', stages: [ocr.stage, llm2.stage, v.stage] }, image, { docId: 'd', store });
    expect(r.record.stages.map((s) => [s.status, s.rerunReason])).toEqual([['reused', undefined], ['executed', 'version_changed'], ['executed', 'upstream_rerun']]);
    expect(ocr.calls.n).toBe(1);
    expect(v.calls.n).toBe(2);
  });

  it('a changed input (image, config or upstream output) changes the hash', async () => {
    const store = new MemoryCheckpointStore();
    let text = 'Augmentin 625 BD';
    const ocr = counted('ocr', 'ocr', { text: () => text }), llm = counted('llm', 'structure');
    const p: Pipeline = { id: 'p', name: 'p', stages: [ocr.stage, llm.stage] };
    const r1 = await runPipelineResumable(p, image, { docId: 'd', store });
    const other: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: 'BBBB' } };
    const r2 = await runPipelineResumable(p, other, { docId: 'd', store });
    expect(r2.record.stages[0]!.rerunReason).toBe('input_changed');
    expect(r2.record.stages[0]!.inputHash).not.toBe(r1.record.stages[0]!.inputHash);
    const r3 = await runPipelineResumable(p, other, { docId: 'd', store, config: { threshold: 0.9 } });
    expect(r3.record.stages[0]!.rerunReason).toBe('input_changed');

    // downstream: 'hash' reuses llm if the rerun OCR produced identical text, reruns it if not
    const r4 = await runPipelineResumable(p, other, { docId: 'd', store, config: { threshold: 0.9 }, force: ['ocr'], downstream: 'hash' });
    expect(r4.record.stages.map((s) => s.status)).toEqual(['executed', 'reused']);
    text = 'Augmentin 625 TDS';
    const r5 = await runPipelineResumable(p, other, { docId: 'd', store, config: { threshold: 0.9 }, force: ['ocr'], downstream: 'hash' });
    expect(r5.record.stages.map((s) => [s.status, s.rerunReason])).toEqual([['executed', 'forced'], ['executed', 'input_changed']]);
  });

  it('stage model/fingerprint metadata is part of the input hash', async () => {
    const store = new MemoryCheckpointStore();
    const mk = (fp: string) => defineStage({ id: 's', version: '1', kind: 'ocr', runtime: 'cloud', inputs: ['image'], fingerprint: fp, run: async () => ({ output: { kind: 'text', text: 'x' } }) });
    await runPipelineResumable({ id: 'p', name: 'p', stages: [mk('prompt-v1')] }, image, { docId: 'd', store });
    const r = await runPipelineResumable({ id: 'p', name: 'p', stages: [mk('prompt-v2')] }, image, { docId: 'd', store });
    expect(r.record.stages[0]!.rerunReason).toBe('input_changed');
  });

  it('retries transient failures and records every attempt', async () => {
    const delays: number[] = [];
    const ocr = counted('ocr', 'ocr', { failTimes: 2 });
    const r = await runPipelineResumable({ id: 'p', name: 'p', stages: [ocr.stage] }, image, { docId: 'd', retries: 2, retryDelayMs: (n) => 100 * n, sleep: async (ms) => { delays.push(ms); } });
    expect(r.failed).toBe(false);
    expect(r.record.stages[0]!.attempts.map((a) => a.error ?? 'ok')).toEqual(['ocr transient', 'ocr transient', 'ok']);
    expect(r.record.retries).toBe(2);
    expect(delays).toEqual([100, 200]);
    const ocr2 = counted('ocr', 'ocr', { failTimes: 5 });
    const r2 = await runPipelineResumable({ id: 'p', name: 'p', stages: [ocr2.stage] }, image, { docId: 'd', retries: 1 });
    expect(r2.failed).toBe(true);
    expect(r2.record.stages[0]!.attempts).toHaveLength(2);
  });

  it('a StageResult.error (not thrown) is a failure too, and is retried', async () => {
    let n = 0;
    const s: Stage = { id: 'soft', name: 's', kind: 'ocr', accepts: ['image'], run: async () => ({ stageId: 'soft', stageKind: 'ocr', site: 'on_device', output: { kind: 'text', text: '' }, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 0 }, ...(n++ === 0 ? { error: 'nano unavailable' } : {}) }) };
    const r = await runPipelineResumable({ id: 'p', name: 'p', stages: [s] }, image, { docId: 'd', retries: 1 });
    expect(r.failed).toBe(false);
    expect(r.record.stages[0]!.attempts[0]!.error).toBe('nano unavailable');
  });

  it('aborts: no retry, not checkpointed, later stages skipped; a hanging stage cannot block', async () => {
    const store = new MemoryCheckpointStore();
    const ac = new AbortController();
    const hang: Stage = { id: 'hang', name: 'h', kind: 'ocr', accepts: ['image'], run: () => new Promise(() => { setTimeout(() => ac.abort(), 5); }) };
    const llm = counted('llm', 'structure');
    const r = await runPipelineResumable({ id: 'p', name: 'p', stages: [hang, llm.stage] }, image, { docId: 'd', store, signal: ac.signal, retries: 3 });
    expect(r.failed).toBe(true);
    expect(r.record.aborted).toBe(true);
    expect(r.record.stages.map((s) => s.status)).toEqual(['aborted', 'skipped']);
    expect(r.record.stages[0]!.attempts).toHaveLength(1);
    expect(store.size).toBe(0);
    expect(llm.calls.n).toBe(0);
  });

  it('per-stage timeout fails the attempt with timedOut and allows retry', async () => {
    let n = 0;
    const slow: Stage = { id: 'slow', name: 's', kind: 'ocr', accepts: ['image'], run: () => (n++ === 0 ? new Promise(() => {}) : Promise.resolve({ stageId: 'slow', stageKind: 'ocr', site: 'server_gpu', output: { kind: 'text', text: 'ok' }, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 0 } })) };
    const r = await runPipelineResumable({ id: 'p', name: 'p', stages: [slow] }, image, { docId: 'd', timeoutMs: 10, retries: 1 });
    expect(r.failed).toBe(false);
    expect(r.record.stages[0]!.attempts[0]).toMatchObject({ timedOut: true });
    expect(r.record.stages[0]!.attempts[0]!.error).toMatch(/timed out/);
  });

  it('input-kind mismatch fails without running the stage', async () => {
    const llm = counted('llm', 'structure');
    const r = await runPipelineResumable({ id: 'p', name: 'p', stages: [llm.stage] }, image, { docId: 'd' });
    expect(r.failed).toBe(true);
    expect(r.error).toMatch(/does not accept input kind "image"/);
    expect(llm.calls.n).toBe(0);
  });

  it('non-serialisable stage output is rejected', async () => {
    const s: Stage = { id: 'bad', name: 'b', kind: 'ocr', accepts: ['image'], run: async () => ({ stageId: 'bad', stageKind: 'ocr', site: 'local_code', output: { kind: 'text', text: 'x' }, metrics: { latencyMs: Number.POSITIVE_INFINITY, costUsd: 0, bytesSent: 0 } }) };
    const r = await runPipelineResumable({ id: 'p', name: 'p', stages: [s] }, image, { docId: 'd' });
    expect(r.failed).toBe(true);
    expect(r.error).toMatch(/non-finite/);
  });
});

describe('checkpoint stores', () => {
  it('memory store isolates records and lists by prefix', async () => {
    const s = new MemoryCheckpointStore();
    const rec = { key: checkpointKey('p', 'd/1', 0, 'ocr'), status: 'completed' } as CheckpointRecord;
    await s.put(rec);
    await s.put({ ...rec, key: checkpointKey('p', 'd2', 0, 'ocr') });
    (rec as { status: string }).status = 'failed';
    expect((await s.get(checkpointKey('p', 'd/1', 0, 'ocr')))?.status).toBe('completed');
    expect(await s.list(checkpointPrefix('p', 'd/1'))).toHaveLength(1);
    await s.delete(checkpointKey('p', 'd/1', 0, 'ocr'));
    expect(await s.get(checkpointKey('p', 'd/1', 0, 'ocr'))).toBeUndefined();
  });

  it('filesystem store round-trips and supports resume across store instances', async () => {
    const fsSpec = 'node:fs/promises', osSpec = 'node:os';
    const fs = (await import(/* @vite-ignore */ fsSpec)) as MinimalFs & { mkdtemp(p: string): Promise<string>; rm(p: string, o: { recursive?: boolean; force: true }): Promise<void> };
    const os = (await import(/* @vite-ignore */ osSpec)) as { tmpdir(): string };
    const dir = await fs.mkdtemp(`${os.tmpdir()}/medocr-cp-`);
    try {
      const ocr = counted('ocr', 'ocr'), llm = counted('llm', 'structure');
      const p: Pipeline = { id: 'paddle+qwen', name: 'x', stages: [ocr.stage, llm.stage] };
      await runPipelineResumable(p, image, { docId: 'doc/with slash', store: new FsCheckpointStore(`${dir}/cp`) });
      const fresh = new FsCheckpointStore(`${dir}/cp`); // lazy-loads node:fs
      const r = await runPipelineResumable(p, image, { docId: 'doc/with slash', store: fresh });
      expect(r.record.reused).toBe(2);
      expect(ocr.calls.n).toBe(1);
      expect((await fresh.list(checkpointPrefix(p.id, 'doc/with slash'))).map((c) => c.stageId)).toEqual(['ocr', 'llm']);
      expect((await fs.readdir(`${dir}/cp`)).some((f) => f.includes('.tmp-'))).toBe(false);
      await fresh.delete(checkpointKey(p.id, 'doc/with slash', 1, 'llm'));
      expect(await fresh.get(checkpointKey(p.id, 'doc/with slash', 1, 'llm'))).toBeUndefined();
      expect(await new FsCheckpointStore(`${dir}/missing`).list('')).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
