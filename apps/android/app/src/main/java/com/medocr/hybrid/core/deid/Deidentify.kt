// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core.deid

/**
 * Kotlin mirror of packages/core/src/deid.ts `deidentify`.
 * Deterministic de-identification, run on-device before any text is sent to
 * a cloud model. Dates of birth become [DOB]; every other calendar date
 * becomes [DATE]. An age in years may stay. Place names that sit inside a
 * labelled address (e.g. "Green Park") are redacted on purpose as part of
 * that address span.
 */
fun deidentify(input: String): DeidResult {
    val text = input
    val spans = findRedactions(text)
    val counts = redactionCounts(spans)
    return DeidResult(
        text = applyRedactions(text, spans),
        redactions = counts,
        total = spans.size,
        spans = spans,
    )
}

fun utf8Bytes(s: String): Int = s.toByteArray(Charsets.UTF_8).size
