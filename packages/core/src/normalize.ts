// SPDX-License-Identifier: Apache-2.0
/**
 * Clinical value normalisers ("permitted normalization" for field exact-match).
 * Source values are never overwritten.
 *
 * Drop-in replacement for packages/core/src/normalize.ts (superset). The six
 * functions used by the field scorer keep the same signatures
 * `(v?: string | null): string` and core's canonical forms (frequency is
 * 1-0-1 style, strength is compact "625mg", units are lowercase with no
 * spaces). Additions: duration, drug-alias seed tables, CER/text helpers.
 *
 * Record NORMALIZATION_VERSION in run metadata. This is not a complete
 * clinical terminology service.
 */

export const NORMALIZATION_VERSION = 1;

// ---------------------------------------------------------------------------
// Frequency (drop-in)
// ---------------------------------------------------------------------------

const FREQ: Record<string, string> = {
  od: '1-0-0', qd: '1-0-0', 'once daily': '1-0-0', 'once a day': '1-0-0', daily: '1-0-0',
  'once-daily': '1-0-0', oncedaily: '1-0-0',
  bd: '1-0-1', bid: '1-0-1', 'twice daily': '1-0-1', 'twice a day': '1-0-1',
  'twice-daily': '1-0-1', twicedaily: '1-0-1',
  tds: '1-1-1', tid: '1-1-1', 'thrice daily': '1-1-1', 'three times a day': '1-1-1',
  'three times daily': '1-1-1', 'thrice-daily': '1-1-1',
  qid: '1-1-1-1', qds: '1-1-1-1', 'four times a day': '1-1-1-1', 'four times daily': '1-1-1-1',
  hs: '0-0-1', 'at night': '0-0-1', 'at bedtime': '0-0-1', nocte: '0-0-1', bedtime: '0-0-1',
  sos: 'sos', prn: 'sos', 'as needed': 'sos', 'if needed': 'sos', 'when needed': 'sos',
  'if required': 'sos', 'when required': 'sos', 'as required': 'sos',
  stat: 'stat',
};

const DASHED_SCHEDULE = /^\d(?:\/\d)?(?:-\d(?:\/\d)?){2,3}$/;

/**
 * Core table and dashed-pattern behaviour are preserved (BD → 1-0-1, T.D.S. → 1-1-1,
 * 1/2-0-1 stays 1/2-0-1, STAT stays stat). Additions: 1/0/1 and 1 0 1 → 1-0-1;
 * qds, nocte, bedtime, and a few phrase variants.
 */
