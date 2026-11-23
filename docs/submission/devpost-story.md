# MedOCR Hybrid — Devpost project story

Draft for Harvey / Sumit. Written in first person as Sumit.
Status: first draft, 23 November 2026. `design.md` had not landed in `/workspace/med-ocr` when this was written, and the repo is still a scaffold (see open-questions.md). Replace every `[TBD: …]` before pasting into Devpost. Do not submit this draft as-is.

**Official Devpost text-description requirements** (from the [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) “What to Submit” section, confirmed 23 November 2026): the form asks for a text description covering (1) how we used Firebase AI Logic, (2) a summary of features and functionality, and (3) a value proposition. The seven headings below are the standard Devpost project-story sections; they are not named as required fields on the official contest page, but they are what a typical Devpost project page uses. A short official-description block is at the end, ready to paste if the form wants that text separately.

**Responsible use (include on the Devpost page):** MedOCR Hybrid is a document-reading and structuring demo, not a medical device and not a diagnostic tool. A person has to confirm any field the on-device and cloud models cannot agree on. Benchmark scores do not establish clinical safety.

---

## Inspiration

In a clinic in India, a prescription is still often a piece of paper. Someone photographs it — a receptionist, a patient saving it to a phone, a doctor trying to get yesterday's medicines into a record. The useful part of that photo is a handful of clinical fields: the medicine name, the strength, how often to take it, a lab value and its unit. The dangerous part is everything wrapped around those fields: a name, a phone number, an ABHA ID.

I did not want to build “OCR that ships the whole page to the cloud and hopes for the best.” That is the obvious design, and it is the wrong one for medical documents. The moment the image leaves the device, so does the patient's identity.

The other thing I did not want was a single accuracy percentage that hides where the pipeline actually failed. SoalTech's own early check of five documents found a pattern I keep coming back to: an OCR stage can read the medicine names and dosing text correctly, and the next model can still invent the wrong medication identity or frequency. If you only score the final JSON, you blame the wrong step and you fix the wrong thing.

MedOCR Hybrid started from those two frustrations. Read the page on the device. Strip the personal details there. Send only de-identified text, and only for the fields the on-device model is not sure about. If the two models still disagree, stop and ask a person. And score every stage, so an error is pinned on the step that caused it.

The same scoring core is what we want to grow into SoalTech's open-source model benchmarking portal — so a hybrid demo for this hackathon is also the first slice of a longer, public evaluation project. That portal is what's next, not what we are submitting as the app.

## What it does

You give MedOCR Hybrid a photo or a PDF of a prescription or a lab report. The document stays on the device.

On the device, Gemini Nano — reached through Firebase AI Logic, not a side-channel API — reads the page into structured JSON and removes personal details such as names, ABHA IDs and phone numbers. High-confidence clinical fields are kept locally and never need a network call.

Fields below a confidence threshold are the only ones that leave the device. They go to the cloud through Firebase AI Logic, using `gemini-3.5-flash-lite`, as de-identified text. The original image and the stripped identifiers do not go with them.

If the on-device result and the cloud result still disagree on a field, that field is held for a person to confirm. The app does not quietly pick a winner.

Every stage keeps its own output so we can score it on its own terms:

- **Reading (Benchmark A):** character and word error rates (CER / WER) against a reference transcription — did we read what was written?
- **Structure (Benchmark B):** field-level accuracy of the JSON — did we put the right text in the right clinical field?
- **Attribution:** each error is charged to the stage that introduced it (on-device read, on-device structure, cloud assist, or human confirmation), not to “the pipeline” as a whole.

The demo puts three modes on one split screen — on-device only, cloud only, and hybrid — and compares them on accuracy, cost, and bytes sent off the device. The point is not that cloud is always better, or that on-device is always enough. It is that a privacy-preserving hybrid can be measured, not just claimed.

We evaluate on public, already-released reference data (the EkaCare medical-records set of 288 Indian prescription and laboratory images is the first dataset in the repo) and on clearly labelled synthetic samples in the video. We do not use real patient documents in the submission.

## How we built it

[TBD: rewrite this section once the build is real — names of files, exact SDK versions, App Check setup, and screenshots of working inference. The repo on 23 November 2026 is a pnpm monorepo scaffold, Apache-2.0 in package.json, with almost no application code yet.]

The project lives in a pnpm monorepo:

- `apps/web` — a Vite web app. It already depends on the Firebase JavaScript SDK (`firebase` ^13.4.0) and `pdfjs-dist`, so a PDF can be rasterized to a JPEG or PNG on the device before any model sees it. That matters, because on-device Gemini Nano via Firebase AI Logic accepts a single JPEG or PNG, not a PDF.
- `packages/core` — shared pipeline types, routing, scoring and stage artifacts.
- `packages/parsing` — document parsing and de-identification.
- `datasets/ekacare` — the dataset card for EkaCare's Medical Records Parsing Validation Set (288 images, MIT licence, already PII-redacted; published fields are the image, a prompt and evaluation rubrics, not the clinician-annotated JSON itself).

All AI inference is intended to go through Firebase AI Logic, which the official rules require. The on-device leg is Gemini Nano 4 on a supported platform; the cloud leg is `gemini-3.5-flash-lite`. Firebase App Check is required for AI Logic (debug tokens are acceptable for the submission). [TBD: confirm App Check is wired, and that a production attestation provider is documented for any hosted demo.]

The hybrid policy is deliberate, and it is not the SDK's default “use the on-device model when it is available, otherwise fall back to the cloud.” Availability fallback would send a full document — image, name, ID and all — to the cloud the moment Nano was missing. Our rule is stricter:

