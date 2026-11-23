import { describe, expect, it } from 'vitest';
import {
  runPipeline, attributeErrors, ErrorRegister, classifySeverityWithRule, classifyErrorType, SEVERITY_RULES, textHolds,
  type Attribution, type ClinicalDoc, type FieldComparison, type Stage, type StageData,
} from '../src/index.js';

// Fixture stages are plain Stage objects that report site 'in_cloud' / bytesSent without declaring egress.
// They test attribution/abort, not privacy, so they opt back into the old 'warn' behaviour explicitly.
const LEGACY_FIXTURE = { undeclaredEgress: 'warn' as const };


const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: '' } };
const m = { latencyMs: 1, costUsd: 0, bytesSent: 0 };
const rx = (medications: ClinicalDoc['medications']): ClinicalDoc => ({ documentType: 'prescription', medications, labResults: [] });
const lab = (labResults: ClinicalDoc['labResults']): ClinicalDoc => ({ documentType: 'lab_report', medications: [], labResults });
const textStage = (id: string, text: string): Stage => ({ id, name: id, kind: 'ocr', accepts: ['image'], run: async () => ({ stageId: id, stageKind: 'ocr', site: 'server_gpu', output: { kind: 'text', text }, metrics: m }) });
const fieldStage = (id: string, doc: ClinicalDoc, kind: Stage['kind'] = 'structure'): Stage => ({ id, name: id, kind, accepts: ['text', 'fields', 'image'], run: async (i) => ({ stageId: id, stageKind: kind, site: 'server_gpu', output: { kind: 'fields', doc, text: i.kind === 'text' ? i.text : i.kind === 'fields' ? i.text : undefined }, metrics: m }) });
const both = (id: string, text: string, doc: ClinicalDoc): Stage => ({ id, name: id, kind: 'ocr+structure', accepts: ['image'], run: async () => ({ stageId: id, stageKind: 'ocr+structure', site: 'in_cloud', output: { kind: 'fields', doc, text }, metrics: m }) });

const att = (c: Partial<FieldComparison>): Attribution => ({ stageId: 's', cause: 'structuring', comparison: { entityType: 'medication', entityKey: 'X', field: 'name', expected: 'a', actual: 'b', outcome: 'wrong', critical: true, ...c } });

