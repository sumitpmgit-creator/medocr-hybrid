// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  applyUnicode,
  normalizeForScoring,
  normalizeText,
  rewriteSuperscripts,
  unifyPunctuation,
} from "../../src/normalize/index.js";

describe("general unicode / whitespace / punctuation", () => {
  it("rewrites superscripts before NFKC so 10³ does not become 103", () => {
    expect(rewriteSuperscripts("10³")).toBe("10^3");
    expect(applyUnicode("10³/µL")).toContain("10^3");
    expect(applyUnicode("10³")).not.toBe("103");
    expect(normalizeText("10³/µL", "fields")).not.toContain("103/");
  });

  it("applies NFKC (ligatures, fullwidth, NBSP, compatibility µg)", () => {
    expect(applyUnicode("ﬀ")).toBe("ff");
    expect(applyUnicode("１")).toBe("1");
    expect(applyUnicode("\u00A0")).toBe(" ");
    expect(applyUnicode("㎍")).toBe("μg");
  });

  it("strips soft hyphen and zero-width space but keeps Indic ZWJ/ZWNJ", () => {
    expect(applyUnicode("para\u00ADcetamol")).toBe("paracetamol");
    expect(applyUnicode("a\u200Bb")).toBe("ab");
    const zwj = "क्\u200Dष";
    expect(applyUnicode(zwj)).toBe(zwj);
  });

  it("normalizes CR/CRLF to LF", () => {
    expect(applyUnicode("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("transcription preset preserves case, internal spaces and newlines", () => {
    const raw = "Tab  PCM\n500mg";
    expect(normalizeText(raw, "transcription")).toBe("Tab  PCM\n500mg");
  });

  it("fields preset folds case, unifies punctuation and collapses whitespace", () => {
    expect(normalizeText("  Hello   World  ", "fields")).toBe("hello world");
    expect(unifyPunctuation("1–0–1 “dose”")).toBe("1-0-1 \"dose\"");
  });

  it("normalizeForScoring applies the same options to both sides", () => {
    const { prediction, reference } = normalizeForScoring("  12.50  ", "12.50", "fields");
    expect(prediction).toBe(reference);
  });
});
