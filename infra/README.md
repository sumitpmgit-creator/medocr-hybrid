# MedOCR Hybrid — platform / Firebase

This folder is the platform side of Sumit's [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) entry: Firebase project config, security rules, emulator tests, deploy scripts, and the submission / setup guides.

Application code lives in `apps/` and `packages/` and is owned by other agents. Do not put secrets, App Check debug tokens, or `.env` files here or in the public repo.

## Architecture

```
Chrome (desktop 139+) or Android
  │
  ├─ Firebase Auth (anonymous; judges use the demo with no login)
  ├─ Firebase App Check (reCAPTCHA Enterprise on web)
  ├─ Firebase Remote Config
  │     accept_on_device_threshold = 0.85
  │     human_review_threshold     = 0.5
  ├─ Firebase AI Logic  →  Gemini Developer API backend (GoogleAIBackend)
  │     on-device: Gemini Nano (Prompt API) for live captures
  │     cloud:     gemini-3.5-flash-lite, de-identified text only
  └─ Cloud Firestore (asia-south1)
        users/{uid}/runs/{runId}     metrics only
```

**Privacy rule (PRD §7):** no live document image and no raw PII leave the device — not in Firestore, not in a cloud prompt, not in logs or the repo. The web helper `saveRunSummary` stores metrics only. Rules reject results text, images, transcripts, and obvious PII field names. `users/{uid}/results` is denied even for the owner.

**App Check** is required for Firebase AI Logic (and is auto-enforced for AI Logic as of 2 Nov 2026). Enforcement for Firestore and AI Logic is configured in the Firebase console, not in `firestore.rules`.

There are no Cloud Functions in this repo, so `firebase.json` does not start a functions emulator and CI does not deploy functions.

## Repo layout (platform files)

| Path | Role |
| --- | --- |
| `/LICENSE` | Apache-2.0, copyright 2026 Sumit Sharma |
| `/firebase.json` | Hosting (`apps/web/dist`, SPA rewrite), Firestore, Remote Config, emulators |
| `/.firebaserc` | Placeholder project id `medocr-hybrid-placeholder` until the Firebase project exists (Advisory is creating it via the Firebase MCP, pending Sumit accepting the Google Cloud ToS) |
| `/firestore.rules` | Deny-by-default owner-scoped rules with field and size checks |
| `/firestore.indexes.json` | Composite index for `runs` |
| `/remoteconfig.template.json` | Canonical routing thresholds (0.85 / 0.5), plus `cloud_model_name` (not wired yet) |
| `/infra/test/` | Rules unit tests (`@firebase/rules-unit-testing` + Firestore emulator) |
| `/infra/scripts/deploy.sh` | Logged-in deploy of rules, Remote Config, and Hosting |
| `/infra/scripts/emulators.sh` | Auth + Firestore + Hosting emulators |
| `/.github/workflows/ci.yml` | Install, lint, test, typecheck, build, rules tests |
| `/.github/workflows/deploy.yml` | Deploy on `main` or `workflow_dispatch`; skips if secrets are missing |
| `/.github/workflows/hosting-preview.yml` | PR preview channel; skips if secrets are missing |

## Firestore schema

Collection path used by `apps/web/src/firebase.ts`:

`users/{uid}/runs/{autoId}`

Current write from `apps/web/src/main.ts` (plus `createdAt: serverTimestamp()`):

| Field | Type | Notes |
| --- | --- | --- |
| `pipelineId` | string | `on-device-only`, `cloud-only`, or `hybrid` |
| `cer`, `wer` | number \| null | Error rates; may exceed 1.0 |
| `fieldF1` | number \| null | 0..1 |
| `latencyMs`, `bytesSent`, `costUsd` | number ≥ 0 | |
| `failed` | bool | |
| `createdAt` | timestamp | Set by the client as `serverTimestamp()` |

**Decision:** Firestore stores metrics only — no results text and no images. Unknown keys and forbidden payload names (images, transcripts, medications, lab results, PII) are rejected. `createdAt` cannot be changed on update. Only `request.auth.uid == {uid}` may read or write a run. `users/{uid}/results` and every other path are deny-by-default, including for the document owner.

Firestore location is **asia-south1** (Mumbai).

## Remote Config

**Decision:** the canonical routing thresholds are `0.85` and `0.5`. Keys already read by `apps/web/src/firebase.ts` (`loadThresholds`):

| Key | Default | Source |
| --- | --- | --- |
| `accept_on_device_threshold` | `0.85` | `packages/core/src/routing.ts` `DEFAULT_THRESHOLDS.acceptOnDevice` |
| `human_review_threshold` | `0.5` | `DEFAULT_THRESHOLDS.humanReview` |

Also in the template, **not wired in the web app yet** (Avenger still needs to read it):

| Key | Default | Source |
| --- | --- | --- |
| `cloud_model_name` | `gemini-3.5-flash-lite` | Pinned today as `CLOUD_MODEL` in `apps/web/src/firebase.ts` |

These are demo operating points, not clinically validated thresholds. Live values can still be published from this template without a new app build.

## Local commands

From the repo root (Java 21+ is required for the Firestore emulator):

```bash
pnpm install
pnpm test && pnpm typecheck && pnpm build

# Rules tests (downloads the Firestore emulator on first run)
pnpm install --ignore-workspace --dir infra
pnpm --dir infra test

# Emulators (Hosting needs apps/web/dist)
pnpm --dir apps/web build
./infra/scripts/emulators.sh

# Deploy (after firebase login and a real project id in .firebaserc)
./infra/scripts/deploy.sh
```

The web app does not yet call `connectAuthEmulator` / `connectFirestoreEmulator`. Until that is wired in `apps/web`, the emulators are still useful for rules tests and for serving the built UI.

## Guides

- [setup-steps.md](./setup-steps.md) — console/CLI steps only Sumit can do (Google account).
- [deploy-guide.md](./deploy-guide.md) — day-to-day deploy, previews, and rollback.
- [submission-checklist.md](./submission-checklist.md) — #BuildHybridAI 2026 submission requirements and evidence.
