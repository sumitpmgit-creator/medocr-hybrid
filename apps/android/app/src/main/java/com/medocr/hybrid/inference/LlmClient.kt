// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.ExecutionSite

enum class GenerateKind { TEXT, JSON }

enum class InferenceTarget { ON_DEVICE, CLOUD }

data class LlmResponse(
    val text: String,
    val site: ExecutionSite,
    val inputTokens: Int = 0,
    /** Billed output tokens: candidates + thoughts. */
    val outputTokens: Int = 0,
    val candidatesTokenCount: Int = 0,
    val thoughtsTokenCount: Int = 0,
    val error: String? = null,
)

/**
 * Backend for a single generateContent call. Mock and Firebase implement this
 * so the three pipelines (on-device, cloud, hybrid) share one Stage wiring,
 * matching apps/web/src/stages.ts.
 */
interface LlmClient {
    val label: String
    suspend fun generate(
        prompt: String,
        imageJpeg: ByteArray?,
        mimeType: String?,
        target: InferenceTarget,
        kind: GenerateKind,
    ): LlmResponse
}

enum class AppInferenceMode {
    /** Always use the on-device mock. Works without Firebase, Nano, or a network. */
    MOCK,
    /** Try Firebase / Nano, fall back to mock (or cloud) if unavailable. */
    AUTO,
}
