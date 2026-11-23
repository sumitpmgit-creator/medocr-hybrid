# MedOCR Hybrid — open questions

Facts the story, video and judging check need, but that could not be confirmed from the repo, from `design.md` (not present as of 23 November 2026), or from the SoalTech technical handoff. Do not invent answers in the Devpost text; fill these, then update the drafts.

Sources checked:

- `/workspace/med-ocr` (apps, packages, datasets, scripts, package.json). No `design.md`, no `docs/` other than this folder, no LICENSE file, no README, no application source beyond a parsing stub.
- SoalTech spec: `…/44b70e8a-6007-4976-911a-41f3810c70d2/assets/01M83WK3A97B1YFRNGZ2R85VQK.txt` (technical handoff, 23 November 2026). Other files in that folder were skimmed; the related ones are additional extracts of the same spec and Firebase AI Logic / App Check documentation. Older files in the folder (Raksha AI, road-safety articles, etc.) are not about this project.
- Official hackathon pages, fetched 23 November 2026: [overview](https://firebasehybridaihackathon.devpost.com/), [FAQs](https://firebasehybridaihackathon.devpost.com/details/faqs), [Official Rules](https://firebasehybridaihackathon.devpost.com/rules).

---

## Product and platform

1. **Which platform(s) are we submitting?** The brief describes a phone. The repo only has `apps/web`. Official options are Web/Chrome (Gemini Nano 4), Android (Gemini Nano 4), and iOS (Apple Foundation Models). Multi-platform is preferred. Official on-device web support is Chrome on **desktop** (v139+), not a phone browser, so a “phone” demo needs an Android (or iOS) app.
2. **Exact on-device model ID?** The brief says Gemini Nano. The official requirement is Gemini Nano 4. Confirm the ID we call in Firebase AI Logic.
3. **Exact cloud model ID?** The brief says `gemini-3.5-flash-lite`. Official Firebase docs still list that ID among current models as of this draft, but we should pin the version we actually call at submission time.
4. **What happens when the on-device model is missing or still downloading?** The privacy promise breaks if we silently send the image to the cloud. Is the behaviour refuse, wait, or an explicit informed opt-in?
5. **Does the document image ever leave the device, under any path?** The brief says only de-identified text leaves. Confirm there is no logging, crash reporting, or “cloud-only” demo mode that uploads the page.
6. **Which identifiers are stripped?** The brief names names, ABHA IDs and phone numbers. What about addresses, dates of birth, emails, doctor names, hospital names, barcodes, signatures, or other record IDs?
7. **Who is the human in the loop?** Patient, clinic receptionist, clinician, or the person operating the demo? This changes the Design and Impact story.
8. **Confidence threshold and calibration?** What value, who chose it, and has it been calibrated? The SoalTech spec says self-reported model confidence is not a valid probability unless independently calibrated.
9. **Multi-page and PDF behaviour?** `pdfjs-dist` is a web dependency, which suggests client-side rasterization, but there is no code. How many pages do we run on-device? Official on-device inference does not accept PDFs or multiple images in one request.
10. **Other Firebase products?** App Check is required. Are Authentication, Firestore, or Remote Config in scope (for example, to tune the threshold without a new release)?

## Evaluation and claims

11. **Eval numbers for the split-screen table:** hybrid vs on-device only vs cloud only, for CER, WER, field accuracy (exact-match / precision / recall / F1), cost per document, and bytes sent off the device, plus the date, dataset and sample size of the run.
12. **How are cost and bytes measured?** API list price vs actual billed usage? Request payload only, or response too? TLS overhead in or out?
13. **Which dataset underpins any published number?** EkaCare (288 images) is in the repo as a dataset card only; images have not been imported (`scripts/import_ekacare.py` is missing). EkaCare publishes rubrics, not the clinician-annotated structured JSON, so it supports rubric scoring more naturally than field exact-match. Other datasets in the spec have their own licence and access constraints (for example MedDocBench needs author approval and is non-commercial).
14. **Are we running the official EkaCare rubric protocol, our own field schema, or both?**
15. **Target schema for prescriptions and lab reports?** The spec lists the fields to evaluate (brand, generic, strength, form, dose, route, frequency, timing, duration, quantity, instructions; lab test name, result, unit, range, flag, specimen, date). Which of these does the hackathon app actually extract?
16. **Any user research, quotes, or clinic pilots?** None were found. Do not invent them. If none exist, the impact section should stay problem-led, not testimonial-led.

## Submission logistics

17. **Public repo URL, and when it becomes public?** A `LICENSE` file still has to be added if we want Apache to show in the host's About section; package.json alone is not enough on GitHub.
18. **Hosted demo URL and judge test instructions?** Strongly encouraged. Must not contain production secrets, live keys, or PII.
19. **Individual, team, or organization entry?** If a team or SoalTech is on the submission, every member must be added on Devpost and a representative appointed.
20. **Is this a new project or a significant update of an existing app?** The repo looks new. If anything pre-existed the submission period (11 November 2026, 1:30 PM PT), we must disclose pre-existing code and summarise what was built during the period.
21. **Will `design.md` change product behaviour or visual design?** It had not landed at draft time. The story should be reviewed against it as soon as it exists.
22. **Devpost form fields.** Official required description text is Firebase AI Logic use + features + value proposition. The seven-section story is the usual Devpost project-story layout, not a named official requirement. Confirm on the live “Enter a Submission” form before pasting.

## Language and scope we must not over-claim

- No clinical validation, medical-device, or “safe for diagnosis / dispensing” language. The spec's own caution stands: benchmark scores do not establish clinical safety; real patient testing needs authorization, protected data handling and clinician review.
- No real patient names, IDs, or documents in the repo, video, or write-up. Synthetic samples only, clearly labelled.
- Do not cite the SoalTech five-document check as a formal benchmark; it is an initial observation that motivated stage attribution.
- Do not say “the cloud never sees anything” unless that is literally true on the path being shown. The accurate claim is that the cloud never sees the image or the identifiers, and is only asked about low-confidence de-identified fields.
