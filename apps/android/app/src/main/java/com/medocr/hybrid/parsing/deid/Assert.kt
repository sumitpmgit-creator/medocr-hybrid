// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing.deid

/**
 * Kotlin mirror of packages/parsing/src/deid/assert.ts.
 * Fail-closed guard. Throws if any de-identification pattern still matches.
 * Call after deidentify() and before a cloud text request. Does not inspect images.
 */
class UnsafeForCloudError(val findings: List<Redaction>, sample: String) : Exception(
    "Text is not safe to send to the cloud: ${findings.size} residual identifier(s): " +
        findings.take(6).joinToString("; ") { f ->
            val slice = sample.substring(f.start.coerceAtLeast(0), f.end.coerceAtMost(sample.length))
            "${f.type.wire}@${f.start}-${f.end} (${slice})"
        },
) {
    override val message: String get() = super.message ?: "Text is not safe to send to the cloud"
}

fun assertSafeForCloud(text: String?) {
    val src = text ?: ""
    val findings = findRedactions(src)
    if (findings.isNotEmpty()) throw UnsafeForCloudError(findings, src)
}

/** Non-throwing form used by the pipeline to divert work to the human-confirm queue. */
fun residualIdentifiers(text: String?): List<Redaction> = findRedactions(text ?: "")
