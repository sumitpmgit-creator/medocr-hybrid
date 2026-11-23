// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.DEFAULT_THRESHOLDS
import com.medocr.hybrid.core.ImagePayload
import com.medocr.hybrid.core.PipelineRun
import com.medocr.hybrid.core.Reference
import com.medocr.hybrid.core.RoutingThresholds
import com.medocr.hybrid.core.StageData
import com.medocr.hybrid.core.runPipeline
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
    val cloud: PipelineRun,
    val hybrid: PipelineRun,
    val review: List<ReviewField>,
    val receipt: PrivacyReceipt,
    val comparison: ComparisonReport,
    val clientLabel: String,
)

suspend fun runSession(
    image: ImagePayload,
    client: LlmClient,
    thresholds: RoutingThresholds = DEFAULT_THRESHOLDS,
    reference: Reference? = null,
    docId: String = "upload",
): SessionResult {
    val pipes = pipelines(thresholds, client)
    val input = StageData.Image(image)
    val onDevice = runPipeline(pipes[0], input, docId)
    val cloud = runPipeline(pipes[1], input, docId)
    val hybrid = runPipeline(pipes[2], input, docId)
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
    val receipt = buildPrivacyReceipt(
        run = hybrid,
        routedFields = emptyList(),
        imageBytesSent = 0, // hybrid verify sends de-identified text only, never the image
    )
    val comparison = compareModes(onDevice, cloud, hybrid, reference = reference)
    return SessionResult(onDevice, cloud, hybrid, review, receipt, comparison, client.label)
}
