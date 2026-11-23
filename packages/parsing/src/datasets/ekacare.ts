// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { EKACARE_SOURCE } from "./sources.js";
import type { ImportResult, ImportWarning, ManifestRecord } from "./types.js";

export interface EkaCareRawRecord {
  md5_image?: string;
  sample_prompt?: string;
  rubrics?: unknown;
  document_type?: string;
  image?: unknown;
}

export interface ImportEkaCareOptions {
  records: EkaCareRawRecord[];
  /** Directory used to resolve image paths from the raw records. */
  imagesDir?: string;
  outputDir: string;
  datasetsRoot: string;
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"];

/**
 * Import EkaCare rows that have already been extracted from the HF parquet
 * (or a fixture). Parquet itself is not parsed here: no parquet library is
 * present, and adding one would change the root lockfile.
 */
export function importEkaCare(options: ImportEkaCareOptions): ImportResult {
  const warnings: ImportWarning[] = [];
  const records: ManifestRecord[] = [];
  const referencesDir = join(options.outputDir, "references");
  const documentsDir = join(options.outputDir, "documents");
  mkdirSync(referencesDir, { recursive: true });
  mkdirSync(documentsDir, { recursive: true });

  options.records.forEach((raw, index) => {
    const issues: string[] = [];
    const md5 = typeof raw.md5_image === "string" ? raw.md5_image.trim() : "";
    const documentId = md5 ? `ekacare-${md5}` : `ekacare-row-${String(index + 1).padStart(4, "0")}`;
    if (!md5) {
      issues.push("missing_md5");
      warnings.push({
        code: "missing_md5",
        message: `Row ${index} has no md5_image; document_id fell back to ${documentId}`,
        document_id: documentId,
      });
    }

    const imagePath = resolveEkaCareImage(raw, options.imagesDir, documentsDir, documentId);
    if (!imagePath) {
      warnings.push({
        code: "missing_image",
        message: `Row ${index} (${documentId}) has no resolvable image`,
        document_id: documentId,
      });
      return;
    }

    const documentType = normalizeDocumentType(raw.document_type);
    const referenceName = `${safeFileStem(documentId)}.json`;
    const referenceAbs = join(referencesDir, referenceName);
    const referencePayload = {
      md5_image: md5 || null,
      document_type: documentType,
      rubrics: parseRubrics(raw.rubrics),
      sample_prompt: typeof raw.sample_prompt === "string" ? raw.sample_prompt : null,
      note: "sample_prompt is a dataset-provided prompt, not an official transcription. rubrics are for rubric-based scoring only.",
    };
    writeFileSync(referenceAbs, JSON.stringify(referencePayload, null, 2) + "\n", {
      encoding: "utf8",
    });

    const rec: ManifestRecord = {
      document_id: documentId,
      dataset: EKACARE_SOURCE.dataset,
      dataset_version: EKACARE_SOURCE.dataset_version,
      document_type: documentType,
      language: ["en"],
      handwritten: null,
      page_count: 1,
      reference_type: "rubric",
      reference_verified_by: null,
      license_status: "reviewed",
      image_path: toPosix(relative(options.datasetsRoot, imagePath)),
      reference_path: toPosix(relative(options.datasetsRoot, referenceAbs)),
      source_url: EKACARE_SOURCE.source_url,
      license: EKACARE_SOURCE.license,
      license_url: EKACARE_SOURCE.license_url,
    };
    if (issues.length) rec.annotation_issues = issues;
    records.push(rec);
  });

  if (EKACARE_SOURCE.expected_records !== null && records.length !== EKACARE_SOURCE.expected_records) {
    warnings.push({
      code: "count_mismatch",
      message: `Imported ${records.length} EkaCare records; dataset card / HF API list ${EKACARE_SOURCE.expected_records} test examples`,
    });
  }

  return {
    records,
    warnings,
    source: EKACARE_SOURCE,
    imported_records: records.length,
  };
}

export function readJsonlRecords(path: string): EkaCareRawRecord[] {
  const text = readFileSync(path, "utf8");
  const records: EkaCareRawRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`EkaCare JSONL line ${i + 1} is not an object`);
    }
    records.push(parsed as EkaCareRawRecord);
  }
  return records;
}

export function ekacareDownloadBlocker(status: number, errorCode?: string, body?: string): string {
  if (status === 401 || errorCode === "GatedRepo") {
    return (
      "Hugging Face gated repository (HTTP 401, x-error-code GatedRepo). " +
      "You must log in and accept the dataset terms at " +
      EKACARE_SOURCE.source_url +
      " before the parquet shards can be downloaded. " +
      "After access is granted, export the test split to JSONL (image path, md5_image, sample_prompt, rubrics, document_type) and pass it to this importer. " +
      "Parquet files are not parsed directly because no parquet library is installed in this workspace."
    );
  }
  return `EkaCare download failed with HTTP ${status}${errorCode ? ` (${errorCode})` : ""}${body ? `: ${body}` : ""}`;
}

function normalizeDocumentType(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "unknown";
  const v = value.trim().toLowerCase();
  if (v === "prescription" || v === "rx") return "prescription";
  if (v === "laboratory" || v === "lab" || v === "lab_report" || v === "laboratory_report") {
    return "laboratory";
  }
  return value.trim();
}

function parseRubrics(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value ?? null;
}

function resolveEkaCareImage(
  raw: EkaCareRawRecord,
  imagesDir: string | undefined,
  documentsDir: string,
  documentId: string,
): string | null {
  const candidates: string[] = [];
  const image = raw.image;
  if (typeof image === "string") candidates.push(image);
  else if (image && typeof image === "object") {
    const obj = image as Record<string, unknown>;
    for (const key of ["path", "filename", "file_name", "name"]) {
      if (typeof obj[key] === "string") candidates.push(obj[key] as string);
    }
  }
  if (typeof raw.md5_image === "string" && imagesDir) {
    for (const ext of IMAGE_EXTS) {
      candidates.push(join(imagesDir, `${raw.md5_image}${ext}`));
    }
  }

  for (const c of candidates) {
    const abs = resolveExisting(c, imagesDir);
    if (abs) {
      const dest = join(documentsDir, basename(abs));
      if (abs !== dest) {
        writeFileSync(dest, readFileSync(abs));
      }
      return dest;
    }
  }
  // Allow a document already written under documents/
  if (existsSync(join(documentsDir, `${safeFileStem(documentId)}.jpg`))) {
    return join(documentsDir, `${safeFileStem(documentId)}.jpg`);
  }
  return null;
}

function resolveExisting(pathOrName: string, imagesDir?: string): string | null {
  if (existsSync(pathOrName)) return pathOrName;
  if (imagesDir) {
    const joined = join(imagesDir, pathOrName);
    if (existsSync(joined)) return joined;
    const base = basename(pathOrName);
    const stem = base.slice(0, base.length - extname(base).length);
    for (const ext of IMAGE_EXTS) {
      const candidate = join(imagesDir, stem + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function safeFileStem(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}