1. Run on-device first, on the image, and de-identify there.
2. If a field is below the confidence threshold, send only that field's de-identified text to the cloud.
3. If the two answers disagree, ask a person.
4. If the on-device model is not available, [TBD: confirmed fallback behaviour — refuse, wait for the model download, or offer an explicit, informed opt-in? Do not silently upload the image.]

We also keep three artifacts for any assisted field, the way the SoalTech spec asks a pipeline to keep them: the unchanged on-device result, the unchanged cloud result, and the final value after confirmation. That is what makes stage-attributed scoring possible.

## Challenges we ran into

[TBD: replace planned challenges with the ones the team actually hit once the build is underway.]

The privacy rule is easy to say and hard to keep. Firebase's hybrid helpers are designed to fall back to the cloud when the on-device model is unavailable. For a notes app, that is a feature. For a prescription photo, it would be a leak. We have to make “only de-identified text ever leaves the device” a property of the code, not a sentence in the README — including when Nano has not been downloaded yet, when a PDF comes in, and when someone is on a browser that cannot run on-device inference.

On-device vision is also narrower than it first sounds. Official Firebase AI Logic docs (as of this draft) support on-device text-plus-one-image input: JPEG or PNG on Chrome desktop 139+, or a single Bitmap on supported Android devices. PDFs, multi-page batches, audio and video are not on-device capabilities, so a multi-page report has to be rasterized page by page on the device. Chrome desktop currently requires the multimodal Prompt API flag and a user gesture before the on-device model is initialized. [TBD: what we actually shipped around model download, flags, and page limits.]

Confidence is another trap. A model can report that it is sure and still be wrong. The SoalTech spec is explicit: self-reported confidence is not a valid probability unless it has been independently calibrated. A threshold that routes “low confidence” fields to the cloud only helps if we measure whether those were the fields that were actually wrong. [TBD: calibration method and chosen threshold.]

Finally, honest evaluation is harder than a demo screenshot. EkaCare is the right kind of public Indian set to start with, but it publishes rubrics rather than the official structured JSON, so we cannot pretend it is a straightforward image-to-field benchmark. And we will not invent accuracy numbers to fill a table.

## Accomplishments that we're proud of

[TBD: fill with what is actually working by submission. Until then, these are the accomplishments we are aiming to be able to show, not claims of a finished product.]

- A hybrid design that treats privacy as the routing rule, not as a disclaimer: the cloud never receives the image or the identifiers.
- Stage-attributed scoring, so a wrong frequency is not shrugged off as “OCR failed” when the page was read correctly.
- A split-screen demo that compares on-device only, cloud only and hybrid on the three things a clinic would actually ask about: was it right, what did it cost, and how much left the device.
- The start of a shared evaluation core that can later power an open benchmarking portal, instead of a one-off hackathon script.
- [TBD: working on-device inference, a measured bytes-leaving-the-device figure, a completed human-confirm path, a public repo with a visible Apache licence file.]

## What we learned

A hybrid AI app is not automatically a private one. “Fall back to the cloud when the local model is missing” is a good default for availability. It is a bad default for medical documents. The interesting design question is not “can we call two models,” it is “what is allowed to leave the device, and who decides.”

We also learned — or rather, were reminded, from that five-document SoalTech check — that end-to-end accuracy can flatter a pipeline. If you cannot point at the stage that introduced an error, you cannot improve the system, and you cannot tell a person which field is worth a second look.

And we learned to leave room for abstention. Guessing a dose to keep the JSON complete is worse than leaving the field unresolved and asking a person. The spec's safety rule is the right one: four correct medicine names cannot compensate for four incorrect dosages.

## What's next

First, finish the hackathon app itself: a working on-device path, a measured hybrid path, the split-screen comparison with real numbers, and a public repository judges can actually run. Feature freeze for us is 27 November 2026; the official submission deadline is 30 November 2026 at 2:00 PM PT.

After that, the same scoring and pipeline core is meant to grow into SoalTech's open-source model benchmarking portal: public datasets, comparable CER/WER and field-accuracy reports, stage-attributed error registers, and — later, only under proper authorization and privacy controls — clinician-verified clinic documents. The portal, as specified, also needs to handle the languages a Gujarat clinic actually writes in: Gujarati, Hindi, English and mixed-language pages.

What we will not do is dress a demo up as a certified medical device, or take the human out of the loop.

---

## Official text-description block (paste-ready)

Use this if Devpost asks for a single description covering Firebase AI Logic, features, and value proposition.

**How we used Firebase AI Logic.** All AI inference goes through Firebase AI Logic, with App Check enabled (debug tokens for development). On a supported device, Gemini Nano 4 reads a on-device JPEG/PNG of the prescription or lab report into structured JSON and removes personal details. Fields below a confidence threshold are sent, as de-identified text only, to `gemini-3.5-flash-lite` through the same SDK. We do not use the default “fall back to the cloud with the original prompt” behaviour, because that would send the image and the identifiers. [TBD: confirm the exact model IDs, SDK versions, and in-repo call sites.]

**Features.** On-device capture and rasterization; on-device read + de-identification; confidence-gated cloud assist on de-identified fields; human confirmation on disagreement; stage-attributed CER/WER and field-accuracy scoring; a split-screen comparison of on-device only, cloud only and hybrid on accuracy, cost and bytes leaving the device.

**Value proposition.** People can turn a paper prescription or lab report into structured fields without sending a patient's identity — or the page image — off the device, and they can see, field by field, which stage got a value right.

[TBD: if this project is treated as an existing app, add a short “what we built during the submission period” paragraph. As of this draft it is a new project.]
