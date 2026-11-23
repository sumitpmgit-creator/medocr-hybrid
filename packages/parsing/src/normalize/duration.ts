// SPDX-License-Identifier: Apache-2.0
/**
 * Duration forms → "{n} {unit}" with unit in {d, wk, mo, yr}.
 * Does not convert across units (1 wk is not rewritten as 7 d).
 */

const UNIT_ALT = "days?|weeks?|months?|years?|mons?|mos?|wks?|wk|dys?|yr|mo|y|w|d";

function canonDurationUnit(raw: string): string {
  const u = raw.toLowerCase();
  if (u.startsWith("d")) return "d";
  if (u.startsWith("w")) return "wk";
  if (u.startsWith("mo")) return "mo";
  if (u.startsWith("y")) return "yr";
  return u;
}

const NUM = "(\\d+(?:\\.\\d+)?)";
const X_FORM = new RegExp(`\\bx\\s*${NUM}\\s*(${UNIT_ALT})\\b`, "gi");
const FOR_FORM = new RegExp(`\\bfor\\s+${NUM}\\s*-?\\s*(${UNIT_ALT})\\b`, "gi");
const PLAIN_FORM = new RegExp(`\\b${NUM}\\s*-?\\s*(${UNIT_ALT})\\b`, "gi");

export function canonicalizeDurationInText(text: string): string {
  const replace = (_m: string, n: string, u: string) => `${n} ${canonDurationUnit(u)}`;
  let s = text.replace(X_FORM, replace);
  s = s.replace(FOR_FORM, replace);
  s = s.replace(PLAIN_FORM, replace);
  return s;
}

export function normalizeDuration(v?: string | null): string {
  if (!v) return "";
  return canonicalizeDurationInText(v).replace(/\s+/g, " ").trim();
}
