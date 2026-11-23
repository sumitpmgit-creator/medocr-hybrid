# MedOCR Hybrid — day-by-day tracker

**Companion to:** [prd.md](./prd.md) v0.1 and [acceptance-criteria.md](./acceptance-criteria.md).  
**Author:** Mike (PM). **Date:** Mon 23 Nov 2026.  
**Timezone:** all clock times below are IST (Asia/Calcutta) unless a row also names PT.

**Hard dates**

| Milestone | When |
| --- | --- |
| Start | Mon 23 Nov 2026 (today) |
| Schema freeze (if `design.md` still has not landed) | Wed 25 Nov, end of day |
| **Feature freeze** | **Fri 27 Nov, 11:59 PM IST** |
| Dress rehearsal and first video take | Sat 28 Nov, afternoon |
| Devpost draft complete (repo, text, video link) | Sun 29 Nov, 6:00 PM IST |
| **Submit on Devpost** (buffer) | **Mon 30 Nov, 9:00 AM IST** (Sun 29 Nov, 7:30 PM PT) |
| Submissions lock | Mon 30 Nov, 2:00 PM PT = **Tue 1 Dec, 3:30 AM IST** |

After feature freeze: bug fixes, polish, scoring, video, and submission only. No new features. After the Devpost submit, do not push further commits to the entered repo; late commits are not evaluated.

---

## Owners

| Person | Lane |
| --- | --- |
| Louis | Core engine |
| Rachel | Parsing and dataset |
| Avenger | Web and Android |
| Donna | Firebase, CI, repo |
| Sage | QA and benchmark runs |
| Harvey | Pitch and submission text/video |
| Mike | PRD and this schedule; reconcile if `design.md` lands |

---

## Mon 23 Nov — Contract, Firebase, scaffolds

Today is for a buildable contract and unblocked platforms, not for a first accuracy number.

| ID | Owner | Item | Depends on | Done when |
| --- | --- | --- | --- | --- |
| D23-1 | Mike | PRD, acceptance criteria, tracker in `docs/product/` | Advisory brief, SoalTech spec, current Firebase / hackathon docs | This folder is written. Reconcile the same day if `design.md` appears |
| D23-2 | Donna | Firebase project: Auth, App Check, Firestore, Remote Config, AI Logic; local debug tokens kept out of git | Sumit/Advisory access to a Google / Firebase project | Avenger can initialize both clients against a real project without committed secrets |
| D23-3 | Donna | Public repo plan (GitHub or GitLab, Apache-2.0, CI skeleton). Workspace was not a git repo when this was written | Org/name from Sumit if one is required | Repo path or init steps are written down; license file plan exists |
| D23-4 | Louis | Core types: v0 JSON schema, stage artifact shapes, routing interface, inference-mode wrappers (`ONLY_ON_DEVICE` extract, `ONLY_IN_CLOUD` assist) | PRD §4 and §8 | Types and empty adapters compile in `@med-ocr/core`; no live image can be attached to the cloud adapter |
| D23-5 | Rachel | Confirm EkaCare license and the rubric-only limitation; draft redaction rules and the exact field types | `datasets/ekacare/DATASET_CARD.md`, SoalTech notes | A short schema + PII list checked against the PRD; import plan for a 5–10 doc demo set |
| D23-6 | Avenger | Web app shell: sign-in, upload/capture, placeholder result pane; start the Android project (min SDK 26) | Donna's Firebase config (can stub for hours if needed) | `apps/web` runs a sign-in screen; an Android module exists in the workspace |
| D23-7 | Sage | Test plan skeleton: privacy payload tests, scoring math fixtures, device/browser matrix | PRD §7–8, AC-21, AC-34–37 | A checklist of must ACs and the two demo machines we still need |
| D23-8 | Harvey | Pitch outline mapped to the four judging criteria; list of submission artifacts | Official rules and FAQs | One-page outline; flags any missing Devpost team access for Sumit |

## Tue 24 Nov — On-device path and corpus

