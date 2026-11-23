# MedOCR Hybrid — 3-minute demo video script

Target length: **2 minutes 50 seconds** (official limit is 3:00; only the first 3 minutes may be evaluated). Leave a 10-second cushion for YouTube encoding and title cards.

Official video rules, confirmed 23 November 2026 from the [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) page, FAQs and Official Rules:

- Public YouTube link on the Devpost form.
- English, or English subtitles.
- Must show the project **actually running** on the platform(s) we submit (Web/Chrome, Android, and/or iOS). A slide-only video is not enough.
- FAQ advice from Cynthia Jiang (Firebase): the **first 30 seconds** should state who it is for, the problem, and how Firebase AI Logic makes it work. Judges may score from the video alone.
- No third-party logos, trademarks, or content we do not have rights to. No real patient documents, names, IDs, or phone numbers. Use only clearly labelled **synthetic** samples.
- Do not show production API keys, secrets, or App Check debug tokens.

Replace every `[TBD: …]` before recording. Do not invent numbers on screen.

**Platform note for the shoot:** the official Web on-device path is Chrome on desktop (v139+), not a phone browser. A true phone shoot needs the Android app (Gemini Nano 4 via Firebase AI Logic). [TBD: which platform(s) we record on.] If we only have the web app, say “on the device” and show Chrome desktop; do not imply an Android app we did not build.

---

## Title card (0:00–0:05)

**On screen:**  
MedOCR Hybrid  
Recommended tagline: *Only de-identified text ever leaves the device.*  
#BuildHybridAI 2026 · Firebase AI Logic  
Small footer: “Demo uses synthetic documents only. Not a medical device. Not for diagnosis.”

**Voiceover:**  
(soft, no voice yet, or a single line) “MedOCR Hybrid.”

---

## 1. The idea — first 30 seconds (0:05–0:30)

**On screen:**  
A person photographs a paper prescription (or drops a file onto the web app). The document is clearly stamped `SYNTHETIC SAMPLE`.  
Cut to a tight crop of the page: a made-up patient name, a fake ABHA ID, a fake phone number, and two medicine lines.  
Superimpose three short titles as the voiceover hits them:  
- Who: people who need a paper prescription or lab report turned into structured fields.  
- Problem: the useful fields are clinical; the dangerous fields are personal.  
- How: Firebase AI Logic runs Gemini Nano on the device, and the cloud only ever sees de-identified text.

**Voiceover:**  
“A paper prescription is still how a lot of care is written down. The useful part is the medicine and the dose. The dangerous part is the name, the phone number, the ABHA ID. MedOCR Hybrid reads the page on your device with Gemini Nano, through Firebase AI Logic. Personal details are stripped there. The cloud is asked only about the fields the phone isn't sure of — and it never sees the identity.”

---

## 2. On-device read and de-identification (0:30–0:55)

**On screen:**  
Live app, not a mock if we can help it. User opens the synthetic prescription.  
Show an on-device status: “Gemini Nano · Firebase AI Logic · on device.”  
The structured JSON fills in: medicine, strength, frequency, and so on.  
The name, ABHA ID and phone number are visibly removed or masked in the outgoing payload.  
A small inspector panel labelled “What would leave this device?” shows `0 bytes` at this moment, or only empty because every field is still local.  
[TBD: actual UI copy and whether some fields already route out in this sample.]

**Voiceover:**  
“Nano reads the page into JSON on the device, and it removes the personal details before anything else happens. The image itself does not go to the cloud. If the on-device model is confident, we stop here. No network call, no identity in transit.”

---

## 3. Cloud assist, de-identified only (0:55–1:20)

**On screen:**  
One or two fields are marked below the confidence threshold — for example a handwritten frequency, or a messy lab unit.  
Animate a payload leaving the device: a short JSON snippet with clinical text only. No name, no ID, no phone, no image.  
Show the cloud call labelled “Firebase AI Logic · gemini-3.5-flash-lite.”  
The cloud suggestion returns and is compared side by side with the on-device value.  
A bytes counter ticks up by a small number. [TBD: measured bytes for this sample.]

