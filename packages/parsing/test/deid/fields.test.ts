import { describe, expect, it } from "vitest";
import { deidentifyFields } from "../../src/deid/index.js";

// Synthetic structured extraction — no real patient data.

describe("deidentifyFields", () => {
  it("scans rawText, wholesale-replaces known PII fields, and leaves clinical values", () => {
    const doc = {
      documentType: "prescription" as const,
      documentTypeConfidence: 0.9,
      rawText: "Patient: Priya Sharma  Mob: 9876543210\nTab Metformin 500 mg 1-0-1",
      patientName: "Priya Sharma",
      phone: "9876543210",
      medications: [
        { name: "Metformin", dose: "500 mg", frequency: "1-0-1", duration: "30 days", nameConfidence: 0.95 },
      ],
      labResults: [
        { test: "HbA1c", value: "6.4", unit: "%", referenceRange: "4.0-5.6", valueConfidence: 0.9 },
      ],
    };
    const { doc: out, redactions } = deidentifyFields(doc);
    expect(out.patientName).toBe("[NAME]");
    expect(out.phone).toBe("[PHONE]");
    expect(out.rawText).toContain("[NAME]");
    expect(out.rawText).toContain("[PHONE]");
    expect(out.rawText).toContain("Tab Metformin 500 mg 1-0-1");
    expect(out.medications[0]?.name).toBe("Metformin");
    expect(out.medications[0]?.dose).toBe("500 mg");
    expect(out.labResults[0]?.value).toBe("6.4");
    expect(out.labResults[0]?.referenceRange).toBe("4.0-5.6");
    expect(out.documentTypeConfidence).toBe(0.9);
    expect(redactions.some((r) => r.path === "patientName" && r.type === "name")).toBe(true);
    expect(redactions.some((r) => r.path === "phone" && r.type === "phone")).toBe(true);
    expect(redactions.some((r) => r.path === "rawText")).toBe(true);
    // Input is not mutated.
    expect(doc.patientName).toBe("Priya Sharma");
  });
});
