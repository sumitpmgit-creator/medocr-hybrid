# MedOCR Hybrid — benchmark results

Generated from [`results/2026-11-23T09-55-09-212Z.json`](results/2026-11-23T09-55-09-212Z.json) by `node benchmarks/src/run.ts`. Do not edit by hand; rerun the harness.

- Run: 2026-11-23T09:55:09.212Z → 2026-11-23T09:55:10.615Z (UTC)
- Dataset: `datasets/ekacare` — 0 documents — **dataset not imported**
- Driver: browser (Chrome/156.0.8078.47); host: Linux 6.12.113+ x64, 8 CPUs, 16 GB RAM

| Mode | Status | Docs | CER ↓ | WER ↓ | Field accuracy ↑ | Latency p50 | Latency p95 | Est. cost / doc | Est. cost / 1k docs | Bytes sent to cloud / doc | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|
| On-device only (Gemini Nano) | **NOT RUN** | — | — | — | — | — | — | — | — | — | — |
| Cloud only (Firebase AI Logic) | **NOT RUN** | — | — | — | — | — | — | — | — | — | — |
| Hybrid | **NOT RUN** | — | — | — | — | — | — | — | — | — | — |

## Modes not run

**On-device only (Gemini Nano) — NOT RUN**
- /workspace/med-ocr/datasets/ekacare/manifest.jsonl not found (dir contains: DATASET_CARD.md). The EkaCare images and ground truth have not been imported yet. Import it with an importer that writes manifest.jsonl per benchmarks/CONTRACT.md (note: the HF dataset ekacare/medical_records_parsing_validation_set is gated — accept its terms and provide an HF token). _(owner: Rachel (datasets/))_
- Gemini Nano image input not available in this Chrome (Chrome/156.0.8078.47) on this machine: LanguageModel.availability({expectedInputs:[{type:'image'}]}) = "unavailable" _(owner: Sumit (needs an eligible machine) — see README hardware requirements)_
- could not open http://localhost:5173/bench.html: net::ERR_CONNECTION_REFUSED _(owner: Avenger (apps/))_

**Cloud only (Firebase AI Logic) — NOT RUN**
- /workspace/med-ocr/datasets/ekacare/manifest.jsonl not found (dir contains: DATASET_CARD.md). The EkaCare images and ground truth have not been imported yet. Import it with an importer that writes manifest.jsonl per benchmarks/CONTRACT.md (note: the HF dataset ekacare/medical_records_parsing_validation_set is gated — accept its terms and provide an HF token). _(owner: Rachel (datasets/))_
- could not open http://localhost:5173/bench.html: net::ERR_CONNECTION_REFUSED _(owner: Avenger (apps/))_

**Hybrid — NOT RUN**
- /workspace/med-ocr/datasets/ekacare/manifest.jsonl not found (dir contains: DATASET_CARD.md). The EkaCare images and ground truth have not been imported yet. Import it with an importer that writes manifest.jsonl per benchmarks/CONTRACT.md (note: the HF dataset ekacare/medical_records_parsing_validation_set is gated — accept its terms and provide an HF token). _(owner: Rachel (datasets/))_
- Gemini Nano image input not available in this Chrome (Chrome/156.0.8078.47) on this machine: LanguageModel.availability({expectedInputs:[{type:'image'}]}) = "unavailable" _(owner: Sumit (needs an eligible machine) — see README hardware requirements)_
- could not open http://localhost:5173/bench.html: net::ERR_CONNECTION_REFUSED _(owner: Avenger (apps/))_

## How each column is measured

- **CER / WER**: Levenshtein edits ÷ reference length over NFKC-normalised, lower-cased, whitespace-collapsed text, micro-averaged over documents that have a `reference_text`. "—" means no document had one.
- **Field accuracy**: every leaf of the ground-truth `fields` JSON is one field; exact match after value normalisation (case, whitespace, trailing punctuation, numeric form). Missing = wrong; extra predicted fields are ignored. Micro-averaged.
- **Latency**: wall-clock per document as seen by the harness (nearest-rank p50/p95), documents run sequentially, failed documents excluded.
- **Cost**: token counts reported by the pipeline (Firebase AI Logic `usageMetadata`) × rates in `benchmarks/pricing.json` — Paid tier, Standard (non-batch), USD per 1M tokens, text/image input, source https://ai.google.dev/gemini-api/docs/pricing (Gemini Developer API, the backend Firebase AI Logic's GoogleAIBackend bills through), retrieved 2026-11-23. On-device calls are $0 API cost. "—" = cost unknown (no usage reported), never guessed.
- **Bytes sent to cloud**: measured by the harness, not reported by the pipeline — request line + headers + body of every request to a non-loopback host (Node: wrapped `fetch`; browser: Chrome DevTools Network domain). Mean per document.
