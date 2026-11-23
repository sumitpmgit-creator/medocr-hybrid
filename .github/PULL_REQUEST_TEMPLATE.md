## What changed

<!-- One or two sentences. -->

## How to test

-

## Checklist

- [ ] `pnpm lint`, `pnpm test`, `pnpm typecheck`, and `pnpm build` pass locally.
- [ ] Firestore rules still deny unauthenticated and foreign-uid access to `users/{uid}/runs`, reject results text and images, and deny `users/{uid}/results` even for the owner. If the write payload changed, `firestore.rules` and `infra/test/firestore.rules.test.ts` were updated together.
- [ ] No live images, unredacted transcripts, production API keys, App Check debug tokens, service account keys, or `.env` files are in this PR.
- [ ] Remote Config key names still match `apps/web/src/firebase.ts` (`accept_on_device_threshold`, `human_review_threshold`), or both sides were updated.
- [ ] All app AI inference still goes through Firebase AI Logic (no direct Gemini API calls).
