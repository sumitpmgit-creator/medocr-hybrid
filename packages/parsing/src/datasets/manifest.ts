// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ACCESS_STATUSES,
  LICENSE_STATUSES,
  REFERENCE_TYPES,
  type AccessStatus,
  type DatasetItemRecord,
  type LicenseStatus,
  type ManifestMetadata,
  type ManifestRecord,
  type ReferenceType,
} from "./types.js";
import { AMR_SOURCE, DATASET_SOURCES } from "./sources.js";

const SPEC_REQUIRED = [
  "document_id",
  "dataset",
  "dataset_version",
  "document_type",
  "language",
  "handwritten",
  "page_count",
  "reference_type",
  "reference_verified_by",
  "license_status",
  "image_path",
  "reference_path",
  "source_url",
  "license",
] as const;

export function isReferenceType(value: unknown): value is ReferenceType {
  return typeof value === "string" && (REFERENCE_TYPES as readonly string[]).includes(value);
}

export function isLicenseStatus(value: unknown): value is LicenseStatus {
  return typeof value === "string" && (LICENSE_STATUSES as readonly string[]).includes(value);
}

export function normalizeReferenceType(value: unknown): ReferenceType | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "no_transcription" || v === "notranscription") return "no_transcription";
  if (v === "human_transcription" || v === "human") return "transcription";
  if (v === "e" || v === "none") return "none";
  if (isReferenceType(v)) return v;
  return undefined;
}

/**
 * Parse one JSONL object, accepting either the SoalTech spec fields or the
 * packages/core DatasetItem / scripts/import_datasets.py camelCase shape
 * used by datasets/amr/manifest.jsonl.
 */
export function parseManifestRecord(record: unknown, index?: number): ManifestRecord {
  const loc = index === undefined ? "record" : `record ${index}`;
  if (record === null || typeof record !== "object") {
    throw new Error(`${loc} is not an object`);
  }
  const rec = record as Record<string, unknown>;
  if (isDatasetItemShape(rec) && !hasSpecShape(rec)) {
    return validateManifestRecord(fromDatasetItem(rec as unknown as DatasetItemRecord), index);
  }
  return validateManifestRecord(rec, index);
}

export function fromDatasetItem(item: DatasetItemRecord): ManifestRecord {
  const datasetSlug = slugFromDatasetItem(item);
  const known = datasetSlug in DATASET_SOURCES ? DATASET_SOURCES[datasetSlug as keyof typeof DATASET_SOURCES] : undefined;
  const source = known ?? (datasetSlug === "amr" ? AMR_SOURCE : undefined);
  const hasText = typeof item.referenceText === "string" && item.referenceText.length > 0;
  const hasRubrics = item.rubrics !== undefined && item.rubrics !== null;
  let referenceType: ReferenceType;
  if (hasText) referenceType = "transcription";
  else if (datasetSlug === "ekacare") referenceType = "no_transcription";
  else if (hasRubrics) referenceType = "rubric";
  else referenceType = "no_transcription";

  const license = item.license || "unknown";
  const record: ManifestRecord = {
    document_id: item.id,
    dataset: datasetSlug,
    dataset_version: item.datasetVersion,
    document_type: item.documentType ?? "other",
    language: source?.dataset === "amr" ? ["en"] : [],
    handwritten: typeof item.handwritten === "boolean" ? item.handwritten : null,
    page_count: 1,
    reference_type: referenceType,
    reference_verified_by: null,
    license_status: license !== "unknown" ? "reviewed" : "unknown",
    image_path: item.imagePath,
    reference_path: null,
    source_url: source?.source_url ?? "unknown",
    license,
    license_url: licenseUrlFor(license, source?.license_url ?? null),
    access: source?.access,
  };
  if (hasText) record.reference_text = item.referenceText;
  return withDatasetItemAliases(record);
}

export function toDatasetItem(record: ManifestRecord): DatasetItemRecord {
  const item: DatasetItemRecord = {
    id: record.id ?? record.document_id,
    dataset: record.dataset,
    datasetVersion: record.datasetVersion ?? record.dataset_version,
    license: record.license,
    imagePath: record.imagePath ?? record.image_path,
    documentType: record.documentType ?? record.document_type,
  };
  if (typeof record.handwritten === "boolean") item.handwritten = record.handwritten;
  const text = record.referenceText ?? record.reference_text;
  if (text !== undefined) item.referenceText = text;
  return item;
}

export function withDatasetItemAliases(record: ManifestRecord): ManifestRecord {
  return {
    ...record,
    id: record.document_id,
    datasetVersion: record.dataset_version,
    imagePath: record.image_path,
    documentType: record.document_type,
    referenceText: record.reference_text,
  };
}

