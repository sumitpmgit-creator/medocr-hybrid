// SPDX-License-Identifier: Apache-2.0
/**
 * Detection-time folding. Offsets are mapped back to the original string
 * before redaction is applied, so full-width / Devanagari digits and
 * letter-spaced OCR still replace the right original characters.
 */

export interface FoldedView {
  view: string;
  /** view[i] came from original[toOrig[i] .. toOrigEnd[i]). */
  toOrig: number[];
  toOrigEnd: number[];
}

/** NFKC + Devanagari/Bengali digits to ASCII. */
export function foldChar(ch: string): string {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return ch;
  if (cp >= 0x0966 && cp <= 0x096f) return String(cp - 0x0966);
  if (cp >= 0x09e6 && cp <= 0x09ef) return String(cp - 0x09e6);
  return ch.normalize("NFKC");
}

/** Spaces between single Latin letters in a run of 3+ letters (OCR "M O H D"). */
export function skippableLetterSpaces(text: string): Set<number> {
  const skip = new Set<number>();
  const re = /(?:^|[^A-Za-z])((?:[A-Za-z][ \t]+){2,}[A-Za-z])/g;
  for (const m of text.matchAll(re)) {
    const run = m[1];
    if (run === undefined || m.index === undefined) continue;
    const runStart = m.index + m[0].length - run.length;
    for (let i = 0; i < run.length; i++) {
      if (/[ \t]/.test(run.charAt(i))) skip.add(runStart + i);
    }
  }
  return skip;
}

export function preprocess(text: string): FoldedView {
  const skip = skippableLetterSpaces(text);
  let view = "";
  const toOrig: number[] = [];
  const toOrigEnd: number[] = [];
  for (let i = 0; i < text.length; ) {
    if (skip.has(i)) {
      i += 1;
      continue;
    }
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    const len = cp > 0xffff ? 2 : 1;
    const out = foldChar(text.slice(i, i + len));
    for (let j = 0; j < out.length; j++) {
      view += out.charAt(j);
      toOrig.push(i);
      toOrigEnd.push(i + len);
    }
    i += len;
  }
  return { view, toOrig, toOrigEnd };
}

export function mapSpanToOrig(
  start: number,
  end: number,
  toOrig: number[],
  toOrigEnd: number[],
): { start: number; end: number } | null {
  if (end <= start) return null;
  const s = toOrig[start];
  const e = toOrigEnd[end - 1];
  if (s === undefined || e === undefined || e <= s) return null;
  return { start: s, end: e };
}
