// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

/**
 * Kotlin mirror of packages/core/src/normalize.ts.
 * Clinical value normalisers ("permitted normalization" for field exact-match).
 * Source values are never overwritten.
 */

private val FREQ: Map<String, String> = mapOf(
    "od" to "1-0-0", "qd" to "1-0-0", "once daily" to "1-0-0", "once a day" to "1-0-0", "daily" to "1-0-0",
    "bd" to "1-0-1", "bid" to "1-0-1", "twice daily" to "1-0-1", "twice a day" to "1-0-1",
    "tds" to "1-1-1", "tid" to "1-1-1", "thrice daily" to "1-1-1", "three times a day" to "1-1-1",
    "qid" to "1-1-1-1", "four times a day" to "1-1-1-1",
    "hs" to "0-0-1", "at night" to "0-0-1", "at bedtime" to "0-0-1",
    "sos" to "sos", "prn" to "sos", "as needed" to "sos", "stat" to "stat",
)

private val UNIT: Map<String, String> = mapOf(
    "mgs" to "mg", "milligram" to "mg", "milligrams" to "mg",
    "mcg" to "mcg", "µg" to "mcg", "ug" to "mcg",
    "ml" to "ml", "iu" to "iu", "g" to "g", "gm" to "g", "gms" to "g",
)

fun normalizeFrequency(v: String?): String {
    if (v.isNullOrEmpty()) return ""
    val t = v.lowercase().replace(Regex("[.\\s]+"), " ").trim()
    val dashed = t.replace(Regex("\\s*[-–x×]\\s*"), "-")
    if (Regex("^\\d(?:/\\d)?(?:-\\d(?:/\\d)?){2,3}$").matches(dashed)) return dashed
    return FREQ[t] ?: FREQ[t.replace(" ", "")] ?: t
}

fun normalizeStrength(v: String?): String {
    if (v.isNullOrEmpty()) return ""
    val t = v.lowercase().replace(Regex("\\s+"), "")
    return t.replace(Regex("([a-zµ]+)")) { m -> UNIT[m.value] ?: m.value }
}

fun normalizeUnit(v: String?): String {
    if (v.isNullOrEmpty()) return ""
    return v.lowercase().replace(Regex("\\s+"), "").replace("μ", "µ")
        .replace(Regex("^(mgs|milligrams?)$"), "mg")
}

fun normalizeNumber(v: String?): String {
    if (v.isNullOrEmpty()) return ""
    val t = v.replace(",", "").replace("−", "-").trim()
    val n = t.toDoubleOrNull()
    return if (n != null && t.isNotEmpty()) {
        if (n % 1.0 == 0.0 && !t.contains('.') && !t.contains('e', true)) n.toLong().toString() else {
            // JS Number(t) then String(n): 1.0 -> "1", 1.50 -> "1.5"
            if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()
        }
    } else t.lowercase()
}

fun normalizeName(v: String?): String {
    if (v.isNullOrEmpty()) return ""
    return v.lowercase()
        .replace(Regex("^(tab|tablet|cap|capsule|syp|syrup|inj|injection)\\.?\\s+", RegexOption.IGNORE_CASE), "")
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
        .trim()
}

fun normalizeGeneric(v: String?): String = (v ?: "").lowercase().replace(Regex("\\s+"), " ").trim()
