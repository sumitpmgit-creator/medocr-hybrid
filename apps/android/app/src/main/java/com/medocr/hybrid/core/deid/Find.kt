// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core.deid

/**
 * Kotlin mirror of packages/parsing/src/deid/find.ts.
 * Detection runs on a folded view (NFKC + Indic digits); spans are mapped
 * back to the original string before redaction is applied.
 */

fun digitsOnly(s: String): String = s.replace(Regex("\\D"), "")

fun trimSpan(text: String, start: Int, end: Int): Pair<Int, Int>? {
    var a = start
    var b = end
    while (a < b && text[a].isWhitespace()) a += 1
    while (b > a && text[b - 1].isWhitespace()) b -= 1
    if (a >= b) return null
    val value = text.substring(a, b)
    if (value in PLACEHOLDER_VALUES) return null
    return a to b
}

private fun add(out: MutableList<PhiSpan>, type: PhiType, text: String, start: Int, end: Int) {
    val span = trimSpan(text, start, end) ?: return
    out += PhiSpan(type, span.first, span.second)
}

private fun isPlaceholderAt(text: String, index: Int): Boolean {
    for (m in PLACEHOLDER_TOKEN.findAll(text)) {
        if (index >= m.range.first && index < m.range.last + 1) return true
    }
    return false
}

/** Group-2 labelled match: (label)(value). */
private fun labelled(text: String, re: Regex, type: PhiType, out: MutableList<PhiSpan>) {
    for (m in re.findAll(text)) {
        if (isPlaceholderAt(text, m.range.first)) continue
        val label = m.groups[1]?.value ?: ""
        // Kotlin throws on groups[n] when the pattern has no such group (JS would be undefined).
        val value = if (m.groups.size > 2) m.groups[2]?.value else null
        if (value == null) {
            add(out, type, text, m.range.first, m.range.last + 1)
            continue
        }
        val valueStart = m.range.first + label.length
        add(out, type, text, valueStart, valueStart + value.length)
    }
}

fun findAbha(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    labelled(text, Regex("""\b(\d{2}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4})\b"""), PhiType.ABHA_NUMBER, out)
    labelled(
        text,
        Regex("""\b(ABHA(?:\s*(?:No\.?|Number|ID|Id))?\s*[:.#=-]?\s*)(\d{2}(?:[- ]?\d{4}){3}|\d{14})\b""", RegexOption.IGNORE_CASE),
        PhiType.ABHA_NUMBER,
        out,
    )
    labelled(
        text,
        Regex("""\b([A-Za-z0-9._%+-]+@(?:abdm|sbx)(?:\.[A-Za-z]{2,})?)\b""", RegexOption.IGNORE_CASE),
        PhiType.ABHA_ADDRESS,
        out,
    )
    labelled(
        text,
        Regex("""\b((?:ABHA\s*Address|ABHA\s*ID)\s*[:.#=-]?\s*)([A-Za-z0-9._%+-]+@(?:abdm|sbx)(?:\.[A-Za-z]{2,})?)\b""", RegexOption.IGNORE_CASE),
        PhiType.ABHA_ADDRESS,
        out,
    )
    return out
}

fun findAadhaar(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    labelled(text, Regex("""\b(\d{4}[-. ]\d{4}[-. ]\d{4})\b"""), PhiType.AADHAAR, out)
    labelled(text, Regex("""\b(\d{12})\b"""), PhiType.AADHAAR, out)
    labelled(
        text,
        Regex("""\b((?:Aadhaar|Aadhar|UIDAI|UID)\s*(?:No\.?|Number|ID)?\s*[:.#=-]?\s*)(\d{4}(?:[-. ]?\d{4}){2}|\d{12})\b""", RegexOption.IGNORE_CASE),
        PhiType.AADHAAR,
        out,
    )
    return out
}

