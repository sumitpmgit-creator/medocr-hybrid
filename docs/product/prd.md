# MedOCR Hybrid — PRD v0.1

**Product:** MedOCR Hybrid, Sumit's entry for #BuildHybridAI 2026.  
**Author:** Mike (PM). **Date:** Mon 23 Nov 2026.  
**Status:** Draft for build. Reconcile if `/workspace/med-ocr/design.md` lands (it was not in the workspace when this was written).  
**Horizon:** Feature freeze Fri 27 Nov 2026, 11:59 PM IST (Asia/Calcutta). Submissions lock Mon 30 Nov 2026, 2:00 PM PT / Tue 1 Dec 2026, 3:30 AM IST (Asia/Calcutta).

This is a 7-day hackathon product, not the full SoalTech model-testing portal described in the 23 Nov 2026 technical handoff. We borrow the handoff's evaluation ideas (CER/WER, field accuracy, per-stage error attribution, a tight prescription and lab schema, and the clinical-use caution) and cut everything else.

---

## 1. Problem

A caregiver who manages a parent's paperwork takes phone photos of prescriptions and lab reports. Those images are hard to reread later, easy to lose, and unsafe to upload to a generic cloud OCR service: they contain the parent's name, date of birth, phone number, address, and hospital identifiers next to the clinical content the caregiver actually needs (medicine names and doses; test names and results).

On-device models can keep the photo on the phone, but they miss messy handwriting, unusual layouts, and low-confidence fields. Cloud models are stronger on those fields, but sending the raw image (or unredacted text) is the privacy failure.

MedOCR Hybrid runs extraction and PII redaction on the device with Gemini Nano, via the Firebase AI Logic hybrid SDK. Only de-identified text for low-confidence fields is sent to a cloud model (`gemini-3.5-flash-lite`). If the two still disagree, the caregiver confirms the field. The demo shows on-device, cloud, and hybrid side by side, with routing thresholds in Remote Config.

This is an assistive organizer, not a diagnostic or prescribing tool. Benchmark scores do not establish clinical safety.

---

## 2. User

**Primary user:** a caregiver (we use "Priya" in stories) who keeps a parent's prescriptions and lab reports in one place, usually from a phone camera or a WhatsApp/email PDF.

**Secondary users for the contest only:** judges and the team running a 3-minute split-screen demo and a scored pass on public, already-redacted samples.

Out of scope as users: clinicians, hospitals, the full SoalTech operations portal, and patients entering their own long-term record (one caregiver, one parent, for v0).

---

## 3. User stories

Must stories are the product. Should stories ship if they fit before freeze. Cut stories stay out of this entry.

| ID | Priority | Story |
| --- | --- | --- |
| US-01 | Must | As Priya, I sign in so only I can see this parent's documents (Firebase Auth + App Check). |
| US-02 | Must | As Priya, I capture a photo or upload an image (JPEG/PNG) of a prescription or lab report. |
| US-03 | Must | As Priya, on web I can drop a PDF and have the first page rasterized on the device (the repo already includes `pdfjs-dist`). The image, not the PDF, is what the model sees. |
| US-04 | Must | As Priya, the on-device model extracts a structured JSON record and redacts personal details before anything is stored in the cloud or sent to a cloud model. |
| US-05 | Must | As Priya, I can read the extracted medicines or lab results in plain language, with low-confidence fields marked. |
| US-06 | Must | As Priya, fields below the Remote Config confidence threshold are resent to the cloud as de-identified text only — never the photo, never unredacted text. |
| US-07 | Must | As Priya, if on-device and cloud values for a field disagree, I am asked to confirm or correct that field before it is saved. |
| US-08 | Must | As Priya, I can see a history of saved, de-identified documents (Firestore). Live photos are not uploaded. |
| US-09 | Must | As a judge (or Harvey, in the video), I can run the same sample in a three-column view: on-device, cloud, and hybrid, and see which fields were routed, which source was used, and latency. |
| US-10 | Must | As a judge, I can see that a Remote Config threshold change alters routing, without a new app release. |
| US-11 | Must | As Priya, if Gemini Nano is not available, the app tells me why and does **not** silently send my live photo to the cloud. See §8. |
| US-12 | Should | As Priya, I can open a curated sample document when I do not want to use a real photo (also the reliable demo path). |
| US-13 | Should | As Priya, on Android I can capture from the camera in-app, not only from the gallery. |
| US-14 | Should | As Sage, I can run CER/WER, field accuracy, and per-stage error attribution on a held-out public set and export a run report. |
| US-15 | Cut | Multi-parent profiles, sharing with siblings or a doctor, reminders to refill or retest, discharge summaries, radiology, multi-page records, iOS, and the SoalTech multi-model portal. |

