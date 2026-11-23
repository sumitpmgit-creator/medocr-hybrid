// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing.deid

/**
 * Kotlin mirror of packages/parsing/src/deid/deidentify.ts.
 * Run on-device before any *text* is sent to a cloud model. Not a guarantee
 * of anonymisation. Images are not inspected.
 */
fun deidentify(text: String?): DeidentifyResult {
    val src = text ?: return DeidentifyResult("", emptyList())
    val redactions = findRedactions(src)
    return DeidentifyResult(text = applyRedactions(src, redactions), redactions = redactions)
}
