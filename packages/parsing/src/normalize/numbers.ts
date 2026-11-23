// SPDX-License-Identifier: Apache-2.0

/**
 * Indian lakh/crore (1,00,000 or 1,23,45,678), Indian group-of-two (1,00),
 * or Western thousands (1,000). Does not match "1,5".
 */
const GROUPED = /\d{1,3}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{2})+|\d{1,3}(?:,\d{3})+/g;

/** Leading decimal not preceded by a digit: ".5", "=.5". */
const LEADING_DECIMAL = /(^|[^\d])\.(\d)/g;

export function normalizeNumbers(text: string): string {
  let s = text.replace(GROUPED, (m) => m.replace(/,/g, ""));
  s = s.replace(LEADING_DECIMAL, (_m, prefix: string, digits: string) => `${prefix}0.${digits}`);
  return s;
}


/**
 * Drop-in used by the field scorer for lab values and quantities.
 * Core behaviour is preserved: strip every comma, map U+2212 to "-", then
 * Number() + String() when finite. That means "12.50" → "12.5", "1.0" → "1",
 * and "1,5" → "15" (core already does this; the text helper below does not).
 */
export function normalizeNumber(v?: string | null): string {
  if (!v) return "";
  const t = v.replace(/,/g, "").replace(/−/g, "-").trim();
  const n = Number(t);
  return Number.isFinite(n) && t !== "" ? String(n) : t.toLowerCase();
}
