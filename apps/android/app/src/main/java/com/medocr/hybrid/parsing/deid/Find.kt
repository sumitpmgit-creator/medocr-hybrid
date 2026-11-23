// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing.deid

/** Kotlin mirror of packages/parsing/src/deid/find.ts. */

fun digitsOnly(s: String): String = s.replace(Regex("\\D"), "")

fun trimSpan(text: String, start: Int, end: Int): IntRange? {
    var a = start
    var b = end
    while (a < b && text[a].isWhitespace()) a += 1
    while (b > a && text[b - 1].isWhitespace()) b -= 1
    if (a >= b) return null
    val value = text.substring(a, b)
    if (value in PLACEHOLDER_VALUES) return null
    return a until b
}

private fun add(out: MutableList<Redaction>, type: RedactionType, text: String, start: Int, end: Int) {
    val span = trimSpan(text, start, end) ?: return
    out += Redaction(type, span.first, span.last + 1)
}

private fun isPlaceholderAt(text: String, index: Int): Boolean {
    for (m in PLACEHOLDER_TOKEN.findAll(text)) {
        if (index >= m.range.first && index < m.range.first + m.value.length) return true
    }
    return false
}

/** Group-2 labelled match: (label)(value). One-group patterns redact the whole match. */
private fun labelled(text: String, re: Regex, type: RedactionType, out: MutableList<Redaction>) {
    for (m in re.findAll(text)) {
        val index = m.range.first
        if (isPlaceholderAt(text, index)) continue
        val label = m.groupValues.getOrElse(1) { "" }
        val value = if (m.groupValues.size > 2) m.groupValues[2] else null
        if (value == null) {
            add(out, type, text, index, index + m.value.length)
            continue
        }
        val valueStart = index + label.length
        add(out, type, text, valueStart, valueStart + value.length)
    }
}

fun findAbha(text: String): List<Redaction> {
    val out = mutableListOf<Redaction>()
    labelled(text, Regex("\\b(\\d{2}[- ]\\d{4}[- ]\\d{4}[- ]\\d{4})\\b"), RedactionType.ABHA, out)
    labelled(
        text,
        Regex("\\b(ABHA(?:\\s*(?:No\\.?|Number|ID|Id|Address))?\\s*[:.#=-]?\\s*)(\\d{2}(?:[- ]?\\d{4}){3}|\\d{14})\\b", RegexOption.IGNORE_CASE),
        RedactionType.ABHA,
        out,
    )
    labelled(text, Regex("\\b([A-Za-z0-9._%+-]+@(?:abdm|sbx)(?:\\.[A-Za-z]{2,})?)\\b", RegexOption.IGNORE_CASE), RedactionType.ABHA, out)
    labelled(
        text,
        Regex("\\b((?:ABHA\\s*Address|ABHA\\s*ID)\\s*[:.#=-]?\\s*)([A-Za-z0-9._%+-]+@(?:abdm|sbx)(?:\\.[A-Za-z]{2,})?)\\b", RegexOption.IGNORE_CASE),
        RedactionType.ABHA,
        out,
    )
    return out
}

fun findAadhaar(text: String): List<Redaction> {
    val out = mutableListOf<Redaction>()
    labelled(text, Regex("\\b(\\d{4}[- ]\\d{4}[- ]\\d{4})\\b"), RedactionType.AADHAAR, out)
    labelled(
        text,
        Regex("\\b((?:Aadhaar|Aadhar|UIDAI|UID)\\s*(?:No\\.?|Number|ID)?\\s*[:.#=-]?\\s*)(\\d{4}(?:[- ]?\\d{4}){2}|\\d{12})\\b", RegexOption.IGNORE_CASE),
        RedactionType.AADHAAR,
        out,
    )
    return out
}

fun findEmails(text: String): List<Redaction> {
    val out = mutableListOf<Redaction>()
    val re = Regex("\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b")
    for (m in re.findAll(text)) {
        if (isPlaceholderAt(text, m.range.first)) continue
        val addr = m.value.lowercase()
        if (Regex("@(?:abdm|sbx)(?:\\.|$)").containsMatchIn(addr)) continue
        add(out, RedactionType.EMAIL, text, m.range.first, m.range.first + m.value.length)
    }
    return out
}

