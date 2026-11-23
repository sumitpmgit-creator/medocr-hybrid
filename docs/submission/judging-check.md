# MedOCR Hybrid — judging-criteria check

Draft dated 23 November 2026. Official criteria are four equal parts, confirmed on the [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) page:

1. **Technological Implementation** — How well is the project built, and how effectively does it use Firebase AI Logic hybrid inference as part of the solution?
2. **Design** — Does the project deliver a complete, coherent product experience, not just a technical proof of concept?
3. **Potential Impact** — Does the project make a credible, specific case for solving a real problem for a real audience, and does the solution address it based on what's demonstrated?
4. **Quality of the Idea** — Is this a creative, non-obvious use of Firebase AI Logic, and does the team show genuine understanding of the problem space?

Ratings below are of **the story and video as they can be supported today**, not of the ambition. The repo at the time of this draft is a scaffold: `apps/web` has a Vite + Firebase + pdfjs-dist package.json and an empty `src/`; `packages/core` is empty; `packages/parsing` is a stub; `datasets/ekacare` has only the dataset card; `scripts/import_ekacare.py` is referenced in the root package.json but is not in the tree; there is no `design.md`, no `LICENSE` file, and no README. Ratings will need a second pass once those land.

Each criterion is rated **strong**, **ok**, or **weak**.

---

## 1. Technological implementation of hybrid AI — **weak** (can become strong)

**What the story and video already argue well**

