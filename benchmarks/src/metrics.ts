// Pure scoring functions. No I/O. Covered by test/metrics.test.ts.

const FRACTIONS: Record<string, string> = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };

/**
 * Text normalisation for CER/WER, applied identically to hypothesis and reference (README "Normalisation").
 * - Unicode NFC (canonical only). NFKC is NOT used: it rewrites ½ to 1⁄2 and could alter Indic compatibility forms.
 *   NFC unifies e.g. Bengali য় U+09DF with য + ় (U+09AF U+09BC), and Devanagari क़ U+0958 with क + ़.
 * - Zero-width joiner/non-joiner, BOM and soft hyphen removed: they change glyph shaping (half forms), not the text read.
 * - Typography folded: curly quotes to straight, dashes and minus to '-', fraction slash to '/', vulgar fractions to n/d.
 * - Danda । and double danda ॥ get a following space, so "হবে।একই" and "হবে। একই" score the same.
 * - Lower-case (affects Latin only; Bengali and Devanagari have no case). Whitespace runs, including newlines, collapse to one space.
 * - Digits are NOT transliterated: Bengali ৬ and Latin 6 count as different characters.
 */
export function normalizeText(s: string): string {
  return (s ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[‘’‛′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-').replace(/\u2044/g, '/')
    .replace(/[¼½¾⅓⅔⅛]/g, (c) => FRACTIONS[c])
    .replace(/([।॥])/g, '$1 ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance over any indexable sequence (chars or word tokens). */
export function levenshtein<T>(a: ArrayLike<T>, b: ArrayLike<T>): number {
  const n = a.length, m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

export interface EditCount { edits: number; refLen: number }

/** Character error counts. CER = edits / refLen (computed by caller so we can micro-average). */
export function charErrors(hyp: string, ref: string): EditCount {
  const h = Array.from(normalizeText(hyp));
  const r = Array.from(normalizeText(ref));
  return { edits: levenshtein(h, r), refLen: r.length };
}

export function tokenize(s: string): string[] {
  const t = normalizeText(s);
  return t === '' ? [] : t.split(' ');
}

/** Word error counts. WER = edits / refLen. */
export function wordErrors(hyp: string, ref: string): EditCount {
  const h = tokenize(hyp);
  const r = tokenize(ref);
  return { edits: levenshtein(h, r), refLen: r.length };
}

export function rate(c: EditCount[]): number | null {
  const ref = c.reduce((s, x) => s + x.refLen, 0);
  if (ref === 0) return null;
  return c.reduce((s, x) => s + x.edits, 0) / ref;
}

function normKey(k: string): string {
  return k.normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Model bookkeeping, not document content: never scored. */
export const META_KEYS = new Set(['confidence', 'sourceText', 'bbox', 'abstentions', 'genericName']);

/**
 * Flatten nested ground-truth / predicted JSON to path -> scalar.
 * Arrays of objects that all carry a string `name` are keyed by that name
 * (tests[hemoglobin].value) so ordering differences don't count as errors.
 */
export function flattenFields(v: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (v === null || v === undefined) {
    if (prefix) out[prefix] = '';
    return out;
  }
  if (Array.isArray(v)) {
    const keyOf = (e: any) => (typeof e?.name === 'string' ? 'name' : typeof e?.test === 'string' ? 'test' : null);
    const k0 = v.length > 0 ? keyOf(v[0]) : null;
    const named = k0 !== null && v.every((e) => e && typeof e === 'object' && !Array.isArray(e) && keyOf(e) === k0);
    v.forEach((e, i) => {
      if (named) {
        const { [k0!]: name, ...rest } = e as any;
        const p = `${prefix}[${normalizeValue(name)}]`;
        if (Object.keys(rest).length === 0) out[p] = normalizeValue(name);
        else flattenFields(rest, p, out);
      } else {
        flattenFields(e, `${prefix}[${i}]`, out);
      }
    });
    return out;
  }
  if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (META_KEYS.has(k)) continue;
      flattenFields(val, prefix ? `${prefix}.${normKey(k)}` : normKey(k), out);
    }
    return out;
  }
  out[prefix] = normalizeValue(v);
  return out;
}

/** Value normalisation for exact-match field scoring: text normalisation, strip trailing punctuation, canonical numbers. */
export function normalizeValue(v: unknown): string {
  let s = normalizeText(String(v)).replace(/[.,;:]+$/, '');
  const num = s.replace(/,/g, '');
  if (/^[-+]?\d+(\.\d+)?$/.test(num)) s = String(Number(num));
  return s;
}

export interface FieldResult { path: string; expected: string; predicted: string | null; match: boolean }

/** Field-level accuracy: every ground-truth leaf is one field; missing prediction = wrong. Extra predicted fields are ignored. */
export function scoreFields(pred: unknown, gt: unknown): { correct: number; total: number; fields: FieldResult[] } {
  const g = flattenFields(gt);
  const p = flattenFields(pred ?? {});
  const fields: FieldResult[] = Object.entries(g).map(([path, expected]) => {
    const predicted = path in p ? p[path] : null;
    // A ground-truth null/empty value is matched by an absent or empty prediction.
    const match = expected === '' ? predicted === null || predicted === '' : predicted !== null && predicted === expected;
    return { path, expected, predicted, match };
  });
  return { correct: fields.filter((f) => f.match).length, total: fields.length, fields };
}

/** Nearest-rank percentile (q in 0..100). */
export function percentile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((q / 100) * s.length));
  return s[rank - 1];
}

export function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}
