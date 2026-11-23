# MedOCR Hybrid — Devpost project story

**Tagline:** Only de-identified text ever leaves the device.

First draft, 23 November 2026. Written in first person as Sumit. Aligns with `docs/product/prd.md` (design.md had not landed). Replace every `[TBD: …]` before pasting into Devpost — especially eval numbers, which Sage fills from a committed reference run near the deadline.

The official #BuildHybridAI 2026 form asks for a text description covering how we used Firebase AI Logic, the features, and the value proposition. The seven headings below are the usual Devpost project-story sections. A short official-description block is at the end. Video limit: 3 minutes; only the first 3 minutes may be evaluated.

**Responsible use:** MedOCR Hybrid is an assistive organizer for paper prescriptions and lab reports. It is not a medical device and not for diagnosis. A person confirms any field the on-device and cloud models cannot agree on. Benchmark scores are not clinical validation.

---

## Inspiration

I keep coming back to a familiar picture: a caregiver photographing a parent's prescription or lab report so the medicines and results are not lost in a stack of paper. The useful part of that photo is a handful of clinical fields. The dangerous part is everything around them — a name, a phone number, an ABHA ID.

Shipping the whole page to a cloud model is the obvious design, and the wrong one. The moment the image leaves the device, so does the parent's identity.

I also did not want a single accuracy percentage that hides where a pipeline failed. In SoalTech's early five-document check, an OCR stage could read the medicine names and dosing text correctly, and the next model could still get the identity or frequency wrong. If you only score the final JSON, you fix the wrong step.

MedOCR Hybrid is my answer to both problems: read the page on the device, strip personal details there, send only de-identified text for the fields the on-device model is not sure about, and ask the caregiver to confirm when the two models disagree. Score every stage so each error is pinned on the step that caused it. The same scoring core is what we want to grow, after this hackathon, into SoalTech's open-source model benchmarking portal.

## What it does

A caregiver — we call her Priya in our stories — signs in, then captures a photo or drops in a JPEG, PNG, or (on the web) a PDF whose first page is rasterized on the device. The live document stays on the device.

Gemini Nano, reached only through Firebase AI Logic, transcribes the page and extracts structured JSON (medicines, strengths, doses, frequencies; lab tests, results, units). Personal details are redacted on the device. A second, deterministic pass catches identifiers that the model may have missed (names, phone numbers, ABHA and Aadhaar numbers, emails, registration numbers, hospital IDs). High-confidence fields never need a network call.

Fields below a Remote Config confidence threshold are the only ones that leave the device. They go to `gemini-3.5-flash-lite`, also through Firebase AI Logic, as de-identified text. The image and the raw identifiers do not go with them. If the on-device and cloud values still disagree, Priya confirms the field before it is saved. The app does not quietly pick a winner.

If Nano is not available, the app explains why and does not silently upload a live photo. That is stricter than the SDK's default “fall back to the cloud when the local model is missing,” which would send the original image.

The demo runs the same already-redacted public sample in three columns — on-device only, cloud only, and hybrid — and compares them on reading accuracy, field accuracy, cost, and bytes sent off the device. Each stage keeps its own output so we can score:

- **Reading:** character and word error rates (CER / WER) — did we read what was written?
- **Structure:** field-level accuracy of the JSON — did we put the right text in the right field?
- **Attribution:** each error is charged to the stage that introduced it (on-device, cloud, routing, or human).

We use public, already-redacted samples (the EkaCare set of 288 Indian prescription and laboratory images is the first dataset in the repo) and clearly labelled synthetic documents. We do not use real patient records. Firestore, when used, stores only de-identified structured results and run metrics — not live images and not raw PII.

## How we built it

A pnpm monorepo, licensed Apache-2.0 in package.json:

- `apps/web` — a Vite app on the Firebase JavaScript SDK. All AI calls go through Firebase AI Logic. Live on-device work uses `InferenceMode.ONLY_ON_DEVICE` so a missing Nano model cannot quietly send the photo to the cloud. The cloud assist uses `ONLY_IN_CLOUD` and `gemini-3.5-flash-lite`, which we pinned so mid-judging model routing cannot change results. App Check, anonymous Auth, Firestore (run summaries only), and Remote Config (routing thresholds) are wired. PDFs are rasterized locally with `pdfjs-dist` to a single JPEG or PNG, which is what Nano can accept on-device.
- `apps/android` — a second client for the same engine and privacy rules (Gradle scaffold and shared core types are in the tree; the happy path is still being finished). Official on-device Android support is Gemini Nano via Firebase AI Logic on a supported device.
- `packages/core` — routing, de-identification, reconciliation, CER/WER, field scoring, and stage-attributed error registers. Confidence is the minimum of the model's self-report and a grounding check against the transcript, because self-reported confidence is not a calibrated probability.
- `packages/parsing` — extraction schema and prompts.
- `datasets/ekacare` — the public dataset card. Images still need to be imported for scored runs.