| ID | Owner | Item | Depends on | Done when |
| --- | --- | --- | --- | --- |
| D24-1 | Louis | On-device extract + structured output through Firebase AI Logic, web first | D23-4, Donna's AI Logic access, a Chrome Desktop 139+ machine | A fixture image returns JSON with per-field confidence and `inferenceSource === ON_DEVICE` |
| D24-2 | Rachel | PII redaction implementation and unit tests; start the demo corpus and any labeled subset | D23-5 | Redaction tests pass on fixtures with names, phones, MRNs; at least a first pass of the 5–10 demo docs is listed |
| D24-3 | Avenger | Wire web: Auth, App Check, `initializeDeviceModel()` after the Scan gesture, download/progress copy, result UI | D24-1, D23-2 | Scan on the demo Chrome machine completes on-device and shows redacted chips |
| D24-4 | Avenger | Android: Firebase + on-device SDK wired, sample-image path compiling on a real device | D23-6, a Nano-capable device identified | App installs and can call the engine; if the device is still unconfirmed, this is flagged as R1 the same day |
| D24-5 | Donna | Remote Config key for the confidence threshold; Firestore schema and draft security rules; secrets hygiene check | D23-2 | Clients can fetch a threshold; rules exist in a reviewable file |
| D24-6 | Sage | Scoring harness skeleton (CER/WER, field exact-match) on fixtures, no published targets | D23-7, Louis's artifact shapes | A local command scores a toy pair and prints a run id |
| D24-7 | Harvey | First 30-second script draft against the PRD beat sheet | D23-8 | Script can be read aloud in 30 seconds |

**Login / device checkpoint (Tue):** demo Chrome machine (flag on, model download started or finished) and at least one supported Android device named. If either is missing, Harvey and Avenger escalate to Sumit the same day.

## Wed 25 Nov — Hybrid routing and split screen

Schema freeze at end of day if `design.md` still has not landed.

| ID | Owner | Item | Depends on | Done when |
| --- | --- | --- | --- | --- |
| D25-1 | Louis | Confidence router + cloud assist on de-identified text only + disagreement detection | D24-1, D24-2, D24-5 | A low-confidence field produces a cloud payload that Sage's privacy fixture accepts; disagreement is flagged |
| D25-2 | Rachel | Demo set of 5–10 docs in the repo path with a manifest; continue labels/rubric map | D24-2 | AC-59 is met; remaining label work is sized |
| D25-3 | Avenger | Web split-screen (on-device / cloud / hybrid), human-confirm UI, threshold rerun | D25-1, D25-2 | US-09, US-10, and AC-23 can be walked through on web |
| D25-4 | Avenger | Android happy path: sign in, open sample, hybrid result, confirm (UI may still be rough) | D24-4, D25-1 | AC-50 is reachable on the documented device |
| D25-5 | Donna | Harden Firestore rules; CI runs unit tests for core/parsing; hosting plan for the web URL | D24-5, D24-6 | A failing redaction or routing test would fail CI; hosting path is chosen |
| D25-6 | Sage | Privacy payload tests in CI (AC-21); first attribution cases | D25-1 | A deliberately dirty cloud fixture fails CI; clean fixture passes |
| D25-7 | Mike | If `design.md` appeared, reconcile this folder; otherwise freeze the v0 schema | design.md or its continued absence | Team is told which schema is frozen |

## Thu 26 Nov — Parity, first scored pass, pitch draft

| ID | Owner | Item | Depends on | Done when |
| --- | --- | --- | --- | --- |
| D26-1 | Louis | Harden stage artifacts, error handling (AICore `BUSY`, token limits), compact prompts | D25-1 | Failures are visible in the UI and in run logs; no live-image fallback on error |
| D26-2 | Rachel | Parsing polish on the demo set; hand Sage whatever labeled or rubric-mapped rows exist | D25-2 | Sage has a frozen input list for Friday's run, even if it is small |
| D26-3 | Avenger | Android closer to web parity for must ACs; camera path if it is stable (should) | D25-4 | Android can be recorded without narration having to apologize for a crash |
| D26-4 | Donna | App Check on both platforms in non-debug builds; prepare public repo contents minus secrets | D25-5 | A secrets scan is clean on the branch that will go public |
| D26-5 | Sage | First scoring pass on the available set. Report method, n, and numbers internally only | D26-2, D24-6, D26-1 | An internal run report exists. **Do not** put numbers in the pitch or video yet |
| D26-6 | Harvey | Pitch draft and a shot list for Saturday's recording | D24-7, D25-3 | A timed walkthrough of the 3-minute script exists |

