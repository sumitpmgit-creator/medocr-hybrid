// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

import java.nio.charset.StandardCharsets

/**
 * Kotlin mirror of packages/core/src/deid.ts.
 *
 * Deterministic de-identification safety net, run on-device AFTER Nano's own
 * redaction and BEFORE anything is sent to the cloud. Regex is conservative
 * by design: it may over-redact. Not a guarantee of anonymisation; names in
 * free text can slip through (documented risk).
 *
 * The document *image* is not redacted by this function. The privacy receipt
 * must say so when an image leaves the device.
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
}

data class DeidResult(
    val text: String,
    val redactions: Map<PhiType, Int>,
    val total: Int,
)

private data class Rule(
    val type: PhiType,
    val re: Regex,
    val replace: ((MatchResult) -> String)? = null,
)

private val RULES = listOf(
    Rule(PhiType.ABHA_NUMBER, Regex("\\b\\d{2}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b")),
    Rule(PhiType.AADHAAR, Regex("\\b\\d{4}[- ]\\d{4}[- ]\\d{4}\\b|\\b\\d{12}\\b")),
    Rule(PhiType.ABHA_ADDRESS, Regex("\\b[\\w.]+@(?:abdm|sbx)\\b", RegexOption.IGNORE_CASE)),
    Rule(PhiType.EMAIL, Regex("\\b[\\w.+-]+@[\\w-]+\\.[\\w.-]+\\b")),
    Rule(PhiType.PHONE, Regex("(?:\\+91[- ]?|\\b0)?\\b[6-9]\\d{4}[- ]?\\d{5}\\b")),
    Rule(PhiType.REG_NO, Regex("\\b(Reg(?:istration)?\\.?\\s*(?:No\\.?|Number)?\\s*[:#]?\\s*)([A-Z0-9/-]{3,})", RegexOption.IGNORE_CASE)) { m ->
        "${m.groupValues[1]}[REG_NO]"
    },
    Rule(PhiType.UHID, Regex("\\b((?:UHID|MRN|Patient\\s*ID|IP\\s*No|OP\\s*No)\\.?\\s*[:#]?\\s*)([A-Z0-9/-]{3,})", RegexOption.IGNORE_CASE)) { m ->
        "${m.groupValues[1]}[ID]"
    },
    Rule(PhiType.NAME, Regex("\\b((?:Patient(?:'s)?\\s*Name|Name|Patient|Pt\\.?)\\s*[:\\-]\\s*)((?:[A-Z][a-zA-Z.']*\\s?){1,4})")) { m ->
        "${m.groupValues[1]}[NAME] "
    },
    Rule(PhiType.NAME, Regex("\\b((?:Mr|Mrs|Ms|Miss|Master|Smt|Shri|Dr)\\.?\\s+)((?:[A-Z][a-zA-Z']+\\s?){1,3})")) { m ->
        "${m.groupValues[1]}[NAME] "
    },
)

fun deidentify(input: String): DeidResult {
    var text = input
    val redactions = mutableMapOf<PhiType, Int>()
    for (r in RULES) {
        text = r.re.replace(text) { m ->
            redactions[r.type] = (redactions[r.type] ?: 0) + 1
            r.replace?.invoke(m) ?: "[${r.type.wire.uppercase()}]"
        }
    }
    text = text.replace(Regex(" +\\n"), "\n").replace(Regex(" {2,}"), " ")
    val total = redactions.values.sum()
    return DeidResult(text, redactions, total)
}

fun utf8Bytes(s: String): Int = s.toByteArray(StandardCharsets.UTF_8).size
