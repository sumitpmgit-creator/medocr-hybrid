# MedOCR Hybrid Bench — Design

One codebase, two products:

1. **#BuildHybridAI 2026 entry**: a web app (Android later) that reads medical documents on the device with Gemini Nano. Only de-identified, low-confidence fields go to the cloud, and the app proves the hybrid split with live metrics.
2. **SoalTech model-testing portal**: the same core runs server-side to benchmark open-source OCR and VLM pipelines (PaddleOCR → Qwen, Surya, DeepSeek-OCR-2, and others) against verified references. Nano and Gemini are two more candidates on the same chart.

Status: finalized on 23 Nov 2026. Deadline: Devpost submission closes **30 Nov 2026, 2:00 PM PT (1 Dec, 3:30 AM IST)**. Our internal target is **30 Nov, 2:00 PM IST**.

> Clinical-use caution (from the SoalTech spec): benchmark scores do not establish clinical safety. We pitch "medical-grade accuracy and privacy for reading records", never diagnosis. Under India's CDSCO rules, software that interprets data for diagnosis can count as a medical device.

---

## 1. Architecture

```
                         ┌──────────────── packages/core (TypeScript, no Firebase deps) ───────────────┐
 image/PDF ──pdf.js──►   │ Stage interface → Pipeline runner → per-stage trace (StageResult[])          │
                         │ Scoring: A (CER/WER on reading stage) · B (field P/R/F1 + safety screen)      │
                         │          C (end-to-end: accuracy + latency + cost + bytes sent + referrals)   │
                         │ Error attribution (first stage that lost the correct value)                   │
                         │ Clinical error register (critical/major/moderate/minor, per-100-doc rates)    │
                         │ De-identification safety net · Routing + reconciliation · Shared JSON schema  │
                         └───────────────▲───────────────────────────────────────▲──────────────────────┘
                                         │                                       │
         apps/web (Vite, hackathon)      │                 SoalTech portal (after 1 Dec)
         Firebase AI Logic hybrid SDK    │                 server workers wrap PaddleOCR / Qwen / Surya…
         Nano stages + cloud stages ─────┘                 as Stages; same scorer, same register
         Auth · App Check · Remote Config · Firestore (metrics only)
```

Repo layout (shared with other agents; owners in brackets):
- `packages/core`: the stage interface, runner, scoring, attribution, register, de-identification, and routing [Louis, after the initial scaffold]
- `packages/parsing`: extraction prompts and parsers [Rachel]
- `apps/web`, `apps/android` [Avenger]
- `datasets/` [Rachel]; `scripts/import_datasets.py` is the importer
- `infra/`, `.github/`, `firebase.json`, rules files, LICENSE [Donna]
- `qa/`, `benchmarks/` [Sage]
- `docs/submission`, `docs/product` [Harvey, Mike]

## 2. Stage interface (`packages/core/src/types.ts`)

```ts
interface Stage {
  id: string; name: string;
  kind: 'ocr' | 'structure' | 'ocr+structure' | 'deid' | 'verify' | 'route';
  accepts: ('image' | 'text' | 'fields')[];
  run(input: StageData, ctx: StageContext): Promise<StageResult>;
}
type StageData =
  | { kind: 'image'; image: ImagePayload }                               // PNG/JPEG base64
  | { kind: 'text'; text: string; spans?: TextSpan[]; image?: ImagePayload }  // text + positions
  | { kind: 'fields'; doc: ClinicalDoc; text?: string; image?: ImagePayload };
interface StageResult {
  stageId; stageKind; site: 'on_device' | 'in_cloud' | 'local_code' | 'server_gpu' | 'human';
  output: StageData; confidence?; raw?; error?; notes?;
  metrics: { latencyMs; costUsd; bytesSent; inputTokens?; outputTokens? };
}
```

- A **Pipeline** is `{ id, name, stages: Stage[] }`. `runPipeline()` keeps every intermediate output, stops at the first failure, and returns the partial trace, which makes it possible to rerun only failed runs later.
- `site` mirrors Firebase AI Logic's `response.inferenceSource` (`on_device` / `in_cloud`), so the demo reports where each step actually ran, not where we intended it to run.
- Adding PaddleOCR or Qwen later means writing an adapter that calls a server endpoint and returns a `StageResult`. Nothing else changes.

## 3. Data model

**ClinicalDoc** (one shared JSON Schema, `CLINICAL_DOC_JSON_SCHEMA`, used as the Nano `responseConstraint` and the cloud `responseJsonSchema`):
- `documentType`: prescription | lab_report | discharge_summary | other
- `medications[]`: name, strength, dosageForm, dose, route, frequency, timing, duration, quantity, instructions, sourceText, confidence
- `labResults[]`: test, value, unit, referenceRange, flag, sourceText, confidence
- `abstentions[]`: items the model refused to guess, plus "HUMAN CONFIRM …" entries from routing

