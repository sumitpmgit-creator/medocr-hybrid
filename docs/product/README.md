# MedOCR Hybrid — product docs

Product requirements, acceptance criteria, and the day-by-day schedule for Sumit's #BuildHybridAI 2026 Firebase AI Hackathon entry.

**Hackathon deadline:** Mon 30 Nov 2026, 2:00 PM PT, which is Tue 1 Dec 2026, 3:30 AM IST (Asia/Calcutta).  
**Feature freeze:** Fri 27 Nov 2026, 11:59 PM IST (Asia/Calcutta).

## Documents

| File | What it is |
| --- | --- |
| [prd.md](./prd.md) | Short PRD: problem, caregiver user, stories, scope, 3-minute demo script, privacy rules, web vs Android on-device constraints, risks, open questions |
| [acceptance-criteria.md](./acceptance-criteria.md) | Testable criteria per feature, with IDs, owners, and must / should / cut. Metric targets are placeholders until the dataset is labeled |
| [tracker.md](./tracker.md) | Day-by-day plan from Mon 23 Nov through Mon 30 Nov, freeze, dress rehearsal, submission buffer, top risks, and cut-line order |

## Owners

| Person | Owns |
| --- | --- |
| Louis | Core engine (on-device extract, routing, cloud assist, stage artifacts) |
| Rachel | Parsing, PII redaction rules, dataset, demo corpus |
| Avenger | Web and Android apps, split-screen demo UI, human confirm |
| Donna | Firebase (Auth, App Check, Firestore, Remote Config), CI, public repo |
| Sage | QA, privacy tests, benchmark runs and scoring |
| Harvey | Pitch, 3-minute video, Devpost submission text |
| Mike (PM) | This folder: PRD, acceptance criteria, schedule |

Write only in `docs/product/` unless Advisory says otherwise.

## Source status (23 Nov 2026)

- **SoalTech spec:** read. Technical handoff dated 23 November 2026, at the Advisory asset path given in the brief. It describes a large model-testing portal (many datasets, PaddleOCR/Qwen pipelines, a six-part benchmark UI). This hackathon entry is a narrower product: a hybrid caregiver pipeline plus a split-screen demo and stage scoring. Portal-scale work is out of scope.
- **`/workspace/med-ocr/design.md`:** not present when these docs were written. Reconcile this folder if it lands.
- **Repo scaffold already in `/workspace/med-ocr`:** pnpm workspace with `@med-ocr/core`, `@med-ocr/parsing`, `apps/web` (Firebase JS SDK ^13.4.0 and `pdfjs-dist`), and `datasets/ekacare/DATASET_CARD.md`. No Android app yet. No git remote was initialized in the workspace at the time of writing.
- **Hackathon rules:** [Official Rules](https://firebasehybridaihackathon.devpost.com/rules) and [FAQs](https://firebasehybridaihackathon.devpost.com/details/faqs), consulted 23 Nov 2026. Firebase AI Logic is required; App Check is required (debug tokens allowed in submissions, never committed). Firestore, Auth, and Remote Config are required for this entry by product decision, even though the FAQ marks them optional. Multi-platform (web + Android) is preferred. Demo video is at most 3 minutes. All app AI inference must go through Firebase AI Logic.
- **Firebase AI Logic hybrid docs:** cited in the PRD; pages last updated 18 Nov 2026 UTC.

## Standing product rules

1. No raw PII and no live document image leaves the device. The cloud path receives de-identified text only. Exact payload is in the PRD.
2. Do not publish benchmark numbers until Sage has a committed reference run on the agreed set. Do not invent metric targets.
3. This is not a medical device. Scores are not clinical validation. The SoalTech spec's clinical-use caution applies.
4. No outreach, no Devpost submit, and no public repo push from these docs alone. Harvey and Donna prepare the package; Sumit approves and submits.

## Alignment notes (same morning)

- **`design.md`** was still absent after these docs were written.
- Engineering work landed in the same window under `packages/core`, `packages/parsing`, `apps/web`, `apps/android`, `benchmarks/`, and `qa/`. The PRD v0 schema and PII placeholders were aligned with that code (Nano subset as must; extra core fields as should). If the code and this folder drift after the Wednesday schema freeze, treat the frozen product contract here as the source of truth until Mike reconciles.
- Harvey has draft pitch materials in `docs/submission/` (not owned by this folder). Several questions in `docs/submission/open-questions.md` are answered in [prd.md](./prd.md) §§4, 7, 8 and 10: web + Android (iOS cut); cloud model `gemini-3.5-flash-lite`; live images never go to the cloud; human in the loop is the caregiver; Auth / Firestore / Remote Config / App Check are required; first-page PDF rasterization only; no invented eval numbers; threshold is a demo default, not a calibrated probability.
