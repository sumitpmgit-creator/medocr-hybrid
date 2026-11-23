/** Replacement for apps/web/src/firebase.ts during QA runs (no real Firebase app, no network). */
import { getAI } from './firebase-ai-sdk.ts';
export const CLOUD_MODEL = 'gemini-3.5-flash-lite';
export const isConfigured = true;
const ai = getAI({ name: 'qa' });
export function firebase() { return { app: { name: 'qa' }, ai }; }
export async function signIn() { return { uid: 'qa' }; }
export async function loadThresholds() { return { acceptOnDevice: 0.85, humanReview: 0.5 }; }
export async function saveRunSummary(_s: Record<string, unknown>) { return { id: 'qa' }; }
