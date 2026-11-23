// Undeclared egress: a stage that never declared it sends data off the device, yet reports in_cloud / bytesSent.
import { describe, expect, it } from 'vitest';
import {
  runPipeline, runPipelineResumable, defineStage, MemoryCheckpointStore, CloudSafetyError, DEFAULT_UNDECLARED_EGRESS, undeclaredEgressMode,
  type Stage, type StageData,
} from '../src/index.js';

const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: '' } };
const ocr = defineStage({ id: 'nano-read', version: '1', kind: 'ocr', runtime: 'device', inputs: ['image'], run: async () => ({ output: { kind: 'text', text: 'Tab Augmentin 625 mg BD' } }) });
const legacyCloud = (): Stage => ({ id: 'old-cloud', name: 'x', kind: 'structure', accepts: ['text'],
  run: async (i) => ({ stageId: 'old-cloud', stageKind: 'structure', site: 'in_cloud', output: { kind: 'fields', text: i.kind === 'text' ? i.text : '', doc: { documentType: 'prescription', medications: [{ name: 'Augmentin' }], labResults: [] } }, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 120 } }) });
const bytesOnly = (): Stage => ({ id: 'sneaky', name: 'x', kind: 'verify', accepts: ['text'],
  run: async (i) => ({ stageId: 'sneaky', stageKind: 'verify', site: 'on_device', output: i, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 10 } }) });
function after(seen: StageData[]): Stage {
  return defineStage({ id: 'after', version: '1', kind: 'verify', runtime: 'code', inputs: ['fields', 'text'], run: async (i) => { seen.push(i); return { output: i }; } });
}

describe('cloudSafety.undeclaredEgress', () => {
  it("'warn': the run continues and the record flags it", async () => {
    const seen: StageData[] = [];
    const run = await runPipeline({ id: 'p', name: 'p', stages: [ocr, legacyCloud(), after(seen)] }, image, { docId: 'd', cloudSafety: { undeclaredEgress: 'warn' } });
    expect(run.failed).toBe(false);
    expect(seen).toHaveLength(1);
    expect(run.record.stages[1]).toMatchObject({ status: 'executed', cloudSafety: 'undeclared_egress' });
    expect(run.record.privacyFlags[0]).toMatch(/undeclared egress from old-cloud \(site in_cloud, 120 bytes\)/);
  });

  it("'fail': the stage is blocked, its output discarded, downstream skipped, the run fails", async () => {
    const seen: StageData[] = [];
    const run = await runPipeline({ id: 'p', name: 'p', stages: [ocr, legacyCloud(), after(seen)] }, image, { docId: 'd', cloudSafety: { undeclaredEgress: 'fail' } });
    expect(run.failed).toBe(true);
    expect(run.error).toMatch(/undeclared_egress/);
    expect(seen).toHaveLength(0);
    expect(run.final.kind).toBe('text'); // the cloud output never became the pipeline result
    expect(run.record.stages.map((s) => s.status)).toEqual(['executed', 'blocked', 'skipped']);
    expect(run.record.stages[1]).toMatchObject({ cloudSafety: 'blocked', blockedReason: 'undeclared_egress' });
    expect(run.record.privacyFlags[0]).toMatch(/blocked undeclared egress from old-cloud.*output discarded/);
    expect(run.totals.bytesSent).toBe(120); // still accounted: the bytes did leave
  });

  it("'fail' also catches bytesSent > 0 from a stage that reports on_device", async () => {
    const run = await runPipeline({ id: 'p', name: 'p', stages: [ocr, bytesOnly()] }, image, { docId: 'd', cloudSafety: { undeclaredEgress: 'fail' } });
    expect(run.record.stages[1]).toMatchObject({ status: 'blocked', blockedReason: 'undeclared_egress' });
  });

  it("'fail' stores no completed checkpoint, so a resume reruns the stage", async () => {
    const store = new MemoryCheckpointStore();
    const opts = { docId: 'd', store, cloudSafety: { undeclaredEgress: 'fail' as const } };
    await runPipelineResumable({ id: 'p', name: 'p', stages: [ocr, legacyCloud()] }, image, opts);
    const again = await runPipelineResumable({ id: 'p', name: 'p', stages: [ocr, legacyCloud()] }, image, opts);
    expect(again.record.stages[0]!.status).toBe('reused');
    expect(again.record.stages[1]).toMatchObject({ status: 'blocked', rerunReason: 'previous_failure' });
  });

  it("'fail' with throwOnBlock throws CloudSafetyError", async () => {
    await expect(runPipeline({ id: 'p', name: 'p', stages: [ocr, legacyCloud()] }, image, { docId: 'd', cloudSafety: { undeclaredEgress: 'fail', throwOnBlock: true } })).rejects.toBeInstanceOf(CloudSafetyError);
  });

  it('exempt stages and a disabled guard only warn, even in fail mode', async () => {
    const stage = legacyCloud();
    expect(undeclaredEgressMode(stage, { undeclaredEgress: 'fail', exempt: ['old-cloud'] })).toBe('warn');
    expect(undeclaredEgressMode(stage, { undeclaredEgress: 'fail', enabled: false })).toBe('warn');
    const run = await runPipeline({ id: 'p', name: 'p', stages: [ocr, stage] }, image, { docId: 'd', cloudSafety: { undeclaredEgress: 'fail', exempt: ['old-cloud'] } });
    expect(run.failed).toBe(false);
    expect(run.record.stages[1]!.cloudSafety).toBe('undeclared_egress');
  });

  it('declared cloud stages are not affected (they go through the pre-run guard instead)', async () => {
    const declared = defineStage({ id: 'cloud', version: '1', kind: 'verify', runtime: 'cloud', inputs: ['text'], run: async (i) => ({ output: i }) });
    const run = await runPipeline({ id: 'p', name: 'p', stages: [ocr, declared] }, image, { docId: 'd', cloudSafety: { undeclaredEgress: 'fail' } });
    expect(run.record.stages[1]).toMatchObject({ status: 'blocked', blockedReason: 'no_deid_stage' });
  });

  it('default mode', async () => {
    expect(DEFAULT_UNDECLARED_EGRESS).toBe('warn');
    expect(undeclaredEgressMode(legacyCloud())).toBe(DEFAULT_UNDECLARED_EGRESS);
    const run = await runPipeline({ id: 'p', name: 'p', stages: [ocr, legacyCloud()] }, image, { docId: 'd' });
    expect(run.failed).toBe(DEFAULT_UNDECLARED_EGRESS === 'fail');
  });
});
