# Image-to-Text Bilingual Dataset from Medical Prescriptions

Pinned to **Mendeley Data version 1** (DOI
[10.17632/tg2hm7n2bs.1](https://doi.org/10.17632/tg2hm7n2bs.1)), as linked in
the SoalTech appendix. The landing page is
https://data.mendeley.com/datasets/tg2hm7n2bs/1.

Version 2 (DOI 10.17632/tg2hm7n2bs.2, 1000 images, published 19 January 2026)
exists and is **not** used here.

## License and attribution

- License: **Creative Commons Attribution 4.0 International (CC-BY-4.0)**
- Confirmed from:
  - DataCite `rightsList` for DOI 10.17632/tg2hm7n2bs.1
    (`rightsIdentifier` `cc-by-4.0`, retrieved 23 November 2026)
  - The Mendeley v1 page field `licence.short_name` = "CC BY 4.0"
- Authors: Diya Roy Badhon, Md. Arafat Islam, Umme Aiman Zim, Yamin Hossain,
  Md. Milon-Ibna-Shoyab Rangon, Saiful Islam (Bangabandhu Sheikh Mujibur
  Rahman Digital University)
- Cite the DOI above and the CC BY 4.0 license when redistributing derived
  manifests.

## Files

- `manifest.jsonl` — 600 document records (spec field names plus DatasetItem
  aliases). English and Bangla human transcriptions are in `reference_text`
  and `reference_text_bangla`. `reference_type` is `transcription` except for
  one unlabeled image (`bmpd-1-0186`, `none`).
- `annotation-warnings.json` — CSV issues found during import.
- Images and the original archive (not committed):
  `datasets/raw/bilingual-prescriptions/`
  - `Prescription_Dataset(600)-t4I2Mj.zip` (36,425,756 bytes, sha256
    `bbd59fd6763f32648f5f891d87f5c222e5c7f60b014af7b90745b9093787dfe3`)
  - `documents/` — 600 JPEG images
  - `annotations.csv`, `README.pdf`

## Import notes

The published CSV has a few defects, which the importer records rather than
silently guessing:

- `"0174,jpg"` repaired to `0174.jpg`.
- `0186.jpg` has no CSV row (`reference_type`: `none`).
- Duplicate CSV keys with differing text for `0063` (near-identical wording
  and punctuation variants), `0185` (different medications), and `0525`
  (different medications). The first row is kept as `reference_text`; the
  records are flagged `conflicting_annotations`.
- 248 images are `.jpeg` on disk while the CSV lists `.jpg`. Paths in the
  manifest use the real filename under `datasets/raw/…`.

`reference_verified_by` is null: these are human transcriptions, not an
independent clinician-verified structured annotation set.
