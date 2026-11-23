// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOUD_ROUTE_THRESHOLD,
  fieldsBelowThreshold,
  type NanoExtraction,
} from "../../src/extraction/index.js";

const sample: NanoExtraction = {
  documentType: "prescription",
  documentTypeConfidence: 0.95,
  rawText: "Amoxicillin 500 mg 1-0-1 x 5 days; HbA1c 7.2",
  medications: [
    {
      name: "Amoxicillin",
      nameConfidence: 0.93,
      dose: "500 mg",
      doseConfidence: 0.55,
      frequency: "1-0-1",
      frequencyConfidence: 0.4,
      duration: "5 days",
      durationConfidence: 0.8,
    },
  ],
  labResults: [
    {
      test: "HbA1c",
      testConfidence: 0.9,
      value: "7.2",
      valueConfidence: 0.92,
      unit: "%",
      unitConfidence: 0.69,
      referenceRange: null,
      referenceRangeConfidence: 0.85,
    },
  ],
};

describe("fieldsBelowThreshold", () => {
  it("routes only fields under the default 0.7 cutoff", () => {
    expect(DEFAULT_CLOUD_ROUTE_THRESHOLD).toBe(0.7);
    const routed = fieldsBelowThreshold(sample);
    expect(routed.map((f) => f.path)).toEqual([
      "medications[0].dose",
      "medications[0].frequency",
      "labResults[0].unit",
    ]);
    expect(routed[0]?.context).toMatchObject({ name: "Amoxicillin", dose: "500 mg" });
    expect(routed[1]?.confidence).toBe(0.4);
  });

  it("returns an empty list when every field meets a lower threshold", () => {
    expect(fieldsBelowThreshold(sample, { threshold: 0.3 })).toEqual([]);
  });

  it("includes documentType when its confidence is low", () => {
    const routed = fieldsBelowThreshold(
      { ...sample, documentType: "other", documentTypeConfidence: 0.2 },
      { threshold: 0.5 },
    );
    expect(routed[0]).toMatchObject({ path: "documentType", value: "other", confidence: 0.2 });
  });

  it("does not route high-confidence nulls unless includeUnreadable is set", () => {
    const defaultRouted = fieldsBelowThreshold(sample);
    expect(defaultRouted.some((f) => f.path === "labResults[0].referenceRange")).toBe(false);

    const withNulls = fieldsBelowThreshold(sample, { includeUnreadable: true });
    expect(withNulls.some((f) => f.path === "labResults[0].referenceRange" && f.value === null)).toBe(true);
    expect(withNulls.map((f) => f.path)).toEqual([
      "medications[0].dose",
      "medications[0].frequency",
      "labResults[0].unit",
      "labResults[0].referenceRange",
    ]);
  });
});
