# Deploy guide

How to ship Hosting, Firestore rules/indexes, and Remote Config for MedOCR Hybrid. Project creation, App Check, and GitHub secrets are in [setup-steps.md](./setup-steps.md).

## What gets deployed

| Target | Source | Command slice |
| --- | --- | --- |
| Hosting | `apps/web/dist` (Vite default `outDir`) | `hosting` |
| Firestore rules | `firestore.rules` | `firestore:rules` or `firestore` |
| Firestore indexes | `firestore.indexes.json` | `firestore:indexes` or `firestore` |
| Remote Config | `remoteconfig.template.json` | `remoteconfig` |

There are no Cloud Functions in this repo. Storage is not used; there is no `storage.rules` file.

## Preconditions

- The Firebase project exists and `.firebaserc` has the **real** project id, not `medocr-hybrid-placeholder`. Advisory is creating the project through the Firebase MCP, pending Sumit accepting the Google Cloud ToS; leave the placeholder until then. GitHub deploy secrets are set only after the project exists.
- Firestore is in **asia-south1**. This is decided and cannot be changed.
- You are logged in (`firebase login`) or CI has Workload Identity Federation / a service account key.
- `pnpm` is on `PATH` (Hosting predeploy / the deploy script builds `@med-ocr/web`).
- The hosted build inlines `VITE_*` values at **build** time. For GitHub deploys, set the `VITE_FIREBASE_*` and `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` **repository variables** listed in [setup-steps.md](./setup-steps.md) §9. For a laptop deploy, `apps/web/.env.local` is enough.
- Do **not** commit `.env.local`. Do **not** set `VITE_APPCHECK_DEBUG=true` on a production or preview build. The CI workflows force it to `false`.

## From a logged-in laptop

```bash
# All three (builds the web app first)
./infra/scripts/deploy.sh

# Subsets
./infra/scripts/deploy.sh firestore
./infra/scripts/deploy.sh remoteconfig
./infra/scripts/deploy.sh hosting
./infra/scripts/deploy.sh firestore,remoteconfig
```

Equivalent raw CLI:

```bash
pnpm --dir apps/web build
firebase deploy --only firestore,remoteconfig,hosting
```

The live site is `https://YOUR_PROJECT_ID.web.app` (and `.firebaseapp.com`).

## From GitHub Actions

- **Production:** `.github/workflows/deploy.yml` runs on push to `main` and on **workflow_dispatch**. It skips (job succeeds, no deploy) when `FIREBASE_PROJECT_ID` plus WIF or a service-account key are missing.
- **Pull request previews:** `.github/workflows/hosting-preview.yml` deploys a Hosting channel `pr-<number>` that expires in 7 days and comments the URL on the PR. It also skips if credentials are missing.

Prefer Workload Identity Federation. A JSON key (`FIREBASE_SERVICE_ACCOUNT_KEY`) is supported as a fallback only.

## Emulators (local)

Java 21+ is required for the Firestore emulator.

```bash
pnpm --dir apps/web build
./infra/scripts/emulators.sh
```

- Auth: `127.0.0.1:9099`
- Firestore: `127.0.0.1:8080`
- Hosting: `http://127.0.0.1:5000`
- Emulator UI: `http://127.0.0.1:4000`

Rules tests do not need the UI:

```bash
pnpm install --ignore-workspace --dir infra
pnpm --dir infra test
```

The web app does not yet call `connectAuthEmulator` / `connectFirestoreEmulator`, so a locally *running* Vite dev server still talks to the cloud project in `.env.local`. Wiring the emulators is an `apps/web` change.

## Rollback

- **Hosting:** `firebase hosting:clone SOURCE_SITE:SOURCE_CHANNEL TARGET_SITE:live` or restore a previous release in the Hosting console.
- **Firestore rules:** `firebase deploy --only firestore:rules` from a known-good git revision (`git show REVISION:firestore.rules` into a worktree, never `git checkout` on the shared tree).
- **Remote Config:** the console keeps template versions; roll back there, or `firebase deploy --only remoteconfig` from a known-good `remoteconfig.template.json`.

## Safety

- Never deploy with test-mode (open) Firestore rules.
- Never deploy a build that has `VITE_APPCHECK_DEBUG=true`.
- Confirm App Check enforcement is still on for AI Logic and Firestore after any project setting changes (console, not rules).
