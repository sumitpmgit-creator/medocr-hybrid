// SPDX-License-Identifier: Apache-2.0
/**
 * On-device de-identification and the fail-closed cloud gate.
 *
 * `deidentify`, `assertSafeForCloud`, and `UnsafeForCloudError` all come from
 * `@med-ocr/core` (text only; they do not cover images). Do not reimplement
 * the guard, and do not import `@med-ocr/parsing` (the package root re-exports
 * Node dataset loaders).
 *
 * Text payloads are gated by assertSafeForCloud. The optional cloud baseline
 * (`cloud-read`) sends the page image; hybrid never does. Core de-id does not
 * inspect pixels, so PHI-bearing crops are not sent.
 */
import { assertSafeForCloud, deidentify, UnsafeForCloudError, type ClinicalDoc, type DeidResult, type PhiType } from '@med-ocr/core';

export { assertSafeForCloud, UnsafeForCloudError };

export interface CloudGuardOk { ok: true }
export interface CloudGuardBlocked {
  ok: false;
  message: string;
  residualCount: number;
  residualTypes: string[];
}

export type CloudGuardResult = CloudGuardOk | CloudGuardBlocked;

export function runDeidentify(text: string): DeidResult {
  return deidentify(text);
}

export function formatRedactionCounts(redactions: Partial<Record<PhiType, number>>): string {
  const parts = (Object.entries(redactions) as [PhiType, number | undefined][])
    .filter((entry): entry is [PhiType, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .map(([type, count]) => `${type}: ${count}`);
  return parts.length ? parts.join(', ') : 'none';
}

export function tryAssertSafeForCloud(text: string): CloudGuardResult {
  try {
    assertSafeForCloud(text);
    return { ok: true };
  } catch (err) {
    if (err instanceof UnsafeForCloudError) {
      const types = [...new Set(err.findings.map((f) => f.type))];
      return {
        ok: false,
        message: `Cloud call blocked: ${err.findings.length} residual identifier(s) after de-id (${types.join(', ') || 'unknown'}). Values were not sent.`,
        residualCount: err.findings.length,
        residualTypes: types,
      };
    }
    throw err;
  }
}

export function humanConfirmAll(doc: ClinicalDoc, reason: string): ClinicalDoc {
  const abstentions = [...(doc.abstentions ?? []), reason];
  for (const m of doc.medications) {
    abstentions.push(`HUMAN CONFIRM medication "${m.name}": cloud path blocked`);
  }
  for (const l of doc.labResults) {
    abstentions.push(`HUMAN CONFIRM lab "${l.test}": cloud path blocked`);
  }
  return { ...doc, medications: [...doc.medications], labResults: [...doc.labResults], abstentions };
}

export function humanConfirmNamed(
  doc: ClinicalDoc,
  meds: string[],
  labs: string[],
  reason: string,
): ClinicalDoc {
  const abstentions = [...(doc.abstentions ?? []), reason];
  for (const name of meds) abstentions.push(`HUMAN CONFIRM medication "${name}": cloud path blocked`);
  for (const test of labs) abstentions.push(`HUMAN CONFIRM lab "${test}": cloud path blocked`);
  return { ...doc, medications: [...doc.medications], labResults: [...doc.labResults], abstentions };
}