**DatasetItem** (importer manifest line): id, dataset, datasetVersion (HF commit sha), license, imagePath, documentType, referenceText?, rubrics?, prompt?, handwritten?

**Firestore** (metrics only; no image, transcript or PHI is ever written):
- `users/{uid}/runs/{autoId}`: pipelineId, cer, wer, fieldF1, latencyMs, bytesSent, costUsd, failed, createdAt
- Later (portal): `benchmarks/{benchId}/runs/{runId}`, `.../errors/{errorId}` (ClinicalError), `datasets/{id}` (version and license), `reviews/{id}` (the human review log)
- Rules: a user may read and write only under `users/{request.auth.uid}`. Donna owns the rules file.

## 4. Scoring definitions

**Benchmark A: OCR**, scored on the output of the *reading* stage (the first `ocr` or `ocr+structure` stage). De-identification stages are skipped, so redaction never counts as an OCR error.
- CER = (S + D + I) / N_ref_chars, computed over Unicode code points after NFC and whitespace collapse. WER uses the same formula over whitespace tokens. Both can exceed 100%.
- Also computed: omission rate, invention rate, and numeric accuracy (numbers reproduced exactly, including decimals and signs).

**Benchmark B: clinical fields**, scored on the final `fields` output.
- Entities are matched greedily by normalised name similarity (≥ 0.7). The scorer then compares each field pair.
- Outcomes: correct, wrong, missing, or unsupported (a value with no reference).
- Precision = correct / predicted fields. Recall = correct / expected fields. F1 is their harmonic mean. Exact match = recall after *permitted normalisation*: frequency abbreviations (BD → 1-0-1, TDS → 1-1-1, OD/HS/SOS…), strength and unit spelling (625MG = 625 mg, µg = mcg), and numbers (12.50 = 12.5). Source values are never rewritten.
- A **formatting-only** difference (raw strings differ but the normalised values match) is logged as Minor.
- **Safety screen (spec rule)**: any wrong, missing or unsupported *critical* field fails the document, whatever the F1. Critical fields are medication name, strength, dose, frequency and route, and lab test, value and unit.

**Benchmark C: end to end, per pipeline**: mean CER/WER, mean field F1, safety pass rate, critical errors per 100 docs, mean latency, total cost, total bytes sent, and the share routed to cloud or human.

**EkaCare caveat (verified from the dataset card)**: EkaCare publishes images, prompts and expert-derived *rubrics*. It does **not** publish transcriptions or ground-truth JSON, so it supports rubric (LLM-judge) scoring for B, not CER. For CER we use African Medical Records (single-page image + transcription, CC-BY-4.0, public) and ~20 hand-transcribed Indian prescriptions or lab reports that Sumit creates himself (see §10).

## 5. Error attribution and the clinical error register

For each non-correct field in the final output, the attribution walks the stage trace in order:
- A text stage "holds" the value if it appears fuzzily in its text (similarity ≥ 0.85).
- A fields stage holds it if the field matches after normalisation.
- The **first stage that fails to hold the value is blamed**:
  - `misread`: the reading stage never had it.
  - `structuring`: the text had it, but the structured field is wrong. This is SoalTech's PaddleOCR → Qwen case, and a unit test covers it.
  - `regression`: a later verify stage broke a value that was correct.
  - `unsupported_inference`: the value appears in no upstream text, i.e. a hallucination.

The **register** (`ErrorRegister`) stores the stage, cause, entity, field, expected and actual values, error type (substitution, omission or insertion), severity, an optional bbox, and a crop reference. Severity follows spec section F:
- **Critical**: wrong drug identity, strength, dose, frequency or route; wrong lab value or test.
- **Major**: duration, timing or quantity; lab unit or flag; an invented lab row.
- **Moderate**: other metadata.
- **Minor**: formatting only.

The register reports counts per 100 docs and per 1,000 fields, errors by stage, and a CSV export (the ZIP export comes later).

## 6. Routing logic (hybrid pipeline)

