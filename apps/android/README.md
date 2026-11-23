# MedOCR Hybrid — Android app

Kotlin + Jetpack Compose client for Sumit’s #BuildHybridAI 2026 entry. This folder is the Android app only (`apps/android`). `packages/core` and `packages/parsing` stay TypeScript; this project mirrors their types, thresholds, prompts, de-id rules and cost helpers in Kotlin.

Feature freeze: 27 Nov 2026.

## What you can do today

1. Capture a document with **CameraX** or pick one from the gallery.
2. Run extraction in **mock** mode (default — works on any emulator or device) or **auto** (Firebase AI Logic / Gemini Nano, falling back to mock).
3. Review every field (crop, confidence badge, source).
4. Work through the **human-confirm** queue.
5. Read a **privacy receipt** (what de-id removed as counts/types, and what left the device).
6. Compare **on-device vs cloud vs hybrid** (CER, estimated cost, bytes sent).

## Setup

### Tooling

- JDK 17+ (JDK 21 is fine).
- Android SDK with `platforms;android-35` and `build-tools;35.0.0`.
- Keep Gradle and the SDK **out of this tree**:
  - `export GRADLE_USER_HOME="$HOME/.gradle"`
  - `export ANDROID_HOME="$HOME/android-sdk"` (or `ANDROID_SDK_ROOT`)
- Kotlin **2.4.0** (and the matching Compose compiler plugin). `firebase-ai-ondevice:16.0.0-beta08` transitively pulls `genai-prompt:1.0.0-beta5`, which is compiled with Kotlin metadata 2.4.0 — Kotlin 2.1 cannot compile against it.
- This project caps Gradle at 2 GB and disables the daemon (`gradle.properties`). Gradle 8.11.1 works with Kotlin 2.4; the Kotlin plugin warns that 2.5 will require Gradle 8.14.4+.

```bash
cd apps/android
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOME/.gradle}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
./gradlew assembleDebug test
```

The debug APK lands in `app/build/outputs/apk/debug/` (gitignored). Last verified on 23 Nov 2026: `./gradlew assembleDebug test` succeeded (`app-debug.apk`, 21 unit tests × debug+release).

### Firebase config (Donna owns the real project)

1. Copy `google-services.json.template` to `app/google-services.json`.
2. Replace the placeholders with the real app (`package_name` must stay `com.medocr.hybrid`).
3. **Do not commit** `google-services.json` — it is in `.gitignore`.

Without that file the app still builds and runs in **mock** mode. The Google Services plugin is applied only when the file exists.

## Device requirements for Gemini Nano

On-device inference uses Firebase AI Logic’s hybrid path, which calls the **ML Kit Prompt API** through **AICore**.

Requirements, from the official docs (updated 2026-11-18):

- Android API 26+ (`minSdk 26`).
- Firebase AI Logic SDK **v17.10.0+** (this app pins `firebase-ai:18.2.0` / BoM `35.2.0` and `firebase-ai-ondevice:16.0.0-beta08`).
- A device that ships **AICore** and a Gemini Nano model. The supported list lives in the ML Kit docs and currently includes (among others):
  - **Pixel 9 / 9 Pro / 9 Pro XL / 9 Pro Fold** (Nano 3)
  - **Pixel 10 / 10 Pro / 10 Pro XL / 10 Pro Fold** and **Pixel 11** series (Nano 4)
  - **Samsung** Galaxy S25 / S26 families, Z Flip7/8, Z Fold7/8, Tab S12, Z TriFold
- The app must be in the foreground; only English and Korean are validated on Android.
- On-device request limit on Android is **4000 tokens** (tighter than the 9216-token window documented for the web hybrid path).
- Unlocked bootloaders are not supported.
- After a factory reset, give AICore time to initialise.

Tap **Prepare Nano** to call `FirebaseAIOnDevice.checkStatus()` / `download()`. If Nano is unavailable, Auto mode falls back to mock (or to cloud, if Firebase is configured).

## Architecture

