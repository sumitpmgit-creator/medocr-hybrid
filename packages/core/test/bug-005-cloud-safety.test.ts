// BUG-005 (qa/BUG_LOG.md, DEID-G01/G02): the runner must fail closed before cloud egress.
import { describe, expect, it } from 'vitest';
import {
  runPipeline, runPipelineResumable, defineStage, deidentify, CloudSafetyError, defaultCloudSafetyCheck, fromAssertSafeForCloud, egressStrings,
  type Stage, type StageData, type ClinicalDoc,
} from '../src/index.js';

const PHI = 'Name: Ravi Kumar\nPh: 9876543210\nAadhaar 1234 5678 9012\nTab Augmentin 625 mg BD';
const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: 'SECRETPIXELS' } };

const deviceOcr = defineStage({ id: 'nano-read', version: '1', kind: 'ocr', runtime: 'device', inputs: ['image'],
  run: async (i) => ({ output: { kind: 'text', text: PHI, image: i.kind === 'image' ? i.image : undefined } }) });
const deidStage = defineStage({ id: 'deid', version: '1', kind: 'deid', runtime: 'device', inputs: ['text'], outputs: ['text'],
  run: async (i) => ({ output: { ...(i as Extract<StageData, { kind: 'text' }>), text: deidentify(i.kind === 'text' ? i.text : '').text } }) });
const leakyDeid = defineStage({ id: 'deid', version: '1', kind: 'deid', runtime: 'device', inputs: ['text'], outputs: ['text'],
  run: async (i) => ({ output: i }) }); // claims to de-identify but passes PHI through

function cloudStage(received: StageData[]): Stage {
  return defineStage({ id: 'cloud-structure', version: '1', kind: 'structure', runtime: 'cloud', inputs: ['text', 'image'],
    run: async (i) => { received.push(i); const doc: ClinicalDoc = { documentType: 'prescription', medications: [{ name: 'Augmentin' }], labResults: [] }; return { output: { kind: 'fields', doc } }; } });
}

