// SPDX-License-Identifier: Apache-2.0
/**
 * Manifest types for imported evaluation documents.
 *
 * Canonical field names follow the "Minimum imported-document manifest" in
 * SoalTech spec section 6 (snake_case). The writer also emits camelCase
 * aliases that match packages/core DatasetItem (id, datasetVersion,
 * imagePath, documentType, referenceText) so this format can describe the
 * existing datasets/amr/manifest.jsonl without rewriting it.
 *
 * reference_type uses short names. EkaCare is recorded as
 * "no_transcription" (no official transcription is published; the set is
 * also gated on Hugging Face).
 */

export const REFERENCE_TYPES = [
  "clinician_verified",
  "transcription",
  "rubric",
  "machine",
  "no_transcription",
  "none",
] as const;

export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const LICENSE_STATUSES = ["reviewed", "unknown"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const ACCESS_STATUSES = ["public", "gated"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

/** One document in the imported manifest (JSONL object). */
export interface ManifestRecord {
  document_id: string;
  dataset: string;
  dataset_version: string;
  document_type: string;
  language: string[];
  handwritten: boolean | null;
  page_count: number;
  reference_type: ReferenceType;
  reference_verified_by: string | null;
  license_status: LicenseStatus;
  image_path: string;
  reference_path: string | null;
  source_url: string;
  license: string;
  license_url: string | null;
  /** English (or sole) transcription when reference_type is transcription. */
  reference_text?: string;
  reference_text_bangla?: string;
  access?: AccessStatus;
  annotation_issues?: string[];
  // DatasetItem aliases written alongside the spec fields (same values).
  id?: string;
  datasetVersion?: string;
  imagePath?: string;
  documentType?: string;
  referenceText?: string;
}

/** packages/core DatasetItem shape used by scripts/import_datasets.py and datasets/amr. */
export interface DatasetItemRecord {
  id: string;
  dataset: string;
  datasetVersion: string;
  license: string;
  imagePath: string;
  documentType?: string;
  referenceText?: string;
  rubrics?: unknown;
  prompt?: string;
  handwritten?: boolean;
  note?: string;
}

export interface DatasetSourceMeta {
  dataset: string;
  title: string;
  source_url: string;
  dataset_version: string;
  version_type: "huggingface_sha" | "mendeley_version";
  doi?: string;
  license: string;
  license_url: string | null;
  license_confirmed_from: string[];
  reference_type: ReferenceType;
  expected_records: number | null;
  access: AccessStatus;
  notes: string[];
}

export interface ImportWarning {
  code: string;
  message: string;
  document_id?: string;
}

export interface ImportResult {
  records: ManifestRecord[];
  warnings: ImportWarning[];
  source: DatasetSourceMeta;
  imported_records: number;
}

export interface ManifestMetadata {
  manifest_path: string;
  generated_at: string;
  sources: Array<
    DatasetSourceMeta & {
      imported_records: number;
      download_status: "ok" | "blocked" | "gated" | "not_attempted" | "local" | "external";
      download_blocker: string | null;
      file_sha256?: string;
      manifest_path?: string;
    }
  >;
  warnings: ImportWarning[];
  record_counts: Record<string, number>;
}
