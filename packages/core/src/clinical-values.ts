// SPDX-License-Identifier: Apache-2.0
/**
 * Typed parsing and comparison of clinical values for field scoring (Benchmark B).
 * Alias tables live in normalize.ts (units, frequency, names); this file only parses structure
 * (numbers, quantities, reference ranges) and decides equality. Spec §7 rule: never normalise away
 * clinically significant differences (5 mg vs 50 mg, 0-0-1 vs 1-0-1, mg vs mcg).
 */
import { normalizeDrugName, normalizeDuration, normalizeFrequency, normalizeGeneric, normalizeName, normalizeNumber, normalizeStrength, normalizeUnit, NORMALIZATION_VERSION } from './normalize.js';

/**
 * Bump when any comparison rule below changes (spec: "explicit, versioned rules").
 * Scores also carry normalize.ts's NORMALIZATION_VERSION (alias tables); see scoringRulesId().
 */
export const NORMALIZATION_RULES_VERSION = '1.1.0';

/** Identifies the full rule set a score was computed under: comparison rules + alias tables. */
export function scoringRulesId(): string {
  return `compare@${NORMALIZATION_RULES_VERSION}+normalize@${NORMALIZATION_VERSION}`;
}

/**
 * Drug identity for comparison: normalize.ts's generic alias table (PCM → paracetamol), brand
 * mapping OFF (a brand→generic substitution must not count as correct), forms and strength stripped.
 */
export function canonicalDrugName(v?: string | null): string {
  if (!v) return '';
  return normalizeName(normalizeDrugName(v, { mapBrands: false }).name || v);
}

export interface NumericTolerance {
  /** Absolute tolerance (default 0) */
  abs?: number;
  /** Relative tolerance (default 1e-9: float noise only, so 4.50 = 4.5 but 4.5 ≠ 4.6) */
  rel?: number;
}

// Western (1,000,000) and Indian (2,50,000 / 1,00,00,000) digit grouping, or no grouping.
const NUM = String.raw`[-+−]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d+)(?:\.\d+)?|[-+−]?\.\d+`;
const NUM_RE = new RegExp(`^(?:${NUM})$`);

/** Parse a bare number: '12.50', '1,000', '2,50,000', '−3', '.5'. Undefined if the string is not just a number. */
export function parseNumber(v?: string | null): number | undefined {
  if (v === null || v === undefined) return undefined;
  const t = v.trim();
  if (!NUM_RE.test(t)) return undefined;
  const n = Number(t.replace(/,/g, '').replace(/−/g, '-'));
  return Number.isFinite(n) ? n : undefined;
}

export function numbersEqual(a: number, b: number, tol: NumericTolerance = {}): boolean {
  const abs = tol.abs ?? 0, rel = tol.rel ?? 1e-9;
  return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}

/** Canonical unit spelling via normalize.ts aliases: 'MG', 'milligrams' → 'mg'; 'µg', 'ug' → 'mcg'; 'mL' → 'ml'. */
export function canonicalUnit(v?: string | null): string {
  if (!v) return '';
  return normalizeStrength(normalizeUnit(v));
}

export interface Quantity { value: number; unit: string; raw: string }

/** '500 mg', '500MG', '0.5 g', '1,000 IU', '5 mg/5 ml'. Undefined when there is no leading number. */
export function parseQuantity(v?: string | null): Quantity | undefined {
  if (!v) return undefined;
  const m = new RegExp(`^\\s*(${NUM})\\s*(.*?)\\s*$`).exec(v);
  if (!m) return undefined;
  const value = parseNumber(m[1]);
  if (value === undefined) return undefined;
  return { value, unit: canonicalUnit(m[2] ?? ''), raw: v };
}

export interface ReferenceRange {
  low?: number;
  high?: number;
  lowInclusive: boolean;
  highInclusive: boolean;
  unit?: string;
}

/**
 * Parse '4.5-11.0', '4.5 – 11.0 g/dL', '4.5 to 11', '<5', '< 5.0', '<=5', '≤5', '>40', '≥ 40',
 * 'up to 5', 'less than 5', 'more than 40', '-2 to 2'. Undefined if unparseable.
 */
