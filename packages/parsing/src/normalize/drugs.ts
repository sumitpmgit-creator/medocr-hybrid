// SPDX-License-Identifier: Apache-2.0
import { defaultMaxDistance, editDistance } from "./edit-distance.js";

/**
 * SEED LIST of high-confidence generic abbreviations and spelling variants
 * seen on Indian prescriptions. This is not a complete formulary, not
 * clinically authoritative, and not a brand directory.
 *
 * Keys are lowercase, already-NFKC lookup tokens. Values are lowercase INN
 * (or the usual Indian generic name). Ambiguous short names and most
 * combination products are omitted on purpose.
 *
 * Completeness: false. Do not claim this table covers a clinic's formulary.
 */
export const DRUG_ALIASES: Readonly<Record<string, string>> = {
  pcm: "paracetamol",
  paracetamol: "paracetamol",
  acetaminophen: "paracetamol",
  amox: "amoxicillin",
  amoxy: "amoxicillin",
  amoxi: "amoxicillin",
  amoxicillin: "amoxicillin",
  amoxycillin: "amoxicillin",
  azith: "azithromycin",
  azithro: "azithromycin",
  azithromycin: "azithromycin",
  cipro: "ciprofloxacin",
  ciprofloxacin: "ciprofloxacin",
  oflox: "ofloxacin",
  ofloxacin: "ofloxacin",
  norflox: "norfloxacin",
  norfloxacin: "norfloxacin",
  doxy: "doxycycline",
  doxycycline: "doxycycline",
  metro: "metronidazole",
  metronidazole: "metronidazole",
  tinida: "tinidazole",
  tinidazole: "tinidazole",
  flucon: "fluconazole",
  fluconazole: "fluconazole",
  acyclovir: "acyclovir",
  aciclovir: "acyclovir",
  inh: "isoniazid",
  isoniazid: "isoniazid",
  rif: "rifampicin",
  rifamp: "rifampicin",
  rifampicin: "rifampicin",
  rifampin: "rifampicin",
  pza: "pyrazinamide",
  pyrazinamide: "pyrazinamide",
  emb: "ethambutol",
  ethambutol: "ethambutol",
  hctz: "hydrochlorothiazide",
  hydrochlorothiazide: "hydrochlorothiazide",
  asa: "aspirin",
  aspirin: "aspirin",
  diclo: "diclofenac",
  diclofenac: "diclofenac",
  aceclo: "aceclofenac",
  aceclofenac: "aceclofenac",
  ibuprofen: "ibuprofen",
  pantop: "pantoprazole",
  pantoprazole: "pantoprazole",
  omeprazole: "omeprazole",
  rabeprazole: "rabeprazole",
  domper: "domperidone",
  domperidone: "domperidone",
  ondan: "ondansetron",
  ondansetron: "ondansetron",
  cetirizine: "cetirizine",
  metformin: "metformin",
  amlo: "amlodipine",
  amlodipine: "amlodipine",
  telmi: "telmisartan",
  telmisartan: "telmisartan",
  losartan: "losartan",
  atorva: "atorvastatin",
  atorvastatin: "atorvastatin",
  rosuvastatin: "rosuvastatin",
  cefix: "cefixime",
  cefixime: "cefixime",
  ceftriaxone: "ceftriaxone",
  cefotaxime: "cefotaxime",
  amikacin: "amikacin",
  salbutamol: "salbutamol",
  albuterol: "salbutamol",
  ors: "oral rehydration salts",
};

/**
 * SEED LIST of a few common single-ingredient Indian brands → generic.
 * Off by default (mapBrands). Not complete. Combination products omitted.
 */
