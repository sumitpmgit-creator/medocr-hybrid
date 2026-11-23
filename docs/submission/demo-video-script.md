# MedOCR Hybrid — 3-minute demo video script

Target length: **2 minutes 50 seconds**. Official limit is 3:00; only the first 3 minutes may be evaluated. Public YouTube, English or English subtitles, showing the app actually running on the platforms we submit (Web/Chrome and Android, per the PRD). FAQ advice: the first 30 seconds should state who it is for, the problem, and how Firebase AI Logic makes it work.

This follows the required beat sheet in `docs/product/prd.md` §5, with tighter narration. Replace every `[TBD: …]` before recording. Do not invent numbers on screen. Use only already-redacted public or clearly labelled synthetic samples — never a real parent's document. No third-party logos we do not have rights to, and no API keys or App Check debug tokens on screen.

Pre-download Gemini Nano on the demo machines (Chrome desktop 139+ with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled, and a Nano-capable Android device). Do not start a cold model download in the recorded take.

**Tagline on titles and close:** Only de-identified text ever leaves the device.

---

## Title card (0:00–0:05)

**On screen:** MedOCR Hybrid. *Only de-identified text ever leaves the device.* #BuildHybridAI 2026. Footer: “Demo uses already-redacted / synthetic samples only. Not a medical device. Not for diagnosis.”

---

## 0:05–0:30 — The idea

**On screen:** A caregiver opens a labelled sample prescription (not a live family photo). Tight crop of clinical lines next to redacted name / ID / phone chips. Superimpose: who, problem, Firebase AI Logic.

**Voiceover:**  
“This is MedOCR Hybrid, for people who manage a parent's prescriptions and lab reports. Those photos are full of personal details, so we should not ship them to the cloud. We use Firebase AI Logic to run Gemini Nano on the device: it turns the page into JSON and strips PII. Only de-identified text for shaky fields goes to gemini-3.5-flash-lite. If the two disagree, the caregiver confirms.”

---

## 0:30–1:10 — Caregiver path, web (Chrome desktop)

**On screen (live):** Sign in (Auth; mention App Check is on). Open a sample prescription. First tap has already prepared the on-device model — say so if the UI shows it. Extracted medicines appear, with redacted-name chips and one low-confidence frequency marked. Open the cloud-request pane: field keys, de-identified context, placeholders such as `[PATIENT_NAME]` — no image, no raw name. If the values disagree, confirm the field.

**Voiceover:**  
“On the web, Priya signs in and opens a sample. Nano reads the page on the device and removes the personal details before anything else happens. The photo itself does not go to the cloud. When a field falls below our confidence threshold, we send only that de-identified text through Firebase AI Logic. If the models disagree, she confirms the field. We never quietly pick a winner, and we never silently upload a live photo if Nano is missing.”

---

## 1:10–1:50 — Split screen

**On screen:** The same sample in three columns — On-device, Cloud, Hybrid. Each column shows `inferenceSource` (`ON_DEVICE` or `IN_CLOUD`), latency, structured fields, cost, and bytes that left the device. Hybrid highlights routed fields and any human confirm.

| | On-device only | Cloud only | Hybrid |
|---|---|---|---|
| Reading (CER / WER) | [TBD: CER / WER from committed reference run] | [TBD: CER / WER] | [TBD: CER / WER] |
| Field accuracy | [TBD: field exact-match / F1] | [TBD: field exact-match / F1] | [TBD: field exact-match / F1] |
| Cost | [TBD: cost per document] | [TBD: cost per document] | [TBD: cost per document] |
| Bytes sent off the device | [TBD: bytes] | [TBD: bytes] | [TBD: bytes] |

Footer: [TBD: dataset, sample count, date of Sage's committed run]. Not clinical validation. If the committed run is not ready by recording, show the method and the live latency / bytes / `inferenceSource` — not invented accuracy numbers.

Change a Remote Config confidence threshold and rerun so routing visibly changes.

**Voiceover:**  
“Here is the same document, three ways: on-device only, cloud only, and hybrid. We compare them on reading accuracy, field accuracy, cost, and how many bytes actually left the device. Hybrid is not a slogan. It is a trade we can measure. And because the threshold lives in Remote Config, we can change who gets a second look without shipping a new app.”

---

## 1:50–2:10 — Android

**On screen:** Cut to the Android app. Sign in, open the same sample (in-app camera only if it is stable). Hybrid result, one confirm. Same engine, same privacy rule.

**Voiceover:**  
“The Android app shares the same engine and the same rule. Sign in, same sample, hybrid result, one confirm. The live photo still does not leave the phone.”

---

## 2:10–2:40 — Trust and scoring

**On screen:** A compact score view on a public sample: [TBD: CER / WER], [TBD: field accuracy], and one real (sample) error pinned on a stage — on-device, cloud, routing, or human — not “the pipeline failed.” Show the three artifacts: on-device JSON, cloud JSON if called, final value after confirm. On-screen disclaimer: not a medical device; not clinical validation.

**Voiceover:**  
“We don't give the pipeline one score and call it a day. We score the reading, we score the JSON, and we pin each error on the stage that caused it — because a name read correctly and then mapped to the wrong medicine is not an OCR failure. These scores are not clinical validation, and this is not a diagnostic tool.”

---

## 2:40–2:50 — Close

**On screen:** Tagline. Web plus Android. Firestore holds de-identified history only. [TBD: public repo URL, hosted demo URL.] #BuildHybridAI

**Voiceover:**  
“The live photo and the raw personal details never leave the device. Only de-identified text does, and only when a field needs a second look. MedOCR Hybrid, on the web and on Android, through Firebase AI Logic.”

---

## Recording checklist

- [ ] Runtime ≤ 2:50 in the edit, ≤ 3:00 on YouTube.
- [ ] First 30 seconds cover who, problem, Firebase AI Logic.
- [ ] Live footage of web and Android, with `inferenceSource` visible.
- [ ] De-identified cloud payload shown (no image, no raw name / ID / phone).
- [ ] Split-screen table uses Sage's committed numbers, or shows method only — never invented accuracy.
- [ ] Stage attribution shown with a sample error.
- [ ] Remote Config threshold change shown.
- [ ] Responsible-use line spoken and on screen.
- [ ] English audio or English subtitles; no real patient data; no secrets on screen.
- [ ] Upload early: YouTube processing can take hours. Official deadline is 30 November 2026, 2:00 PM PT.
