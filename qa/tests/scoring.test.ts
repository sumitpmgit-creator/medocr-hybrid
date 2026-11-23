/**
 * Area: SCORING - are per-stage scores correct and calibrated?
 * core: cer / wer / numericAccuracy / similarity / fuzzyContains / omissionInvention /
 *       scoreFields / groundedConfidence / scoreRun / summarize / costUsd
 * Cross-checked against independent oracles in src/oracle.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { core, pick } from '../src/core.ts';
import { pkgDir } from '../src/repo.ts';
import { corrupt, ece, oracleCer, oracleWer, rng } from '../src/oracle.ts';

const C = core.mod;

describe.skipIf(!C.cer)('SCORING: text metrics (Benchmark A)', () => {
  it('SCORE-01 identical text -> CER = WER = 0', () => {
    expect(C.cer('Tab Dolo 650', 'Tab Dolo 650').rate).toBe(0);
    expect(C.wer('Tab Dolo 650', 'Tab Dolo 650').rate).toBe(0);
  });
  it('SCORE-02 kitten->sitting: S=2, I=1, CER = 3/6', () => {
    const r = C.cer('kitten', 'sitting');
    expect(r).toMatchObject({ substitutions: 2, insertions: 1, deletions: 0, refLength: 6 });
    expect(r.rate).toBeCloseTo(0.5, 10);
  });
  it('SCORE-03 WER counts word edits: "take one tablet daily" -> "take 1 tablet" = 2/4', () => {
    expect(C.wer('take one tablet daily', 'take 1 tablet').rate).toBeCloseTo(0.5, 10);
  });
  it('SCORE-04 CER can exceed 1.0 when the hypothesis has many insertions', () => {
    expect(C.cer('ab', 'abcdefgh').rate).toBeCloseTo(3, 10);
  });
  it('SCORE-05 empty reference: empty hyp -> 0; non-empty hyp -> 1', () => {
    expect(C.cer('', '').rate).toBe(0);
    expect(C.cer('', 'x').rate).toBe(1);
  });
  it('SCORE-06 NFC: composed and decomposed accents are equal', () => {
    expect(C.cer('caf\u00e9', 'cafe\u0301').rate).toBe(0);
  });
  it('SCORE-07 Devanagari counted per code point', () => {
    expect(C.cer('दवा', 'दवा').rate).toBe(0);
    expect(C.cer('दवा', 'दव').refLength).toBe(3);
  });
  it('SCORE-08 whitespace runs / line breaks do not count as errors', () => {
    expect(C.cer('Hb  13.5\n g/dL', 'Hb 13.5 g/dL').rate).toBe(0);
  });
  it('SCORE-09 differential: CER and WER match an independent Levenshtein oracle on 300 random corrupted pairs', () => {
    const r = rng(7);
    const base = ['tab metformin 500 mg 1-0-1 x 30 days', 'haemoglobin 13.5 g/dl 13.0-17.0', 'syp ambroxol 5 ml tds after food', 'tsh 2.1 uiu/ml'];
    for (let i = 0; i < 300; i++) {
      const ref = base[i % base.length]!;
      const hyp = corrupt(ref, r() * 0.5, r);
      expect(C.cer(ref, hyp).rate).toBeCloseTo(oracleCer(ref, hyp), 10);
      expect(C.wer(ref, hyp).rate).toBeCloseTo(oracleWer(ref, hyp), 10);
    }
  });
  it('SCORE-10 S + D + hits = refLength (counts are internally consistent)', () => {
    const r = C.cer('Tab Telmisartan 40mg OD', 'Tab Telmsartan 4Omg OD after');
    expect(r.substitutions + r.deletions + r.hits).toBe(r.refLength);
  });
});

describe.skipIf(!C.numericAccuracy)('SCORING: numeric accuracy', () => {
  it('SCORE-11 identical numbers -> 1; one wrong digit -> fraction', () => {
    expect(C.numericAccuracy('Hb 13.5 TLC 7800', 'Hb 13.5 TLC 7800')).toBe(1);
    expect(C.numericAccuracy('Hb 13.5 TLC 7800', 'Hb 13.5 TLC 7300')).toBe(0.5);
  });
  it('SCORE-12 reference range "13.0-17.0" vs "13.0 - 17.0": the hyphen is a range, not a minus sign', () => {
    expect(C.numericAccuracy('Hb 13.5 g/dL 13.0-17.0', 'Hb 13.5 g/dL 13.0 - 17.0')).toBe(1);
  });
  it('SCORE-13 Indian digit grouping "2,50,000" vs "250000" is the same number', () => {
    expect(C.numericAccuracy('Platelets 2,50,000 /cumm', 'Platelets 250000 /cumm')).toBe(1);
  });
});

describe.skipIf(!C.similarity)('SCORING: fuzzy matching helpers', () => {
  it('SCORE-14 similarity is symmetric', () => {
    expect(C.similarity('metformin', 'metformin sr')).toBeCloseTo(C.similarity('metformin sr', 'metformin'), 10);
  });
  it('SCORE-15 fuzzyContains finds an OCR-noisy needle and rejects an absent one', () => {
    expect(C.fuzzyContains('Tab Telmisartan 40mg OD', 'Telmisartn')).toBe(true);
    expect(C.fuzzyContains('Tab Telmisartan 40mg OD', 'Augmentin')).toBe(false);
  });
  it('SCORE-16 omission / invention rates', () => {
    const r = C.omissionInvention('tab dolo 650 bd', 'tab dolo 650 tds daily');
    expect(r.omissionRate).toBeCloseTo(1 / 4, 10);
    expect(r.inventionRate).toBeCloseTo(2 / 5, 10);
  });
});

const med = (o: any) => ({ name: 'Metformin', strength: '500 mg', frequency: '1-0-1', ...o });
const lab = (o: any) => ({ test: 'Haemoglobin', value: '13.5', unit: 'g/dL', ...o });
const D = (meds: any[] = [], labs: any[] = []) => ({ documentType: 'prescription', medications: meds, labResults: labs });

describe.skipIf(!C.scoreFields)('SCORING: field scorer (Benchmark B)', () => {
  it('SCORE-20 identical docs -> P = R = F1 = 1, safety pass', () => {
    const s = C.scoreFields(D([med({})], [lab({})]), D([med({})], [lab({})]));
    expect(s).toMatchObject({ precision: 1, recall: 1, f1: 1, passesSafetyScreen: true });
  });
  it('SCORE-21 permitted formatting differences count as correct and are flagged formattingOnly', () => {
    const s = C.scoreFields(D([med({ name: 'Metformin', strength: '500 mg', frequency: 'BD' })]), D([med({ name: 'Tab. Metformin', strength: '500mg', frequency: '1-0-1' })]));
    expect(s.f1).toBe(1);
    expect(s.comparisons.every((c: any) => c.outcome === 'correct')).toBe(true);
    expect(s.comparisons.filter((c: any) => c.formattingOnly).length).toBe(3);
  });
  it('SCORE-22 wrong strength is a critical error and fails the safety screen', () => {
    const s = C.scoreFields(D([med({})]), D([med({ strength: '1000 mg' })]));
    expect(s.passesSafetyScreen).toBe(false);
    expect(s.comparisons.find((c: any) => c.field === 'strength').outcome).toBe('wrong');
  });
  it('SCORE-23 missing medication -> recall drops, missingRequired counted', () => {
    const s = C.scoreFields(D([med({}), med({ name: 'Telmisartan', strength: '40 mg', frequency: 'OD' })]), D([med({})]));
    expect(s.recall).toBeCloseTo(3 / 6, 10);
    expect(s.missingRequired).toBe(1);
  });
  it('SCORE-24 hallucinated medication -> precision drops, unsupported counted', () => {
    const s = C.scoreFields(D([med({})]), D([med({}), med({ name: 'Augmentin', strength: '625 mg', frequency: 'BD' })]));
    expect(s.precision).toBeCloseTo(3 / 6, 10);
    expect(s.unsupported).toBe(3);
  });
  it('SCORE-25 empty reference and empty prediction -> perfect, not NaN', () => {
    expect(C.scoreFields(D(), D())).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });
  it('SCORE-26 order-independence: same lab test name twice (Neutrophils % and absolute), reordered prediction scores 1', () => {
    const ref = D([], [lab({ test: 'Neutrophils', value: '60', unit: '%' }), lab({ test: 'Neutrophils', value: '3.6', unit: '10^3/uL' })]);
    const pred = D([], [lab({ test: 'Neutrophils', value: '3.6', unit: '10^3/uL' }), lab({ test: 'Neutrophils', value: '60', unit: '%' })]);
    expect(C.scoreFields(ref, pred).f1).toBe(1);
  });
  it('SCORE-27 order-independence: same drug at two strengths, reordered', () => {
    const ref = D([med({ strength: '500 mg' }), med({ strength: '1000 mg', frequency: '0-0-1' })]);
    const pred = D([med({ strength: '1000 mg', frequency: '0-0-1' }), med({ strength: '500 mg' })]);
    expect(C.scoreFields(ref, pred).passesSafetyScreen).toBe(true);
  });
  it('SCORE-28 entity matching is symmetric: "Metformin" vs "Metformin SR" pairs the same way either direction', () => {
    const a = C.scoreFields(D([med({ name: 'Metformin' })]), D([med({ name: 'Metformin SR' })]));
    const b = C.scoreFields(D([med({ name: 'Metformin SR' })]), D([med({ name: 'Metformin' })]));
    const pairedA = a.comparisons.some((c: any) => c.field === 'name' && c.outcome === 'wrong');
    const pairedB = b.comparisons.some((c: any) => c.field === 'name' && c.outcome === 'wrong');
    expect(pairedA).toBe(pairedB);
  });
  it('SCORE-29 lab unit equivalents are permitted normalisations: gm/dL=g/dL, mcg/L=µg/L, "< 0.5"="<0.5"', () => {
    const s = C.scoreFields(
      D([], [lab({ unit: 'g/dL' }), lab({ test: 'B12', value: '245', unit: 'µg/L' }), lab({ test: 'CRP', value: '<0.5', unit: 'mg/dL' })]),
      D([], [lab({ unit: 'gm/dL' }), lab({ test: 'B12', value: '245', unit: 'mcg/L' }), lab({ test: 'CRP', value: '< 0.5', unit: 'mg/dL' })]),
    );
    const bad = s.comparisons.filter((c: any) => c.outcome !== 'correct').map((c: any) => `${c.entityKey}.${c.field}: ${c.expected} vs ${c.actual}`);
    expect(bad, JSON.stringify(bad)).toEqual([]);
  });
  it('SCORE-30 hand-computed P/R/F1 on a mixed case', () => {
    // ref: Metformin(name,strength,freq) ; pred: Metformin with wrong freq + extra route
    const s = C.scoreFields(D([med({})]), D([med({ frequency: '1-1-1', route: 'oral' })]));
    // correct: name,strength (2); predicted: name,strength,freq,route (4); expected: 3
    expect(s.precision).toBeCloseTo(2 / 4, 10);
    expect(s.recall).toBeCloseTo(2 / 3, 10);
    expect(s.f1).toBeCloseTo((2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3), 10);
  });
});

describe.skipIf(!C.groundedConfidence)('SCORING: calibration of per-field confidence', () => {
  it('SCORE-40 grounded confidence never exceeds the self-reported confidence', () => {
    for (const c of [0.1, 0.5, 0.9, 0.99]) expect(C.groundedConfidence(c, ['Zifi'], 'Tab Zifi 200').confidence).toBeLessThanOrEqual(c);
  });
  it('SCORE-41 ECE <= 0.15 on a synthetic set where Nano is over-confident (0.95) and 40% of entities are hallucinated', () => {
    const r = rng(11); const conf: number[] = []; const correct: number[] = [];
    const drugs = ['Zifi', 'Pan', 'Dolo', 'Augmentin', 'Telma', 'Glycomet', 'Montair', 'Azee', 'Shelcal', 'Rosuvas'];
    for (let i = 0; i < 400; i++) {
      const truth = drugs[i % drugs.length]!; const halluc = r() < 0.4;
      const name = halluc ? drugs[(i + 3) % drugs.length]! : truth;
      const src = `Tab ${truth} 200 mg BD`;
      conf.push(C.groundedConfidence(0.95, [name], src).confidence);
      correct.push(halluc ? 0 : 1);
    }
    const e = ece(conf, correct);
    expect(e, `ECE=${e.toFixed(3)}`).toBeLessThanOrEqual(0.15);
  });
  it.skipIf(!!pick('calibrate'))('SCORE-42 a calibration utility (ECE / reliability) is exported for stage scores', () => {
    expect(pick('calibrate')).toBeTypeOf('function');
  });
});

describe.skipIf(!C.scoreRun)('SCORING: per-run and per-pipeline summaries (Benchmark C)', () => {
  const run = (o: any = {}) => ({ runId: 'r', pipelineId: 'p', docId: 'd', startedAt: '', failed: false,
    steps: [{ stageId: 'ocr', stageKind: 'ocr', site: 'on_device', output: { kind: 'text', text: 'Tab Metformin 500 mg 1-0-1' }, metrics: { latencyMs: 10, costUsd: 0, bytesSent: 0 } }],
    final: { kind: 'fields', doc: D([med({})]) }, totals: { latencyMs: 10, costUsd: 0, bytesSent: 0 }, ...o });
  it('SCORE-50 scoreRun computes CER from the reading stage and F1 from the final fields', () => {
    const s = C.scoreRun(run(), { docId: 'd', text: 'Tab Metformin 500 mg 1-0-1', doc: D([med({})]) });
    expect(s).toMatchObject({ cer: 0, wer: 0, fieldF1: 1, passesSafetyScreen: true });
  });
  it('SCORE-51 summarize averages per-doc metrics and sums bytes/cost', () => {
    const refs = new Map([['d', { docId: 'd', text: 'Tab Metformin 500 mg 1-0-1', doc: D([med({})]) }], ['e', { docId: 'e', text: 'x' }]]);
    const s = C.summarize('p', [run(), run({ docId: 'e', totals: { latencyMs: 30, costUsd: 0.01, bytesSent: 500 } })], refs);
    expect(s).toMatchObject({ docs: 2, meanLatencyMs: 20, totalCostUsd: 0.01, totalBytesSent: 500 });
  });
  it('SCORE-52 a failed run is excluded from accuracy means (or flagged), not scored as if complete', () => {
    const refs = new Map([['d', { docId: 'd', doc: D([med({}), med({ name: 'Telmisartan', strength: '40 mg', frequency: 'OD' })]) }]]);
    const failed = run({ failed: true, final: { kind: 'fields', doc: D([med({})]) } });
    const s = C.scoreRun(failed, refs.get('d'));
    expect(s.failed).toBe(true);
  });
});

describe.skipIf(!C.costUsd)('SCORING: cost model', () => {
  const pinned = (() => { const f = pkgDir('apps/web/src/firebase.ts'); return existsSync(f) ? /CLOUD_MODEL\s*=\s*'([^']+)'/.exec(readFileSync(f, 'utf8'))?.[1] : undefined; })() ?? 'gemini-3.5-flash-lite';
  it(`SCORE-60 cloud cost for the pinned model (${pinned}) is non-zero for 1M in / 1M out tokens`, () => {
    expect(C.costUsd(pinned, 1e6, 1e6)).toBeGreaterThan(0);
  });
  it('SCORE-61 unknown model id throws or is flagged rather than silently costing $0', () => {
    let v: unknown; try { v = C.costUsd('gemini-unknown', 1e6, 1e6); } catch { v = 'threw'; }
    expect(v).not.toBe(0);
  });
  it('SCORE-62 on-device cost is 0', () => {
    expect(C.costUsd('gemini-nano-on-device', 1e6, 1e6)).toBe(0);
  });
});