## Fri 27 Nov — Feature freeze

**11:59 PM IST: feature freeze.** Anything not in the builds by then is cut or deferred (see cut-line below). The rest of the weekend is stabilization, evidence, and packaging.

| ID | Owner | Item | Depends on | Done when |
| --- | --- | --- | --- | --- |
| D27-1 | Avenger | Web and Android are demo-ready for the must path and the split screen | D26-3, D25-3 | Harvey can walk the beat sheet without a known blocker |
| D27-2 | Louis / Rachel | Bug fixes only after freeze; no schema additions | Freeze | Outstanding must bugs are on a short list or closed |
| D27-3 | Sage | Freeze benchmark run on the frozen demo/label set; decide with Harvey whether any number is publishable | D26-5, freeze | A committed run id and a written go/no-go for numbers (default is no-go unless the run is clean) |
| D27-4 | Donna | Freeze deploy of the web host and an Android test build | D27-1 | URLs / APK links work from a clean machine |
| D27-5 | Harvey | Pitch v1 and a rehearsal script with timings | D26-6, D27-3 | Script fits 3 minutes; first 30 seconds are locked |
| D27-6 | All | End-of-day freeze review (async is fine): what is in, what is cut, who is in the Saturday rehearsal | D27-1–D27-5 | Cut-line decisions are written in a short note or in this file |

## Sat 28 Nov — Dress rehearsal and video

Upload the video early; YouTube processing can take hours, and the FAQs warn about this.

| ID | Owner | Item | Depends on | Done when |
| --- | --- | --- | --- | --- |
| D28-1 | Harvey, Avenger, Sage | Dress rehearsal on the prepared Chrome machine and the Android device, models pre-downloaded | D27-1, D27-4 | A full timed run-through completes; issues go to a bug list, not a feature list |
| D28-2 | Harvey, Avenger | Record the 3-minute demo (web + Android). Second take if needed | D28-1, D27-5 | A cut that follows the PRD beat sheet exists |
| D28-3 | Harvey | Upload to YouTube (public, English or English subtitles) | D28-2 | A URL that will play for judges, even if processing is still finishing overnight |
| D28-4 | Sage, Louis, Avenger, Donna | Bug bash against must ACs, including privacy fixtures on the freeze build | D28-1 | Must regressions are fixed or documented; no new features |
| D28-5 | Rachel | Support any corpus or label fixes needed by the bash, without expanding scope | D28-4 | Demo set still matches the manifest |

## Sun 29 Nov — Submission package

| ID | Owner | Item | Depends on | Done when |
| --- | --- | --- | --- | --- |
| D29-1 | Donna | Public repo: license, README / run instructions, no secrets or PII, Firebase AI Logic called in source | D26-4, D28-4 | A secrets and PII scan is clean; a stranger could follow the README |
| D29-2 | Harvey | Devpost draft: description, hybrid explanation, features, value, what was built in the window, video link, test login instructions (not in git) | D28-3, D29-1, D27-4 | The form can be submitted as-is; only Sumit will press submit |
| D29-3 | Avenger / Donna | Confirm the hosted web URL and Android test build still match the video | D27-4, D28-4 | Testing instructions work on a clean pass |
| D29-4 | Sage | Final check of AC must list; confirm no unpublished-run numbers leaked into the pitch or README | D27-3, D29-2 | Written yes/no on every must AC |
| D29-5 | Harvey / Mike | Buffer review at 6:00 PM IST: leftover form fields, team membership on Devpost, disclaimer language | D29-2 | Open items are a short list for Monday morning, not new work |

## Mon 30 Nov — Submit, then stop

Target submit **9:00 AM IST** (Sun 29 Nov, 7:30 PM PT), about 18 hours before the lock at Mon 30 Nov, 2:00 PM PT / Tue 1 Dec, 3:30 AM IST. Do not wait until overnight.

