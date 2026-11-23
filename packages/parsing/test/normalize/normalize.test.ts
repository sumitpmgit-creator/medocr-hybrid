// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  NORMALIZATION_VERSION,
  normalizeField,
  normalizeForScoring,
  normalizeText,
} from "../../src/normalize/index.js";

describe("normalizeText presets and safety", () => {
  it("exports a version for run metadata", () => {
    expect(NORMALIZATION_VERSION).toBe(1);
  });

  it("normalises a typical Indian medication line under the medication preset", () => {
    const out = normalizeText("Tab. PCM 500mg BD x5d", "medication");
    expect(out).toContain("paracetamol");
    expect(out).toMatch(/500\s+mg/);
    expect(out).toContain("1-0-1");
    expect(out).toContain("5 d");
    expect(out).not.toMatch(/\btab\b/i);
  });

  it("leaves brands unmapped on a medication line by default", () => {
    const out = normalizeText("Dolo 650 OD", "medication");
    expect(out).toContain("dolo");
    expect(out).not.toContain("paracetamol");
    expect(out).toContain("1-0-0");
  });

  it("does not apply drug or frequency rules on lab-like fields preset text (OD risk)", () => {
    // Optical density "OD 0.5" must not become "1-0-0 0.5" under the general fields preset.
    const out = normalizeText("OD 0.5", "fields");
    expect(out).not.toContain("1-0-0");
  });

  it("pair normalisation is symmetric", () => {
    const a = normalizeForScoring("Tab. PCM 500MG", "PCM 500 mg", "medication");
    expect(a.prediction).toBe(a.reference);
  });

  it("normalizeField routes drug/unit/frequency to the drop-in functions", () => {
    expect(normalizeField("Tab. Augmentin", "drug")).toBe("augmentin");
    expect(normalizeField("g/dL", "unit")).toBe("g/dl");
    expect(normalizeField("BD", "frequency")).toBe("1-0-1");
    expect(normalizeField("x5d", "duration")).toBe("5 d");
    expect(normalizeField("12.50", "quantity")).toBe("12.5");
    expect(normalizeField("625 mg", "quantity")).toBe("625mg");
  });
});
