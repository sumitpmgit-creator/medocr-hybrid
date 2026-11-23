/**
 * Firebase AI Logic mock that reproduces the hybrid-inference semantics of
 * firebase/ai (getAI / getGenerativeModel with InferenceMode) closely enough
 * to test routing and privacy:
 *
 *   PREFER_ON_DEVICE  -> Nano if available, otherwise SILENTLY cloud
 *   ONLY_ON_DEVICE    -> Nano or throw
 *   ONLY_IN_CLOUD     -> cloud
 *   PREFER_IN_CLOUD   -> cloud, Nano if the cloud call fails (offline)
 *
 * Cloud calls are serialised exactly like a generateContent REST body and sent
 * through globalThis.fetch, so the EgressSpy sees every byte.
 * Constants mirror @firebase/ai 3.1.0 (InferenceMode / InferenceSource).
 */
import type { NanoMock } from './nano.ts';

export const InferenceMode = {
  PREFER_ON_DEVICE: 'prefer_on_device',
  ONLY_ON_DEVICE: 'only_on_device',
  ONLY_IN_CLOUD: 'only_in_cloud',
  PREFER_IN_CLOUD: 'prefer_in_cloud',
} as const;
export type InferenceModeT = (typeof InferenceMode)[keyof typeof InferenceMode];
export const InferenceSource = { ON_DEVICE: 'on_device', IN_CLOUD: 'in_cloud' } as const;

export const CLOUD_URL = 'https://firebasevertexai.googleapis.com/v1beta/projects/medocr-test/locations/global/publishers/google/models/gemini-2.5-flash:generateContent';

export interface FakeAI { app: { name: string } }
export function getAI(app = { name: '[DEFAULT]' }): FakeAI { return { app }; }

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GenerateResult {
  response: { text(): string; inferenceSource: 'on_device' | 'in_cloud'; usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number } };
  bytesSent: number;
}

export function getGenerativeModel(_ai: FakeAI, params: { mode?: InferenceModeT; nano: NanoMock; cloudReply?: (parts: Part[]) => string }) {
  const mode = params.mode ?? InferenceMode.ONLY_IN_CLOUD;
  const toParts = (req: string | Part[]): Part[] => (typeof req === 'string' ? [{ text: req }] : req);
  const onDevice = async (parts: Part[]): Promise<GenerateResult> => {
    const text = await params.nano.prompt(parts.map((p) => ('text' in p ? p.text : '[image]')).join('\n'));
    return { response: { text: () => text, inferenceSource: 'on_device' }, bytesSent: 0 };
  };
  const cloud = async (parts: Part[]): Promise<GenerateResult> => {
    const body = JSON.stringify({ contents: [{ role: 'user', parts }] });
    const res = await fetch(CLOUD_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const json: any = await res.json();
    const text = params.cloudReply ? params.cloudReply(parts) : json?.text ?? '';
    return { response: { text: () => text, inferenceSource: 'in_cloud', usageMetadata: { promptTokenCount: Math.ceil(body.length / 4), candidatesTokenCount: Math.ceil(text.length / 4) } }, bytesSent: Buffer.byteLength(body, 'utf8') };
  };
  return {
    mode,
    async generateContent(req: string | Part[]): Promise<GenerateResult> {
      const parts = toParts(req);
      const avail = await params.nano.availability();
      switch (mode) {
        case InferenceMode.ONLY_ON_DEVICE:
          if (avail !== 'available') throw Object.assign(new Error('On-device model is not available'), { code: 'AI/unsupported' });
          return onDevice(parts);
        case InferenceMode.PREFER_ON_DEVICE:
          return avail === 'available' ? onDevice(parts) : cloud(parts);
        case InferenceMode.PREFER_IN_CLOUD:
          try { return await cloud(parts); } catch (e) { if (avail === 'available') return onDevice(parts); throw e; }
        default:
          return cloud(parts);
      }
    },
  };
}
