// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

/**
 * Kotlin mirror of packages/core/src/routing.ts.
 *
 * Hybrid routing. Thresholds come from Firebase Remote Config so they can be tuned live.
 * Field confidence = min(model self-report, evidence grounding), because self-reported
 * confidence from small models is poorly calibrated.
 *
 * Defaults (keep in sync with packages/core/src/routing.ts):
 *   acceptOnDevice = 0.85
 *   humanReview    = 0.50
 *
 * Note: packages/parsing/src/extraction/route.ts uses a *per-field* cloud
 * re-read cutoff of 0.70 (DEFAULT_CLOUD_ROUTE_THRESHOLD). That lives in
 * [com.medocr.hybrid.parsing.DEFAULT_CLOUD_ROUTE_THRESHOLD] and is used
 * for Nano field-level routing; this file is entity-level routing on ClinicalDoc.
 */

data class RoutingThresholds(
    /** At or above: accept on-device result */
    val acceptOnDevice: Double = 0.85,
    /** Below this after cloud check, or on disagreement: human confirm */
    val humanReview: Double = 0.5,
)

val DEFAULT_THRESHOLDS = RoutingThresholds()

enum class RouteDecision(val wire: String) {
    ACCEPT_ON_DEVICE("accept_on_device"),
    SEND_TO_CLOUD("send_to_cloud"),
    HUMAN_CONFIRM("human_confirm"),
}

data class Grounding(val confidence: Double, val grounded: Boolean)

data class EntityRoute<T>(
    val index: Int,
    val entity: T,
    val confidence: Double,
    val grounded: Boolean,
    val decision: RouteDecision,
)

fun groundedConfidence(
    selfReported: Double?,
    values: List<String?>,
    sourceText: String,
): Grounding {
    val present = values.filter { !it.isNullOrEmpty() }.map { it as String }
    val grounded = present.all { fuzzyContains(sourceText, it, 0.8) }
    val self = selfReported ?: 0.5
    return Grounding(confidence = if (grounded) self else minOf(self, 0.4), grounded = grounded)
}

data class DocRoute(
    val meds: List<EntityRoute<Medication>>,
    val labs: List<EntityRoute<LabResult>>,
    val toCloud: Int,
)

fun routeDoc(
    doc: ClinicalDoc,
    sourceText: String,
    t: RoutingThresholds = DEFAULT_THRESHOLDS,
): DocRoute {
    fun decide(c: Double): RouteDecision =
        if (c >= t.acceptOnDevice) RouteDecision.ACCEPT_ON_DEVICE else RouteDecision.SEND_TO_CLOUD
    val meds = doc.medications.mapIndexed { index, m ->
        val g = groundedConfidence(m.confidence, listOf(m.name, m.strength, m.dose), sourceText)
        EntityRoute(index, m, g.confidence, g.grounded, decide(g.confidence))
    }
    val labs = doc.labResults.mapIndexed { index, l ->
        val g = groundedConfidence(l.confidence, listOf(l.test, l.value), sourceText)
        EntityRoute(index, l, g.confidence, g.grounded, decide(g.confidence))
    }
    return DocRoute(
        meds = meds,
        labs = labs,
        toCloud = meds.count { it.decision == RouteDecision.SEND_TO_CLOUD } +
            labs.count { it.decision == RouteDecision.SEND_TO_CLOUD },
    )
}

data class ReconcileResult<T>(
    val value: T,
    val decision: RouteDecision,
    val disagreements: List<String>,
)

fun reconcileMedication(
    device: Medication,
    cloud: Medication?,
    t: RoutingThresholds = DEFAULT_THRESHOLDS,
): ReconcileResult<Medication> {
    if (cloud == null) return ReconcileResult(device, RouteDecision.HUMAN_CONFIRM, listOf("cloud_missing"))
    val d = mutableListOf<String>()
    if (normalizeName(device.name) != normalizeName(cloud.name)) d += "name"
    if (normalizeStrength(device.strength) != normalizeStrength(cloud.strength)) d += "strength"
    if (normalizeFrequency(device.frequency) != normalizeFrequency(cloud.frequency)) d += "frequency"
    if ((device.dose ?: "") != (cloud.dose ?: "")) d += "dose"
    val lowCloud = (cloud.confidence ?: 1.0) < t.humanReview
    return ReconcileResult(
        value = cloud,
        decision = if (d.isNotEmpty() || lowCloud) RouteDecision.HUMAN_CONFIRM else RouteDecision.ACCEPT_ON_DEVICE,
        disagreements = d,
    )
}

fun reconcileLab(
    device: LabResult,
    cloud: LabResult?,
    t: RoutingThresholds = DEFAULT_THRESHOLDS,
): ReconcileResult<LabResult> {
    if (cloud == null) return ReconcileResult(device, RouteDecision.HUMAN_CONFIRM, listOf("cloud_missing"))
    val d = mutableListOf<String>()
    if (normalizeName(device.test) != normalizeName(cloud.test)) d += "test"
    if (normalizeNumber(device.value) != normalizeNumber(cloud.value)) d += "value"
    if (normalizeUnit(device.unit) != normalizeUnit(cloud.unit)) d += "unit"
    val lowCloud = (cloud.confidence ?: 1.0) < t.humanReview
    return ReconcileResult(
        value = cloud,
        decision = if (d.isNotEmpty() || lowCloud) RouteDecision.HUMAN_CONFIRM else RouteDecision.ACCEPT_ON_DEVICE,
        disagreements = d,
    )
}
