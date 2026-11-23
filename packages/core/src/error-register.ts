// SPDX-License-Identifier: Apache-2.0
/**
 * Clinical error register (spec §F, design.md §5): one entry per non-correct field, with the stage
 * that caused it, a clinical error type, a severity from documented rules, and JSON/CSV export.
 */
import type { Attribution } from './attribution.js';
import type { BBox } from './types.js';
import { classifyNumericError, type NumericTolerance } from './clinical-values.js';

export type Severity = 'critical' | 'major' | 'moderate' | 'minor';
export const SEVERITIES: readonly Severity[] = ['critical', 'major', 'moderate', 'minor'];

/** Clinical error taxonomy. */
export type ClinicalErrorType =
  | 'omission'        // reference value not extracted (field or whole record)
  | 'hallucination'   // value or record with no reference
  | 'wrong_drug'      // medication identity substituted
  | 'unit_error'      // same number, wrong unit (500 mg vs 500 mcg), or wrong lab unit
  | 'decimal_error'   // misplaced decimal point (12.5 vs 1.25)
  | 'magnitude_error' // off by a power of ten (5 vs 50)
  | 'wrong_frequency'
  | 'wrong_route'
  | 'substitution'    // any other wrong value
  | 'formatting';     // raw strings differ, meaning identical

export const ERROR_REGISTER_SCHEMA_VERSION = 1;

export interface ClinicalError {
  id: string;
  runId: string;
  pipelineId: string;
  docId: string;
  /** Model / stage id that introduced the error (spec: "document ID, model ID") */
  stageId: string | null;
  cause: Attribution['cause'];
  entityType: 'medication' | 'lab';
  entity: string;
  field: string;
  expected: string | null;
  actual: string | null;
  /** Edit operation (unchanged from the scaffold) */
  errorType: 'substitution' | 'omission' | 'insertion';
  /** Clinical error type */
  clinicalType: ClinicalErrorType;
  severity: Severity;
  /** Id of the SEVERITY_RULES entry that decided the severity */
  severityRule: string;
  bbox?: BBox;
  /** Storage path / data URL of the image crop the value came from */
  cropRef?: string;
  reviewed?: { by: string; at: string; verdict: 'confirmed' | 'rejected'; note?: string };
}

const MED_DOSE_FIELDS = new Set(['strength', 'dose']);
const MED_IDENTITY_FIELDS = new Set(['name', 'genericName']);

/** Clinical error type for an attribution. */
export function classifyErrorType(a: Attribution, tol?: NumericTolerance): ClinicalErrorType {
  const c = a.comparison;
  if (c.outcome === 'correct') return 'formatting';
  if (c.outcome === 'missing') return 'omission';
  if (c.outcome === 'unsupported') return 'hallucination';
  if (c.entityType === 'medication' && MED_IDENTITY_FIELDS.has(c.field)) return 'wrong_drug';
  if (c.field === 'frequency') return 'wrong_frequency';
  if (c.field === 'route') return 'wrong_route';
  if (c.entityType === 'lab' && c.field === 'unit') return 'unit_error';
  if (c.expected !== null && c.actual !== null && (MED_DOSE_FIELDS.has(c.field) || c.field === 'quantity' || c.field === 'value')) {
    const k = classifyNumericError(c.expected, c.actual, tol);
    if (k === 'unit') return 'unit_error';
    if (k === 'decimal') return 'decimal_error';
    if (k === 'magnitude') return 'magnitude_error';
  }
  return 'substitution';
}

export interface SeverityRule {
  id: string;
  severity: Severity;
  description: string;
  applies(a: Attribution, type: ClinicalErrorType): boolean;
}

/**
 * Severity rules, evaluated in order; the first that applies wins. Spec §F definitions:
 * critical = could create serious clinical risk if accepted; major = materially incorrect;
 * moderate = incorrect but generally recoverable; minor = formatting without changed meaning.
 */
