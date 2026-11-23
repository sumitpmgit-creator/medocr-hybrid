// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { normalizeDuration, normalizeGeneric, normalizeText } from "../../src/normalize/index.js";

describe("normalizeDuration", () => {
  it("canonicalises 5 days, x5d and 1 wk without converting across units", () => {
    expect(normalizeDuration("5 days")).toBe("5 d");
    expect(normalizeDuration("5 day")).toBe("5 d");
    expect(normalizeDuration("x5d")).toBe("5 d");
    expect(normalizeDuration("x 5 days")).toBe("5 d");
    expect(normalizeDuration("for 5 days")).toBe("5 d");
    expect(normalizeDuration("1 wk")).toBe("1 wk");
    expect(normalizeDuration("1 week")).toBe("1 wk");
    expect(normalizeDuration("1 wk")).not.toBe("7 d");
    expect(normalizeDuration(null)).toBe("");
  });

  it("is not applied by the drop-in normalizeGeneric (scorer still uses that for duration)", () => {
    expect(normalizeGeneric("x5d")).toBe("x5d");
    expect(normalizeGeneric("5 days")).toBe("5 days");
  });

  it("runs on a medication line when duration is enabled", () => {
    expect(normalizeText("x5d", "medication")).toBe("5 d");
  });
});
