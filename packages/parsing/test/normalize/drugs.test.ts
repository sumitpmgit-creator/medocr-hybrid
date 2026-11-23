// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  BRAND_ALIASES_COMPLETE,
  DRUG_ALIASES,
  DRUG_ALIASES_COMPLETE,
  editDistance,
  fuzzyMatchDrug,
  normalizeDrugName,
  normalizeName,
  normalizeText,
} from "../../src/normalize/index.js";

describe("drug names", () => {
  it("marks the alias tables as a seed list, not a complete formulary", () => {
    expect(DRUG_ALIASES_COMPLETE).toBe(false);
    expect(BRAND_ALIASES_COMPLETE).toBe(false);
    expect(DRUG_ALIASES.pcm).toBe("paracetamol");
    expect(DRUG_ALIASES.amox).toBe("amoxicillin");
  });

  it("strips dosage-form prefixes and suffixes, including T. and C. as tokens", () => {
    expect(normalizeDrugName("Tab. PCM 500mg").canonical).toBe("paracetamol 500 mg");
    expect(normalizeDrugName("T. PCM").name).toBe("paracetamol");
    expect(normalizeDrugName("C. Amox").name).toBe("amoxicillin");
    expect(normalizeDrugName("Paracetamol Tablets").name).toBe("paracetamol");
    expect(normalizeDrugName("Inj. Diclofenac").name).toBe("diclofenac");
    expect(normalizeDrugName("Syp. PCM").name).toBe("paracetamol");
  });

  it("does not strip a leading T/C that is part of the name (Taxim, Crocin)", () => {
    expect(normalizeDrugName("Taxim").name).toBe("taxim");
    expect(normalizeDrugName("Crocin").name).toBe("crocin");
  });

  it("separates and normalizes strength", () => {
    expect(normalizeDrugName("PCM 500mg").strength).toBe("500 mg");
    expect(normalizeDrugName("Amox 500 mg").canonical).toBe("amoxicillin 500 mg");
  });

  it("leaves brands unmapped unless mapBrands is on", () => {
    expect(normalizeDrugName("Dolo 650").name).toBe("dolo");
    expect(normalizeDrugName("Dolo 650", { mapBrands: true }).name).toBe("paracetamol");
  });

  it("normalizeName (drop-in) does not expand aliases or strip T./C.", () => {
    expect(normalizeName("Tab. PCM 500mg")).toBe("pcm 500mg");
    expect(normalizeName("T. PCM")).toBe("t pcm");
  });

  it("does not substitute a different ingredient", () => {
    expect(normalizeDrugName("PCM").name).not.toBe(normalizeDrugName("Amox").name);
  });

  it("fuzzy match is available but not applied by normalizeText", () => {
    const hit = fuzzyMatchDrug("paracetmol");
    expect(hit?.match).toBe("paracetamol");
    expect(hit?.distance).toBeGreaterThan(0);
    expect(fuzzyMatchDrug("pcm")?.distance).toBe(0);
    expect(fuzzyMatchDrug("am")).toBeNull();
    expect(normalizeText("paracetmol", "medication")).toContain("paracetmol");
  });

  it("edit distance is Levenshtein", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("pcm", "pcm")).toBe(0);
  });
});
