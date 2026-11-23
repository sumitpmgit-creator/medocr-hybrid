// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.ClinicalDoc
import com.medocr.hybrid.core.DocumentType
import com.medocr.hybrid.core.LabFlag
import com.medocr.hybrid.core.LabResult
import com.medocr.hybrid.core.Medication
import com.medocr.hybrid.parsing.extractJsonText
import com.medocr.hybrid.parsing.ExtractedJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Tolerant parser for the ClinicalDoc JSON produced by the structure stage
 * (apps/web/src/stages.ts parseDoc, plus a few extra fields from packages/core/src/schema.ts).
 */
fun parseClinicalDoc(raw: String): ClinicalDoc {
    val extracted = when (val e = extractJsonText(raw)) {
        is ExtractedJson.Text -> e.text
        is ExtractedJson.Errors -> throw IllegalArgumentException(e.errors.joinToString { it.message })
    }
    val root = Json.parseToJsonElement(extracted) as? JsonObject
        ?: throw IllegalArgumentException("Expected a JSON object")
    val type = (root["documentType"] as? JsonPrimitive)?.content ?: "other"
    return ClinicalDoc(
        documentType = DocumentType.fromWire(type),
        medications = (root["medications"] as? JsonArray)?.mapNotNull { parseMed(it as? JsonObject) } ?: emptyList(),
        labResults = (root["labResults"] as? JsonArray)?.mapNotNull { parseLab(it as? JsonObject) } ?: emptyList(),
        abstentions = (root["abstentions"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content },
    )
}

private fun JsonObject.str(key: String): String? {
    val v = this[key] ?: return null
    if (v is JsonNull) return null
    val p = v as? JsonPrimitive ?: return null
    val s = p.content
    return s.ifEmpty { null }
}

private fun JsonObject.num(key: String): Double? {
    val v = this[key] ?: return null
    if (v is JsonNull) return null
    val p = v as? JsonPrimitive ?: return null
    return p.doubleOrNull ?: p.content.toDoubleOrNull()
}

private fun parseMed(o: JsonObject?): Medication? {
    if (o == null) return null
    val name = o.str("name") ?: return null
    return Medication(
        name = name,
        genericName = o.str("genericName"),
        strength = o.str("strength"),
        dosageForm = o.str("dosageForm"),
        dose = o.str("dose"),
        route = o.str("route"),
        frequency = o.str("frequency"),
        timing = o.str("timing"),
        duration = o.str("duration"),
        quantity = o.str("quantity"),
        instructions = o.str("instructions"),
        confidence = o.num("confidence"),
        sourceText = o.str("sourceText"),
    )
}

private fun parseLab(o: JsonObject?): LabResult? {
    if (o == null) return null
    val test = o.str("test") ?: return null
    val value = o.str("value") ?: return null
    return LabResult(
        test = test,
        value = value,
        unit = o.str("unit"),
        referenceRange = o.str("referenceRange"),
        flag = LabFlag.fromWireOrNull(o.str("flag")),
        confidence = o.num("confidence"),
        sourceText = o.str("sourceText"),
    )
}
