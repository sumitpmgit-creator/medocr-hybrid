// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.receipt

import com.medocr.hybrid.core.BBox
import com.medocr.hybrid.core.ExecutionSite
import com.medocr.hybrid.core.RouteDecision
import com.medocr.hybrid.parsing.NanoExtraction
import com.medocr.hybrid.parsing.RoutedField

enum class FieldSource(val wire: String) {
    ON_DEVICE("on_device"),
    IN_CLOUD("in_cloud"),
    HYBRID("hybrid"),
    HUMAN("human"),
    MOCK("mock"),
}

data class ReviewField(
    val path: String,
    val label: String,
    val value: String?,
    val confidence: Double,
    val bbox: BBox? = null,
    val source: FieldSource,
    val sourceText: String? = null,
    val needsConfirm: Boolean,
    val routedToCloud: Boolean,
    val disagreements: List<String> = emptyList(),
    val context: Map<String, String?> = emptyMap(),
)

fun flattenReviewFields(
    extraction: NanoExtraction,
    routed: List<RoutedField>,
    fieldSources: Map<String, FieldSource> = emptyMap(),
    confirmPaths: Set<String> = emptySet(),
    defaultSource: FieldSource = FieldSource.ON_DEVICE,
): List<ReviewField> {
    val routedPaths = routed.map { it.path }.toSet()
    val out = mutableListOf<ReviewField>()
    fun src(path: String): FieldSource = fieldSources[path] ?: if (path in routedPaths) FieldSource.IN_CLOUD else defaultSource
    fun confirm(path: String, confidence: Double): Boolean =
        path in confirmPaths || confidence < 0.5

    out += ReviewField(
        path = "documentType",
        label = "Document type",
        value = extraction.documentType,
        confidence = extraction.documentTypeConfidence,
        source = src("documentType"),
        needsConfirm = confirm("documentType", extraction.documentTypeConfidence),
        routedToCloud = "documentType" in routedPaths,
    )
    extraction.medications.forEachIndexed { i, m ->
        val rows = listOf(
            Triple("name", "Medication ${i + 1} name", m.name to m.nameConfidence),
            Triple("dose", "Medication ${i + 1} dose", m.dose to m.doseConfidence),
            Triple("frequency", "Medication ${i + 1} frequency", m.frequency to m.frequencyConfidence),
            Triple("duration", "Medication ${i + 1} duration", m.duration to m.durationConfidence),
        )
        val ctx = mapOf("name" to m.name, "dose" to m.dose, "frequency" to m.frequency, "duration" to m.duration)
        for ((field, label, pair) in rows) {
            val path = "medications[$i].$field"
            out += ReviewField(
                path = path,
                label = label,
                value = pair.first,
                confidence = pair.second,
                source = src(path),
                sourceText = extraction.rawText,
                needsConfirm = confirm(path, pair.second),
                routedToCloud = path in routedPaths,
                context = ctx,
            )
        }
    }
    extraction.labResults.forEachIndexed { i, l ->
        val rows = listOf(
            Triple("test", "Lab ${i + 1} test", l.test to l.testConfidence),
            Triple("value", "Lab ${i + 1} value", l.value to l.valueConfidence),
            Triple("unit", "Lab ${i + 1} unit", l.unit to l.unitConfidence),
            Triple("referenceRange", "Lab ${i + 1} reference range", l.referenceRange to l.referenceRangeConfidence),
        )
        val ctx = mapOf("test" to l.test, "value" to l.value, "unit" to l.unit, "referenceRange" to l.referenceRange)
        for ((field, label, pair) in rows) {
            val path = "labResults[$i].$field"
            out += ReviewField(
                path = path,
                label = label,
                value = pair.first,
                confidence = pair.second,
                source = src(path),
                sourceText = extraction.rawText,
                needsConfirm = confirm(path, pair.second),
                routedToCloud = path in routedPaths,
                context = ctx,
            )
        }
    }
    return out
}

fun applyHumanEdit(fields: List<ReviewField>, path: String, newValue: String?): List<ReviewField> =
    fields.map {
        if (it.path == path) it.copy(
            value = newValue,
            source = FieldSource.HUMAN,
            needsConfirm = false,
            confidence = 1.0,
        ) else it
    }

fun confirmField(fields: List<ReviewField>, path: String): List<ReviewField> =
    fields.map { if (it.path == path) it.copy(needsConfirm = false, source = if (it.source == FieldSource.HUMAN) it.source else it.source) else it }
        .map { if (it.path == path) it.copy(needsConfirm = false) else it }
