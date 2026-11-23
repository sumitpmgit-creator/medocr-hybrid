import { describe, expect, it } from "vitest";
import {
  assertSafeForCloud,
  deidentify,
  utf8Bytes,
  UnsafeForCloudError,
} from "../../handoff/core/deid.js";

// Guards the self-contained core drop-in against drift. Fixtures are synthetic.

const CORE_FIXTURE =
  "Patient Name: Ravi Kumar Sharma\nPh: +91 98765 43210\nABHA: 12-3456-7890-1234\nAadhaar 1234 5678 9012\nravi@abdm\nDr. Anil Mehta Reg. No: MCI/12345\nTab Dolo 650 BD";

describe("handoff/core/deid.ts drop-in", () => {
  it("passes core's deid-routing cases", () => {
    const r = deidentify(CORE_FIXTURE);
    expect(r.text).not.toMatch(/Ravi|98765|3456-7890|5678 9012|ravi@abdm|Anil|MCI\/12345/);
    expect(r.text).toContain("Tab Dolo 650 BD");
    expect(r.redactions.phone).toBe(1);
    expect(r.redactions.abha_number).toBe(1);
    expect(r.redactions.aadhaar).toBe(1);
    expect(r.total).toBeGreaterThanOrEqual(6);
    expect(utf8Bytes("दवा")).toBe(9);
    const lab = "Haemoglobin 12.5 g/dL 13.0-17.0\nPlatelets 250000 /cumm";
    expect(deidentify(lab).text).toBe(lab);
  });

  it("exports assertSafeForCloud and UnsafeForCloudError", () => {
    expect(() => assertSafeForCloud(deidentify(CORE_FIXTURE).text)).not.toThrow();
    expect(() => assertSafeForCloud("Call 9876543210")).toThrow(UnsafeForCloudError);
  });
});
