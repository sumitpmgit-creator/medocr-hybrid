import { describe, expect, it } from "vitest";
import { deidentify } from "../../src/deid/index.js";

// Synthetic clinical strings that must survive de-identification.

describe("deidentify negatives — clinical values must survive", () => {
  it("leaves doses and frequency schemes intact", () => {
    const t = "Tab Metformin 500 mg 1-0-1 x 30 days\nCap Amoxicillin 250 mg 1-1-1 after food\nSyp 2.5 ml BD";
    expect(deidentify(t).text).toBe(t);
    expect(deidentify(t).total).toBe(0);
  });

  it("leaves reference ranges, units and large lab counts intact", () => {
    const t =
      "Fasting Blood Sugar 118 mg/dL 70-110\n" +
      "HbA1c 6.4 % 4.0-5.6\n" +
      "Hemoglobin 13.2 g/dL 13.0-17.0\n" +
      "WBC 11500 /uL 4000-11000\n" +
      "Platelet Count 250000 /uL 150000-450000\n" +
      "Creatinine 1.1 mg/dL 0.7-1.3\n" +
      "TSH 2.5 uIU/mL 0.4-4.0";
    expect(deidentify(t).text).toBe(t);
  });

  it("replaces calendar dates with [DATE] but leaves ages in years", () => {
    const t = "Date: 12-11-2026  Collected: 20/11/2026  Reported 12 Nov 2026";
    const r = deidentify(t);
    expect(r.text).not.toMatch(/12-11-2026|20\/11\/2026|12 Nov 2026/);
    expect(r.text).toContain("[DATE]");
    expect(r.redactions.date).toBe(3);
    const age = "Age/Sex: 38Y/M  34Y/F  Age: 45 years";
    expect(deidentify(age).text).toBe(age);
  });

  it("leaves 10-digit-looking numbers that are not Indian mobiles", () => {
    const t = "Accession 1234567890  Lot 012345  Bill 5112233445";
    const r = deidentify(t);
    expect(r.text).toContain("1234567890");
    expect(r.text).toContain("5112233445");
    expect(r.redactions.phone ?? 0).toBe(0);
  });

  it("leaves drug names including ones that start with a capital letter", () => {
    const t = "Augmentin 625 mg, Zifi 200 mg, Dolo 650, Pan 40";
    expect(deidentify(t).text).toBe(t);
  });
});
