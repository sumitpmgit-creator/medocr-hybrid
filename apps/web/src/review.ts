// SPDX-License-Identifier: Apache-2.0
/**
 * Flatten a ClinicalDoc into review cards and a human-confirm queue.
 * Routing reuses `@med-ocr/core` routeDoc / DEFAULT_THRESHOLDS.
 */
import {
  DEFAULT_THRESHOLDS,
  routeDoc,
  type BBox,
  type ClinicalDoc,
  type LabResult,
  type Medication,
  type PipelineRun,
  type RoutingThresholds,
} from '@med-ocr/core';

export type FieldKind = 'medication' | 'lab';
export type FieldSource = 'on-device' | 'cloud' | 'human';
export type ReviewDecision = 'accept' | 'edit' | 'reject';

export interface ReviewField {
  id: string;
  kind: FieldKind;
  index: number;
  label: string;
  value: string;
  confidence: number;
  source: FieldSource;
  bbox?: BBox;
  cropDataUrl?: string;
  needsConfirm: boolean;
  reason?: string;
  decision?: ReviewDecision;
  originalValue: string;
}

export function formatMedication(m: Medication): string {
  return [m.name, m.strength, m.dose, m.frequency, m.duration].filter(Boolean).join(' · ');
}

export function formatLab(l: LabResult): string {
  const flag = l.flag ? ` (${l.flag})` : '';
  return [l.test, [l.value, l.unit].filter(Boolean).join(' '), l.referenceRange].filter(Boolean).join(' · ') + flag;
}

/**
 * Build review fields from the final document of a run.
 * Fields routed to the cloud (or flagged in abstentions / below the human-review
 * threshold after verify) go into the confirm queue.
 */
export function reviewFieldsFromRun(
  run: PipelineRun,
  thresholds: RoutingThresholds = DEFAULT_THRESHOLDS,
): ReviewField[] {
  if (run.final.kind !== 'fields') return [];
  const finalDoc = run.final.doc;
  const sourceText = run.final.text ?? readingTextFromRun(run) ?? '';
  const structured = structuredDoc(run);
  const routed = routeDoc(structured ?? finalDoc, sourceText, thresholds);
  const sentMeds = new Set(routed.meds.filter((m) => m.decision === 'send_to_cloud').map((m) => m.index));
  const sentLabs = new Set(routed.labs.filter((l) => l.decision === 'send_to_cloud').map((l) => l.index));
  const abstentions = finalDoc.abstentions ?? [];

  const fields: ReviewField[] = [];
  finalDoc.medications.forEach((med, index) => {
    const value = formatMedication(med);
    const reason = matchAbstention(abstentions, med.name);
    const confidence = med.confidence ?? routed.meds[index]?.confidence ?? 0;
    const sent = sentMeds.has(index);
    const needsConfirm = Boolean(reason) || confidence < thresholds.humanReview || (sent && confidence < thresholds.acceptOnDevice);
    fields.push({
      id: `med-${index}`,
      kind: 'medication',
      index,
      label: med.name || `Medication ${index + 1}`,
      value,
      confidence,
      source: sent ? 'cloud' : 'on-device',
      bbox: med.bbox,
      needsConfirm,
      reason: reason ?? (needsConfirm ? 'Low confidence — please confirm' : undefined),
      originalValue: value,
    });
  });
  finalDoc.labResults.forEach((lab, index) => {
    const value = formatLab(lab);
    const reason = matchAbstention(abstentions, lab.test);
    const confidence = lab.confidence ?? routed.labs[index]?.confidence ?? 0;
    const sent = sentLabs.has(index);
    const needsConfirm = Boolean(reason) || confidence < thresholds.humanReview || (sent && confidence < thresholds.acceptOnDevice);
    fields.push({
      id: `lab-${index}`,
      kind: 'lab',
      index,
      label: lab.test || `Lab ${index + 1}`,
      value,
      confidence,
      source: sent ? 'cloud' : 'on-device',
      bbox: lab.bbox,
      needsConfirm,
      reason: reason ?? (needsConfirm ? 'Low confidence — please confirm' : undefined),
      originalValue: value,
    });
  });
  return fields;
}

export function confirmQueue(fields: readonly ReviewField[]): ReviewField[] {
  return fields.filter((f) => f.needsConfirm && !f.decision);
}

export function applyDecision(fields: ReviewField[], id: string, decision: ReviewDecision, editedValue?: string): ReviewField[] {
  return fields.map((field) => {
    if (field.id !== id) return field;
    if (decision === 'edit') {
      const value = (editedValue ?? field.value).trim();
      return { ...field, decision: 'edit', value, needsConfirm: false, source: 'human' };
    }
    if (decision === 'reject') {
      return { ...field, decision: 'reject', needsConfirm: false, source: 'human' };
    }
    return { ...field, decision: 'accept', needsConfirm: false, source: 'human' };
  });
}

/** Apply accepted/edited/rejected fields back onto a clinical document. */
export function applyReviewsToDoc(doc: ClinicalDoc, fields: readonly ReviewField[]): ClinicalDoc {
  const medications = [...doc.medications];
  const labResults = [...doc.labResults];
  const dropMeds = new Set<number>();
  const dropLabs = new Set<number>();
  for (const field of fields) {
    if (field.kind === 'medication') {
      if (field.decision === 'reject') dropMeds.add(field.index);
      else if (field.decision === 'edit') {
        const current = medications[field.index];
        if (current) medications[field.index] = { ...current, instructions: field.value, confidence: 1 };
      } else if (field.decision === 'accept') {
        const current = medications[field.index];
        if (current) medications[field.index] = { ...current, confidence: 1 };
      }
    } else if (field.decision === 'reject') dropLabs.add(field.index);
    else if (field.decision === 'edit') {
      const current = labResults[field.index];
      if (current) labResults[field.index] = { ...current, value: field.value, confidence: 1 };
    } else if (field.decision === 'accept') {
      const current = labResults[field.index];
      if (current) labResults[field.index] = { ...current, confidence: 1 };
    }
  }
  return {
    ...doc,
    medications: medications.filter((_, i) => !dropMeds.has(i)),
    labResults: labResults.filter((_, i) => !dropLabs.has(i)),
    abstentions: [],
  };
}

function matchAbstention(abstentions: string[], name: string): string | undefined {
  const needle = name.toLowerCase();
  return abstentions.find((line) => line.toLowerCase().includes(needle));
}

function structuredDoc(run: PipelineRun): ClinicalDoc | undefined {
  for (const step of run.steps) {
    if (step.stageKind === 'structure' && step.output.kind === 'fields') return step.output.doc;
  }
  return undefined;
}

function readingTextFromRun(run: PipelineRun): string | undefined {
  for (const step of run.steps) {
    if (step.output.kind === 'text') return step.output.text;
    if (step.output.kind === 'fields' && step.output.text) return step.output.text;
  }
  return undefined;
}
