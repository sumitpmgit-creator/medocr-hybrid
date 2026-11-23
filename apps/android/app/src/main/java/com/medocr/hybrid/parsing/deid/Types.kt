// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing.deid

/**
 * Kotlin mirror of packages/parsing/src/deid/types.ts.
 * Dates are not classified as PII (SoalTech handoff, 23 Nov 2026).
 */

enum class RedactionType(val wire: String) {
    NAME("name"),
    ABHA("abha"),
    PHONE("phone"),
    ADDRESS("address"),
    REG_NO("reg_no"),
    EMAIL("email"),
    AADHAAR("aadhaar"),
    UHID("uhid");
}

data class Redaction(
    val type: RedactionType,
    /** Inclusive start offset in the original (pre-redaction) string. */
    val start: Int,
    /** Exclusive end offset in the original (pre-redaction) string. */
    val end: Int,
)

data class DeidentifyResult(
    val text: String,
    val redactions: List<Redaction>,
)

val PLACEHOLDERS: Map<RedactionType, String> = mapOf(
    RedactionType.NAME to "[NAME]",
    RedactionType.ABHA to "[ABHA]",
    RedactionType.PHONE to "[PHONE]",
    RedactionType.ADDRESS to "[ADDRESS]",
    RedactionType.REG_NO to "[REG_NO]",
    RedactionType.EMAIL to "[EMAIL]",
    RedactionType.AADHAAR to "[AADHAAR]",
    RedactionType.UHID to "[UHID]",
)

val PLACEHOLDER_VALUES: Set<String> = PLACEHOLDERS.values.toSet()

fun redactionCounts(redactions: List<Redaction>): Map<RedactionType, Int> {
    val out = linkedMapOf<RedactionType, Int>()
    for (r in redactions) out[r.type] = (out[r.type] ?: 0) + 1
    return out
}
