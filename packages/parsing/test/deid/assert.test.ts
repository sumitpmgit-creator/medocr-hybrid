import { describe, expect, it } from "vitest";
import { assertSafeForCloud, deidentify, UnsafeForCloudError } from "../../src/deid/index.js";

describe("assertSafeForCloud", () => {
  it("passes on already de-identified or clean clinical text", () => {
    expect(() => assertSafeForCloud(deidentify("Patient: Neha Gupta  Ph: +91 98765 43210").text)).not.toThrow();
    expect(() => assertSafeForCloud("Tab Metformin 500 mg 1-0-1\nHbA1c 6.4 % 4.0-5.6")).not.toThrow();
    expect(() => assertSafeForCloud("")).not.toThrow();
  });

  it("throws with residual spans when identifiers remain", () => {
    expect(() => assertSafeForCloud("Call 9876543210")).toThrow(UnsafeForCloudError);
    try {
      assertSafeForCloud("Call 9876543210");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeForCloudError);
      const err = e as UnsafeForCloudError;
      expect(err.findings.length).toBeGreaterThan(0);
      expect(err.findings[0]?.type).toBe("phone");
    }
  });
});
