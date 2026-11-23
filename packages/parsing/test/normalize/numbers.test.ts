// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { normalizeNumber, normalizeNumbers, normalizeText } from "../../src/normalize/index.js";

describe("normalizeNumbers (text / CER helper, conservative commas)", () => {
  it("strips Western thousands and Indian lakh grouping", () => {
    expect(normalizeNumbers("1,000")).toBe("1000");
    expect(normalizeNumbers("1,00,000")).toBe("100000");
    expect(normalizeNumbers("1,23,45,678")).toBe("12345678");
  });

  it("does not treat 1,5 as 1.5 or 15", () => {
    expect(normalizeNumbers("1,5")).toBe("1,5");
  });

  it("turns a leading decimal into 0.x", () => {
    expect(normalizeNumbers(".5")).toBe("0.5");
    expect(normalizeNumbers("=.5")).toBe("=0.5");
  });

  it("never changes magnitude", () => {
    expect(normalizeNumbers("5")).not.toBe(normalizeNumbers("50"));
    expect(normalizeText("5 mg", "fields")).not.toBe(normalizeText("50 mg", "fields"));
  });
});

describe("normalizeNumber (drop-in, core comma behaviour)", () => {
  it("uses Number() so 12.50 and 12.5 match, and 1,5 becomes 15", () => {
    expect(normalizeNumber("12.50")).toBe("12.5");
    expect(normalizeNumber("1,5")).toBe("15");
    expect(normalizeNumber("1,000")).toBe("1000");
  });
});
