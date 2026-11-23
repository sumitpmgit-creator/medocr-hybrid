// SPDX-License-Identifier: Apache-2.0
/**
 * Versioned, configurable normalization used on both prediction and reference
 * before scoring (CER/WER vs field exact-match).
 *
 * Spec (SoalTech handoff §7): "Use explicit, versioned rules for whitespace,
 * allowable units and brand/generic mapping. Never normalize away clinically
 * significant differences such as 0-0-1 vs 1-0-1, 5 mg vs 50 mg, or
 * substitution of one active ingredient for another."
 */

/** Bump when a default rule changes in a way that can alter scores. */
export const NORMALIZATION_VERSION = 1;

export type NormalizeMode = "transcription" | "fields" | "medication";

/**
 * Known field kinds for {@link import("./index.js").normalizeField}.
 * Use these when the scorer already knows what the value represents, so
 * prescription-only rules are not applied to lab text (e.g. OD as optical
 * density, or a leading "T." in a test name).
 */
export type FieldKind =
  | "transcription"
  | "general"
  | "drug"
  | "unit"
  | "quantity"
  | "frequency"
  | "duration"
  | "medication_line";

export interface NormalizeOptions {
  /** Unicode NFKC. Superscript digits are rewritten as ^n first so 10³ does not become 103. Default true. */
  unicodeNfkc?: boolean;
  /** Collapse internal whitespace runs. Default true for fields, false for transcription. */
  collapseWhitespace?: boolean;
  /** Keep newline boundaries when collapsing whitespace. Default true for transcription. */
  preserveNewlines?: boolean;
  /** Lowercase. Default true for fields, false for transcription. */
  caseFold?: boolean;
  /** Unify typographic quotes, dashes and ellipsis. Default true for fields. */
  punctuationVariants?: boolean;
  /** Thousands/lakh grouping and leading decimals. Default true for fields. */
  numbers?: boolean;
  /** Canonical unit spellings and number/unit spacing. Default true for fields. */
  units?: boolean;
  /** Dosage-form stripping, strength spacing, abbreviation aliases. Default true for medication. */
  drugs?: boolean;
  /**
   * Apply the seed brand→generic table. Default false: brand-to-generic is
   * inference, not a value-preserving spelling variant, and the spec treats
   * unsupported substitutions as a clinical error.
   */
  mapBrands?: boolean;
  /** Frequency shorthand and 1-0-1 pattern canonicalization. Default true for medication. */
  frequency?: boolean;
  /** Duration forms such as "x5d" and "1 wk". Default true for medication. */
  duration?: boolean;
}

export const TRANSCRIPTION_OPTIONS: Required<NormalizeOptions> = {
  unicodeNfkc: true,
  collapseWhitespace: false,
  preserveNewlines: true,
  caseFold: false,
  punctuationVariants: false,
  numbers: false,
  units: false,
  drugs: false,
  mapBrands: false,
  frequency: false,
  duration: false,
};

/** Safe on both lab and prescription field values (no drug/frequency/duration). */
export const FIELD_OPTIONS: Required<NormalizeOptions> = {
  unicodeNfkc: true,
  collapseWhitespace: true,
  preserveNewlines: false,
  caseFold: true,
  punctuationVariants: true,
  numbers: true,
  units: true,
  drugs: false,
  mapBrands: false,
  frequency: false,
  duration: false,
};

/** Field rules plus drug, frequency and duration. For medication fields only. */
export const MEDICATION_OPTIONS: Required<NormalizeOptions> = {
  ...FIELD_OPTIONS,
  drugs: true,
  mapBrands: false,
  frequency: true,
  duration: true,
};

export const PRESETS: Record<NormalizeMode, Required<NormalizeOptions>> = {
  transcription: TRANSCRIPTION_OPTIONS,
  fields: FIELD_OPTIONS,
  medication: MEDICATION_OPTIONS,
};

export function resolveOptions(
  options?: NormalizeMode | NormalizeOptions,
): Required<NormalizeOptions> {
  if (options == null) return { ...FIELD_OPTIONS };
  if (typeof options === "string") {
    const preset = PRESETS[options];
    if (!preset) {
      throw new Error(`Unknown normalization mode: ${options}`);
    }
    return { ...preset };
  }
  return { ...FIELD_OPTIONS, ...options };
}

