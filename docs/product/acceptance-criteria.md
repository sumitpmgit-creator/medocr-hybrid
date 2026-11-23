# MedOCR Hybrid — acceptance criteria

**Companion to:** [prd.md](./prd.md) v0.1.  
**Author:** Mike (PM). **Date:** Mon 23 Nov 2026.  
**Priorities:** **Must** ships before feature freeze (Fri 27 Nov 2026, 11:59 PM IST, Asia/Calcutta). **Should** ships if it does not put a must at risk. **Cut** is explicitly out of this entry.

Owners below are the people who make the criterion true. Sage verifies every **Must** before the dress rehearsal. Metric numbers that depend on the dataset are written as **TBD (dataset)** and must not be invented or published until Sage has a committed reference run.

How to read a row: the criterion is testable as written. If a test needs a specific device or browser, that is part of the done definition.

---

## F01 — Auth and App Check

Owner: Donna (Firebase), with Avenger wiring both clients.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-01 | Must | A user can sign in on web and on Android with Firebase Auth. An unauthenticated user cannot read another user's Firestore documents. |
| AC-02 | Must | App Check is enforced on Firebase AI Logic, Firestore, and Remote Config in the shipped builds. Debug tokens work for local and judge testing and are not committed to the repo. |
| AC-03 | Should | A judge test account is described in Devpost testing instructions (not in git), and a fresh sign-up path works without a waitlist. |

## F02 — Capture and upload

Owner: Avenger. PDF rasterization uses on-device `pdfjs-dist` on web. Rachel provides sample files.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-04 | Must | Web and Android accept a JPEG or PNG of a prescription or lab report and pass a single inline image into the on-device stage. |
| AC-05 | Must | On web, a PDF is rasterized locally to a PNG or JPEG of **page 1 only** before any model call. The PDF file is not sent to Firebase AI Logic. |
| AC-06 | Should | Android can capture from the in-app camera, not only the gallery, while the app is in the foreground. |
| AC-07 | Cut | Multi-page stitch, batch folder upload, and raw PDF-to-model input. |

## F03 — On-device extract and PII redaction

Owner: Louis (engine), Rachel (schema and redaction rules), Avenger (UI).

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-08 | Must | On a prepared Chrome Desktop 139+ machine with the multimodal Prompt API flag enabled, and on a documented ML Kit-supported Android device, a successful live or sample scan returns `inferenceSource === ON_DEVICE` for the extract stage. |
| AC-09 | Must | The extract stage is a single-turn Firebase AI Logic call that returns structured JSON matching the v0 Nano subset in the PRD (`documentType`, `medications[]` with `name` / `dose` / `frequency` / `duration`, or `labResults[]` with `test` / `value` / `unit` / `referenceRange`, with per-field confidence). All AI inference goes through Firebase AI Logic; no other model API is called. |
| AC-10 | Must | PII listed in PRD §7 is redacted on device before any cloud model call or Firestore write for a live capture. Redaction uses typed placeholders (`[NAME]`, `[DOB]`, `[PHONE]`, `[EMAIL]`, `[ADDRESS]`, `[AADHAAR]`, `[ABHA_NUMBER]`, `[ABHA_ADDRESS]`, `[REG_NO]`, `[ID]`). |
| AC-11 | Must | The on-device stage is invoked with `ONLY_ON_DEVICE` (or an equivalent guard). A live caregiver image is never attached to a cloud-mode request. |
| AC-12 | Must | On web, `initializeDeviceModel()` runs only after a user gesture and before the first on-device prompt. If the model is downloading, the UI shows that the wait can take several minutes. |
| AC-13 | Should | When a required field is not visible on the page, the model leaves it unknown rather than inventing a value (safe abstention). `genericName` is not a v0 must field; if present later, it is filled only when it is explicit in the text. |
| AC-14 | Cut | Brand-to-generic inference, medication-database validation, and discharge/radiology/notes schemas. |

## F04 — Confidence routing and Remote Config

Owner: Louis (router), Donna (Remote Config keys), Avenger (demo control).

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-15 | Must | A numeric confidence threshold is read from Remote Config (not hard-coded only). Changing the value and refreshing config changes which fields are routed, without a new app release. |
| AC-16 | Must | Only fields below the threshold are sent to the cloud assist stage. Fields at or above the threshold stay on the on-device value unless the user edits them. |
| AC-17 | Should | The shipped demo default is visible in the console and the UI, and is labeled as a demo default, not a validated operating point. Starting implementation value may be 0.70; Sage may change it after the first scoring run. |
| AC-18 | Cut | Per-document-type threshold curves, automatic threshold search, and confidence calibration claims. Self-reported model confidence is not treated as a calibrated probability (SoalTech spec). |

## F05 — Cloud assist (de-identified text only)

