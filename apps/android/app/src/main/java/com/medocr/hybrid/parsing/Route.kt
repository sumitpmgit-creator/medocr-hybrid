// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing

/**
 * Kotlin mirror of packages/parsing/src/extraction/route.ts.
 * Default cutoff: fields with confidence below this are sent to the cloud model.
 */
const val DEFAULT_CLOUD_ROUTE_THRESHOLD = 0.7

data class RoutedField(
    /** JS-style path, e.g. medications[0].dose */
    val path: String,
    val field: String,
    val value: String?,
    val confidence: Double,
    /** Identifying siblings so the cloud can re-extract this field in context. */
    val context: Map<String, String?>,
)

data class RouteOptions(
    /** Exclusive upper bound. Fields with confidence < threshold are routed. Default 0.7. */
    val threshold: Double = DEFAULT_CLOUD_ROUTE_THRESHOLD,
    /**
     * Also route value fields that Nano set to null, even when their confidence
     * is at or above the threshold. Default false.
     */
    val includeUnreadable: Boolean = false,
)

private fun shouldRoute(confidence: Double, value: String?, opts: RouteOptions): Boolean {
    if (confidence < opts.threshold) return true
    if (opts.includeUnreadable && value == null) return true
    return false
}

fun fieldsBelowThreshold(
    extraction: NanoExtraction,
    options: RouteOptions = RouteOptions(),
): List<RoutedField> {
    val out = mutableListOf<RoutedField>()
    if (shouldRoute(extraction.documentTypeConfidence, extraction.documentType, options)) {
        out += RoutedField(
            path = "documentType",
            field = "documentType",
            value = extraction.documentType,
            confidence = extraction.documentTypeConfidence,
            context = emptyMap(),
        )
    }
    extraction.medications.forEachIndexed { i, med ->
        val context = mapOf(
            "name" to med.name,
            "dose" to med.dose,
            "frequency" to med.frequency,
            "duration" to med.duration,
        )
        val conf = mapOf(
            "name" to med.nameConfidence,
            "dose" to med.doseConfidence,
            "frequency" to med.frequencyConfidence,
            "duration" to med.durationConfidence,
        )
        val values = mapOf(
            "name" to med.name,
            "dose" to med.dose,
            "frequency" to med.frequency,
            "duration" to med.duration,
        )
        for (field in MEDICATION_VALUE_FIELDS) {
            val confidence = conf.getValue(field)
            val value = values[field]
            if (shouldRoute(confidence, value, options)) {
                out += RoutedField("medications[$i].$field", field, value, confidence, context)
            }
        }
    }
    extraction.labResults.forEachIndexed { i, lab ->
        val context = mapOf(
            "test" to lab.test,
            "value" to lab.value,
            "unit" to lab.unit,
            "referenceRange" to lab.referenceRange,
        )
        val conf = mapOf(
            "test" to lab.testConfidence,
            "value" to lab.valueConfidence,
            "unit" to lab.unitConfidence,
            "referenceRange" to lab.referenceRangeConfidence,
        )
        val values = mapOf(
            "test" to lab.test,
            "value" to lab.value,
            "unit" to lab.unit,
            "referenceRange" to lab.referenceRange,
        )
        for (field in LAB_VALUE_FIELDS) {
            val confidence = conf.getValue(field)
            val value = values[field]
            if (shouldRoute(confidence, value, options)) {
                out += RoutedField("labResults[$i].$field", field, value, confidence, context)
            }
        }
    }
    return out
}

fun mergeExtractions(device: NanoExtraction, cloud: NanoExtraction, routed: List<RoutedField>): NanoExtraction {
    val paths = routed.map { it.path }.toSet()
    fun takeType(): Pair<String, Double> =
        if ("documentType" in paths) cloud.documentType to cloud.documentTypeConfidence
        else device.documentType to device.documentTypeConfidence

    val meds = device.medications.mapIndexed { i, m ->
        val c = cloud.medications.getOrNull(i) ?: return@mapIndexed m
        m.copy(
            name = if ("medications[$i].name" in paths) c.name else m.name,
            nameConfidence = if ("medications[$i].name" in paths) c.nameConfidence else m.nameConfidence,
            dose = if ("medications[$i].dose" in paths) c.dose else m.dose,
            doseConfidence = if ("medications[$i].dose" in paths) c.doseConfidence else m.doseConfidence,
            frequency = if ("medications[$i].frequency" in paths) c.frequency else m.frequency,
            frequencyConfidence = if ("medications[$i].frequency" in paths) c.frequencyConfidence else m.frequencyConfidence,
            duration = if ("medications[$i].duration" in paths) c.duration else m.duration,
            durationConfidence = if ("medications[$i].duration" in paths) c.durationConfidence else m.durationConfidence,
        )
    }
    val extraMeds = if (cloud.medications.size > device.medications.size) {
        cloud.medications.drop(device.medications.size)
    } else emptyList()
    val labs = device.labResults.mapIndexed { i, l ->
        val c = cloud.labResults.getOrNull(i) ?: return@mapIndexed l
        l.copy(
            test = if ("labResults[$i].test" in paths) c.test else l.test,
            testConfidence = if ("labResults[$i].test" in paths) c.testConfidence else l.testConfidence,
            value = if ("labResults[$i].value" in paths) c.value else l.value,
            valueConfidence = if ("labResults[$i].value" in paths) c.valueConfidence else l.valueConfidence,
            unit = if ("labResults[$i].unit" in paths) c.unit else l.unit,
            unitConfidence = if ("labResults[$i].unit" in paths) c.unitConfidence else l.unitConfidence,
            referenceRange = if ("labResults[$i].referenceRange" in paths) c.referenceRange else l.referenceRange,
            referenceRangeConfidence = if ("labResults[$i].referenceRange" in paths) c.referenceRangeConfidence else l.referenceRangeConfidence,
        )
    }
    val extraLabs = if (cloud.labResults.size > device.labResults.size) {
        cloud.labResults.drop(device.labResults.size)
    } else emptyList()
    val (dt, dtc) = takeType()
    return NanoExtraction(
        documentType = dt,
        documentTypeConfidence = dtc,
        rawText = device.rawText ?: cloud.rawText,
        medications = meds + extraMeds,
        labResults = labs + extraLabs,
    )
}