```
image ─► nano-read (ONLY_ON_DEVICE, image+text → transcript, Nano told to redact PHI)
      ─► nano-structure (ONLY_ON_DEVICE, text → ClinicalDoc JSON via responseConstraint)
      ─► cloud-verify:
           for each medication / lab entity:
             confidence = grounded ? self_reported : min(self_reported, 0.4)
               (grounded = every key value appears in the transcript; small-model self-confidence is poorly calibrated)
             confidence ≥ accept_on_device_threshold  → accept on device (nothing sent)
             else                                     → send_to_cloud
           if any sent: regex de-identification of transcript (Aadhaar, ABHA no./address, +91 phones,
                        email, labelled names, Dr/Mr/Mrs names, Reg. No, UHID/MRN) → ONLY_IN_CLOUD
                        gemini-3.5-flash-lite with de-identified TEXT ONLY (never the image) for those entities
           reconcile: device ≠ cloud on name/strength/frequency/dose (meds) or test/value/unit (labs),
                      or cloud confidence < human_review_threshold → "HUMAN CONFIRM" (never auto-guessed)
```

- Thresholds live in **Remote Config** (`accept_on_device_threshold` default 0.85, `human_review_threshold` default 0.5) and can be tuned live during the demo.
- `bytesSent` counts the exact UTF-8 bytes of each cloud prompt. For cloud-only it counts the prompt plus the base64 image, which is the headline privacy number.
- Why two Nano calls (read, then structure) and not one: it fits Nano's single-turn, one-image limit and keeps outputs short. It also gives the attribution engine a text checkpoint, so "Nano misread" can be told apart from "Nano mis-structured".

## 7. Firebase AI Logic: what was verified (23 Nov 2026)

Checked against the official docs (`firebase.google.com/docs/ai-logic/hybrid/web/*`, updated 18 Nov 2026) and against the type definitions installed from `firebase@13.4.0` (`@firebase/ai@3.1.0`):

- Imports: `getAI`, `getGenerativeModel`, `GoogleAIBackend`, `InferenceMode`, `Schema` from `firebase/ai`
- `getGenerativeModel(ai, { mode, onDeviceParams?, inCloudParams? })` (HybridParams)
- `InferenceMode.PREFER_ON_DEVICE | ONLY_ON_DEVICE | PREFER_IN_CLOUD | ONLY_IN_CLOUD` (runtime values `'prefer_on_device'`, etc.)
- `model.initializeDeviceModel(onDownloadProgress?)` must be called on or after a user gesture.
- `result.response.inferenceSource` is `'on_device' | 'in_cloud'` (SDK ≥ 12.5.0).
- Structured output, on device: `onDeviceParams.promptOptions.responseConstraint` (plain JSON Schema or `Schema`). In the cloud: `inCloudParams.generationConfig.responseMimeType: 'application/json'` plus `responseSchema` or `responseJsonSchema`.
- `onDeviceParams.createOptions.expectedInputs: [{type:'image'},{type:'text',languages:['en']}]`
- Image parts are `{ type: 'inlineData', inlineData: { data, mimeType } }`. The `type` field is required in this SDK version, and only JPEG or PNG works on device.
- The default cloud model is `gemini-3.5-flash-lite` (JS SDK ≥ 13.0.0). We still pin it explicitly.
- Not supported on device: chat, tools, PDFs and audio, URL file inputs, and countTokens in hybrid. On-device calls do not appear in AI monitoring.
- Platform: Chrome **desktop** 139+ with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled.
- App Check: the console workflow auto-enforces it for AI Logic. Local dev uses `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` before `initializeAppCheck`, and the printed token must be registered in the console.

## 8. Firebase setup checklist (Sumit)

1. Create a Firebase project (Spark is fine to start) and register a **Web app**.
2. Go to **AI Services → AI Logic → Get started** and choose the **Gemini Developer API**. App Check enforcement is switched on automatically.
3. **App Check**: register the web app with **reCAPTCHA Enterprise** and copy the site key. On localhost, set `VITE_APPCHECK_DEBUG=true`, open the app, copy the debug token from the console, and add it under App Check → Apps → Manage debug tokens. Never commit it.
4. **Authentication**: enable the Anonymous provider.
5. **Firestore**: create the database (asia-south1). Rules come from Donna.
6. **Remote Config**: add `accept_on_device_threshold` (number, 0.85) and `human_review_threshold` (number, 0.5), then publish.
7. Copy `apps/web/.env.example` to `apps/web/.env.local` and paste the web config and site key.
8. In Chrome desktop 139+: enable the flag, restart, and in DevTools run `await LanguageModel.availability()` and then `await LanguageModel.create()` to download Nano (it needs several GB of free disk).
9. Submit the hackathon **Sprint 3 quota request before 25 Nov, 10:00 AM PT (25 Nov, 11:30 PM IST)**.
10. Android (stretch): check that the phone supports AICore or the ML Kit Prompt API. Nano does not run in the background, so use a foreground service.

## 9. Day-by-day build order (all dates IST)