export const BRAND_ALIASES: Readonly<Record<string, string>> = {
  dolo: "paracetamol",
  crocin: "paracetamol",
  calpol: "paracetamol",
  omez: "omeprazole",
  glycomet: "metformin",
  glucophage: "metformin",
  storvas: "atorvastatin",
  ecosprin: "aspirin",
  disprin: "aspirin",
  azithral: "azithromycin",
  azee: "azithromycin",
  taxim: "cefotaxime",
  monocef: "ceftriaxone",
  stamlo: "amlodipine",
  amlopres: "amlodipine",
};

export const DRUG_ALIASES_COMPLETE = false;
export const BRAND_ALIASES_COMPLETE = false;

const MULTI_WORD: readonly [RegExp, string][] = [
  [/\bvit(?:amin)?\.?\s*d\s*3\b/gi, "vitamin d3"],
  [/\bvit(?:amin)?\.?\s*d\b/gi, "vitamin d"],
  [/\bvit(?:amin)?\.?\s*b\s*12\b/gi, "vitamin b12"],
  [/\bfolic\s+acid\b/gi, "folic acid"],
  [/\boral\s+rehydration\s+salts\b/gi, "oral rehydration salts"],
];

/** Multi-letter dosage forms, plus DT / MD as dispersible / mouth-dissolving. */
const FORM_WORDS =
  "tablets?|tabs?|tab|capsules?|caps?|cap|syrups?|syps?|syp|syr|injections?|injs?|inj|suspensions?|susps?|susp|drops?|dps?|creams?|ointments?|oints?|oint|lotions?|lot|sachets?|powders?|ampoules?|ampules?|amps?|amp|vials?|respules?|rotacaps?|inhalers?|gels?|sprays?|dts?|dt|mdt";

const LEADING_FORM = new RegExp(`^(?:${FORM_WORDS})\\.?(?=\\s+|$)`, "i");
const TRAILING_FORM = new RegExp(`(?:^|\\s+)(?:${FORM_WORDS})\\.?$`, "i");
/** Glued prefix, 3+ letter forms only: TabPCM, InjDiclo. Never T/C alone. */
const GLUED_FORM = new RegExp(
  `^(?:tablet|capsule|injection|syrup|tab|cap|syp|syr|inj|susp)\\.?(?=[A-Za-z])`,
  "i",
);
/** T. / C. or T / C as a standalone token before a name (not Taxim, Crocin). */
const TC_LEADING = /^(?:[tc]\.(?=\s+|$)|[tc](?=\s+[A-Za-z]))/i;
const TC_TRAILING = /(?:^|\s+)(?:[tc]\.)$/i;

const STRENGTH_RE =
  /(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)\s*(mcg|μg|µg|ug|mg|gms?|gm|g|mL|ml|IU|iu|U|u|%)\b(?:\s*\/\s*(\d+(?:\.\d+)?)\s*(mL|ml|L|l)\b)?/i;

export interface NormalizeDrugOptions {
  mapBrands?: boolean;
}

export interface NormalizedDrug {
  /** Name plus normalized strength, if one was present. */
  canonical: string;
  /** Bare generic/name after aliases, without strength or form. */
  name: string;
  form?: string;
  strength?: string;
  aliasApplied?: string;
}

function stripOneForm(s: string): { text: string; form?: string } {
  const trimmed = s.trim();
  let m = trimmed.match(LEADING_FORM) ?? trimmed.match(TC_LEADING);
  if (m) {
    return { text: trimmed.slice(m[0].length).trim(), form: m[0].replace(/\.$/, "").trim() };
  }
  m = trimmed.match(GLUED_FORM);
  if (m) {
    return { text: trimmed.slice(m[0].length).trim(), form: m[0].replace(/\.$/, "").trim() };
  }
  m = trimmed.match(TRAILING_FORM) ?? trimmed.match(TC_TRAILING);
  if (m) {
    return { text: trimmed.slice(0, m.index).trim(), form: m[0].trim().replace(/\.$/, "") };
  }
  return { text: trimmed };
}

