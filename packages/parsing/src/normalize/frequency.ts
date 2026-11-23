// SPDX-License-Identifier: Apache-2.0
/**
 * Frequency normaliser used by the field scorer.
 *
 * Canonical forms follow packages/core/src/normalize.ts so scores do not
 * shift: OD/QD/once daily → 1-0-0, BD/BID/twice daily → 1-0-1,
 * TDS/TID/thrice daily → 1-1-1, QID/four times a day → 1-1-1-1,
 * HS/at night/at bedtime → 0-0-1, SOS/PRN/as needed → sos, STAT → stat.
 * Already-dashed patterns such as 1-0-1 and 1/2-0-1 are preserved.
 *
 * SoalTech §7 cautions that OD does not encode time of day. This file
 * keeps core's existing mapping so field exact-match stays stable.
 */

/** Core table, plus a few same-target synonyms (qds, nocte, bedtime, …). */
const FREQ: Record<string, string> = {
  od: '1-0-0',
  qd: '1-0-0',
  'once daily': '1-0-0',
  'once a day': '1-0-0',
  daily: '1-0-0',
  'once-daily': '1-0-0',
  oncedaily: '1-0-0',
  bd: '1-0-1',
  bid: '1-0-1',
  'twice daily': '1-0-1',
  'twice a day': '1-0-1',
  'twice-daily': '1-0-1',
  twicedaily: '1-0-1',
  tds: '1-1-1',
  tid: '1-1-1',
  'thrice daily': '1-1-1',
  'three times a day': '1-1-1',
  'three times daily': '1-1-1',
  'thrice-daily': '1-1-1',
  qid: '1-1-1-1',
  qds: '1-1-1-1',
  'four times a day': '1-1-1-1',
  'four times daily': '1-1-1-1',
  hs: '0-0-1',
  'at night': '0-0-1',
  'at bedtime': '0-0-1',
  nocte: '0-0-1',
  bedtime: '0-0-1',
  sos: 'sos',
  prn: 'sos',
  'as needed': 'sos',
  'if needed': 'sos',
  'when needed': 'sos',
  'if required': 'sos',
  'when required': 'sos',
  'as required': 'sos',
  stat: 'stat',
};

const DASHED_SCHEDULE = /^\d(?:\/\d)?(?:-\d(?:\/\d)?){2,3}$/;

/**
 * Drop-in signature and core canonical forms. Additions (listed in tests):
 * 1/0/1 and 1 0 1 collapse to 1-0-1; qds, nocte, bedtime and a few
 * phrase variants join the existing table. 1/2-0-1 is left intact.
 */
export function normalizeFrequency(v?: string | null): string {
  if (!v) return '';
  const t = v.toLowerCase().replace(/[.\s]+/g, ' ').trim();
  const dashed = t.replace(/\s*[-–x×]\s*/g, '-');
  if (DASHED_SCHEDULE.test(dashed)) return dashed;
  // Addition: slash-only schedules (not 1/2-0-1, already returned above).
  const slashCompact = t.replace(/\s*\/\s*/g, '/');
  if (/^\d(?:\/\d){2,3}$/.test(slashCompact)) return slashCompact.replace(/\//g, '-');
  // Addition: space-separated single-digit schedules ("1 0 1").
  if (/^\d(?: \d){2,3}$/.test(t)) return t.replace(/ /g, '-');
  return FREQ[t] ?? FREQ[t.replace(/\s/g, '')] ?? t;
}

const PHRASES: readonly [RegExp, string][] = [
  [/\bfour\s+times(?:\s+(?:a|per)\s+day(?:ly)?|\s+daily)?\b/gi, '1-1-1-1'],
  [/\bthree\s+times(?:\s+(?:a|per)\s+day(?:ly)?|\s+daily)?\b/gi, '1-1-1'],
  [/\btwo\s+times(?:\s+(?:a|per)\s+day(?:ly)?|\s+daily)?\b/gi, '1-0-1'],
  [/\bthrice(?:\s+(?:a|per)\s+day(?:ly)?|-?daily|\s+daily)?\b/gi, '1-1-1'],
  [/\btwice(?:\s+(?:a|per)\s+day(?:ly)?|-?daily|\s+daily)?\b/gi, '1-0-1'],
  [/\bonce(?:\s+(?:a|per)\s+day(?:ly)?|-?daily|\s+daily)?\b/gi, '1-0-0'],
  [/\b(?:as|if|when)\s+(?:needed|required)\b/gi, 'sos'],
  [/\bat\s+bed\s*time\b/gi, '0-0-1'],
  [/\bhora\s+somni\b/gi, '0-0-1'],
  [/\bat\s+night\b/gi, '0-0-1'],
  [/\bnocte\b/gi, '0-0-1'],
  [/\bbedtime\b/gi, '0-0-1'],
  [/\bq\.?\s*d\.?\s*s\.?\b/gi, '1-1-1-1'],
  [/\bq\.?\s*i\.?\s*d\.?\b/gi, '1-1-1-1'],
  [/\bt\.?\s*d\.?\s*s\.?\b/gi, '1-1-1'],
  [/\bt\.?\s*i\.?\s*d\.?\b/gi, '1-1-1'],
  [/\bb\.?\s*i\.?\s*d\.?\b/gi, '1-0-1'],
  [/\bb\.?\s*d\.?\b/gi, '1-0-1'],
  [/\bo\.?\s*d\.?\b/gi, '1-0-0'],
  [/\bq\.?\s*d\.?\b/gi, '1-0-0'],
  [/\bh\.?\s*s\.?\b/gi, '0-0-1'],
  [/\bs\.?\s*o\.?\s*s\.?\b/gi, 'sos'],
  [/\bp\.?\s*r\.?\s*n\.?\b/gi, 'sos'],
  [/\bqds\b/gi, '1-1-1-1'],
  [/\bqid\b/gi, '1-1-1-1'],
  [/\btds\b/gi, '1-1-1'],
  [/\btid\b/gi, '1-1-1'],
  [/\bbid\b/gi, '1-0-1'],
  [/\bbd\b/gi, '1-0-1'],
  [/\bod\b/gi, '1-0-0'],
  [/\bqd\b/gi, '1-0-0'],
  [/\bhs\b/gi, '0-0-1'],
  [/\bsos\b/gi, 'sos'],
  [/\bprn\b/gi, 'sos'],
  [/\bstat\b/gi, 'stat'],
  [/\bdaily\b/gi, '1-0-0'],
];

/** Hyphen/slash/times forms in running text, after phrase substitution. */
const HYPHEN_PATTERN = /\b(\d+(?:\/\d+)?)\s*[-–—x×]\s*(\d+(?:\/\d+)?)\s*[-–—x×]\s*(\d+(?:\/\d+)?)(?:\s*[-–—x×]\s*(\d+(?:\/\d+)?))?\b/g;

export function canonicalizeFrequencyInText(text: string): string {
  let s = text;
  for (const [re, canonical] of PHRASES) s = s.replace(re, canonical);
  s = s.replace(
    HYPHEN_PATTERN,
    (_m, a: string, b: string, c: string, d?: string) => (d ? `${a}-${b}-${c}-${d}` : `${a}-${b}-${c}`),
  );
  s = s.replace(/\b(\d)\/(\d)\/(\d)(?:\/(\d))?\b/g, (_m, a, b, c, d) => (d ? `${a}-${b}-${c}-${d}` : `${a}-${b}-${c}`));
  return s;
}
