// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core.deid

/**
 * Kotlin mirror of packages/parsing/src/deid/types.ts.
 *
 * Dates of birth are always redacted (`[DOB]`). Every other calendar date
 * is replaced with `[DATE]` before text may leave the device. An age in
 * years printed on the document may stay. `assertSafeForCloud` blocks any
 * residual date or DOB.
 */

enum class PhiType(val wire: String) {
    AADHAAR("aadhaar"),
    ABHA_NUMBER("abha_number"),
    ABHA_ADDRESS("abha_address"),
    PHONE("phone"),
    EMAIL("email"),
    NAME("name"),
    REG_NO("reg_no"),
    UHID("uhid"),
    ADDRESS("address"),
    PIN("pin"),
    DOB("dob"),
    DATE("date"),
    PAN("pan"),
    VID("vid");
}

/** @deprecated Use [PhiType]. Kept so early Android callers can migrate. */
typealias RedactionType = PhiType

data class PhiSpan(
    val type: PhiType,
    /** Inclusive start offset in the original (pre-redaction) string. */
    val start: Int,
    /** Exclusive end offset in the original (pre-redaction) string. */
    val end: Int,
)

/** @deprecated Use [PhiSpan]. */
typealias Redaction = PhiSpan

data class DeidentifyResult(
    val text: String,
    /** Spans in the original input, before placeholders and whitespace collapse. */
    val redactions: List<PhiSpan>,
    val total: Int = redactions.size,
)

/** Kotlin mirror of packages/core/src/deid.ts `DeidResult`. */
data class DeidResult(
    val text: String,
    /** Count of redactions per type. */
    val redactions: Map<PhiType, Int>,
    val total: Int,
    val spans: List<PhiSpan> = emptyList(),
)

/**
 * Placeholders emitted in `text`. Core's tokens are kept exactly:
 * [AADHAAR], [ABHA_NUMBER], [ABHA_ADDRESS], [PHONE], [EMAIL], [NAME],
 * [REG_NO], and [ID] (for UHID/MRN — not [UHID]).
 * Additions: [ADDRESS], [PIN], [DOB], [DATE], [PAN], [VID].
 */
val PLACEHOLDERS: Map<PhiType, String> = mapOf(
    PhiType.AADHAAR to "[AADHAAR]",
    PhiType.ABHA_NUMBER to "[ABHA_NUMBER]",
    PhiType.ABHA_ADDRESS to "[ABHA_ADDRESS]",
    PhiType.PHONE to "[PHONE]",
    PhiType.EMAIL to "[EMAIL]",
    PhiType.NAME to "[NAME]",
    PhiType.REG_NO to "[REG_NO]",
    PhiType.UHID to "[ID]",
    PhiType.ADDRESS to "[ADDRESS]",
    PhiType.PIN to "[PIN]",
    PhiType.DOB to "[DOB]",
    PhiType.DATE to "[DATE]",
    PhiType.PAN to "[PAN]",
    PhiType.VID to "[VID]",
)

val PLACEHOLDER_VALUES: Set<String> = PLACEHOLDERS.values.toSet()

fun redactionCounts(redactions: List<PhiSpan>): Map<PhiType, Int> {
    val out = linkedMapOf<PhiType, Int>()
    for (r in redactions) out[r.type] = (out[r.type] ?: 0) + 1
    return out
}
