// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  NANO_DOCUMENT_TYPES,
  NANO_EXTRACTION_PROMPT,
  NANO_RESPONSE_SCHEMA,
  extractJsonText,
  parseNanoOutput,
  toClinicalFields,
} from "../../src/extraction/index.js";

const prescription = {
  documentType: "prescription",
  documentTypeConfidence: 0.94,
  rawText: "Tab Amoxicillin 500 mg 1-0-1 x 5 days",
  medications: [
    {
      name: "Amoxicillin",
      nameConfidence: 0.93,
      dose: "500 mg",
      doseConfidence: 0.91,
      frequency: "1-0-1",
      frequencyConfidence: 0.88,
      duration: "5 days",
      durationConfidence: 0.8,
    },
  ],
  labResults: [],
};

const labReport = {
  documentType: "lab_report",
  documentTypeConfidence: 0.97,
  rawText: "HbA1c 7.2 % (4.0-5.6)",
  medications: [],
  labResults: [
    {
      test: "HbA1c",
      testConfidence: 0.95,
      value: "7.2",
      valueConfidence: 0.96,
      unit: "%",
      unitConfidence: 0.9,
      referenceRange: "4.0-5.6",
      referenceRangeConfidence: 0.86,
    },
  ],
};

describe("NANO_EXTRACTION_PROMPT", () => {
  it("mentions the required fields and the no-inference rule", () => {
    expect(NANO_EXTRACTION_PROMPT).toContain("documentType");
    expect(NANO_EXTRACTION_PROMPT).toContain("medications");
    expect(NANO_EXTRACTION_PROMPT).toContain("labResults");
    expect(NANO_EXTRACTION_PROMPT).toContain("referenceRange");
    expect(NANO_EXTRACTION_PROMPT).toMatch(/do not infer/i);
    expect(NANO_EXTRACTION_PROMPT).toContain("null");
  });
});

describe("NANO_RESPONSE_SCHEMA", () => {
  it("is a small plain object suitable for responseConstraint", () => {
    expect(NANO_RESPONSE_SCHEMA.type).toBe("object");
    expect(NANO_RESPONSE_SCHEMA.additionalProperties).toBe(false);
    expect(NANO_RESPONSE_SCHEMA.properties.documentType.enum).toEqual([...NANO_DOCUMENT_TYPES]);
    expect(NANO_RESPONSE_SCHEMA.properties.documentType.enum).toHaveLength(3);
    const encoded = JSON.stringify(NANO_RESPONSE_SCHEMA);
    expect(encoded).not.toContain("$ref");
    expect(encoded).not.toContain("oneOf");
    expect(encoded).not.toContain("anyOf");
    expect(encoded).not.toContain("allOf");
    expect(encoded).not.toContain("maxLength");
    expect(encoded).not.toContain('"pattern"');
  });
});

