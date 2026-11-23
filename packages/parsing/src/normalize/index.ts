// SPDX-License-Identifier: Apache-2.0
import { applyUnicode, collapseWhitespace, trimEdges, unifyPunctuation } from "./general.js";
import { normalizeNumber, normalizeNumbers } from "./numbers.js";
import { canonicalizeUnitsInText, normalizeStrength, normalizeUnit } from "./units.js";
import { normalizeDrugsInText, normalizeName } from "./drugs.js";
import { canonicalizeFrequencyInText, normalizeFrequency } from "./frequency.js";
import { canonicalizeDurationInText, normalizeDuration } from "./duration.js";
import {
  FIELD_OPTIONS,
  MEDICATION_OPTIONS,
  TRANSCRIPTION_OPTIONS,
  resolveOptions,
  type FieldKind,
  type NormalizeMode,
  type NormalizeOptions,
} from "./options.js";

export {
  FIELD_OPTIONS,
  MEDICATION_OPTIONS,
  NORMALIZATION_RULES,
  NORMALIZATION_VERSION,
  PRESETS,
  TRANSCRIPTION_OPTIONS,
  resolveOptions,
  type FieldKind,
  type NormalizeMode,
  type NormalizeOptions,
} from "./options.js";
export { applyUnicode, collapseWhitespace, rewriteSuperscripts, unifyPunctuation } from "./general.js";
export { normalizeNumber, normalizeNumbers } from "./numbers.js";
export { UNIT_ALIAS_RULES, canonicalizeUnitsInText, normalizeStrength, normalizeUnit } from "./units.js";
export {
  BRAND_ALIASES,
  BRAND_ALIASES_COMPLETE,
  DRUG_ALIASES,
  DRUG_ALIASES_COMPLETE,
  fuzzyMatchDrug,
  normalizeDrugName,
  normalizeDrugsInText,
  normalizeGeneric,
  normalizeName,
  stripDosageForms,
  type FuzzyDrugMatch,
  type FuzzyDrugOptions,
  type NormalizeDrugOptions,
  type NormalizedDrug,
} from "./drugs.js";
export { canonicalizeFrequencyInText, normalizeFrequency } from "./frequency.js";
export { canonicalizeDurationInText, normalizeDuration } from "./duration.js";
export { defaultMaxDistance, editDistance } from "./edit-distance.js";

/**
 * Apply configured normalization to a single string.
 * Default mode is "fields" (units/numbers/case, no drug or frequency mapping).
 * For typed clinical fields the scorer uses, prefer the drop-in functions
 * (normalizeFrequency, normalizeStrength, …) or {@link normalizeField}.
 */
export function normalizeText(input: string, options?: NormalizeMode | NormalizeOptions): string {
  if (input == null) return "";
  const opts = resolveOptions(options);
  let s = String(input);
  if (opts.unicodeNfkc || opts.units) {
    // Superscript rewrite lives in applyUnicode; run it whenever units are on
    // so 10³/uL cannot become 103/uL (plain NFKC would flatten ³ to 3).
    s = applyUnicode(s);
  }
  if (opts.punctuationVariants) s = unifyPunctuation(s);
  if (opts.caseFold) s = s.toLowerCase();
  if (opts.numbers) s = normalizeNumbers(s);
  if (opts.units) s = canonicalizeUnitsInText(s);
  if (opts.drugs) s = normalizeDrugsInText(s, { mapBrands: opts.mapBrands });
  if (opts.frequency) s = canonicalizeFrequencyInText(s);
  if (opts.duration) s = canonicalizeDurationInText(s);
  if (opts.collapseWhitespace) s = collapseWhitespace(s, opts.preserveNewlines);
  else s = trimEdges(s);
  return s;
}

/**
 * Apply the same options to prediction and reference before scoring.
 * Use "transcription" for CER/WER and "fields" / "medication" for field match.
 */
export function normalizeForScoring(
  prediction: string,
  reference: string,
  options?: NormalizeMode | NormalizeOptions,
): { prediction: string; reference: string } {
  const opts = resolveOptions(options);
  return {
    prediction: normalizeText(prediction, opts),
    reference: normalizeText(reference, opts),
  };
}

/**
 * Normalize one typed field. Kinds that the core field scorer already has a
 * function for are routed to that drop-in so scores stay aligned.
 */
export function normalizeField(value: string, kind: FieldKind, overrides?: NormalizeOptions): string {
  switch (kind) {
    case "transcription":
      return normalizeText(value, { ...TRANSCRIPTION_OPTIONS, ...overrides });
    case "general":
      return normalizeText(value, { ...FIELD_OPTIONS, ...overrides });
    case "drug":
      return normalizeName(value);
    case "unit":
      return normalizeUnit(value);
    case "quantity":
      // Strength-like quantities use compact unit mapping; bare numbers use Number().
      return /[a-zA-Zµμ%]/.test(value) ? normalizeStrength(value) : normalizeNumber(value);
    case "frequency":
      return normalizeFrequency(value);
    case "duration":
      return normalizeDuration(value);
    case "medication_line":
      return normalizeText(value, { ...MEDICATION_OPTIONS, ...overrides });
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown field kind: ${_exhaustive}`);
    }
  }
}

