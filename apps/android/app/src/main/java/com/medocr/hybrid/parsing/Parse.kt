// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Kotlin mirror of packages/parsing/src/extraction/parse.ts.
 * Tolerates markdown fences, leading chatter, and trailing text.
 */

enum class ParseErrorCode {
    EMPTY_INPUT, NOT_JSON, PARSE_ERROR, TYPE_ERROR, MISSING_FIELD, INVALID_ENUM, OUT_OF_RANGE
}

data class ParseIssue(val path: String, val code: ParseErrorCode, val message: String)

sealed class ParseResult {
    data class Ok(val value: NanoExtraction, val stripped: List<String>) : ParseResult()
    data class Err(val errors: List<ParseIssue>) : ParseResult()
}

private val DOC_TYPE_ALIASES = mapOf(
    "prescription" to "prescription",
    "lab_report" to "lab_report",
    "lab report" to "lab_report",
    "laboratory" to "lab_report",
    "laboratory report" to "lab_report",
    "lab-report" to "lab_report",
    "other" to "other",
    "discharge_summary" to "other",
    "discharge summary" to "other",
)

private fun issue(path: String, code: ParseErrorCode, message: String) = ParseIssue(path, code, message)

sealed class ExtractedJson {
    data class Text(val text: String) : ExtractedJson()
    data class Errors(val errors: List<ParseIssue>) : ExtractedJson()
}

/** Pull a JSON object out of model text: fences, leading chatter, trailing text. */
fun extractJsonText(raw: String): ExtractedJson {
    val trimmed = raw.replace("\uFEFF", "").trim()
    if (trimmed.isEmpty()) return ExtractedJson.Errors(listOf(issue("", ParseErrorCode.EMPTY_INPUT, "Output is empty")))
    val fenced = Regex("```(?:json)?\\s*([\\s\\S]*?)```", RegexOption.IGNORE_CASE).find(trimmed)
    val candidate = (fenced?.groupValues?.get(1) ?: unclosedFence(trimmed) ?: trimmed).trim()
    val start = candidate.indexOf('{')
    if (start < 0) return ExtractedJson.Errors(listOf(issue("", ParseErrorCode.NOT_JSON, "No JSON object found in the model output")))
    val sliced = sliceBalancedObject(candidate, start)
        ?: return ExtractedJson.Errors(listOf(issue("", ParseErrorCode.NOT_JSON, "JSON object is truncated or unbalanced")))
    return ExtractedJson.Text(sliced)
}

private fun unclosedFence(text: String): String? {
    val m = Regex("^```(?:json)?\\s*([\\s\\S]*)$", RegexOption.IGNORE_CASE).find(text) ?: return null
    val first = text.indexOf("```")
    if (text.indexOf("```", first + 3) >= 0) return null
    return m.groupValues[1]
}

private fun sliceBalancedObject(source: String, start: Int): String? {
    var depth = 0
    var inString = false
    var escape = false
    for (i in start until source.length) {
        val ch = source[i]
        if (inString) {
            when {
                escape -> escape = false
                ch == '\\' -> escape = true
                ch == '"' -> inString = false
            }
            continue
        }
        when (ch) {
            '"' -> inString = true
            '{' -> depth += 1
            '}' -> {
                depth -= 1
                if (depth == 0) return source.substring(start, i + 1)
            }
        }
    }
    return null
}

private fun typeName(value: JsonElement?): String = when (value) {
    null -> "undefined"
    is JsonNull -> "null"
    is JsonArray -> "array"
    is JsonObject -> "object"
    is JsonPrimitive -> if (value.isString) "string" else "number"
}

private fun asNullableString(value: JsonElement?, path: String, errors: MutableList<ParseIssue>): String? {
    if (value == null) return UNSET // missing key already reported by requireKey
    if (value is JsonNull) return null
    val p = value as? JsonPrimitive
    return if (p != null && p.isString) p.content else {
        errors.add(issue(path, ParseErrorCode.TYPE_ERROR, "Expected string or null, got ${typeName(value)}"))
        UNSET
    }
}

