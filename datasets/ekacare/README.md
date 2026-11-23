# EkaCare Medical Records Parsing Validation Set

Source: https://huggingface.co/datasets/ekacare/medical_records_parsing_validation_set

Pinned revision (Hugging Face commit, from the unauthenticated datasets API
on 23 November 2026): `dbfce4dd6ed5593e7804619ab9f3b2178504bfe9`.

## License

**MIT**, as published on the public dataset card (“This dataset is released
under the MIT License”) and on the Hugging Face API (`cardData.license=mit`,
tag `license:mit`). The existing `DATASET_CARD.md` in this folder is a copy
of that card and was not modified.

## Access and reference type

The repository is **gated** (`gated=auto`). Parquet shards return HTTP 401
(`x-error-code: GatedRepo`) until a Hugging Face account accepts the terms.
This importer does **not** bypass that gate and does not download images.

EkaCare publishes images, prompts, and evaluation rubrics, **not** official
transcriptions or the clinician-annotated structured JSON. The catalog entry
in `dataset.json` therefore records:

- `access`: `gated`
- `reference_type`: `no_transcription`
- `imported_records`: 0
- `expected_records`: 288

After you accept the terms, `scripts/import_datasets.py ekacare` (requires
`HF_TOKEN` and `pyarrow`) can fetch shards into `datasets/ekacare/`. That
Python script is the existing path for a gated download; it is not invoked
here. The root `package.json` script `import:ekacare` still points at
`scripts/import_ekacare.py`, which does not exist.