```
Capture (CameraX / gallery)
    → OCR read (verbatim; no redaction in the prompt)
    → De-id stage (on-device, packages/parsing/src/deid rules)
    → Structure (on-device or gated cloud)
    → Hybrid verify (low-confidence entities only, de-identified text, no image)
    → Field review + human-confirm queue
    → Privacy receipt + on-device vs cloud vs hybrid comparison
```

- Stage ids and routing match `apps/web/src/stages.ts` and `packages/core`.
- `readingText()` (mirror of `packages/core/src/pipeline.ts`) skips the de-id stage, so **CER is computed on the raw OCR transcript**.
- Every cloud **text** call runs `gateForCloud` → `deidentify` + `assertSafeForCloud`. If residual identifiers remain, nothing is sent and those fields go to the human-confirm queue.
- Cloud-only **OCR** still uploads the page image (pixels cannot be de-identified by the text gate). The receipt says so. Hybrid verify never uploads the image.
- Usage: `outputTokens = candidatesTokenCount + thoughtsTokenCount` (thinking tokens billed at the output rate). Display cost uses official paid-tier rates from `benchmarks/pricing.json` ($0.30 / $2.50 per 1M on `gemini-3.5-flash-lite`, retrieved 2026-11-23) because `packages/core/src/cost.ts` still has TODO zeros.

### Kotlin packages

| Package | Mirrors |
|---|---|
| `com.medocr.hybrid.core` | `packages/core/src/{types,pipeline,text-metrics,normalize,field-scorer,routing,cost,deid}.ts` |
| `com.medocr.hybrid.parsing` | `packages/parsing/src/extraction/{prompt,schema,parse,route,constraints}.ts` |
| `com.medocr.hybrid.parsing.deid` | `packages/parsing/src/deid/{types,patterns,find,deidentify,assert}.ts` |
| `com.medocr.hybrid.inference` | Android pipelines, Firebase / mock clients |
| `com.medocr.hybrid.receipt` | Privacy receipt, review rows, comparison |
| `com.medocr.hybrid.ui` | Compose screens |

Thresholds (keep in sync):

- `packages/core/src/routing.ts` — `acceptOnDevice = 0.85`, `humanReview = 0.50`
- `packages/parsing/src/extraction/route.ts` — `DEFAULT_CLOUD_ROUTE_THRESHOLD = 0.70`

Pinned cloud model: **`gemini-3.5-flash-lite`** (`CLOUD_MODEL` in `core/Cost.kt`). This name **is** listed on the official Firebase models page (updated 2026-11-18).

## Verified API and artifact names

Recorded 23 Nov 2026 against pages last updated 18 Nov 2026 (UsageMetadata reference: 7 Oct 2026).

