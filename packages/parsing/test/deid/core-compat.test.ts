import { describe, expect, it } from "vitest";
import { deidentify, utf8Bytes } from "../../src/deid/index.js";
import { deidentify as coreDeidentify, utf8Bytes as coreUtf8Bytes } from "../../../core/src/deid.js";

// These are the cases in packages/core/test/deid-routing.test.ts (and Louis's
// identical copy). All fixtures are synthetic.

const CORE_FIXTURE =
  "Patient Name: Ravi Kumar Sharma\nPh: +91 98765 43210\nABHA: 12-3456-7890-1234\nAadhaar 1234 5678 9012\nravi@abdm\nDr. Anil Mehta Reg. No: MCI/12345\nTab Dolo 650 BD";

describe("core compatibility (deid-routing.test.ts cases)", () => {
  it("redacts Indian identifiers", () => {
    const r = deidentify(CORE_FIXTURE);
    expect(r.text).not.toMatch(/Ravi|98765|3456-7890|5678 9012|ravi@abdm|Anil|MCI\/12345/);
    expect(r.text).toContain("Tab Dolo 650 BD");
    expect(r.redactions.phone).toBe(1);
    expect(r.redactions.abha_number).toBe(1);
    expect(r.redactions.aadhaar).toBe(1);
    expect(r.total).toBeGreaterThanOrEqual(6);
  });

  it("leaves lab values alone", () => {
    const t = "Haemoglobin 12.5 g/dL 13.0-17.0\nPlatelets 250000 /cumm";
    expect(deidentify(t).text).toBe(t);
  });

  it("counts bytes", () => {
    expect(utf8Bytes("दवा")).toBe(9);
    expect(utf8Bytes("दवा")).toBe(coreUtf8Bytes("दवा"));
  });

  it("covers every identifier core redacts, with the same placeholders", () => {
    const ours = deidentify(CORE_FIXTURE);
    const core = coreDeidentify(CORE_FIXTURE);
    expect(ours.redactions.phone).toBe(core.redactions.phone);
    expect(ours.redactions.abha_number).toBe(core.redactions.abha_number);
    expect(ours.redactions.aadhaar).toBe(core.redactions.aadhaar);
    expect(ours.redactions.abha_address ?? 0).toBeGreaterThanOrEqual(core.redactions.abha_address ?? 0);
    expect(ours.redactions.name ?? 0).toBeGreaterThanOrEqual(core.redactions.name ?? 0);
    expect(ours.redactions.reg_no ?? 0).toBeGreaterThanOrEqual(core.redactions.reg_no ?? 0);
    expect(ours.total).toBeGreaterThanOrEqual(core.total);
    expect(ours.text).toContain("[NAME]");
    expect(ours.text).toContain("[PHONE]");
    expect(ours.text).toContain("[ABHA_NUMBER]");
    expect(ours.text).toContain("[AADHAAR]");
    expect(ours.text).toContain("[ABHA_ADDRESS]");
    expect(ours.text).toContain("[REG_NO]");
    // Improvement over core: do not swallow the 'Ph' label or 'Reg' into the name.
    expect(ours.text).toMatch(/Ph:\s*\[PHONE\]/);
    expect(ours.text).toMatch(/Reg\. No:\s*\[REG_NO\]/);
    expect(ours.text).toContain("Tab Dolo 650 BD");
  });
});
