// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

import java.text.Normalizer

/**
 * Kotlin mirror of packages/core/src/text-metrics.ts.
 * Benchmark A: CER / WER = (S + D + I) / N_reference. Can exceed 1.0.
 */

data class TextNormalizeOptions(
    /** Unicode NFC (default true) */
    val nfc: Boolean = true,
    /** Collapse all whitespace runs to one space and trim (default true) */
    val collapseWhitespace: Boolean = true,
    val lowercase: Boolean = false,
    val stripPunctuation: Boolean = false,
)

data class EditCounts(
    val substitutions: Int,
    val deletions: Int,
    val insertions: Int,
    val hits: Int,
    val refLength: Int,
)

data class ErrorRate(
    val substitutions: Int,
    val deletions: Int,
    val insertions: Int,
    val hits: Int,
    val refLength: Int,
    val rate: Double,
)

fun normalizeText(s: String, o: TextNormalizeOptions = TextNormalizeOptions()): String {
    var t = s
    if (o.nfc) t = Normalizer.normalize(t, Normalizer.Form.NFC)
    if (o.lowercase) t = t.lowercase()
    if (o.stripPunctuation) t = t.replace(Regex("\\p{P}"), "")
    if (o.collapseWhitespace) t = t.replace(Regex("\\s+"), " ").trim()
    return t
}

/** Code points, matching JS Array.from so Devanagari/Gujarati combining marks count per code point. */
fun codePoints(s: String): List<Int> {
    val out = ArrayList<Int>(s.length)
    var i = 0
    while (i < s.length) {
        val cp = s.codePointAt(i)
        out.add(cp)
        i += Character.charCount(cp)
    }
    return out
}

/** Levenshtein alignment over arbitrary token lists, returning S/D/I counts. */
fun <T> editCounts(ref: List<T>, hyp: List<T>): EditCounts {
    val n = ref.size
    val m = hyp.size
    // Each cell: [cost, S, D, I]
    var prev = Array(m + 1) { j -> intArrayOf(j, 0, 0, j) }
    for (i in 1..n) {
        val cur = Array(m + 1) { intArrayOf(0, 0, 0, 0) }
        cur[0] = intArrayOf(i, 0, i, 0)
        for (j in 1..m) {
            val same = ref[i - 1] == hyp[j - 1]
            val diag = prev[j - 1]
            val up = prev[j]
            val left = cur[j - 1]
            val cSub = diag[0] + if (same) 0 else 1
            val cDel = up[0] + 1
            val cIns = left[0] + 1
            cur[j] = when {
                cSub <= cDel && cSub <= cIns ->
                    intArrayOf(cSub, diag[1] + if (same) 0 else 1, diag[2], diag[3])
                cDel <= cIns ->
                    intArrayOf(cDel, up[1], up[2] + 1, up[3])
                else ->
                    intArrayOf(cIns, left[1], left[2], left[3] + 1)
            }
        }
        prev = cur
    }
    val last = prev[m]
    val s = last[1]
    val d = last[2]
    val ins = last[3]
    return EditCounts(substitutions = s, deletions = d, insertions = ins, hits = n - s - d, refLength = n)
}

private fun rate(c: EditCounts): ErrorRate {
    val errs = c.substitutions + c.deletions + c.insertions
    val r = if (c.refLength == 0) {
        if (errs == 0) 0.0 else 1.0
    } else {
        errs.toDouble() / c.refLength
    }
    return ErrorRate(c.substitutions, c.deletions, c.insertions, c.hits, c.refLength, r)
}

fun cer(reference: String, hypothesis: String, o: TextNormalizeOptions = TextNormalizeOptions()): ErrorRate =
    rate(editCounts(codePoints(normalizeText(reference, o)), codePoints(normalizeText(hypothesis, o))))

fun tokenizeWords(s: String): List<String> = s.split(Regex("\\s+")).filter { it.isNotEmpty() }

fun wer(reference: String, hypothesis: String, o: TextNormalizeOptions = TextNormalizeOptions()): ErrorRate =
    rate(editCounts(tokenizeWords(normalizeText(reference, o)), tokenizeWords(normalizeText(hypothesis, o))))

data class OmissionInvention(val omissionRate: Double, val inventionRate: Double)

fun omissionInvention(
    reference: String,
    hypothesis: String,
    o: TextNormalizeOptions = TextNormalizeOptions(lowercase = true, stripPunctuation = true),
): OmissionInvention {
    val r = tokenizeWords(normalizeText(reference, o))
    val h = tokenizeWords(normalizeText(hypothesis, o))
    val hs = mutableMapOf<String, Int>()
    for (w in h) hs[w] = (hs[w] ?: 0) + 1
    val rs = mutableMapOf<String, Int>()
    for (w in r) rs[w] = (rs[w] ?: 0) + 1
    var omitted = 0
    for ((w, c) in rs) omitted += maxOf(0, c - (hs[w] ?: 0))
    var invented = 0
    for ((w, c) in hs) invented += maxOf(0, c - (rs[w] ?: 0))
    return OmissionInvention(
        omissionRate = if (r.isNotEmpty()) omitted.toDouble() / r.size else 0.0,
        inventionRate = if (h.isNotEmpty()) invented.toDouble() / h.size else 0.0,
    )
}

fun numericAccuracy(reference: String, hypothesis: String): Double {
    val numRe = Regex("[-−]?\\d+(?:[.,]\\d+)?")
    fun nums(s: String) = numRe.findAll(s).map { it.value }.toMutableList()
    val r = nums(reference)
    if (r.isEmpty()) return 1.0
    val pool = nums(hypothesis)
    var hit = 0
    for (n in r) {
        val k = pool.indexOf(n)
        if (k >= 0) {
            hit++
            pool.removeAt(k)
        }
    }
    return hit.toDouble() / r.size
}

/** Similarity 0..1 based on CER (1 - min(1, CER)). Used for fuzzy matching of names. */
fun similarity(a: String, b: String): Double {
    if (a.isEmpty() && b.isEmpty()) return 1.0
    return 1.0 - minOf(1.0, cer(a, b, TextNormalizeOptions(lowercase = true)).rate)
}

/** Does `needle` appear (fuzzily) in `haystack`? Sliding window over words. */
fun fuzzyContains(haystack: String, needle: String, minSim: Double = 0.85): Boolean {
    val h = normalizeText(haystack, TextNormalizeOptions(lowercase = true))
    val n = normalizeText(needle, TextNormalizeOptions(lowercase = true))
    if (n.isEmpty()) return true
    if (h.contains(n)) return true
    val hw = tokenizeWords(h)
    val nw = tokenizeWords(n).size
    val kStart = maxOf(1, nw - 1)
    val kEnd = nw + 1
    for (k in kStart..kEnd) {
        var i = 0
        while (i + k <= hw.size) {
            if (similarity(hw.subList(i, i + k).joinToString(" "), n) >= minSim) return true
            i++
        }
    }
    return false
}