---

## 4. Scope

### In scope (v0)

- Two document types: **prescription** and **lab report**, single page (web: first page of a PDF rasterized locally).
- Web (Chrome) and Android apps, both calling Firebase AI Logic for all AI inference. No direct calls to other model APIs.
- Required Firebase products: **Firebase AI Logic** (hybrid), **App Check**, **Authentication**, **Firestore**, **Remote Config**.
- On-device path: Gemini Nano extracts JSON and redacts PII. Input is text, or text plus one image (JPEG/PNG on web; a single Bitmap on Android).
- Cloud path: `gemini-3.5-flash-lite` through Firebase AI Logic, de-identified text only, for fields below the confidence threshold.
- Human confirm when the two sources disagree on a field.
- Split-screen demo of on-device vs cloud vs hybrid.
- Stage artifacts retained for scoring: on-device JSON, cloud JSON (if called), final JSON after human confirm, plus timings and `inferenceSource`.
- Scoring: CER/WER where a text reference exists; field-level accuracy where structured labels or rubrics exist; error attribution to on-device, cloud, routing, or human. **No published numbers until Sage has a committed reference run.**
- Dataset for build and demo: EkaCare Medical Records Parsing (288 Indian prescription and lab images; MIT; already PII-redacted; rubric-based references, not official structured JSON — see risks). A small labeled subset or rubric mapping is Rachel's job; size is not assumed here.
- A short clinical disclaimer in the app and the video.

### Out of scope (cut hard)

- The SoalTech portal: dataset importer UI, model registry, PaddleOCR / Qwen / Tesseract / docTR / Surya chains, GPU cost dashboards, and export packages for a six-part bench UI.
- iOS / Apple Foundation Models.
- Discharge summaries, clinical notes, radiology, medical forms, charts, multi-page stitching.
- Sending live caregiver images or unredacted OCR to the cloud, including as a "seamless" SDK fallback.
- Inferring a generic ingredient or a normalized dose that is not written on the page (safe abstention: leave unknown rather than guess). Brand-to-generic mapping is cut.
- Medication-database validation, clinician review workflows, real patient records, any clinical-safety claim.
- Multilingual as a must: Android on-device inference has only been validated for English and Korean (see §8). Indian letterheads in Latin script are in; a Hindi/Bangla accuracy target is not.
- LLM-as-judge on the full EkaCare rubric set, unless it fits after the must path and still goes through Firebase AI Logic.
- Notifications, sharing, payments, and a hosted production environment with real user data.

### v0 field schema

Align with the types that landed in `@med-ocr/core` and the tighter Nano subset in `@med-ocr/parsing` on 23 Nov (camelCase). Must fields follow the Nano subset so the on-device response stays inside Android token/output limits. Extra core fields are should, not must. `design.md` still overrides this if it lands before the Wednesday schema freeze.

**Must (Nano subset):** `documentType` of `prescription` | `lab_report` | `other`. `medications[]` with `name`, `dose`, `frequency`, `duration`, and per-field confidence. `labResults[]` with `test`, `value`, `unit`, `referenceRange`, and per-field confidence. Unknown values are `null` (safe abstention), not guessed.

**Should (already present on the core schema, fill when the text is explicit):** medication `strength`, `dosageForm`, `route`, `timing`, `quantity`, `instructions`, `sourceText`; lab `flag` (`high` | `low` | `normal` | `abnormal`); document-level `abstentions[]`.

