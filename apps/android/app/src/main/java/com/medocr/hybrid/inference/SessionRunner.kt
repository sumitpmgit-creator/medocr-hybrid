// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.DEFAULT_THRESHOLDS
import com.medocr.hybrid.core.ImagePayload
import com.medocr.hybrid.core.PipelineRun
import com.medocr.hybrid.core.Reference
import com.medocr.hybrid.core.RouteDecision
import com.medocr.hybrid.core.RoutingThresholds
import com.medocr.hybrid.core.StageData
import com.medocr.hybrid.core.routeDoc
import com.medocr.hybrid.core.runPipeline
import com.medocr.hybrid.parsing.RoutedField
import com.medocr.hybrid.receipt.ComparisonReport
import com.medocr.hybrid.receipt.FieldSource
import com.medocr.hybrid.receipt.PrivacyReceipt
import com.medocr.hybrid.receipt.ReviewField
import com.medocr.hybrid.receipt.buildPrivacyReceipt
import com.medocr.hybrid.receipt.compareModes
import com.medocr.hybrid.receipt.markConfirmFromAbstentions
import com.medocr.hybrid.receipt.reviewFieldsFromDoc
import com.medocr.hybrid.core.StageData as SD

data class SessionResult(
    val onDevice: PipelineRun,
    /** Present only when the optional cloud baseline was requested. Uploads never run it by default. */
    val cloud: PipelineRun?,
    val hybrid: PipelineRun,
    val review: List<ReviewField>,
    val receipt: PrivacyReceipt,
    val comparison: ComparisonReport,
    val clientLabel: String,
)

/**
 * Run the default upload pipelines: on-device and hybrid. The cloud-only
 * baseline (which uploads the page image) is opt-in via [includeCloudBaseline]
 * and is never the default for a user upload (BUG-025 / Advisory).
 */
suspend fun runSession(
    image: ImagePayload,
    client: LlmClient,
    thresholds: RoutingThresholds = DEFAULT_THRESHOLDS,
    reference: Reference? = null,
    docId: String = "upload",
    includeCloudBaseline: Boolean = false,
): SessionResult {
    val pipes = pipelines(thresholds, client)
    val input = StageData.Image(image)
    val onDevice = runPipeline(pipes.first { it.id == "on-device-only" }, input, docId)
    val cloud = if (includeCloudBaseline) {
        runPipeline(pipes.first { it.id == "cloud-only" }, input, docId)
    } else {
        null
    }
    val hybrid = runPipeline(pipes.first { it.id == "hybrid" }, input, docId)
    val hybridDoc = (hybrid.final as? SD.Fields)?.doc
    val sourceText = (hybrid.final as? SD.Fields)?.text
    val defaultSource = when (client.label) {
        "mock" -> FieldSource.MOCK
        else -> FieldSource.HYBRID
    }
    val review = if (hybridDoc != null) {
        markConfirmFromAbstentions(
            reviewFieldsFromDoc(hybridDoc, defaultSource, sourceText),
            hybridDoc.abstentions,
        )
    } else emptyList()
    val nanoFields = hybrid.steps.find { it.stageId == "nano-structure" }?.output as? SD.Fields
    val routed = nanoFields?.let { routeDoc(it.doc, it.text ?: "", thresholds) }
    val routedFields = buildList {
        routed?.meds?.filter { it.decision == RouteDecision.SEND_TO_CLOUD }?.forEach {
            add(RoutedField("medications[${it.index}]", "medication", it.entity.name, it.confidence, emptyMap()))
        }
        routed?.labs?.filter { it.decision == RouteDecision.SEND_TO_CLOUD }?.forEach {
            add(RoutedField("labResults[${it.index}]", "lab", it.entity.test, it.confidence, emptyMap()))
        }
    }
    val receipt = buildPrivacyReceipt(
        run = hybrid,
        routedFields = routedFields,
        imageBytesSent = 0, // hybrid cloud-structure sends de-identified snippets only, never the image
    )
    val comparison = compareModes(onDevice, cloud, hybrid, reference = reference)
    return SessionResult(onDevice, cloud, hybrid, review, receipt, comparison, client.label)
}