export function parseReferenceRange(v?: string | null): ReferenceRange | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase().replace(/−/g, '-');
  const n = String.raw`(-?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d+)(?:\.\d+)?|-?\.\d+)`;
  const num = (x?: string) => parseNumber(x) ?? NaN; // grouping-aware (1,50,000)
  const unitOf = (rest?: string) => { const u = canonicalUnit((rest ?? '').trim()); return u ? { unit: u } : {}; };
  let m = new RegExp(`^${n}\\s*(?:-|–|—|to)\\s*${n}\\s*(.*)$`).exec(t);
  if (m) {
    const low = num(m[1]), high = num(m[2]);
    if (low > high) return undefined;
    return { low, high, lowInclusive: true, highInclusive: true, ...unitOf(m[3]) };
  }
  m = new RegExp(`^(<=|≤|=<|<|less than|below|up\\s*to|upto|>=|≥|=>|>|more than|greater than|above)\\s*${n}\\s*(.*)$`).exec(t);
  if (m) {
    const op = m[1]!.replace(/\s+/g, ' '), x = num(m[2]);
    if (['<', 'less than', 'below'].includes(op)) return { high: x, lowInclusive: true, highInclusive: false, ...unitOf(m[3]) };
    if (['<=', '≤', '=<'].includes(op) || op.startsWith('up')) return { high: x, lowInclusive: true, highInclusive: true, ...unitOf(m[3]) };
    if (['>', 'more than', 'greater than', 'above'].includes(op)) return { low: x, lowInclusive: false, highInclusive: true, ...unitOf(m[3]) };
    return { low: x, lowInclusive: true, highInclusive: true, ...unitOf(m[3]) };
  }
  return undefined;
}

export function rangesEqual(a: ReferenceRange, b: ReferenceRange, tol?: NumericTolerance): boolean {
  const eq = (x?: number, y?: number) => (x === undefined || y === undefined ? x === y : numbersEqual(x, y, tol));
  const unitsOk = !a.unit || !b.unit || a.unit === b.unit; // a range written without its unit is not an error
  return eq(a.low, b.low) && eq(a.high, b.high)
    && (a.low === undefined || a.lowInclusive === b.lowInclusive)
    && (a.high === undefined || a.highInclusive === b.highInclusive)
    && unitsOk;
}

export type ValueMatch = 'exact' | 'normalized' | 'mismatch';

export type FieldValueKind = 'name' | 'drug' | 'quantity' | 'frequency' | 'duration' | 'route' | 'number' | 'unit' | 'range' | 'text';

/**
 * Route aliases. Interim, scorer-local table (normalize.ts has no route normaliser yet; flagged to
 * Rachel). Oral vs IV etc. stay distinct: a wrong route is a critical medication error.
 */
const ROUTE: Record<string, string> = {
  oral: 'oral', po: 'oral', 'per oral': 'oral', 'by mouth': 'oral', orally: 'oral', 'per os': 'oral',
  iv: 'iv', intravenous: 'iv', intravenously: 'iv',
  im: 'im', intramuscular: 'im', intramuscularly: 'im',
  sc: 'sc', sq: 'sc', subcut: 'sc', subcutaneous: 'sc', subcutaneously: 'sc', 'sub cut': 'sc',
  sl: 'sublingual', sublingual: 'sublingual',
  topical: 'topical', 'local application': 'topical', 'for external use': 'topical', 'external use': 'topical', 'l a': 'topical',
  inhaled: 'inhaled', inhalation: 'inhaled', inh: 'inhaled', 'by inhalation': 'inhaled', nebulised: 'inhaled', nebulized: 'inhaled', neb: 'inhaled',
  pr: 'rectal', rectal: 'rectal', 'per rectum': 'rectal',
  nasal: 'nasal', intranasal: 'nasal',
  ophthalmic: 'ophthalmic', 'eye drops': 'ophthalmic', eye: 'ophthalmic',
  otic: 'otic', 'ear drops': 'otic', ear: 'otic',
  transdermal: 'transdermal', td: 'transdermal',
};

export function canonicalRoute(v?: string | null): string {
  if (!v) return '';
  const t = v.toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  return ROUTE[t] ?? ROUTE[t.replace(/\s/g, '')] ?? t;
}