export const SEVERITY_RULES: readonly SeverityRule[] = [
  { id: 'R01-formatting', severity: 'minor', description: 'Raw strings differ but the normalised values match (formatting only).',
    applies: (a, t) => t === 'formatting' || a.comparison.formattingOnly === true },
  { id: 'R02-drug-identity', severity: 'critical', description: 'Medication identity (name or generic ingredient) wrong, omitted or invented.',
    applies: (a) => a.comparison.entityType === 'medication' && MED_IDENTITY_FIELDS.has(a.comparison.field) },
  { id: 'R03-dose-unit-magnitude', severity: 'critical', description: 'Medication strength or dose with a unit, decimal-point or power-of-ten error.',
    applies: (a, t) => a.comparison.entityType === 'medication' && MED_DOSE_FIELDS.has(a.comparison.field) && (t === 'unit_error' || t === 'decimal_error' || t === 'magnitude_error') },
  { id: 'R04-med-critical-field', severity: 'critical', description: 'Any other error in a critical medication field: strength, dose, frequency or route (harmful dose/frequency/route change).',
    applies: (a) => a.comparison.entityType === 'medication' && ['strength', 'dose', 'frequency', 'route'].includes(a.comparison.field) },
  { id: 'R05-med-regimen', severity: 'major', description: 'Medication duration, timing, quantity or special instructions wrong, omitted or invented.',
    applies: (a) => a.comparison.entityType === 'medication' && ['duration', 'timing', 'quantity', 'instructions'].includes(a.comparison.field) },
  { id: 'R06-med-other', severity: 'moderate', description: 'Other medication metadata (e.g. dosage form).',
    applies: (a) => a.comparison.entityType === 'medication' },
  { id: 'R07-lab-wrong-value', severity: 'critical', description: 'Lab test or value present on both sides but wrong (including decimal, magnitude and unit errors in the value).',
    applies: (a) => a.comparison.entityType === 'lab' && (a.comparison.field === 'value' || a.comparison.field === 'test') && a.comparison.outcome === 'wrong' },
  { id: 'R08-lab-omission', severity: 'major', description: 'Lab test or value omitted (spec example: missing an important abnormal lab result).',
    applies: (a) => a.comparison.entityType === 'lab' && (a.comparison.field === 'value' || a.comparison.field === 'test') && a.comparison.outcome === 'missing' },
  { id: 'R09-lab-invented', severity: 'major', description: 'Invented lab row or value with no reference.',
    applies: (a) => a.comparison.entityType === 'lab' && (a.comparison.field === 'value' || a.comparison.field === 'test') && a.comparison.outcome === 'unsupported' },
  { id: 'R10-lab-unit-flag', severity: 'major', description: 'Lab unit or abnormal flag wrong, omitted or invented.',
    applies: (a) => a.comparison.entityType === 'lab' && (a.comparison.field === 'unit' || a.comparison.field === 'flag') },
  { id: 'R11-other', severity: 'moderate', description: 'Anything else (e.g. reference range).',
    applies: () => true },
];

export function classifySeverityWithRule(a: Attribution, tol?: NumericTolerance): { severity: Severity; rule: SeverityRule; type: ClinicalErrorType } {
  const type = classifyErrorType(a, tol);
  const rule = SEVERITY_RULES.find((r) => r.applies(a, type))!;
  return { severity: rule.severity, rule, type };
}

/** Severity rules (spec section F). See SEVERITY_RULES for the documented table. */
export function classifySeverity(a: Attribution): Severity {
  return classifySeverityWithRule(a).severity;
}

export interface ErrorRegisterSummary {
  documents: number;
  fieldsEvaluated: number;
  bySeverity: Record<Severity, number>;
  per100Docs: Record<Severity, number>;
  per1000Fields: Record<Severity, number>;
  byStage: Record<string, number>;
  byType: Partial<Record<ClinicalErrorType, number>>;
  byCause: Partial<Record<Attribution['cause'], number>>;
}

export interface ErrorRegisterJSON {
  schemaVersion: number;
  severityRules: { id: string; severity: Severity; description: string }[];
  summary: ErrorRegisterSummary;
  errors: ClinicalError[];
}

export class ErrorRegister {
  readonly errors: ClinicalError[] = [];
  private docs = new Set<string>();
  private fields = 0;

  /** Record a scored run; `fieldsEvaluated` is the denominator for per-1000-field rates. */
  record(meta: { runId: string; pipelineId: string; docId: string }, attributions: Attribution[], fieldsEvaluated: number, bboxFor?: (a: Attribution) => BBox | undefined): ClinicalError[] {
    this.docs.add(`${meta.pipelineId}:${meta.docId}`);
    this.fields += fieldsEvaluated;
    const added = attributions.map((a, i): ClinicalError => {
      const { severity, rule, type } = classifySeverityWithRule(a);
      const bbox = bboxFor?.(a);
      return {
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
        clinicalType: type,
        severity,
        severityRule: rule.id,
        ...(bbox ? { bbox } : {}),
      };
    });
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

  summary(): ErrorRegisterSummary {
    const count = <K extends string>(f: (e: ClinicalError) => K) => {
      const r: Partial<Record<K, number>> = {};
      for (const e of this.errors) { const k = f(e); r[k] = (r[k] ?? 0) + 1; }
      return r;
    };
    const per = (fn: (s: Severity) => number) => Object.fromEntries(SEVERITIES.map((s) => [s, fn(s)])) as Record<Severity, number>;
    return {
      documents: this.docs.size,
      fieldsEvaluated: this.fields,
      bySeverity: this.countBySeverity(),
      per100Docs: per((s) => this.per100Docs(s)),
      per1000Fields: per((s) => this.per1000Fields(s)),
      byStage: this.byStage(),
      byType: count((e) => e.clinicalType),
      byCause: count((e) => e.cause),
    };
  }

  /** Deterministic JSON export (no timestamps): rules table, summary and every error. */
  toJSON(): ErrorRegisterJSON {
    return {
      schemaVersion: ERROR_REGISTER_SCHEMA_VERSION,
      severityRules: SEVERITY_RULES.map(({ id, severity, description }) => ({ id, severity, description })),
      summary: this.summary(),
      errors: this.errors.map((e) => ({ ...e })),
    };
  }

  toCSV(): string {
    const cols: (keyof ClinicalError)[] = ['id', 'pipelineId', 'docId', 'stageId', 'cause', 'severity', 'severityRule', 'clinicalType', 'entityType', 'entity', 'field', 'expected', 'actual', 'errorType'];
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(','), ...this.errors.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
  }
}
