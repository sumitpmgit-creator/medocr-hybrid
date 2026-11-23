import { describe, expect, it } from "vitest";
import { assertSafeForCloud, deidentify } from "../../src/deid/index.js";

// Realistic but fully synthetic prescription and lab-report texts.

const PRESCRIPTION = `
Dr. Anil Mehta
MBBS, MD
Reg. No. MH/12345/2010
Mehta Clinic, 14 MG Road, Pune - 411001
Ph: +91 98765 43210
Email: anil.mehta@example.com

Patient: Priya Sharma
D/o Rajesh Sharma
Age/Sex: 32/F
ABHA: 12-3456-7890-1234
ABHA Address: priya.sharma@abdm
Mob: 09876543211
Address: Flat 3B, Green Park, New Delhi - 110016

Rx
1. Tab Metformin 500 mg 1-0-1 x 30 days
2. Cap Amoxicillin 250 mg 1-1-1 x 5 days after food
Date: 12-11-2026
`.trim();

const LAB_REPORT = `
Patient Name: Amit Patel
UHID: KEM-998877
Age: 54/M
Phone: 9123456780
Address: 22 Andheri West, Mumbai - 400053

Lab Report
Date: 20/11/2026
Fasting Blood Sugar    118 mg/dL    70-110
HbA1c                  6.4 %        4.0-5.6
Hemoglobin             13.2 g/dL    13.0-17.0
WBC                    11500 /uL    4000-11000
Platelet Count         250000 /uL   150000-450000
Creatinine             1.1 mg/dL    0.7-1.3
TSH                    2.5 uIU/mL   0.4-4.0
`.trim();

describe("synthetic documents", () => {
  it("redacts PII on a prescription while keeping drugs, doses and the date", () => {
    const r = deidentify(PRESCRIPTION);
    expect(r.text).not.toMatch(/Anil Mehta|Priya Sharma|Rajesh Sharma|98765 43210|09876543211|12-3456-7890|priya\.sharma@abdm|anil\.mehta@example|110016|411001|Green Park|MH\/12345/);
    expect(r.text).toContain("Tab Metformin 500 mg 1-0-1 x 30 days");
    expect(r.text).toContain("Cap Amoxicillin 250 mg 1-1-1 x 5 days after food");
    expect(r.text).toContain("Date: [DATE]");
    expect(r.text).toContain("Age/Sex: 32/F");
    expect(r.text).toContain("[NAME]");
    expect(r.text).toContain("[PHONE]");
    expect(r.text).toContain("[ABHA_NUMBER]");
    expect(r.text).toContain("[ABHA_ADDRESS]");
    expect(r.text).toContain("[EMAIL]");
    expect(r.text).toContain("[REG_NO]");
    expect(r.text).toContain("[ADDRESS]");
    expect(() => assertSafeForCloud(r.text)).not.toThrow();
  });

  it("redacts PII on a lab report while keeping values, units, ranges and the date", () => {
    const r = deidentify(LAB_REPORT);
    expect(r.text).not.toMatch(/Amit Patel|KEM-998877|9123456780|400053|Andheri/);
    expect(r.text).toContain("118 mg/dL");
    expect(r.text).toContain("70-110");
    expect(r.text).toContain("250000");
    expect(r.text).toContain("150000-450000");
    expect(r.text).toContain("11500");
    expect(r.text).toContain("Date: [DATE]");
    expect(r.text).toContain("[NAME]");
    expect(r.text).toContain("[ID]");
    expect(r.text).toContain("[PHONE]");
    expect(r.text).toContain("[ADDRESS]");
    expect(() => assertSafeForCloud(r.text)).not.toThrow();
  });
});
