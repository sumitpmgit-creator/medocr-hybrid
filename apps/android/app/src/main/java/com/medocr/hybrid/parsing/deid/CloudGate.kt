// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing.deid

/**
 * Fail-closed gate used before every cloud *text* request.
 * De-identifies, then runs assertSafeForCloud. If residual identifiers remain,
 * the caller must keep the work on-device and queue it for human confirm.
 * Does not inspect images (cloud-only OCR that uploads a page is a separate
 * documented trade-off).
 */
sealed class CloudGate {
    data class Safe(val text: String, val deid: DeidentifyResult) : CloudGate()
    data class Blocked(val findings: List<Redaction>, val deid: DeidentifyResult) : CloudGate()
}

fun gateForCloud(text: String): CloudGate {
    val deid = deidentify(text)
    val residual = residualIdentifiers(deid.text)
    return if (residual.isEmpty()) CloudGate.Safe(deid.text, deid) else CloudGate.Blocked(residual, deid)
}

fun residualSummary(findings: List<Redaction>): String {
    val counts = redactionCounts(findings)
    return findings.size.toString() + " residual identifier(s) of type " +
        counts.entries.joinToString(", ") { "${it.key.wire}=${it.value}" }
}
