// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core.deid

import java.text.Normalizer

/**
 * Kotlin mirror of packages/parsing/src/deid/normalize.ts.
 * Detection-time folding. Offsets are mapped back to the original string
 * before redaction is applied, so full-width / Devanagari digits and
 * letter-spaced OCR still replace the right original characters.
 */

data class FoldedView(
    val view: String,
    /** view[i] came from original[toOrig[i] .. toOrigEnd[i]). */
    val toOrig: IntArray,
    val toOrigEnd: IntArray,
)

/** NFKC + Devanagari/Bengali digits to ASCII. */
fun foldChar(ch: String): String {
    if (ch.isEmpty()) return ch
    val cp = ch.codePointAt(0)
    if (cp in 0x0966..0x096F) return (cp - 0x0966).toString()
    if (cp in 0x09E6..0x09EF) return (cp - 0x09E6).toString()
    return Normalizer.normalize(ch, Normalizer.Form.NFKC)
}

/** Spaces between single Latin letters in a run of 3+ letters (OCR "M O H D"). */
fun skippableLetterSpaces(text: String): Set<Int> {
    val skip = mutableSetOf<Int>()
    val re = Regex("""(?:^|[^A-Za-z])((?:[A-Za-z][ \t]+){2,}[A-Za-z])""")
    for (m in re.findAll(text)) {
        val run = m.groups[1]?.value ?: continue
        val runStart = m.range.first + m.value.length - run.length
        for (i in run.indices) {
            if (run[i] == ' ' || run[i] == '\t') skip.add(runStart + i)
        }
    }
    return skip
}

fun preprocess(text: String): FoldedView {
    val skip = skippableLetterSpaces(text)
    val view = StringBuilder()
    val toOrig = ArrayList<Int>()
    val toOrigEnd = ArrayList<Int>()
    var i = 0
    while (i < text.length) {
        if (i in skip) {
            i += 1
            continue
        }
        val cp = text.codePointAt(i)
        val len = Character.charCount(cp)
        val out = foldChar(text.substring(i, i + len))
        for (j in out.indices) {
            view.append(out[j])
            toOrig.add(i)
            toOrigEnd.add(i + len)
        }
        i += len
    }
    return FoldedView(view.toString(), toOrig.toIntArray(), toOrigEnd.toIntArray())
}

fun mapSpanToOrig(
    start: Int,
    end: Int,
    toOrig: IntArray,
    toOrigEnd: IntArray,
): Pair<Int, Int>? {
    if (end <= start) return null
    if (start !in toOrig.indices || end - 1 !in toOrigEnd.indices) return null
    val s = toOrig[start]
    val e = toOrigEnd[end - 1]
    if (e <= s) return null
    return s to e
}