**Cut for this entry:** `genericName` / brand-to-generic mapping; `documentType: discharge_summary` as a supported product type (if Nano emits `other` for those pages, do not build a discharge UI). Inferred abnormal flags when the page does not state one.

**On-device only (never sent to the cloud, never written to Firestore for a live capture):** patient name, date of birth, age, phone, email, address, Aadhaar, ABHA number or ABHA address, other government IDs, hospital UHID/MRN or equivalent, registration numbers, and signature or face crops. These may be shown in the session UI as redacted chips so Priya can see that redaction ran.

---

## 5. Demo flow (3-minute script)

Judges may score from the video alone. Official advice is that the first 30 seconds state who it is for, the problem, and how Firebase AI Logic makes it work. Maximum length is 3 minutes; only the first 3 minutes may be evaluated. English, or English subtitles. Show both platforms. No third-party logos we do not have rights to. Use public EkaCare (or similarly licensed, already-redacted) samples — not a real parent's document.

**0:00–0:30 — The idea.**  
"This is MedOCR Hybrid, for people who manage a parent's prescriptions and lab reports. Those photos are full of personal details, so we should not ship them to the cloud. We use Firebase AI Logic to run Gemini Nano on the device: it turns the page into JSON and strips PII. Only de-identified text for shaky fields goes to `gemini-3.5-flash-lite`. If the two disagree, the caregiver confirms."

**0:30–1:10 — Caregiver path, web, Chrome on Desktop.**  
Sign in (Auth; App Check is on). Open a sample prescription. The first tap calls `initializeDeviceModel()` (required after a user gesture on web) and we say, if needed, that the on-device model may already be downloaded on the demo machine. Show the extracted medicines, redacted name chips, and one low-confidence frequency field marked. Show the cloud request pane: field key, de-identified context, typed placeholders such as `[NAME]`, `[ABHA_NUMBER]`, `[PHONE]` — no image, no raw name. If the values disagree, confirm the field.

**1:10–2:10 — Split screen, then Android.**  
Run the same sample in three columns: On-device, Cloud, Hybrid. Each column shows `inferenceSource` (`ON_DEVICE` or `IN_CLOUD`), latency, and structured fields. The hybrid column highlights routed fields and any human confirm. Change the Remote Config confidence threshold and rerun so routing visibly changes. Cut to Android: sign in, open the same sample (camera capture if it is stable), hybrid result, one confirm. Say that both apps share the same engine and privacy rules.

**2:10–2:40 — Trust and scoring.**  
A compact score view on a public sample: CER/WER, field accuracy, and which stage introduced an error (on-device, cloud, routing, or human). If a committed reference run is not ready, show the method and the artifacts, not invented numbers. On-screen disclaimer: not a medical device; not clinical validation.

**2:40–3:00 — Close.**  
Restate the rule: the live photo and raw PII never leave the phone. Mention Firestore history, Remote Config, web plus Android. End.

Harvey owns the recorded narration and may tighten wording; this is the required beat sheet.

---

## 6. Success metrics

Do not treat the following as publishable model quality until Sage records a committed reference run. Placeholders are marked TBD (dataset).

**Contest (must pass):**

- Stage One eligibility: public open-source repo (Apache-2.0 is already on the scaffold; preferred by the rules), Firebase AI Logic imported and called at runtime on web and Android, App Check present, demo video ≤ 3 minutes on YouTube, Devpost text that explains the hybrid design, no secrets or PII in the repo or testing instructions.
- Judges can follow a working web URL and/or an Android test build, with a test login if needed.
- The video and the apps demonstrate on-device, cloud, and hybrid, and the privacy envelope.

**Product quality (measure; do not invent targets):**

