// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

/**
 * Kotlin mirror of packages/core/src/cost.ts.
 *
 * PRICES ARE PLACEHOLDERS: confirm current per-token pricing for the pinned
 * cloud model on the Gemini Developer API pricing page before quoting any number.
 *
 * Source: packages/core/src/cost.ts (values copied as-is, including the zeros).
 */

data class Price(val inputPerMTokUsd: Double, val outputPerMTokUsd: Double)

val PRICES: Map<String, Price> = mapOf(
    CLOUD_MODEL to Price(inputPerMTokUsd = 0.0, outputPerMTokUsd = 0.0), // TODO: fill from official pricing page
    "gemini-nano-on-device" to Price(inputPerMTokUsd = 0.0, outputPerMTokUsd = 0.0),
)

/**
 * Pinned cloud model used for low-confidence re-reads and the cloud comparison path.
 *
 * Verified listed on the official Firebase AI Logic models page
 * (https://firebase.google.com/docs/ai-logic/models, last updated 2026-11-18)
 * as "Gemini 3.5 Flash-Lite" / `gemini-3.5-flash-lite`. Also named as a
 * recommended replacement in the deprecation banner on the same docs set.
 * Keep this single constant in sync with packages/core/src/cost.ts.
 */
const val CLOUD_MODEL = "gemini-3.5-flash-lite"

fun costUsd(model: String, inputTokens: Int = 0, outputTokens: Int = 0): Double {
    val p = PRICES[model] ?: return 0.0
    return (inputTokens * p.inputPerMTokUsd + outputTokens * p.outputPerMTokUsd) / 1e6
}
