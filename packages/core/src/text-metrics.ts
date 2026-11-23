// SPDX-License-Identifier: Apache-2.0
/** Benchmark A: CER / WER per the SoalTech spec: (S + D + I) / N_reference. Can exceed 1.0. */

export interface EditCounts { substitutions: number; deletions: number; insertions: number; hits: number; refLength: number }

export interface TextNormalizeOptions {
  /** Unicode NFC (default true) */
  nfc?: boolean;
  /** Collapse all whitespace runs to one space and trim (default true) */
  collapseWhitespace?: boolean;
  lowercase?: boolean;
  stripPunctuation?: boolean;
}

export function normalizeText(s: string, o: TextNormalizeOptions = {}): string {
  let t = s;
  if (o.nfc ?? true) t = t.normalize('NFC');
  if (o.lowercase) t = t.toLowerCase();
  if (o.stripPunctuation) t = t.replace(/[\p{P}]/gu, '');
  if (o.collapseWhitespace ?? true) t = t.replace(/\s+/gu, ' ').trim();
  return t;
}

/** Levenshtein alignment over arbitrary token arrays, returning S/D/I counts. O(n*m) time, O(m) memory for counts. */
export function editCounts<T>(ref: readonly T[], hyp: readonly T[]): EditCounts {
  const n = ref.length, m = hyp.length;
  // Each cell: [cost, S, D, I]
  let prev: [number, number, number, number][] = Array.from({ length: m + 1 }, (_, j) => [j, 0, 0, j]);
  for (let i = 1; i <= n; i++) {
    const cur: [number, number, number, number][] = new Array(m + 1);
    cur[0] = [i, 0, i, 0];
    for (let j = 1; j <= m; j++) {
      const same = ref[i - 1] === hyp[j - 1];
      const diag = prev[j - 1]!;
      const up = prev[j]!; // deletion (ref char missing in hyp)
      const left = cur[j - 1]!; // insertion
      const cSub = diag[0] + (same ? 0 : 1);
      const cDel = up[0] + 1;
      const cIns = left[0] + 1;
      if (cSub <= cDel && cSub <= cIns) cur[j] = [cSub, diag[1] + (same ? 0 : 1), diag[2], diag[3]];
      else if (cDel <= cIns) cur[j] = [cDel, up[1], up[2] + 1, up[3]];
      else cur[j] = [cIns, left[1], left[2], left[3] + 1];
    }
    prev = cur;
  }
  const [, S, D, I] = prev[m]!;
  return { substitutions: S, deletions: D, insertions: I, hits: n - S - D, refLength: n };
}

export interface ErrorRate extends EditCounts { rate: number }

function rate(c: EditCounts): ErrorRate {
  const errs = c.substitutions + c.deletions + c.insertions;
  const r = c.refLength === 0 ? (errs === 0 ? 0 : 1) : errs / c.refLength;
  return { ...c, rate: r };
}

/** Character Error Rate. Uses code points (Array.from) so Devanagari/Gujarati combining marks count per code point. */
export function cer(reference: string, hypothesis: string, o?: TextNormalizeOptions): ErrorRate {
  return rate(editCounts(Array.from(normalizeText(reference, o)), Array.from(normalizeText(hypothesis, o))));
}

export function tokenizeWords(s: string): string[] {
  return s.split(/\s+/u).filter(Boolean);
}

export function wer(reference: string, hypothesis: string, o?: TextNormalizeOptions): ErrorRate {
  return rate(editCounts(tokenizeWords(normalizeText(reference, o)), tokenizeWords(normalizeText(hypothesis, o))));
}

/** Fraction of reference words absent from the hypothesis (omission) and hypothesis words absent from the reference (invention). */
export function omissionInvention(reference: string, hypothesis: string, o: TextNormalizeOptions = { lowercase: true, stripPunctuation: true }) {
  const r = tokenizeWords(normalizeText(reference, o));
  const h = tokenizeWords(normalizeText(hypothesis, o));
  const hs = new Map<string, number>();
  for (const w of h) hs.set(w, (hs.get(w) ?? 0) + 1);
  const rs = new Map<string, number>();
  for (const w of r) rs.set(w, (rs.get(w) ?? 0) + 1);
  let omitted = 0;
  for (const [w, c] of rs) omitted += Math.max(0, c - (hs.get(w) ?? 0));
  let invented = 0;
  for (const [w, c] of hs) invented += Math.max(0, c - (rs.get(w) ?? 0));
  return {
    omissionRate: r.length ? omitted / r.length : 0,
    inventionRate: h.length ? invented / h.length : 0,
  };
}

/** Numeric-token accuracy: share of numbers in the reference reproduced exactly (decimals and signs matter). */
export function numericAccuracy(reference: string, hypothesis: string): number {
  const nums = (s: string): string[] => s.match(/[-−]?\d+(?:[.,]\d+)?/gu) ?? [];
  const r = nums(reference);
  if (!r.length) return 1;
  const pool = nums(hypothesis);
  let hit = 0;
  for (const n of r) {
    const k = pool.indexOf(n);
    if (k >= 0) { hit++; pool.splice(k, 1); }
  }
  return hit / r.length;
}

/** Similarity 0..1 based on CER (1 - min(1, CER)). Used for fuzzy matching of names. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  return 1 - Math.min(1, cer(a, b, { lowercase: true }).rate);
}

/** Does `needle` appear (fuzzily) in `haystack`? Sliding window over words. */
export function fuzzyContains(haystack: string, needle: string, minSim = 0.85): boolean {
  const h = normalizeText(haystack, { lowercase: true });
  const n = normalizeText(needle, { lowercase: true });
  if (!n) return true;
  if (h.includes(n)) return true;
  const hw = tokenizeWords(h);
  const nw = tokenizeWords(n).length;
  for (let k = Math.max(1, nw - 1); k <= nw + 1; k++) {
    for (let i = 0; i + k <= hw.length; i++) {
      if (similarity(hw.slice(i, i + k).join(' '), n) >= minSim) return true;
    }
  }
  return false;
}