- CER and WER on transcription where a text reference exists. TBD (dataset).
- Field exact-match / precision / recall on the labeled or rubric-mapped subset, reported separately for prescriptions and lab reports, and separately for critical fields (medication `name`, `dose`, `frequency`, and `strength` when present; lab `test`, `value`, `unit`). TBD (dataset).
- Error attribution coverage: every scored field error is assigned to on-device, cloud, routing, human, or "unknown." Target for the method: 100% of scored errors have a stage label. Quality of those labels is reviewed by Sage, not thresholded here.
- Human-confirm rate and disagreement rate, reported, no target.
- Privacy tests: 100% of cloud requests in the test suite contain neither an image nor an unredacted PII span.
- Latency: record on-device, cloud, and end-to-end p50/p95 on the demo machine. No pass/fail number for v0.
- Critical-field safety screen (from the SoalTech spec): a high overall field score cannot hide an incorrect medicine identity, dose, or frequency. Report a critical-error count. No numeric cap until the dataset exists.

**Experience:**

- A judge can complete the caregiver happy path on web in well under the video's first two minutes.
- Android shows the same hybrid path, even if the UI is thinner than web.

---

## 7. Privacy rules

### The rule

**No raw PII and no live document image leaves the device.** "Leaves the device" includes cloud model calls, Firestore, analytics, logs, crash reports, and the public repo.

This is stricter than the SDK's `PREFER_ON_DEVICE` fallback, which would send the original prompt (including an image) to the cloud when Nano is missing. We do not use that behavior for live caregiver captures. See §8.

### PII we treat as raw (never in a cloud prompt, never in Firestore for a live capture)

Patient name and aliases; date of birth; age when it is identifying; phone; email; physical address; Aadhaar; ABHA number and ABHA address; other government IDs; hospital UHID, MRN, or other patient record numbers; clinician or hospital registration numbers used as identifiers; signature images; face crops; the original photo or PDF; unredacted OCR or unredacted page text. Doctor and hospital names are a residual risk: over-redact when labelled (for example "Dr. …"), but do not claim perfect free-text anonymisation.

### What the cloud model receives

A single Firebase AI Logic request to `gemini-3.5-flash-lite` (`ONLY_IN_CLOUD` or an equivalent dedicated instance), containing only:

- `document_type` (`prescription` or `lab_report`);
- the low-confidence field keys being asked about;
- de-identified values and a short de-identified text window around those fields (medicine names, strengths, frequencies, lab test names, numeric results, units, reference ranges);
- typed placeholders in any residual text, matching the on-device de-id safety net where it already exists: `[NAME]`, `[DOB]`, `[PHONE]`, `[EMAIL]`, `[ADDRESS]`, `[AADHAAR]`, `[ABHA_NUMBER]`, `[ABHA_ADDRESS]`, `[REG_NO]`, `[ID]` (UHID/MRN).

It does not receive the image, the PDF, unredacted text, or the on-device-only PII object.

Collection or report dates on a lab (for example "collected 12 Mar 2026") may travel with the de-identified lab fields because they are part of the clinical result. If design.md tightens this, follow design.md.

### What Firestore stores

Auth `uid`, document id, document type, timestamps, de-identified structured JSON, per-field confidence, per-stage `inferenceSource` and timings, disagreement flags, and human decisions. Not live images. Not raw PII.

Already-redacted public samples (EkaCare) may be referenced by dataset id for demo and scoring. Storing those public sample images in Firestore is a should, not a must, and only if the license and redaction status are recorded.

### Other

- App Check is required on every Firebase AI Logic call.
- No production API keys, App Check debug tokens, or `.env` files in the public repo. Debug tokens for judges go in the private testing instructions on Devpost, not in git.
- Evaluation references and rubrics are never sent to a model at inference time (SoalTech spec §7).
- Real patient records are not used in this entry.

---

## 8. Web vs Android: on-device availability and fallback

Sources, last updated 18 Nov 2026 UTC:

- Web get started: https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
- Web configuration: https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
- Android get started: https://firebase.google.com/docs/ai-logic/hybrid/android/get-started
- Android configuration: https://firebase.google.com/docs/ai-logic/hybrid/android/configuration-options

Hybrid inference in Firebase AI Logic is **experimental**. The SDK can use an on-device model when one is available and fall back to a cloud-hosted model otherwise. On-device inference supports single-turn text generation only (not chat), including text-only, text plus one image, and structured output (JSON/enums). All of our AI inference must go through this SDK.

### Web (Chrome)

