import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  importBilingualPrescriptions,
  repairCsvFilename,
} from "../../src/datasets/bilingual.js";

const here = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(here, "fixtures/bilingual/images");
const annotationsPath = join(here, "fixtures/bilingual/annotations.csv");
const repoRoot = join(here, "fixtures");

describe("bilingual importer", () => {
  it("repairs the 0174,jpg typo", () => {
    expect(repairCsvFilename("0174,jpg")).toEqual({ filename: "0174.jpg", typo: true });
    expect(repairCsvFilename("0174.jpg")).toEqual({ filename: "0174.jpg", typo: false });
  });

  it("imports images from raw-style paths and flags typo, conflict, dup, and missing labels", () => {
    const result = importBilingualPrescriptions({ annotationsPath, imagesDir, repoRoot });
    expect(result.imported_records).toBe(4);
    const byId = new Map(result.records.map((r) => [r.document_id, r]));

    const a1 = byId.get("bmpd-1-0001");
    expect(a1?.reference_type).toBe("transcription");
    expect(a1?.reference_text).toBe("Take one tablet daily");
    expect(a1?.annotation_issues).toContain("duplicate_annotation");
    expect(a1?.image_path.replaceAll("\\", "/")).toContain("bilingual/images/0001.jpg");
    expect(a1?.license).toBe("CC-BY-4.0");
    expect(a1?.source_url).toContain("tg2hm7n2bs/1");
    expect(a1?.handwritten).toBe(true);
    expect(a1?.language).toEqual(["bn", "en"]);

    const a2 = byId.get("bmpd-1-0002");
    expect(a2?.annotation_issues).toContain("conflicting_annotations");
    expect(a2?.annotation_issues).toContain("extension_mismatch");
    expect(a2?.image_path).toMatch(/0002\.jpeg$/);

    const typo = byId.get("bmpd-1-0174");
    expect(typo?.annotation_issues).toContain("filename_typo");
    expect(typo?.reference_text).toBe("Histal at night");

    const missing = byId.get("bmpd-1-0186");
    expect(missing?.reference_type).toBe("none");
    expect(missing?.annotation_issues).toContain("missing_annotation");
    expect(missing?.reference_text).toBeUndefined();

    expect(result.warnings.some((w) => w.code === "filename_typo")).toBe(true);
    expect(result.warnings.some((w) => w.code === "conflicting_annotations")).toBe(true);
    expect(result.warnings.some((w) => w.code === "missing_annotation")).toBe(true);
  });
});
