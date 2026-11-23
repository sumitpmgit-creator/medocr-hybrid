# MedOCR Hybrid — tracker

Times are IST (Asia/Calcutta) unless marked PT. Official submissions lock **Mon 30 Nov 2026, 2:00 PM PT** (Tue 1 Dec, 3:30 AM IST).

**Feature freeze: Fri 27 Nov, 11:59 PM IST.** After that: fixes, scoring, video, and packaging only.

Owners: Louis (core engine), Rachel (parsing, labels), Avenger (web; Android stretch), Donna (Firebase, CI, repo, hosting), Sage (QA, scoring), Harvey (pitch, video, Devpost text), Mike (this PRD/tracker). Only Sumit can submit on Devpost or make the repo public.

| Day | Owner | Item |
| --- | --- | --- |
| Mon 23 Nov | Mike | Lean PRD + this tracker in `docs/product/` (done when this folder has only these two files). |
| Mon 23 Nov | Louis / Rachel / Avenger | Core, de-id, routing, web scaffold already in the repo; keep building against `design.md`. |
| Tue 24 Nov | Sumit / Donna | Firebase project: Auth (Anonymous), App Check, Firestore, Remote Config (`accept_on_device_threshold` 0.85, `human_review_threshold` 0.5), web config. No secrets in git. |
| Tue 24 Nov | Sumit / Avenger | Chrome desktop 139+, multimodal flag on, Nano downloaded. |
| Tue 24 Nov | Louis / Avenger | First real `ONLY_ON_DEVICE` Nano and `ONLY_IN_CLOUD` calls on a handful of sample docs; `initializeDeviceModel()` after the Scan gesture. |
| Tue 24 Nov | Rachel | Demo samples ready; start the hand-labeled reference set (EkaCare has rubrics, not official JSON). |
| Wed 25 Nov | Rachel / Sage | Aim for ~20 labeled prescriptions or lab reports; Sage runs the three-way comparison internally. **No published numbers.** |
| Wed 25 Nov | Donna / Avenger | Remote Config live in the app. |
| Wed 25 Nov | Sumit / Donna | Sprint 3 quota request by **Wed 25 Nov, 10:00 AM PT** (11:30 PM IST). |
| Thu 26 Nov | Avenger / Louis | Split-screen UI, data-receipt (bytes + identifiers removed), human-confirm flow, `inferenceSource` visible. |
| Thu 26 Nov | Sage | Privacy check: live-capture path never sends an image or raw PII to the cloud. |
| Fri 27 Nov | All | **Feature freeze** end of day. Bug-fix only after this. |
| Fri 27 Nov | Donna | Firestore rules, App Check on the hosted build, public web URL. |
| Fri 27 Nov | Sage | Freeze scoring run on the labeled set; go/no-go on quoting any number (default: no-go). |
| Fri 27 Nov | Harvey | Pitch v1 and a timed 3-minute script. |
| Sat 28 Nov | Harvey / Avenger / Sage | Dress rehearsal on the prepared Chrome machine (model pre-downloaded); record the video. |
| Sat 28 Nov | Harvey | Upload to YouTube (≤ 3 min, English or subtitles, synthetic samples only). Processing can take hours. |
| Sat 28 Nov | Avenger | Android is stretch only; do not jeopardize the web demo. |
| Sun 29 Nov | Donna | Repo ready to go public: LICENSE, run instructions, no secrets or PII. |
| Sun 29 Nov | Harvey | Devpost draft complete (hybrid explanation, features, value, video link, test notes — not in git). |
| Mon 30 Nov | Harvey prepares; **Sumit submits** | Submit on Devpost. Official lock is **2:00 PM PT** (Tue 1 Dec, 3:30 AM IST). Aim to submit earlier the same day and then leave the entered repo untouched. |

**Cut first if slipping:** Android, image-crop niceties, a 20-doc bench (ship a smaller labeled set), quoting any number. **Do not cut:** the privacy rule (no live image / raw PII to the cloud), Firebase AI Logic on all inference, App Check, Auth, Firestore, Remote Config, the web split-screen demo, the video, or an on-time submit.