fun findEmails(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    val re = Regex("""\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b""")
    for (m in re.findAll(text)) {
        if (isPlaceholderAt(text, m.range.first)) continue
        val addr = m.value.lowercase()
        if (Regex("""@(?:abdm|sbx)(?:\.|$)""").containsMatchIn(addr)) continue
        add(out, PhiType.EMAIL, text, m.range.first, m.range.last + 1)
    }
    val obf = Regex(
        """[A-Za-z0-9._%+-]+\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+)\s*[A-Za-z0-9.-]+\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+)\s*[A-Za-z]{2,}""",
        RegexOption.IGNORE_CASE,
    )
    for (m in obf.findAll(text)) {
        add(out, PhiType.EMAIL, text, m.range.first, m.range.last + 1)
    }
    return out
}

private fun isIndianMobile(d: String): Boolean {
    if (d.startsWith("91") && d.length == 12) return Regex("""^91[6-9]\d{9}$""").matches(d)
    if (d.startsWith("091") && d.length == 13) return Regex("""^091[6-9]\d{9}$""").matches(d)
    if (d.startsWith("0") && d.length == 11) return Regex("""^0[6-9]\d{9}$""").matches(d)
    if (d.length == 10) return Regex("""^[6-9]\d{9}$""").matches(d)
    return false
}

private fun isIndianLandline(d: String): Boolean {
    if (isIndianMobile(d)) return false
    return Regex("""^0[1-5]\d{8,9}$""").matches(d) || Regex("""^0(?:11|22|33|44|20|40|80|79)\d{7,8}$""").matches(d)
}

fun findPhones(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    fun notDigitBefore(i: Int) = i <= 0 || !text[i - 1].isDigit()
    fun notDigitAfter(i: Int) = i >= text.length || !text[i].isDigit()
    val patterns = listOf(
        Regex("""(?:\+?91[\s\-.]*)?(?:0[\s\-.]*)?[6-9](?:[\s\-.]*\d){9}"""),
        Regex("""[6-9]\d(?:[\s\-]\d{2}){4}"""),
        Regex("""(?:\+?91[\s\-.]*)?0?(?:11|22|33|44|20|40|80|79)[\s\-.]\d{3,5}[\s\-.]\d{3,5}"""),
        Regex("""\b0\d{2,4}[\s-]\d{3,5}[\s-]?\d{3,5}\b"""),
    )
    for (re in patterns) {
        for (m in re.findAll(text)) {
            if (isPlaceholderAt(text, m.range.first)) continue
            if (!notDigitBefore(m.range.first) || !notDigitAfter(m.range.last + 1)) continue
            val d = digitsOnly(m.value)
            val ok = isIndianMobile(d) ||
                isIndianLandline(d) ||
                (d.startsWith("91") && d.length == 12 && isIndianMobile(d)) ||
                (d.startsWith("0") && (d.length == 10 || d.length == 11))
            if (!ok) continue
            add(out, PhiType.PHONE, text, m.range.first, m.range.last + 1)
        }
    }
    val labelledRe = Regex(
        """(?:(?:ph(?:one)?|tel(?:e(?:phone)?)?|mob(?:ile)?|contact|landline|std|cell|whatsapp|फोन|मोबाइल|दूरभाष|सम्पर्क|ফোন|মোবাইল)\.?\s*(?:no\.?|number|#)?\s*[:.#=-]?\s*)((?:\+?91[\s-]*)?0?\d[\d\s\-.]{7,16}\d)""",
        RegexOption.IGNORE_CASE,
    )
    for (m in labelledRe.findAll(text)) {
        val value = m.groups[1]?.value ?: continue
        val valueStart = m.range.first + m.value.length - value.length
        val d = digitsOnly(value)
        if (isIndianMobile(d) || isIndianLandline(d) || (d.startsWith("0") && d.length in 10..11) || (d.length == 10 && d.firstOrNull() in '6'..'9')) {
            add(out, PhiType.PHONE, text, valueStart, valueStart + value.length)
        }
    }
    return out
}