/** Sentinel for "failed to parse" nullable string (as opposed to JSON null). */
private const val UNSET = "\u0000__unset__"

private fun String?.isUnset(): Boolean = this == UNSET

private fun asConfidence(value: JsonElement?, path: String, errors: MutableList<ParseIssue>): Double? {
    val n = when {
        value is JsonPrimitive && !value.isString -> value.doubleOrNull
        value is JsonPrimitive && value.isString && value.content.trim().isNotEmpty() ->
            value.content.toDoubleOrNull()
        else -> {
            errors.add(issue(path, ParseErrorCode.TYPE_ERROR, "Expected a number 0-1, got ${typeName(value)}"))
            return null
        }
    }
    if (n == null || n.isNaN() || n.isInfinite() || n < 0.0 || n > 1.0) {
        errors.add(issue(path, ParseErrorCode.OUT_OF_RANGE, "Confidence must be between 0 and 1 inclusive, got $n"))
        return null
    }
    return n
}

private fun requireKey(obj: JsonObject, key: String, path: String, errors: MutableList<ParseIssue>): JsonElement? {
    if (!obj.containsKey(key)) {
        errors.add(issue(path, ParseErrorCode.MISSING_FIELD, "Missing required field \"$key\""))
        return null
    }
    return obj[key]
}

private fun parseDocumentType(value: JsonElement?, path: String, errors: MutableList<ParseIssue>): String? {
    val p = value as? JsonPrimitive
    if (p == null || !p.isString) {
        errors.add(issue(path, ParseErrorCode.TYPE_ERROR, "Expected a documentType string, got ${typeName(value)}"))
        return null
    }
    val key = p.content.trim().lowercase().replace(Regex("[_-]+"), " ").replace(Regex("\\s+"), " ")
    val aliased = DOC_TYPE_ALIASES[key] ?: DOC_TYPE_ALIASES[key.replace(" ", "_")]
    if (aliased == null) {
        errors.add(
            issue(
                path,
                ParseErrorCode.INVALID_ENUM,
                "documentType must be one of ${NANO_DOCUMENT_TYPES.joinToString(", ")} (got ${p.content})",
            ),
        )
        return null
    }
    return aliased
}

private fun collectStripped(obj: JsonObject, allowed: Set<String>, path: String, stripped: MutableList<String>) {
    for (key in obj.keys) {
        if (key !in allowed) stripped += if (path.isEmpty()) key else "$path.$key"
    }
}

private val ROOT_KEYS = setOf("documentType", "documentTypeConfidence", "rawText", "medications", "labResults")
private val MEDICATION_KEYS = setOf(
    "name", "nameConfidence", "dose", "doseConfidence",
    "frequency", "frequencyConfidence", "duration", "durationConfidence",
)
private val LAB_KEYS = setOf(
    "test", "testConfidence", "value", "valueConfidence",
    "unit", "unitConfidence", "referenceRange", "referenceRangeConfidence",
)

private fun parseMedication(
    value: JsonElement?,
    path: String,
    errors: MutableList<ParseIssue>,
    stripped: MutableList<String>,
): NanoMedication? {
    val obj = value as? JsonObject
    if (obj == null) {
        errors.add(issue(path, ParseErrorCode.TYPE_ERROR, "Expected a medication object, got ${typeName(value)}"))
        return null
    }
    collectStripped(obj, MEDICATION_KEYS, path, stripped)
    val name = asNullableString(requireKey(obj, "name", "$path.name", errors), "$path.name", errors)
    val nameConfidence = asConfidence(requireKey(obj, "nameConfidence", "$path.nameConfidence", errors), "$path.nameConfidence", errors)
    val dose = asNullableString(requireKey(obj, "dose", "$path.dose", errors), "$path.dose", errors)
    val doseConfidence = asConfidence(requireKey(obj, "doseConfidence", "$path.doseConfidence", errors), "$path.doseConfidence", errors)
    val frequency = asNullableString(requireKey(obj, "frequency", "$path.frequency", errors), "$path.frequency", errors)
    val frequencyConfidence = asConfidence(requireKey(obj, "frequencyConfidence", "$path.frequencyConfidence", errors), "$path.frequencyConfidence", errors)
    val duration = asNullableString(requireKey(obj, "duration", "$path.duration", errors), "$path.duration", errors)
    val durationConfidence = asConfidence(requireKey(obj, "durationConfidence", "$path.durationConfidence", errors), "$path.durationConfidence", errors)
    if (name.isUnset() || nameConfidence == null || dose.isUnset() || doseConfidence == null ||
        frequency.isUnset() || frequencyConfidence == null || duration.isUnset() || durationConfidence == null
    ) return null
    return NanoMedication(name, nameConfidence, dose, doseConfidence, frequency, frequencyConfidence, duration, durationConfidence)
}