fun isIndianMobile(d: String): Boolean = when {
    d.startsWith("91") && d.length == 12 -> Regex("^91[6-9]\\d{9}$").matches(d)
    d.startsWith("091") && d.length == 13 -> Regex("^091[6-9]\\d{9}$").matches(d)
    d.startsWith("0") && d.length == 11 -> Regex("^0[6-9]\\d{9}$").matches(d)
    d.length == 10 -> Regex("^[6-9]\\d{9}$").matches(d)
    else -> false
}

fun isIndianLandline(d: String): Boolean {
    if (isIndianMobile(d)) return false
    return Regex("^0[1-5]\\d{8,9}$").matches(d) || Regex("^0(?:11|22|33|44|20|40|80|79)\\d{7,8}$").matches(d)
}

fun findPhones(text: String): List<Redaction> {
    val out = mutableListOf<Redaction>()
    val mobileRe = Regex("(?:(?:\\+|00)91[\\s-]*)?(?:0[\\s-]*)?[6-9](?:[\\s-]?\\d){9}\\b")
    for (m in mobileRe.findAll(text)) {
        if (isPlaceholderAt(text, m.range.first)) continue
        if (!isIndianMobile(digitsOnly(m.value))) continue
        add(out, RedactionType.PHONE, text, m.range.first, m.range.first + m.value.length)
    }
    val landlineRe = Regex("\\b0\\d{2,4}[\\s-]\\d{3,5}[\\s-]?\\d{3,5}\\b|\\b(?:011|022|033|044|020|040|080|079)[\\s-]?\\d{7,8}\\b")
    for (m in landlineRe.findAll(text)) {
        if (isPlaceholderAt(text, m.range.first)) continue
        val d = digitsOnly(m.value)
        if (!(isIndianLandline(d) || (d.startsWith("0") && d.length in 10..11 && !isIndianMobile(d)))) continue
        add(out, RedactionType.PHONE, text, m.range.first, m.range.first + m.value.length)
    }
    val labelledRe = Regex(
        "(?:(?:ph(?:one)?|tel(?:e(?:phone)?)?|mob(?:ile)?|contact|landline|std|cell|whatsapp|फोन|मोबाइल|दूरभाष|सम्पर्क|ফোন|মোবাইল)\\.?\\s*(?:no\\.?|number|#)?\\s*[:.#=-]\\s*)((?:\\+?91[\\s-]*)?0?\\d[\\d\\s-]{7,16}\\d)",
        RegexOption.IGNORE_CASE,
    )
    for (m in labelledRe.findAll(text)) {
        val v = m.groupValues.getOrNull(1) ?: continue
        val valueStart = m.range.first + m.value.length - v.length
        val d = digitsOnly(v)
        if (isIndianMobile(d) || isIndianLandline(d) || (d.startsWith("0") && d.length in 10..11)) {
            add(out, RedactionType.PHONE, text, valueStart, valueStart + v.length)
        }
    }
    return out
}

fun findRegNos(text: String): List<Redaction> {
    val out = mutableListOf<Redaction>()
    labelled(text, Regex("\\b(Reg(?:istration|n)?\\.?\\s*(?:No\\.?|Number|#)?\\s*[:.#=-]?\\s*)([A-Z]{0,6}[/\\-]?\\d{3,10}(?:[/\\-]\\d{2,8})?)", RegexOption.IGNORE_CASE), RedactionType.REG_NO, out)
    labelled(text, Regex("\\b((?:MCI|NMC)\\s*[:.#=/\\-]?\\s*)([A-Z0-9]{3,14})", RegexOption.IGNORE_CASE), RedactionType.REG_NO, out)
    labelled(text, Regex("\\b((?:[A-Z]{2,5}MC)\\s*[:.#=/\\-]?\\s*)(\\d{3,10}(?:[/\\-]\\d{2,8})?)"), RedactionType.REG_NO, out)
    return out
}

