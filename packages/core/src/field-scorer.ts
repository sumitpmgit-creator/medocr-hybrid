// SPDX-License-Identifier: Apache-2.0
/** Benchmark B: field-level precision / recall / F1, exact match, missing fields, unsupported values, safety screen. */
import type { ClinicalDoc, LabResult, Medication } from './types.js';
import { normalizeFrequency, normalizeGeneric, normalizeName, normalizeNumber, normalizeStrength, normalizeUnit } from './normalize.js';
import { similarity } from './text-metrics.js';
import { compareValues, NORMALIZATION_RULES_VERSION, type FieldValueKind, type NumericTolerance } from './clinical-values.js';

export type EntityType = 'medication' | 'lab';
export type FieldOutcome = 'correct' | 'wrong' | 'missing' | 'unsupported';

export interface FieldComparison {
  entityType: EntityType;
  /** Reference entity key (medication name / lab test) or predicted key if unmatched */
  entityKey: string;
  field: string;
  expected: string | null;
  actual: string | null;
  outcome: FieldOutcome;
  /** True when raw strings differ but normalised values match (minor formatting issue) */
  formattingOnly?: boolean;
  critical: boolean;
  /** For correct values: identical raw strings ('exact') or equal only after permitted normalisation */
  match?: 'exact' | 'normalized';
  /** Index of the reference / predicted record this comparison belongs to */
  refIndex?: number;
  predIndex?: number;
  /** Key of the aligned predicted record (may differ in spelling from entityKey) */
  predictedEntityKey?: string;
  /** The whole record had no counterpart (omitted or invented entity), not just this field */
  entityUnmatched?: boolean;
}

export interface FieldScore {
  comparisons: FieldComparison[];
  truePositives: number;
  predicted: number;
  expected: number;
  precision: number;
  recall: number;
  f1: number;
  exactMatchRate: number;
  missingRequired: number;
  unsupported: number;
  /** Spec safety rule: any wrong/missing critical field fails medication-safety screening. */
  passesSafetyScreen: boolean;
  /** Correct with identical raw strings / expected (no normalisation credit) */
  strictExactMatchRate: number;
  /** P/R/F1 per schema field, keyed 'medication.strength', 'lab.value', ... */
  perField: Record<string, FieldPRF>;
  /** P/R/F1 for the seven headline fields (drug, dose, frequency, test, value, unit, referenceRange) */
  benchmarkFields: Record<BenchmarkField, FieldPRF>;
  /** Record alignment between reference and predicted lists */
  alignment: { medication: Alignment; lab: Alignment };
  /** Predicted records repeating the same entity more often than the reference does */
  duplicateEntities: number;
  rulesVersion: string;
}

type Norm = (v?: string | null) => string;

interface FieldSpec<T> { field: keyof T; norm: Norm; kind: FieldValueKind; critical: boolean; required: boolean }

const MED_FIELDS: FieldSpec<Medication>[] = [
  { field: 'name', norm: normalizeName, kind: 'name', critical: true, required: true },
  { field: 'genericName', norm: normalizeName, kind: 'name', critical: true, required: false },
  { field: 'strength', norm: normalizeStrength, kind: 'quantity', critical: true, required: false },
  { field: 'dose', norm: normalizeGeneric, kind: 'quantity', critical: true, required: false },
  { field: 'frequency', norm: normalizeFrequency, kind: 'frequency', critical: true, required: false },
  { field: 'route', norm: normalizeGeneric, kind: 'text', critical: true, required: false },
  { field: 'dosageForm', norm: normalizeGeneric, kind: 'text', critical: false, required: false },
  { field: 'timing', norm: normalizeGeneric, kind: 'text', critical: false, required: false },
  { field: 'duration', norm: normalizeGeneric, kind: 'text', critical: false, required: false },
  { field: 'quantity', norm: normalizeNumber, kind: 'quantity', critical: false, required: false },
  { field: 'instructions', norm: normalizeGeneric, kind: 'text', critical: false, required: false },
];

