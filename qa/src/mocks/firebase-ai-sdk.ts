/**
 * Drop-in replacement for the `firebase/ai` module, wired in by the vitest
 * plugin in vitest.config.ts ONLY when code under apps/web or packages/* imports
 * it during a QA run. Shapes follow @firebase/ai 3.1.0's public types
 * (getAI, getGenerativeModel, InferenceMode, GoogleAIBackend, generateContent,
 * initializeDeviceModel, response.text(), response.inferenceSource).
 *
 * On-device calls go to the Nano mock registered at globalThis.__QA__.nano.
 * Cloud calls are serialised like the REST generateContent body (contents +
 * generationConfig) and POSTed through globalThis.fetch, so the EgressSpy
 * sees every byte, and the reply comes from globalThis.__QA__.cloudReply.
 */
import type { NanoMock } from './nano.ts';

export const InferenceMode = {
  PREFER_ON_DEVICE: 'prefer_on_device',
  ONLY_ON_DEVICE: 'only_on_device',
  ONLY_IN_CLOUD: 'only_in_cloud',
  PREFER_IN_CLOUD: 'prefer_in_cloud',
} as const;

export class GoogleAIBackend { backendType = 'GOOGLE_AI'; }
export class VertexAIBackend { backendType = 'VERTEX_AI'; constructor(public location = 'us-central1') {} }

export interface QARegistry {
  nano?: NanoMock;
  cloudReply?: (body: any) => string;
  calls: { mode: string; source: 'on_device' | 'in_cloud'; body?: any }[];
}
export function qa(): QARegistry {
  const g = globalThis as any;
  g.__QA__ ??= { calls: [] };
  return g.__QA__;
}

export function getAI(app?: unknown, options?: unknown) { return { app, options }; }

type AnyPart = string | { text?: string; inlineData?: { data: string; mimeType: string }; [k: string]: unknown };

function toParts(req: AnyPart | AnyPart[]): any[] {
  const arr = Array.isArray(req) ? req : [req];
  return arr.map((p) => (typeof p === 'string' ? { text: p } : p));
}

export function getGenerativeModel(_ai: unknown, params: any = {}) {
  const mode: string = params.mode ?? InferenceMode.ONLY_IN_CLOUD;
  const inCloud = params.inCloudParams ?? (params.mode ? {} : params);
  const R = qa();

  async function onDevice(parts: any[]) {
    const nano = R.nano;
    if (!nano) throw new Error('[qa] no Nano mock registered');
    const avail = await nano.availability();
    if (avail !== 'available') throw Object.assign(new Error('On-device model is not available'), { code: 'AI/unsupported' });
    const text = await nano.prompt(parts.map((p) => (p.text !== undefined ? p.text : '[image]')).join('\n'));
    R.calls.push({ mode, source: 'on_device' });
    return { response: { text: () => text, inferenceSource: 'on_device' as const } };
  }

  async function cloud(parts: any[]) {
    const body = { model: inCloud.model, contents: [{ role: 'user', parts }], generationConfig: inCloud.generationConfig };
    const json = JSON.stringify(body);
    const res = await fetch(`https://firebasevertexai.googleapis.com/v1beta/projects/qa/models/${inCloud.model ?? 'unknown'}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json });
    await res.json();
    const text = R.cloudReply ? R.cloudReply(body) : '{}';
    R.calls.push({ mode, source: 'in_cloud', body });
    return { response: { text: () => text, inferenceSource: 'in_cloud' as const, usageMetadata: { promptTokenCount: Math.ceil(json.length / 4), candidatesTokenCount: Math.ceil(text.length / 4), totalTokenCount: 0 } } };
  }

  return {
    mode,
    async initializeDeviceModel(onProgress?: (p: number) => void) { onProgress?.(1); },
    async generateContent(req: AnyPart | AnyPart[]) {
      const parts = toParts(req);
      const avail = R.nano ? await R.nano.availability() : 'unavailable';
      switch (mode) {
        case InferenceMode.ONLY_ON_DEVICE: return onDevice(parts);
        case InferenceMode.PREFER_ON_DEVICE: return avail === 'available' ? onDevice(parts) : cloud(parts);
        case InferenceMode.PREFER_IN_CLOUD: try { return await cloud(parts); } catch (e) { if (avail === 'available') return onDevice(parts); throw e; }
        default: return cloud(parts);
      }
    },
  };
}
