// SPDX-License-Identifier: Apache-2.0
/**
 * Pinned source, version, and license metadata.
 *
 * Licenses are recorded only when confirmed from a primary page or API.
 * If a license cannot be confirmed, callers must write "unknown".
 */

import type { DatasetSourceMeta } from "./types.js";

/** Hugging Face commit of ekacare/medical_records_parsing_validation_set, confirmed via the HF datasets API on 2026-11-23. */
export const EKACARE_PINNED_SHA = "dbfce4dd6ed5593e7804619ab9f3b2178504bfe9";

export const EKACARE_SOURCE: DatasetSourceMeta = {
  dataset: "ekacare",
  title: "Medical Records Parsing Validation Set",
  source_url:
    "https://huggingface.co/datasets/ekacare/medical_records_parsing_validation_set",
  dataset_version: EKACARE_PINNED_SHA,
  version_type: "huggingface_sha",
  license: "MIT",
  license_url: "https://opensource.org/licenses/MIT",
  license_confirmed_from: [
    "Hugging Face datasets API cardData.license=mit and tags license:mit (https://huggingface.co/api/datasets/ekacare/medical_records_parsing_validation_set, sha dbfce4dd6ed5593e7804619ab9f3b2178504bfe9, retrieved 2026-11-23)",
    "Dataset card License section: \"This dataset is released under the MIT License\" (also copied at datasets/ekacare/DATASET_CARD.md)",
  ],
  reference_type: "rubric",
  expected_records: 288,
  notes: [
    "The published HF fields are image, md5_image, sample_prompt, rubrics, and document_type. The underlying clinician-annotated structured JSON is not released, so this set supports rubric scoring only, not image-to-official-transcription comparison.",
    "The HF repo is gated (API field gated=auto). File downloads return HTTP 401 with x-error-code GatedRepo until a Hugging Face account accepts the terms.",
    "HF API reports 288 test examples and download_size 24480000 bytes.",
  ],
};

/** Mendeley Data version 1, as linked in SoalTech Appendix A. */
export const BILINGUAL_PINNED_VERSION = "1";

/** SHA-256 of Prescription_Dataset(600)-t4I2Mj.zip as published on Mendeley v1 and verified on download. */
export const BILINGUAL_ZIP_SHA256 =
  "bbd59fd6763f32648f5f891d87f5c222e5c7f60b014af7b90745b9093787dfe3";

export const BILINGUAL_FILE_ID = "4efb79ec-d793-4000-bc6c-5947ed3f536c";

export const BILINGUAL_SOURCE: DatasetSourceMeta = {
  dataset: "bilingual-prescriptions",
  title: "Image-to-Text Bilingual Dataset from Medical Prescriptions",
  source_url: "https://data.mendeley.com/datasets/tg2hm7n2bs/1",
  dataset_version: BILINGUAL_PINNED_VERSION,
  version_type: "mendeley_version",
  doi: "10.17632/tg2hm7n2bs.1",
  license: "CC-BY-4.0",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  license_confirmed_from: [
    "DataCite API rightsList for DOI 10.17632/tg2hm7n2bs.1: rightsIdentifier cc-by-4.0, rights \"Creative Commons Attribution 4.0 International\", rightsUri https://creativecommons.org/licenses/by/4.0/legalcode (https://api.datacite.org/dois/10.17632/tg2hm7n2bs.1, retrieved 2026-11-23)",
    "Mendeley dataset page v1 licence.short_name \"CC BY 4.0\" and licence.full_name \"Creative Commons Attribution 4.0 International\" (https://data.mendeley.com/datasets/tg2hm7n2bs/1, retrieved 2026-11-23)",
  ],
  reference_type: "transcription",
  expected_records: 600,
  notes: [
    "Version 1 contains 600 handwritten prescription images with Bangla and English annotations (published 2025-12-30). Version 2 (DOI 10.17632/tg2hm7n2bs.2, 1000 images, published 2026-01-19) exists; this importer pins version 1 as specified in the SoalTech appendix and the project brief.",
    "Authors state that patient names and other identifying features were blacked out. Annotations are human transcriptions, not independently clinician-verified structured labels.",
    "The v1 public file is Prescription_Dataset(600)-t4I2Mj.zip (36,425,756 bytes, sha256 bbd59fd6763f32648f5f891d87f5c222e5c7f60b014af7b90745b9093787dfe3).",
  ],
};

export const DATASET_SOURCES = {
  ekacare: EKACARE_SOURCE,
  "bilingual-prescriptions": BILINGUAL_SOURCE,
} as const;