describe("parseNanoOutput", () => {
  it("accepts a clean prescription object", () => {
    const result = parseNanoOutput(JSON.stringify(prescription));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documentType).toBe("prescription");
    expect(result.value.medications[0]?.name).toBe("Amoxicillin");
    expect(result.value.medications[0]?.frequency).toBe("1-0-1");
    expect(result.value.labResults).toEqual([]);
    expect(result.stripped).toEqual([]);
  });

  it("accepts a clean lab report object", () => {
    const result = parseNanoOutput(JSON.stringify(labReport));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documentType).toBe("lab_report");
    expect(result.value.labResults[0]?.referenceRange).toBe("4.0-5.6");
  });

  it("accepts other with empty arrays and null rawText", () => {
    const result = parseNanoOutput(
      JSON.stringify({
        documentType: "other",
        documentTypeConfidence: 0.6,
        rawText: null,
        medications: [],
        labResults: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rawText).toBeNull();
    expect(result.value.medications).toEqual([]);
  });

  it("strips markdown fences and trailing chatter", () => {
    const raw = `Sure, here is the JSON:\n\`\`\`json\n${JSON.stringify(prescription)}\n\`\`\`\nLet me know if you need more.`;
    const result = parseNanoOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.medications[0]?.dose).toBe("500 mg");
  });

  it("accepts an unclosed fence and leading BOM", () => {
    const raw = `\uFEFF\`\`\`json\n${JSON.stringify(labReport)}\n`;
    const result = parseNanoOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.labResults[0]?.test).toBe("HbA1c");
  });

  it("coerces documentType aliases and numeric confidence strings", () => {
    const raw = JSON.stringify({
      documentType: "Laboratory Report",
      documentTypeConfidence: "0.5",
      rawText: "CBC",
      medications: [],
      labResults: [
        {
          test: "Hb",
          testConfidence: "1",
          value: "12",
          valueConfidence: 0.8,
          unit: "g/dL",
          unitConfidence: 0.7,
          referenceRange: null,
          referenceRangeConfidence: 0.4,
        },
      ],
    });
    const result = parseNanoOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documentType).toBe("lab_report");
    expect(result.value.documentTypeConfidence).toBe(0.5);
    expect(result.value.labResults[0]?.testConfidence).toBe(1);
    expect(result.value.labResults[0]?.referenceRange).toBeNull();
  });

  it("maps discharge_summary to other to stay on the Nano enum", () => {
    const result = parseNanoOutput(
      JSON.stringify({
        documentType: "discharge_summary",
        documentTypeConfidence: 0.8,
        rawText: "Admitted for...",
        medications: [],
        labResults: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documentType).toBe("other");
  });

  it("strips unknown properties instead of failing", () => {
    const result = parseNanoOutput(
      JSON.stringify({
        ...prescription,
        extra: true,
        medications: [{ ...prescription.medications[0], genericName: "amoxicillin" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stripped).toEqual(["extra", "medications[0].genericName"]);
    expect(result.value.medications[0]).not.toHaveProperty("genericName");
  });

  it("keeps null medication fields when the name is unreadable", () => {
    const result = parseNanoOutput(
      JSON.stringify({
        documentType: "prescription",
        documentTypeConfidence: 0.7,
        rawText: "illegible script",
        medications: [
          {
            name: null,
            nameConfidence: 0.2,
            dose: null,
            doseConfidence: 0.15,
            frequency: null,
            frequencyConfidence: 0.1,
            duration: null,
            durationConfidence: 0.1,
          },
        ],
        labResults: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.medications[0]?.name).toBeNull();
    const fields = toClinicalFields(result.value);
    expect(fields.medications).toEqual([]);
  });

  it("rejects empty input and non-strings", () => {
    const empty = parseNanoOutput("   ");
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.errors[0]?.code).toBe("empty_input");

    const notString = parseNanoOutput({ documentType: "other" });
    expect(notString.ok).toBe(false);
    if (notString.ok) return;
    expect(notString.errors[0]?.code).toBe("type_error");
  });

  it("rejects chatter with no JSON object", () => {
    const result = parseNanoOutput("I cannot read this image clearly.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("not_json");
  });

  it("rejects truncated JSON", () => {
    const result = parseNanoOutput('{"documentType": "prescription", "medications": [');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("not_json");
  });

  it("rejects a JSON array or invalid JSON with a structured error", () => {
    const arr = parseNanoOutput("[]");
    expect(arr.ok).toBe(false);
    if (arr.ok) return;
    expect(arr.errors[0]?.code).toBe("not_json");

    const trailingComma = parseNanoOutput('{"documentType": "other",}');
    expect(trailingComma.ok).toBe(false);
    if (trailingComma.ok) return;
    expect(trailingComma.errors[0]?.code).toBe("parse_error");
  });

  it("rejects missing required fields, bad enums, and out-of-range confidence", () => {
    const missing = parseNanoOutput(JSON.stringify({ documentType: "other", medications: [], labResults: [] }));
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    const codes = missing.errors.map((e) => e.code);
    expect(codes).toContain("missing_field");
    expect(missing.errors.some((e) => e.path === "documentTypeConfidence")).toBe(true);
    expect(missing.errors.some((e) => e.path === "rawText")).toBe(true);

    const badEnum = parseNanoOutput(
      JSON.stringify({
        documentType: "rx",
        documentTypeConfidence: 0.9,
        rawText: null,
        medications: [],
        labResults: [],
      }),
    );
    expect(badEnum.ok).toBe(false);
    if (badEnum.ok) return;
    expect(badEnum.errors[0]?.code).toBe("invalid_enum");

    const high = parseNanoOutput(
      JSON.stringify({
        documentType: "other",
        documentTypeConfidence: 1.5,
        rawText: null,
        medications: [],
        labResults: [],
      }),
    );
    expect(high.ok).toBe(false);
    if (high.ok) return;
    expect(high.errors[0]?.code).toBe("out_of_range");
  });

  it("rejects the wrong types for medications and lab results", () => {
    const result = parseNanoOutput(
      JSON.stringify({
        documentType: "other",
        documentTypeConfidence: 0.9,
        rawText: "note",
        medications: { name: "x" },
        labResults: "none",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === "medications" && e.code === "type_error")).toBe(true);
    expect(result.errors.some((e) => e.path === "labResults" && e.code === "type_error")).toBe(true);
  });
});

describe("extractJsonText", () => {
  it("extracts the first balanced object when braces appear in a string", () => {
    const text = 'prefix {"documentType": "other", "rawText": "has } brace", "medications": [], "labResults": []} trailing';
    const extracted = extractJsonText(text);
    expect("text" in extracted).toBe(true);
    if ("errors" in extracted) return;
    expect(JSON.parse(extracted.text).rawText).toBe("has } brace");
  });
});

describe("toClinicalFields", () => {
  it("uses the minimum per-field confidence and drops rows without a name or test/value", () => {
    const parsed = parseNanoOutput(
      JSON.stringify({
        documentType: "prescription",
        documentTypeConfidence: 0.9,
        rawText: "mix",
        medications: [
          {
            name: "A",
            nameConfidence: 0.9,
            dose: "10 mg",
            doseConfidence: 0.4,
            frequency: null,
            frequencyConfidence: 0.8,
            duration: null,
            durationConfidence: 0.8,
          },
          {
            name: null,
            nameConfidence: 0.1,
            dose: "2 mg",
            doseConfidence: 0.9,
            frequency: null,
            frequencyConfidence: 0.5,
            duration: null,
            durationConfidence: 0.5,
          },
        ],
        labResults: [
          {
            test: "Na",
            testConfidence: 0.9,
            value: null,
            valueConfidence: 0.2,
            unit: "mmol/L",
            unitConfidence: 0.9,
            referenceRange: null,
            referenceRangeConfidence: 0.3,
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fields = toClinicalFields(parsed.value);
    expect(fields.medications).toHaveLength(1);
    expect(fields.medications[0]?.confidence).toBe(0.4);
    expect(fields.labResults).toHaveLength(0);
  });
});
