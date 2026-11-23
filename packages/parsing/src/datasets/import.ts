// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importBilingualPrescriptions } from "./bilingual.js";
import { downloadBilingualZip, sha256File } from "./download.js";
import { extractBilingualArchive } from "./extract.js";
import {
  readManifestJsonl,
  recordCounts,
  writeManifestJsonl,
  writeManifestMetadata,
} from "./manifest.js";
import {
  AMR_SOURCE,
  BILINGUAL_SOURCE,
  BILINGUAL_ZIP_SHA256,
  EKACARE_SOURCE,
} from "./sources.js";
import type { ImportResult, ImportWarning, ManifestMetadata, ManifestRecord } from "./types.js";

export const RAW_BILINGUAL_DIR = "datasets/raw/bilingual-prescriptions";
export const BILINGUAL_MANIFEST = "datasets/bilingual-prescriptions/manifest.jsonl";
export const EKACARE_STATUS = "datasets/ekacare/dataset.json";
export const DATASETS_METADATA = "datasets/metadata.json";

export interface RunImportOptions {
  repoRoot: string;
  /** Existing v1 zip. If omitted and download is true, the public Mendeley file is fetched into raw/. */
  bilingualZip?: string;
  downloadBilingual?: boolean;
  /** When true, skip writing under datasets/ (used by tests with a temp root). */
  write?: boolean;
}

export interface RunImportResult {
  bilingual: ImportResult | null;
  metadata: ManifestMetadata;
}

export async function runDatasetImport(options: RunImportOptions): Promise<RunImportResult> {
  const write = options.write !== false;
  const root = options.repoRoot;
  const warnings: ImportWarning[] = [];
  const allRecords: ManifestRecord[] = [];
  const sources: ManifestMetadata["sources"] = [];

  const bilingual = await importBilingualIntoRepo({
    repoRoot: root,
    zipPath: options.bilingualZip,
    download: options.downloadBilingual === true,
    write,
  });
  if (bilingual.result) {
    allRecords.push(...bilingual.result.records);
    warnings.push(...bilingual.result.warnings);
  }
  sources.push(bilingual.sourceEntry);
  if (bilingual.result && write) {
    const manifestPath = join(root, BILINGUAL_MANIFEST);
    writeManifestJsonl(manifestPath, bilingual.result.records);
    writeFileSync(
      join(root, "datasets/bilingual-prescriptions/annotation-warnings.json"),
      JSON.stringify(bilingual.result.warnings, null, 2) + "\n",
      { encoding: "utf8" },
    );
  }

  // EkaCare: record as gated, do not download or bypass the HF login wall.
  const ekacareEntry = {
    ...EKACARE_SOURCE,
    imported_records: 0,
    download_status: "gated" as const,
    download_blocker:
      "Hugging Face gated repository. Accept the terms at " +
      EKACARE_SOURCE.source_url +
      " and use scripts/import_datasets.py ekacare with HF_TOKEN if shards are needed. This importer does not bypass the gate. reference_type is no_transcription because no official transcriptions are published.",
    manifest_path: EKACARE_STATUS,
  };
  sources.push(ekacareEntry);
  if (write) {
    mkdirSync(join(root, "datasets/ekacare"), { recursive: true });
    writeFileSync(join(root, EKACARE_STATUS), JSON.stringify({
      dataset: EKACARE_SOURCE.dataset,
      title: EKACARE_SOURCE.title,
      source_url: EKACARE_SOURCE.source_url,
      dataset_version: EKACARE_SOURCE.dataset_version,
      license: EKACARE_SOURCE.license,
      license_url: EKACARE_SOURCE.license_url,
      license_confirmed_from: EKACARE_SOURCE.license_confirmed_from,
      reference_type: EKACARE_SOURCE.reference_type,
      access: "gated",
      expected_records: EKACARE_SOURCE.expected_records,
      imported_records: 0,
      download_status: "gated",
      download_blocker: ekacareEntry.download_blocker,
      notes: EKACARE_SOURCE.notes,
    }, null, 2) + "\n", { encoding: "utf8" });
  }

  // Describe the existing AMR CER set without rewriting it.
  const amrManifest = join(root, "datasets/amr/manifest.jsonl");
  let amrCount = 0;
  if (existsSync(amrManifest)) {
    const amrRecords = readManifestJsonl(amrManifest);
    amrCount = amrRecords.length;
    allRecords.push(...amrRecords);
  }
  sources.push({
    ...AMR_SOURCE,
    imported_records: amrCount,
    download_status: "external",
    download_blocker: null,
    manifest_path: "datasets/amr/manifest.jsonl",
  });

  const metadata: ManifestMetadata = {
    manifest_path: BILINGUAL_MANIFEST,
    generated_at: new Date().toISOString(),
    sources,
    warnings,
    record_counts: recordCounts(allRecords),
  };
  if (write) {
    writeManifestMetadata(join(root, DATASETS_METADATA), metadata);
  }

  return { bilingual: bilingual.result, metadata };
}

async function importBilingualIntoRepo(opts: {
  repoRoot: string;
  zipPath?: string;
  download: boolean;
  write: boolean;
}): Promise<{
  result: ImportResult | null;
  sourceEntry: ManifestMetadata["sources"][number];
}> {
  const rawDir = join(opts.repoRoot, RAW_BILINGUAL_DIR);
  mkdirSync(rawDir, { recursive: true });
  const defaultZip = join(rawDir, "Prescription_Dataset(600)-t4I2Mj.zip");
  let zipPath = opts.zipPath;
  let sha: string | undefined;

  if (!zipPath && existsSync(defaultZip)) {
    zipPath = defaultZip;
  }
  if (!zipPath && opts.download) {
    const dl = await downloadBilingualZip(defaultZip);
    if (!dl.ok) {
      return {
        result: null,
        sourceEntry: {
          ...BILINGUAL_SOURCE,
          imported_records: 0,
          download_status: "blocked",
          download_blocker: dl.blocker ?? "download failed",
        },
      };
    }
    zipPath = dl.path ?? defaultZip;
    sha = dl.sha256;
  }
  if (!zipPath) {
    return {
      result: null,
      sourceEntry: {
        ...BILINGUAL_SOURCE,
        imported_records: 0,
        download_status: "not_attempted",
        download_blocker: "No bilingual zip provided and download was not requested",
      },
    };
  }

  sha = sha ?? (await sha256File(zipPath));
  if (sha !== BILINGUAL_ZIP_SHA256) {
    return {
      result: null,
      sourceEntry: {
        ...BILINGUAL_SOURCE,
        imported_records: 0,
        download_status: "blocked",
        download_blocker: `Zip sha256 ${sha} does not match pinned v1 hash ${BILINGUAL_ZIP_SHA256}`,
        file_sha256: sha,
      },
    };
  }

  const extracted = extractBilingualArchive(zipPath, rawDir);
  const result = importBilingualPrescriptions({
    annotationsPath: extracted.annotationsPath,
    imagesDir: extracted.imagesDir,
    repoRoot: opts.repoRoot,
  });
  return {
    result,
    sourceEntry: {
      ...BILINGUAL_SOURCE,
      imported_records: result.imported_records,
      download_status: "ok",
      download_blocker: null,
      file_sha256: sha,
      manifest_path: BILINGUAL_MANIFEST,
    },
  };
}

export function readTextIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