fun findRegNos(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    labelled(
        text,
        Regex("""\b(Reg(?:istration|n)?\.?\s*(?:No\.?|Number|#)?\s*[:.#=-]?\s*)([A-Z]{0,6}[\/-]?\d{3,10}(?:[\/-]\d{2,8})?)""", RegexOption.IGNORE_CASE),
        PhiType.REG_NO,
        out,
    )
    labelled(
        text,
        Regex("""\b((?:MCI|NMC)\s*[:.#=\/-]?\s*)([A-Z0-9]{3,14})""", RegexOption.IGNORE_CASE),
        PhiType.REG_NO,
        out,
    )
    labelled(
        text,
        Regex("""\b((?:[A-Z]{2,5}MC)\s*[:.#=\/-]?\s*)(\d{3,10}(?:[\/-]\d{2,8})?)"""),
        PhiType.REG_NO,
        out,
    )
    labelled(
        text,
        Regex("""\b(Reg(?:istration|n)?\s*#\s*)([A-Z0-9][A-Z0-9\/-]{3,20})""", RegexOption.IGNORE_CASE),
        PhiType.REG_NO,
        out,
    )
    return out
}

fun findUhids(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    labelled(
        text,
        Regex("""\b((?:UHID|MRN|Patient\s*I[Dd]|PatientID|PID|Hospital\s*number|Hosp(?:ital)?\s*(?:No\.?|ID|ID)|IP\s*No\.?|OP\s*No\.?|CR\s*No\.?)\s*[:.#=-]?\s*)([A-Z0-9][A-Z0-9\/-]{2,24})""", RegexOption.IGNORE_CASE),
        PhiType.UHID,
        out,
    )
    return out
}

private data class LineBounds(val lineStart: Int, val lineEnd: Int, val line: String)

private fun lineBounds(text: String, index: Int): LineBounds {
    // Mirrors JS: text.lastIndexOf("\n", index - 1) + 1
    val from = if (index <= 0) -1 else text.lastIndexOf('\n', index - 1)
    val lineStart = from + 1
    var lineEnd = text.indexOf('\n', startIndex = index)
    if (lineEnd == -1) lineEnd = text.length
    return LineBounds(lineStart, lineEnd, text.substring(lineStart, lineEnd))
}

private fun extendAddressEnd(text: String, end: Int): Int {
    var cursor = end
    var extra = 0
    while (extra < 3) {
        if (cursor >= text.length || text[cursor] != '\n') break
        val nextStart = cursor + 1
        var nextEnd = text.indexOf('\n', startIndex = nextStart)
        if (nextEnd == -1) nextEnd = text.length
        val next = text.substring(nextStart, nextEnd).trim()
        if (next.isEmpty()) break
        if (NEW_SECTION_LABEL.containsMatchIn(next) || LINE_START_CLINICAL.containsMatchIn(next)) break
        if (Regex("""^(?:PIN\s*Code|Pin\s*Code|Pincode|PIN|पिन(?:\s*कोड)?|পিন(?:\s*কোড)?)\b""", RegexOption.IGNORE_CASE).containsMatchIn(next)) break
        val hasPin = Regex("""(?:\bpin(?:\s*code)?|pincode)\b|\b[1-9]\d{5}\b""", RegexOption.IGNORE_CASE).containsMatchIn(next)
        val hasKw = ADDRESS_KEYWORDS.containsMatchIn(next) || lineHasCityPin(next)
        if (!hasPin && !hasKw) break
        cursor = nextEnd
        extra += 1
    }
    return cursor
}