- Requires Firebase AI Logic JS SDK **v12.5.0+**. The scaffold is on Firebase **^13.4.0**, which is new enough. From JS SDK v13.0.0 the default cloud model is **`gemini-3.5-flash-lite`**, which matches this PRD.
- On-device inference uses the **Prompt API from Chrome**, only on **Chrome on Desktop, version 139 or higher**.
- The multimodal on-device model is not on by default. The demo machine must set `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` to Enabled and restart Chrome.
- `initializeDeviceModel()` **must** be called after a user gesture (for example the first "Scan" click) and before the first on-device prompt. If the model is not downloaded, that call starts a download that can take several minutes. We wait and show progress; we do not hide this behind a spinner with no copy.
- On-device image types are **JPEG and PNG** only. PDFs, audio, and video are not supported on-device; a PDF must be rasterized locally first. Files must be inline, not URLs.
- `response.inferenceSource` is `ON_DEVICE` or `IN_CLOUD` (JS SDK v12.5.0+). The UI must display it.

### Android

- Requires Firebase AI Logic SDK **v17.10.0+** (BoM **v34.10.0+**) and the `firebase-ai-ondevice` library. That library raises the minimum API level to **26** (the cloud-only library is 24). We ship with min SDK 26.
- On-device inference uses the **Prompt API from ML Kit (beta)** and is limited to **specific devices**. The team must record which demo device is supported and have a backup. See the ML Kit device list linked from the Android get-started page.
- Input image: a **single Bitmap**. App must be in the **foreground**. Request limit is **4,000 tokens**; long outputs (more than 256 tokens) are discouraged — our schema must stay compact.
- Only **English and Korean** have been validated for on-device inference. We write English prompts and do not promise Indic-script accuracy on device.
- AICore can return `BUSY` or battery-quota errors. Retry with backoff; do not then send the live image to the cloud.
- On-device model category can be `STABLE` (default), `PREVIEW`, or `PREVIEW_FAST` (for example Gemini Nano 4 Full / Fast). Choose one in implementation notes; prefer a category that is actually present on the demo device. Preview models may need enrollment.

### Inference modes we use

