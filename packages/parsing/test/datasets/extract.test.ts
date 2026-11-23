import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractBilingualArchive } from "../../src/datasets/extract.js";
import { importBilingualPrescriptions } from "../../src/datasets/bilingual.js";
import { sha256Of } from "../../src/datasets/download.js";

const zipPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures/bilingual-mini.zip");

describe("extractBilingualArchive", () => {
  it("unpacks a nested images zip into a documents directory", () => {
    const rawDir = mkdtempSync(join(tmpdir(), "bmpd-raw-"));
    const extracted = extractBilingualArchive(zipPath, rawDir);
    expect(extracted.imageCount).toBe(1);
    expect(existsSync(join(extracted.imagesDir, "0001.jpg"))).toBe(true);
    expect(existsSync(extracted.annotationsPath)).toBe(true);
    const result = importBilingualPrescriptions({
      annotationsPath: extracted.annotationsPath,
      imagesDir: extracted.imagesDir,
      repoRoot: rawDir,
    });
    expect(result.imported_records).toBe(1);
    expect(result.records[0]?.reference_text).toBe("Hello");
    expect(result.records[0]?.reference_text_bangla).toBe("হ্যালো");
  });

  it("hashes bytes with sha256Of", () => {
    expect(sha256Of(new Uint8Array([1, 2, 3]))).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });
});