private fun parseLab(
    value: JsonElement?,
    path: String,
    errors: MutableList<ParseIssue>,
    stripped: MutableList<String>,
): NanoLabResult? {
    val obj = value as? JsonObject
    if (obj == null) {
        errors.add(issue(path, ParseErrorCode.TYPE_ERROR, "Expected a lab result object, got ${typeName(value)}"))
        return null
    }
    collectStripped(obj, LAB_KEYS, path, stripped)
    val test = asNullableString(requireKey(obj, "test", "$path.test", errors), "$path.test", errors)
    val testConfidence = asConfidence(requireKey(obj, "testConfidence", "$path.testConfidence", errors), "$path.testConfidence", errors)
    val valueText = asNullableString(requireKey(obj, "value", "$path.value", errors), "$path.value", errors)
    val valueConfidence = asConfidence(requireKey(obj, "valueConfidence", "$path.valueConfidence", errors), "$path.valueConfidence", errors)
    val unit = asNullableString(requireKey(obj, "unit", "$path.unit", errors), "$path.unit", errors)
    val unitConfidence = asConfidence(requireKey(obj, "unitConfidence", "$path.unitConfidence", errors), "$path.unitConfidence", errors)
    val referenceRange = asNullableString(requireKey(obj, "referenceRange", "$path.referenceRange", errors), "$path.referenceRange", errors)
    val referenceRangeConfidence = asConfidence(
        requireKey(obj, "referenceRangeConfidence", "$path.referenceRangeConfidence", errors),
        "$path.referenceRangeConfidence",
        errors,
    )
    if (test.isUnset() || testConfidence == null || valueText.isUnset() || valueConfidence == null ||
        unit.isUnset() || unitConfidence == null || referenceRange.isUnset() || referenceRangeConfidence == null
    ) return null
    return NanoLabResult(test, testConfidence, valueText, valueConfidence, unit, unitConfidence, referenceRange, referenceRangeConfidence)
}

/**
 * Parse Nano's raw string output into a typed NanoExtraction.
 * Unknown properties are stripped (listed on success) rather than rejected.
 */