The SDK modes are `PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, and `ONLY_IN_CLOUD`.

- **Live caregiver scan, on-device stage:** `ONLY_ON_DEVICE` (or a guarded call that we abort if `inferenceSource` would be `IN_CLOUD` with an image). This is how we enforce the privacy rule even though `PREFER_ON_DEVICE` is the docs' default.
- **Cloud assist on de-identified text:** a second model instance, `ONLY_IN_CLOUD`, `gemini-3.5-flash-lite`, text only.
- **Split-screen "Cloud" column on an already-redacted public sample:** `ONLY_IN_CLOUD` is allowed to send that sample image or its text, because the sample is already PII-redacted and licensed for this use. The UI must label it "cloud, redacted public sample," not "your photo was uploaded."
- We still record `inferenceSource` everywhere so a mistaken fallback cannot hide.

### When on-device is unavailable

Typical causes: not Chrome on Desktop 139+; flag off; model still downloading; unsupported Android device; app in background; AICore quota; `ONLY_ON_DEVICE` exception.

Fallback, in order:

1. Explain the cause in the UI (browser, flag, download progress, unsupported device).
2. If a download can start, start it from the user gesture and let Priya wait or switch to a sample document.
3. Offer curated already-redacted samples so the product and the split-screen remain usable.
4. **Do not** silently upload a live caregiver photo or unredacted text to the cloud.
5. Manual field entry is a should, not a must.

The recorded demo must run on a prepared Chrome Desktop machine and a Nano-capable Android device, with the on-device model pre-downloaded, so judges see a real `ON_DEVICE` `inferenceSource`. Have a backup recording device. If Nano fails during the dress rehearsal, Harvey records the cloud-column and hybrid-on-sample paths honestly, rather than violating the privacy rule for a smoother clip.

---

## 9. Risks

| ID | Risk | Why it matters | Mitigation |
| --- | --- | --- | --- |
| R1 | Gemini Nano is unavailable on the web or Android demo device | The video cannot show on-device inference | Prepare Chrome 139+ with the flag and a pre-downloaded model; confirm an ML Kit-supported Android device by Tue 24 Nov; backup device |
| R2 | `PREFER_ON_DEVICE` would leak live images | Breaks the privacy promise and the idea | Custom routing; `ONLY_ON_DEVICE` for live images; privacy tests owned by Sage |
| R3 | EkaCare has rubrics, not official structured JSON | Field-accuracy numbers can be weak or misleading | Rachel builds a small labeled subset and/or a rubric map; publish no numbers without a committed run; rubric-only is allowed if labeled JSON is thin |
| R4 | Android app does not exist in the scaffold yet | Multi-platform is preferred for Grand Prize; Advisory marked Android as required | Avenger starts Android on day one; cut polish before cutting the happy path (sign in, sample, hybrid, confirm) |
| R5 | On-device token/output limits and English-only validation | Long JSON or Indic script may fail or truncate | Compact schema; English prompts; safe abstention |
| R6 | Model download or first-run latency blows the 3-minute video | Judges may watch only the video | Pre-download on demo machines; do not start cold download in the recorded take |
| R7 | Feature creep from the SoalTech portal spec | We will miss freeze and submission | This PRD's cut list; tracker cut-line |
| R8 | Accidental secrets or PII in the public repo | Disqualification risk | Donna checklist; Sage scan before the repo goes public |
| R9 | Peak memory / OOM or AICore quota during bench or demo | Failed recorded take or failed judge test | Small demo set; backoff; Sage does not block the box with an unbounded run during rehearsal |
| R10 | design.md or a schema change lands mid-week | Rework | Reconcile this folder the same day; freeze schema on Wed 25 Nov if design.md is still absent |
| R11 | Submission is late (deadline is 3:30 AM IST on 1 Dec) | Hard lock; late repo commits do not count | Video uploaded Sat; Devpost draft Sun; submit by Mon 30 Nov, 9:00 AM IST |
| R12 | Experimental SDK or model-name drift (Gemini 2.5 shutdown notes in the current docs) | Breakage during the contest window | Pin documented model `gemini-3.5-flash-lite`; no last-minute model swaps after freeze |

---

## 10. Open questions

For Advisory or Sumit. None of these block writing code against this PRD; several block a safe demo or submission.

1. `/workspace/med-ocr/design.md` was not present when this PRD was written. Should we treat this document as the product contract until it lands?
2. Who is the Devpost representative, and is the team already entered? Only Sumit can submit.
3. Public GitHub or GitLab repo name and org (Donna needs this early; the workspace was not a git repo at the time of writing).
4. Which Chrome Desktop machine and which Nano-capable Android devices will be used for the recording? Confirm by Tue 24 Nov.
5. How large a structured-label set can Rachel reasonably produce by freeze, given EkaCare's rubric-only public fields? Is rubric-only scoring acceptable in the video if labels are thin?
6. Confirm the live-image privacy fallback in §8 (no silent cloud upload of caregiver photos). This is a stricter story than the SDK default.
7. iOS is cut. Confirm.
8. Disclaimer language Sumit wants in the app and video (a one-line non-clinical statement is assumed).
9. Judge test login: email/password vs a provided Google account, and who creates it (no secrets in git).
10. May already-redacted public sample images be stored in Firestore for the demo, or only referenced locally?
11. Default Remote Config threshold: the app will ship a visible demo default (implementation can start at 0.70) that is **not** a validated operating point. Sage may change it after the first scoring run.
12. May lab collection dates leave the device with de-identified lab fields? This PRD allows it.

---

## 11. Document history

| Version | Date (IST, Asia/Calcutta) | Notes |
| --- | --- | --- |
| v0.1 | Mon 23 Nov 2026 | First draft from the Advisory brief, the SoalTech handoff, the repo scaffold, current Firebase AI Logic hybrid docs (updated 18 Nov 2026 UTC), and the #BuildHybridAI official rules and FAQs. design.md not yet available. Same-day pass to align field names and Indian ID placeholders with `@med-ocr/core` / `@med-ocr/parsing` and the de-id safety net that landed while this folder was being written. |
