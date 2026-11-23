# MedOCR Hybrid: QA test plan

Owner: Sage (QA). Last updated: 23 Nov 2026, 15:37 IST. Feature freeze: 27 Nov 2026.

Scope: `packages/core` (Louis), `packages/parsing` + `datasets/` (Rachel), `apps/web` (Avenger).
QA writes only inside `qa/`, and never edits product code. Every test goes through the **public entry points** (`@med-ocr/core` and `@med-ocr/parsing` via their `exports["."]`) or through the real `apps/web/src/stages.ts` Stages run by core's `runPipeline`.

## 1. How the tests run

| Piece | What it is |
|---|---|
| Runner | vitest 5.1.1 (the version the repo uses), installed only in `qa/node_modules` (`qa/` is not a pnpm workspace member). |
| Gemini Nano mock | `src/mocks/nano.ts` installs a fake Chrome Prompt API (`globalThis.LanguageModel`). Each test scripts `availability()` and the `prompt()` output. |
| Firebase AI Logic mock | `src/mocks/firebase-ai-sdk.ts` replaces `firebase/ai` (via a resolve plugin in `vitest.config.ts`, only during QA runs). It follows @firebase/ai 3.1.0 semantics for `InferenceMode` (`ONLY_ON_DEVICE`, `ONLY_IN_CLOUD`, `PREFER_ON_DEVICE` with a silent cloud fallback, and `PREFER_IN_CLOUD`). Cloud calls are serialised like a REST `generateContent` body (`contents` + `generationConfig`) and POSTed through `fetch`. `apps/web/src/firebase.ts` is swapped for `src/mocks/web-firebase.ts`, so there is no real Firebase app and no credentials. |
| Network-egress spy | `src/egress.ts` intercepts `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket#send`, and `node:http(s).request`. It is **deny-by-default** (nothing reaches the real network) and can also fake replies or act offline. It records the URL, body, byte count, and whether image/binary data was sent. |
| PII leak scanner | `src/pii.ts` has an adversarial corpus of 35 synthetic cases (34 single-identifier cases plus one full prescription). It finds identifiers in any payload as an exact match, alnum-folded, digits-only (for IDs of 6 or more digits), or by name token. Before scanning it also decodes JSON strings, URL-encoding, base64 runs, full-width digits, and Devanagari digits. |
| Oracles | `src/oracle.ts` provides an independent Levenshtein (CER/WER), ECE, a seeded PRNG, and a text corrupter for differential tests. |
| Results | `pnpm results` writes `results/latest.json` and `results/SUMMARY.md` with per-area counts. |

A test that needs code that does not exist yet is `skipIf`-guarded, so it turns on by itself when the export lands. A "gate" test (e.g. SCORE-42) fails on purpose to make a missing capability visible.

## 2. Areas and test cases

### HARNESS: the instruments themselves (tests/harness.test.ts)
| ID | Checks | How |
|---|---|---|
| HAR-01 (x34) | The scanner finds every identifier in every raw corpus case | `findLeaks(case.text)` must equal the case's PII list |
| HAR-02 | The scanner finds PII inside JSON-escaped, URL-encoded, and base64 payloads | Encoded FULL_RX |
| HAR-03 | No false positives on properly de-identified clinical text | Placeholder text with lab values like 2,50,000 |
| HAR-10/11 | The spy blocks real fetch (deny) and fails like a browser (offline) | Direct fetch |
| HAR-12 | XHR, beacon, WebSocket, and node:https are captured | Each channel |
| HAR-13 | Image `inlineData` parts are flagged as binary egress | JSON body with inlineData |
| HAR-14 | Firebase `PREFER_ON_DEVICE` with Nano unavailable silently goes to the cloud (the hazard) | Firebase mock + spy |
| HAR-15/16 | `ONLY_ON_DEVICE` never touches the network; `PREFER_IN_CLOUD` falls back to Nano offline | Firebase mock |
| HAR-20/21 | The Levenshtein and ECE oracles give textbook values | Unit |

### REPO: build, test, and data health (tests/repo.test.ts)
| ID | Checks |
|---|---|
| REPO-01/02/03 | The core and parsing public entries exist, export symbols, and import cleanly |
| REPO-04 | `pnpm-lock.yaml` has an importer for every workspace package (frozen install works) |
| REPO-05 | Every package with `vitest run` has vitest installed and at least one test file |
| REPO-06 | Every package with a `tsc` typecheck script has a tsconfig |
| REPO-07 | The root `import:ekacare` script target exists |
| REPO-08 (per pkg) | `tsc --noEmit -p <pkg>` is clean |
| REPO-09 | Core declares every bare package it imports |
| REPO-10 | EkaCare images or manifest are imported (benchmark input) |
| REPO-11 | AMR manifest has `referenceText` and every image exists (CER/WER ground truth) |

