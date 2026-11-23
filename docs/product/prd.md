# MedOCR Hybrid — PRD

#BuildHybridAI 2026 entry. Design source: `/workspace/med-ocr/design.md`. Feature freeze Fri 27 Nov 2026. Submissions lock Mon 30 Nov 2026, 2:00 PM PT (Tue 1 Dec, 3:30 AM IST, Asia/Calcutta).

Not a medical device. Do not publish accuracy numbers until Sage has a committed run. Cost figures stay placeholders until official prices are filled in.

## Problem

A caregiver photographing a parent's prescription or lab report should not have to upload that page — name, ABHA, phone and all — to a cloud OCR app. On-device models keep the photo private but miss messy fields; cloud models are stronger on those fields but should never see the image or the identifiers. MedOCR Hybrid runs Gemini Nano on the device via Firebase AI Logic (`ONLY_ON_DEVICE`): it transcribes, redacts, and structures JSON. Only de-identified text for low-confidence fields goes to `gemini-3.5-flash-lite`. If the two disagree, the caregiver confirms.

## User stories

Priya manages a parent's prescriptions and lab reports.

- She signs in (Firebase Auth; Anonymous is enough) with App Check on every AI call.
- She photographs or uploads a JPEG/PNG, or drops a PDF that is rasterized on the device to page 1 only.
- She sees structured medicines or lab results, with shaky fields marked and personal details already stripped.
- Low-confidence fields are checked in the cloud as de-identified text only — never the photo, never raw PII.
- If on-device and cloud disagree on a critical field, she confirms or corrects it before it is final.
- If Nano is unavailable, she is told why and her live photo is not silently uploaded.

Judges also need a three-column demo (on-device, cloud, hybrid) and a live Remote Config threshold change.

## Scope

**In:** Prescriptions and lab reports, single page. Web on Chrome desktop 139+ with the multimodal Prompt API flag. Two on-device calls (Nano read, then Nano structure), then cloud verify and human confirm. Shared `ClinicalDoc` schema. Firebase AI Logic for all inference; App Check, Auth, Firestore (metrics only), and Remote Config (`accept_on_device_threshold` default 0.85, `human_review_threshold` default 0.5). Split-screen demo with CER/WER, field accuracy, stage attribution, latency, and bytes leaving the device. A small hand-labeled set (~20 docs) plus already-redacted public samples. Android is a stretch, not a freeze gate.

**Out:** The SoalTech multi-model portal (after 1 Dec). iOS. Discharge, radiology, notes, multi-page stitch. Brand-to-generic inference. Real patient records. Invented benchmark numbers. Using `PREFER_ON_DEVICE` to send a live caregiver image to the cloud.

**Privacy:** No raw PII and no live image leaves the device (cloud prompts, Firestore, logs, or the repo). The cloud receives document type, low-confidence field keys, de-identified context, and placeholders such as `[NAME]`, `[ABHA_NUMBER]`, `[AADHAAR]`, `[PHONE]`, `[EMAIL]`, `[REG_NO]`, `[ID]`. Firestore stores run metrics only — not images, transcripts, or PHI. The split-screen *cloud-only* column may send a redacted public sample image and must be labeled as such; that is the bytes comparison, not the caregiver path.

**When Nano is missing** (wrong browser, flag off, download in progress, unsupported device): explain the cause, start the download after a user gesture if possible, offer curated samples, and do not upload the live photo.

## Demo flow (≤ 3 minutes)

1. **0:00–0:20 — Problem.** A caregiver photographs a labeled synthetic Indian prescription. Cloud apps would upload the name and ABHA; we will not.
2. **0:20–1:20 — Split screen.** On-device, cloud, and hybrid on the same sample: fields, `inferenceSource`, latency, and bytes that left the device.
3. **1:20–1:50 — Refuse to guess.** A smudged frequency disagrees and goes to human confirm. Attribution shows which stage introduced the error.
4. **1:50–2:20 — Tunable trust.** A Remote Config change shifts routing live.
5. **2:20–3:00 — Close.** Disclaimer; Firebase AI Logic, App Check, Auth, Firestore, Remote Config. Web is the recorded platform. Android only if a stable build exists. No invented numbers.

Harvey owns the recording; this is the beat sheet.

## Acceptance (short)

- **Auth / App Check.** Sign-in works. App Check is enforced on AI Logic. Debug tokens are not in git.
- **Capture.** JPEG/PNG upload works. Web PDFs are rasterized locally to page 1; the PDF is never sent to a model.
- **On-device.** After a Scan gesture, `initializeDeviceModel()` runs, then Nano read + structure with `ONLY_ON_DEVICE` and `inferenceSource === on_device` on the prepared Chrome machine.
- **De-identification.** Nano redaction plus the regex safety net run before any cloud call. Live-capture cloud payloads contain no image and no unredacted PII.
- **Routing / cloud / confirm.** Remote Config thresholds are visible in the demo. Cloud verify is `ONLY_IN_CLOUD`, `gemini-3.5-flash-lite`, de-identified text only. Critical-field disagreements, or cloud confidence below `human_review_threshold`, go to human confirm — never auto-guessed.
- **Split screen.** Three columns on one redacted sample, with source, latency, and bytes. Cloud-only is labeled as a redacted sample.
- **Scoring / Firestore.** Stage artifacts are kept. CER/WER and field scores are computed where references exist; failed docs stay in the denominator. **Targets: TBD (dataset).** Firestore writes are metrics-only and per-user.
- **Fallback / Android / submit.** Live photos are never sent to the cloud when Nano is unavailable. Android is stretch. Public Apache-2.0 repo, ≤3-minute video, Devpost text, no secrets or PII; submit by Mon 30 Nov, 2:00 PM PT.