**Voiceover:**  
“When a field falls below our confidence threshold, we send only that de-identified text through Firebase AI Logic to a cloud model, gemini-3.5-flash-lite. Not the photo. Not the name. If the two models agree, we take the value. If they don't, we don't guess.”

---

## 4. Human confirmation on disagreement (1:20–1:40)

**On screen:**  
A disagreement state on a single field — for example on-device says `1-0-1`, cloud says `1-0-0`.  
The UI holds the field and asks a person to confirm, with both suggestions visible and the source crop of that line of the (synthetic) page.  
The user selects or types the confirmed value. The field is marked “confirmed by a person,” not “resolved by the model.”

**Voiceover:**  
“If they disagree, a person confirms the field. This is not a medical device, and it is not for diagnosis. A human stays in the loop for anything the two models cannot settle.”

---

## 5. Split-screen comparison (1:40–2:20)

**On screen:**  
Three columns, same synthetic document, run live or from a recorded live run:

| | On-device only | Cloud only | Hybrid |
|---|---|---|---|
| Accuracy (reading) | [TBD: CER / WER] | [TBD: CER / WER] | [TBD: CER / WER] |
| Accuracy (fields) | [TBD: field exact-match / F1] | [TBD: field exact-match / F1] | [TBD: field exact-match / F1] |
| Cost | [TBD: unit cost] | [TBD: unit cost] | [TBD: unit cost] |
| Bytes sent off the device | [TBD: bytes] | [TBD: bytes] | [TBD: bytes] |

Highlight, without inventing a winner, the pattern we expect to *discuss*: on-device sends the least (ideally nothing), cloud-only sends the most, hybrid sits in between and should be judged on whether the extra bytes bought better fields. If the measured numbers do not show that, say so honestly.  
Footer: dataset and sample count, e.g. “[TBD: evaluated on N synthetic / public documents, date of run]. Not clinical validation.”

**Voiceover:**  
“Here is the same document, three ways: on-device only, cloud only, and hybrid. We compare them on reading accuracy, field accuracy, cost, and how many bytes actually left the device. Hybrid is not a slogan. It is a trade we can measure.”

---

## 6. Stage-attributed scoring (2:20–2:45)

**On screen:**  
A single synthetic error, walked backwards. Example shape (replace with a real one from the eval run): the on-device transcript has the medicine name right, but the structured frequency is wrong, and the cloud either fixes it or does not.  
Show the three artifacts: on-device output, cloud output, final value.  
An error register pins the mistake on one stage: “attribution: on-device structure” or “attribution: cloud assist,” not “pipeline failed.”  
Briefly show CER/WER for the reading stage and field accuracy for the JSON stage as two separate scores.

**Voiceover:**  
“We don't give the pipeline one score and call it a day. We score the reading, we score the JSON, and we pin each error on the stage that caused it — because a name read correctly and then mapped to the wrong medicine is not an OCR failure.”

---

## 7. Close (2:45–2:50)

**On screen:**  
Tagline again: *Only de-identified text ever leaves the device.*  
Responsible-use line.  
“What's next: the same core, opened up as SoalTech's model benchmarking portal.”  
[TBD: public repo URL, hosted demo URL if we have them.]  
#BuildHybridAI

**Voiceover:**  
“MedOCR Hybrid: only de-identified text ever leaves the device. Not for diagnosis. A person confirms what the models can't. The same core will power an open benchmarking portal next.”

---

## Recording checklist

- [ ] Runtime is ≤ 2:50 in the edit, ≤ 3:00 on YouTube.
- [ ] First 30 seconds cover who, problem, Firebase AI Logic.
- [ ] Live footage of the submitted platform(s), with Nano and cloud calls visibly going through Firebase AI Logic.
- [ ] De-identified payload is shown (no name, ABHA ID, phone, or image leaving the device).
- [ ] Split-screen table uses measured numbers, or is clearly marked if a number is still pending — never invented.
- [ ] Stage attribution is shown with a real (synthetic) example.
- [ ] Responsible-use line is spoken and on screen.
- [ ] English audio or English subtitles.
- [ ] No real patient data; synthetic samples labelled as such.
- [ ] No third-party logos we don't have rights to; no secrets on screen.
- [ ] Upload early: YouTube processing can take hours, and the official deadline is 30 November 2026, 2:00 PM PT.