### ROUTING: on-device vs cloud (tests/routing.test.ts)
| ID | Checks | How |
|---|---|---|
| ROUTE-01/02 | `routeDoc` threshold boundary: `>=` accepts, just below goes to cloud | core unit |
| ROUTE-03/04 | Missing or NaN confidence leads to cloud, never accepted | core unit |
| ROUTE-05 | Out-of-range confidence (1.7, -0.2) is clamped or rejected | core unit |
| ROUTE-06 | Confident but ungrounded (hallucinated) entity goes to cloud | core unit |
| ROUTE-07 | Remote-Config thresholds are honoured | core unit |
| ROUTE-08/09 | `toCloud` count; an empty doc routes nothing | core unit |
| ROUTE-10..16 | `reconcileMedication`/`reconcileLab`: normalised agreement, critical disagreement leads to human confirm, dose case, **route field**, cloud missing, low cloud confidence, lab values | core unit |
| ROUTE-20..23 | parsing `fieldsBelowThreshold`: strict `<`, includeUnreadable, routed payload has no rawText/PII, NaN | parsing unit |
| ROUTE-24 | core and parsing use one cloud threshold, not two | constants |
| ROUTE-30..34 | `runPipeline`: site per stage, totals, kind mismatch, throwing stage, failed-stage latency, `readingText` skips deid | core + mock stages |
| ROUTE-40..44 | apps/web `hybridVerify`: only low-confidence names sent; only routed entities replaced; disagreement leads to HUMAN CONFIRM; name variants reconcile; malformed cloud JSON doesn't crash | real Stage + Nano/Firebase mocks + spy |

### DEID: no PII/PHI reaches the cloud (tests/deid.test.ts)
Corpus (`src/pii.ts`, all synthetic). Names: plain, ALL-CAPS with honorific, lowercase and unlabelled, split across lines, initials with S/O relation, Devanagari, letter-spaced OCR noise. Phones: +91 spaced, 0-prefixed with hyphen, digit pairs, landline with STD code, full-width digits, Devanagari digits, glued to text. National IDs: Aadhaar spaced, hyphenated, dotted; VID; ABHA; PAN. Addresses: multi-line with PIN; H.No with spaced PIN. DOB: dd/mm/yyyy, ISO, in words, short dotted. MRN: plain, UHID with site code, IP No with slash, alphanumeric Reg#, glued PID, AMR-style "Hospital number: 2023/BF/057". Email: plain and obfuscated. FULL: a complete prescription.

| ID | Checks | How |
|---|---|---|
| DEID-00 | A de-identifier is publicly exported | adapter |
| DEID-{core,parsing}-<case> | After `deidentify(text)`, no identifier survives in any form | scanner on output, run for **each** exported implementation |
| DEID-*-KEEP-<case> | Clinical strings survive (over-redaction check) | substring |
| DEID-*-IDEM | Running deidentify twice is stable | unit |
| DEID-*-LAB | Long lab numbers (250000 /cumm, ranges) are not taken for IDs | unit |
| DEID-E2E-01 | **Hybrid** pipeline: Nano leaves PII in the transcript, and the cloud-verify payload must still carry none (if the guard blocks the call, the output must say HUMAN CONFIRM / blocked) | real Stages, runPipeline, spy |
| DEID-E2E-02 | Hybrid: Nano obeys READ_PROMPT perfectly, and DOB/address/PIN still must not leave | same |
| DEID-E2E-03 | Hybrid: no image bytes are ever sent | `spy.binaryEgress()` |
| DEID-E2E-04 | Hybrid: all entities confident means zero bytes leave | spy.attempts |
| DEID-E2E-05 | On-device-only: zero egress | spy |
| DEID-E2E-06 | Cloud-only: raw image and transcript are not uploaded for user documents | spy |
| DEID-E2E-07 | Reported `bytesSent` is within 10% of the bytes on the wire (clean transcript, so the cloud call really happens) | totals vs spy |
| DEID-E2E-08 | Hybrid: a transcript with several hard identifiers at once doesn't leak (fail-closed guard) | spy |
| DEID-E2E-09 (x10) | Hybrid: **one** residual identifier alone (DOB, DOB in words, spaced PIN, full-width phone, glued phone, Devanagari name, lowercase name, hospital number, dotted Aadhaar, PAN) doesn't reach the cloud through core deid plus the parsing `assertSafeForCloud` guard | spy |
| DEID-S01 | Every pipeline that has a cloud stage runs a `deid` stage before it | structural check on `pipelines()` |
| DEID-G01 | Core runner refuses or de-identifies when an in_cloud stage gets text that never passed a deid stage | mock stages + spy |
| DEID-G02 | `StageData.image` is not forwarded into an in_cloud stage | mock stages + spy |

