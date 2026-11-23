// SPDX-License-Identifier: Apache-2.0
/**
 * Shared helpers for cloud inference: offline/timeout/abort handling,
 * JSON parse-and-retry, and request-byte accounting that matches Sage's
 * EgressSpy (serialized generateContent JSON body) plus request headers.
 */
import {
  CLINICAL_DOC_JSON_SCHEMA,
  DEFAULT_THRESHOLDS,
  routeDoc,
  type ClinicalDoc,
  type RoutingThresholds,
} from '@med-ocr/core';
import { CLOUD_MODEL } from './firebase';

export const CLOUD_TIMEOUT_MS = 20_000;
export const CLOUD_REQUEST_HEADERS: Record<string, string> = { 'content-type': 'application/json' };
export const STRICT_JSON_INSTRUCTION = '\n\nReturn ONLY a valid JSON object matching the schema. No markdown fences, no prose.';

export const CLOUD_STRUCTURE_GENERATION_CONFIG = {
  responseMimeType: 'application/json',
  responseJsonSchema: CLINICAL_DOC_JSON_SCHEMA as unknown as Record<string, unknown>,
};

let reachableOverride: boolean | undefined;

/** Test hook. Pass `undefined` to restore `navigator.onLine` (or assume online in Node). */
export function setCloudReachableForTests(value?: boolean): void {
  reachableOverride = value;
}

export function isCloudReachable(): boolean {
  if (reachableOverride !== undefined) return reachableOverride;
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return /fetch|network/i.test(err.message);
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'AbortError' || err.name === 'TimeoutError';
  }
  if (err instanceof Error) {
    return /timeout|aborted|offline|Failed to fetch|network/i.test(err.message);
  }
  return false;
}

export function isTimeoutOrAbort(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'AbortError' || err.name === 'TimeoutError';
  }
  if (err instanceof Error) return /timeout|aborted/i.test(err.message);
  return false;
}

/** Combine the caller's cancel signal with AbortSignal.timeout. */
export function cloudAbortSignal(user?: AbortSignal, timeoutMs = CLOUD_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!user) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([user, timeout]);
  const combined = new AbortController();
  const abort = () => {
    if (!combined.signal.aborted) combined.abort(user.aborted ? user.reason : timeout.reason);
  };
  if (user.aborted || timeout.aborted) abort();
  else {
    user.addEventListener('abort', abort, { once: true });
    timeout.addEventListener('abort', abort, { once: true });
  }
  return combined.signal;
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function headerBytes(headers: Record<string, string> = CLOUD_REQUEST_HEADERS): number {
  let total = 0;
  for (const [key, value] of Object.entries(headers)) {
    total += utf8ByteLength(`${key}: ${value}\r\n`);
  }
  return total;
}

/** Request body shape used by the Firebase AI REST/SDK call (and Sage's QA mock). */
export function serializeCloudGenerateBody(
  model: string,
  parts: unknown[],
  generationConfig?: unknown,
): string {
  const body: Record<string, unknown> = {
    model,
    contents: [{ role: 'user', parts }],
  };
  if (generationConfig !== undefined) body.generationConfig = generationConfig;
  return JSON.stringify(body);
}

/**
 * Bytes Sage's fetch/EgressSpy sees for the body, plus the request headers.
 * EgressSpy.totalBytes is the UTF-8 body; the parent asked that our self-report
 * also include headers (`content-type`, etc.) so comparison/receipt stay honest.
 */
export function cloudRequestBytes(
  bodyJson: string,
  headers: Record<string, string> = CLOUD_REQUEST_HEADERS,
): number {
  return utf8ByteLength(bodyJson) + headerBytes(headers);
}

export function structureRequestBytes(prompt: string, model = CLOUD_MODEL): number {
  const parts = [{ text: prompt }];
  return cloudRequestBytes(serializeCloudGenerateBody(model, parts, CLOUD_STRUCTURE_GENERATION_CONFIG));
}

export function readRequestBytes(prompt: string, imageBase64: string, mimeType: string, model = CLOUD_MODEL): number {
  const parts = [
    { text: prompt },
    { type: 'inlineData', inlineData: { data: imageBase64, mimeType } },
  ];
  return cloudRequestBytes(serializeCloudGenerateBody(model, parts));
}

export function emptyDoc(): ClinicalDoc {
  return { documentType: 'other', medications: [], labResults: [], abstentions: [] };
}

export function parseCloudJson(raw: string): ClinicalDoc | null {
  const tryParse = (text: string): ClinicalDoc | null => {
    try {
      const value = JSON.parse(text) as Partial<ClinicalDoc>;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      return {
        documentType: value.documentType ?? 'other',
        medications: value.medications ?? [],
        labResults: value.labResults ?? [],
        abstentions: value.abstentions ?? [],
      };
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct) return direct;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return tryParse(raw.slice(start, end + 1));
  return null;
}

export const OFFLINE_STATUS = 'Offline: using the on-device result. Fields that needed the cloud were sent to human review.';
export const TIMEOUT_STATUS = 'Cloud timed out or was cancelled. Using the on-device result. Fields that needed the cloud were sent to human review.';
export const INVALID_JSON_STATUS = 'Cloud reply was not valid JSON after one retry. Using the on-device result. Fields that needed the cloud were sent to human review.';

export function flagFieldsForHumanConfirm(
  doc: ClinicalDoc,
  reason: string,
  sourceText = '',
  thresholds: RoutingThresholds = DEFAULT_THRESHOLDS,
): ClinicalDoc {
  const routed = routeDoc(doc, sourceText, thresholds);
  const abstentions = [...(doc.abstentions ?? [])];
  if (!abstentions.includes(reason)) abstentions.push(reason);
  for (const med of routed.meds.filter((m) => m.decision === 'send_to_cloud')) {
    abstentions.push(`HUMAN CONFIRM medication "${med.entity.name}": ${reason}`);
  }
  for (const lab of routed.labs.filter((l) => l.decision === 'send_to_cloud')) {
    abstentions.push(`HUMAN CONFIRM lab "${lab.entity.test}": ${reason}`);
  }
  return { ...doc, medications: [...doc.medications], labResults: [...doc.labResults], abstentions };
}

export async function readCloudJsonWithRetry(
  generate: (prompt: string) => Promise<string>,
  prompt: string,
): Promise<{ doc: ClinicalDoc | null; raw: string; retried: boolean }> {
  const first = await generate(prompt);
  if (parseCloudJson(first)) return { doc: parseCloudJson(first), raw: first, retried: false };
  const second = await generate(prompt + STRICT_JSON_INSTRUCTION);
  return { doc: parseCloudJson(second), raw: second, retried: true };
}
