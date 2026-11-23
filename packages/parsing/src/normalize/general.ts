// SPDX-License-Identifier: Apache-2.0

const SUPERSCRIPT: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
};

/**
 * Rewrite a run of superscript digits/signs as ^n.
 * Must run before NFKC: NFKC maps ³ to 3, which would turn 10³ into 103.
 */
export function rewriteSuperscripts(text: string): string {
  return text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/gu, (run) => {
    let body = "";
    for (const c of run) body += SUPERSCRIPT[c] ?? c;
    return `^${body}`;
  });
}

/** Soft hyphen, zero-width space, BOM. Leaves ZWJ/ZWNJ for Indic conjuncts. */
const INVISIBLE = /[\u00AD\u200B\uFEFF]/g;

export function applyUnicode(text: string): string {
  let s = rewriteSuperscripts(text);
  s = s.normalize("NFKC");
  s = s.replace(INVISIBLE, "");
  s = s.replace(/\r\n?|\u2028|\u2029/g, "\n");
  return s;
}

export function unifyPunctuation(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...");
}

export function collapseWhitespace(text: string, preserveNewlines: boolean): string {
  if (preserveNewlines) {
    return text
      .replace(/\r\n?|\u2028|\u2029/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+/g, " ").replace(/ +$/g, "").replace(/^ +/g, ""))
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
  }
  return text.replace(/\s+/g, " ").trim();
}

export function trimEdges(text: string): string {
  return text.replace(/^\s+|\s+$/g, "");
}
