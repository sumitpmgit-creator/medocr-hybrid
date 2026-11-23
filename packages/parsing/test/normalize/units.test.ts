// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  canonicalizeUnitsInText,
  normalizeStrength,
  normalizeText,
  normalizeUnit,
} from "../../src/normalize/index.js";

describe("normalizeUnit / normalizeStrength", () => {
  it("canonicalises the requested unit families to core-like compact forms", () => {
    expect(normalizeUnit("mg")).toBe("mg");
    expect(normalizeUnit("mcg")).toBe("mcg");
    expect(normalizeUnit("µg")).toBe("mcg");
    expect(normalizeUnit("ug")).toBe("mcg");
    expect(normalizeUnit("g")).toBe("g");
    expect(normalizeUnit("ml")).toBe("ml");
    expect(normalizeUnit("mL")).toBe("ml");
    expect(normalizeUnit("IU")).toBe("iu");
    expect(normalizeUnit("U")).toBe("u");
    expect(normalizeUnit("mmol/L")).toBe("mmol/l");
    expect(normalizeUnit("mg/dL")).toBe("mg/dl");
    expect(normalizeUnit("g/dL")).toBe("g/dl");
    expect(normalizeUnit("%")).toBe("%");
    expect(normalizeUnit("cells/cumm")).toBe("cells/cumm");
    expect(normalizeUnit("cells/cu.mm")).toBe("cells/cumm");
    expect(normalizeUnit("/µL")).toBe("/ul");
    expect(normalizeUnit("x10^3/µL")).toBe("x10^3/ul");
  });

  it("inserts no space in strength (core compact form)", () => {
    expect(normalizeStrength("500mg")).toBe("500mg");
    expect(normalizeStrength("500 mg")).toBe("500mg");
  });

  it("spaces number and unit in running text", () => {
    expect(canonicalizeUnitsInText("500mg")).toMatch(/500\s+mg/i);
    expect(normalizeText("500mg", "fields")).toMatch(/500\s+mg/i);
  });

  it("does not convert mg/dL to mmol/L or U to IU", () => {
    expect(normalizeUnit("mg/dL")).not.toBe(normalizeUnit("mmol/L"));
    expect(normalizeUnit("U")).not.toBe(normalizeUnit("IU"));
    expect(normalizeUnit("U/L")).not.toBe(normalizeUnit("IU/L"));
  });
});
