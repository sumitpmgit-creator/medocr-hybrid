import { describe, expect, it } from 'vitest';
import { runPipeline, attributeErrors, ErrorRegister, summarize, readingText, type Stage, type ClinicalDoc, type StageData } from '../src/index.js';

// Fixture stages are plain Stage objects that report site 'in_cloud' / bytesSent without declaring egress.
// They test attribution/abort, not privacy, so they opt back into the old 'warn' behaviour explicitly.
const LEGACY_FIXTURE = { undeclaredEgress: 'warn' as const };


const metrics = { latencyMs: 1, costUsd: 0, bytesSent: 0 };

function textStage(id: string, text: string): Stage {
  return { id, name: id, kind: 'ocr', accepts: ['image'], run: async () => ({ stageId: id, stageKind: 'ocr', site: 'server_gpu', output: { kind: 'text', text }, metrics: { ...metrics } }) };
}
function fieldStage(id: string, doc: ClinicalDoc, kind: Stage['kind'] = 'structure'): Stage {
  return { id, name: id, kind, accepts: ['text', 'fields'], run: async (inp: StageData) => ({ stageId: id, stageKind: kind, site: 'in_cloud', output: { kind: 'fields', doc, text: inp.kind === 'text' ? inp.text : undefined }, metrics: { latencyMs: 2, costUsd: 0.001, bytesSent: 100 } }) };
}

const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: '' } };
const reference: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'BD' }] };

describe('pipeline + attribution (SoalTech PaddleOCR -> Qwen case)', () => {
  it('blames the structuring stage when OCR text was correct', async () => {
    const p = { id: 'paddle+qwen', name: 'x', stages: [
      textStage('paddleocr', 'Tab Augmentin 625 mg BD x 5 days'),
      fieldStage('qwen', { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'TDS' }] }),
    ] };
    const run = await runPipeline(p, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd1' });
    expect(run.failed).toBe(false);
    expect(run.steps).toHaveLength(2);
    expect(run.totals.bytesSent).toBe(100);
    expect(readingText(run)).toContain('Augmentin');
    const a = attributeErrors(run, reference);
    expect(a).toHaveLength(1);
    expect(a[0]!.stageId).toBe('qwen');
    expect(a[0]!.cause).toBe('structuring');
  });

  it('blames OCR when the value never appeared in the text', async () => {
    const p = { id: 'p2', name: 'x', stages: [
      textStage('ocr', 'Tab Augmentin 625 mg'),
      fieldStage('llm', { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: null }] }),
    ] };
    const run = await runPipeline(p, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd2' });
    const a = attributeErrors(run, reference);
    expect(a[0]!.stageId).toBe('ocr');
    expect(a[0]!.cause).toBe('misread');
  });

  it('detects a later verify stage regressing a correct value', async () => {
    const good: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'BD' }] };
    const bad: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '1 g', frequency: 'BD' }] };
    const p = { id: 'p3', name: 'x', stages: [textStage('ocr', 'Augmentin 625 mg BD'), fieldStage('nano', good), fieldStage('cloud', bad, 'verify')] };
    const run = await runPipeline(p, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd3' });
    const a = attributeErrors(run, reference);
    expect(a[0]!.stageId).toBe('cloud');
    expect(a[0]!.cause).toBe('regression');
  });

  it('flags hallucinated values as unsupported inference', async () => {
    const p = { id: 'p4', name: 'x', stages: [textStage('ocr', 'Augmentin 625 mg BD'), fieldStage('llm', { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'BD', route: 'IV' }] })] };
    const run = await runPipeline(p, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd4' });
    const a = attributeErrors(run, reference);
    expect(a).toHaveLength(1);
    expect(a[0]!.cause).toBe('unsupported_inference');
  });

  it('register: severities and rates; summary aggregates', async () => {
    const p = { id: 'paddle+qwen', name: 'x', stages: [
      textStage('paddleocr', 'Tab Augmentin 625 mg BD'),
      fieldStage('qwen', { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'TDS' }] }),
    ] };
    const run = await runPipeline(p, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd1' });
    const reg = new ErrorRegister();
    const errs = reg.record({ runId: run.runId, pipelineId: p.id, docId: 'd1' }, attributeErrors(run, reference), 3);
    expect(errs[0]!.severity).toBe('critical');
    expect(reg.per100Docs('critical')).toBe(100);
    expect(reg.per1000Fields('critical')).toBeCloseTo(333.33, 1);
    expect(reg.toCSV().split('\n')).toHaveLength(2);
    const s = summarize(p.id, [run], new Map([['d1', { docId: 'd1', text: 'Tab Augmentin 625 mg BD', doc: reference }]]));
    expect(s.meanCER).toBe(0);
    expect(s.safetyPassRate).toBe(0);
    expect(s.errorsByStage).toEqual({ qwen: 1 });
  });

  it('stops on input-kind mismatch and on thrown errors', async () => {
    const r1 = await runPipeline({ id: 'bad', name: 'x', stages: [fieldStage('llm', reference)] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd' });
    expect(r1.failed).toBe(true);
    const boom: Stage = { id: 'boom', name: 'b', kind: 'ocr', accepts: ['image'], run: async () => { throw new Error('quota'); } };
    const r2 = await runPipeline({ id: 'p', name: 'x', stages: [boom] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd' });
    expect(r2.failed).toBe(true);
    expect(r2.error).toBe('quota');
  });
});
