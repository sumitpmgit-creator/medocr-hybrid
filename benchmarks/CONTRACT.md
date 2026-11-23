# Benchmark contracts

## 1. Dataset manifest — `datasets/<name>/manifest.jsonl` (owner: Rachel)

One JSON object per line. The harness accepts the core `DatasetItem` shape written by
`scripts/import_datasets.py`:

| key | needed for | notes |
|---|---|---|
| `id` | all | stable, unique |
| `imagePath` | all | relative to the repo root (or `image`, relative to the dataset dir). PNG/JPEG only; render PDFs to PNG first |
| `referenceText` | CER, WER | full-page transcription. AMR has it; EkaCare does not |
| `referenceDoc` | field accuracy | a core `ClinicalDoc` (`medications[]`, `labResults[]`, `documentType`). No dataset has it yet |
| `phi` | de-id leak check (optional) | `[{ "type": "patient_name" \| "clinician_name" \| "record_id" \| "phone" \| "dob" \| "national_id" \| "email", "value": "…" }]`. If present it replaces rule-based detection from `referenceText` |
| `documentType`, `rubrics`, `prompt`, `license`, `datasetVersion` | carried into results | rubrics are not scored by this harness (needs an LLM judge) |

## 2. Benchmark page — `benchmarks/web/bench.ts` (owner: Sage, uses Avenger's and Louis's code read-only)

The browser driver opens `http://localhost:5174/bench.html`, which it serves with `apps/web`'s Vite, and calls:

```ts
window.medocrBench.capabilities(): Promise<{ device: boolean; cloud: boolean; deviceReason: string; cloudReason: string; cloudModel: string }>
window.medocrBench.warmup(mode): Promise<true>                       // untimed: Remote Config + Nano prepare
window.medocrBench.run({ id, bytes: Uint8Array, mimeType }, { mode: 'device' | 'cloud' | 'hybrid' })
  : Promise<{ text: string; fields?: ClinicalDoc; route: string;
              steps: { stageId: string; stageKind: StageKind; site: ExecutionSite; text?: string }[];   // per-stage text output
              stages: {...}[]; usage: { model, promptTokens, outputTokens }[]; selfReported: StageMetrics }>
```

`run` calls the real pipelines: `pipelines(thresholds)` from `apps/web/src/stages.ts`
(`on-device-only`, `cloud-only`, `hybrid`), run by `runPipeline` from `@med-ocr/core`.
`fields` = the final `ClinicalDoc`. `steps[].text` = the stage's `output.text` (for `kind: 'text'` and `kind: 'fields'` outputs).
Raw stage text is used in memory only. It is never written to results JSON or RESULTS.md.

### Stage names the scorer reads (Avenger: please keep these when splitting OCR and de-id)

| Role | Matched by `stageId` | or by `stageKind` | Output shape | Used for |
|---|---|---|---|---|
| Raw OCR (verbatim, **no redaction**) | `nano-read`, `cloud-read`, `ocr`, `read` | `ocr`, `ocr+structure` | `{ kind: 'text', text }`, or `{ kind: 'fields', text }` for `ocr+structure` | CER/WER against the unchanged AMR `referenceText` |
| De-identification | `deid`, `nano-deid`, `local-deid`, `deid-local`, `regex-deid`, `cloud-deid`, or any id containing a `-deid`/`deid-` segment | `deid` | `{ kind: 'text', text: <de-identified text> }` | leak check: every identifier still present = leak |

Rules: a de-id stage is never treated as OCR, even if its kind were `ocr`. The first matching OCR stage wins, id before kind.
If no OCR stage is in the trace, CER/WER fall back to `text` and the run is flagged. If no de-id stage is present, the
de-id output check reports `n/a`, and the cloud-payload check still runs on every request body Chrome sends to a non-loopback host.
`StageKind` in core already includes `'deid'`.
If `stages.ts`, `firebase.ts` or the core exports change names, update `bench.ts`; nothing else depends on them.

## 3. Node driver (optional)

`--driver node --pipeline <module>` imports a module that exports
`runPipeline(input, { mode })` with the `run` signature above (plus an optional `capabilities()`).
Core's `runPipeline(pipeline, input, opts)` is a stage runner, not this signature, so the Node driver
is only for future Node-side pipelines. Gemini Nano runs only in Chrome, so device and hybrid modes always need the browser driver.
