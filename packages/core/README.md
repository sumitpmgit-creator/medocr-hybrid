# @med-ocr/core

The engine behind MedOCR Hybrid: stages, pipeline runners, scoring (SoalTech Benchmarks A, B and C), error attribution and the clinical error register. TypeScript, browser-safe, no vendor SDKs. Design background is in `../../design.md`.

```ts
import { runPipeline, scoreFields, attributeErrors, ErrorRegister, summarize } from '@med-ocr/core';
import { FsCheckpointStore } from '@med-ocr/core/node'; // Node only
```

## Stages (`types.ts`, `stage.ts`)
- `Stage` is the interface from design.md §2, unchanged. It has two new optional fields, `version` and `meta`, so legacy stages keep working.
- `defineStage(def)` builds a Stage from a definition. A definition has `id`, `version`, `kind`, `runtime` (`device | cloud | local-oss | code | human`), `inputs`/`outputs`, and optional `model`, `cost`, `latency`, `deterministic` and `fingerprint`. The wrapper:
  - checks input and output kinds;
  - honours `AbortSignal`;
  - returns canonical, serialisable JSON.
- `describeStage(stage)` returns the full `StageMeta` for any stage, filling defaults.
- `StageRegistry` holds factories: `register`, `registerStage`, `create(id, config)` and `list({ runtime, kind, accepts, produces })`.
- `createRemoteStage({ endpoint, fetch, ... })` adapts any HTTP/JSON model server, such as PaddleOCR, Qwen or Surya, without a vendor SDK. Defaults: `parseOcrResponse`, which expects `{ text, spans? }`, and `parseFieldsResponse`, which expects a `ClinicalDoc` or `{ doc }`.

## Runners (`pipeline.ts`, `runner.ts`, `checkpoint.ts`, `cloud-safety.ts`)
- `runPipeline(pipeline, input, { docId, signal, timeoutMs, cloudSafety })` keeps the old behaviour: full trace, stop at the first failure, partial trace returned. It now also returns a `record: RunRecord`.
- `runPipelineResumable(..., { store, retries, retryDelayMs, timeoutMs, force, downstream })` adds checkpoints:
  - Each stage's result is stored with a sha256 input hash, covering the input, run config, model/fingerprint and `NORMALIZATION_VERSION`, plus the stage version.
  - On resume, a stage is reused only if its input hash and version match. Failed, timed-out or invalidated stages rerun, and so does everything downstream of them. `downstream: 'hash'` reuses unchanged downstream stages instead.
- `RunRecord` holds per-stage status (`executed | reused | failed | timed_out | aborted | blocked | skipped`), the rerun reason, attempts, timings, errors, the cloud-safety decision and `privacyFlags`.
- Stores: `MemoryCheckpointStore` (browser-safe) and `FsCheckpointStore` from `@med-ocr/core/node` (atomic writes).
- Cloud safety, on by default (BUG-005). A stage that declares egress (`runtime: 'cloud'` or `sendsDataOffDevice`) needs all of the following, or it does not run:
  - an earlier `deid` stage;
  - no raw image (the `image` field is stripped);
  - every payload string passes `cloudSafety.check`, which defaults to deid.ts `assertSafeForCloud`.
  - `cloudSafety.exempt: [stageId]` records explicit consent for a stage.
  - Undeclared egress (a stage without egress meta reports `site: 'in_cloud'` or `bytesSent > 0`) follows `cloudSafety.undeclaredEgress`:
    - `'warn'` flags it in `record.privacyFlags`;
    - `'fail'` (default) is fully fail-closed: a stage with no `meta` at all is refused before it runs (`no_meta`, so it is never executed). A stage with meta that still sends data is blocked after the fact: its output is discarded and the run fails. The data has already left, so this cannot undo the send; it makes the leak loud and stops it from spreading.

## Scoring
- **Benchmark A** (`text-metrics.ts`, `benchmark.ts`): `cer`, `wer`, `omissionInvention`, `numericAccuracy`, a symmetric `similarity`, and `scoreTranscription` (exact match plus abbreviation accuracy).
- **Benchmark B** (`field-scorer.ts`, `clinical-values.ts`): `scoreFields(gold, pred, { tolerance })` returns:
  - the old aggregates and safety screen;
  - `perField` and `benchmarkFields` (drug, dose = strength, frequency, test, value, unit, referenceRange) with tp/fp/fn, exact vs normalised matches, P/R/F1;
  - `alignment` (Hungarian `alignRecords`) and `duplicateEntities`;
  - `rulesId`.
  - Comparison is typed (`compareValues`): drug names use generic aliases with brand mapping off, plus units, frequency, route, duration, numbers (including Indian grouping such as 2,50,000) and reference ranges (`'4.5-11.0'`, `'<5'`, units). Alias tables come from Rachel's `normalize.ts`. Differences such as 5 vs 50 mg, mg vs mcg, or 0-0-1 vs 1-0-1 are never normalised away.
- **Calibration** (`calibration.ts`): `calibrationReport(samples)` gives ECE, MCE, Brier and a per-bin table. `calibrationSamples(score, predDoc)` builds the samples.
- **Benchmark C** (`benchmark.ts`): `scoreRun` and `summarize` report accuracy, latency p50/p90/p95/p99, failure/timeout/retry rates, cost, bytes sent and the register summary.
- **Cost** (`cost.ts`): mirrors `benchmarks/pricing.json` (a test enforces this). Thinking tokens are billed at the output rate, and unknown models throw.

## Attribution and error register (`attribution.ts`, `error-register.ts`)
- `attributeErrors(run, gold)` blames each non-correct field on the earliest stage that lost it. Possible causes:
  - `misread`
  - `structuring`
  - `regression`
  - `unsupported_inference`
  - `redacted` (a de-identification placeholder, not an OCR omission)
  - `unattributed`
- Each attribution carries an evidence trail.
- `ErrorRegister` records `clinicalType` (omission, hallucination, wrong_drug, unit/decimal/magnitude error, wrong_frequency, wrong_route, substitution, formatting, redaction) and a `severity` from the ordered, documented `SEVERITY_RULES` (R00–R11). For example, a drug dose with a unit or magnitude error is critical (R03), and a missing lab value is major (R08).
- Exports: `toJSON()` (rules, summary, errors), `toCSV()`, and rates per 100 docs and per 1,000 fields.

## Other modules
`deid.ts` (Rachel), `normalize.ts` (Rachel), `routing.ts`, `schema.ts`, `hash.ts`.

Run tests with `pnpm test` and type-check with `pnpm typecheck`.
