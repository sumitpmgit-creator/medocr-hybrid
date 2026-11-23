// SPDX-License-Identifier: Apache-2.0
/**
 * Manifest types for imported evaluation documents.
 *
 * Field names follow the "Minimum imported-document manifest" in SoalTech
 * spec section 6. Provenance fields required by the MedOCR Hybrid brief
 * (source URL, license, pinned version) are included alongside those names.
 *
 * reference_type uses the short names from the spec example ("rubric")
 * rather than the lettered quality labels (A–E).
 */

export const REFERENCE_TYPES = [
  "clinician_verified",
  "transcription",
  "rubric",
  "machine",
  "none",
] as const;

export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const LICENSE_STATUSES = ["reviewed", "unknown"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

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
  annotation_issues?: string[];
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
      download_status: "ok" | "blocked" | "not_attempted" | "local";
      download_blocker: string | null;
      file_sha256?: string;
    }
  >;
  warnings: ImportWarning[];
  record_counts: Record<string, number>;
}
