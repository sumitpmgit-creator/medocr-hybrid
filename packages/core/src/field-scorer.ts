// SPDX-License-Identifier: Apache-2.0
/** Benchmark B: field-level precision / recall / F1, exact match, missing fields, unsupported values, safety screen. */
import type { ClinicalDoc, LabResult, Medication } from './types.js';
import { normalizeFrequency, normalizeGeneric, normalizeName, normalizeNumber, normalizeStrength, normalizeUnit } from './normalize.js';
import { similarity } from './text-metrics.js';

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
}

type Norm = (v?: string | null) => string;

const MED_FIELDS: { field: keyof Medication; norm: Norm; critical: boolean; required: boolean }[] = [
  { field: 'name', norm: normalizeName, critical: true, required: true },
  { field: 'strength', norm: normalizeStrength, critical: true, required: false },
  { field: 'dose', norm: normalizeGeneric, critical: true, required: false },
  { field: 'frequency', norm: normalizeFrequency, critical: true, required: false },
  { field: 'route', norm: normalizeGeneric, critical: true, required: false },
  { field: 'dosageForm', norm: normalizeGeneric, critical: false, required: false },
  { field: 'timing', norm: normalizeGeneric, critical: false, required: false },
  { field: 'duration', norm: normalizeGeneric, critical: false, required: false },
  { field: 'quantity', norm: normalizeNumber, critical: false, required: false },
  { field: 'instructions', norm: normalizeGeneric, critical: false, required: false },
];

const LAB_FIELDS: { field: keyof LabResult; norm: Norm; critical: boolean; required: boolean }[] = [
  { field: 'test', norm: normalizeName, critical: true, required: true },
  { field: 'value', norm: normalizeNumber, critical: true, required: true },
  { field: 'unit', norm: normalizeUnit, critical: true, required: false },
  { field: 'referenceRange', norm: (v) => (v ?? '').replace(/\s+/g, '').replace(/–/g, '-').toLowerCase(), critical: false, required: false },
  { field: 'flag', norm: normalizeGeneric, critical: false, required: false },
];

/** Greedy best-similarity matching of predicted entities to reference entities by key. */
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

function compareEntities<T extends object>(
  entityType: EntityType,
  ref: T[],
  pred: T[],
  fields: { field: keyof T; norm: Norm; critical: boolean; required: boolean }[],
  key: (t: T) => string,
): FieldComparison[] {
  const out: FieldComparison[] = [];
  const { pairs, unmatchedRef, unmatchedPred } = matchEntities(ref, pred, (t) => normalizeName(key(t)));
  const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  for (const [i, j] of pairs) {
    const r = ref[i]!, p = pred[j]!;
    for (const f of fields) {
      const e = str(r[f.field]), a = str(p[f.field]);
      if (e === null && a === null) continue;
      let outcome: FieldOutcome;
      if (e === null) outcome = 'unsupported';
      else if (a === null) outcome = 'missing';
      else outcome = f.norm(e) === f.norm(a) ? 'correct' : 'wrong';
      out.push({ entityType, entityKey: key(r), field: String(f.field), expected: e, actual: a, outcome, formattingOnly: outcome === 'correct' && e !== a, critical: f.critical });
    }
  }
  for (const i of unmatchedRef) {
    const r = ref[i]!;
    for (const f of fields) {
      const e = str(r[f.field]);
      if (e !== null) out.push({ entityType, entityKey: key(r), field: String(f.field), expected: e, actual: null, outcome: 'missing', critical: f.critical });
    }
  }
  for (const j of unmatchedPred) {
    const p = pred[j]!;
    for (const f of fields) {
      const a = str(p[f.field]);
      if (a !== null) out.push({ entityType, entityKey: key(p), field: String(f.field), expected: null, actual: a, outcome: 'unsupported', critical: f.critical });
    }
  }
  return out;
}

export function scoreFields(reference: ClinicalDoc, predicted: ClinicalDoc): FieldScore {
  const comparisons = [
    ...compareEntities('medication', reference.medications, predicted.medications, MED_FIELDS, (m) => m.name),
    ...compareEntities('lab', reference.labResults, predicted.labResults, LAB_FIELDS, (l) => l.test),
  ];
  const tp = comparisons.filter((c) => c.outcome === 'correct').length;
  const predictedN = comparisons.filter((c) => c.actual !== null).length;
  const expectedN = comparisons.filter((c) => c.expected !== null).length;
  const precision = predictedN ? tp / predictedN : expectedN ? 0 : 1;
  const recall = expectedN ? tp / expectedN : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const requiredSet = new Set(['name', 'test', 'value']);
  return {
    comparisons,
    truePositives: tp,
    predicted: predictedN,
    expected: expectedN,
    precision,
    recall,
    f1,
    exactMatchRate: expectedN ? tp / expectedN : 1,
    missingRequired: comparisons.filter((c) => c.outcome === 'missing' && requiredSet.has(c.field)).length,
    unsupported: comparisons.filter((c) => c.outcome === 'unsupported').length,
    passesSafetyScreen: !comparisons.some((c) => c.critical && (c.outcome === 'wrong' || c.outcome === 'missing' || c.outcome === 'unsupported')),
  };
}