const LAB_FIELDS: FieldSpec<LabResult>[] = [
  { field: 'test', norm: normalizeName, kind: 'name', critical: true, required: true },
  { field: 'value', norm: normalizeNumber, kind: 'number', critical: true, required: true },
  { field: 'unit', norm: normalizeUnit, kind: 'unit', critical: true, required: false },
  { field: 'referenceRange', norm: (v) => (v ?? '').replace(/\s+/g, '').replace(/–/g, '-').toLowerCase(), kind: 'range', critical: false, required: false },
  { field: 'flag', norm: normalizeGeneric, kind: 'text', critical: false, required: false },
];

/** Value kind used to compare (and classify errors in) a field. */
export function fieldValueKind(entityType: EntityType, field: string): FieldValueKind {
  const specs: FieldSpec<never>[] = (entityType === 'medication' ? MED_FIELDS : LAB_FIELDS) as FieldSpec<never>[];
  return specs.find((f) => f.field === field)?.kind ?? 'text';
}

/** Greedy best-similarity matching of predicted entities to reference entities by key. Kept for compatibility; scoring uses alignRecords. */
export function matchEntities<T>(ref: T[], pred: T[], key: (t: T) => string, minSim = 0.7): { pairs: [number, number][]; unmatchedRef: number[]; unmatchedPred: number[] } {
  const cands: [number, number, number][] = [];
  ref.forEach((r, i) => pred.forEach((p, j) => {
    const s = similarity(key(r), key(p));
    if (s >= minSim) cands.push([s, i, j]);
  }));
  cands.sort((a, b) => b[0] - a[0]);
  const ur = new Set(ref.map((_, i) => i));
  const up = new Set(pred.map((_, j) => j));
  const pairs: [number, number][] = [];
  for (const [, i, j] of cands) {
    if (ur.has(i) && up.has(j)) { pairs.push([i, j]); ur.delete(i); up.delete(j); }
  }
  return { pairs, unmatchedRef: [...ur], unmatchedPred: [...up] };
}

export interface AlignedPair { refIndex: number; predIndex: number; similarity: number }
export interface Alignment { pairs: AlignedPair[]; unmatchedRef: number[]; unmatchedPred: number[] }

/**
 * Optimal one-to-one alignment (Hungarian algorithm) of predicted to reference records.
 * `score(r, p)` returns a similarity in [0, 1+]; pairs below `minScore` are never matched.
 * Maximises total score, so a duplicated drug with two strengths pairs with the right rows
 * instead of whichever greedy match came first.
 */
export function alignRecords<R, P>(ref: readonly R[], pred: readonly P[], score: (r: R, p: P) => number, minScore = 0.7): Alignment {
  const n = Math.max(ref.length, pred.length);
  if (n === 0) return { pairs: [], unmatchedRef: [], unmatchedPred: [] };
  const BIG = 1e6;
  const S: number[][] = ref.map((r) => pred.map((p) => score(r, p)));
  const cost: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    const s = S[i]?.[j];
    return s === undefined ? BIG / 2 : s >= minScore ? -s : BIG;
  }));
  // Hungarian (Kuhn-Munkres), 1-indexed potentials formulation, O(n^3).
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const pairs: AlignedPair[] = [];
  const mr = new Set<number>(), mp = new Set<number>();
  for (let j = 1; j <= n; j++) {
    const i = p[j] - 1, jj = j - 1;
    if (i < ref.length && jj < pred.length) {
      const s = S[i]![jj]!;
      if (s >= minScore) { pairs.push({ refIndex: i, predIndex: jj, similarity: s }); mr.add(i); mp.add(jj); }
    }
  }
  pairs.sort((a, b) => a.refIndex - b.refIndex);
  return { pairs, unmatchedRef: ref.map((_, i) => i).filter((i) => !mr.has(i)), unmatchedPred: pred.map((_, j) => j).filter((j) => !mp.has(j)) };
}

export interface ScoreOptions {
  /** Numeric tolerance for values, strengths and range bounds (default: float noise only). */
  tolerance?: NumericTolerance;
  /** Minimum normalised-name similarity to align two records (default 0.7, as before). */
  minNameSimilarity?: number;
}

const strOf = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));

