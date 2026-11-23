/** Independent reference implementations used to cross-check core's scorers. */

export function levenshtein<T>(a: readonly T[], b: readonly T[]): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
export const oracleCer = (r: string, h: string) => { const R = Array.from(norm(r)), H = Array.from(norm(h)); return R.length ? levenshtein(R, H) / R.length : H.length ? 1 : 0; };
export const oracleWer = (r: string, h: string) => { const R = norm(r).split(' ').filter(Boolean), H = norm(h).split(' ').filter(Boolean); return R.length ? levenshtein(R, H) / R.length : H.length ? 1 : 0; };

/** Expected Calibration Error with equal-width bins. */
export function ece(conf: number[], correct: number[], bins = 10): number {
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const idx = conf.map((c, i) => [c, i] as const).filter(([c]) => (b === bins - 1 ? c >= b / bins && c <= 1 : c >= b / bins && c < (b + 1) / bins)).map(([, i]) => i);
    if (!idx.length) continue;
    const avgC = idx.reduce((s, i) => s + conf[i]!, 0) / idx.length;
    const acc = idx.reduce((s, i) => s + correct[i]!, 0) / idx.length;
    e += (idx.length / conf.length) * Math.abs(avgC - acc);
  }
  return e;
}

/** Deterministic PRNG (mulberry32) so property tests are reproducible. */
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function corrupt(text: string, rate: number, rand: () => number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
  let out = '';
  for (const ch of text) {
    const r = rand();
    if (r < rate / 3) continue; // deletion
    if (r < (2 * rate) / 3) { out += alphabet[Math.floor(rand() * alphabet.length)]; continue; } // substitution
    if (r < rate) { out += ch + alphabet[Math.floor(rand() * alphabet.length)]; continue; } // insertion
    out += ch;
  }
  return out;
}
