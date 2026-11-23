import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDatasetImport } from "../../src/datasets/import.js";
import { EKACARE_SOURCE } from "../../src/datasets/sources.js";

describe("EkaCare catalog", () => {
  it("records the set as gated with no_transcription and the published MIT license", async () => {
    const root = mkdtempSync(join(tmpdir(), "med-ocr-root-"));
    mkdirSync(join(root, "datasets"), { recursive: true });
    const result = await runDatasetImport({
      repoRoot: root,
      downloadBilingual: false,
      write: true,
    });
    const src = result.metadata.sources.find((s) => s.dataset === "ekacare");
    expect(src?.access).toBe("gated");
    expect(src?.reference_type).toBe("no_transcription");
    expect(src?.license).toBe("MIT");
    expect(src?.download_status).toBe("gated");
    expect(src?.imported_records).toBe(0);
    expect(src?.download_blocker).toMatch(/gated/i);
    expect(src?.download_blocker).not.toMatch(/workaround|bypass token|scrape/i);
    const status = JSON.parse(
      readFileSync(join(root, "datasets/ekacare/dataset.json"), "utf8"),
    ) as { access: string; reference_type: string; license: string };
    expect(status).toMatchObject({
      access: "gated",
      reference_type: "no_transcription",
      license: "MIT",
    });
    expect(EKACARE_SOURCE.expected_records).toBe(288);
  });
});