Owner: Louis, with Sage testing the payload.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-19 | Must | Cloud assist uses a dedicated Firebase AI Logic instance in `ONLY_IN_CLOUD` mode with model `gemini-3.5-flash-lite`. |
| AC-20 | Must | The cloud request body contains only the payload defined in PRD §7: document type, low-confidence field keys, de-identified values and a short de-identified context window, and typed placeholders. It contains no image, no PDF, and no unredacted PII span. |
| AC-21 | Must | An automated test or logged-payload inspection (Sage) fails the build if a cloud assist fixture includes an image part or any of the raw PII patterns under test. |
| AC-22 | Should | Cloud assist is skipped entirely when no field is below the threshold. The UI still completes and saves the on-device result. |

## F06 — Disagreement and human confirm

Owner: Louis (comparison), Avenger (UI), Sage (cases).

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-23 | Must | If on-device and cloud values for the same routed field differ after the documented normalization rules, the field is presented to the user for confirm or edit before it is saved as final. |
| AC-24 | Must | The final JSON records, for each confirmed field, the on-device value, the cloud value, and the human decision. |
| AC-25 | Should | Normalization rules are versioned and do not collapse clinically different values (for example `0-0-1` vs `1-0-1`, or `5 mg` vs `50 mg`), following the SoalTech handoff. |
| AC-26 | Cut | Second-reviewer workflows and clinician sign-off. |

## F07 — Split-screen demo

Owner: Avenger, with Louis exposing stage artifacts. Harvey uses this in the video.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-27 | Must | A three-column view on web shows On-device, Cloud, and Hybrid for the same already-redacted public sample, including structured fields, `inferenceSource`, and latency for each column. |
| AC-28 | Must | The Cloud column on a public redacted sample is labeled as such. It may send that sample image or text via `ONLY_IN_CLOUD`. It does not use a live caregiver photo. |
| AC-29 | Must | The Hybrid column highlights which fields were routed and which were human-confirmed. |
| AC-30 | Must | Changing the Remote Config threshold and rerunning a sample visibly changes routing in this view (US-10). |
| AC-31 | Should | Android has the same three-column comparison, even if layout is stacked rather than side by side. |
| AC-32 | Cut | Interactive bounding-box trace-back to source regions, and a six-part SoalTech portal compare UI. |

## F08 — Stage scoring

Owner: Sage (harness and runs), Rachel (references), Louis (artifacts).

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-33 | Must | Each run retains, unchanged: (1) on-device JSON, (2) cloud JSON when called, (3) final JSON, plus timings and `inferenceSource` by stage. Failed documents stay in the denominator. |
| AC-34 | Must | The harness computes CER and WER as `(S + D + I) / N_reference` (characters or words), lower is better, on documents that have a text reference. **Pass threshold: TBD (dataset).** |
| AC-35 | Must | The harness computes field exact-match (and precision/recall if labels allow) separately for prescriptions and lab reports, and reports critical fields separately (medication `name`, `dose`, `frequency`, and `strength` when present; lab `test`, `value`, `unit`). **Pass thresholds: TBD (dataset).** |
| AC-36 | Must | Each scored field error is attributed to on-device, cloud, routing, human, or unknown. Attribution coverage of scored errors is 100%. |
| AC-37 | Must | A high overall field score cannot hide a critical-field error: the report includes a critical-error count (wrong medicine identity, dose, or frequency; wrong lab result or unit). **Numeric cap: TBD (dataset).** |
| AC-38 | Must | No accuracy number is shown on the landing surfaces, pitch, or video unless it comes from a committed Sage reference run. If that run is not ready, the demo shows method and artifacts only. |
| AC-39 | Should | Rubric-based scoring for EkaCare items that have rubrics but no structured JSON, with rubrics never sent to the model at inference time. **Pass rate: TBD (dataset).** |
| AC-40 | Should | A downloadable run report (JSON or Markdown) with dataset version, model/SDK versions, threshold, and run id. |
| AC-41 | Cut | TEDS/layout metrics, GPU cost accounting, and a full public leaderboard. |

## F09 — Firestore persistence

Owner: Donna (rules and schema), Avenger (writes), Louis (payload shape).

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-42 | Must | After confirm, a de-identified record is written to Firestore for the signed-in user and can be reopened as history. |
| AC-43 | Must | Security rules deny reads and writes of one user's documents by another user, and deny unauthenticated access. |
| AC-44 | Must | Live-capture records in Firestore contain no original image and no raw PII fields listed in PRD §7. |
| AC-45 | Should | Public sample runs store a dataset id and license/redaction note. Storing the public sample image itself is optional. |

## F10 — Web app

Owner: Avenger. Platform constraints as in PRD §8.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-46 | Must | The web app on Chrome Desktop 139+ completes US-01 through US-11 for a sample document, including hybrid routing and human confirm when a disagreement is triggered. |
| AC-47 | Must | On an unsupported browser (for example Safari, or Chrome on Android), the UI explains that on-device inference needs Chrome on Desktop 139+ with the documented flag, and it does not upload a live photo to the cloud. |
| AC-48 | Should | A hosted web URL is available for judges by the submission draft (Sun 29 Nov). |
| AC-49 | Cut | Chrome extension, iOS Safari on-device, and a native desktop app. |