export function stripDosageForms(text: string): { text: string; forms: string[] } {
  const forms: string[] = [];
  let current = text.trim();
  for (let i = 0; i < 4; i++) {
    const next = stripOneForm(current);
    if (next.form) {
      forms.push(next.form);
      current = next.text;
      continue;
    }
    break;
  }
  return { text: current, forms };
}

function normalizeStrengthMatch(
  _full: string,
  qty: string,
  unit: string,
  denomQty?: string,
  denomUnit?: string,
): string {
  const u = unitCanon(unit);
  const q = qty.replace(/\s+/g, "");
  if (denomQty && denomUnit) {
    return `${q} ${u}/${denomQty.replace(/\s+/g, "")} ${unitCanon(denomUnit)}`;
  }
  if (u === "%") return `${q}%`;
  return `${q} ${u}`;
}

function unitCanon(unit: string): string {
  const u = unit.toLowerCase().replace("μ", "u").replace("µ", "u");
  if (u === "ug" || u === "mcg") return "mcg";
  if (u === "gm" || u === "gms") return "g";
  if (u === "ml") return "mL";
  if (u === "l") return "L";
  if (u === "iu") return "IU";
  if (u === "u") return "U";
  if (u === "%") return "%";
  if (u === "mg") return "mg";
  if (u === "g") return "g";
  return unit;
}