fun findUhids(text: String): List<Redaction> {
    val out = mutableListOf<Redaction>()
    labelled(
        text,
        Regex("\\b((?:UHID|MRN|Patient\\s*ID|Hosp(?:ital)?\\s*ID|IP\\s*No\\.?|OP\\s*No\\.?|CR\\s*No\\.?)\\s*[:.#=-]?\\s*)([A-Z0-9][A-Z0-9/\\-]{2,20})", RegexOption.IGNORE_CASE),
        RedactionType.UHID,
        out,
    )
    return out
}

internal data class LineBounds(val lineStart: Int, val lineEnd: Int, val line: String)

internal fun lineBounds(text: String, index: Int): LineBounds {
    val from = if (index <= 0) -1 else text.lastIndexOf('\n', index - 1)
    val lineStart = from + 1
    val nl = text.indexOf('\n', index)
    val lineEnd = if (nl == -1) text.length else nl
    return LineBounds(lineStart, lineEnd, text.substring(lineStart, lineEnd))
}

private fun extendAddressEnd(text: String, end: Int): Int {
    var cursor = end
    var extra = 0
    while (extra < 3) {
        if (cursor >= text.length || text[cursor] != '\n') break
        val nextStart = cursor + 1
        val nl = text.indexOf('\n', nextStart)
        val nextEnd = if (nl == -1) text.length else nl
        val next = text.substring(nextStart, nextEnd).trim()
        if (next.isEmpty()) break
        if (NEW_SECTION_LABEL.containsMatchIn(next) || LINE_START_CLINICAL.containsMatchIn(next)) break
        val hasPin = Regex("(?:\\bpin(?:\\s*code)?|pincode)\\b|\\b[1-9]\\d{5}\\b", RegexOption.IGNORE_CASE).containsMatchIn(next)
        val hasKw = ADDRESS_KEYWORDS.containsMatchIn(next) || lineHasCityPin(next)
        if (!hasPin && !hasKw) break
        cursor = nextEnd
        extra += 1
    }
    return cursor
}

private fun lineHasCityPin(line: String): Boolean {
    val re = Regex("([A-Za-z][A-Za-z. ]{2,40}?)(?:\\s*[,:-]\\s*|\\s+)([1-9]\\d{5})\\b")
    for (m in re.findAll(line)) {
        val city = (m.groupValues.getOrNull(1) ?: "").trim().lowercase().replace(Regex("\\s+"), " ")
        val idx = m.range.first
        val before = if (idx > 0) line[idx - 1] else ' '
        if (before.isDigit()) continue
        if (city in CITY_NAMES) return true
        val parts = city.split(" ")
        val last = parts.takeLast(2).joinToString(" ")
        val lastOne = parts.lastOrNull() ?: ""
        if (last in CITY_NAMES || lastOne in CITY_NAMES) return true
    }
    return false
}

fun findAddresses(text: String): List<Redaction> {
    val out = mutableListOf<Redaction>()
    val labelRe = Regex("((?:^|\\n)\\s*(?:address|addr\\.?|residential\\s+address|correspondence\\s+address|residing\\s+at|r/o|पता|ঠিকানা)\\s*[:.#=-]\\s*)([^\\n]+)", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE))
    for (m in labelRe.findAll(text)) {
        val g1 = m.groupValues.getOrNull(1) ?: continue
        val g2 = m.groupValues.getOrNull(2) ?: continue
        val valueStart = m.range.first + g1.length
        var valueEnd = valueStart + g2.length
        valueEnd = extendAddressEnd(text, valueEnd)
        add(out, RedactionType.ADDRESS, text, valueStart, valueEnd)
    }
    labelled(
        text,
        Regex("\\b((?:PIN\\s*Code|Pin\\s*Code|Pincode|PIN|पिन(?:\\s*कोड)?|পিন(?:\\s*কোড)?)\\s*[:.#=-]?\\s*)([1-9]\\d{2}\\s?\\d{3})\\b", RegexOption.IGNORE_CASE),
        RedactionType.ADDRESS,
        out,
    )
    var searchFrom = 0
    while (searchFrom < text.length) {
        val b = lineBounds(text, searchFrom)
        searchFrom = b.lineEnd + 1
        val trimmed = b.line.trim()
        if (trimmed.isEmpty()) continue
        if (LINE_START_CLINICAL.containsMatchIn(trimmed) || NEW_SECTION_LABEL.containsMatchIn(trimmed)) continue
        val hasKw = ADDRESS_KEYWORDS.containsMatchIn(trimmed)
        val hasCityPin = lineHasCityPin(trimmed)
        val hasPin = Regex("\\b[1-9]\\d{5}\\b").containsMatchIn(trimmed)
        if (!(hasCityPin || (hasKw && hasPin))) continue
        val startInLine = firstAddressIndex(b.line)
        val absStart = b.lineStart + startInLine
        val absEnd = extendAddressEnd(text, b.lineEnd)
        add(out, RedactionType.ADDRESS, text, absStart, absEnd)
    }
    return out
}

