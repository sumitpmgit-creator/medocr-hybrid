// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

/**
 * Cost model.
 *
 * `PRICES` mirrors packages/core/src/cost.ts, which still has TODO zeros for
 * gemini-3.5-flash-lite. Display and comparison use [OFFICIAL_PRICES] from
 * benchmarks/pricing.json (retrieved 2026-11-23, paid tier, Gemini Developer API):
 * $0.30 / 1M input and $2.50 / 1M output.
 *
 * Thinking tokens are billed at the output rate. Always pass
 * [billedOutputTokens] (candidates + thoughts) as outputTokens.
 *
 * Sources:
 *   https://ai.google.dev/gemini-api/docs/pricing
 *   https://firebase.google.com/docs/ai-logic/thinking
 *   https://firebase.google.com/docs/reference/kotlin/com/google/firebase/ai/type/UsageMetadata
 */

data class Price(val inputPerMTokUsd: Double, val outputPerMTokUsd: Double)

const val CLOUD_MODEL = "gemini-3.5-flash-lite"

/** Mirror of packages/core/src/cost.ts (placeholders). */
val PRICES: Map<String, Price> = mapOf(
    CLOUD_MODEL to Price(inputPerMTokUsd = 0.0, outputPerMTokUsd = 0.0),
    "gemini-nano-on-device" to Price(inputPerMTokUsd = 0.0, outputPerMTokUsd = 0.0),
)

/**
 * Official paid-tier rates from benchmarks/pricing.json (2026-11-23).
 * Used when core PRICES are still zero so the UI does not show $0.00.
 */
val OFFICIAL_PRICES: Map<String, Price> = mapOf(
    CLOUD_MODEL to Price(inputPerMTokUsd = 0.30, outputPerMTokUsd = 2.50),
    "gemini-nano-on-device" to Price(inputPerMTokUsd = 0.0, outputPerMTokUsd = 0.0),
)

const val PRICING_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing"
const val PRICING_RETRIEVED = "2026-11-23"

/**
 * Billed output tokens: candidates (visible output) plus thinking tokens.
 * Kotlin SDK field: `GenerateContentResponse.usageMetadata.thoughtsTokenCount`
 * (https://firebase.google.com/docs/reference/kotlin/com/google/firebase/ai/type/UsageMetadata).
 * Google bills thinking tokens at the output rate.
 */
fun billedOutputTokens(candidatesTokenCount: Int?, thoughtsTokenCount: Int?): Int =
    (candidatesTokenCount ?: 0) + (thoughtsTokenCount ?: 0)

fun costUsd(model: String, inputTokens: Int = 0, outputTokens: Int = 0, prices: Map<String, Price> = PRICES): Double {
    val p = prices[model] ?: return 0.0
    return (inputTokens * p.inputPerMTokUsd + outputTokens * p.outputPerMTokUsd) / 1e6
}

/** Display cost: core prices if non-zero, otherwise official list rates. */
fun displayCostUsd(model: String, inputTokens: Int, outputTokens: Int): Pair<Double, Boolean> {
    val recorded = costUsd(model, inputTokens, outputTokens, PRICES)
    if (recorded > 0) return recorded to false
    val estimated = costUsd(model, inputTokens, outputTokens, OFFICIAL_PRICES)
    return estimated to (estimated > 0)
}