private fun lineHasCityPin(line: String): Boolean {
    val re = Regex("""([A-Za-z][A-Za-z. ]{2,40}?)(?:\s*[,:-]\s*|\s+)([1-9]\d{2}\s?\d{3})\b""")
    for (m in re.findAll(line)) {
        val city = (m.groups[1]?.value ?: "").trim().lowercase().replace(Regex("""\s+"""), " ")
        val idx = m.range.first
        val before = if (idx > 0) line[idx - 1].toString() else ""
        if (before.isNotEmpty() && before[0].isDigit()) continue
        if (city in CITY_NAMES) return true
        val parts = city.split(" ")
        val last = parts.takeLast(2).joinToString(" ")
        val lastOne = parts.lastOrNull() ?: ""
        if (last in CITY_NAMES || lastOne in CITY_NAMES) return true
    }
    return false
}

fun findAddresses(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    val labelRe = Regex(
        """((?:^|\n)\s*(?:address|addr\.?|residential\s+address|correspondence\s+address|residing\s+at|r\/o|पता|ঠিকানা)\s*[:.#=-]\s*)([^\n]+)""",
        RegexOption.IGNORE_CASE,
    )
    for (m in labelRe.findAll(text)) {
        val label = m.groups[1]?.value ?: continue
        val value = m.groups[2]?.value ?: continue
        val valueStart = m.range.first + label.length
        var valueEnd = valueStart + value.length
        valueEnd = extendAddressEnd(text, valueEnd)
        add(out, PhiType.ADDRESS, text, valueStart, valueEnd)
    }
    labelled(
        text,
        Regex("""\b((?:PIN\s*Code|Pin\s*Code|Pincode|PIN|पिन(?:\s*कोड)?|পিন(?:\s*কোড)?)\s*[:.#=-]?\s*)([1-9]\d{2}\s?\d{3})\b""", RegexOption.IGNORE_CASE),
        PhiType.PIN,
        out,
    )

    var searchFrom = 0
    while (searchFrom < text.length) {
        val (lineStart, lineEnd, line) = lineBounds(text, searchFrom)
        searchFrom = lineEnd + 1
        val trimmed = line.trim()
        if (trimmed.isEmpty()) continue
        if (LINE_START_CLINICAL.containsMatchIn(trimmed) || NEW_SECTION_LABEL.containsMatchIn(trimmed)) continue
        val hasKw = ADDRESS_KEYWORDS.containsMatchIn(trimmed)
        val hasCityPin = lineHasCityPin(trimmed)
        val hasPin = Regex("""\b[1-9]\d{2}\s?\d{3}\b""").containsMatchIn(trimmed)
        if (!(hasCityPin || (hasKw && hasPin))) continue
        val startInLine = firstAddressIndex(line)
        val absStart = lineStart + startInLine
        val absEnd = extendAddressEnd(text, lineEnd)
        add(out, PhiType.ADDRESS, text, absStart, absEnd)
    }
    return out
}

private fun firstAddressIndex(line: String): Int {
    val candidates = mutableListOf<Int>()
    val kw = ADDRESS_KEYWORDS.find(line)
    if (kw != null) candidates += kw.range.first
    val house = Regex("""\b(?:(?:h\.?\s*no\.?|house\s*no\.?|door\s*no\.?|plot\s*no\.?|flat|apt\.?|#)\s*\w+)""", RegexOption.IGNORE_CASE).find(line)
    if (house != null) candidates += house.range.first
    val leadingNum = Regex("""^\s*\d{1,5}\s*[,\/-]""").find(line)
    if (leadingNum != null) {
        val rest = line.substring(leadingNum.range.first)
        val sp = Regex("""\S""").find(rest)
        if (sp != null) candidates += sp.range.first + leadingNum.range.first
    }
    val city = Regex("""\b[A-Za-z]""").find(line)
    if (candidates.isEmpty() && city != null) return city.range.first
    return if (candidates.isNotEmpty()) candidates.min() else 0
}

private val NAME_TOKEN = Regex("""[A-Za-z\u0900-\u097F\u0980-\u09FF][A-Za-z\u0900-\u097F\u0980-\u09FF.'’-]*""")

