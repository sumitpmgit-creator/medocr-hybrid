// SPDX-License-Identifier: Apache-2.0
/**
 * Plain JSON Schemas shared by on-device (Prompt API responseConstraint) and cloud
 * (responseJsonSchema) calls, so both sides return the same shape.
 */
const nullableString = { type: ['string', 'null'] } as const;

export const MEDICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    strength: nullableString, dosageForm: nullableString, dose: nullableString, route: nullableString,
    frequency: nullableString, timing: nullableString, duration: nullableString, quantity: nullableString,
    instructions: nullableString,
    sourceText: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['name', 'confidence'],
} as const;

export const LAB_JSON_SCHEMA = {
  type: 'object',
  properties: {
    test: { type: 'string' }, value: { type: 'string' }, unit: nullableString, referenceRange: nullableString,
    flag: { type: ['string', 'null'], enum: ['high', 'low', 'normal', 'abnormal', null] },
    sourceText: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['test', 'value', 'confidence'],
} as const;

export const CLINICAL_DOC_JSON_SCHEMA = {
  type: 'object',
  properties: {
    documentType: { type: 'string', enum: ['prescription', 'lab_report', 'discharge_summary', 'other'] },
    medications: { type: 'array', items: MEDICATION_JSON_SCHEMA },
    labResults: { type: 'array', items: LAB_JSON_SCHEMA },
    abstentions: { type: 'array', items: { type: 'string' } },
  },
  required: ['documentType', 'medications', 'labResults'],
} as const;
