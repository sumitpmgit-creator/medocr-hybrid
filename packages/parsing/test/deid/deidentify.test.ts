import { describe, expect, it } from "vitest";
import { deidentify, PLACEHOLDERS } from "../../src/deid/index.js";

// All fixtures are synthetic. No real patient data.

describe("deidentify positives", () => {
  it("redacts labelled patient and doctor names and records original offsets", () => {
    const input = "Patient: Priya Sharma\nAge: 32/F";
    const r = deidentify(input);
    expect(r.text).toContain("Patient: [NAME]");
    expect(r.text).toContain("Age: 32/F");
    expect(r.redactions.name).toBe(1);
    const span = r.spans?.find((s) => s.type === "name");
    expect(span).toBeDefined();
    expect(input.slice(span!.start, span!.end)).toBe("Priya Sharma");
  });

  it("redacts titled names including Indian honorifics and S/o, D/o, W/o", () => {
    const input = "Mr. Rohit Verma, S/o Suresh Verma, D/o not used, W/o unused\nSmt. Kavita Nair\nShri Amit Joshi";
    const r = deidentify(input);
    expect(r.text).not.toMatch(/Rohit|Suresh|Kavita|Amit Joshi/);
    expect(r.redactions.name).toBeGreaterThanOrEqual(4);
  });

  it("redacts Hindi and Bangla labelled names", () => {
    const input = "नाम: राहुल शर्मा\nরোগীর নাম: সুমন দাস";
    const r = deidentify(input);
    expect(r.text).toContain("[NAME]");
    expect(r.text).not.toMatch(/राहुल|সুমন/);
    expect(r.redactions.name).toBe(2);
  });

  it("redacts ABHA numbers in grouped, labelled and contiguous forms, and ABHA addresses", () => {
    const input =
      "ABHA: 12-3456-7890-1234\nABHA 12345678901234\npriya.sharma@abdm and test.user@sbx";
    const r = deidentify(input);
    expect(r.text).toContain("[ABHA_NUMBER]");
    expect(r.text).toContain("[ABHA_ADDRESS]");
    expect(r.text).not.toMatch(/3456-7890|12345678901234|priya\.sharma@abdm|test\.user@sbx/);
    expect(r.redactions.abha_number).toBeGreaterThanOrEqual(2);
    expect(r.redactions.abha_address).toBe(2);
  });

  it("redacts Aadhaar in 4-4-4, labelled, and 12-digit forms (core behavior)", () => {
    const input = "Aadhaar 1234 5678 9012\nUID: 999988887777\nplain 444433332222";
    const r = deidentify(input);
    expect(r.text).toContain("[AADHAAR]");
    expect(r.text).not.toMatch(/1234 5678 9012|999988887777|444433332222/);
    expect(r.redactions.aadhaar).toBe(3);
  });

  it("does not split a 14-digit ABHA into Aadhaar", () => {
    const r = deidentify("ABHA 12-3456-7890-1234");
    expect(r.redactions.abha_number).toBe(1);
    expect(r.redactions.aadhaar ?? 0).toBe(0);
  });

  it("redacts Indian mobiles: +91, 0-prefix, 10-digit, spaced or dashed", () => {
    const input = "+91 98765 43210, 09876543211, 98765-43212, 8877665544";
    const r = deidentify(input);
    expect(r.text).not.toMatch(/98765|8877665544|09876543211/);
    expect(r.redactions.phone).toBe(4);
    expect(r.text).toContain("[PHONE]");
  });

  it("redacts landlines with STD codes", () => {
    const input = "Tel: 011-23456789 and 080 1234 5678";
    const r = deidentify(input);
    expect(r.text).toContain("[PHONE]");
    expect(r.text).not.toMatch(/23456789|1234 5678/);
  });

  it("redacts emails but classifies @abdm / @sbx as ABHA addresses", () => {
    const input = "Write to anil.mehta@example.com or anil@abdm";
    const r = deidentify(input);
    expect(r.text).toContain("[EMAIL]");
    expect(r.text).toContain("[ABHA_ADDRESS]");
    expect(r.text).not.toContain("example.com");
    expect(r.redactions.email).toBe(1);
    expect(r.redactions.abha_address).toBe(1);
  });

  it("redacts doctor registration numbers and labelled UHID/MRN as [REG_NO] and [ID]", () => {
    const input = "Reg. No. MH/12345/2010\nNMC 998877\nUHID: KEM-112233\nMRN: 556677";
    const r = deidentify(input);
    expect(r.text).toContain("[REG_NO]");
    expect(r.text).toContain("[ID]");
    expect(r.text).not.toMatch(/MH\/12345\/2010|998877|KEM-112233|556677/);
    expect(r.redactions.reg_no).toBeGreaterThanOrEqual(2);
    expect(r.redactions.uhid).toBe(2);
    expect(r.text).not.toContain("[UHID]");
  });

  it("redacts labelled addresses and PIN codes, leaving isolated 6-digit lab counts", () => {
    const input =
      "Address: Flat 3B, Green Park, New Delhi - 110016\n\nPIN: 411001\nPlatelet Count 250000";
    const r = deidentify(input);
    expect(r.text).toContain("[ADDRESS]");
    expect(r.text).toContain("[PIN]");
    expect(r.text).toContain("250000");
    expect(r.text).not.toMatch(/110016|411001|Green Park/);
  });

  it("skips manufacturer names like Dr. Reddy's Laboratories", () => {
    const input = "Manufacturer: Dr. Reddy's Laboratories\nTab Metformin 500 mg";
    const r = deidentify(input);
    expect(r.text).toContain("Dr. Reddy's Laboratories");
    expect(r.text).toContain("Tab Metformin 500 mg");
  });

  it("does not treat a medicine line 'Name: Amoxicillin 500 mg' as a patient", () => {
    const input = "Name: Amoxicillin 500 mg";
    const r = deidentify(input);
    expect(r.text).toContain("Amoxicillin");
    expect(r.redactions.name ?? 0).toBe(0);
  });

  it("is idempotent and exposes core-compatible counts plus spans", () => {
    const input = "Patient Name: Neha Gupta  Mob: 9123456780";
    const once = deidentify(input);
    const twice = deidentify(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.total).toBe(0);
    expect(once.total).toBe(Object.values(once.redactions).reduce((a, b) => a + (b ?? 0), 0));
    expect(once.spans?.length).toBe(once.total);
    expect(PLACEHOLDERS.uhid).toBe("[ID]");
    expect(PLACEHOLDERS.abha_number).toBe("[ABHA_NUMBER]");
  });
});