function extractStrength(text: string): { text: string; strength?: string } {
  let strength: string | undefined;
  const textOut = text
    .replace(STRENGTH_RE, (full, qty: string, unit: string, denomQty?: string, denomUnit?: string) => {
      strength = normalizeStrengthMatch(full, qty, unit, denomQty, denomUnit);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text: textOut, strength };
}

function applyMultiWord(text: string): string {
  let s = text;
  for (const [re, canonical] of MULTI_WORD) {
    s = s.replace(re, canonical);
  }
  return s;
}

function lookupAlias(token: string, mapBrands: boolean): { value: string; key?: string } | null {
  const key = token.toLowerCase();
  const generic = DRUG_ALIASES[key];
  if (generic) return { value: generic, key: generic === key ? undefined : key };
  if (mapBrands) {
    const brand = BRAND_ALIASES[key];
    if (brand) return { value: brand, key };
  }
  return null;
}

function applyAliases(text: string, mapBrands: boolean): { text: string; aliasApplied?: string } {
  let aliasApplied: string | undefined;
  const replaced = applyMultiWord(text).replace(/\b[A-Za-z][A-Za-z0-9-]*\b/g, (tok) => {
    const hit = lookupAlias(tok, mapBrands);
    if (!hit) return tok;
    if (hit.key) aliasApplied = `${hit.key}→${hit.value}`;
    return hit.value;
  });
  return { text: replaced, aliasApplied };
}

export function normalizeDrugName(name: string, options: NormalizeDrugOptions = {}): NormalizedDrug {
  const mapBrands = options.mapBrands === true;
  const stripped = stripDosageForms(name);
  let strengthPart = extractStrength(stripped.text);
  // Bare trailing number is a common Indian strength ("Dolo 650") when no unit is written.
  if (!strengthPart.strength) {
    const bare = strengthPart.text.match(/\s+(\d+(?:\.\d+)?)\s*$/);
    if (bare && bare.index != null) {
      strengthPart = { text: strengthPart.text.slice(0, bare.index).trim(), strength: bare[1] };
    }
  }
  const aliased = applyAliases(strengthPart.text, mapBrands);
  const nameOnly = aliased.text.replace(/\s+/g, " ").trim().toLowerCase();
  const pieces = [nameOnly, strengthPart.strength].filter((p) => p && p.length > 0);
  return {
    canonical: pieces.join(" "),
    name: nameOnly,
    form: stripped.forms[0],
    strength: strengthPart.strength,
    aliasApplied: aliased.aliasApplied,
  };
}

/** Word-level form stripping and alias expansion inside running text. */
export function normalizeDrugsInText(text: string, options: NormalizeDrugOptions = {}): string {
  const mapBrands = options.mapBrands === true;
  let s = text;
  s = s.replace(
    new RegExp(`(?:(?<=^)|(?<=\\s))(?:${FORM_WORDS})\\.?(?=\\s+|$)`, "gi"),
    " ",
  );
  s = s.replace(/(?:(?<=^)|(?<=\s))[tc]\.(?=\s+|$)/gi, " ");
  s = applyAliases(s, mapBrands).text;
  s = s.replace(STRENGTH_RE, (full, qty: string, unit: string, denomQty?: string, denomUnit?: string) => {
    return normalizeStrengthMatch(full, qty, unit, denomQty, denomUnit);
  });
  return s;
}

export interface FuzzyDrugMatch {
  query: string;
  /** Canonical generic (or the candidate string if a custom list was used). */
  match: string;
  /** Lexicon key or candidate that was closest. */
  alias: string;
  distance: number;
}

export interface FuzzyDrugOptions {
  /** If omitted, the seed abbreviation table (plus brands when mapBrands) is used. */
  candidates?: Iterable<string>;
  maxDistance?: number;
  mapBrands?: boolean;
}

function lexiconEntries(mapBrands: boolean): { alias: string; match: string }[] {
  const out: { alias: string; match: string }[] = [];
  const seen = new Set<string>();
  const add = (alias: string, match: string) => {
    const key = `${alias}::${match}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ alias, match });
  };
  for (const [k, v] of Object.entries(DRUG_ALIASES)) {
    add(k, v);
    add(v, v);
  }
  if (mapBrands) {
    for (const [k, v] of Object.entries(BRAND_ALIASES)) add(k, v);
  }
  return out;
}

/**
 * Optional helper. Not used by normalizeText / normalizeForScoring: a typo
 * correction can silently swap ingredients, which the spec forbids.
 */
export function fuzzyMatchDrug(query: string, options: FuzzyDrugOptions = {}): FuzzyDrugMatch | null {
  const prepared = normalizeDrugName(query, { mapBrands: options.mapBrands }).name;
  if (!prepared) return null;
  const needle = prepared.toLowerCase();
  const max =
    options.maxDistance ?? defaultMaxDistance(needle.length);
  let best: FuzzyDrugMatch | null = null;
  const entries = options.candidates
    ? [...options.candidates].map((c) => ({ alias: c, match: c }))
    : lexiconEntries(options.mapBrands === true);
  for (const { alias, match } of entries) {
    const dAlias = editDistance(needle, alias.toLowerCase());
    const dMatch = editDistance(needle, match.toLowerCase());
    const d = Math.min(dAlias, dMatch);
    const aliasUsed = dAlias <= dMatch ? alias : match;
    if (d > max) continue;
    if (!best || d < best.distance || (d === best.distance && match.length < best.match.length)) {
      best = { query: prepared, match, alias: aliasUsed, distance: d };
    }
  }
  return best;
}


/**
 * Drop-in used for medication names and lab test names.
 * Core behaviour: lowercase, strip a leading Tab/Cap/Syp/Inj form, then
 * replace non-letter/number runs with a space. Does not expand aliases
 * (PCM stays "pcm") so field scores do not shift; use {@link normalizeDrugName}
 * when abbreviation expansion is wanted.
 */
export function normalizeName(v?: string | null): string {
  if (!v) return "";
  return v
    .toLowerCase()
    .replace(/^(tab|tablet|cap|capsule|syp|syrup|inj|injection)\.?\s+/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Drop-in used for dose, route, dosage form, timing, duration, instructions, flag.
 * Lowercase and collapse whitespace only. Duration synonyms are not applied
 * here (the scorer currently uses this function for duration); use
 * {@link normalizeDuration} when "5 days" vs "x5d" should match.
 */
export function normalizeGeneric(v?: string | null): string {
  return (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