private fun firstAddressIndex(line: String): Int {
    val candidates = mutableListOf<Int>()
    val kw = ADDRESS_KEYWORDS.find(line)?.range?.first ?: -1
    if (kw >= 0) candidates += kw
    val house = Regex("\\b(?:(?:h\\.?\\s*no\\.?|house\\s*no\\.?|door\\s*no\\.?|plot\\s*no\\.?|flat|apt\\.?|#)\\s*\\w+)", RegexOption.IGNORE_CASE).find(line)?.range?.first ?: -1
    if (house >= 0) candidates += house
    val leading = Regex("^\\s*\\d{1,5}\\s*[,/-]").find(line)
    if (leading != null) {
        val leadingNum = leading.range.first
        val rel = line.substring(leadingNum).indexOfFirst { !it.isWhitespace() }
        candidates += rel + leadingNum
    }
    val city = Regex("\\b[A-Za-z]").find(line)?.range?.first ?: -1
    if (candidates.isEmpty() && city >= 0) return city
    return if (candidates.isNotEmpty()) candidates.min() else 0
}

private val NAME_TOKEN = Regex("[A-Za-z\\u0900-\\u097F\\u0980-\\u09FF][A-Za-z\\u0900-\\u097F\\u0980-\\u09FF.'’-]*")

fun consumeName(text: String, from: Int): IntRange? {
    var i = from
    while (i < text.length && (text[i] == ' ' || text[i] == '\t')) i += 1
    val start = i
    var end = start
    var tokens = 0
    while (i < text.length && tokens < 6) {
        val ch = text[i]
        if (ch == '\n' || ch == ',' || ch == ';' || ch == '|') break
        if (ch.isDigit()) break
        val slice = text.substring(i)
        val tok = NAME_TOKEN.find(slice)
        if (tok == null || tok.range.first != 0) break
        val word = tok.value
        val lower = word.lowercase().replace(".", "")
        if (lower in NAME_STOP_WORDS || word.lowercase() in NAME_STOP_WORDS) break
        if (Regex("^\\[(?:NAME|ABHA|PHONE|ADDRESS|REG_NO|EMAIL|AADHAAR|UHID)\\]$").matches(word)) break
        end = i + word.length
        i = end
        tokens += 1
        while (i < text.length && (text[i] == ' ' || text[i] == '\t')) i += 1
    }
    if (tokens == 0 || end <= start) return null
    return trimSpan(text, start, end)?.let { it.first until (it.last + 1) }
}

