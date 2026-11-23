// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { normalizeField, normalizeFrequency, normalizeText } from "../../src/normalize/index.js";

describe("normalizeFrequency", () => {
  it("maps shorthands to core 1-0-1 style forms", () => {
    expect(normalizeFrequency("OD")).toBe("1-0-0");
    expect(normalizeFrequency("BD")).toBe("1-0-1");
    expect(normalizeFrequency("BID")).toBe("1-0-1");
    expect(normalizeFrequency("TDS")).toBe("1-1-1");
    expect(normalizeFrequency("TID")).toBe("1-1-1");
    expect(normalizeFrequency("QID")).toBe("1-1-1-1");
    expect(normalizeFrequency("HS")).toBe("0-0-1");
    expect(normalizeFrequency("SOS")).toBe("sos");
    expect(normalizeFrequency("1-0-1")).toBe("1-0-1");
  });

  it("normalizes typographic dashes and x separators", () => {
    expect(normalizeFrequency("1–0–1")).toBe("1-0-1");
    expect(normalizeFrequency("1 x 0 x 1")).toBe("1-0-1");
  });

  it("routes the frequency field kind through the drop-in function", () => {
    expect(normalizeField("T.D.S.", "frequency")).toBe("1-1-1");
  });

  it("rewrites shorthands inside a medication line", () => {
    const out = normalizeText("PCM 500mg BD x5d", "medication");
    expect(out).toContain("1-0-1");
  });
});
