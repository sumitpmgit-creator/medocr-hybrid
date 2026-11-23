// SPDX-License-Identifier: Apache-2.0
import { LAB_VALUE_FIELDS, MEDICATION_VALUE_FIELDS, type NanoExtraction } from "./schema.js";

/** Default cutoff: fields with confidence below this are sent to the cloud model. */
export const DEFAULT_CLOUD_ROUTE_THRESHOLD = 0.7;

export interface RoutedField {
  /** JS-style path, e.g. medications[0].dose */
  path: string;
  field: string;
  value: string | null;
  confidence: number;
  /** Identifying siblings so the cloud can re-extract this field in context. */
  context: Record<string, string | null>;
}

export interface RouteOptions {
  /** Exclusive upper bound. Fields with confidence < threshold are routed. Default 0.7. */
  threshold?: number;
  /**
   * Also route value fields that Nano set to null (unreadable / absent), even
   * when their confidence is at or above the threshold. Default false; the
   * default helper is confidence-only, as specified.
   */
  includeUnreadable?: boolean;
}

function shouldRoute(confidence: number, value: string | null, opts: Required<RouteOptions>): boolean {
  if (confidence < opts.threshold) return true;
  if (opts.includeUnreadable && value === null) return true;
  return false;
}

/**
 * Pick extracted fields whose confidence is below the threshold so a cloud
 * model can fill them in. documentType is included when it is below threshold.
 * rawText is not routed as a field; the cloud should see the (de-identified) image.
 */
export function fieldsBelowThreshold(
  extraction: NanoExtraction,
  options: RouteOptions = {},
): RoutedField[] {
  const opts: Required<RouteOptions> = {
    threshold: options.threshold ?? DEFAULT_CLOUD_ROUTE_THRESHOLD,
    includeUnreadable: options.includeUnreadable ?? false,
  };
  const out: RoutedField[] = [];

  if (shouldRoute(extraction.documentTypeConfidence, extraction.documentType, opts)) {
    out.push({
      path: "documentType",
      field: "documentType",
      value: extraction.documentType,
      confidence: extraction.documentTypeConfidence,
      context: {},
    });
  }

  extraction.medications.forEach((med, i) => {
    const context = {
      name: med.name,
      dose: med.dose,
      frequency: med.frequency,
      duration: med.duration,
    };
    for (const field of MEDICATION_VALUE_FIELDS) {
      const confidence = med[`${field}Confidence`];
      const value = med[field];
      if (shouldRoute(confidence, value, opts)) {
        out.push({ path: `medications[${i}].${field}`, field, value, confidence, context });
      }
    }
  });

  extraction.labResults.forEach((lab, i) => {
    const context = {
      test: lab.test,
      value: lab.value,
      unit: lab.unit,
      referenceRange: lab.referenceRange,
    };
    for (const field of LAB_VALUE_FIELDS) {
      const confidence = lab[`${field}Confidence`];
      const value = lab[field];
      if (shouldRoute(confidence, value, opts)) {
        out.push({ path: `labResults[${i}].${field}`, field, value, confidence, context });
      }
    }
  });

  return out;
}