fun findNames(text: String): List<Redaction> {
    val out = mutableListOf<Redaction>()
    val labels = listOf(
        Regex("(?:^|\\n)[ \\t]*((?:patient(?:'s)?\\s+name|patient\\s*name|pt\\.?\\s*name|patient|pt\\.?|name)\\s*[:.#=-]\\s*)", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)),
        Regex("(?:^|\\n)[ \\t]*((?:doctor(?:'s)?\\s+name|physician(?:'s)?\\s+name|consultant|prescribed\\s+by|referred\\s+by|examined\\s+by|treating\\s+(?:doctor|physician)|doctor|physician)\\s*[:.#=-]\\s*)", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)),
        Regex("(?:^|\\n)[ \\t]*((?:नाम|रोगी(?:\\s*का)?\\s*नाम|मरीज(?:\\s*का)?\\s*नाम|डॉक्टर(?:\\s*का)?\\s*नाम|चिकित्सक)\\s*[:.#=-]\\s*)"),
        Regex("(?:^|\\n)[ \\t]*((?:নাম|রোগীর?\\s*নাম|ডাক্তার(?:ের)?\\s*নাম)\\s*[:.#=-]\\s*)"),
    )
    for (re in labels) {
        for (m in re.findAll(text)) {
            val label = m.groupValues.getOrElse(1) { m.value }
            val from = m.range.first + m.value.length
            val name = consumeName(text, from) ?: continue
            val labelText = label.replace(Regex("\\s+"), " ").trim().lowercase()
            if (Regex("^name[:.#=\\-\\s]*$").matches(labelText) &&
                CLINICAL_AFTER_NAME.containsMatchIn(text.substring(name.first, lineBounds(text, name.first).lineEnd))
            ) continue
            add(out, RedactionType.NAME, text, name.first, name.last + 1)
        }
    }
    val titleRe = Regex("(?:^|[^\\w\\u0900-\\u097F\\u0980-\\u09FF])((?:Dr|Drs|Prof|Mr|Mrs|Ms|Miss|Master|Smt|Shri|Shree|Sri)\\.?\\s+|डॉ\\.?\\s+|डॉक्टर\\s+|श्रीमती\\s+|श्री\\s+|ডাঃ\\s+|ডঃ\\s+|ডাক্তার\\s+|শ্রীমতী\\s+|শ্রী\\s+)")
    for (m in titleRe.findAll(text)) {
        val g1 = m.groupValues.getOrNull(1) ?: continue
        val prefixStart = m.range.first + m.value.length - g1.length
        val from = prefixStart + g1.length
        val name = consumeName(text, from) ?: continue
        val after = text.substring(name.last + 1)
        if (ORG_SUFFIX.containsMatchIn(after)) continue
        add(out, RedactionType.NAME, text, name.first, name.last + 1)
    }
    val relRe = Regex("(?:^|[^\\w])((?:[SDWC]/[Oo]|s/o|d/o|w/o|c/o)\\s*)")
    for (m in relRe.findAll(text)) {
        val from = m.range.first + m.value.length
        val name = consumeName(text, from) ?: continue
        add(out, RedactionType.NAME, text, name.first, name.last + 1)
    }
    return out
}

private val TYPE_PRIORITY = mapOf(
    RedactionType.ABHA to 8,
    RedactionType.AADHAAR to 7,
    RedactionType.EMAIL to 6,
    RedactionType.PHONE to 5,
    RedactionType.UHID to 4,
    RedactionType.REG_NO to 4,
    RedactionType.ADDRESS to 2,
    RedactionType.NAME to 1,
)

fun resolveOverlaps(spans: List<Redaction>): List<Redaction> {
    val sorted = spans.sortedWith(
        compareBy<Redaction> { it.start }
            .thenByDescending { it.end - it.start }
            .thenByDescending { TYPE_PRIORITY[it.type] ?: 0 },
    )
    val out = mutableListOf<Redaction>()
    for (s in sorted) {
        if (s.end <= s.start) continue
        val last = out.lastOrNull()
        if (last == null || s.start >= last.end) {
            out += Redaction(s.type, s.start, s.end)
            continue
        }
        if (s.start == last.start && (TYPE_PRIORITY[s.type] ?: 0) > (TYPE_PRIORITY[last.type] ?: 0) && s.end >= last.end) {
            out[out.lastIndex] = Redaction(s.type, s.start, s.end)
        }
    }
    return out
}

fun findRedactions(text: String): List<Redaction> {
    if (text.isEmpty()) return emptyList()
    val all = findAbha(text) + findAadhaar(text) + findEmails(text) + findPhones(text) +
        findRegNos(text) + findUhids(text) + findAddresses(text) + findNames(text)
    return resolveOverlaps(all)
}

fun applyRedactions(text: String, redactions: List<Redaction>): String {
    val out = StringBuilder()
    var i = 0
    for (r in redactions) {
        out.append(text.substring(i, r.start))
        out.append(PLACEHOLDERS.getValue(r.type))
        i = r.end
    }
    out.append(text.substring(i))
    return out.toString()
}
