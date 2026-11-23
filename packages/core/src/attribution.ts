// SPDX-License-Identifier: Apache-2.0
/**
 * Error attribution: for every wrong/missing field in the final output, find the FIRST stage
 * whose output lost the correct value. Text stages "hold" a value if it is (fuzzily) present
 * in their text; field stages hold it if the structured field matches after normalisation.
 * Example (SoalTech's PaddleOCR -> Qwen case): OCR text contains "BD" but the structuring
 * stage outputs frequency "TDS" -> attributed to the structuring stage, not to OCR.
 */
import type { ClinicalDoc, PipelineRun, StageResult } from './types.js';
import { fieldValueKind, scoreFields, type FieldComparison } from './field-scorer.js';
import { compareValues } from './clinical-values.js';
import { deidentify, PLACEHOLDERS } from './deid.js';
import { fuzzyContains } from './text-metrics.js';

export type AttributionCause =
  | 'misread'            // reading stage text lacks the reference value
  | 'structuring'        // value was in the text but the structured field is wrong/missing
  | 'regression'         // a later stage changed a correct value into a wrong one
  | 'unsupported_inference' // final value not supported by any upstream text
  | 'redacted'           // value replaced by a de-identification placeholder ([DATE], [NAME]...), not an OCR omission
  | 'unattributed';

/** What one stage's output said about the reference value (null = stage carries no evidence, e.g. image). */
export interface StageEvidence { stageId: string; stageKind: StageResult['stageKind']; holds: boolean | null }

export interface Attribution {
  comparison: FieldComparison;
  /** Earliest stage that caused the error (null when unattributable) */
  stageId: string | null;
  cause: AttributionCause;
  /** Kind of the blamed stage */
  stageKind?: StageResult['stageKind'];
  /** Per-stage trail used to decide (reference value held / lost / no evidence) */
  evidence?: StageEvidence[];
  /**
   * cause 'redacted' only: true when the reference value is itself PHI that deid is supposed to
   * remove (a date, a name...), i.e. the loss is by design; false = over-redaction of clinical data.
   */
  expectedRedaction?: boolean;
}

const PLACEHOLDER_RE = new RegExp(Object.values(PLACEHOLDERS).map((p) => p.replace(/[[\]]/g, '\\$&')).join('|'));

/** Text carries at least one de-identification placeholder. */
export function hasPlaceholder(text: string): boolean { return PLACEHOLDER_RE.test(text); }

/** The value is itself something deid redacts (a date, DOB, name, phone...). */
export function isRedactableValue(value: string): boolean { return deidentify(value).total > 0; }

function stageHolds(step: StageResult, c: FieldComparison): boolean | undefined {
  const o = step.output;
  if (c.expected === null) return undefined;
  if (o.kind === 'text') return textHolds(o.text, c);
  if (o.kind === 'fields') {
    const ref = singleFieldDoc(c);
    const s = scoreFields(ref, o.doc).comparisons.find((x) => x.field === c.field && x.expected !== null);
    return s?.outcome === 'correct';
  }
  return undefined; // image stages carry no evidence
}

/**
 * Does `text` contain the reference value, allowing the same permitted normalisation the scorer
 * uses? Fuzzy substring first (OCR noise), then word n-grams compared by field kind, so OCR text
 * "PO" holds a reference route "oral" and "BD" holds frequency "1-0-1".
 */
export function textHolds(text: string, c: Pick<FieldComparison, 'entityType' | 'field' | 'expected'>): boolean {
  if (c.expected === null) return false;
  if (fuzzyContains(text, c.expected)) return true;
  const kind = fieldValueKind(c.entityType, c.field);
  if (kind === 'text') return false;
  // Split on whitespace and punctuation, but keep digit-grouping commas (2,50,000) inside numbers.
  const words = text.split(/[\s;:()]+|,(?!\d)/u).filter(Boolean);
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      if (compareValues(kind, c.expected, words.slice(i, i + n).join(' ')) !== 'mismatch') return true;
    }
  }
  return false;
}

function singleFieldDoc(c: FieldComparison): ClinicalDoc {
  if (c.entityType === 'medication') {
    const m: Record<string, string> = { name: c.entityKey };
    m[c.field] = c.expected ?? '';
    return { documentType: 'prescription', medications: [m as never], labResults: [] };
  }
  const l: Record<string, string> = { test: c.entityKey, value: '' };
  l[c.field] = c.expected ?? '';
  return { documentType: 'lab_report', medications: [], labResults: [l as never] };
}

