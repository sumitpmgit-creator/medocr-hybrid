# #BuildHybridAI 2026 submission checklist

Official sources (retrieved 23 Nov 2026):

- Overview: [https://firebasehybridaihackathon.devpost.com/](https://firebasehybridaihackathon.devpost.com/)
- Official Rules: [https://firebasehybridaihackathon.devpost.com/rules](https://firebasehybridaihackathon.devpost.com/rules)
- FAQs: [https://firebasehybridaihackathon.devpost.com/details/faqs](https://firebasehybridaihackathon.devpost.com/details/faqs)
- Schedule: [https://firebasehybridaihackathon.devpost.com/details/dates](https://firebasehybridaihackathon.devpost.com/details/dates)

**Submission deadline:** Monday, 30 November 2026, 2:00 PM Pacific Time. That is **Tuesday, 1 December 2026, 3:30 AM IST (Asia/Calcutta)**. The deadline is fixed. After it, the Devpost submission is locked and commits pushed to the repo are not evaluated.

**Judging:** 10–16 December 2026. **Winners announced:** on or around 21 December 2026, 12:00 PM PT.

Only Sumit can register, enter the team, and submit on Devpost. This checklist is what the package must contain. It does not submit anything.

---

## Timing and process

- [ ] Devpost draft saved early; final **Submit** well before 2:00 PM PT on 30 Nov (team target: 9:00 AM IST that day — see the product tracker).
- [ ] YouTube video uploaded early (processing can take hours).
- [ ] After the deadline, leave the submitted repo revision untouched; further work goes in a new clone.

---

## What to build (eligibility)

From the Official Rules §6 and the FAQs:

- [ ] A generative AI app that uses **Firebase AI Logic**, combining on-device and cloud inference.
- [ ] **All** app AI inference goes through Firebase AI Logic (no direct calls to other model APIs).
- [ ] At least one eligible platform. This entry is **Web (Chrome)** with Gemini Nano 4 via Firebase AI Logic, plus Android if it ships (multi-platform is preferred, not required). Native Windows/macOS companion apps do not qualify.
- [ ] **App Check** is required. Debug tokens are allowed in the submission's private testing notes, never in the public repo.
- [ ] The project must install and run as shown in the video and description, support English, and be available free of charge through the judging period.
- [ ] New project, or an existing project significantly updated during the submission period (11 Nov 2026, 1:30 PM PT – 30 Nov 2026, 2:00 PM PT). If existing, include a summary of work done in that window.
- [ ] No production API keys, live Google Cloud secrets, confidential commercial data, or PII in the repo, the submission form, or testing instructions.

---

## What to submit on Devpost

- [ ] **Platform category** selected (Web/Chrome; Android as well if that app is in the repo).
- [ ] **Text description** covering: how Firebase AI Logic is used, features, and the value proposition (caregiver medical-document extraction with on-device redaction and hybrid routing).
- [ ] **Public GitHub or GitLab repository** (this project targets GitHub) that:
  - [ ] Is public by the deadline
  - [ ] Contains all source, assets, and run instructions
  - [ ] Has an **open-source license file at the repository root**, detectable in the GitHub **About** panel. Apache is preferred; this repo uses **Apache-2.0** (`/LICENSE`, copyright 2026 Sumit Sharma)
  - [ ] **Demonstrates Firebase AI Logic at runtime in code** — imported and actually called, not only mentioned in the README
- [ ] **Demo video:** public YouTube, **≤ 3 minutes** (only the first 3 minutes are judged), in English or with English subtitles, showing the project working on the platform(s) it targets
- [ ] **Working demo URL** (strongly encouraged, optional in the rules, required by this team's product plan): the Firebase Hosting URL
- [ ] The hosted demo uses anonymous auth; judges need no login. If a debug-token exception is required, put it in private Devpost testing notes only — no secrets in git
- [ ] All submission materials in English

---

## Required / used Firebase products — evidence

The official FAQ says Firebase AI Logic is required; App Check is required for AI Logic; Remote Config, Firestore, and Authentication are encouraged. This entry uses all of them (product decision).

**Decided for this entry:** Firestore location is **asia-south1**; judges use **anonymous auth with no login**; Firestore stores **metrics only** (no results text, no images); canonical Remote Config thresholds are **0.85** (`accept_on_device_threshold`) and **0.5** (`human_review_threshold`).

Use this table in the Devpost description and in the video narration.

| Product | Required by | Evidence in this repo (as of 23 Nov 2026) | Console / runtime proof for Sumit to capture |
| --- | --- | --- | --- |
| **Firebase AI Logic** (hybrid) | Rules / FAQ | `apps/web/src/firebase.ts` — `getAI`, `GoogleAIBackend`. `apps/web/src/stages.ts` — on-device and cloud `generateContent` / hybrid verify. Cloud model pinned to `gemini-3.5-flash-lite`. | A run that shows `inferenceSource` `ON_DEVICE` and `IN_CLOUD` in the split-screen UI |
| **App Check** | Rules / FAQ / AI Logic | `apps/web/src/firebase.ts` — `initializeAppCheck` with `ReCaptchaEnterpriseProvider`. Debug flag is opt-in and must not ship a token. | App Check console: web app registered; **Enforce** on for AI Logic and Firestore |
| **Authentication** | Product (encouraged by FAQ) | `apps/web/src/firebase.ts` — `signInAnonymously`; runs are stored under `users/{uid}/…`. Judges use the hosted demo with no login. | Anonymous provider enabled; the public Hosting URL works without a provided account |
| **Cloud Firestore** | Product (encouraged by FAQ) | `saveRunSummary` writes metrics only to `users/{uid}/runs` (no results text, no images). Rules in `firestore.rules` (owner-only; `users/{uid}/results` is denied). Tests in `infra/test/`. Location: **asia-south1**. | A metrics-only run document visible only to that uid |
| **Remote Config** | Product (encouraged by FAQ) | `loadThresholds()` reads the canonical keys `accept_on_device_threshold` (0.85) and `human_review_threshold` (0.5). Template: `remoteconfig.template.json`. `cloud_model_name` is in the template but not wired yet. | Change a threshold in the console, rerun, routing changes without a new release (US-10) |
| **Firebase Hosting** | Demo URL | `firebase.json` `hosting.public` = `apps/web/dist` | `https://YOUR_PROJECT_ID.web.app` |

---

## App Check on (must not be only “in the README”)

- [ ] reCAPTCHA Enterprise site key configured in the *deployed* app
- [ ] App Check enforcement **On** for Firebase AI Logic
- [ ] App Check enforcement **On** for Cloud Firestore
- [ ] No debug tokens, service account keys, or `.env` files in the public repo
- [ ] If judges need a debug token (e.g. unusual browsers), it is only in private Devpost testing instructions

---

## License and repo hygiene

- [ ] `/LICENSE` is the official Apache-2.0 text with `Copyright 2026 Sumit Sharma`
- [ ] GitHub About shows Apache-2.0
- [ ] Root README (owned outside `infra/`) explains how to run the app, including Chrome 139+ and the Gemini Nano multimodal flag
- [ ] `.gitignore` covers `node_modules`, `dist`, `.env*`, `.firebase`, emulator logs
- [ ] Dataset attribution: EkaCare card is MIT-licensed; we do not claim those images as Apache-2.0 work
- [ ] No real patient records in the repo or the demo

---

## Video (≤ 3 minutes)

Suggested beats (aligned with `docs/product/prd.md` and `docs/submission/`):

1. Problem: a caregiver photographing prescriptions / labs; raw images should not go to a generic cloud OCR.
2. Live (or recorded) web demo: on-device extract, redaction, cloud assist on low-confidence de-identified fields, human confirm.
3. Split-screen: on-device vs cloud vs hybrid, with `inferenceSource`, latency, and a Remote Config threshold change that visibly reroutes.
4. Android path if it ships.
5. Privacy line: the live photo and raw PII never leave the device. Name the Firebase products above.

- [ ] Footage of the app actually running on Chrome (and Android if claimed)
- [ ] English audio or subtitles
- [ ] Public YouTube link pasted on Devpost
- [ ] Length ≤ 3:00

---

## Before you click Submit

- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm --dir infra test` pass on the revision you will tag/submit
- [ ] Hosting URL is the revision you intend judges to see
- [ ] You (Sumit) are the Devpost representative; every teammate who should be listed is added and is eligible (age of majority; not a resident of Brazil, Italy, Quebec, Crimea, Cuba, Iran, Syria, North Korea, Sudan, Belarus, or Russia; not a Google/Devpost employee, etc. — see Official Rules §3)
- [ ] Prize and tax implications understood if you win (W-8BEN for non-US winners)

Questions on the contest itself: keshya@devpost.com or support@devpost.com, as listed on the Devpost pages.