/** All raw spellings that canonicalise to the same route as `v` (for evidence search in OCR text). */
export function routeAliases(v?: string | null): string[] {
  const c = canonicalRoute(v);
  return c ? Object.keys(ROUTE).filter((k) => ROUTE[k] === c) : [];
}

export interface CompareOptions { tolerance?: NumericTolerance }

/** Compare two raw values of a given kind. 'exact' = identical after trimming; 'normalized' = equal under the permitted rules. */
export function compareValues(kind: FieldValueKind, expected: string, actual: string, o: CompareOptions = {}): ValueMatch {
  if (expected.trim() === actual.trim()) return 'exact';
  const tol = o.tolerance;
  switch (kind) {
    case 'name': return normalizeName(expected) === normalizeName(actual) ? 'normalized' : 'mismatch';
    case 'drug': return canonicalDrugName(expected) === canonicalDrugName(actual) ? 'normalized' : 'mismatch';
    case 'route': return canonicalRoute(expected) === canonicalRoute(actual) ? 'normalized' : 'mismatch';
    case 'duration': return normalizeGeneric(normalizeDuration(expected)) === normalizeGeneric(normalizeDuration(actual)) ? 'normalized' : 'mismatch';
    case 'frequency': return normalizeFrequency(expected) === normalizeFrequency(actual) ? 'normalized' : 'mismatch';
    case 'unit': return canonicalUnit(expected) === canonicalUnit(actual) ? 'normalized' : 'mismatch';
    case 'number': {
      const a = parseNumber(expected), b = parseNumber(actual);
      if (a !== undefined && b !== undefined) return numbersEqual(a, b, tol) ? 'normalized' : 'mismatch';
      return normalizeNumber(expected) === normalizeNumber(actual) ? 'normalized' : 'mismatch';
    }
    case 'quantity': {
      const a = parseQuantity(expected), b = parseQuantity(actual);
      if (a && b) return numbersEqual(a.value, b.value, tol) && a.unit === b.unit ? 'normalized' : 'mismatch';
      return normalizeStrength(expected) === normalizeStrength(actual) ? 'normalized' : 'mismatch';
    }
    case 'range': {
      const a = parseReferenceRange(expected), b = parseReferenceRange(actual);
      if (a && b) return rangesEqual(a, b, tol) ? 'normalized' : 'mismatch';
      const s = (v: string) => v.replace(/\s+/g, '').replace(/[–—]/g, '-').toLowerCase();
      return s(expected) === s(actual) ? 'normalized' : 'mismatch';
    }
    default: return normalizeGeneric(expected) === normalizeGeneric(actual) ? 'normalized' : 'mismatch';
  }
}

export type NumericErrorKind = 'decimal' | 'magnitude' | 'unit' | 'value';

/**
 * Classify a numeric disagreement between two values (quantities or bare numbers):
 * - 'unit': same number, different unit (500 mg vs 500 mcg)
 * - 'decimal': same digits, misplaced decimal point (12.5 vs 1.25)
 * - 'magnitude': off by a power of ten otherwise (5 vs 50, 0.5 vs 5)
 * - 'value': any other numeric difference
 * Undefined when either side has no number or they are equal.
 */
export function classifyNumericError(expected: string, actual: string, tol?: NumericTolerance): NumericErrorKind | undefined {
  const a = parseQuantity(expected), b = parseQuantity(actual);
  if (!a || !b) return undefined;
  if (numbersEqual(a.value, b.value, tol)) return a.unit !== b.unit ? 'unit' : undefined;
  const digits = (q: Quantity) => (/^[^\d]*([\d.,]+)/.exec(q.raw)?.[1] ?? '').replace(/[.,]/g, '').replace(/^0+/, '').replace(/0+$/, '');
  if (a.value !== 0 && b.value !== 0) {
    const ratio = Math.log10(Math.abs(b.value / a.value));
    if (Math.abs(ratio - Math.round(ratio)) < 1e-9 && Math.round(ratio) !== 0) {
      return digits(a) === digits(b) && /[.]/.test(a.raw + b.raw) ? 'decimal' : 'magnitude';
    }
  }
  return 'value';
}