describe('error attribution to the earliest stage', () => {
  it('records a per-stage evidence trail', async () => {
    const run = await runPipeline({ id: 'p', name: 'p', stages: [textStage('ocr', 'Tab Augmentin 625 mg BD'), fieldStage('llm', rx([{ name: 'Augmentin', strength: '625 mg', frequency: 'TDS' }]))] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd' });
    const [a] = attributeErrors(run, rx([{ name: 'Augmentin', strength: '625 mg', frequency: 'BD' }]));
    expect(a).toMatchObject({ stageId: 'llm', stageKind: 'structure', cause: 'structuring' });
    expect(a!.evidence).toEqual([{ stageId: 'ocr', stageKind: 'ocr', holds: true }, { stageId: 'llm', stageKind: 'structure', holds: false }]);
  });
  it('OCR misread digits: a dose magnitude error is blamed on OCR, and is critical', async () => {
    const run = await runPipeline({ id: 'p', name: 'p', stages: [textStage('ocr', 'Tab Warfarin 50 mg OD'), fieldStage('llm', rx([{ name: 'Warfarin', strength: '50 mg', frequency: 'OD' }]))] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd' });
    const a = attributeErrors(run, rx([{ name: 'Warfarin', strength: '5 mg', frequency: 'OD' }]));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ stageId: 'ocr', cause: 'misread' });
    expect(classifySeverityWithRule(a[0]!)).toMatchObject({ severity: 'critical', type: 'magnitude_error', rule: { id: 'R03-dose-unit-magnitude' } });
  });
  it('a single ocr+structure stage is split by its own text: structuring vs misread', async () => {
    const gold = rx([{ name: 'Augmentin', frequency: 'BD' }]);
    const r1 = await runPipeline({ id: 'p', name: 'p', stages: [both('qwen-vl', 'Augmentin BD', rx([{ name: 'Augmentin', frequency: 'TDS' }]))] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd' });
    expect(attributeErrors(r1, gold)[0]).toMatchObject({ stageId: 'qwen-vl', cause: 'structuring' });
    const r2 = await runPipeline({ id: 'p', name: 'p', stages: [both('qwen-vl', 'Augmentin TDS', rx([{ name: 'Augmentin', frequency: 'TDS' }]))] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd' });
    expect(attributeErrors(r2, gold)[0]).toMatchObject({ stageId: 'qwen-vl', cause: 'misread' });
  });
  it('an invented value is blamed on the stage that first emitted it (not always the first fields stage)', async () => {
    const good = rx([{ name: 'Augmentin', frequency: 'BD' }]);
    const withInvention = rx([{ name: 'Augmentin', frequency: 'BD' }, { name: 'Azithromycin', strength: '500 mg' }]);
    const run = await runPipeline({ id: 'p', name: 'p', stages: [textStage('ocr', 'Augmentin BD'), fieldStage('nano', good), fieldStage('cloud', withInvention, 'verify')] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd' });
    const a = attributeErrors(run, good);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((x) => x.stageId === 'cloud' && x.cause === 'unsupported_inference')).toBe(true);
    expect(a.map((x) => classifyErrorType(x))).toEqual(expect.arrayContaining(['hallucination']));
  });
  it('textHolds uses permitted normalisation (BD holds 1-0-1, 2,50,000 holds 250000)', () => {
    expect(textHolds('Tab Augmentin 625 BD', { entityType: 'medication', field: 'frequency', expected: '1-0-1' })).toBe(true);
    expect(textHolds('Platelets 2,50,000 /cumm', { entityType: 'lab', field: 'value', expected: '250000' })).toBe(true);
    expect(textHolds('Tab Augmentin 625 TDS', { entityType: 'medication', field: 'frequency', expected: '1-0-1' })).toBe(false);
  });
});

describe('severity rules (documented, first match wins)', () => {
  const cases: [Partial<FieldComparison>, string, string][] = [
    [{ field: 'name' }, 'critical', 'R02-drug-identity'],
    [{ field: 'name', outcome: 'missing', actual: null }, 'critical', 'R02-drug-identity'],
    [{ field: 'strength', expected: '500 mg', actual: '500 mcg' }, 'critical', 'R03-dose-unit-magnitude'],
    [{ field: 'strength', expected: '0.5 mg', actual: '5 mg' }, 'critical', 'R03-dose-unit-magnitude'],
    [{ field: 'strength', expected: '500 mg', actual: '650 mg' }, 'critical', 'R04-med-critical-field'],
    [{ field: 'frequency', expected: 'BD', actual: 'TDS' }, 'critical', 'R04-med-critical-field'],
    [{ field: 'route', expected: 'oral', actual: 'IV' }, 'critical', 'R04-med-critical-field'],
    [{ field: 'duration', expected: '5 days', actual: '7 days', critical: false }, 'major', 'R05-med-regimen'],
    [{ field: 'dosageForm', expected: 'tablet', actual: 'capsule', critical: false }, 'moderate', 'R06-med-other'],
    [{ entityType: 'lab', field: 'value', expected: '12.5', actual: '1.25' }, 'critical', 'R07-lab-wrong-value'],
    [{ entityType: 'lab', field: 'value', expected: '12.5', actual: null, outcome: 'missing' }, 'major', 'R08-lab-omission'],
    [{ entityType: 'lab', field: 'test', expected: null, actual: 'ESR', outcome: 'unsupported' }, 'major', 'R09-lab-invented'],
    [{ entityType: 'lab', field: 'unit', expected: 'g/dL', actual: 'mg/dL' }, 'major', 'R10-lab-unit-flag'],
    [{ entityType: 'lab', field: 'referenceRange', expected: '13-17', actual: '12-16', critical: false }, 'moderate', 'R11-other'],
    [{ field: 'strength', expected: '625 mg', actual: '625MG', outcome: 'correct', formattingOnly: true }, 'minor', 'R01-formatting'],
  ];
  it.each(cases)('%o -> %s (%s)', (c, sev, rule) => {
    const r = classifySeverityWithRule(att(c));
    expect(r.severity).toBe(sev);
    expect(r.rule.id).toBe(rule);
  });
  it('error types', () => {
    expect(classifyErrorType(att({ entityType: 'lab', field: 'value', expected: '12.5', actual: '1.25' }))).toBe('decimal_error');
    expect(classifyErrorType(att({ field: 'strength', expected: '5 mg', actual: '50 mg' }))).toBe('magnitude_error');
    expect(classifyErrorType(att({ field: 'strength', expected: '500 mg', actual: '500 mcg' }))).toBe('unit_error');
    expect(classifyErrorType(att({ field: 'frequency' }))).toBe('wrong_frequency');
    expect(classifyErrorType(att({ field: 'route' }))).toBe('wrong_route');
    expect(classifyErrorType(att({ field: 'name' }))).toBe('wrong_drug');
    expect(classifyErrorType(att({ outcome: 'missing', actual: null }))).toBe('omission');
    expect(SEVERITY_RULES.at(-1)!.id).toBe('R11-other');
    expect(new Set(SEVERITY_RULES.map((r) => r.id)).size).toBe(SEVERITY_RULES.length);
  });
});

describe('error register JSON export', () => {
  it('is deterministic plain JSON with rules, summary and errors', async () => {
    const gold = lab([{ test: 'Haemoglobin', value: '12.5', unit: 'g/dL' }, { test: 'WBC', value: '7200', unit: '/cumm' }]);
    const pred = lab([{ test: 'Haemoglobin', value: '1.25', unit: 'g/dL' }]);
    const run = await runPipeline({ id: 'p', name: 'p', stages: [textStage('ocr', 'Haemoglobin 1.25 g/dL'), fieldStage('llm', pred)] }, image, { cloudSafety: LEGACY_FIXTURE, docId: 'd1', runId: 'r1' });
    const reg = new ErrorRegister();
    reg.record({ runId: 'r1', pipelineId: 'p', docId: 'd1' }, attributeErrors(run, gold), 6);
    const j = reg.toJSON();
    expect(JSON.parse(JSON.stringify(j))).toEqual(j);
    expect(j.schemaVersion).toBe(1);
    expect(j.severityRules).toHaveLength(SEVERITY_RULES.length);
    const hb = j.errors.find((e) => e.entity === 'Haemoglobin')!;
    expect(hb).toMatchObject({ stageId: 'ocr', cause: 'misread', clinicalType: 'decimal_error', severity: 'critical', severityRule: 'R07-lab-wrong-value' });
    expect(j.errors.filter((e) => e.entity === 'WBC').map((e) => e.severity).sort()).toEqual(['major', 'major', 'major']);
    expect(j.summary).toMatchObject({ documents: 1, fieldsEvaluated: 6, bySeverity: { critical: 1, major: 3 }, byType: { decimal_error: 1, omission: 3 } });
    expect(j.summary.per100Docs.critical).toBe(100);
    expect(reg.toCSV().split('\n')[0]).toContain('severityRule,clinicalType');
  });
});
