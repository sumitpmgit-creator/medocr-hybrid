// SPDX-License-Identifier: Apache-2.0
import {
  LAB_VALUE_FIELDS,
  MEDICATION_VALUE_FIELDS,
  NANO_DOCUMENT_TYPES,
  type ClinicalFields,
  type NanoDocumentType,
  type NanoExtraction,
  type NanoLabResult,
  type NanoMedication,
} from "./schema.js";

export type ParseErrorCode =
  | "empty_input"
  | "not_json"
  | "parse_error"
  | "type_error"
  | "missing_field"
  | "invalid_enum"
  | "out_of_range";

export interface ParseIssue {
  path: string;
  code: ParseErrorCode;
  message: string;
}

export type ParseResult =
  | { ok: true; value: NanoExtraction; stripped: string[] }
  | { ok: false; errors: ParseIssue[] };

const DOC_TYPE_ALIASES: Record<string, NanoDocumentType> = {
  prescription: "prescription",
  lab_report: "lab_report",
  "lab report": "lab_report",
  laboratory: "lab_report",
  "laboratory report": "lab_report",
  "lab-report": "lab_report",
  other: "other",
  // Shared ClinicalDoc includes discharge_summary; Nano maps it to "other".
  discharge_summary: "other",
  "discharge summary": "other",
};

function issue(path: string, code: ParseErrorCode, message: string): ParseIssue {
  return { path, code, message };
}

/** Pull a JSON object out of model text: fences, leading chatter, trailing text. */
export function extractJsonText(raw: string): { text: string } | { errors: ParseIssue[] } {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { errors: [issue("", "empty_input", "Output is empty")] };

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fencedBody = fenced?.[1];
  const candidate = (fencedBody !== undefined ? fencedBody : unclosedFence(trimmed) ?? trimmed).trim();

  const start = candidate.indexOf("{");
  if (start < 0) {
    return { errors: [issue("", "not_json", "No JSON object found in the model output")] };
  }
  const sliced = sliceBalancedObject(candidate, start);
  if (sliced === null) {
    return { errors: [issue("", "not_json", "JSON object is truncated or unbalanced")] };
  }
  return { text: sliced };
}

