// De-identification placeholders in attribution: a gold date that reads [DATE] is redaction, not an OCR omission.
import { describe, expect, it } from 'vitest';
import { runPipeline, attributeErrors, ErrorRegister, defineStage, deidentify, hasPlaceholder, isRedactableValue, type ClinicalDoc, type Stage, type StageData } from '../src/index.js';

const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: '' } };
const gold: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [{ name: 'Amoxicillin', strength: '500 mg', instructions: 'Review on 12/03/2026' }] };
const SOURCE = 'Patient: Anita Rao\nTab Amoxicillin 500 mg 1-0-1\nReview on 12/03/2026';

const deviceOcr = (text: string) => defineStage({ id: 'nano-read', version: '1', kind: 'ocr', runtime: 'device', inputs: ['image'], run: async () => ({ output: { kind: 'text', text } }) });
const deid = defineStage({ id: 'deid', version: '1', kind: 'deid', runtime: 'device', inputs: ['text'], outputs: ['text'], run: async (i) => ({ output: { kind: 'text', text: deidentify(i.kind === 'text' ? i.text : '').text } }) });
const cloud = defineStage({ id: 'cloud-structure', version: '1', kind: 'structure', runtime: 'cloud', inputs: ['text'], run: async (i) => {
  const text = i.kind === 'text' ? i.text : '';
  const instructions = /Review on (\S+)/.exec(text)?.[1];
  return { output: { kind: 'fields', text, doc: { documentType: 'prescription', labResults: [], medications: [{ name: 'Amoxicillin', strength: '500 mg', instructions: instructions ? `Review on ${instructions}` : null }] } } };
} });

describe('placeholder-aware attribution', () => {
  it('helpers', () => {
    expect(hasPlaceholder('Review on [DATE]')).toBe(true);
    expect(hasPlaceholder('Review on Monday')).toBe(false);
    expect(isRedactableValue('12/03/2026')).toBe(true);
    expect(isRedactableValue('Amoxicillin')).toBe(false);
  });

  it('OCR → deid → cloud: the gold date is [DATE] in the cloud input; blamed on deid as expected redaction, not on OCR', async () => {
    const run = await runPipeline({ id: 'hybrid', name: 'h', stages: [deviceOcr(SOURCE), deid, cloud] }, image, { docId: 'd' });
    expect(run.failed).toBe(false);
    const a = attributeErrors(run, gold);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ stageId: 'deid', cause: 'redacted', expectedRedaction: true });
    expect(a.some((x) => x.stageId === 'nano-read')).toBe(false);
    const reg = new ErrorRegister();
    const [e] = reg.record({ runId: run.runId, pipelineId: 'hybrid', docId: 'd' }, a, 3);
    expect(e).toMatchObject({ clinicalType: 'redaction', severity: 'minor', severityRule: 'R00-expected-redaction' });
  });

  it('on-device reading that redacts inline ([DATE] in the OCR text) is not a misread', async () => {
    const local = defineStage({ id: 'llm', version: '1', kind: 'structure', runtime: 'local-oss', inputs: ['text'], run: async (i) => ({ output: { kind: 'fields', text: i.kind === 'text' ? i.text : '', doc: { documentType: 'prescription', labResults: [], medications: [{ name: 'Amoxicillin', strength: '500 mg', instructions: 'Review on [DATE]' }] } } }) });
    const run = await runPipeline({ id: 'p', name: 'p', stages: [deviceOcr(deidentify(SOURCE).text), local] }, image, { docId: 'd' });
    const a = attributeErrors(run, gold);
    expect(a[0]).toMatchObject({ stageId: 'nano-read', cause: 'redacted', expectedRedaction: true });
  });

  it('over-redaction of clinical data by a deid stage is still an error with normal severity', async () => {
    const overRedact = defineStage({ id: 'deid', version: '1', kind: 'deid', runtime: 'device', inputs: ['text'], outputs: ['text'], run: async (i) => ({ output: { kind: 'text', text: (i.kind === 'text' ? i.text : '').replace('Amoxicillin', '[NAME]') } }) });
    const structure: Stage = defineStage({ id: 'llm', version: '1', kind: 'structure', runtime: 'local-oss', inputs: ['text'], run: async () => ({ output: { kind: 'fields', doc: { documentType: 'prescription', labResults: [], medications: [{ name: '[NAME]', strength: '500 mg', instructions: 'Review on 12/03/2026' }] } } }) });
    const run = await runPipeline({ id: 'p', name: 'p', stages: [deviceOcr(SOURCE), overRedact, structure] }, image, { docId: 'd' });
    const a = attributeErrors(run, gold).filter((x) => x.comparison.expected === 'Amoxicillin');
    expect(a.length).toBeGreaterThan(0);
    expect(a[0]).toMatchObject({ stageId: 'deid', cause: 'redacted', expectedRedaction: false });
    const reg = new ErrorRegister();
    expect(reg.record({ runId: 'r', pipelineId: 'p', docId: 'd' }, a, 3)[0]!.severity).toBe('critical');
  });
});
