// SPDX-License-Identifier: Apache-2.0
/**
 * Detect Chrome's Prompt API / Gemini Nano, used by Firebase AI Logic on-device
 * inference (Chrome desktop 139+).
 * https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
 */
export const CHROME_NANO_MIN_VERSION = 139;
export const CHROME_NANO_FLAG = 'chrome://flags/#prompt-api-for-gemini-nano-multimodal-input';

export type NanoStatus =
  | { state: 'available' }
  | { state: 'downloadable' }
  | { state: 'downloading' }
  | { state: 'unavailable'; reason: string }
  | { state: 'unsupported'; reason: string };

interface LanguageModelGlobal {
  availability(options?: {
    expectedInputs?: Array<{ type: string; languages?: string[] }>;
    expectedOutputs?: Array<{ type: string; languages?: string[] }>;
  }): Promise<string>;
}

export function chromeMajorVersion(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): number | undefined {
  const m = ua.match(/(?:Chromium|Chrome)\/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

export async function detectNano(): Promise<NanoStatus> {
  const languageModel = (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
  if (!languageModel || typeof languageModel.availability !== 'function') {
    const version = chromeMajorVersion();
    const hint =
      version !== undefined && version < CHROME_NANO_MIN_VERSION
        ? `Chrome ${version} detected; on-device inference needs Chrome ${CHROME_NANO_MIN_VERSION}+.`
        : `Chrome Prompt API (LanguageModel) is not present. Use Chrome desktop ${CHROME_NANO_MIN_VERSION}+ with ${CHROME_NANO_FLAG} enabled.`;
    return { state: 'unsupported', reason: hint };
  }
  try {
    const availability = await languageModel.availability({
      expectedInputs: [{ type: 'image' }, { type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    if (availability === 'available') return { state: 'available' };
    if (availability === 'downloadable') return { state: 'downloadable' };
    if (availability === 'downloading') return { state: 'downloading' };
    return { state: 'unavailable', reason: `On-device model availability: ${availability}` };
  } catch (err) {
    return { state: 'unavailable', reason: err instanceof Error ? err.message : String(err) };
  }
}

export function nanoStatusLabel(status: NanoStatus): string {
  switch (status.state) {
    case 'available':
      return 'Gemini Nano ready';
    case 'downloadable':
      return 'Gemini Nano downloadable — click Prepare to download';
    case 'downloading':
      return 'Gemini Nano is downloading';
    case 'unavailable':
    case 'unsupported':
      return status.reason;
  }
}
