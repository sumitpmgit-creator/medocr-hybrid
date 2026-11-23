# MedOCR Hybrid — benchmark harness

Runs the real MedOCR pipelines on a dataset in three modes and records, per mode:
CER, WER, field accuracy, latency p50/p95, estimated cost, and bytes sent to the cloud.

| Mode | Pipeline (`apps/web/src/stages.ts`) | Where it runs |
|---|---|---|
| `device` | `on-device-only`: nano-read → nano-structure | Gemini Nano via Firebase AI Logic `ONLY_ON_DEVICE` |
| `cloud` | `cloud-only` ("Cloud baseline"): cloud-read → deid → cloud-structure | `gemini-3.5-flash-lite` via `ONLY_IN_CLOUD`. **The full page image is uploaded** for the read stage; only de-identified text goes to structuring. No Nano needed, so it runs on this box once Firebase is configured |
| `hybrid` | `hybrid`: nano-read → deid → cloud-structure | Nano reads on-device; only de-identified text (no image) goes to the cloud |

Outputs:
- `results/<UTC timestamp>.json`: the full record: environment, dataset hash, pricing used, per-mode summary, per-document detail.
- `RESULTS.md`: the table for the demo and Devpost, with one section per dataset taken from that dataset's latest real run. Regenerated on every run.
- `results/selftest/…json`: **harness self-tests** with a mock pipeline. These are not results. They are git-ignored and never appear in RESULTS.md.

A mode that can't run for real is recorded as **NOT RUN** (or **FAILED** if every document errored), together with the blocker and its owner. The harness never fills in numbers for it.

## Run

From the repo root, `/workspace/med-ocr`, with Node ≥ 23.6 (TypeScript type-stripping; tested on Node 24.22):

```bash
# 1. Real benchmark, all three modes, CER/WER set (African Medical Records):
node benchmarks/src/run.ts --driver browser --dataset datasets/amr

# 1b. Second CER/WER set: Bilingual Prescriptions v1 (Bangla + English, 600 records; 3 excluded, see below):
node benchmarks/src/run.ts --driver browser --dataset datasets/bilingual-prescriptions

# 2. Real benchmark on EkaCare (latency / cost / bytes; no transcriptions so no CER/WER):
HF_TOKEN=hf_... python3 scripts/import_datasets.py ekacare --limit 20   # Rachel's importer, gated dataset
node benchmarks/src/run.ts --driver browser --dataset datasets/ekacare

# Options
#   --modes device,cloud,hybrid   subset of modes
#   --limit N                     first N documents (sorted by id)
#   --chrome-profile DIR          default /workspace/sage-chrome-profile (MUST be outside the repo; enforced)
#   --headless                    don't: the Prompt API is not exposed in headless Chrome
#   --no-serve --app-url URL      use an already-running bench page instead of starting Vite
#   --no-results-md               write JSON only

# Harness self-test (mock pipeline, synthetic fixtures; validates scoring, cost, and meter):
node benchmarks/src/run.ts --self-test
node --test benchmarks/test/*.test.ts
```

The browser driver starts `apps/web/node_modules/.bin/vite --config benchmarks/web/vite.config.mjs`
on port 5174. It reuses `apps/web`'s dependencies and its `.env.local` without modifying `apps/`.
Vite's cache goes to `/workspace/sage-vite-cache` (override with `MEDOCR_VITE_CACHE`). Nothing generated
is written into the public tree except `results/` and `RESULTS.md`.

## Prerequisites for each mode

**Cloud (and hybrid):** `apps/web/.env.local` filled with the Firebase web config, following `apps/web/.env.example`:
the Gemini Developer API enabled for Firebase AI Logic in that project, and App Check either
configured or with a registered debug token. Owners: Sumit (Firebase project) and Avenger (apps/web).

**Device (and hybrid):** desktop Chrome where
`await LanguageModel.availability({expectedInputs:[{type:'image'}]})` returns `"available"`.
Per https://developer.chrome.com/docs/ai/get-started that means Windows 10/11, macOS 13+, Linux,
or a Chromebook Plus, with ≥ 22 GB free disk on the profile volume, and either a GPU with more than 4 GB of VRAM
or 16 GB RAM and 4 CPU cores. The model downloads into the `--chrome-profile`, so keep that profile between runs.
The shared box does **not** qualify: no GPU, 15.6 GiB RAM, and Chrome 156 reports `"unavailable"`.

