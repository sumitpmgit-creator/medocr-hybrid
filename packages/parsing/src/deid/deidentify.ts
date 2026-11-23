// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic de-identification, run on-device before any text is sent to
 * a cloud model. Drop-in superset of `@med-ocr/core`'s `deidentify`:
 * same function name, PhiType counts, `total`, and core placeholders, plus
 * `spans`, address/PIN coverage, Hindi/Bangla labels, landlines, and
 * `assertSafeForCloud`.
 *
 * Rule-based: labelled-context heuristics plus high-precision patterns.
 * It is not a guarantee of anonymisation.
 *
 * Redacted: patient/doctor names (when labelled or titled), ABHA numbers and
 * addresses, Indian phone numbers, postal addresses / PIN codes, doctor
 * registration numbers, emails, Aadhaar (grouped 4-4-4 or 12-digit, as in
 * core), and labelled UHID/MRN.
 *
 * Preserved: drug names, doses, frequencies, durations, lab values, units,
 * reference ranges, and an age in years when it is printed on the document.
 * Dates of birth are replaced with [DOB]; every other calendar date with [DATE].
 *
 * Known gaps:
 * - Unlabelled names outside the Indian name seed list, and without a label
 *   or relation cue, can slip through.
 * - Images, letterheads, stamps and signatures are not redacted.
 * - OCR-garbled labels may miss.
 * - Unlabelled 12-digit Aadhaar (ported from core) can false-positive on
 *   a 12-digit instrument or accession number.
 * - Hospital/clinic names are left unless they look like "Dr. <person>"
 *   without an organisation suffix.
 */
import { applyRedactions, findRedactions } from "./find.js";
import type { DeidResult, PhiType } from "./types.js";

export function deidentify(input: string): DeidResult {
  const text = input ?? "";
  const spans = findRedactions(text);
  const redactions: Partial<Record<PhiType, number>> = {};
  for (const s of spans) {
    redactions[s.type] = (redactions[s.type] ?? 0) + 1;
  }
  return {
    text: applyRedactions(text, spans),
    redactions,
    total: spans.length,
    spans,
  };
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
