# MedOCR Hybrid — benchmark harness

Runs the real MedOCR pipelines on a dataset in three modes and records, per mode:
CER, WER, field accuracy, latency p50/p95, estimated cost, and bytes sent to the cloud.

| Mode | Pipeline (`apps/web/src/stages.ts`) | Where it runs |
|---|---|---|
| `device` | `on-device-only`: nano-read → nano-structure | Gemini Nano via Firebase AI Logic `ONLY_ON_DEVICE` |
| `cloud` | `cloud-only`: nano-read → deid → cloud-structure (as of 2026-11-23 15:33 IST) | OCR on-device, then only de-identified text goes to `gemini-3.5-flash-lite` via `ONLY_IN_CLOUD`. **Needs Nano too** |
| `hybrid` | `hybrid`: nano-read → nano-structure → deid → cloud-verify | Nano, then only low-confidence entities with a de-identified transcript (no image) go to the cloud |

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

- **CER/WER:** Levenshtein over normalised text (NFKC, lower case, collapsed whitespace), micro-averaged, on the raw OCR stage output (see below).
- **Field accuracy:** every leaf of `referenceDoc` is one field; exact match after normalisation. Medications are keyed by `name` and labs by `test`, so entry order doesn't matter. A missing field counts as wrong. `confidence`, `sourceText`, `bbox` and `abstentions` are ignored.
- **Latency:** harness wall-clock per document, run sequentially. Warm-up (Nano prepare, Remote Config) is excluded. The page decodes the image from base64 before running, which adds a few ms.
- **Cost:** reported token usage (`usageMetadata`) × `pricing.json` (Gemini Developer API paid tier, retrieved 2026-11-23 from https://ai.google.dev/gemini-api/docs/pricing; `gemini-3.5-flash-lite` = $0.30 / 1M input, $2.50 / 1M output). On-device calls cost $0. If usage is missing, cost shows as unknown rather than estimated.
- **Bytes sent:** Chrome DevTools Network domain on the page target. It counts the request line, headers and body for every request to a non-loopback host, independent of what the pipeline self-reports (which is kept in the JSON as `self_reported`). Limitation: traffic from service or web workers is not metered. On-device mode is expected to show 0, and any non-zero value is flagged as a PRIVACY caveat.

## CER/WER source (raw OCR, not de-identified)

CER/WER score the **raw OCR stage output**, picked from the pipeline trace by stage name (`nano-read` /
`cloud-read`, else `stageKind: 'ocr'`), against the unchanged AMR `referenceText`. De-id output is never scored.
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
