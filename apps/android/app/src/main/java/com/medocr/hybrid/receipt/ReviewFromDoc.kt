// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.receipt

import com.medocr.hybrid.core.ClinicalDoc
import com.medocr.hybrid.core.LabResult
import com.medocr.hybrid.core.Medication

/** Flatten a ClinicalDoc (web-style, item-level confidence) into review rows. */

fun reviewFieldsFromDoc(
    doc: ClinicalDoc,
    defaultSource: FieldSource,
    sourceText: String? = null,
): List<ReviewField> {
    val out = mutableListOf<ReviewField>()
    out += ReviewField(
        path = "documentType",
        label = "Document type",
        value = doc.documentType.wire,
        confidence = 1.0,
        source = defaultSource,
        needsConfirm = false,
        routedToCloud = false,
        sourceText = sourceText,
    )
    doc.medications.forEachIndexed { i, m ->
        val ctx = mapOf(
            "name" to m.name, "strength" to m.strength, "dose" to m.dose,
            "frequency" to m.frequency, "duration" to m.duration,
        )
        val conf = m.confidence ?: 0.5
        fun row(field: String, label: String, value: String?) = ReviewField(
            path = "medications[$i].$field",
            label = "Medication ${i + 1} $label",
            value = value,
            confidence = conf,
            source = defaultSource,
            sourceText = m.sourceText ?: sourceText,
            needsConfirm = false,
            routedToCloud = false,
            context = ctx,
        )
        out += row("name", "name", m.name)
        out += row("strength", "strength", m.strength)
        out += row("dose", "dose", m.dose)
        out += row("frequency", "frequency", m.frequency)
        out += row("duration", "duration", m.duration)
        out += row("instructions", "instructions", m.instructions)
    }
    doc.labResults.forEachIndexed { i, l ->
        val ctx = mapOf("test" to l.test, "value" to l.value, "unit" to l.unit, "referenceRange" to l.referenceRange)
        val conf = l.confidence ?: 0.5
        fun row(field: String, label: String, value: String?) = ReviewField(
            path = "labResults[$i].$field",
            label = "Lab ${i + 1} $label",
            value = value,
            confidence = conf,
            source = defaultSource,
            sourceText = l.sourceText ?: sourceText,
            needsConfirm = false,
            routedToCloud = false,
            context = ctx,
        )
        out += row("test", "test", l.test)
        out += row("value", "value", l.value)
        out += row("unit", "unit", l.unit)
        out += row("referenceRange", "reference range", l.referenceRange)
    }
    return out
}

/**
 * Mark fields named in "HUMAN CONFIRM …" abstentions, matching
 * apps/web/src/stages.ts hybridVerify messages.
 */
fun markConfirmFromAbstentions(fields: List<ReviewField>, abstentions: List<String>?): List<ReviewField> {
    if (abstentions.isNullOrEmpty()) return fields
    return fields.map { field ->
        val hit = abstentions.any { note ->
            if (!note.startsWith("HUMAN CONFIRM")) return@any false
            val name = field.context["name"] ?: field.context["test"] ?: field.value
            val mentionsEntity = name != null && note.contains("\"$name\"")
            val mentionsField = note.contains(field.fieldName(), ignoreCase = true)
            mentionsEntity && (mentionsField || field.fieldName() == "name" || field.fieldName() == "test")
        }
        if (hit) field.copy(needsConfirm = true, source = FieldSource.HYBRID) else field
    }
}

private fun ReviewField.fieldName(): String = path.substringAfterLast('.')

fun applyEditsToDoc(doc: ClinicalDoc, fields: List<ReviewField>): ClinicalDoc {
    val meds = doc.medications.mapIndexed { i, m ->
        fun v(f: String, fallback: String?) = fields.find { it.path == "medications[$i].$f" }?.value ?: fallback
        m.copy(
            name = v("name", m.name) ?: m.name,
            strength = v("strength", m.strength),
            dose = v("dose", m.dose),
            frequency = v("frequency", m.frequency),
            duration = v("duration", m.duration),
            instructions = v("instructions", m.instructions),
            confidence = if (fields.any { it.path.startsWith("medications[$i].") && it.source == FieldSource.HUMAN }) 1.0 else m.confidence,
        )
    }
    val labs = doc.labResults.mapIndexed { i, l ->
        fun v(f: String, fallback: String?) = fields.find { it.path == "labResults[$i].$f" }?.value ?: fallback
        l.copy(
            test = v("test", l.test) ?: l.test,
            value = v("value", l.value) ?: l.value,
            unit = v("unit", l.unit),
            referenceRange = v("referenceRange", l.referenceRange),
        )
    }
    val type = fields.find { it.path == "documentType" }?.value
    return doc.copy(
        documentType = type?.let { com.medocr.hybrid.core.DocumentType.fromWire(it) } ?: doc.documentType,
        medications = meds,
        labResults = labs,
        abstentions = doc.abstentions?.filterNot { it.startsWith("HUMAN CONFIRM") && fields.none { f -> f.needsConfirm } },
    )
}