function compareEntities<T extends object>(
  entityType: EntityType,
  ref: T[],
  pred: T[],
  fields: FieldSpec<T>[],
  key: (t: T) => string,
  secondary: keyof T,
  secondaryKind: FieldValueKind,
  o: ScoreOptions,
): { comparisons: FieldComparison[]; alignment: Alignment } {
  const out: FieldComparison[] = [];
  const minSim = o.minNameSimilarity ?? 0.7;
  // Name similarity gates the match; agreement on the secondary field (strength / value) breaks ties.
  const alignment = alignRecords(ref, pred, (r, p) => {
    const s = similarity(normalizeName(key(r)), normalizeName(key(p)));
    if (s < minSim) return 0;
    const a = strOf(r[secondary]), b = strOf(p[secondary]);
    const bonus = a !== null && b !== null && compareValues(secondaryKind, a, b, o) !== 'mismatch' ? 0.05 : 0;
    return s + bonus;
  }, minSim);
  for (const { refIndex: i, predIndex: j } of alignment.pairs) {
    const r = ref[i]!, p = pred[j]!;
    for (const f of fields) {
      const e = strOf(r[f.field]), a = strOf(p[f.field]);
      if (e === null && a === null) continue;
      let outcome: FieldOutcome;
      let match: FieldComparison['match'];
      if (e === null) outcome = 'unsupported';
      else if (a === null) outcome = 'missing';
      else {
        const m = compareValues(f.kind, e, a, o);
        outcome = m === 'mismatch' ? 'wrong' : 'correct';
        if (m !== 'mismatch') match = m;
      }
      out.push({
        entityType, entityKey: key(r), field: String(f.field), expected: e, actual: a, outcome,
        formattingOnly: outcome === 'correct' && e !== a, critical: f.critical,
        ...(match ? { match } : {}), refIndex: i, predIndex: j, predictedEntityKey: key(p),
      });
    }
  }
  for (const i of alignment.unmatchedRef) {
    const r = ref[i]!;
    for (const f of fields) {
      const e = strOf(r[f.field]);
      if (e !== null) out.push({ entityType, entityKey: key(r), field: String(f.field), expected: e, actual: null, outcome: 'missing', critical: f.critical, refIndex: i, entityUnmatched: true });
    }
  }
  for (const j of alignment.unmatchedPred) {
    const p = pred[j]!;
    for (const f of fields) {
      const a = strOf(p[f.field]);
      if (a !== null) out.push({ entityType, entityKey: key(p), field: String(f.field), expected: null, actual: a, outcome: 'unsupported', critical: f.critical, predIndex: j, predictedEntityKey: key(p), entityUnmatched: true });
    }
  }
  return { comparisons: out, alignment };
}

export interface FieldPRF {
  /** correct values */
  tp: number;
  /** predicted values that are wrong or have no reference */
  fp: number;
  /** reference values that are wrong or missing */
  fn: number;
  /** correct with identical raw strings */
  exact: number;
  /** correct only after permitted normalisation */
  normalized: number;
  precision: number;
  recall: number;
  f1: number;
  /** exact / expected */
  exactMatchRate: number;
  /** (exact + normalized) / expected — the spec's "field exact-match rate after permitted normalization" */
  normalizedMatchRate: number;
}

/** The seven headline fields the hackathon brief and SoalTech §B/§C report on. */
export type BenchmarkField = 'drug' | 'dose' | 'frequency' | 'test' | 'value' | 'unit' | 'referenceRange';

/** Headline field → schema field. 'dose' is the strength (amount + unit, e.g. 500 mg); per-administration `dose` (e.g. 1 tab) is in perField. */
export const BENCHMARK_FIELDS: Record<BenchmarkField, { entityType: EntityType; field: string }> = {
  drug: { entityType: 'medication', field: 'name' },
  dose: { entityType: 'medication', field: 'strength' },
  frequency: { entityType: 'medication', field: 'frequency' },
  test: { entityType: 'lab', field: 'test' },
  value: { entityType: 'lab', field: 'value' },
  unit: { entityType: 'lab', field: 'unit' },
  referenceRange: { entityType: 'lab', field: 'referenceRange' },
};

