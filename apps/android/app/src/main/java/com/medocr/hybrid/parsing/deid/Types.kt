// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing.deid

/**
 * Compatibility aliases. The source of truth is [com.medocr.hybrid.core.deid]
 * (packages/core/src/deid.ts).
 */
typealias PhiType = com.medocr.hybrid.core.deid.PhiType
typealias RedactionType = com.medocr.hybrid.core.deid.PhiType
typealias PhiSpan = com.medocr.hybrid.core.deid.PhiSpan
typealias Redaction = com.medocr.hybrid.core.deid.PhiSpan

data class DeidentifyResult(
    val text: String,
    val redactions: List<PhiSpan>,
    val total: Int = redactions.size,
)

fun redactionCounts(redactions: List<PhiSpan>) = com.medocr.hybrid.core.deid.redactionCounts(redactions)
