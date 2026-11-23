// SPDX-License-Identifier: Apache-2.0
/**
 * Goldens ported from packages/core/src/normalize.ts (and Louis's identical
 * copy on louis/core-hardening). These must keep passing so a later swap
 * into core does not move field scores.
 *
 * Documented output differences vs core are in the second describe block.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeFrequency,
  normalizeGeneric,
  normalizeName,
  normalizeNumber,
  normalizeStrength,
  normalizeUnit,
} from "../../src/normalize/index.js";

describe("core-compatible normalizeFrequency", () => {
  it("maps the abbreviations the field-scorer test relies on", () => {
    expect(normalizeFrequency("BD")).toBe("1-0-1");
    expect(normalizeFrequency("twice daily")).toBe("1-0-1");
    expect(normalizeFrequency("1 - 0 - 1")).toBe("1-0-1");
    expect(normalizeFrequency("T.D.S.")).toBe("1-1-1");
  });

  it("matches core goldens for the shared table and dashed patterns", () => {
    const goldens: [string | null | undefined, string][] = [
      [null, ""],
      [undefined, ""],
      ["", ""],
      ["BD", "1-0-1"],
      ["bd", "1-0-1"],
      ["B.D.", "1-0-1"],
      ["bid", "1-0-1"],
      ["B.I.D.", "1-0-1"],
      ["twice daily", "1-0-1"],
      ["twice a day", "1-0-1"],
      ["1 - 0 - 1", "1-0-1"],
      ["1-0-1", "1-0-1"],
      ["1–0–1", "1-0-1"],
      ["1 x 0 x 1", "1-0-1"],
      ["T.D.S.", "1-1-1"],
      ["TDS", "1-1-1"],
      ["TID", "1-1-1"],
      ["thrice daily", "1-1-1"],
      ["three times a day", "1-1-1"],
      ["OD", "1-0-0"],
      ["QD", "1-0-0"],
      ["once daily", "1-0-0"],
      ["once a day", "1-0-0"],
      ["daily", "1-0-0"],
      ["1-0-0", "1-0-0"],
      ["0-0-1", "0-0-1"],
      ["QID", "1-1-1-1"],
      ["four times a day", "1-1-1-1"],
      ["1-1-1-1", "1-1-1-1"],
      ["HS", "0-0-1"],
      ["at night", "0-0-1"],
      ["at bedtime", "0-0-1"],
      ["SOS", "sos"],
      ["PRN", "sos"],
      ["as needed", "sos"],
      ["STAT", "stat"],
      ["stat", "stat"],
      ["1/2-0-1", "1/2-0-1"],
      ["2-2-2", "2-2-2"],
      ["0-0-2", "0-0-2"],
      ["1-1-1", "1-1-1"],
      ["  BD  ", "1-0-1"],
    ];
    for (const [input, expected] of goldens) {
      expect(normalizeFrequency(input), String(input)).toBe(expected);
    }
  });

  it("does not equate distinct tablet-count patterns", () => {
    expect(normalizeFrequency("0-0-1")).not.toBe(normalizeFrequency("1-0-1"));
    expect(normalizeFrequency("1-0-0")).not.toBe(normalizeFrequency("1-0-1"));
    expect(normalizeFrequency("1-0-1")).not.toBe(normalizeFrequency("1-1-1"));
    expect(normalizeFrequency("STAT")).not.toBe(normalizeFrequency("SOS"));
  });
});

describe("core-compatible normalizeStrength / normalizeUnit / normalizeNumber / names", () => {
  it("strength ignores spacing and unit spelling (field-scorer test)", () => {
    expect(normalizeStrength("625 mg")).toBe(normalizeStrength("625MG"));
    expect(normalizeStrength("5 mcg")).toBe(normalizeStrength("5µg"));
  });

  it("matches core strength goldens (compact, no inserted spaces)", () => {
    const goldens: [string | null, string][] = [
      [null, ""],
      ["", ""],
      ["625 mg", "625mg"],
      ["625MG", "625mg"],
      ["625mg", "625mg"],
      ["5 mcg", "5mcg"],
      ["5µg", "5mcg"],
      ["5ug", "5mcg"],
      ["500mg/5ml", "500mg/5ml"],
      ["500 mg / 5 ml", "500mg/5ml"],
      ["10 IU", "10iu"],
      ["1 g", "1g"],
      ["1 gm", "1g"],
      ["1 gms", "1g"],
      ["5 mgs", "5mg"],
      ["5 milligrams", "5mg"],
    ];
    for (const [input, expected] of goldens) {
      expect(normalizeStrength(input), String(input)).toBe(expected);
    }
  });

  it("matches core unit goldens that this superset does not change", () => {
    const goldens: [string | null, string][] = [
      [null, ""],
      ["", ""],
      ["g/dL", "g/dl"],
      ["g/dl", "g/dl"],
      ["g / dL", "g/dl"],
      ["mg/dL", "mg/dl"],
      ["mg", "mg"],
      ["mgs", "mg"],
      ["milligram", "mg"],
      ["milligrams", "mg"],
      ["mcg", "mcg"],
      ["ml", "ml"],
      ["mL", "ml"],
      ["ML", "ml"],
      ["IU", "iu"],
      ["iu", "iu"],
      ["U", "u"],
      ["mmol/L", "mmol/l"],
      ["  mg  ", "mg"],
    ];
    for (const [input, expected] of goldens) {
      expect(normalizeUnit(input), String(input)).toBe(expected);
    }
  });

  it("matches core number goldens, including the 1,5 → 15 comma strip", () => {
    const goldens: [string | null, string][] = [
      [null, ""],
      ["", ""],
      ["12.50", "12.5"],
      ["12.5", "12.5"],
      ["1,000", "1000"],
      ["1,00,000", "100000"],
      ["1,5", "15"],
      [".5", "0.5"],
      ["0.5", "0.5"],
      ["1.0", "1"],
      ["-3", "-3"],
      ["−3", "-3"],
      ["12.50 ", "12.5"],
      ["abc", "abc"],
      ["12mg", "12mg"],
    ];
    for (const [input, expected] of goldens) {
      expect(normalizeNumber(input), String(input)).toBe(expected);
    }
  });

  it("matches core name and generic goldens (no alias expansion)", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName("Tab. Augmentin")).toBe("augmentin");
    expect(normalizeName("TAB Augmentin")).toBe("augmentin");
    expect(normalizeName("tablet Augmentin")).toBe("augmentin");
    expect(normalizeName("Cap. Amox")).toBe("amox");
    expect(normalizeName("Syp. Zedex")).toBe("zedex");
    expect(normalizeName("Inj. Diclofenac")).toBe("diclofenac");
    expect(normalizeName("PAN")).toBe("pan");
    expect(normalizeName("Augmentin")).toBe("augmentin");
    expect(normalizeName("T. PCM")).toBe("t pcm");
    expect(normalizeName("C. Amox")).toBe("c amox");
    expect(normalizeName("Tab. PCM 500mg")).toBe("pcm 500mg");
    expect(normalizeName("Haemoglobin")).toBe("haemoglobin");
    expect(normalizeGeneric(null)).toBe("");
    expect(normalizeGeneric("  5   days  ")).toBe("5 days");
    expect(normalizeGeneric("Oral")).toBe("oral");
    expect(normalizeGeneric("ORAL")).toBe("oral");
    expect(normalizeGeneric("x5d")).toBe("x5d");
  });

  it("does not change magnitude", () => {
    expect(normalizeStrength("5 mg")).not.toBe(normalizeStrength("50 mg"));
    expect(normalizeNumber("12.5")).not.toBe(normalizeNumber("1.25"));
  });
});

describe("documented differences vs packages/core/src/normalize.ts", () => {
  it("frequency: slash- and space-separated schedules collapse to dashed form", () => {
    // core returns "1/0/1" and "1 0 1" unchanged
    expect(normalizeFrequency("1/0/1")).toBe("1-0-1");
    expect(normalizeFrequency("1 0 1")).toBe("1-0-1");
    expect(normalizeFrequency("1 / 0 / 1")).toBe("1-0-1");
  });

  it("frequency: extra synonyms that core leaves untouched", () => {
    expect(normalizeFrequency("qds")).toBe("1-1-1-1");
    expect(normalizeFrequency("nocte")).toBe("0-0-1");
    expect(normalizeFrequency("bedtime")).toBe("0-0-1");
    expect(normalizeFrequency("three times daily")).toBe("1-1-1");
    expect(normalizeFrequency("if needed")).toBe("sos");
  });

  it("frequency: 1/2-0-1 is still preserved (slash is a dose, not a separator)", () => {
    expect(normalizeFrequency("1/2-0-1")).toBe("1/2-0-1");
  });

  it("unit: micro, gram abbreviations, mg%, cc, and cell-count variants", () => {
    // core: "µg" / "μg" → "µg"; "ug" stays "ug"
    expect(normalizeUnit("µg")).toBe("mcg");
    expect(normalizeUnit("μg")).toBe("mcg");
    expect(normalizeUnit("ug")).toBe("mcg");
    // core: "gm" / "gms" stay "gm" / "gms" (strength already maps them to g)
    expect(normalizeUnit("gm")).toBe("g");
    expect(normalizeUnit("gms")).toBe("g");
    // core: "mg%" stays "mg%"; "cc" stays "cc"
    expect(normalizeUnit("mg%")).toBe("mg/dl");
    expect(normalizeUnit("g%")).toBe("g/dl");
    expect(normalizeUnit("cc")).toBe("ml");
    expect(normalizeUnit("cells/cu.mm")).toBe("cells/cumm");
    expect(normalizeUnit("/µL")).toBe("/ul");
    expect(normalizeUnit("percent")).toBe("%");
  });

  it("strength: cc maps to ml (core leaves 5cc as 5cc)", () => {
    expect(normalizeStrength("5 cc")).toBe("5ml");
    expect(normalizeStrength("5cc")).toBe("5ml");
  });

  it("does not convert mg/dL to mmol/L", () => {
    expect(normalizeUnit("mg/dL")).toBe("mg/dl");
    expect(normalizeUnit("mmol/L")).toBe("mmol/l");
    expect(normalizeUnit("mg/dL")).not.toBe(normalizeUnit("mmol/L"));
  });
});
