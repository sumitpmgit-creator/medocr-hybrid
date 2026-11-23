import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fromDatasetItem,
  parseManifestRecord,
  readManifestJsonl,
  toDatasetItem,
  validateManifestRecord,
  writeManifestJsonl,
} from "../../src/datasets/manifest.js";
import type { ManifestRecord } from "../../src/datasets/types.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/amr/manifest.jsonl");

function sample(over: Partial<ManifestRecord> = {}): ManifestRecord {
  return {
    document_id: "bmpd-1-0001",
    dataset: "bilingual-prescriptions",
    dataset_version: "1",
    document_type: "prescription",
    language: ["bn", "en"],
    handwritten: true,
    page_count: 1,
    reference_type: "transcription",
    reference_verified_by: null,
    license_status: "reviewed",
    image_path: "datasets/raw/bilingual-prescriptions/documents/0001.jpg",
    reference_path: null,
    source_url: "https://data.mendeley.com/datasets/tg2hm7n2bs/1",
    license: "CC-BY-4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
    reference_text: "Take one tablet daily",
    ...over,
  };
}

describe("manifest format", () => {
  it("validates SoalTech spec field names", () => {
    const rec = validateManifestRecord(sample());
    expect(rec.document_id).toBe("bmpd-1-0001");
    expect(rec.reference_type).toBe("transcription");
  });

  it("rejects an unconfirmed license marked reviewed", () => {
    expect(() => validateManifestRecord(sample({ license: "unknown" }))).toThrow(/unknown/);
  });

  it("accepts no_transcription and the phrase no transcription", () => {
    const rec = parseManifestRecord({
      ...sample(),
      reference_type: "no transcription",
      reference_text: undefined,
    });
    expect(rec.reference_type).toBe("no_transcription");
  });

  it("writes DatasetItem aliases alongside spec fields", () => {
    const path = join(mkdtempSync(join(tmpdir(), "manifest-")), "manifest.jsonl");
    writeManifestJsonl(path, [sample()]);
    const obj = JSON.parse(readFileSync(path, "utf8").trim()) as Record<string, unknown>;
    expect(obj.document_id).toBe("bmpd-1-0001");
    expect(obj.id).toBe("bmpd-1-0001");
    expect(obj.datasetVersion).toBe("1");
    expect(obj.imagePath).toBe(obj.image_path);
    expect(obj.referenceText).toBe("Take one tablet daily");
    expect(toDatasetItem(sample()).id).toBe("bmpd-1-0001");
  });

  it("describes the existing AMR DatasetItem shape without rewriting datasets/amr", () => {
    const records = readManifestJsonl(fixture);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec?.dataset).toBe("amr");
    expect(rec?.document_id).toBe("amr/AMR_001");
    expect(rec?.dataset_version).toBe("fa27d29dae4128ac45f035fd580928c84bec4e98");
    expect(rec?.image_path).toBe("datasets/amr/images/AMR_001_HTR.png");
    expect(rec?.reference_type).toBe("transcription");
    expect(rec?.reference_text).toContain("NURSING OBSERVATION CHART");
    expect(rec?.license.toLowerCase()).toContain("cc-by-4.0");
    expect(rec?.handwritten).toBe(true);
    expect(rec?.source_url).toContain("African-Medical-Records");
    expect(
      fromDatasetItem({
        id: "amr/AMR_001",
        dataset: "Nigeria-Health-data-OCR-pipeline/African-Medical-Records",
        datasetVersion: "fa27d29dae4128ac45f035fd580928c84bec4e98",
        license: "cc-by-4.0",
        imagePath: "datasets/amr/images/AMR_001_HTR.png",
        documentType: "clinical_note",
        referenceText: "hello",
        handwritten: true,
      }).reference_type,
    ).toBe("transcription");
  });
});
