// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.CLOUD_MODEL
import com.medocr.hybrid.core.OFFICIAL_PRICES
import com.medocr.hybrid.core.billedOutputTokens
import com.medocr.hybrid.core.costUsd
import com.medocr.hybrid.core.displayCostUsd
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UsageTest {
    @Test
    fun billedOutputTokensAddThoughtsAtOutputRate() {
        // 100 visible output tokens + 40 thinking tokens = 140 billed output tokens
        assertEquals(140, billedOutputTokens(100, 40))
        assertEquals(100, billedOutputTokens(100, null))
        assertEquals(40, billedOutputTokens(null, 40))
        assertEquals(0, billedOutputTokens(null, null))
    }

    @Test
    fun officialCostIncludesThinkingTokens() {
        // $0.30 / 1M input, $2.50 / 1M output (benchmarks/pricing.json, 2026-11-23)
        val output = billedOutputTokens(candidatesTokenCount = 100_000, thoughtsTokenCount = 50_000)
        assertEquals(150_000, output)
        val usd = costUsd(CLOUD_MODEL, inputTokens = 1_000_000, outputTokens = output, prices = OFFICIAL_PRICES)
        // 0.30 * 1 + 2.50 * 0.15 = 0.30 + 0.375 = 0.675
        assertEquals(0.675, usd, 1e-9)
        val withoutThoughts = costUsd(CLOUD_MODEL, 1_000_000, 100_000, OFFICIAL_PRICES)
        assertTrue("thinking tokens must increase the bill", usd > withoutThoughts)
    }

    @Test
    fun displayCostFallsBackToOfficialRatesWhenCoreIsZero() {
        val (usd, estimated) = displayCostUsd(CLOUD_MODEL, 1_000_000, 1_000_000)
        assertTrue(estimated)
        assertEquals(2.80, usd, 1e-9)
    }

    @Test
    fun readPromptDoesNotAskTheModelToRedact() {
        assertFalse(READ_PROMPT.contains("[REDACTED]"))
        assertFalse(READ_PROMPT.contains("Replace patient names"))
        assertTrue(READ_PROMPT.contains("exactly as written"))
        assertTrue(READ_PROMPT.contains("Do not redact"))
    }
}
