import { describe, expect, it } from 'vitest';
import { scoreTranscription, summarize, percentile, runPipeline, scoringRulesId, type ClinicalDoc, type Stage, type StageData, type Reference } from '../src/index.js';

const image: StageData = { kind: 'image', image: { mimeType: 'image/png', base64: '' } };

describe('Benchmark A bundle', () => {
  it('scores a transcription', () => {
    const t = scoreTranscription('Tab Augmentin 625 mg BD x 5 days\nTab Pan 40 mg OD', 'Tab Augmentin 625 mg TDS x 5 days Tab Pan 40 mg OD');
    expect(t.exactMatch).toBe(false);
    expect(t.wer).toBeCloseTo(1 / 13);
    expect(t.numericAccuracy).toBe(1);
    expect(t.abbreviationAccuracy).toBe(0.5); // BD lost, OD kept
    expect(scoreTranscription('a  b', 'a b').exactMatch).toBe(true);
    expect(scoreTranscription('Hb 12.5', 'Hb 12.5').abbreviationAccuracy).toBeNull();
  });
});

describe('Benchmark C summary', () => {
  it('percentiles (nearest rank)', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 99)).toBe(99);
    expect(percentile([], 50)).toBe(0);
  });
  it('aggregates accuracy, latency, failures, retries, register and rules id; failed docs stay in the denominator', async () => {
    const gold: ClinicalDoc = { documentType: 'prescription', labResults: [], medications: [{ name: 'Augmentin', strength: '625 mg', frequency: 'BD' }] };
    let n = 0;
    const ocr: Stage = { id: 'ocr', name: 'o', kind: 'ocr', accepts: ['image'], run: async () => { n++; if (n === 3) throw new Error('boom'); return { stageId: 'ocr', stageKind: 'ocr', site: 'server_gpu', output: { kind: 'text', text: 'Augmentin 625 mg BD' }, metrics: { latencyMs: n * 100, costUsd: 0, bytesSent: 0 } }; } };
    const llm: Stage = { id: 'llm', name: 'l', kind: 'structure', accepts: ['text'], run: async (i) => ({ stageId: 'llm', stageKind: 'structure', site: 'server_gpu', output: { kind: 'fields', doc: n === 2 ? { ...gold, medications: [{ ...gold.medications[0]!, frequency: 'TDS' }] } : gold, text: i.kind === 'text' ? i.text : undefined }, metrics: { latencyMs: 10, costUsd: 0, bytesSent: 0 } }) };
    const p = { id: 'p', name: 'p', stages: [ocr, llm] };
    const runs = [];
    for (const d of ['d1', 'd2', 'd3']) runs.push(await runPipeline(p, image, { docId: d }));
    const refs = new Map<string, Reference>(['d1', 'd2', 'd3'].map((d) => [d, { docId: d, text: 'Augmentin 625 mg BD', doc: gold }]));
    const s = summarize('p', runs, refs);
    expect(s.docs).toBe(3);
    expect(s.failed).toBe(1);
    expect(s.failureRate).toBeCloseTo(1 / 3);
    expect(s.benchmarkFields!.frequency).toMatchObject({ tp: 1, fp: 1, fn: 1 });
    expect(s.register!.bySeverity.critical).toBe(1);
    expect(s.register!.byStage).toEqual({ llm: 1 });
    expect(s.latencyMs!.p50).toBeGreaterThan(0);
    expect(s.meanTranscription!.exactMatchRate).toBe(1);
    expect(s.rulesId).toBe(scoringRulesId());
    expect(s.retryRate).toBe(0);
  });
});