fun consumeName(text: String, from: Int): Pair<Int, Int>? {
    var i = from
    while (i < text.length && (text[i] == ' ' || text[i] == '\t')) i += 1
    val start = i
    var end = start
    var tokens = 0
    while (i < text.length && tokens < 6) {
        val ch = text[i]
        if (ch == '\n') break
        if (ch == ',' || ch == ';' || ch == '|') break
        if (ch.isDigit()) break
        val slice = text.substring(i)
        val tok = NAME_TOKEN.find(slice)
        if (tok == null || tok.range.first != 0) break
        val word = tok.value
        val lower = word.lowercase().replace(".", "")
        if (lower in NAME_STOP_WORDS || word.lowercase() in NAME_STOP_WORDS) break
        if (Regex("""^\[(?:NAME|ABHA_NUMBER|ABHA_ADDRESS|ABHA|PHONE|ADDRESS|REG_NO|EMAIL|AADHAAR|UHID|ID|PIN|DOB|DATE|PAN|VID)\]$""").matches(word)) break
        if (ORG_SUFFIX.containsMatchIn(" " + word) || ORG_SUFFIX.containsMatchIn("'s " + word) || ORG_SUFFIX.containsMatchIn("\u2019s " + word)) break
        end = i + word.length
        i = end
        tokens += 1
        while (i < text.length && (text[i] == ' ' || text[i] == '\t')) i += 1
    }
    if (tokens == 0 || end <= start) return null
    return trimSpan(text, start, end)
}

fun findNames(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    val labels = listOf(
        Regex("""(?:^|\n)[ \t]*((?:patient(?:'s)?\s+name|patient\s*name|pt\.?\s*name|patient|pt\.?|name)\s*[:.#=-]\s*)""", RegexOption.IGNORE_CASE),
        Regex("""(?:^|\n)[ \t]*((?:doctor(?:'s)?\s+name|physician(?:'s)?\s+name|consultant|prescribed\s+by|referred\s+by|examined\s+by|treating\s+(?:doctor|physician)|doctor|physician)\s*[:.#=-]\s*)""", RegexOption.IGNORE_CASE),
        Regex("""(?:^|\n)[ \t]*((?:नाम|रोगी(?:\s*का)?(?:\s*नाम)?|मरीज(?:\s*का)?(?:\s*नाम)?|डॉक्टर(?:\s*का)?(?:\s*नाम)?|चिकित्सक)\s*[:.#=-]\s*)"""),
        Regex("""(?:^|\n)[ \t]*((?:নাম|রোগীর?\s*নাম|ডাক্তার(?:ের)?\s*নাম)\s*[:.#=-]\s*)"""),
    )
    for (re in labels) {
        for (m in re.findAll(text)) {
            val label = m.groups[1]?.value ?: m.value
            val from = m.range.last + 1
            val name = consumeName(text, from) ?: continue
            val labelText = label.replace(Regex("""\s+"""), " ").trim().lowercase()
            if (
                Regex("""^(name[:.#=\-\s]*)$""").matches(labelText) &&
                CLINICAL_AFTER_NAME.containsMatchIn(text.substring(name.first, lineBounds(text, name.first).lineEnd))
            ) {
                continue
            }
            add(out, PhiType.NAME, text, name.first, name.second)
            val cont = nameContinuation(text, name.second)
            if (cont != null) add(out, PhiType.NAME, text, cont.first, cont.second)
        }
    }

    val titleRe = Regex(
        """(?:^|[^\w\u0900-\u097F\u0980-\u09FF])((?:Dr|Drs|Prof|Mr|Mrs|Ms|Miss|Master|Smt|Shri|Shree|Sri)\.?\s+|डॉ\.?\s+|डॉक्टर\s+|श्रीमती\s+|श्री\s+|ডাঃ\s+|ডঃ\s+|ডাক্তার\s+|শ্রীমতী\s+|শ্রী\s+)""",
    )
    for (m in titleRe.findAll(text)) {
        val prefix = m.groups[1]?.value ?: continue
        val prefixStart = m.range.first + m.value.length - prefix.length
        val from = prefixStart + prefix.length
        val name = consumeName(text, from) ?: continue
        val after = text.substring(name.second)
        if (ORG_SUFFIX.containsMatchIn(after)) continue
        add(out, PhiType.NAME, text, name.first, name.second)
    }

    val relRe = Regex(
        """(?:^|[^\w\u0900-\u097F\u0980-\u09FF])((?:(?:son|daughter|wife|husband|father|mother|care)\s+of|[SDWC]/[Oo]|s/o|d/o|w/o|c/o)\s+(?:late\s+)?)""",
        RegexOption.IGNORE_CASE,
    )
    for (m in relRe.findAll(text)) {
        val cue = m.groups[1]?.value ?: continue
        val from = m.range.last + 1
        val name = consumeName(text, from)
        if (name != null) add(out, PhiType.NAME, text, name.first, name.second)
        val before = consumeNameBackward(text, m.range.first + m.value.length - cue.length)
        if (before != null) add(out, PhiType.NAME, text, before.first, before.second)
    }

    out += findSeedNames(text)
    return out
}