## How it measures (summary; full text is at the bottom of RESULTS.md)

- **CER/WER:** Levenshtein over normalised text (see "Normalisation" below), micro-averaged, on the raw OCR stage output (see below).
- **Field accuracy:** every leaf of `referenceDoc` is one field; exact match after normalisation. Medications are keyed by `name` and labs by `test`, so entry order doesn't matter. A missing field counts as wrong. `confidence`, `sourceText`, `bbox` and `abstentions` are ignored.
- **Latency:** harness wall-clock per document, run sequentially. Warm-up (Nano prepare, Remote Config) is excluded. The page decodes the image from base64 before running, which adds a few ms.
- **Cost:** reported token usage (`usageMetadata`) × `pricing.json` (Gemini Developer API paid tier, retrieved 2026-11-23 from https://ai.google.dev/gemini-api/docs/pricing; `gemini-3.5-flash-lite` = $0.30 / 1M input, $2.50 / 1M output). On-device calls cost $0. If usage is missing, cost shows as unknown rather than estimated.
- **Bytes sent:** Chrome DevTools Network domain on the page target. It counts the request line, headers and body for every request to a non-loopback host, independent of what the pipeline self-reports (which is kept in the JSON as `self_reported`). Limitation: traffic from service or web workers is not metered. On-device mode is expected to show 0, and any non-zero value is flagged as a PRIVACY caveat.

## Datasets and exclusions

| Dataset | Records | Excluded | Scored for CER/WER | Notes |
|---|---|---|---|---|
| `datasets/amr` | 3 | 0 | 3 | African Medical Records, CC-BY-4.0, verbatim transcriptions |
| `datasets/bilingual-prescriptions` | 600 | 3 (`bmpd-1-0063`, `bmpd-1-0185`, `bmpd-1-0525`) | 596 | Mendeley v1, DOI 10.17632/tg2hm7n2bs.1, **CC-BY-4.0** (per Rachel's dataset README: DataCite rightsList + Mendeley licence field). `bmpd-1-0186` has `reference_type: none`, so it runs but isn't scored |
| `datasets/ekacare` | not imported | — | 0 | no transcriptions, so latency, cost and bytes only |

- Exclusions live in `benchmarks/exclusions.json`, by dataset path, and each one needs a reason. The three bilingual exclusions are the CSV's duplicate keys with conflicting transcriptions (`annotation_issues: conflicting_annotations`), excluded on Advisory's decision of 2026-11-23. Each results JSON records `manifest_records`, `excluded[]` (with `found`), `n_samples`, `with_reference_text`, `without_reference[]`, and per mode `cer_wer_docs_scored` (the count actually scored). RESULTS.md shows these.
- **Bilingual caveats.** The script is **Bangla (Bengali), not Devanagari**: the images come from Gazipur, Bangladesh. CER/WER are scored against the English `reference_text`. The source CSV calls these fields "descriptions"/"captions" ("…tablet should be taken twice daily…"), not verbatim copies of the handwriting, so CER/WER here measure distance from a normalised caption, not pure OCR error. Report them separately from AMR and don't average the two sets. `reference_text_bangla` is kept in the manifest but not scored.
- **Leak check on bilingual.** The rules run on it too, but find 0 identifiers, because the source redacted personal identifiers before release (dataset README). Leak rates there will be 0/0 (shown as —). The *Full image uploaded* count still applies.

## Normalisation (CER/WER; same for hypothesis and reference)

`src/metrics.ts normalizeText`, unit-tested in `test/metrics.test.ts`:
1. **Unicode NFC** (canonical composition). This unifies precomposed and decomposed forms, e.g. Bengali য় U+09DF ≡ য U+09AF + ় U+09BC, and Devanagari क़ U+0958 ≡ क + ़. 172 of the 600 Bangla references aren't NFC as shipped. **NFKC is not used**: it rewrites `½` as `1⁄2` and folds compatibility forms in ways that differ by script.
2. Zero-width joiner and non-joiner (U+200C/U+200D), zero-width space, word joiner, BOM and soft hyphen are removed. In Indic scripts they only change conjunct and half-form shaping.
3. Typography is folded: curly quotes become straight, dashes and minus become `-`, the fraction slash becomes `/`, and vulgar fractions become `n/d` (`½` → `1/2`; the bilingual references use them).
4. Danda `।` and double danda `॥` get a following space, because the Bangla references often omit it ("হবে।একই").
5. Text is lower-cased (Latin only, since Bengali and Devanagari have no case), and whitespace runs, including newlines, collapse to a single space.
6. **Not done:** digit transliteration (`৬` ≠ `6`), punctuation removal, and spelling or transliteration matching between scripts.
CER counts Unicode code points, not grapheme clusters, so a Bengali conjunct like ক্ষ is 3 code points.

## CER/WER source (raw OCR, not de-identified)

CER/WER score the **raw OCR stage output**, picked from the pipeline trace by stage name (`nano-read` /
`cloud-read`, else `stageKind: 'ocr'`). This was checked on 2026-11-23 against Avenger's chains: cloud uses `cloud-read`, while hybrid and device use `nano-read`, against the unchanged AMR `referenceText`. De-id output is never scored.
Each document's `ocr_text_source` in the JSON shows which stage was used. Stage names and shapes are in CONTRACT.md §2.

## De-id leak check

1. **Identifiers per document.** If the manifest has `phi: [{type, value}]`, that list is used. Otherwise these rules
   (`src/phi.ts`, `PHI_RULES`) run over `referenceText`:
   - `patient_name`: the value after a line-start label `Patient name`, `Patient’s name`, `Name of patient`, `Patient`, `Name`, or `Pt name`, followed by `:`, `-` or `#`.
   - `clinician_name`: the value after `Doctor’s name`, `Consultant`, `Physician`, `Nurse name`, `Requested by`, `Prescribed by`, or `Attending`. Also `Dr|Mr|Mrs|Ms|Miss|Prof` + 1–3 capitalised words on the same line. The title itself is stripped.
   - `record_id`: the value after `Hospital No/Number`, `MRN`, `UHID`, `Patient ID`, `IP No`, `OP No`, `Folder No`, `Card No`, `Reg(istration) No`, `Lab No/ID`, or `Sample ID`.
   - `dob`: a date after `DOB`, `D.O.B` or `Date of birth`. Service dates (`Date:`) are *not* identifiers.
   - `national_id`: Aadhaar (`dddd dddd dddd` or 12 digits) or ABHA (`dd-dddd-dddd-dddd` or 14 digits).
   - `phone`: 10–13 digits with optional `+`, spaces and dashes. `email`: standard address pattern.
   - Values are cut at a column gap (2+ spaces) and trailing punctuation. Placeholders (`-`, `N/A`, `[…]`) are skipped, and duplicates are removed.
   On AMR these rules find 8 identifiers across 3 documents: 3 patient names, 2 clinician names and 3 record IDs.
2. **Leak.** An identifier leaks if its token sequence survives in a target. Tokens are lower-case letters and digits, split on everything else, so `E.J` ≈ `e j`, `2023/BF/057` ≈ `2023 bf 057`, and `[NAME]` doesn't match. The targets are
   (a) every de-id stage output, and (b) every request body Chrome sends to a non-loopback host, with JSON string values decoded.
3. **Reported:** leaks ÷ identifiers checked, per mode, for each target, plus counts by leaked type. In addition, *Full image uploaded*
   counts documents whose image bytes appear in a cloud payload. No current pipeline should do this. Every identifier in such an image leaves the device even when
   the text check shows 0.
4. **Never stored raw:** the JSON keeps `{type, rule, masked: '****', sha256_8}` for each leak. RESULTS.md shows counts and types only.
   Unit tests (`test/phi.test.ts`) use invented data only.

## Files

```
src/run.ts            CLI, orchestration, summaries
src/metrics.ts        CER/WER/field scoring, percentiles (unit-tested)
src/cost.ts           pricing × usage, never guesses
src/phi.ts            identifier extraction, leak matching, masking (unit-tested)
src/stage-select.ts   picks raw-OCR and de-id stage outputs by stage name/kind (unit-tested)
src/meter.ts          Node fetch egress meter
src/report.ts         RESULTS.md renderer
src/drivers/browser.ts  Chrome over CDP + egress metering + Vite launcher
src/drivers/node.ts     in-process driver (future Node pipelines)
src/drivers/mock.ts     SELF-TEST ONLY mock pipeline
web/                  bench page that wraps the real pipelines (see CONTRACT.md)
pricing.json          rates + source + assumptions
selftest/             synthetic fixtures + stub page for driver checks
FINDINGS.md           issues the harness surfaced, with severity and owner
```
