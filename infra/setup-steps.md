# Setup steps for Sumit (Google / Firebase / GitHub)

These steps need Sumit's Google account (and, once connected, the GitHub repo). Nobody else on the team can complete them. They do not require changing application source.

Official product docs cited below were last checked on 23 Nov 2026. Console labels move; if a click path differs, use the in-console search box for the product name.

**Decided:**
- Firestore location is **asia-south1** (Mumbai). This cannot be changed later.
- Judges use **anonymous auth with no login**. Enable only the Anonymous provider for the demo.
- Routing thresholds are canonical: `accept_on_device_threshold` = 0.85, `human_review_threshold` = 0.5.

**Firebase project status:** Advisory is creating the Firebase project through the Firebase MCP. This is pending **Sumit accepting the Google Cloud Terms of Service** (a Google-account click-through only Sumit can complete). Until the project exists, `.firebaserc` stays at the placeholder `medocr-hybrid-placeholder`. Do not invent a project id, and do not set GitHub deploy secrets until the real project id is known.

---

## 1. Firebase project (after the ToS is accepted)

Once Advisory's MCP project creation has succeeded and you have the real project id:

1. Confirm you can open the project at [https://console.firebase.google.com/](https://console.firebase.google.com/) while signed in with the Google account that will own the submission.
2. Replace `medocr-hybrid-placeholder` in `.firebaserc` with the real project id (and tell the team):

```json
{
  "projects": {
    "default": "YOUR_PROJECT_ID"
  }
}
```

### Spark vs Blaze (billing)

- **Firebase AI Logic with the Gemini Developer API** (what the web app uses via `GoogleAIBackend` in `apps/web/src/firebase.ts`) works on the no-cost **Spark** plan, with the Gemini Developer API free tier. See [Firebase AI Logic pricing](https://firebase.google.com/docs/ai-logic/pricing).
- **Do not** enable the Agent Platform Gemini API (formerly Vertex AI) unless you intentionally want it. That provider **requires the Blaze plan**, and upgrading to Blaze also switches Gemini Developer API usage to pay-as-you-go.
- **reCAPTCHA Enterprise** (App Check on web) has a no-cost assessment quota. Advanced score granularity may require Blaze; the default App Check threshold works on Spark. See [App Check with reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).
- Recommendation: **start on Spark** with the Gemini Developer API. Only upgrade to Blaze if a console flow blocks you (for example a reCAPTCHA API that demands billing). If you do upgrade, immediately set a [budget alert and a spend cap](https://firebase.google.com/docs/ai-logic/production-checklist) on the billing account.

---

## 2. Enable Firebase AI Logic (pick Gemini Developer API)

The web app initialises `getAI(app, { backend: new GoogleAIBackend() })`. That is the **Gemini Developer API**, not Vertex / Agent Platform.

1. In the Firebase console, go to **AI Services → AI Logic** (or search “AI Logic”).
2. Click **Get started**.
3. Select **Gemini Developer API** (billing optional; Spark-compatible). **Do not** select Agent Platform Gemini API unless you have decided to move to Blaze.
4. Finish the guided workflow. It enables `generativelanguage.googleapis.com` and `firebasevertexai.googleapis.com`, and creates a Google-managed Gemini API key **in the project**. Do **not** paste that key into the app, the repo, or `.env` files. The Firebase AI Logic SDK uses the Firebase app config; the key stays on the server side.
5. Confirm the cloud model you will use is `gemini-3.5-flash-lite` (already pinned in `apps/web/src/firebase.ts`).

---

## 3. Register the web app and copy config into `.env.local`

1. Project **Settings** (gear) → **Your apps** → **Add app** → **Web**.
2. Nickname: `MedOCR Web`. You can also set up Firebase Hosting from this dialog, or do Hosting in step 8.
3. Copy the Firebase config object. In the repo, copy `apps/web/.env.example` to `apps/web/.env.local` (never commit `.env.local`) and fill:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=   # from step 5
VITE_APPCHECK_DEBUG=true              # localhost only; see step 5
```

These Vite values are client-visible by design. They are not secrets, but do not invent them — use only values from this console.

When an Android app is registered later, add that Android app in the same project (package name + SHA-1/SHA-256 for Play Integrity / App Check). That step belongs with the Android work.

---

## 4. Authentication and Firestore

### Auth

**Decision:** judges use anonymous auth with no login. The web app calls `signInAnonymously` (`apps/web/src/firebase.ts`). Do not require a Google or email/password login for the demo.

1. Build → **Authentication** → **Get started**.
2. **Sign-in method** → enable **Anonymous**. Leave Google and email/password off unless the app later needs them.
3. Add authorized domains: `localhost`, your Firebase Hosting domain (`YOUR_PROJECT_ID.web.app` and `YOUR_PROJECT_ID.firebaseapp.com`), and any custom domain.

### Firestore

1. Build → **Firestore Database** → **Create database**.
2. Start in **production mode** (we deploy `firestore.rules`; do not leave test-mode open-to-the-world rules in place).
3. Set the location to **asia-south1** (Mumbai). **This is decided and cannot be changed later.**
4. Deploy rules and indexes from the repo (step 8), or run `./infra/scripts/deploy.sh firestore`. Rules allow owner-scoped metrics on `users/{uid}/runs` only.

---

## 5. App Check (reCAPTCHA Enterprise) and enforcement

Firebase AI Logic requires App Check. Debug tokens are accepted in submissions, but must never be committed. Official guide: [App Check with reCAPTCHA Enterprise for web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).

### Create the reCAPTCHA Enterprise key

1. Open the [Google Cloud console](https://console.cloud.google.com/) in the **same** project.
2. Go to **Security → reCAPTCHA** / **Fraud Defense** (or search “reCAPTCHA Enterprise”) and enable the API if prompted.
3. Create a **Web** key, score-based (leave “Use checkbox challenge” **unselected**).
4. Add the Hosting domains. **Do not** add `localhost` to a key that will be used in production. Create a separate debug key, or use App Check debug tokens for local work (below).
5. Copy the site key into `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` in `apps/web/.env.local`.

### Register the app in Firebase App Check

1. Firebase console → **Security → App Check** (or Build → App Check).
2. Register the **Web** app with the **reCAPTCHA Enterprise** provider and paste the site key.
3. Leave the default token TTL (1 hour) unless you have a reason to change it.
4. Optional: keep the default risk threshold of 0.5.

### Enforcement (console / API only — not in `firestore.rules`)

Rules cannot enforce App Check. You must turn enforcement on per product:

1. Still on the App Check page, open the **APIs** (or “APIs and enforcement”) tab.
2. Set **Firebase AI Logic** to **Enforce**. (As of 2 Nov 2026, Firebase auto-enforces App Check for AI Logic in all projects. Confirm it is On.)
3. Set **Cloud Firestore** to **Enforce** once the web app successfully obtains App Check tokens in production (watch the metrics for a day if you want a safety buffer; for this hackathon, enforce before the repo goes public).
4. Do **not** enable enforcement against the Auth or Firestore **emulators** — local debug tokens are registered next.

### Debug tokens (local / judges, never in git)

1. On localhost, `apps/web/.env.example` sets `VITE_APPCHECK_DEBUG=true`, which makes the SDK print a debug token in the browser console.
2. In App Check → **Apps** → your web app → **Manage debug tokens**, add that token.
3. Put any debug token a judge might need in the **private** Devpost testing instructions, not in the repository, README, or a committed `.env`.

---

## 6. Publish Remote Config

1. Engage → **Remote Config** → **Get started** if it is the first time.
2. From a machine with the Firebase CLI logged in as you:

```bash
cd /path/to/med-ocr
# .firebaserc must already have the real project id
firebase deploy --only remoteconfig
```

Or run `./infra/scripts/deploy.sh remoteconfig`.

3. In the console, confirm these parameters exist and are published (not just saved as a draft):

| Parameter | Default | Already used by the app? |
| --- | --- | --- |
| `accept_on_device_threshold` | `0.85` (canonical) | Yes (`apps/web/src/firebase.ts`) |
| `human_review_threshold` | `0.5` (canonical) | Yes |
| `cloud_model_name` | `gemini-3.5-flash-lite` | No (not wired yet; Avenger still needs to read this key) |

4. After any console edit, prefer exporting / committing the template so git stays the source of truth: `firebase remoteconfig:get -o remoteconfig.template.json`.

---

## 7. Firebase CLI login (your laptop)

```bash
npm install -g firebase-tools   # or use the copy in infra: pnpm install --dir infra
firebase login
firebase use YOUR_PROJECT_ID
firebase projects:list          # confirm you see the project
```

---

## 8. Hosting

1. In the Firebase console, **Build → Hosting → Get started** if Hosting is not already enabled (registering the web app may have done this).
2. Build and deploy from the repo root (after step 7):

```bash
./infra/scripts/deploy.sh
```

This builds `apps/web` to `apps/web/dist` (Vite's default `outDir`; that is what `firebase.json` points at) and deploys Hosting, Firestore rules/indexes, and Remote Config.

3. Confirm `https://YOUR_PROJECT_ID.web.app` loads. That URL is the demo link for Devpost.
4. Add the Hosting domain to Auth authorized domains and to the production reCAPTCHA key if you did not already.

---

## 9. CI credentials (GitHub)

Set these **only after the Firebase project exists**. Until then, leave the GitHub deploy secrets unset; `deploy.yml` and `hosting-preview.yml` skip cleanly.

Prefer **Workload Identity Federation** (no long-lived JSON key). A scoped service-account key is the fallback.

### Option A — Workload Identity Federation (preferred)

1. In Google Cloud, enable the IAM Credentials API and create a service account, e.g. `github-deploy@YOUR_PROJECT_ID.iam.gserviceaccount.com`.
2. Grant that service account only what deploy needs, for example:
   - Firebase Hosting Admin
   - Firebase Rules Admin (or Cloud Datastore / Firestore permissions needed to deploy rules and indexes)
   - Firebase Remote Config Admin
   - Service Usage Consumer
3. Create a Workload Identity Pool and a **GitHub** provider, restricted to this repository (`OWNER/REPO`) and preferably the `main` branch plus `pull_request` from the same repo (not `*`).
4. Bind the service account to the pool principal for that repo.
5. In the GitHub repo: **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | The Firebase / GCP project id |
| `FIREBASE_WIF_PROVIDER` | Full provider resource name, `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID` |
| `FIREBASE_SERVICE_ACCOUNT` | The service account email |

Official walkthrough: [Authenticate to Google Cloud from GitHub Actions](https://github.com/google-github-actions/auth).

### Option B — Service account key (fallback)

1. Create the same scoped service account as in Option A.
2. Create a JSON key, store it as the GitHub secret `FIREBASE_SERVICE_ACCOUNT_KEY`, and also set `FIREBASE_PROJECT_ID`.
3. Download the key only long enough to paste it into the secret. Do not commit it, do not email it, and do not leave it in `/tmp`.
4. If you later switch to Option A, delete the key in Google Cloud and remove the GitHub secret.

`deploy.yml` and `hosting-preview.yml` skip cleanly when these secrets are absent, so CI will stay green before the repo and secrets exist.

The Hosting build inlines `VITE_*` at compile time. In the same GitHub repo, add **Variables** (not secrets — these values are public in the client bundle) under Settings → Secrets and variables → Actions → Variables:

| Variable | Value |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | From the web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | From the web app config |
| `VITE_FIREBASE_PROJECT_ID` | From the web app config |
| `VITE_FIREBASE_STORAGE_BUCKET` | From the web app config |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | From the web app config |
| `VITE_FIREBASE_APP_ID` | From the web app config |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | Production reCAPTCHA Enterprise site key |

Leave `VITE_APPCHECK_DEBUG` unset in CI (the workflows force it to `false`). Until these variables are set, prefer `./infra/scripts/deploy.sh` from a laptop that has `apps/web/.env.local`.

---

## 10. After GitHub is connected

Advisory will publish the public repo once you connect GitHub. Then:

1. Confirm `LICENSE` (Apache-2.0) is at the repository root so GitHub shows it in the **About** panel (required by the hackathon). If it does not appear, set it manually in About → License.
2. Add the secrets from step 9.
3. Run the **Deploy** workflow (`workflow_dispatch`) once to verify Hosting + rules + Remote Config.
4. Never add App Check debug tokens, `.env.local`, or service account keys to the repo.

---

## 11. Quick confirmation checklist

- [ ] Google Cloud ToS accepted so Advisory's Firebase MCP project creation can finish
- [ ] Firebase project exists; `.firebaserc` updated with the real id (leave the placeholder until then)
- [ ] Plan is Spark, or Blaze with a budget alert / spend cap
- [ ] AI Logic enabled with **Gemini Developer API**
- [ ] Web app registered; `apps/web/.env.local` filled (not committed)
- [ ] Anonymous auth enabled (judges use the demo with no login); authorized domains include Hosting
- [ ] Firestore created in **asia-south1**; production rules deployed
- [ ] reCAPTCHA Enterprise site key created; App Check registered
- [ ] App Check **enforced** for Firebase AI Logic and Firestore
- [ ] Remote Config published with canonical `accept_on_device_threshold` (0.85) and `human_review_threshold` (0.5)
- [ ] Hosting URL loads
- [ ] GitHub deploy secrets and `VITE_*` variables set **after** the project exists (WIF preferred)