- Both legs of inference are intended to go through Firebase AI Logic, which the official rules and FAQs require (“all of your app's AI inference should go through Firebase AI Logic”).
- The hybrid policy is more specific than the SDK default of “on-device when available, otherwise cloud.” On-device Gemini Nano reads and de-identifies first; the cloud (`gemini-3.5-flash-lite`) sees only low-confidence, de-identified text; disagreement goes to a person. That is a real use of hybrid inference, not a wrapper around a single cloud call.
- Stage-attributed scoring (CER/WER for reading, field accuracy for JSON, error charged to the stage that introduced it) is technically substantive and comes from the SoalTech specification, including the five-document observation that OCR can be right while the next model is wrong.
- The web app's `pdfjs-dist` dependency is a sensible answer to a real platform constraint: on-device Nano accepts a single JPEG or PNG, not a PDF.

**Gaps**

- There is not yet a runtime call to Firebase AI Logic in the repo, so a judge who opens the code today would not see the required “imported and actually called” evidence.
- App Check is required for Firebase AI Logic and is not visibly set up. Debug tokens are allowed, but must not be committed.
- The default Hybrid Inference fallback would undermine the privacy promise if left on. The submission has to show that we *disabled or bypassed silent image-to-cloud fallback*, and what we do when Nano is missing or still downloading.
- On-device limits are easy to trip over in a demo: one image, JPEG/PNG only, a 9,216-token cap on web, Chrome desktop 139+ (with a multimodal flag) for the official web path, supported Android devices for the phone path. Multi-page PDFs and native PDF input are not on-device features.
- No measured accuracy, cost, or bytes-leaving-the-device figures exist to back the split screen.
- Official preference is multi-platform. The brief talks about a phone; the repo is a web app. Web on-device inference is documented for Chrome *desktop*, not a phone browser.

**What the build or demo still has to show**

- A public repo with a `LICENSE` file visible in GitHub/GitLab's About section (Apache is already declared in package.json and is the preferred licence). Firebase AI Logic imported and called at runtime for **both** on-device and cloud paths.
- App Check enabled; debug-token instructions for judges; no secrets in the repo.
- A live on-device run: image in, structured JSON out, identifiers stripped, image not uploaded.
- A live low-confidence field leaving the device as de-identified text only, with a bytes count.
- A live disagreement held for a person, not auto-resolved.
- An explicit, visible policy when Nano is unavailable (refuse / wait / informed opt-in) — never a silent upload of the page.
- [TBD: hybrid field accuracy, CER/WER, cost per document, and bytes sent, from a dated eval run] in the split-screen table.
- [TBD: chosen platform(s) running in the video.] If we want the “phone” story, an Android build is the official path.

---

## 2. Design — **weak** (can become ok to strong)

**What the story and video already argue well**

- The intended experience is a complete loop, not a notebook: capture → on-device read and de-identify → optional cloud assist → human confirm → comparison and scoring.
- The split-screen comparison (on-device only vs cloud only vs hybrid) is a coherent product idea, and it matches what the hackathon is asking people to understand about hybrid inference.
- The human-confirm state, with both model suggestions and a crop of the source line, is a clear interaction, not an afterthought.
- A responsible-use notice is written into the story and the video, which is part of designing honestly for this domain.

**Gaps**

- There is no UI, no `design.md`, and no interaction design to judge. Today this is a product story, not a product experience.
- Several design decisions that affect coherence are still open: phone vs desktop Chrome, what happens when the on-device model is missing, how a multi-page document is shown, who the “human” is (patient, clerk, clinician), and how confidence is presented without looking like a clinical guarantee.
- “Complete, coherent product” will be judged against polish, empty states, model-download progress, and whether a stranger can run the demo from the repo or a hosted URL. A hosted project is strongly encouraged, not required; judges may score from the video alone, which makes the video's UI clarity even more important.

**What the build or demo still has to show**

- A walkable UI on the submitted platform, including capture or file-open, model-download / unavailable states, de-identification inspector (“what would leave this device”), disagreement confirmation, and the three-column comparison.
- Empty, error and offline states that preserve the privacy rule.
- A labelled synthetic sample in the video, not a wall of JSON.
- [TBD: hosted demo URL and test instructions, with no production secrets.]
- [TBD: visual design from `design.md` once it lands — typography, layout, accessibility, language.]

---

## 3. Potential impact — **ok** (credible problem; evidence still thin)

**What the story and video already argue well**

- The problem is real and specific: paper prescriptions and lab reports, common in Indian clinical workflows, contain both clinical fields and identifiers (names, ABHA IDs, phone numbers). Shipping the photo to a cloud model is the easy path and the wrong one.
- The audience can be stated without hype: people who need those pages turned into structured fields — in a clinic, at a desk, or on a personal device — without sending identity off the device.
- Impact is tied to what the demo can actually show: fewer bytes leaving the device, field-level accuracy, cost, and a human stop when models disagree. That is more credible than a claim about nationwide health records.
- The “what's next” path to SoalTech's open-source benchmarking portal is a concrete afterlife, and the spec already names a multilingual need (Gujarati, Hindi, English and mixed-language writing for a Gujarat deployment). We should not pretend the portal is the submission.

**Gaps**

- The impact case is not yet “based on what's demonstrated,” because nothing has been demonstrated and no numbers exist.
- The primary audience is still fuzzy (patient vs receptionist vs clinician vs SoalTech's own operations). Judges will want one primary user in the first 30 seconds.
- We must not claim clinical validation, reduced medical error in the real world, or medical-device status. The SoalTech spec itself says benchmark scores do not establish clinical safety.
- EkaCare is a strong public starting set (288 already-redacted Indian prescription and lab images), but it does not include official structured JSON, so field-accuracy claims on that set have to be rubric-based or clearly qualified.
- Cost and “bytes sent” need a defined method, or the impact table will look like marketing.

**What the build or demo still has to show**

- One clear primary audience, named in the first 30 seconds of the video.
- A real comparison table: [TBD: accuracy, cost, bytes, sample size, dataset, date].
- A plain statement of what we did *not* measure (no clinical outcomes, no live patient study).
- [TBD: any qualitative feedback from a target user — only if it actually happens; no invented quotes.]

---

## 4. Quality of the idea — **strong** (the idea is the current lead; the build has to honour it)

**What the story and video already argue well**

- This is a non-obvious use of Firebase AI Logic. Many hybrid apps will show “Nano when present, cloud when not.” MedOCR Hybrid uses hybrid inference as a *privacy and confidence router*, then adds a human stop, then proves it with stage-attributed scores and a three-way comparison. That shows we understand both the SDK and the problem space.
- The idea is grounded in a real evaluation failure mode from the SoalTech handoff, not in a generic “AI for healthcare” pitch.
- The privacy rule is simple enough to be the tagline, and strict enough to constrain the architecture. Judges can test it: look at the payload.
- Responsible limits are part of the idea, not a footnote: abstain rather than guess a dose; no diagnostic claims.

**Gaps**

- An idea this clear will be judged harshly if the implementation quietly violates it (image upload, identifiers in the cloud prompt, auto-resolving disagreements, invented accuracy numbers).
- If the video cannot show a de-identified payload and a stage-attributed error, the idea stays a paragraph.
- Over-claiming (clinical safety, “the cloud never sees anything,” medical-device language, real patient stories) would make the idea look less careful than it is.

**What the build or demo still has to show**

- The payload inspector, one attributed error, and the split-screen table — the three exhibits that make the idea undeniable.
- Exact wording that matches the code: “only de-identified text,” not “nothing ever leaves the device,” unless bytes are truly zero on the happy path.

---

## Three biggest gaps (priority order)

1. **No working hybrid path for a judge to watch or run.** Firebase AI Logic + App Check + on-device Nano + de-identification + de-identified cloud assist + human confirm are specified, not built. Without live footage and in-repo calls, Technological Implementation and Design stay weak, and judges are allowed to score from the video alone.
2. **No measured comparison table.** The split-screen story depends on accuracy, cost and bytes sent. None of those numbers exist yet, and EkaCare cannot be treated as a turnkey field-accuracy benchmark. Inventing them would be worse than leaving `[TBD]` in this draft.
3. **Platform and product completeness.** The brief is a phone; the repo is a web app; official web on-device is Chrome desktop. There is no `design.md`, no `LICENSE` file, no README, no hosted URL, and no confirmed fallback when Nano is missing. That undercuts Design, the “phone” language in the pitch, and the official preference for multi-platform.

---

## Official submission checklist (not a fifth criterion, but a hard gate)

Confirmed from the official site, FAQs and Official Rules on 23 November 2026:

- [ ] At least one platform selected: Web (Chrome, Gemini Nano 4), Android (Gemini Nano 4), or iOS (Apple Foundation Models), all via Firebase AI Logic. Multi-platform is preferred, not required.
- [ ] Text description covering Firebase AI Logic use, features, and value proposition (see the paste-ready block in `devpost-story.md`).
- [ ] Public GitHub or GitLab repo, with an open-source **licence file** visible in About (Apache preferred). All source, assets and run instructions. Firebase AI Logic called at runtime, not only named in a README.
- [ ] Demo video ≤ 3 minutes, public YouTube, English or English subtitles, showing the app working on the submitted platform(s).
- [ ] App Check on; no production keys, secrets, or PII in the repo, form, or test instructions.
- [ ] Hosted demo URL strongly encouraged.
- [ ] If this were an existing app: a summary of what was built during the submission period. As of this draft it is a new project.
- [ ] Team members added on Devpost if this is a team or organization entry; one appointed representative.
- [ ] Deadline: **30 November 2026, 2:00 PM PT** (1 December 2026, 3:30 AM IST). The team's “submit on 30 November IST” target is earlier than the official close (end of 30 November IST is 10:29 AM PT) and is therefore safer. Feature freeze: 27 November. Commits after the deadline are not evaluated. Upload the YouTube video early.

---

## Suggested second pass

Re-rate all four criteria after: (a) `design.md` lands, (b) a first live on-device + cloud run exists, and (c) one eval table is filled in. Until then, do not let the pitch get ahead of the build.