| Day | Goal | Done when |
|---|---|---|
| **Mon 23 Nov** | Core scaffold, scorer, attribution, register, de-identification, routing, web scaffold, importer, this doc | 26 unit tests pass, web builds ✅ |
| **Tue 24 Nov** | Sumit sets up Firebase and Chrome. First real Nano and cloud calls on 3 AMR images and 3 Indian prescriptions; tune prompts; downscale images ≤ 1,600 px before Nano | All 3 pipelines return JSON for 6 docs |
| **Wed 25 Nov** | Reference set: ~20 Indian prescriptions or lab reports, hand-transcribed with ground-truth JSON. Batch runner over the manifest; Benchmark C table; Remote Config live tuning. **Quota request by 11:30 PM IST** | Benchmark table for 20 docs × 3 pipelines |
| **Thu 26 Nov** | Demo UI: split screen, diff highlighting, image crops for flagged fields, "data receipt" (bytes and identifiers removed), human-confirm queue | Usable end to end on Chrome |
| **Fri 27 Nov** | **Feature freeze.** Firestore history, App Check in production mode, Firebase Hosting deploy, README | Public URL works with App Check enforced |
| **Sat 28 Nov** | Hardening: offline mode, Nano-unavailable fallback messaging, error states, accessibility. Optional Android proof (ML Kit Prompt API) | No crashes on 20-doc batch |
| **Sun 29 Nov** | Record a demo video of 3 minutes or less; write the Devpost story; recheck the project gallery | Video uploaded (unlisted) |
| **Mon 30 Nov** | Make the repo public (Apache-2.0); submit by **2:00 PM IST**; buffer until the real deadline at 3:30 AM IST on 1 Dec | Submitted |

## 10. Demo video outline (≤ 3:00)

1. **0:00–0:20: Problem.** A caregiver photographs a handwritten Indian prescription. Cloud OCR apps upload the full image with the patient's name and ABHA ID, and LLMs silently get doses wrong (the PaddleOCR → Qwen story).
2. **0:20–1:20: Live split screen.** On-device only, cloud only and hybrid run side by side, showing CER, field F1, safety screen, latency, cost, and **bytes that left the device** (cloud-only: hundreds of KB including the image; hybrid: a few hundred bytes of de-identified text or 0).
3. **1:20–1:50: Refuse to guess.** A smudged frequency gets flagged, device and cloud disagree, and it goes to HUMAN CONFIRM with an image crop. The stage-blame view shows the error was introduced at nano-structure, not at reading.
4. **1:50–2:20: Tunable trust.** A Remote Config threshold change live in the console shifts the routing mix. The benchmark table covers 20 documents.
5. **2:20–2:45: Same core powers a real clinic benchmark.** SoalTech's portal compares Nano and Gemini against open-source pipelines.
6. **2:45–3:00: Architecture slide** (Firebase AI Logic hybrid, App Check, Auth, Firestore, Remote Config) and close.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Nano unavailable on judges' machines (needs Chrome desktop, the flag, and disk) | `PREFER_ON_DEVICE` fallback path; recorded demo; clear in-app status; `inferenceSource` shown honestly |
| Nano reads dense or handwritten pages poorly | Downscale and crop; route more to the cloud; show it honestly; this is the value of the routing |
| Self-reported confidence is uncalibrated | Grounding check (the value must appear in the transcript); human confirm on disagreement |
| No public Indian ground truth with transcriptions (EkaCare has rubrics only) | Hand-label ~20 docs; use AMR for CER; EkaCare rubric judging is a stretch |
| Regex de-identification misses free-text names | Two layers (Nano redaction + regex); the cloud never receives the image; documented as a safety net, not anonymisation |
| Medical claims scrutiny / CDSCO | "Reading records" framing; abstention; no diagnosis; disclaimers |
| Cloud model routing changes on 1 Dec | Model pinned to `gemini-3.5-flash-lite` |
| Quota exhaustion during judging | Sprint 3 quota request by 25 Nov; App Check; batch only from the developer account |
| Large bundle (pdf.js about 1.3 MB worker) | Lazy-load pdf.js after Day 4 |
| Late start (7 days) | Feature freeze 27 Nov; Android is a stretch goal only |
| Cost numbers | `packages/core/src/cost.ts` prices are **placeholders (0)**; fill them from the official pricing page before quoting |

## 12. Deferred until after 1 Dec (interface already supports these)

The open-source stages (PaddleOCR, Qwen3.5-4B/9B, Surya, docTR, Tesseract, DeepSeek-OCR-2) as server-side Stages; the hardware and cost dashboard; the human review log UI; rerunning failed runs only; ZIP export; Gujarati and Hindi sets (Sarvam, Nayana); TEDS for tables; bounding-box IoU; RxHandBD and Bilingual Prescriptions importers; EkaCare rubric judge.