export function prf(cs: readonly FieldComparison[]): FieldPRF {
  const tp = cs.filter((c) => c.outcome === 'correct').length;
  const predicted = cs.filter((c) => c.actual !== null).length;
  const expected = cs.filter((c) => c.expected !== null).length;
  const exact = cs.filter((c) => c.outcome === 'correct' && c.match !== 'normalized' && !c.formattingOnly).length;
  const precision = predicted ? tp / predicted : expected ? 0 : 1;
  const recall = expected ? tp / expected : 1;
  return {
    tp, fp: predicted - tp, fn: expected - tp, exact, normalized: tp - exact,
    precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    exactMatchRate: expected ? exact / expected : 1,
    normalizedMatchRate: expected ? tp / expected : 1,
  };
}

/** Sum per-field counts across documents (micro-average), recomputing the rates. */
export function mergePRF(items: readonly FieldPRF[]): FieldPRF {
  const s = items.reduce((a, x) => ({ tp: a.tp + x.tp, fp: a.fp + x.fp, fn: a.fn + x.fn, exact: a.exact + x.exact }), { tp: 0, fp: 0, fn: 0, exact: 0 });
  const predicted = s.tp + s.fp, expected = s.tp + s.fn;
  const precision = predicted ? s.tp / predicted : expected ? 0 : 1;
  const recall = expected ? s.tp / expected : 1;
  return {
    ...s, normalized: s.tp - s.exact, precision, recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    exactMatchRate: expected ? s.exact / expected : 1, normalizedMatchRate: expected ? s.tp / expected : 1,
  };
}

function duplicateCount<T>(ref: T[], pred: T[], key: (t: T) => string): number {
  const count = (xs: T[]) => xs.reduce((m, x) => m.set(normalizeName(key(x)), (m.get(normalizeName(key(x))) ?? 0) + 1), new Map<string, number>());
  const r = count(ref), p = count(pred);
  let d = 0;
  for (const [k, n] of p) if (n > 1) d += Math.max(0, n - Math.max(1, r.get(k) ?? 0));
  return d;
}

export function scoreFields(reference: ClinicalDoc, predicted: ClinicalDoc, opts: ScoreOptions = {}): FieldScore {
  const med = compareEntities('medication', reference.medications, predicted.medications, MED_FIELDS, (m) => m.name, 'strength', 'quantity', opts);
  const lab = compareEntities('lab', reference.labResults, predicted.labResults, LAB_FIELDS, (l) => l.test, 'value', 'number', opts);
  const comparisons = [...med.comparisons, ...lab.comparisons];
  const tp = comparisons.filter((c) => c.outcome === 'correct').length;
  const predictedN = comparisons.filter((c) => c.actual !== null).length;
  const expectedN = comparisons.filter((c) => c.expected !== null).length;
  const precision = predictedN ? tp / predictedN : expectedN ? 0 : 1;
  const recall = expectedN ? tp / expectedN : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const requiredSet = new Set(['name', 'test', 'value']);
  const perField: Record<string, FieldPRF> = {};
  for (const c of comparisons) (perField[`${c.entityType}.${c.field}`] ??= prf(comparisons.filter((x) => x.entityType === c.entityType && x.field === c.field)));
  const benchmarkFields = Object.fromEntries(Object.entries(BENCHMARK_FIELDS).map(([k, { entityType, field }]) =>
    [k, prf(comparisons.filter((c) => c.entityType === entityType && c.field === field))])) as Record<BenchmarkField, FieldPRF>;
  return {
    comparisons,
    truePositives: tp,
    predicted: predictedN,
    expected: expectedN,
    precision,
    recall,
    f1,
    exactMatchRate: expectedN ? tp / expectedN : 1,
    strictExactMatchRate: expectedN ? comparisons.filter((c) => c.outcome === 'correct' && !c.formattingOnly).length / expectedN : 1,
    missingRequired: comparisons.filter((c) => c.outcome === 'missing' && requiredSet.has(c.field)).length,
    unsupported: comparisons.filter((c) => c.outcome === 'unsupported').length,
    passesSafetyScreen: !comparisons.some((c) => c.critical && (c.outcome === 'wrong' || c.outcome === 'missing' || c.outcome === 'unsupported')),
    perField,
    benchmarkFields,
    alignment: { medication: med.alignment, lab: lab.alignment },
    duplicateEntities: duplicateCount(reference.medications, predicted.medications, (m) => m.name) + duplicateCount(reference.labResults, predicted.labResults, (l) => l.test),
    rulesVersion: NORMALIZATION_RULES_VERSION,
  };
}
