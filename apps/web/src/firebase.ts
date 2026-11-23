// SPDX-License-Identifier: Apache-2.0
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getNumber } from 'firebase/remote-config';
import { DEFAULT_THRESHOLDS, type RoutingThresholds } from '@med-ocr/core';

/** Pinned so the Dec 1 auto-routing of older models cannot change results mid-judging. */
export const CLOUD_MODEL = 'gemini-3.5-flash-lite';

const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let app: FirebaseApp | undefined;
let ai: AI | undefined;

export function firebase() {
  if (!isConfigured) throw new Error('Firebase config missing: copy apps/web/.env.example to .env.local and fill it in.');
  if (!app) {
    app = initializeApp(firebaseConfig);
    if (env.DEV && env.VITE_APPCHECK_DEBUG === 'true') {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
    if (siteKey) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
    ai = getAI(app, { backend: new GoogleAIBackend() });
  }
  return { app, ai: ai! };
}

export async function signIn() {
  const auth = getAuth(firebase().app);
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!;
}

export async function loadThresholds(): Promise<RoutingThresholds> {
  const rc = getRemoteConfig(firebase().app);
  rc.settings.minimumFetchIntervalMillis = env.DEV ? 10_000 : 3_600_000;
  rc.defaultConfig = { accept_on_device_threshold: DEFAULT_THRESHOLDS.acceptOnDevice, human_review_threshold: DEFAULT_THRESHOLDS.humanReview };
  try { await fetchAndActivate(rc); } catch { /* offline: defaults */ }
  return { acceptOnDevice: getNumber(rc, 'accept_on_device_threshold'), humanReview: getNumber(rc, 'human_review_threshold') };
}

/** Stores metrics only. No image, no transcript, no PHI leaves the device via Firestore. */
export async function saveRunSummary(summary: Record<string, unknown>) {
  const user = await signIn();
  return addDoc(collection(getFirestore(firebase().app), 'users', user.uid, 'runs'), { ...summary, createdAt: serverTimestamp() });
}