| What | Name | Source |
|---|---|---|
| Firebase AI Logic Android library | `com.google.firebase:firebase-ai:18.2.0` (via BoM `35.2.0`) | [Get started (Android hybrid)](https://firebase.google.com/docs/ai-logic/hybrid/android/get-started), [Release notes](https://firebase.google.com/support/release-notes/android) |
| On-device companion (not in the BoM) | `com.google.firebase:firebase-ai-ondevice:16.0.0-beta08` | same get-started page |
| Google services plugin | `com.google.gms:google-services:4.6.0` | Release notes |
| ML Kit Prompt API | `com.google.mlkit:genai-prompt:1.0.0-beta4` | [Prompt API get started](https://developers.google.com/ml-kit/genai/prompt/android/get-started) |
| Hybrid entry point | `Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(...)` | get-started |
| Inference modes | `com.google.firebase.ai.InferenceMode` (`PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`) — not under `.type` | [Configuration options](https://firebase.google.com/docs/ai-logic/hybrid/android/configuration-options) |
| On-device config | `com.google.firebase.ai.OnDeviceConfig(mode = ...)`, optional `OnDeviceModelOption.STABLE` / `PREVIEW` / `PREVIEW_FAST` | same |
| Source of a response | `response.inferenceSource` → `com.google.firebase.ai.InferenceSource.ON_DEVICE` / `IN_CLOUD` | same |
| Model availability | `com.google.firebase.ai.ondevice.FirebaseAIOnDevice.checkStatus()` → `OnDeviceModelStatus.{UNAVAILABLE,DOWNLOADABLE,DOWNLOADING,AVAILABLE}`; `download()` emits `DownloadStatus.*`. In SDK 16.0.0-beta08 these APIs are **deprecated** in favour of `GenerativeModel.OnDeviceExtension` from `firebase-ai`; the app still uses the documented `FirebaseAIOnDevice` entry points. | get-started |
| Opt-in | `@OptIn(PublicPreviewAPI::class)` | get-started |
| Thinking tokens | `response.usageMetadata.thoughtsTokenCount` (`UsageMetadata`, `Int`) together with `promptTokenCount` and `candidatesTokenCount` | [UsageMetadata](https://firebase.google.com/docs/reference/kotlin/com/google/firebase/ai/type/UsageMetadata), [Thinking](https://firebase.google.com/docs/ai-logic/thinking) |
| Cloud model | `gemini-3.5-flash-lite` | [Models](https://firebase.google.com/docs/ai-logic/models) |
| Supported devices | ML Kit GenAI device list | [ML Kit GenAI overview](https://developers.google.com/ml-kit/genai) |

On-device structured output on **Android** uses `@Generable`, not the web `responseConstraint` object. This app embeds the schema in the prompt (as `packages/parsing` already does) and parses the JSON, so it does not depend on `@Generable`.

## Mismatches with core / parsing / web

- **OCR prompt:** the web app’s `apps/web/src/stages.ts` `READ_PROMPT` still asks the model to replace identifiers with `[REDACTED]` (FINDINGS B3). This Android app does **not** — OCR is verbatim; de-id is a later stage.
- **Token window:** parsing records `NANO_MAX_TOKENS = 9216` (web docs). Android hybrid docs state a **4000**-token on-device request limit (`ANDROID_NANO_MAX_TOKENS`).
- **Languages:** parsing lists `en, ja, es, de, fr` (Chrome Prompt API). Android on-device inference is only validated for **English and Korean**.
- **Cost placeholders:** `packages/core/src/cost.ts` still prices `gemini-3.5-flash-lite` at $0. Android display cost uses `benchmarks/pricing.json`.
- **Schema subset:** Nano extraction (`packages/parsing` prompt/schema) omits `discharge_summary` (maps to `other`) and several ClinicalDoc fields (`genericName`, `route`, `flag`, …). The structure stage here follows the web app and `packages/core/src/schema.ts` (full ClinicalDoc).
- **assertSafeForCloud** lives in `packages/parsing/src/deid`, not `packages/core`. The Android gate mirrors the parsing module. `packages/core/src/deid.ts` is a smaller regex net; both are ported, and the pipeline uses the parsing gate.
- `packages/parsing/src/index.ts` may lag the `extraction/` and `deid/` submodules.

## What’s left before freeze

- Wire Donna’s real `google-services.json` and a smoke test on a Nano-capable Pixel or Samsung device.
- Confirm `@Generable` / `responseJsonSchema` once we can run against a live model; today we parse free-form JSON.
- Remote Config for thresholds (the web app already reads `accept_on_device_threshold` / `human_review_threshold`).
- Field bounding boxes are not yet returned by the models, so review shows a full-page thumbnail rather than a tight crop.
- Align the web `READ_PROMPT` and `usage()` with this app (FINDINGS B2/B3) — that is web work, not this folder.
- Optional: Play Integrity App Check for a production build (debug provider only here).
- Optional: migrate Nano availability/download from the deprecated `FirebaseAIOnDevice.checkStatus()` / `download()` to `GenerativeModel.OnDeviceExtension`.
- Kotlin plugin warns Gradle 8.11.1 will be too old for Kotlin 2.5; bump the wrapper to 8.14.4+ when convenient (do not do this in a shared-tree git write from the Android agent).

## Tests

JUnit tests cover CER, routing, Nano JSON parsing, billed output tokens (including `thoughtsTokenCount`), `assertSafeForCloud` / `gateForCloud`, and the rule that CER uses raw OCR while the receipt shows de-id **counts and types**, never values.

```bash
./gradlew test
```
