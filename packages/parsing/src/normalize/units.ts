// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical units for scoring. Only spelling and synonymous-unit variants;
 * no factor-dependent conversions (mg/dL ↔ mmol/L, x10^9/L ↔ x10^3/uL).
 *
 * Canonical spellings are ASCII-stable (mcg, uL, umol/L) so a later NFKC pass
 * cannot change them (NFKC maps U+00B5 MICRO SIGN to Greek mu).
 */

export interface UnitAliasRule {
  aliases: readonly string[];
  canonical: string;
}

/**
 * Longer aliases must be listed first. Aliases are match templates:
 * spaces optional around / and ^; μ/µ also match u; a leading "x10" also
 * matches ×10.
 */
export const UNIT_ALIAS_RULES: readonly UnitAliasRule[] = [
  { aliases: ["x10^3/uL", "x10^3/μL", "10^3/uL", "10^3/μL"], canonical: "x10^3/uL" },
  { aliases: ["x10^6/uL", "x10^6/μL", "10^6/uL", "10^6/μL"], canonical: "x10^6/uL" },
  { aliases: ["cells/cumm", "cells/cu.mm", "cells/cmm", "cells/mm^3", "cells/mm3", "/cumm", "/cu.mm", "/cmm"], canonical: "cells/cumm" },
  { aliases: ["cells/uL", "cells/μL", "/uL", "/μL", "per uL", "per μL", "per microlitre", "per microliter"], canonical: "/uL" },
  { aliases: ["umol/L", "μmol/L", "umol/l", "micromol/L", "micromoles/L"], canonical: "umol/L" },
  { aliases: ["nmol/L", "nmol/l"], canonical: "nmol/L" },
  { aliases: ["mmol/L", "mmol/l", "mmoles/L", "mmol per litre", "mmol per liter"], canonical: "mmol/L" },
  { aliases: ["mEq/L", "meq/L", "meq/l", "mEq/l"], canonical: "mEq/L" },
  { aliases: ["mg/dL", "mg/dl", "mg %", "mg%"], canonical: "mg/dL" },
  { aliases: ["g/dL", "g/dl", "gm/dL", "gm/dl", "g %", "g%", "gm%", "gm %"], canonical: "g/dL" },
  { aliases: ["mg/L", "mg/l"], canonical: "mg/L" },
  { aliases: ["g/L", "g/l", "gm/L"], canonical: "g/L" },
  { aliases: ["ng/mL", "ng/ml"], canonical: "ng/mL" },
  { aliases: ["ng/dL", "ng/dl"], canonical: "ng/dL" },
  { aliases: ["pg/mL", "pg/ml"], canonical: "pg/mL" },
  { aliases: ["mcg/mL", "μg/mL", "ug/mL", "µg/mL", "mcg/ml", "μg/ml", "ug/ml"], canonical: "mcg/mL" },
  { aliases: ["IU/mL", "iu/ml", "i.u./mL"], canonical: "IU/mL" },
  { aliases: ["IU/L", "iu/l", "i.u./L"], canonical: "IU/L" },
  { aliases: ["uIU/mL", "μIU/mL", "uIU/ml", "uu/mL"], canonical: "uIU/mL" },
  { aliases: ["mIU/L", "miu/l"], canonical: "mIU/L" },
  { aliases: ["U/mL", "u/ml"], canonical: "U/mL" },
  { aliases: ["U/L", "u/l"], canonical: "U/L" },
  { aliases: ["mmHg", "mm Hg", "mmhg"], canonical: "mmHg" },
  { aliases: ["mm/hr", "mm/h", "mm per hour"], canonical: "mm/hr" },
  { aliases: ["micrograms", "microgram", "mcg", "μg", "µg", "ug"], canonical: "mcg" },
  { aliases: ["milligrams", "milligram", "mg"], canonical: "mg" },
  { aliases: ["kilograms", "kilogram", "kgs", "kg"], canonical: "kg" },
  { aliases: ["grams", "gram", "gms", "gm", "g"], canonical: "g" },
  { aliases: ["microlitres", "microliters", "microlitre", "microliter", "uL", "μL", "µL", "ul"], canonical: "uL" },
  { aliases: ["millilitres", "milliliters", "millilitre", "milliliter", "mls", "mL", "ml", "cc", "c.c.", "c.c"], canonical: "mL" },
  { aliases: ["litres", "liters", "litre", "liter", "L", "l"], canonical: "L" },
  { aliases: ["international units", "international unit", "I.U.", "IU", "iu"], canonical: "IU" },
  { aliases: ["units", "unit", "U"], canonical: "U" },
  { aliases: ["percent", "per cent", "percentage", "pct", "%"], canonical: "%" },
  { aliases: ["fL", "fl"], canonical: "fL" },
  { aliases: ["pg"], canonical: "pg" },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toUnitPattern(alias: string): string {
  const chars = [...alias];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    const next2 = `${chars[i + 1] ?? ""}${chars[i + 2] ?? ""}`;
    if (c === " ") {
      out += "\\s*";
    } else if (c === "/") {
      out += "\\s*/\\s*";
    } else if (c === "^") {
      out += "\\s*(?:\\^|\\*|e)\\s*";
    } else if (c === ".") {
      out += "\\.?";
    } else if (c === "×" || (c === "x" && next2 === "10")) {
      out += "[×x]\\s*";
    } else if (c === "μ" || c === "µ") {
      out += "[μµu]";
    } else {
      out += escapeRegex(c);
    }
  }
  return out;
}