function textOf(step: StageResult): string | undefined {
  const o = step.output;
  return o.kind === 'text' ? o.text : o.kind === 'fields' ? o.text : undefined;
}

/** Does a fields stage's doc contain the predicted (unsupported) value for this entity? */
function fieldsStageHasActual(step: StageResult, c: FieldComparison): boolean {
  if (step.output.kind !== 'fields' || c.actual === null) return false;
  const doc = step.output.doc;
  const key = c.predictedEntityKey ?? c.entityKey;
  const rows: Record<string, unknown>[] = (c.entityType === 'medication' ? doc.medications : doc.labResults) as unknown as Record<string, unknown>[];
  const keyField = c.entityType === 'medication' ? 'name' : 'test';
  const kind = fieldValueKind(c.entityType, c.field);
  return rows.some((r) => {
    const k = r[keyField], v = r[c.field];
    return typeof k === 'string' && typeof v === 'string' && v !== ''
      && compareValues(fieldValueKind(c.entityType, keyField), key, k) !== 'mismatch'
      && compareValues(kind, c.actual!, v) !== 'mismatch';
  });
}

/**
 * Pin every non-correct field of the final output on the earliest stage that caused it, by comparing
 * each stage's intermediate output with the reference (design.md §5, spec §7 "combined pipeline scores"):
 * - missing / wrong: walk the trace; the first stage whose output no longer holds the reference value is
 *   blamed: 'misread' if it is a reading/text stage that never had it, 'structuring' if the text had it but
 *   the structured field is wrong, 'regression' if a later fields stage broke a value that was correct.
 * - unsupported (a value with no reference): blamed on the first fields stage that emitted it;
 *   'structuring' if some upstream text supports it, else 'unsupported_inference' (hallucination).
 */
export function attributeErrors(run: PipelineRun, reference: ClinicalDoc): Attribution[] {
  const final = run.final;
  if (final.kind !== 'fields') return [];
  const score = scoreFields(reference, final.doc);
  const errs = score.comparisons.filter((c) => c.outcome !== 'correct');
  const steps = run.steps.filter((s) => !s.error);
  const firstFieldsIdx = steps.findIndex((s) => s.output.kind === 'fields');
  return errs.map((c): Attribution => {
    if (c.outcome === 'unsupported') {
      const introducer = steps.find((s) => fieldsStageHasActual(s, c)) ?? steps[firstFieldsIdx];
      const upto = introducer ? steps.slice(0, steps.indexOf(introducer) + 1) : steps;
      const supported = c.actual !== null && upto.some((s) => {
        const t = textOf(s);
        return t !== undefined && textHolds(t, { entityType: c.entityType, field: c.field, expected: c.actual });
      });
      return { comparison: c, stageId: introducer?.stageId ?? null, ...(introducer ? { stageKind: introducer.stageKind } : {}), cause: supported ? 'structuring' : 'unsupported_inference' };
    }
    const evidence: StageEvidence[] = steps.map((st) => ({ stageId: st.stageId, stageKind: st.stageKind, holds: stageHolds(st, c) ?? null }));
    let heldBefore = false;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!, h = evidence[i]!.holds;
      if (h === null) continue;
      if (h) { heldBefore = true; continue; }
      const blame = { comparison: c, stageId: step.stageId, stageKind: step.stageKind, evidence };
      // De-identification placeholders: a gold date that reads [DATE] here was redacted, not misread.
      const t = textOf(step);
      if (t !== undefined && hasPlaceholder(t) && c.expected !== null) {
        const redactable = isRedactableValue(c.expected);
        if (step.stageKind === 'deid' || redactable) return { ...blame, cause: 'redacted', expectedRedaction: redactable };
      }
      if (heldBefore) return { ...blame, cause: step.output.kind === 'fields' && i > firstFieldsIdx ? 'regression' : 'structuring' };
      if (step.stageKind === 'ocr+structure') {
        // One stage both read and structured: its own text tells the two apart.
        const t = textOf(step);
        return { ...blame, cause: t !== undefined && textHolds(t, c) ? 'structuring' : 'misread' };
      }
      return { ...blame, cause: step.output.kind === 'text' || step.stageKind === 'ocr' ? 'misread' : 'structuring' };
    }
    return { comparison: c, stageId: null, cause: 'unattributed', evidence };
  });
}
