// SPDX-License-Identifier: Apache-2.0
/**
 * Hybrid routing. Thresholds come from Firebase Remote Config so they can be tuned live.
 * Field confidence = min(model self-report, evidence grounding), because self-reported
 * confidence from small models is poorly calibrated.
 */
import type { ClinicalDoc, LabResult, Medication } from './types.js';
import { fuzzyContains } from './text-metrics.js';
import { normalizeFrequency, normalizeName, normalizeNumber, normalizeStrength, normalizeUnit } from './normalize.js';

export interface RoutingThresholds {
  /** At or above: accept on-device result */
  acceptOnDevice: number;
  /** Below this after cloud check, or on disagreement: human confirm */
  humanReview: number;
}

export const DEFAULT_THRESHOLDS: RoutingThresholds = { acceptOnDevice: 0.85, humanReview: 0.5 };

export type RouteDecision = 'accept_on_device' | 'send_to_cloud' | 'human_confirm';

export interface EntityRoute<T> { index: number; entity: T; confidence: number; grounded: boolean; decision: RouteDecision }

export function groundedConfidence(selfReported: number | undefined, values: (string | null | undefined)[], sourceText: string): { confidence: number; grounded: boolean } {
  const present = values.filter((v): v is string => !!v);
  const grounded = present.every((v) => fuzzyContains(sourceText, v, 0.8));
  const self = selfReported ?? 0.5;
  return { confidence: grounded ? self : Math.min(self, 0.4), grounded };
}

export function routeDoc(doc: ClinicalDoc, sourceText: string, t: RoutingThresholds = DEFAULT_THRESHOLDS) {
  const decide = (c: number): RouteDecision => (c >= t.acceptOnDevice ? 'accept_on_device' : 'send_to_cloud');
  const meds: EntityRoute<Medication>[] = doc.medications.map((m, index) => {
    const g = groundedConfidence(m.confidence, [m.name, m.strength, m.dose], sourceText);
    return { index, entity: m, ...g, decision: decide(g.confidence) };
  });
  const labs: EntityRoute<LabResult>[] = doc.labResults.map((l, index) => {
    const g = groundedConfidence(l.confidence, [l.test, l.value], sourceText);
    return { index, entity: l, ...g, decision: decide(g.confidence) };
  });
  return { meds, labs, toCloud: meds.filter((m) => m.decision === 'send_to_cloud').length + labs.filter((l) => l.decision === 'send_to_cloud').length };
}

/** Compare device vs cloud values for the critical fields; disagreement or low cloud confidence => human. */
export function reconcileMedication(device: Medication, cloud: Medication | undefined, t: RoutingThresholds = DEFAULT_THRESHOLDS): { value: Medication; decision: RouteDecision; disagreements: string[] } {
  if (!cloud) return { value: device, decision: 'human_confirm', disagreements: ['cloud_missing'] };
  const d: string[] = [];
  if (normalizeName(device.name) !== normalizeName(cloud.name)) d.push('name');
  if (normalizeStrength(device.strength) !== normalizeStrength(cloud.strength)) d.push('strength');
  if (normalizeFrequency(device.frequency) !== normalizeFrequency(cloud.frequency)) d.push('frequency');
  if ((device.dose ?? '') !== (cloud.dose ?? '')) d.push('dose');
  const lowCloud = (cloud.confidence ?? 1) < t.humanReview;
  return { value: cloud, decision: d.length || lowCloud ? 'human_confirm' : 'accept_on_device', disagreements: d };
}

export function reconcileLab(device: LabResult, cloud: LabResult | undefined, t: RoutingThresholds = DEFAULT_THRESHOLDS): { value: LabResult; decision: RouteDecision; disagreements: string[] } {
  if (!cloud) return { value: device, decision: 'human_confirm', disagreements: ['cloud_missing'] };
  const d: string[] = [];
  if (normalizeName(device.test) !== normalizeName(cloud.test)) d.push('test');
  if (normalizeNumber(device.value) !== normalizeNumber(cloud.value)) d.push('value');
  if (normalizeUnit(device.unit) !== normalizeUnit(cloud.unit)) d.push('unit');
  const lowCloud = (cloud.confidence ?? 1) < t.humanReview;
  return { value: cloud, decision: d.length || lowCloud ? 'human_confirm' : 'accept_on_device', disagreements: d };
}