## F11 — Android app

Owner: Avenger. Donna supplies `google-services` setup without committing secrets.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-50 | Must | An Android app (min SDK 26, Firebase AI Logic SDK v17.10.0+ / BoM v34.10.0+, `firebase-ai-ondevice`) completes sign-in, open sample or image, hybrid extract, and human confirm on a documented Nano-capable device. |
| AC-51 | Must | On an unsupported device, the app explains that on-device inference is unavailable and does not upload a live photo to the cloud. Sample-document mode still works for the cloud column and for de-identified hybrid once a local extract exists; if extract cannot run, only samples already processed or already redacted are offered. |
| AC-52 | Should | A sideloadable test build (or internal-share link) is available for judges, with testing instructions and no production keys. |
| AC-53 | Should | Android shows `inferenceSource` and routed fields, even if the comparison is stacked. |
| AC-54 | Cut | Play Store listing, background inference, and a Wear or tablet-specific layout. |

## F12 — On-device unavailable fallback

Owner: Avenger (UX), Louis (guards). See PRD §8.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-55 | Must | For a live capture, if `ONLY_ON_DEVICE` fails or Nano is missing, the app shows a concrete reason (browser, flag, download in progress, unsupported device, quota) and does not send that image to the cloud. |
| AC-56 | Must | Curated already-redacted samples remain usable in that state so the split-screen demo can still be shown. |
| AC-57 | Should | Manual field entry when no model is available. |

## F13 — Dataset and demo corpus

Owner: Rachel. Sage consumes the corpus.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-58 | Must | A pinned EkaCare (or equally licensed) revision is recorded, with license and the known limitation that public fields include images, prompts, and rubrics, not official structured JSON. |
| AC-59 | Must | A demo set of 5–10 already-redacted documents (mix of prescription and lab) is checked into the agreed path, with a manifest in the spirit of the SoalTech imported-document manifest (`document_id`, `dataset`, `dataset_version`, `document_type`, `reference_type`). |
| AC-60 | Should | A small structured-label subset and/or rubric map exists for scoring, held out from prompt tuning. **Size and split: TBD (dataset).** |
| AC-61 | Must | No real patient records and no unredacted caregiver photos are in the repo, the video, or the Firestore production project. |
| AC-62 | Cut | Import of RxHandBD, MedDocBench, and the rest of the SoalTech priority lists, for this entry. |

## F14 — Privacy, logging, and repo hygiene

Owner: Sage (tests), Donna (repo and CI), Louis (payloads).

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-63 | Must | Automated or scripted checks on fixture cloud payloads pass AC-20 / AC-21. |
| AC-64 | Must | Client logs and crash reporting in the submission builds do not contain raw PII or live images. |
| AC-65 | Must | The public repo has an open-source license file (Apache-2.0 preferred), run instructions, and no API keys, service accounts, `.env` files, or App Check debug tokens. Firebase AI Logic is imported and actually called at runtime. |
| AC-66 | Should | CI runs unit tests for routing, redaction, and scoring math on every change to `packages/*`. |

## F15 — Pitch and submission package

Owner: Harvey, with Donna (repo/hosting) and Avenger (recorded surfaces). Sumit submits.

| ID | Priority | Criterion |
| --- | --- | --- |
| AC-67 | Must | A public YouTube video of at most 3 minutes, in English or with English subtitles, follows the PRD beat sheet: idea in the first 30 seconds; web happy path; split screen and Remote Config; Android; method/disclaimer; privacy close. It uses only licensed, already-redacted samples. |
| AC-68 | Must | Devpost text describes how Firebase AI Logic hybrid inference is used, the features, and the value for the caregiver audience, and lists what was built during the submission period. |
| AC-69 | Must | The submission is entered on Devpost before Mon 30 Nov 2026, 2:00 PM PT (Tue 1 Dec 2026, 3:30 AM IST). The tracker target is Mon 30 Nov, 9:00 AM IST (Asia/Calcutta). After submit, the entered repo is left untouched. |
| AC-70 | Should | A one-line non-clinical disclaimer appears in the app, the video, and the Devpost description. |

---

## Verification notes for Sage

- Web on-device tests require Chrome on Desktop 139+, flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, and a completed `initializeDeviceModel()` after a gesture.
- Android on-device tests require a device from the current ML Kit supported list, app in the foreground, and English prompts.
- Cloud-column tests on public samples are not a waiver of AC-11 or AC-20 for live captures.
- **TBD (dataset)** rows are reported, not gated, until Rachel and Sage agree a labeled or rubric-mapped set and Sage commits a reference run. Do not fill those blanks with estimates.