function unclosedFence(text: string): string | null {
  const m = text.match(/^```(?:json)?\s*([\s\S]*)$/i);
  if (!m) return null;
  const inner = m[1] ?? "";
  // Only treat as an unclosed fence when it starts the string (no trailing closer).
  if (text.includes("```", text.indexOf("```") + 3)) return null;
  return inner;
}

function sliceBalancedObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown, path: string, errors: ParseIssue[]): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  errors.push(issue(path, "type_error", `Expected string or null, got ${typeName(value)}`));
  return undefined;
}

function asConfidence(value: unknown, path: string, errors: ParseIssue[]): number | undefined {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    n = Number(value);
  } else {
    errors.push(issue(path, "type_error", `Expected a number 0-1, got ${typeName(value)}`));
    return undefined;
  }
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    errors.push(issue(path, "out_of_range", `Confidence must be between 0 and 1 inclusive, got ${n}`));
    return undefined;
  }
  return n;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function requireKey(obj: Record<string, unknown>, key: string, path: string, errors: ParseIssue[]): unknown {
  if (!(key in obj)) {
    errors.push(issue(path, "missing_field", `Missing required field "${key}"`));
    return undefined;
  }
  return obj[key];
}

function parseDocumentType(value: unknown, path: string, errors: ParseIssue[]): NanoDocumentType | undefined {
  if (typeof value !== "string") {
    errors.push(issue(path, "type_error", `Expected a documentType string, got ${typeName(value)}`));
    return undefined;
  }
  const key = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const aliased = DOC_TYPE_ALIASES[key] ?? DOC_TYPE_ALIASES[key.replace(/ /g, "_")];
  if (!aliased) {
    errors.push(
      issue(
        path,
        "invalid_enum",
        `documentType must be one of ${NANO_DOCUMENT_TYPES.join(", ")} (got ${JSON.stringify(value)})`,
      ),
    );
    return undefined;
  }
  return aliased;
}

function parseMedication(value: unknown, path: string, errors: ParseIssue[], stripped: string[]): NanoMedication | undefined {
  if (!isPlainObject(value)) {
    errors.push(issue(path, "type_error", `Expected a medication object, got ${typeName(value)}`));
    return undefined;
  }
  collectStripped(value, MEDICATION_KEYS, path, stripped);
  const name = asNullableString(requireKey(value, "name", `${path}.name`, errors), `${path}.name`, errors);
  const nameConfidence = asConfidence(
    requireKey(value, "nameConfidence", `${path}.nameConfidence`, errors),
    `${path}.nameConfidence`,
    errors,
  );
  const dose = asNullableString(requireKey(value, "dose", `${path}.dose`, errors), `${path}.dose`, errors);
  const doseConfidence = asConfidence(
    requireKey(value, "doseConfidence", `${path}.doseConfidence`, errors),
    `${path}.doseConfidence`,
    errors,
  );
  const frequency = asNullableString(
    requireKey(value, "frequency", `${path}.frequency`, errors),
    `${path}.frequency`,
    errors,
  );
  const frequencyConfidence = asConfidence(
    requireKey(value, "frequencyConfidence", `${path}.frequencyConfidence`, errors),
    `${path}.frequencyConfidence`,
    errors,
  );
  const duration = asNullableString(
    requireKey(value, "duration", `${path}.duration`, errors),
    `${path}.duration`,
    errors,
  );
  const durationConfidence = asConfidence(
    requireKey(value, "durationConfidence", `${path}.durationConfidence`, errors),
    `${path}.durationConfidence`,
    errors,
  );
  if (
    name === undefined ||
    nameConfidence === undefined ||
    dose === undefined ||
    doseConfidence === undefined ||
    frequency === undefined ||
    frequencyConfidence === undefined ||
    duration === undefined ||
    durationConfidence === undefined
  ) {
    return undefined;
  }
  return { name, nameConfidence, dose, doseConfidence, frequency, frequencyConfidence, duration, durationConfidence };
}

function parseLab(value: unknown, path: string, errors: ParseIssue[], stripped: string[]): NanoLabResult | undefined {
  if (!isPlainObject(value)) {
    errors.push(issue(path, "type_error", `Expected a lab result object, got ${typeName(value)}`));
    return undefined;
  }
  collectStripped(value, LAB_KEYS, path, stripped);
  const test = asNullableString(requireKey(value, "test", `${path}.test`, errors), `${path}.test`, errors);
  const testConfidence = asConfidence(
    requireKey(value, "testConfidence", `${path}.testConfidence`, errors),
    `${path}.testConfidence`,
    errors,
  );
  const valueText = asNullableString(requireKey(value, "value", `${path}.value`, errors), `${path}.value`, errors);
  const valueConfidence = asConfidence(
    requireKey(value, "valueConfidence", `${path}.valueConfidence`, errors),
    `${path}.valueConfidence`,
    errors,
  );
  const unit = asNullableString(requireKey(value, "unit", `${path}.unit`, errors), `${path}.unit`, errors);
  const unitConfidence = asConfidence(
    requireKey(value, "unitConfidence", `${path}.unitConfidence`, errors),
    `${path}.unitConfidence`,
    errors,
  );
  const referenceRange = asNullableString(
    requireKey(value, "referenceRange", `${path}.referenceRange`, errors),
    `${path}.referenceRange`,
    errors,
  );
  const referenceRangeConfidence = asConfidence(
    requireKey(value, "referenceRangeConfidence", `${path}.referenceRangeConfidence`, errors),
    `${path}.referenceRangeConfidence`,
    errors,
  );
  if (
    test === undefined ||
    testConfidence === undefined ||
    valueText === undefined ||
    valueConfidence === undefined ||
    unit === undefined ||
    unitConfidence === undefined ||
    referenceRange === undefined ||
    referenceRangeConfidence === undefined
  ) {
    return undefined;
  }
  return {
    test,
    testConfidence,
    value: valueText,
    valueConfidence,
    unit,
    unitConfidence,
    referenceRange,
    referenceRangeConfidence,
  };
}

const ROOT_KEYS = new Set([
  "documentType",
  "documentTypeConfidence",
  "rawText",
  "medications",
  "labResults",
]);
const MEDICATION_KEYS = new Set([
  "name",
  "nameConfidence",
  "dose",
  "doseConfidence",
  "frequency",
  "frequencyConfidence",
  "duration",
  "durationConfidence",
]);
const LAB_KEYS = new Set([
  "test",
  "testConfidence",
  "value",
  "valueConfidence",
  "unit",
  "unitConfidence",
  "referenceRange",
  "referenceRangeConfidence",
]);

function collectStripped(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  stripped: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) stripped.push(path ? `${path}.${key}` : key);
  }
}

/**
 * Parse Nano's raw string output into a typed NanoExtraction.
 * Tolerates markdown fences, leading chatter, and trailing text.
 * Unknown properties are stripped (listed on success) rather than rejected,
 * so slightly messy output still yields a usable object.
 */
export function parseNanoOutput(raw: unknown): ParseResult {
  if (typeof raw !== "string") {
    return { ok: false, errors: [issue("", "type_error", `Expected a string, got ${typeName(raw)}`)] };
  }
  const extracted = extractJsonText(raw);
  if ("errors" in extracted) return { ok: false, errors: extracted.errors };

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [issue("", "parse_error", `JSON.parse failed: ${message}`)] };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, errors: [issue("", "type_error", `Expected a JSON object, got ${typeName(parsed)}`)] };
  }

  const errors: ParseIssue[] = [];
  const stripped: string[] = [];
  collectStripped(parsed, ROOT_KEYS, "", stripped);

  const documentType = parseDocumentType(
    requireKey(parsed, "documentType", "documentType", errors),
    "documentType",
    errors,
  );
  const documentTypeConfidence = asConfidence(
    requireKey(parsed, "documentTypeConfidence", "documentTypeConfidence", errors),
    "documentTypeConfidence",
    errors,
  );
  const rawText = asNullableString(requireKey(parsed, "rawText", "rawText", errors), "rawText", errors);

  const medicationsRaw = requireKey(parsed, "medications", "medications", errors);
  const labResultsRaw = requireKey(parsed, "labResults", "labResults", errors);

  let medications: NanoMedication[] | undefined;
  if (medicationsRaw !== undefined) {
    if (!Array.isArray(medicationsRaw)) {
      errors.push(issue("medications", "type_error", `Expected an array, got ${typeName(medicationsRaw)}`));
    } else {
      medications = [];
      for (let i = 0; i < medicationsRaw.length; i++) {
        const item = parseMedication(medicationsRaw[i], `medications[${i}]`, errors, stripped);
        if (item) medications.push(item);
      }
    }
  }

  let labResults: NanoLabResult[] | undefined;
  if (labResultsRaw !== undefined) {
    if (!Array.isArray(labResultsRaw)) {
      errors.push(issue("labResults", "type_error", `Expected an array, got ${typeName(labResultsRaw)}`));
    } else {
      labResults = [];
      for (let i = 0; i < labResultsRaw.length; i++) {
        const item = parseLab(labResultsRaw[i], `labResults[${i}]`, errors, stripped);
        if (item) labResults.push(item);
      }
    }
  }

  if (errors.length || documentType === undefined || documentTypeConfidence === undefined || rawText === undefined || !medications || !labResults) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { documentType, documentTypeConfidence, rawText, medications, labResults },
    stripped,
  };
}

function minConfidence(values: number[]): number {
  return values.reduce((a, b) => Math.min(a, b), 1);
}

/**
 * Map a Nano extraction onto the ClinicalDoc-compatible field subset.
 * Rows whose identifying field is null (medication name, lab test or value)
 * are dropped; they remain available on the original extraction for routing.
 */
export function toClinicalFields(extraction: NanoExtraction): ClinicalFields {
  return {
    documentType: extraction.documentType,
    rawText: extraction.rawText,
    medications: extraction.medications
      .filter((m) => m.name !== null)
      .map((m) => ({
        name: m.name as string,
        dose: m.dose,
        frequency: m.frequency,
        duration: m.duration,
        confidence: minConfidence(
          MEDICATION_VALUE_FIELDS.map((f) => m[`${f}Confidence` as const]),
        ),
      })),
    labResults: extraction.labResults
      .filter((l) => l.test !== null && l.value !== null)
      .map((l) => ({
        test: l.test as string,
        value: l.value as string,
        unit: l.unit,
        referenceRange: l.referenceRange,
        confidence: minConfidence(LAB_VALUE_FIELDS.map((f) => l[`${f}Confidence` as const])),
      })),
  };
}