private fun consumeNameBackward(text: String, end: Int): Pair<Int, Int>? {
    var i = end
    while (i > 0 && (text[i - 1] == ' ' || text[i - 1] == '\t')) i -= 1
    val right = i
    var tokens = 0
    while (i > 0 && tokens < 6) {
        val ch = text[i - 1]
        if (ch == '\n' || ch == ',' || ch == ';' || ch == '|') break
        if (ch.isDigit()) break
        var j = i
        while (j > 0 && Regex("""[A-Za-z\u0900-\u097F\u0980-\u09FF.'’-]""").matches(text[j - 1].toString())) j -= 1
        if (j == i) break
        val word = text.substring(j, i)
        val lower = word.lowercase().replace(".", "")
        if (lower in NAME_STOP_WORDS || word.lowercase() in NAME_STOP_WORDS) break
        i = j
        tokens += 1
        while (i > 0 && (text[i - 1] == ' ' || text[i - 1] == '\t')) i -= 1
    }
    if (tokens == 0) return null
    return trimSpan(text, i, right)
}

private fun nameContinuation(text: String, after: Int): Pair<Int, Int>? {
    if (after >= text.length || text[after] != '\n') return null
    val nextStart = after + 1
    val bounds = lineBounds(text, nextStart)
    val trimmed = bounds.line.trim()
    if (trimmed.isEmpty()) return null
    if (LINE_START_CLINICAL.containsMatchIn(trimmed) || NEW_SECTION_LABEL.containsMatchIn(trimmed)) return null
    if (trimmed.any { it.isDigit() }) return null
    val name = consumeName(text, nextStart) ?: return null
    if (text.substring(name.second, bounds.lineEnd).trim().isNotEmpty()) return null
    return name
}

private fun findSeedNames(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    var offset = 0
    for (rawLine in text.split("\n")) {
        val tokenRe = Regex("""[A-Za-z\u0900-\u097F\u0980-\u09FF][A-Za-z\u0900-\u097F\u0980-\u09FF.']*""")
        val tokens = mutableListOf<Triple<Int, Int, String>>()
        for (m in tokenRe.findAll(rawLine)) {
            tokens += Triple(offset + m.range.first, offset + m.range.last + 1, m.value)
        }
        var i = 0
        while (i < tokens.size) {
            val first = tokens[i]
            val second = tokens.getOrNull(i + 1)
            if (second != null && isNameToken(first.third) && isNameToken(second.third)) {
                var j = i + 2
                while (j < tokens.size && j - i < 4) {
                    val tok = tokens[j]
                    if (!isNameToken(tok.third)) break
                    j += 1
                }
                val last = tokens[j - 1]
                add(out, PhiType.NAME, text, first.first, last.second)
                i = j
                continue
            }
            i += 1
        }
        offset += rawLine.length + 1
    }
    return out
}

