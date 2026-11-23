// SPDX-License-Identifier: Apache-2.0
/**
 * Token accounting for Firebase AI Logic responses.
 * Google bills thinking tokens at the output rate, so thoughtsTokenCount is
 * added to outputTokens whenever the field is present.
 * https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
 */
export interface ModelUsage {
  inputTokens: number;
  /** candidatesTokenCount + thoughtsTokenCount (when present). */
  outputTokens: number;
  thoughtsTokenCount: number;
  candidatesTokenCount: number;
}

export interface UsageMetadataLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

export function usageFromResponse(result: { response: { usageMetadata?: UsageMetadataLike } }): ModelUsage {
  const meta = result.response.usageMetadata;
  const inputTokens = meta?.promptTokenCount ?? 0;
  const candidatesTokenCount = meta?.candidatesTokenCount ?? 0;
  const thoughtsTokenCount = meta?.thoughtsTokenCount ?? 0;
  return {
    inputTokens,
    candidatesTokenCount,
    thoughtsTokenCount,
    outputTokens: candidatesTokenCount + thoughtsTokenCount,
  };
}