export function validateManifestRecord(record: unknown, index?: number): ManifestRecord {
  const loc = index === undefined ? "record" : `record ${index}`;
  if (record === null || typeof record !== "object") {
    throw new Error(`${loc} is not an object`);
  }
  const rec = record as Record<string, unknown>;
  for (const field of SPEC_REQUIRED) {
    if (!(field in rec)) {
      throw new Error(`${loc} is missing field "${field}"`);
    }
  }
  if (typeof rec.document_id !== "string" || rec.document_id.trim() === "") {
    throw new Error(`${loc} has an empty document_id`);
  }
  if (typeof rec.dataset !== "string" || rec.dataset.trim() === "") {
    throw new Error(`${loc} has an empty dataset`);
  }
  if (typeof rec.dataset_version !== "string" || rec.dataset_version.trim() === "") {
    throw new Error(`${loc} has an empty dataset_version`);
  }
  if (typeof rec.document_type !== "string" || rec.document_type.trim() === "") {
    throw new Error(`${loc} has an empty document_type`);
  }
  if (!Array.isArray(rec.language) || rec.language.some((x) => typeof x !== "string")) {
    throw new Error(`${loc} language must be an array of strings`);
  }
  if (rec.handwritten !== null && typeof rec.handwritten !== "boolean") {
    throw new Error(`${loc} handwritten must be boolean or null`);
  }
  if (typeof rec.page_count !== "number" || !Number.isInteger(rec.page_count) || rec.page_count < 1) {
    throw new Error(`${loc} page_count must be a positive integer`);
  }
  const refType = normalizeReferenceType(rec.reference_type);
  if (!refType) {
    throw new Error(`${loc} has unknown reference_type ${JSON.stringify(rec.reference_type)}`);
  }
  rec.reference_type = refType;
  if (rec.reference_verified_by !== null && typeof rec.reference_verified_by !== "string") {
    throw new Error(`${loc} reference_verified_by must be string or null`);
  }
  if (!isLicenseStatus(rec.license_status)) {
    throw new Error(`${loc} has unknown license_status ${JSON.stringify(rec.license_status)}`);
  }
  if (typeof rec.image_path !== "string" || rec.image_path.trim() === "") {
    throw new Error(`${loc} has an empty image_path`);
  }
  if (rec.reference_path !== null && typeof rec.reference_path !== "string") {
    throw new Error(`${loc} reference_path must be string or null`);
  }
  if (typeof rec.source_url !== "string" || rec.source_url.trim() === "") {
    throw new Error(`${loc} has an empty source_url`);
  }
  if (typeof rec.license !== "string" || rec.license.trim() === "") {
    throw new Error(`${loc} has an empty license (use "unknown" when unconfirmed)`);
  }
  if (rec.license_url !== undefined && rec.license_url !== null && typeof rec.license_url !== "string") {
    throw new Error(`${loc} license_url must be string or null`);
  }
  if (rec.license === "unknown" && rec.license_status === "reviewed") {
    throw new Error(`${loc} cannot mark license_status as reviewed when license is unknown`);
  }
  if (rec.annotation_issues !== undefined) {
    if (
      !Array.isArray(rec.annotation_issues) ||
      rec.annotation_issues.some((x) => typeof x !== "string")
    ) {
      throw new Error(`${loc} annotation_issues must be an array of strings`);
    }
  }
  if (rec.access !== undefined && !(ACCESS_STATUSES as readonly string[]).includes(rec.access as string)) {
    throw new Error(`${loc} has unknown access ${JSON.stringify(rec.access)}`);
  }
  if (rec.reference_text !== undefined && typeof rec.reference_text !== "string") {
    throw new Error(`${loc} reference_text must be a string`);
  }
  if (rec.reference_text_bangla !== undefined && typeof rec.reference_text_bangla !== "string") {
    throw new Error(`${loc} reference_text_bangla must be a string`);
  }
  return rec as unknown as ManifestRecord;
}

export function writeManifestJsonl(path: string, records: ManifestRecord[]): void {
  const lines = records.map((r, i) => JSON.stringify(withDatasetItemAliases(validateManifestRecord(r, i))));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""), { encoding: "utf8" });
}

export function readManifestJsonl(path: string): ManifestRecord[] {
  const text = readFileSync(path, "utf8");
  const records: ManifestRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSON on line ${i + 1} of ${path}: ${(err as Error).message}`);
    }
    records.push(parseManifestRecord(parsed, i));
  }
  return records;
}

export function writeManifestMetadata(path: string, metadata: ManifestMetadata): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(metadata, null, 2) + "\n", { encoding: "utf8" });
}

export function recordCounts(records: ManifestRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rec of records) {
    counts[rec.dataset] = (counts[rec.dataset] ?? 0) + 1;
  }
  return counts;
}

function isDatasetItemShape(rec: Record<string, unknown>): boolean {
  return (
    typeof rec.id === "string" &&
    typeof rec.datasetVersion === "string" &&
    typeof rec.imagePath === "string"
  );
}

function hasSpecShape(rec: Record<string, unknown>): boolean {
  return typeof rec.document_id === "string" && typeof rec.dataset_version === "string";
}

function slugFromDatasetItem(item: DatasetItemRecord): string {
  if (item.dataset === "amr" || item.id.startsWith("amr/")) return "amr";
  if (item.dataset === "ekacare" || item.id.startsWith("ekacare/") || item.dataset.includes("medical_records_parsing")) {
    return "ekacare";
  }
  if (item.dataset === "bilingual-prescriptions") return "bilingual-prescriptions";
  if (item.dataset.includes("African-Medical-Records")) return "amr";
  return item.dataset;
}

function licenseUrlFor(license: string, fallback: string | null): string | null {
  const key = license.trim().toLowerCase().replace(/[_\s]/g, "-");
  if (key === "mit") return "https://opensource.org/licenses/MIT";
  if (key === "cc-by-4.0" || key === "cc-by-4.0-international") {
    return "https://creativecommons.org/licenses/by/4.0/";
  }
  return fallback;
}

export type { AccessStatus };
