// SPDX-License-Identifier: Apache-2.0
/** Clinical error register with the spec's four severity levels. */
import type { Attribution } from './attribution.js';
import type { BBox } from './types.js';

export type Severity = 'critical' | 'major' | 'moderate' | 'minor';

export interface ClinicalError {
  id: string;
  runId: string;
  pipelineId: string;
  docId: string;
  stageId: string | null;
  cause: Attribution['cause'];
  entityType: 'medication' | 'lab';
  entity: string;
  field: string;
  expected: string | null;
  actual: string | null;
  errorType: 'substitution' | 'omission' | 'insertion';
  severity: Severity;
  bbox?: BBox;
  /** Storage path / data URL of the image crop the value came from */
  cropRef?: string;
  reviewed?: { by: string; at: string; verdict: 'confirmed' | 'rejected'; note?: string };
}

/** Severity rules (spec section F). */
export function classifySeverity(a: Attribution): Severity {
  const c = a.comparison;
  if (c.formattingOnly) return 'minor';
  if (c.entityType === 'medication') {
    if (c.critical) return 'critical'; // wrong drug identity, strength, dose, frequency, route
    if (['duration', 'timing', 'quantity', 'instructions'].includes(c.field)) return 'major';
    return 'moderate';
  }
  // labs
  if (c.field === 'value' || c.field === 'test') return c.outcome === 'unsupported' ? 'major' : 'critical';
  if (c.field === 'unit' || c.field === 'flag') return 'major';
  return 'moderate';
}

export class ErrorRegister {
  readonly errors: ClinicalError[] = [];
  private docs = new Set<string>();
  private fields = 0;

  /** Record a scored run; `fieldsEvaluated` is the denominator for per-1000-field rates. */
  record(meta: { runId: string; pipelineId: string; docId: string }, attributions: Attribution[], fieldsEvaluated: number, bboxFor?: (a: Attribution) => BBox | undefined): ClinicalError[] {
    this.docs.add(`${meta.pipelineId}:${meta.docId}`);
    this.fields += fieldsEvaluated;
    const added = attributions.map((a, i): ClinicalError => ({
      id: `${meta.runId}#${i}`,
      ...meta,
      stageId: a.stageId,
      cause: a.cause,
      entityType: a.comparison.entityType,
      entity: a.comparison.entityKey,
      field: a.comparison.field,
      expected: a.comparison.expected,
      actual: a.comparison.actual,
      errorType: a.comparison.outcome === 'missing' ? 'omission' : a.comparison.outcome === 'unsupported' ? 'insertion' : 'substitution',
      severity: classifySeverity(a),
      bbox: bboxFor?.(a),
    }));
    this.errors.push(...added);
    return added;
  }

  countBySeverity(): Record<Severity, number> {
    const r: Record<Severity, number> = { critical: 0, major: 0, moderate: 0, minor: 0 };
    for (const e of this.errors) r[e.severity]++;
    return r;
  }

  per100Docs(sev: Severity): number { return this.docs.size ? (this.countBySeverity()[sev] * 100) / this.docs.size : 0; }
  per1000Fields(sev: Severity): number { return this.fields ? (this.countBySeverity()[sev] * 1000) / this.fields : 0; }

  byStage(): Record<string, number> {
    const r: Record<string, number> = {};
    for (const e of this.errors) { const k = e.stageId ?? 'unattributed'; r[k] = (r[k] ?? 0) + 1; }
    return r;
  }

  toCSV(): string {
    const cols: (keyof ClinicalError)[] = ['id', 'pipelineId', 'docId', 'stageId', 'cause', 'severity', 'entityType', 'entity', 'field', 'expected', 'actual', 'errorType'];
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(','), ...this.errors.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
  }
}