private const val MONTH =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"

private fun isPlausibleNumericDate(s: String): Boolean {
    val iso = Regex("""^(\d{4})-(\d{2})-(\d{2})$""").matchEntire(s)
    if (iso != null) {
        val y = iso.groupValues[1].toInt()
        val mo = iso.groupValues[2].toInt()
        val d = iso.groupValues[3].toInt()
        return y in 1900..2100 && mo in 1..12 && d in 1..31
    }
    val m = Regex("""^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$""").matchEntire(s) ?: return false
    val a = m.groupValues[1].toInt()
    val b = m.groupValues[2].toInt()
    val yRaw = m.groupValues[3].toInt()
    val year = if (yRaw < 100) (if (yRaw >= 30) 1900 + yRaw else 2000 + yRaw) else yRaw
    if (year !in 1900..2100) return false
    fun monthOk(x: Int) = x in 1..12
    fun dayOk(x: Int) = x in 1..31
    return (dayOk(a) && monthOk(b)) || (monthOk(a) && dayOk(b))
}

fun findDob(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    val label = Regex(
        """(?:\b(?:d\.?\s*o\.?\s*b\.?|date\s*of\s*birth|birth\s*date|born\s+on)|जन्म\s*(?:तिथि|तारीख|दिनांक)?)\s*[:.#=-]?\s*""",
        RegexOption.IGNORE_CASE,
    )
    val dateAfter = Regex(
        """^(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+""" + MONTH + """\s*,?\s*\d{2,4})""",
        RegexOption.IGNORE_CASE,
    )
    for (m in label.findAll(text)) {
        val from = m.range.last + 1
        val slice = text.substring(from)
        val dm = dateAfter.find(slice) ?: continue
        if (dm.range.first != 0) continue
        add(out, PhiType.DOB, text, from, from + dm.value.length)
    }
    return out
}

fun findDates(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    val numeric = Regex("""\b(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b""")
    for (m in numeric.findAll(text)) {
        val value = m.groups[1]?.value ?: continue
        if (!isPlausibleNumericDate(value)) continue
        add(out, PhiType.DATE, text, m.range.first, m.range.last + 1)
    }
    val words = Regex(
        """\b(\d{1,2}(?:st|nd|rd|th)?\s+""" + MONTH + """\s*,?\s*\d{2,4})\b""",
        RegexOption.IGNORE_CASE,
    )
    for (m in words.findAll(text)) {
        add(out, PhiType.DATE, text, m.range.first, m.range.last + 1)
    }
    return out
}

fun findPan(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    val re = Regex("""\b([A-Za-z]{5}\d{4}[A-Za-z])\b""")
    for (m in re.findAll(text)) {
        add(out, PhiType.PAN, text, m.range.first, m.range.last + 1)
    }
    return out
}

fun findVid(text: String): List<PhiSpan> {
    val out = mutableListOf<PhiSpan>()
    labelled(
        text,
        Regex("""\b((?:VID|Virtual\s*ID)\s*[:.#=-]?\s*)(\d{4}(?:[\s-]\d{4}){3}|\d{16})\b""", RegexOption.IGNORE_CASE),
        PhiType.VID,
        out,
    )
    return out
}

private val TYPE_PRIORITY = mapOf(
    PhiType.ABHA_NUMBER to 9,
    PhiType.ABHA_ADDRESS to 9,
    PhiType.AADHAAR to 8,
    PhiType.VID to 8,
    PhiType.PAN to 8,
    PhiType.DOB to 7,
    PhiType.DATE to 7,
    PhiType.EMAIL to 6,
    PhiType.PHONE to 5,
    PhiType.UHID to 4,
    PhiType.REG_NO to 4,
    PhiType.PIN to 3,
    PhiType.ADDRESS to 2,
    PhiType.NAME to 1,
)

