// SPDX-License-Identifier: Apache-2.0
/** The handoff copy must stay a drop-in for the six field-scorer functions. */
import { describe, expect, it } from "vitest";
import * as parsing from "../../src/normalize/index.js";
import * as handoff from "../../handoff/core/normalize.ts";

const FNS = [
  "normalizeFrequency",
  "normalizeStrength",
  "normalizeUnit",
  "normalizeNumber",
  "normalizeName",
  "normalizeGeneric",
] as const;

const INPUTS: Array<string | null | undefined> = [
  null, undefined, "",
  "BD", "T.D.S.", "1 - 0 - 1", "twice daily", "OD", "HS", "SOS", "STAT", "1/2-0-1", "1/0/1", "1 0 1", "qds", "nocte",
  "625 mg", "5µg", "500 mg / 5 ml", "5 cc",
  "g/dL", "µg", "ug", "gm", "mg%", "cc", "mmol/L", "U", "cells/cu.mm",
  "12.50", "1,000", "1,5", ".5",
  "Tab. Augmentin", "T. PCM", "Tab. PCM 500mg",
  "  5   days  ", "x5d",
];

describe("handoff copy vs packages/parsing/src/normalize", () => {
  it("agrees on every field-scorer drop-in for a shared input grid", () => {
    for (const name of FNS) {
      for (const input of INPUTS) {
        const a = (parsing as Record<string, (v?: string | null) => string>)[name]!(input);
        const b = (handoff as Record<string, (v?: string | null) => string>)[name]!(input);
        expect(b, `${name}(${JSON.stringify(input)})`).toBe(a);
      }
    }
  });

  it("shares NORMALIZATION_VERSION", () => {
    expect(handoff.NORMALIZATION_VERSION).toBe(parsing.NORMALIZATION_VERSION);
  });
});
