// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing.deid

fun deidentify(text: String?): DeidentifyResult {
    val r = com.medocr.hybrid.core.deidentify(text ?: "")
    return DeidentifyResult(text = r.text, redactions = r.spans, total = r.total)
}

fun utf8Bytes(s: String): Int = com.medocr.hybrid.core.utf8Bytes(s)
