import { describe, expect, it } from "vitest";
import { assertSafeForCloud, deidentify, UnsafeForCloudError } from "../../src/deid/index.js";

// Synthetic fixtures covering BUG-001, BUG-002 and BUG-004. No real patient data.

describe("BUG-001 / BUG-002 identifiers", () => {
  const cases: [string, string, string][] = [
    ["DOB slash", "DOB: 14/03/1987", "14/03/1987"],
    ["Born on words", "Born on 14th March 1987", "14th March 1987"],
    ["D.O.B ISO", "D.O.B 1987-03-14", "1987-03-14"],
    ["dob dotted short", "dob 14.03.87", "14.03.87"],
    ["spaced PIN", "Hyderabad 500 080", "500 080"],
    ["full-width mobile", "Mobile：９８７６５４３２１０", "９８７６５４３２１０"],
    ["Devanagari mobile", "फ़ोन ९८७६५४३२१०", "९८७६५४३२१०"],
    ["glued phone", "Callon9876543210forreports", "9876543210"],
    ["Devanagari labelled name", "रोगी: अनीता शर्मा", "अनीता शर्मा"],
    ["lowercase unlabelled names", "sunita devi w/o ramesh yadav", "sunita devi"],
    ["hospital number", "Hospital number: 2023/BF/057", "2023/BF/057"],
    ["dotted Aadhaar", "UID:2345.6789.0123", "2345.6789.0123"],
    ["PAN any case", "PAN abcpk1234f", "abcpk1234f"],
    ["ALL-CAPS PT", "PT: MRS. ANANYA IYER", "ANANYA IYER"],
    ["obfuscated email", "mail: rajesh.kumar87 [at] gmail [dot] com", "rajesh.kumar87"],
    ["leading-0 phone", "Contact 098765-43210", "098765-43210"],
    ["digit-pair phone", "Ph 98 76 54 32 10 (home)", "98 76 54 32 10"],
    ["STD landline", "Tel: +91-80-2345-6789", "80-2345-6789"],
  ];

  it.each(cases)("redacts %s", (_title, input, leak) => {
    const r = deidentify(input);
    expect(r.text.toLowerCase()).not.toContain(leak.toLowerCase());
    expect(() => assertSafeForCloud(r.text)).not.toThrow();
    expect(() => assertSafeForCloud(input)).toThrow(UnsafeForCloudError);
  });
});

describe("BUG-004 name does not cross the newline", () => {
  it("leaves the next-line lab result intact", () => {
    const input = "Patient Name: Rajesh Kumar\nHemoglobin 13.5 g/dL";
    const r = deidentify(input);
    expect(r.text).toContain("[NAME]");
    expect(r.text).not.toContain("Rajesh");
    expect(r.text).toContain("Hemoglobin 13.5 g/dL");
  });
});