describe('BUG-005: fail-closed cloud egress', () => {
  it('[device OCR, cloud stage] with no deid stage: the cloud stage never runs and the run says why', async () => {
    const received: StageData[] = [];
    const run = await runPipeline({ id: 'p', name: 'p', stages: [deviceOcr, cloudStage(received)] }, image, { docId: 'd' });
    expect(received).toHaveLength(0);
    expect(run.failed).toBe(true);
    expect(run.error).toMatch(/no_deid_stage/);
    expect(run.record.stages[1]).toMatchObject({ status: 'blocked', cloudSafety: 'blocked', blockedReason: 'no_deid_stage' });
    expect(run.record.privacyFlags).toEqual(['blocked cloud-structure: no_deid_stage']);
  });

  it('with a deid stage: passes, and the image is stripped before the cloud stage', async () => {
    const received: StageData[] = [];
    const run = await runPipeline({ id: 'p', name: 'p', stages: [deviceOcr, deidStage, cloudStage(received)] }, image, { docId: 'd' });
    expect(run.failed).toBe(false);
    expect(received).toHaveLength(1);
    expect('image' in received[0]!).toBe(false);
    expect(JSON.stringify(received[0])).not.toMatch(/9876543210|Ravi Kumar|1234 5678 9012|SECRETPIXELS/);
    expect(run.record.stages[2]).toMatchObject({ cloudSafety: 'passed', imageStripped: true });
  });

  it('a deid stage that leaves identifiers in the text is caught by the check', async () => {
    const received: StageData[] = [];
    const run = await runPipeline({ id: 'p', name: 'p', stages: [deviceOcr, leakyDeid, cloudStage(received)] }, image, { docId: 'd' });
    expect(received).toHaveLength(0);
    expect(run.record.stages[2]).toMatchObject({ status: 'blocked', blockedReason: 'unsafe_text' });
    expect(run.error).not.toMatch(/9876543210|Ravi/); // the refusal does not echo the PHI
  });

  it('the check is injectable (stub), e.g. Rachel\'s assertSafeForCloud via the adapter', async () => {
    const seen: string[] = [];
    const stub = fromAssertSafeForCloud((t) => { seen.push(t); if (t.includes('Augmentin')) throw new Error('stub says unsafe'); });
    const received: StageData[] = [];
    const run = await runPipelineResumable({ id: 'p', name: 'p', stages: [deviceOcr, deidStage, cloudStage(received)] }, image, { docId: 'd', cloudSafety: { check: stub } });
    expect(seen.length).toBeGreaterThan(0);
    expect(received).toHaveLength(0);
    expect(run.error).toMatch(/stub says unsafe/);
    const permissive = await runPipelineResumable({ id: 'p', name: 'p', stages: [deviceOcr, leakyDeid, cloudStage(received)] }, image, { docId: 'd', cloudSafety: { check: () => {} } });
    expect(permissive.failed).toBe(false);
  });

  it('raw image straight to a cloud stage is refused unless explicitly exempted (recorded)', async () => {
    const received: StageData[] = [];
    const r1 = await runPipeline({ id: 'cloud-only', name: 'c', stages: [cloudStage(received)] }, image, { docId: 'd' });
    expect(r1.record.stages[0]).toMatchObject({ status: 'blocked', blockedReason: 'raw_image' });
    expect(received).toHaveLength(0);
    const r2 = await runPipeline({ id: 'cloud-only', name: 'c', stages: [cloudStage(received)] }, image, { docId: 'd', cloudSafety: { exempt: ['cloud-structure'] } });
    expect(r2.failed).toBe(false);
    expect(r2.record.stages[0]!.cloudSafety).toBe('exempt');
    expect(r2.record.privacyFlags[0]).toMatch(/exempt cloud-structure/);
  });

  it('throwOnBlock throws CloudSafetyError before the stage runs', async () => {
    const received: StageData[] = [];
    await expect(runPipeline({ id: 'p', name: 'p', stages: [deviceOcr, cloudStage(received)] }, image, { docId: 'd', cloudSafety: { throwOnBlock: true } })).rejects.toBeInstanceOf(CloudSafetyError);
    expect(received).toHaveLength(0);
  });

  it('legacy stages with no meta are refused by default, or are flagged with undeclaredEgress: warn', async () => {
    const legacy: Stage = { id: 'old-cloud', name: 'x', kind: 'structure', accepts: ['text'], run: async (i) => ({ stageId: 'old-cloud', stageKind: 'structure', site: 'in_cloud', output: i, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 120 } }) };
    const run = await runPipeline({ id: 'p', name: 'p', stages: [deviceOcr, legacy] }, image, { docId: 'd' });
    expect(run.failed).toBe(true);
    expect(run.record.stages[1]).toMatchObject({ status: 'blocked', blockedReason: 'no_meta' }); // refused before it runs
    const warned = await runPipeline({ id: 'p', name: 'p', stages: [deviceOcr, legacy] }, image, { docId: 'd', cloudSafety: { undeclaredEgress: 'warn' } });
    expect(warned.record.stages[1]!.cloudSafety).toBe('undeclared_egress');
    expect(warned.record.privacyFlags[0]).toMatch(/undeclared egress from old-cloud/);
  });

  it('default check and egressStrings', () => {
    expect(() => defaultCloudSafetyCheck('Tab Augmentin 625 mg BD')).not.toThrow();
    expect(() => defaultCloudSafetyCheck(PHI)).toThrow(/identifier\(s\)/);
    expect(() => defaultCloudSafetyCheck(PHI)).not.toThrow(/9876543210|Ravi/);
    expect(() => defaultCloudSafetyCheck('Collection date: 2026-03-12')).toThrow(/date/i);
    expect(() => defaultCloudSafetyCheck(deidentify(PHI).text)).not.toThrow();
    const doc: ClinicalDoc = { documentType: 'other', medications: [{ name: 'X', instructions: 'call 9876543210' }], labResults: [] };
    expect(egressStrings({ kind: 'fields', doc, image: image.image })).toEqual(['other', 'X', 'call 9876543210']);
  });
});