fun parseNanoOutput(raw: String): ParseResult {
    val extracted = extractJsonText(raw)
    if (extracted is ExtractedJson.Errors) return ParseResult.Err(extracted.errors)
    val text = (extracted as ExtractedJson.Text).text
    val parsed: JsonElement = try {
        Json.parseToJsonElement(text)
    } catch (e: Exception) {
        return ParseResult.Err(listOf(issue("", ParseErrorCode.PARSE_ERROR, "JSON.parse failed: ${e.message}")))
    }
    val obj = parsed as? JsonObject
        ?: return ParseResult.Err(listOf(issue("", ParseErrorCode.TYPE_ERROR, "Expected a JSON object, got ${typeName(parsed)}")))
    val errors = mutableListOf<ParseIssue>()
    val stripped = mutableListOf<String>()
    collectStripped(obj, ROOT_KEYS, "", stripped)

    val documentType = parseDocumentType(requireKey(obj, "documentType", "documentType", errors), "documentType", errors)
    val documentTypeConfidence = asConfidence(
        requireKey(obj, "documentTypeConfidence", "documentTypeConfidence", errors),
        "documentTypeConfidence",
        errors,
    )
    val rawTextEl = requireKey(obj, "rawText", "rawText", errors)
    val rawText = when {
        rawTextEl == null -> UNSET
        else -> asNullableString(rawTextEl, "rawText", errors)
    }

    val medicationsRaw = requireKey(obj, "medications", "medications", errors)
    val labResultsRaw = requireKey(obj, "labResults", "labResults", errors)

    var medications: MutableList<NanoMedication>? = null
    if (medicationsRaw != null) {
        val arr = medicationsRaw as? JsonArray
        if (arr == null) {
            errors.add(issue("medications", ParseErrorCode.TYPE_ERROR, "Expected an array, got ${typeName(medicationsRaw)}"))
        } else {
            medications = mutableListOf()
            arr.forEachIndexed { i, item ->
                val parsedItem = parseMedication(item, "medications[$i]", errors, stripped)
                if (parsedItem != null) medications.add(parsedItem)
            }
        }
    }

    var labResults: MutableList<NanoLabResult>? = null
    if (labResultsRaw != null) {
        val arr = labResultsRaw as? JsonArray
        if (arr == null) {
            errors.add(issue("labResults", ParseErrorCode.TYPE_ERROR, "Expected an array, got ${typeName(labResultsRaw)}"))
        } else {
            labResults = mutableListOf()
            arr.forEachIndexed { i, item ->
                val parsedItem = parseLab(item, "labResults[$i]", errors, stripped)
                if (parsedItem != null) labResults.add(parsedItem)
            }
        }
    }

    if (errors.isNotEmpty() || documentType == null || documentTypeConfidence == null || rawText.isUnset() || medications == null || labResults == null) {
        return ParseResult.Err(errors.ifEmpty { listOf(issue("", ParseErrorCode.TYPE_ERROR, "Incomplete extraction")) })
    }
    return ParseResult.Ok(
        NanoExtraction(documentType, documentTypeConfidence, if (rawText == UNSET) null else rawText, medications, labResults),
        stripped,
    )
}

private fun minConfidence(values: List<Double>): Double = values.fold(1.0) { a, b -> minOf(a, b) }

/**
 * Map a Nano extraction onto the ClinicalDoc-compatible field subset.
 * Rows whose identifying field is null (medication name, lab test or value)
 * are dropped; they remain available on the original extraction for routing.
 */
fun toClinicalFields(extraction: NanoExtraction): ClinicalFields = ClinicalFields(
    documentType = extraction.documentType,
    rawText = extraction.rawText,
    medications = extraction.medications.filter { it.name != null }.map { m ->
        ClinicalMedication(
            name = m.name!!,
            dose = m.dose,
            frequency = m.frequency,
            duration = m.duration,
            confidence = minConfidence(
                listOf(m.nameConfidence, m.doseConfidence, m.frequencyConfidence, m.durationConfidence),
            ),
        )
    },
    labResults = extraction.labResults.filter { it.test != null && it.value != null }.map { l ->
        ClinicalLab(
            test = l.test!!,
            value = l.value!!,
            unit = l.unit,
            referenceRange = l.referenceRange,
            confidence = minConfidence(
                listOf(l.testConfidence, l.valueConfidence, l.unitConfidence, l.referenceRangeConfidence),
            ),
        )
    },
)

fun toClinicalDoc(fields: ClinicalFields): com.medocr.hybrid.core.ClinicalDoc =
    com.medocr.hybrid.core.ClinicalDoc(
        documentType = com.medocr.hybrid.core.DocumentType.fromWire(
            if (fields.documentType == "discharge_summary") "other" else fields.documentType,
        ),
        medications = fields.medications.map { m ->
            com.medocr.hybrid.core.Medication(
                name = m.name,
                dose = m.dose,
                frequency = m.frequency,
                duration = m.duration,
                confidence = m.confidence,
                sourceText = fields.rawText,
            )
        },
        labResults = fields.labResults.map { l ->
            com.medocr.hybrid.core.LabResult(
                test = l.test,
                value = l.value,
                unit = l.unit,
                referenceRange = l.referenceRange,
                confidence = l.confidence,
                sourceText = fields.rawText,
            )
        },
    )
