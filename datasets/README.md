# MedOCR Hybrid datasets

Imported evaluation documents for the #BuildHybridAI 2026 entry. Images and
archives live under `datasets/raw/<dataset>/` (gitignored) and are not
committed. Manifests, dataset cards, and READMEs stay outside `raw/`.

## Catalog

| Dataset | Version | License | Access | Reference type | Records | Manifest |
| --- | --- | --- | --- | --- | --- | --- |
| bilingual-prescriptions | Mendeley v1 (`10.17632/tg2hm7n2bs.1`) | CC-BY-4.0 | public | transcription | 600 | `bilingual-prescriptions/manifest.jsonl` |
| ekacare | HF sha `dbfce4dd6ed5593e7804619ab9f3b2178504bfe9` | MIT | gated | no_transcription | 0 imported (288 published) | `ekacare/dataset.json` |
| amr | HF sha `fa27d29dae4128ac45f035fd580928c84bec4e98` | CC-BY-4.0 | public | transcription | 3 (existing CER set) | `amr/manifest.jsonl` (not rewritten) |

Source, license evidence, and import status are also in `metadata.json`.

## Manifest format

New imports use the SoalTech section 6 field names (`document_id`,
`dataset_version`, `image_path`, `reference_type`, `source_url`, `license`,
…). Writers also emit packages/core `DatasetItem` camelCase aliases (`id`,
`datasetVersion`, `imagePath`, `documentType`, `referenceText`) so the same
schema can describe the existing African Medical Records manifest without
changing those files.

`image_path` is repo-root relative. For the bilingual set it points at
`datasets/raw/bilingual-prescriptions/documents/…`.

## Importers

- **TypeScript (this work):** `packages/parsing` dataset importer. CLI:

  ```
  node --experimental-strip-types --import packages/parsing/src/datasets/register-ts.mjs \
    packages/parsing/src/datasets/cli.ts import \
    --repo-root . \
    --bilingual-zip /path/to/Prescription_Dataset\(600\)-t4I2Mj.zip
  ```

  Or pass `--download-bilingual` to fetch the public Mendeley v1 zip into
  `datasets/raw/bilingual-prescriptions/`. EkaCare is only catalogued (gated;
  no login bypass). AMR is read and counted, never overwritten.

- **Python `scripts/import_datasets.py`:** already imports `amr`, `words`, and
  `ekacare` (the last only after `HF_TOKEN` plus `pyarrow`) into
  `datasets/<name>/manifest.jsonl` using the `DatasetItem` shape, with images
  under `datasets/<name>/images/` (also gitignored). It does not import the
  bilingual prescription set. This TypeScript importer does not replace that
  script. The root `package.json` script `import:ekacare` still points at
  `scripts/import_ekacare.py`, which does not exist; use
  `scripts/import_datasets.py ekacare` after accepting the HF terms.

## Licenses and attribution

- **Bilingual prescriptions:** CC BY 4.0, Diya Roy Badhon and co-authors,
  Bangabandhu Sheikh Mujibur Rahman Digital University. See
  `bilingual-prescriptions/README.md`.
- **EkaCare:** MIT, as published on the public Hugging Face dataset card.
  Files themselves are gated. See `ekacare/DATASET_CARD.md` and
  `ekacare/README.md`.
- **African Medical Records:** CC-BY-4.0, already recorded in
  `amr/manifest.jsonl`.