const UNIT_ENTRIES: { pattern: string; canonical: string }[] = [];
for (const rule of UNIT_ALIAS_RULES) {
  for (const alias of rule.aliases) {
    UNIT_ENTRIES.push({ pattern: toUnitPattern(alias), canonical: rule.canonical });
  }
}
// Leftmost-first alternation: keep longer surface forms first.
UNIT_ENTRIES.sort((a, b) => b.pattern.length - a.pattern.length);

const UNIT_BODY = UNIT_ENTRIES.map((e) => e.pattern).join("|");
const UNIT_LOOKUP = new Map(UNIT_ENTRIES.map((e) => [e.pattern, e.canonical]));

/** Case-insensitive unit token, not mid-word (imagine, milligram inside a word). */
const UNIT_TOKEN = new RegExp(`(?<![A-Za-z])(?:${UNIT_BODY})(?![A-Za-z])`, "gi");

function canonicalUnit(raw: string): string {
  // Re-run the alternation to find which branch matched, via a cached regex per pattern? Slow but small.
  // Faster: compact and try exact alias keys built the same way as match.
  const compact = raw.replace(/\s+/g, " ").trim();
  for (const rule of UNIT_ALIAS_RULES) {
    for (const alias of rule.aliases) {
      const re = new RegExp(`^${toUnitPattern(alias)}$`, "i");
      if (re.test(compact)) return rule.canonical;
    }
  }
  return compact;
}

function spaceBeforeUnit(canonical: string, prev: string): string {
  if (canonical === "%") return canonical;
  if (canonical.startsWith("/")) return canonical;
  if (/\d$/.test(prev)) return ` ${canonical}`;
  return canonical;
}

/** Replace unit tokens in running text and insert a space after a number when needed. */
export function canonicalizeUnitsInText(text: string): string {
  return text.replace(UNIT_TOKEN, (match, offset, full: string) => {
    const canonical = canonicalUnit(match);
    const prev = offset > 0 ? full[offset - 1]! : "";
    // If there is already whitespace before the match, do not insert another space.
    if (/\s/.test(prev)) return canonical;
    return spaceBeforeUnit(canonical, prev);
  });
}

/** Strength/dose unit tokens, lowercase, matching core plus a few synonyms. */
const STRENGTH_UNIT: Record<string, string> = {
  mgs: "mg",
  milligram: "mg",
  milligrams: "mg",
  mcg: "mcg",
  "µg": "mcg",
  ug: "mcg",
  ml: "ml",
  millilitre: "ml",
  milliliter: "ml",
  millilitres: "ml",
  milliliters: "ml",
  mls: "ml",
  cc: "ml",
  iu: "iu",
  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
};

/**
 * Drop-in: lowercase, strip spaces, map unit spellings in place.
 * Output stays compact ("625mg", "5mcg") so field scores do not shift.
 */
export function normalizeStrength(v?: string | null): string {
  if (!v) return "";
  const t = v.toLowerCase().replace(/\s+/g, "");
  return t.replace(/([a-zµ]+)/g, (u) => STRENGTH_UNIT[u] ?? u);
}

/**
 * Extra field-unit synonyms applied after core's compact/lowercase/µ step.
 * Differences vs core are listed in test/normalize/core-compat.test.ts.
 */
const UNIT_SYNONYM: Record<string, string> = {
  mgs: "mg",
  milligram: "mg",
  milligrams: "mg",
  mcg: "mcg",
  ug: "mcg",
  "µg": "mcg",
  ml: "ml",
  cc: "ml",
  "c.c": "ml",
  "c.c.": "ml",
  iu: "iu",
  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
  "mg%": "mg/dl",
  "g%": "g/dl",
  "gm%": "g/dl",
  "gm/dl": "g/dl",
  percent: "%",
  percentage: "%",
  pct: "%",
  "cells/cu.mm": "cells/cumm",
  "cells/cmm": "cells/cumm",
  "cells/mm3": "cells/cumm",
  "cells/mm^3": "cells/cumm",
  "/cumm": "cells/cumm",
  "/cu.mm": "cells/cumm",
  "/cmm": "cells/cumm",
  "cells/ul": "/ul",
  "/ul": "/ul",
  "x10^3/ul": "x10^3/ul",
  "10^3/ul": "x10^3/ul",
  "x10^6/ul": "x10^6/ul",
  "10^6/ul": "x10^6/ul",
};

/**
 * Drop-in signature. Core: lowercase, strip spaces, μ→µ, leading mgs/milligram(s)→mg.
 * Additions (documented differences): µg/ug→mcg, gm/gms→g, mg%→mg/dl, g%→g/dl,
 * cc→ml, cells/cu.mm family→cells/cumm, /µl→/ul, percent→%.
 * Unchanged core outputs include g/dl, mg/dl, ml, iu, mmol/l, and U→u.
 */
export function normalizeUnit(v?: string | null): string {
  if (!v) return "";
  let t = v.toLowerCase().replace(/\s+/g, "").replace(/μ/g, "µ").replace(/^(mgs|milligrams?)$/, "mg");
  t = t.replace(/µ/g, "u");
  if (t === "ug" || t.endsWith("/ug")) t = t.replace(/ug$/, "mcg");
  return UNIT_SYNONYM[t] ?? t;
}

export { UNIT_TOKEN };
