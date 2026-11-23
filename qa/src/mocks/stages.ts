/**
 * Mock Stages that plug into core's Stage interface (packages/core/src/types.ts)
 * so runPipeline can be exercised end to end with Nano and Firebase mocked.
 */
import type { Stage, StageData, StageResult } from '../../../packages/core/src/types.ts';
import type { NanoMock } from './nano.ts';
import { getAI, getGenerativeModel, InferenceMode, type InferenceModeT, type Part } from './firebase-ai.ts';

const zero = () => ({ latencyMs: 0, costUsd: 0, bytesSent: 0 });

/** On-device OCR via the Nano mock. image -> text. */
export function nanoOcrStage(nano: NanoMock, opts: { confidence?: number; keepImage?: boolean } = {}): Stage {
  return {
    id: 'nano-ocr', name: 'Gemini Nano OCR', kind: 'ocr', accepts: ['image', 'text'],
    async run(input: StageData): Promise<StageResult> {
      const src = input.kind === 'text' ? input.text : `[image ${input.kind === 'image' ? input.image.base64.length : 0}b]`;
      const text = await nano.prompt(src);
      const output: StageData = { kind: 'text', text, ...(opts.keepImage && 'image' in input && input.image ? { image: input.image } : {}) };
      return { stageId: 'nano-ocr', stageKind: 'ocr', site: 'on_device', output, confidence: opts.confidence ?? 0.9, metrics: zero() };
    },
  };
}

/**
 * Cloud structuring stage via the Firebase AI Logic mock. Sends whatever text
 * (and image, if present) it receives - exactly what a naive implementation does.
 * Reports bytesSent honestly from the serialised request.
 */
export function firebaseStructureStage(nano: NanoMock, opts: { mode?: InferenceModeT; reply?: string; confidence?: number } = {}): Stage {
  const model = getGenerativeModel(getAI(), { mode: opts.mode ?? InferenceMode.ONLY_IN_CLOUD, nano, cloudReply: () => opts.reply ?? '{"medications":[],"labResults":[]}' });
  return {
    id: 'cloud-structure', name: 'Firebase AI Logic structuring', kind: 'structure', accepts: ['text'],
    async run(input: StageData): Promise<StageResult> {
      if (input.kind !== 'text') throw new Error('text only');
      const parts: Part[] = [{ text: `Extract medications and lab results as JSON:\n${input.text}` }];
      if (input.image) parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.base64 } });
      const r = await model.generateContent(parts);
      return {
        stageId: 'cloud-structure', stageKind: 'structure', site: r.response.inferenceSource,
        output: { kind: 'fields', doc: { documentType: 'other', medications: [], labResults: [] }, text: input.text },
        confidence: opts.confidence ?? 0.8,
        metrics: { latencyMs: 0, costUsd: r.bytesSent ? 0.0001 : 0, bytesSent: r.bytesSent },
        raw: r.response.text(),
      };
    },
  };
}

/** Pure local stage (e.g. a regex de-identifier stand-in or a verifier). */
export function localStage(id: string, kind: Stage['kind'], fn: (d: StageData) => StageData | Promise<StageData>, extra: Partial<StageResult> = {}): Stage {
  return {
    id, name: id, kind, accepts: ['image', 'text', 'fields'],
    async run(input) { return { stageId: id, stageKind: kind, site: 'local_code', output: await fn(input), metrics: zero(), ...extra }; },
  };
}

/** A stage that never settles unless its AbortSignal fires (models a hung cloud call while offline). */
export function hangingStage(id = 'hang', opts: { respectSignal?: boolean } = {}): Stage {
  return {
    id, name: id, kind: 'structure', accepts: ['text', 'image', 'fields'],
    run(_input, ctx) {
      return new Promise((_res, rej) => {
        if (opts.respectSignal) ctx.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      });
    },
  };
}

export const tinyPng = (label = 'x'): { mimeType: 'image/png'; base64: string } => ({ mimeType: 'image/png', base64: Buffer.from(`PNG-FAKE-${label}-`.repeat(8)).toString('base64') });
