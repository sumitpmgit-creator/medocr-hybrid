// BUG-009 (qa/BUG_LOG.md, ROUTE-13): route must be cross-checked in routing, scoring and attribution.
import { describe, expect, it } from 'vitest';
import { reconcileMedication, scoreFields, compareValues, canonicalRoute, runPipeline, attributeErrors, ErrorRegister, classifySeverity, type ClinicalDoc, type Stage, type StageData } from '../src/index.js';

const rx = (medications: ClinicalDoc['medications']): ClinicalDoc => ({ documentType: 'prescription', medications, labResults: [] });

describe('BUG-009: route (oral vs IV)', () => {
  it('reconcileMedication: device oral vs cloud IV goes to human_confirm with a route disagreement', () => {
    const r = reconcileMedication({ name: 'Pantoprazole', route: 'oral' }, { name: 'Pantoprazole', route: 'IV', confidence: 0.95 });
    expect(r.decision).toBe('human_confirm');
    expect(r.disagreements).toContain('route');
  });
  it('route aliases agree; existing frequency behaviour unchanged', () => {
    expect(reconcileMedication({ name: 'Pantoprazole', route: 'PO' }, { name: 'Pantoprazole', route: 'oral', confidence: 0.95 }).decision).toBe('accept_on_device');
    expect(reconcileMedication({ name: 'Zifi', frequency: 'BD' }, { name: 'Zifi', frequency: '1-0-1', confidence: 0.9 }).decision).toBe('accept_on_device');
    expect(canonicalRoute('p.o.')).toBe('oral');
    expect(canonicalRoute('Intravenous')).toBe('iv');
    expect(compareValues('route', 'oral', 'IV')).toBe('mismatch');
    expect(compareValues('route', 'IM', 'intramuscular')).toBe('normalized');
    expect(compareValues('route', 'SC', 'IV')).toBe('mismatch');
  });
  it('scoring: wrong route is a wrong critical field and fails the safety screen', () => {
    const s = scoreFields(rx([{ name: 'Pantoprazole', strength: '40 mg', route: 'IV' }]), rx([{ name: 'Pantoprazole', strength: '40 mg', route: 'oral' }]));
    const c = s.comparisons.find((x) => x.field === 'route')!;
    expect(c).toMatchObject({ outcome: 'wrong', critical: true });
    expect(s.passesSafetyScreen).toBe(false);
    expect(scoreFields(rx([{ name: 'Pantoprazole', route: 'oral' }]), rx([{ name: 'Pantoprazole', route: 'PO' }])).f1).toBe(1);
  });
  it('attribution: route present in OCR (as an alias) but wrong in the structured output blames structuring; severity critical', async () => {
    const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: '' } };
    const ocr: Stage = { id: 'paddleocr', name: 'p', kind: 'ocr', accepts: ['image'], run: async () => ({ stageId: 'paddleocr', stageKind: 'ocr', site: 'server_gpu', output: { kind: 'text', text: 'Inj Pantoprazole 40 mg I.V. OD' }, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 0 } }) };
    const llm: Stage = { id: 'qwen', name: 'q', kind: 'structure', accepts: ['text'], run: async (i) => ({ stageId: 'qwen', stageKind: 'structure', site: 'server_gpu', output: { kind: 'fields', doc: rx([{ name: 'Pantoprazole', strength: '40 mg', route: 'oral', frequency: 'OD' }]), text: i.kind === 'text' ? i.text : undefined }, metrics: { latencyMs: 1, costUsd: 0, bytesSent: 0 } }) };
    const run = await runPipeline({ id: 'paddle+qwen', name: 'x', stages: [ocr, llm] }, image, { docId: 'd' });
    const gold = rx([{ name: 'Pantoprazole', strength: '40 mg', route: 'intravenous', frequency: 'OD' }]);
    const a = attributeErrors(run, gold);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ stageId: 'qwen', cause: 'structuring' });
    expect(a[0]!.comparison.field).toBe('route');
    expect(classifySeverity(a[0]!)).toBe('critical');
    const reg = new ErrorRegister();
    expect(reg.record({ runId: run.runId, pipelineId: 'paddle+qwen', docId: 'd' }, a, 4)[0]!.severity).toBe('critical');
  });
});