/**
 * Explicit, versioned rule summary for run metadata and reviewers.
 * This is not a complete clinical terminology service.
 */
export const NORMALIZATION_RULES = {
  version: NORMALIZATION_VERSION,
  presets: ["transcription", "fields", "medication"] as const,
  general: [
    "Unicode NFKC after rewriting superscript digits to ^n (NFKC alone would flatten 10³ to 103)",
    "Strip soft hyphens, zero-width spaces and BOM; do not strip ZWJ/ZWNJ (needed for Indic conjuncts)",
    "Normalize CR/CRLF to LF",
    "Optional collapse of whitespace; transcription preserves newlines and internal spacing by default",
    "Optional case fold",
    "Optional typographic punctuation unification (quotes, dash variants, ellipsis)",
  ],
  numbers: [
    "Strip Western thousands (1,000) and Indian lakh/crore grouping (1,00,000)",
    "Leading decimal .5 → 0.5",
    "Do not treat 1,5 as 1.5 (comma-decimal is ambiguous here)",
    "Never change magnitude: 5 and 50 stay distinct",
  ],
  units: [
    "Canonical forms: mg, mcg, g, kg, mL, L, IU, U, mmol/L, umol/L, mg/dL, g/dL, %, cells/cumm, /uL, x10^3/uL, x10^6/uL and close variants",
    "Insert a space between a number and a letter-unit (500mg → 500 mg); no space before %",
    "mg% → mg/dL and g% → g/dL (synonymous in older Indian lab reports)",
    "cc → mL (1 cc = 1 mL)",
    "Do not convert mg/dL ↔ mmol/L or other factor-dependent pairs",
    "Do not convert cells/cumm ↔ /uL or x10^9/L ↔ x10^3/uL (would require scaling the number or was listed as a separate form)",
    "Do not convert U ↔ IU or U/L ↔ IU/L",
  ],
  drugs: [
    "SEED LIST only: a small abbreviation table, not a complete formulary",
    "Strip dosage-form prefixes/suffixes (Tab., Cap., Syp., Inj., T., C. and similar) as separate tokens",
    "Separate and normalize trailing/embedded strengths",
    "PCM → paracetamol, Amox → amoxicillin, and other high-confidence abbreviations",
    "acetaminophen → paracetamol and amoxycillin → amoxicillin (same ingredient / spelling variant)",
    "Brand→generic mapping is a seed table and is OFF by default (mapBrands)",
    "Combination products and ambiguous short names are omitted on purpose",
    "Optional fuzzy helper (Levenshtein) is never applied inside normalizeText",
  ],
  frequency: [
    "Canonical forms match packages/core/src/normalize.ts so field scores do not shift",
    "OD / QD / once daily / daily → 1-0-0",
    "BD / BID / twice daily → 1-0-1",
    "TDS / TID / thrice daily / three times a day → 1-1-1",
    "QID / QDS / four times a day → 1-1-1-1",
    "HS / at night / at bedtime / nocte → 0-0-1",
    "SOS / PRN / as needed → sos; STAT stays stat",
    "1-0-1, 1-1-1-1, 1/2-0-1 and other dashed patterns are preserved",
    "Additions vs core: 1/0/1 and 1 0 1 → 1-0-1; qds, nocte, bedtime, a few phrase variants",
    "Distinct patterns stay distinct: 0-0-1, 1-0-0, 1-0-1 and 1-1-1 are never equated",
    "SoalTech §7 cautions that OD does not encode time of day; the 1-0-0 mapping is inherited from core",
  ],
  duration: [
    "5 days, 5d, x5d, for 5 days → 5 d",
    "1 wk, 1 week, x1w → 1 wk",
    "Canonical duration units: d, wk, mo, yr",
    "Do not convert 1 wk → 7 d or 1 mo → 30 d",
  ],
  never: [
    "Never equate 0-0-1 with 1-0-1 or 1-0-0 (distinct tablet-count patterns stay distinct)",
    "Never equate 5 mg with 50 mg",
    "Never convert mg/dL to mmol/L (or the reverse)",
    "Never substitute a different active ingredient",
    "Never apply fuzzy drug matching inside normalizeName or normalizeText",
  ],
} as const;