| ID | Owner | Item | Depends on | Done when |
| --- | --- | --- | --- | --- |
| D30-1 | Harvey (package), **Sumit (submit)** | Submit on Devpost: video, repo, text, test access | D29-2, Sumit's approval and account | Submission shows as entered, well before 2:00 PM PT |
| D30-2 | Donna | Freeze the entered repo; no further commits on that remote | D30-1 | Team is told the entered SHA and to stop pushing |
| D30-3 | Sage / Avenger | Watch the hosted demo and video URL through the afternoon | D30-1 | If something breaks, we can still fix hosting or re-upload only if the rules and time allow; we do not add features |
| D30-4 | Harvey | Keep a local copy of the submitted text, video file, and SHA | D30-1 | The package can be reproduced if the form needs a typo fix before lock |

The remaining hours on Monday are slack, not a build day.

---

## Top risks

These match PRD §9. Owners in the table are the people who watch the risk day to day.

| Risk | Watcher | Early signal | What we do |
| --- | --- | --- | --- |
| R1 Nano unavailable on the demo devices | Avenger, Harvey | No supported Android device, or Chrome flag/model not ready by Tue 24 | Escalate to Sumit Tue; borrow a Pixel / supported device; pre-download; do not "fix" it by uploading live photos |
| R2 Privacy leak via `PREFER_ON_DEVICE` | Louis, Sage | Any cloud request with an image part on a live-capture path | Guard in the engine; AC-21 in CI; fail the build |
| R3 EkaCare has no official structured JSON | Rachel, Sage | Labeled subset still empty on Thu | Score rubrics + CER/WER; show method in the video; publish no invented field-accuracy numbers |
| R4 Android starts from zero | Avenger | Android happy path not installable on Wed | Drop should-level camera polish; keep sign-in, sample, hybrid, confirm; do not drop Android entirely until the cut-line says so |
| R5 Token limits / English-only on-device | Louis, Rachel | Truncated JSON, Indic-script failures | Compact schema; English prompts; unknown rather than guess |
| R6 Cold model download in the video | Harvey, Avenger | First take waits minutes | Pre-download Fri; do not record a cold start as the primary take |
| R7 Scope creep from the SoalTech portal | Mike, all | New document types or model registries mid-week | Refuse; point at the cut list |
| R8 Secrets or PII in the public repo | Donna, Sage | Token or photo in a commit | Scan before public; rewrite history if needed before the first public push |
| R11 Late submission | Harvey | Video not uploaded Sat, or form still empty Sun evening | Saturday upload, Sunday draft, Monday 9:00 AM IST submit |

`design.md` missing is R10: build against this PRD, reconcile if it lands, freeze schema Wednesday if it does not.

---

## Cut-line order

If we are slipping, cut from the top of this list first. Never cut the items under "Do not cut."

1. Should-level schema fields (`strength`, `dosageForm`, `route`, `timing`, `quantity`, `instructions`, lab `flag`).
2. In-app Android camera (keep gallery + samples).
3. Android three-column layout polish (keep a stacked hybrid view).
4. Manual field entry when Nano is missing.
5. Storing public sample images in Firestore.
6. Automated LLM-as-judge over the full EkaCare rubric set.
7. Multi-page / full-PDF beyond first-page rasterization.
8. A hosted judge URL if a local run plus video is all we can support (the URL is strongly encouraged; cut only after everything above).
9. Publishing any benchmark number (already the default: method only).
10. **Last resort, Advisory to confirm:** drop Android to a thinner companion and lead with web. Do not drop Android quietly.

**Do not cut:** the privacy envelope (no live image, no raw PII to the cloud); Firebase AI Logic used for all inference; Auth, App Check, Firestore, and Remote Config; the split-screen demo; the web happy path; stage artifacts and the scoring method; the 3-minute video and on-time Devpost submit; the non-clinical disclaimer.

---

## Notes for the team

- Only Sumit can approve outreach, a public push if that needs his account, or the Devpost submit. This tracker asks people to *prepare* those packages, not to send them.
- Only one heavy benchmark run at a time if the box is shared with other work. Sage schedules the Thu first pass and the Fri freeze run so they do not collide with a dress rehearsal.
- If `design.md` lands, Mike updates this folder and tells Advisory; engineering does not follow two schemas at once.