[TBD: exact SDK versions and in-repo call sites to cite on Devpost once the public repo is up. TBD: App Check production attestation notes for any hosted demo.]

## Challenges we ran into

The privacy rule is easy to say and hard to keep. Firebase's hybrid helpers are designed to fall back to the cloud when the on-device model is unavailable. For a notes app, that is a feature. For a parent's prescription photo, it would be a leak. We use `ONLY_ON_DEVICE` for live captures, show download or unsupported-device states, and offer already-redacted samples rather than uploading the page.

On-device vision is narrower than it first sounds. Official docs support one JPEG or PNG on Chrome desktop 139+ (with the multimodal Prompt API flag) or a single Bitmap on supported Android devices. PDFs and multi-page records have to be rasterized on the device, one page at a time. Chrome requires a user gesture before `initializeDeviceModel()`, and the first download can take several minutes — so the recorded demo has to start with the model already present.

Honest evaluation is also harder than a demo screenshot. EkaCare is the right kind of public Indian set, but it publishes rubrics rather than official structured JSON, so we will not pretend it is a turnkey field-accuracy benchmark. And we will not invent accuracy numbers to fill a table.

[TBD: replace with the challenges the team actually hit once the build and first eval run are further along.]

## Accomplishments that we're proud of

[TBD: rewrite from what is actually working at submission. Until then, these are the things we intend to be able to show.]

- A hybrid design that treats privacy as the routing rule: live photos and raw PII do not leave the device, even when Nano is missing.
- Stage-attributed scoring, so a wrong frequency is not shrugged off as “OCR failed” when the page was read correctly.
- A three-column demo that compares on-device, cloud, and hybrid on accuracy, cost, and bytes that actually left the device — with Remote Config thresholds that can change routing without a new release.
- The start of a shared evaluation core that can later power an open benchmarking portal.
- [TBD: working on-device inference on web and Android, a committed eval table, a public repo with a visible Apache licence file, a hosted demo URL.]

## What we learned

A hybrid AI app is not automatically a private one. “Fall back to the cloud when the local model is missing” is a good default for availability and a bad default for medical documents. The interesting question is not “can we call two models,” it is “what is allowed to leave the device, and who decides.”

We were also reminded, from that five-document SoalTech check, that end-to-end accuracy can flatter a pipeline. If you cannot point at the stage that introduced an error, you cannot improve the system, and you cannot tell a caregiver which field is worth a second look.

And we learned to leave room for abstention. Guessing a dose to keep the JSON complete is worse than leaving the field unresolved and asking a person. Four correct medicine names cannot compensate for four incorrect dosages.

## What's next

Finish the contest app itself: a reliable on-device path on Chrome desktop and on a Nano-capable Android device, the split-screen comparison with real numbers, and a public repository judges can run. Our feature freeze is 27 November 2026, 11:59 PM IST (Asia/Calcutta). Official submissions close 30 November 2026 at 2:00 PM PT (1 December 2026, 3:30 AM IST). We are aiming to submit on 30 November by 9:00 AM IST.

After that, the same scoring and pipeline core is meant to grow into SoalTech's open-source model benchmarking portal — public datasets, comparable CER/WER and field-accuracy reports, and stage-attributed error registers. The portal, later, also needs the languages a Gujarat clinic actually writes in: Gujarati, Hindi, English, and mixed-language pages. That work is out of scope for this entry.

What we will not do is dress a demo up as a certified medical device, or take the human out of the loop.

---

## Official text-description block (paste-ready)

**How we used Firebase AI Logic.** All AI inference goes through Firebase AI Logic, with App Check enabled. On a supported device, Gemini Nano (`ONLY_ON_DEVICE`) reads a on-device JPEG/PNG of the prescription or lab report into structured JSON and personal details are stripped there. Fields below a Remote Config confidence threshold are sent, as de-identified text only, to `gemini-3.5-flash-lite` (`ONLY_IN_CLOUD`). We do not use the default “fall back to the cloud with the original image” behaviour for live captures.

**Features.** Sign-in; capture or file upload (web also rasterizes the first page of a PDF on the device); on-device read and de-identification; confidence-gated cloud assist on de-identified fields; caregiver confirmation on disagreement; stage-attributed CER/WER and field-accuracy scoring; a three-column comparison of on-device only, cloud only, and hybrid on accuracy, cost, and bytes leaving the device; Web and Android clients sharing the same engine.

**Value proposition.** A caregiver can turn a parent's paper prescription or lab report into structured fields without sending that person's identity — or the page image — off the device, and can see, field by field, which stage got a value right.
