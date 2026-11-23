// SPDX-License-Identifier: Apache-2.0
/**
 * JSON Schema and TypeScript types for Gemini Nano extraction.
 *
 * Field names follow the shared ClinicalDoc interface in @med-ocr/core
 * (documentType, medications[].name, labResults, referenceRange) but this
 * schema is a Nano-sized subset: no inferred fields (genericName, flag,
 * route, brand/generic mapping, abnormal flags), one enum, and per-field
 * confidence instead of a single item-level score.
 *
 * documentType omits core's "discharge_summary"; Nano should emit "other"
 * for those documents so the cloud can classify further if needed.
 *
 * The schema is a plain object for LanguageModel.prompt({ responseConstraint })
 * or Firebase onDeviceParams.promptOptions.responseConstraint. Do not
 * JSON.stringify it before passing it in.
 */

export const NANO_DOCUMENT_TYPES = ["prescription", "lab_report", "other"] as const;
export type NanoDocumentType = (typeof NANO_DOCUMENT_TYPES)[number];

export interface NanoMedication {
  name: string | null;
  nameConfidence: number;
  dose: string | null;
  doseConfidence: number;
  frequency: string | null;
  frequencyConfidence: number;
  duration: string | null;
  durationConfidence: number;
}

export interface NanoLabResult {
  test: string | null;
  testConfidence: number;
  value: string | null;
  valueConfidence: number;
  unit: string | null;
  unitConfidence: number;
  referenceRange: string | null;
  referenceRangeConfidence: number;
}

export interface NanoExtraction {
  documentType: NanoDocumentType;
  documentTypeConfidence: number;
  rawText: string | null;
  medications: NanoMedication[];
  labResults: NanoLabResult[];
}

/** ClinicalDoc-compatible subset produced by toClinicalFields(). */
export interface ClinicalFields {
  documentType: NanoDocumentType;
  medications: Array<{
    name: string;
    dose: string | null;
    frequency: string | null;
    duration: string | null;
    confidence: number;
  }>;
  labResults: Array<{
    test: string;
    value: string;
    unit: string | null;
    referenceRange: string | null;
    confidence: number;
  }>;
  rawText: string | null;
}

const nullableString = { type: ["string", "null"] } as const;
const confidence = { type: "number", minimum: 0, maximum: 1 } as const;

const medicationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "nameConfidence",
    "dose",
    "doseConfidence",
    "frequency",
    "frequencyConfidence",
    "duration",
    "durationConfidence",
  ],
  properties: {
    name: nullableString,
    nameConfidence: confidence,
    dose: nullableString,
    doseConfidence: confidence,
    frequency: nullableString,
    frequencyConfidence: confidence,
    duration: nullableString,
    durationConfidence: confidence,
  },
} as const;

const labResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "test",
    "testConfidence",
    "value",
    "valueConfidence",
    "unit",
    "unitConfidence",
    "referenceRange",
    "referenceRangeConfidence",
  ],
  properties: {
    test: nullableString,
    testConfidence: confidence,
    value: nullableString,
    valueConfidence: confidence,
    unit: nullableString,
    unitConfidence: confidence,
    referenceRange: nullableString,
    referenceRangeConfidence: confidence,
  },
} as const;

/**
 * Plain JSON Schema object for responseConstraint. Kept shallow: one enum,
 * objects and arrays only, no $ref / oneOf / pattern / maxLength.
 */
export const NANO_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "documentType",
    "documentTypeConfidence",
    "rawText",
    "medications",
    "labResults",
  ],
  properties: {
    documentType: { type: "string", enum: [...NANO_DOCUMENT_TYPES] },
    documentTypeConfidence: confidence,
    rawText: nullableString,
    medications: { type: "array", items: medicationSchema },
    labResults: { type: "array", items: labResultSchema },
  },
} as const;

export type NanoResponseSchema = typeof NANO_RESPONSE_SCHEMA;

export const MEDICATION_VALUE_FIELDS = ["name", "dose", "frequency", "duration"] as const;
export const LAB_VALUE_FIELDS = ["test", "value", "unit", "referenceRange"] as const;
