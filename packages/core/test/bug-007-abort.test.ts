// BUG-007 (qa/BUG_LOG.md, OFF-10/11): runPipeline must honour AbortSignal and support per-stage timeouts.
import { describe, expect, it } from 'vitest';
import { runPipeline, runPipelineResumable, MemoryCheckpointStore, type Stage, type StageData } from '../src/index.js';

// Fixture stages are plain Stage objects that report site 'in_cloud' / bytesSent without declaring egress.
// They test attribution/abort, not privacy, so they opt back into the old 'warn' behaviour explicitly.
const LEGACY_FIXTURE = { undeclaredEgress: 'warn' as const };


const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: '' } };
const ok = (id: string, accepts: StageData['kind'][], out: StageData): Stage => ({
  id, name: id, kind: 'ocr', accepts,
  run: async () => ({ stageId: id, stageKind: 'ocr', site: 'on_device', output: out, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 0 } }),
});
const never: Stage = { id: 'stalled', name: 's', kind: 'ocr', accepts: ['image'], run: () => new Promise(() => {}) };

describe('BUG-007: abort and timeout in runPipeline', () => {
  it('(a) a stage that never settles + abort after 50 ms: runPipeline returns', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const res = await Promise.race([
      runPipeline({ id: 'p', name: 'p', stages: [never] }, image, { docId: 'd', signal: ac.signal }),
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 1000)),
    ]);
    expect(res).not.toBe('hung');
    expect(res !== 'hung' && res.failed).toBe(true);
  });

  it('(b) abort during stage 1: stage 2 does not run and the run is failed', async () => {
    const ac = new AbortController();
    let stage2Ran = false;
    const s1: Stage = { id: 's1', name: 's1', kind: 'ocr', accepts: ['image'], run: async () => { ac.abort(); return { stageId: 's1', stageKind: 'ocr', site: 'on_device', output: { kind: 'text', text: 'x' }, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 0 } }; } };
    const s2: Stage = { id: 's2', name: 's2', kind: 'structure', accepts: ['text'], run: async () => { stage2Ran = true; return { stageId: 's2', stageKind: 'structure', site: 'in_cloud', output: { kind: 'text', text: 'y' }, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 0 } }; } };
    const run = await runPipeline({ id: 'p', name: 'p', stages: [s1, s2] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd', signal: ac.signal });
    expect(stage2Ran).toBe(false);
    expect(run.failed).toBe(true);
  });

  it('an already-aborted signal runs nothing', async () => {
    const ac = new AbortController(); ac.abort();
    let ran = false;
    const s: Stage = { ...ok('s', ['image'], { kind: 'text', text: 'x' }), run: async () => { ran = true; throw new Error('should not run'); } };
    const run = await runPipeline({ id: 'p', name: 'p', stages: [s] }, image, { docId: 'd', signal: ac.signal });
    expect(ran).toBe(false);
    expect(run.failed).toBe(true);
  });

  it('per-stage timeout is a recorded timeout failure that a later run resumes', async () => {
    const store = new MemoryCheckpointStore();
    let slow = true;
    const read = ok('read', ['image'], { kind: 'text', text: 'Augmentin 625 BD' });
    const cloud: Stage = { id: 'cloud', name: 'c', kind: 'structure', accepts: ['text'], run: () => (slow ? new Promise(() => {}) : Promise.resolve({ stageId: 'cloud', stageKind: 'structure', site: 'in_cloud', output: { kind: 'text', text: 'done' }, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 0 } })) };
    const p = { id: 'p', name: 'p', stages: [read, cloud] };
    const r1 = await runPipelineResumable(p, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd', store, timeoutMs: 20 });
    expect(r1.failed).toBe(true);
    expect(r1.record.stages[1]).toMatchObject({ status: 'timed_out' });
    expect(r1.record.stages[1]!.attempts[0]).toMatchObject({ timedOut: true });
    expect(r1.error).toMatch(/timed out after 20 ms/);
    slow = false;
    const r2 = await runPipelineResumable(p, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd', store, timeoutMs: 20 });
    expect(r2.failed).toBe(false);
    expect(r2.record.stages.map((s) => [s.status, s.rerunReason])).toEqual([['reused', undefined], ['executed', 'previous_failure']]);
    // runPipeline accepts the same option
    slow = true;
    const r3 = await runPipeline(p, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd', timeoutMs: 20 } as Parameters<typeof runPipeline>[2]);
    expect(r3.failed).toBe(true);
  });
});
