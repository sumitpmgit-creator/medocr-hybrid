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
import { fuzzyContains } from './text-metrics.js';

export type AttributionCause =
  | 'misread'            // reading stage text lacks the reference value
  | 'structuring'        // value was in the text but the structured field is wrong/missing
  | 'regression'         // a later stage changed a correct value into a wrong one
  | 'unsupported_inference' // final value not supported by any upstream text
  | 'unattributed';

export interface Attribution {
  comparison: FieldComparison;
  stageId: string | null;
  cause: AttributionCause;
}

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
  const words = text.split(/[\s,;:()]+/u).filter(Boolean);
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

export function attributeErrors(run: PipelineRun, reference: ClinicalDoc): Attribution[] {
  const final = run.final;
  if (final.kind !== 'fields') return [];
  const score = scoreFields(reference, final.doc);
  const errs = score.comparisons.filter((c) => c.outcome !== 'correct');
  const texts = run.steps.filter((s) => s.output.kind === 'text' || (s.output.kind === 'fields' && s.output.text));
  return errs.map((c) => {
    if (c.outcome === 'unsupported') {
      const supported = c.actual !== null && texts.some((s) => {
        const o = s.output;
        const t = o.kind === 'text' ? o.text : o.kind === 'fields' ? o.text ?? '' : '';
        return fuzzyContains(t, c.actual!);
      });
      const firstFieldStage = run.steps.find((s) => s.output.kind === 'fields');
      return { comparison: c, stageId: firstFieldStage?.stageId ?? null, cause: supported ? 'structuring' : 'unsupported_inference' };
    }
    let heldBefore = false;
    for (const step of run.steps) {
      const h = stageHolds(step, c);
      if (h === undefined) continue;
      if (h) { heldBefore = true; continue; }
      if (heldBefore) {
        return { comparison: c, stageId: step.stageId, cause: step.output.kind === 'fields' && run.steps.indexOf(step) > run.steps.findIndex((s) => s.output.kind === 'fields') ? 'regression' : 'structuring' };
      }
      return { comparison: c, stageId: step.stageId, cause: step.output.kind === 'text' || step.stageKind === 'ocr' || step.stageKind === 'ocr+structure' ? 'misread' : 'structuring' };
    }
    return { comparison: c, stageId: null, cause: 'unattributed' };
  });
}