### SCORING: correctness and calibration (tests/scoring.test.ts)
| ID | Checks |
|---|---|
| SCORE-01..08 | CER/WER known values: identity, kitten/sitting, WER, >1.0, empty ref, NFC, Devanagari code points, whitespace |
| SCORE-09 | **Differential:** 300 seeded corrupted pairs, core CER/WER = oracle |
| SCORE-10 | S+D+hits = refLength |
| SCORE-11..13 | numericAccuracy: basics, range hyphen vs minus, Indian digit grouping |
| SCORE-14..16 | similarity symmetry, fuzzyContains, omission/invention rates |
| SCORE-20..25 | scoreFields: identity, permitted formatting, wrong strength fails safety, missing med, hallucinated med, empty docs |
| SCORE-26/27 | Order independence with duplicate entity names (Neutrophils %/abs; same drug at two strengths) |
| SCORE-28 | Entity matching is symmetric (Metformin vs Metformin SR) |
| SCORE-29 | Lab unit/value equivalents (gm/dL = g/dL, mcg = µg, "< 0.5" = "<0.5") |
| SCORE-30 | Hand-computed P/R/F1 |
| SCORE-40 | groundedConfidence never exceeds self-report |
| SCORE-41 | **Calibration:** ECE ≤ 0.15 on 400 synthetic entities (Nano self-reports 0.95; 40% hallucinated) |
| SCORE-42 | A calibration utility is exported (gate) |
| SCORE-50..52 | scoreRun and summarize (Benchmark C): CER from the reading stage, F1 from final fields, means and sums, failed flag |
| SCORE-60..62 | costUsd: pinned cloud model is non-zero, unknown model is not silently $0, on-device is $0 |

### OFFLINE: no network means degrade to on-device (tests/offline.test.ts)
| ID | Checks | How |
|---|---|---|
| OFF-01 | On-device-only completes offline with zero egress | spy.offline() + navigator.onLine=false |
| OFF-02 | Hybrid offline returns the on-device result: not failed, low-confidence items flagged | real Stages |
| OFF-03 | Hybrid makes no cloud attempt while `navigator.onLine === false` | spy.attempts |
| OFF-04 | Hybrid offline with all entities confident: success, zero egress | |
| OFF-05 | Cloud-only offline fails fast with a clear error, no hang | 2 s race |
| OFF-06 | Nano unavailable and offline: graceful failure, no cloud fallback | |
| OFF-07 | Nano unavailable while **online**: hybrid never silently uploads raw data | |
| OFF-08 | Mid-run drop keeps the on-device trace (readingText still scoreable) | |
| OFF-09 | Back online: next run reaches the cloud normally | |
| OFF-10 | AbortSignal stops a hung stage within 1 s | core runner + hanging stage |
| OFF-11 | Signal aborted between stages stops later stages | core runner |
| OFF-12 | apps/web stages forward `ctx.signal` to the SDK | static |

## 3. Manual and not-yet-automatable checks (before freeze)
| ID | Check | Why manual |
|---|---|---|
| MAN-01 | Real Chrome 139+ with Gemini Nano: `prepareOnDevice`, then run hybrid on 5 AMR images; DevTools Network shows no request body with identifiers and no image upload | needs a real browser and model |
| MAN-02 | DevTools "Offline" during a hybrid run: UI shows the on-device result with flags, no spinner hang | real UI |
| MAN-03 | Remote Config offline: `loadThresholds` falls back to 0.85/0.5 defaults | needs a Firebase project |
| MAN-04 | Firestore `saveRunSummary` documents contain metrics only (inspect in the console) | needs a Firebase project |
| MAN-05 | App Check / reCAPTCHA traffic contains no document data | real network |

## 4. Benchmark plan (after the pipeline works with real models)
Run on-device-only, cloud-only, and hybrid through `runPipeline` and `summarize` on `datasets/amr` (has `referenceText`, for CER/WER) and on EkaCare once images are imported (rubrics only, no transcripts). Record CER, WER, field F1, safety-pass rate, mean latency, cost, and **bytes sent measured by the egress spy or a DevTools HAR** (not only self-reported, see BUG-022). The scorers used are the ones verified in SCORE-01..30. Known scorer defects (BUG-011, 013, 014, 015) bias field F1 downward and should be fixed or footnoted before numbers go into the Devpost write-up.