fun resolveOverlaps(spans: List<PhiSpan>): List<PhiSpan> {
    val sorted = spans.sortedWith(
        compareBy<PhiSpan> { it.start }
            .thenByDescending { it.end - it.start }
            .thenByDescending { TYPE_PRIORITY[it.type] ?: 0 },
    )
    val out = mutableListOf<PhiSpan>()
    for (s in sorted) {
        if (s.end <= s.start) continue
        val last = out.lastOrNull()
        if (last == null || s.start >= last.end) {
            out += PhiSpan(s.type, s.start, s.end)
            continue
        }
        if (s.start == last.start && (TYPE_PRIORITY[s.type] ?: 0) > (TYPE_PRIORITY[last.type] ?: 0) && s.end >= last.end) {
            out[out.lastIndex] = PhiSpan(s.type, s.start, s.end)
            continue
        }
        if (s.start >= last.start && s.end <= last.end && (TYPE_PRIORITY[s.type] ?: 0) > (TYPE_PRIORITY[last.type] ?: 0)) {
            val headEnd = s.start
            val tailStart = s.end
            val outer = last
            out.removeAt(out.lastIndex)
            if (headEnd - outer.start > 0) out += PhiSpan(outer.type, outer.start, headEnd)
            out += PhiSpan(s.type, s.start, s.end)
            if (outer.end - tailStart > 0) out += PhiSpan(outer.type, tailStart, outer.end)
        }
    }
    return out
        .filter { it.end > it.start }
        .sortedWith(compareBy<PhiSpan> { it.start }.thenByDescending { it.end })
        .fold(mutableListOf()) { acc, s ->
            val prev = acc.lastOrNull()
            if (prev == null || s.start >= prev.end) {
                acc += s
            } else if (s.start >= prev.start && s.end <= prev.end && (TYPE_PRIORITY[s.type] ?: 0) > (TYPE_PRIORITY[prev.type] ?: 0)) {
                val head = PhiSpan(prev.type, prev.start, s.start)
                val tail = PhiSpan(prev.type, s.end, prev.end)
                acc.removeAt(acc.lastIndex)
                if (head.end > head.start) acc += head
                acc += s
                if (tail.end > tail.start) acc += tail
            }
            acc
        }
}

fun findRedactions(text: String): List<PhiSpan> {
    if (text.isEmpty()) return emptyList()
    val folded = preprocess(text)
    val all = buildList {
        addAll(findAbha(folded.view))
        addAll(findAadhaar(folded.view))
        addAll(findVid(folded.view))
        addAll(findPan(folded.view))
        addAll(findEmails(folded.view))
        addAll(findPhones(folded.view))
        addAll(findRegNos(folded.view))
        addAll(findUhids(folded.view))
        addAll(findAddresses(folded.view))
        addAll(findNames(folded.view))
        addAll(findDob(folded.view))
        addAll(findDates(folded.view))
    }
    val mapped = mutableListOf<PhiSpan>()
    for (s in resolveOverlaps(all)) {
        val orig = mapSpanToOrig(s.start, s.end, folded.toOrig, folded.toOrigEnd) ?: continue
        mapped += PhiSpan(s.type, orig.first, orig.second)
    }
    return resolveOverlaps(mapped)
}

fun collapseWhitespace(s: String): String = s.replace(Regex(" +\n"), "\n")

fun applyRedactions(text: String, redactions: List<PhiSpan>): String {
    val out = StringBuilder()
    var i = 0
    for (r in redactions) {
        out.append(text.substring(i, r.start))
        out.append(PLACEHOLDERS[r.type] ?: "")
        if (r.type == PhiType.NAME) {
            val next = if (r.end < text.length) text[r.end] else 0.toChar()
            if (next != 0.toChar() && next != ' ' && next != '\n' && next != '\t') out.append(' ')
        }
        i = r.end
    }
    out.append(text.substring(i))
    return collapseWhitespace(out.toString())
}