export function normalizeFrequency(v?: string | null): string {
  if (!v) return '';
  const t = v.toLowerCase().replace(/[.\s]+/g, ' ').trim();
  const dashed = t.replace(/\s*[-–x×]\s*/g, '-');
  if (DASHED_SCHEDULE.test(dashed)) return dashed;
  const slashCompact = t.replace(/\s*\/\s*/g, '/');
  if (/^\d(?:\/\d){2,3}$/.test(slashCompact)) return slashCompact.replace(/\//g, '-');
  if (/^\d(?: \d){2,3}$/.test(t)) return t.replace(/ /g, '-');
  return FREQ[t] ?? FREQ[t.replace(/\s/g, '')] ?? t;
}

// ---------------------------------------------------------------------------
// Strength, unit, number, name, generic (drop-ins)
// ---------------------------------------------------------------------------

const STRENGTH_UNIT: Record<string, string> = {
  mgs: 'mg', milligram: 'mg', milligrams: 'mg',
  mcg: 'mcg', 'µg': 'mcg', ug: 'mcg',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml', mls: 'ml', cc: 'ml',
  iu: 'iu',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
};

/** Compact form ("625mg", "5mcg") so field scores do not shift. cc is a documented addition → ml. */
export function normalizeStrength(v?: string | null): string {
  if (!v) return '';
  const t = v.toLowerCase().replace(/\s+/g, '');
  return t.replace(/([a-zµ]+)/g, (u) => STRENGTH_UNIT[u] ?? u);
}

const UNIT_SYNONYM: Record<string, string> = {
  mgs: 'mg', milligram: 'mg', milligrams: 'mg',
  mcg: 'mcg', ug: 'mcg', 'µg': 'mcg',
  ml: 'ml', cc: 'ml', 'c.c': 'ml', 'c.c.': 'ml',
  iu: 'iu',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  'mg%': 'mg/dl', 'g%': 'g/dl', 'gm%': 'g/dl', 'gm/dl': 'g/dl',
  percent: '%', percentage: '%', pct: '%',
  'cells/cu.mm': 'cells/cumm', 'cells/cmm': 'cells/cumm', 'cells/mm3': 'cells/cumm',
  'cells/mm^3': 'cells/cumm', '/cumm': 'cells/cumm', '/cu.mm': 'cells/cumm', '/cmm': 'cells/cumm',
  'cells/ul': '/ul', '/ul': '/ul',
  'x10^3/ul': 'x10^3/ul', '10^3/ul': 'x10^3/ul', 'x10^6/ul': 'x10^6/ul', '10^6/ul': 'x10^6/ul',
};

/**
 * Core: lowercase, strip spaces, μ→µ, leading mgs/milligram(s)→mg.
 * Additions (output differences vs core): µg/ug→mcg, gm/gms→g, mg%→mg/dl,
 * g%→g/dl, cc→ml, cells/cu.mm→cells/cumm, /µl→/ul, percent→%.
 * Unchanged: g/dl, mg/dl, ml, iu, mmol/l, U→u. Does not convert mg/dl ↔ mmol/l.
 */
export function normalizeUnit(v?: string | null): string {
  if (!v) return '';
  let t = v.toLowerCase().replace(/\s+/g, '').replace(/μ/g, 'µ').replace(/^(mgs|milligrams?)$/, 'mg');
  t = t.replace(/µ/g, 'u');
  if (t === 'ug' || t.endsWith('/ug')) t = t.replace(/ug$/, 'mcg');
  return UNIT_SYNONYM[t] ?? t;
}

/**
 * Core behaviour preserved, including "1,5" → "15" (every comma is stripped)
 * and "12.50" → "12.5".
 */
export function normalizeNumber(v?: string | null): string {
  if (!v) return '';
  const t = v.replace(/,/g, '').replace(/−/g, '-').trim();
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? String(n) : t.toLowerCase();
}

/**
 * Core behaviour: lowercase, strip a leading Tab/Cap/Syp/Inj form, squeeze
 * punctuation to spaces. Does not expand PCM→paracetamol (use normalizeDrugName).
 */
export function normalizeName(v?: string | null): string {
  if (!v) return '';
  return v
    .toLowerCase()
    .replace(/^(tab|tablet|cap|capsule|syp|syrup|inj|injection)\.?\s+/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Lowercase and collapse whitespace. Duration synonyms are not applied here. */
export function normalizeGeneric(v?: string | null): string {
  return (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Duration (addition)
// ---------------------------------------------------------------------------

const DURATION_UNIT = 'days?|weeks?|months?|years?|mons?|mos?|wks?|wk|dys?|yr|mo|y|w|d';

function canonDurationUnit(raw: string): string {
  const u = raw.toLowerCase();
  if (u.startsWith('d')) return 'd';
  if (u.startsWith('w')) return 'wk';
  if (u.startsWith('mo')) return 'mo';
  if (u.startsWith('y')) return 'yr';
  return u;
}

export function normalizeDuration(v?: string | null): string {
  if (!v) return '';
  const replace = (_m: string, n: string, u: string) => `${n} ${canonDurationUnit(u)}`;
  let s = v.replace(new RegExp(`\\bx\\s*(\\d+(?:\\.\\d+)?)\\s*(${DURATION_UNIT})\\b`, 'gi'), replace);
  s = s.replace(new RegExp(`\\bfor\\s+(\\d+(?:\\.\\d+)?)\\s*-?\\s*(${DURATION_UNIT})\\b`, 'gi'), replace);
  s = s.replace(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*-?\\s*(${DURATION_UNIT})\\b`, 'gi'), replace);
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Numbers with digit grouping, route, reference range (moved from core clinical-values.ts)
// ---------------------------------------------------------------------------

// Western (1,000,000) and Indian (2,50,000 / 1,00,00,000) digit grouping, or no grouping.
/** Number with optional Western or Indian digit grouping (internal; exported for clinical-values). */
export const GROUPED_NUMBER = String.raw`[-+−]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d+)(?:\.\d+)?|[-+−]?\.\d+`;
const GROUPED_NUMBER_RE = new RegExp(`^(?:${GROUPED_NUMBER})$`);

/** Parse a bare number: '12.50', '1,000', '2,50,000', '−3', '.5'. Undefined if the string is not just a number. */
export function parseGroupedNumber(v?: string | null): number | undefined {
  if (v === null || v === undefined) return undefined;
  const t = v.trim();
  if (!GROUPED_NUMBER_RE.test(t)) return undefined;
  const n = Number(t.replace(/,/g, '').replace(/−/g, '-'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Route aliases. Oral vs IV etc. stay distinct: a wrong route is a critical medication error.
 * (Moved from core clinical-values.ts canonicalRoute, unchanged.)
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

export function normalizeRoute(v?: string | null): string {
  if (!v) return '';
  const t = v.toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  return ROUTE[t] ?? ROUTE[t.replace(/\s/g, '')] ?? t;
}

/** All raw spellings that canonicalise to the same route as `v` (for evidence search in OCR text). */
export function routeAliases(v?: string | null): string[] {
  const c = normalizeRoute(v);
  return c ? Object.keys(ROUTE).filter((k) => ROUTE[k] === c) : [];
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
  const num = (x?: string) => parseGroupedNumber(x) ?? NaN; // grouping-aware (1,50,000)
  const unitOf = (rest?: string) => { const u = normalizeStrength(normalizeUnit((rest ?? '').trim())); return u ? { unit: u } : {}; };
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

// ---------------------------------------------------------------------------
// Drug aliases (SEED LIST — not complete) and fuzzy helper
// ---------------------------------------------------------------------------

/** Seed list of high-confidence generic abbreviations. Not a formulary. */
export const DRUG_ALIASES: Readonly<Record<string, string>> = {
  pcm: 'paracetamol', paracetamol: 'paracetamol', acetaminophen: 'paracetamol',
  amox: 'amoxicillin', amoxy: 'amoxicillin', amoxi: 'amoxicillin',
  amoxicillin: 'amoxicillin', amoxycillin: 'amoxicillin',
  azith: 'azithromycin', azithro: 'azithromycin', azithromycin: 'azithromycin',
  cipro: 'ciprofloxacin', ciprofloxacin: 'ciprofloxacin',
  oflox: 'ofloxacin', ofloxacin: 'ofloxacin',
  norflox: 'norfloxacin', norfloxacin: 'norfloxacin',
  doxy: 'doxycycline', doxycycline: 'doxycycline',
  metro: 'metronidazole', metronidazole: 'metronidazole',
  tinida: 'tinidazole', tinidazole: 'tinidazole',
  flucon: 'fluconazole', fluconazole: 'fluconazole',
  acyclovir: 'acyclovir', aciclovir: 'acyclovir',
  inh: 'isoniazid', isoniazid: 'isoniazid',
  rif: 'rifampicin', rifamp: 'rifampicin', rifampicin: 'rifampicin', rifampin: 'rifampicin',
  pza: 'pyrazinamide', pyrazinamide: 'pyrazinamide',
  emb: 'ethambutol', ethambutol: 'ethambutol',
  hctz: 'hydrochlorothiazide', hydrochlorothiazide: 'hydrochlorothiazide',
  asa: 'aspirin', aspirin: 'aspirin',
  diclo: 'diclofenac', diclofenac: 'diclofenac',
  aceclo: 'aceclofenac', aceclofenac: 'aceclofenac',
  ibuprofen: 'ibuprofen',
  pantop: 'pantoprazole', pantoprazole: 'pantoprazole',
  omeprazole: 'omeprazole', rabeprazole: 'rabeprazole',
  domper: 'domperidone', domperidone: 'domperidone',
  ondan: 'ondansetron', ondansetron: 'ondansetron',
  cetirizine: 'cetirizine', metformin: 'metformin',
  amlo: 'amlodipine', amlodipine: 'amlodipine',
  telmi: 'telmisartan', telmisartan: 'telmisartan',
  losartan: 'losartan',
  atorva: 'atorvastatin', atorvastatin: 'atorvastatin',
  rosuvastatin: 'rosuvastatin',
  cefix: 'cefixime', cefixime: 'cefixime',
  ceftriaxone: 'ceftriaxone', cefotaxime: 'cefotaxime', amikacin: 'amikacin',
  salbutamol: 'salbutamol', albuterol: 'salbutamol',
  ors: 'oral rehydration salts',
};

/** Seed list of a few single-ingredient Indian brands. Off by default. */
export const BRAND_ALIASES: Readonly<Record<string, string>> = {
  dolo: 'paracetamol', crocin: 'paracetamol', calpol: 'paracetamol',
  omez: 'omeprazole', glycomet: 'metformin', glucophage: 'metformin',
  storvas: 'atorvastatin', ecosprin: 'aspirin', disprin: 'aspirin',
  azithral: 'azithromycin', azee: 'azithromycin',
  taxim: 'cefotaxime', monocef: 'ceftriaxone',
  stamlo: 'amlodipine', amlopres: 'amlodipine',
};

export const DRUG_ALIASES_COMPLETE = false;
export const BRAND_ALIASES_COMPLETE = false;

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[b.length] ?? 0;
}

const FORM_WORDS = 'tablets?|tabs?|tab|capsules?|caps?|cap|syrups?|syps?|syp|syr|injections?|injs?|inj|suspensions?|susps?|susp|drops?|dps?|creams?|ointments?|oints?|oint|lotions?|lot|sachets?|powders?|ampoules?|ampules?|amps?|amp|vials?|respules?|rotacaps?|inhalers?|gels?|sprays?|dts?|dt|mdt';

function stripDosageForms(text: string): { text: string; form?: string } {
  let current = text.trim();
  let form: string | undefined;
  const patterns = [
    new RegExp(`^(?:${FORM_WORDS})\\.?(?=\\s+|$)`, 'i'),
    /^(?:[tc]\.(?=\s+|$)|[tc](?=\s+[A-Za-z]))/i,
    new RegExp(`^(?:tablet|capsule|injection|syrup|tab|cap|syp|syr|inj|susp)\\.?(?=[A-Za-z])`, 'i'),
    new RegExp(`(?:^|\\s+)(?:${FORM_WORDS})\\.?$`, 'i'),
    /(?:^|\s+)(?:[tc]\.)$/i,
  ];
  for (let n = 0; n < 4; n++) {
    let hit = false;
    for (const re of patterns) {
      const m = current.match(re);
      if (!m) continue;
      form = m[0].trim().replace(/\.$/, '');
      current = (m.index === 0 ? current.slice(m[0].length) : current.slice(0, m.index)).trim();
      hit = true;
      break;
    }
    if (!hit) break;
  }
  return { text: current, form };
}

const STRENGTH_RE = /(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)\s*(mcg|μg|µg|ug|mg|gms?|gm|g|mL|ml|IU|iu|U|u|%)\b(?:\s*\/\s*(\d+(?:\.\d+)?)\s*(mL|ml|L|l)\b)?/i;

function unitCanon(unit: string): string {
  const u = unit.toLowerCase().replace(/[μµ]/g, 'u');
  if (u === 'ug' || u === 'mcg') return 'mcg';
  if (u === 'gm' || u === 'gms') return 'g';
  if (u === 'ml') return 'ml';
  if (u === 'l') return 'l';
  if (u === 'iu') return 'iu';
  if (u === 'u') return 'u';
  return u === '%' ? '%' : (u === 'mg' || u === 'g' ? u : unit);
}

export interface NormalizedDrug {
  canonical: string;
  name: string;
  form?: string;
  strength?: string;
  aliasApplied?: string;
}

export function normalizeDrugName(name: string, options: { mapBrands?: boolean } = {}): NormalizedDrug {
  const stripped = stripDosageForms(name);
  let rest = stripped.text;
  let strength: string | undefined;
  rest = rest.replace(STRENGTH_RE, (_f, qty: string, unit: string, denomQty?: string, denomUnit?: string) => {
    const u = unitCanon(unit);
    const q = qty.replace(/\s+/g, '');
    strength = denomQty && denomUnit ? `${q} ${u}/${denomQty.replace(/\s+/g, '')} ${unitCanon(denomUnit)}` : u === '%' ? `${q}%` : `${q} ${u}`;
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  if (!strength) {
    const bare = rest.match(/\s+(\d+(?:\.\d+)?)\s*$/);
    if (bare && bare.index != null) {
      strength = bare[1];
      rest = rest.slice(0, bare.index).trim();
    }
  }
  let aliasApplied: string | undefined;
  rest = rest.replace(/\bvit(?:amin)?\.?\s*d\s*3\b/gi, 'vitamin d3')
    .replace(/\bvit(?:amin)?\.?\s*d\b/gi, 'vitamin d')
    .replace(/\bvit(?:amin)?\.?\s*b\s*12\b/gi, 'vitamin b12')
    .replace(/\bfolic\s+acid\b/gi, 'folic acid');
  rest = rest.replace(/\b[A-Za-z][A-Za-z0-9-]*\b/g, (tok) => {
    const key = tok.toLowerCase();
    const generic = DRUG_ALIASES[key];
    if (generic) {
      if (generic !== key) aliasApplied = `${key}→${generic}`;
      return generic;
    }
    if (options.mapBrands === true) {
      const brand = BRAND_ALIASES[key];
      if (brand) {
        aliasApplied = `${key}→${brand}`;
        return brand;
      }
    }
    return tok;
  });
  const nameOnly = rest.replace(/\s+/g, ' ').trim().toLowerCase();
  return { canonical: [nameOnly, strength].filter(Boolean).join(' '), name: nameOnly, form: stripped.form, strength, aliasApplied };
}

export interface FuzzyDrugMatch { query: string; match: string; alias: string; distance: number }

/** Optional helper. Never used by normalizeName / the field-scorer drop-ins. */
export function fuzzyMatchDrug(query: string, options: { maxDistance?: number; mapBrands?: boolean; candidates?: Iterable<string> } = {}): FuzzyDrugMatch | null {
  const prepared = normalizeDrugName(query, { mapBrands: options.mapBrands }).name;
  if (!prepared) return null;
  const needle = prepared.toLowerCase();
  const max = options.maxDistance ?? (needle.length < 4 ? 0 : needle.length < 7 ? 1 : 2);
  let best: FuzzyDrugMatch | null = null;
  const entries: { alias: string; match: string }[] = [];
  if (options.candidates) {
    for (const c of options.candidates) entries.push({ alias: c, match: c });
  } else {
    for (const [k, v] of Object.entries(DRUG_ALIASES)) {
      entries.push({ alias: k, match: v }, { alias: v, match: v });
    }
    if (options.mapBrands === true) {
      for (const [k, v] of Object.entries(BRAND_ALIASES)) entries.push({ alias: k, match: v });
    }
  }
  for (const { alias, match } of entries) {
    const d = Math.min(editDistance(needle, alias.toLowerCase()), editDistance(needle, match.toLowerCase()));
    if (d > max) continue;
    if (!best || d < best.distance) best = { query: prepared, match, alias, distance: d };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Text / CER helpers (addition). Default "transcription" does NFKC only-ish.
// ---------------------------------------------------------------------------

export type NormalizeMode = 'transcription' | 'fields' | 'medication';

export interface NormalizeOptions {
  unicodeNfkc?: boolean;
  collapseWhitespace?: boolean;
  preserveNewlines?: boolean;
  caseFold?: boolean;
  punctuationVariants?: boolean;
  numbers?: boolean;
  units?: boolean;
  drugs?: boolean;
  mapBrands?: boolean;
  frequency?: boolean;
  duration?: boolean;
}

export const TRANSCRIPTION_OPTIONS: Required<NormalizeOptions> = {
  unicodeNfkc: true, collapseWhitespace: false, preserveNewlines: true, caseFold: false,
  punctuationVariants: false, numbers: false, units: false, drugs: false, mapBrands: false,
  frequency: false, duration: false,
};

export const FIELD_OPTIONS: Required<NormalizeOptions> = {
  unicodeNfkc: true, collapseWhitespace: true, preserveNewlines: false, caseFold: true,
  punctuationVariants: true, numbers: true, units: true, drugs: false, mapBrands: false,
  frequency: false, duration: false,
};

export const MEDICATION_OPTIONS: Required<NormalizeOptions> = {
  ...FIELD_OPTIONS, drugs: true, mapBrands: false, frequency: true, duration: true,
};

const SUPER: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-',
};

function applyUnicode(text: string): string {
  let s = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/gu, (run) => `^${[...run].map((c) => SUPER[c] ?? c).join('')}`);
  s = s.normalize('NFKC').replace(/[\u00AD\u200B\uFEFF]/g, '').replace(/\r\n?|\u2028|\u2029/g, '\n');
  return s;
}

/** Conservative text numbers: strip 1,000 / 1,00,000, leading .5 → 0.5. Does not turn 1,5 into 15. */
function normalizeNumbersText(text: string): string {
  let s = text.replace(/\d{1,3}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{2})+|\d{1,3}(?:,\d{3})+/g, (m) => m.replace(/,/g, ''));
  return s.replace(/(^|[^\d])\.(\d)/g, (_m, p: string, d: string) => `${p}0.${d}`);
}

export function normalizeText(input: string, options?: NormalizeMode | NormalizeOptions): string {
  if (input == null) return '';
  const opts: Required<NormalizeOptions> = typeof options === 'string' || options == null
    ? (options === 'transcription' ? { ...TRANSCRIPTION_OPTIONS } : options === 'medication' ? { ...MEDICATION_OPTIONS } : { ...FIELD_OPTIONS })
    : { ...FIELD_OPTIONS, ...options };
  let s = String(input);
  if (opts.unicodeNfkc || opts.units) s = applyUnicode(s);
  if (opts.punctuationVariants) {
    s = s.replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .replace(/\u2026/g, '...');
  }
  if (opts.caseFold) s = s.toLowerCase();
  if (opts.numbers) s = normalizeNumbersText(s);
  if (opts.drugs) {
    s = s.replace(new RegExp(`(?:(?<=^)|(?<=\\s))(?:${FORM_WORDS})\\.?(?=\\s+|$)`, 'gi'), ' ');
    s = s.replace(/(?:(?<=^)|(?<=\s))[tc]\.(?=\s+|$)/gi, ' ');
    s = s.replace(/\b[A-Za-z][A-Za-z0-9-]*\b/g, (tok) => {
      const key = tok.toLowerCase();
      return DRUG_ALIASES[key] ?? (opts.mapBrands ? (BRAND_ALIASES[key] ?? tok) : tok);
    });
  }
  if (opts.frequency) {
    const trimmed = s.trim();
    if (!/\s/.test(trimmed) || /^(?:od|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat|once daily|twice daily|thrice daily)$/i.test(trimmed)) {
      s = normalizeFrequency(s);
    } else {
      s = s.replace(/\b(once daily|once a day|twice daily|twice a day|thrice daily|three times a day|three times daily|four times a day|four times daily|as needed|at bedtime|at night)\b/gi, (m) => normalizeFrequency(m) || m);
      s = s.replace(/\b(qds|qid|tds|tid|bid|bd|od|qd|hs|sos|prn|stat)\b/gi, (m) => normalizeFrequency(m) || m);
    }
  }
  if (opts.duration) s = normalizeDuration(s) || s;
  if (opts.collapseWhitespace) {
    s = opts.preserveNewlines
      ? s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '')
      : s.replace(/\s+/g, ' ').trim();
  } else {
    s = s.replace(/^\s+|\s+$/g, '');
  }
  return s;
}

export function normalizeForScoring(
  prediction: string,
  reference: string,
  options?: NormalizeMode | NormalizeOptions,
): { prediction: string; reference: string } {
  return { prediction: normalizeText(prediction, options), reference: normalizeText(reference, options) };
}
