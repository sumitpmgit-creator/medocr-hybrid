// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.receipt

import com.medocr.hybrid.core.CLOUD_MODEL
import com.medocr.hybrid.core.ExecutionSite
import com.medocr.hybrid.core.PipelineRun
import com.medocr.hybrid.core.StageKind
import com.medocr.hybrid.core.utf8Bytes
import com.medocr.hybrid.parsing.RoutedField
import com.medocr.hybrid.parsing.deid.RedactionType
import com.medocr.hybrid.parsing.deid.redactionCounts
import com.medocr.hybrid.parsing.deid.DeidentifyResult
import java.time.Instant

/**
 * Privacy receipt: what left the device, and what on-device de-id removed.
 * De-id details are counts and types only — never the original values.
 */

data class ReceiptEntry(
    val stageId: String,
    val stageKind: String,
    val site: ExecutionSite,
    val model: String?,
    val bytesSent: Int,
    val inputTokens: Int?,
    val outputTokens: Int?,
    val costUsd: Double,
    val description: String,
)

data class PrivacyReceipt(
    val runId: String,
    val generatedAt: String,
    val leftTheDevice: Boolean,
    val totalBytesSent: Int,
    val totalCostUsd: Double,
    val fieldsSentToCloud: List<String>,
    val imageLeftDevice: Boolean,
    val imageBytes: Int,
    val deidRedactions: Int,
    val deidByType: Map<String, Int>,
    val deidNotes: List<String>,
    val entries: List<ReceiptEntry>,
    val summary: String,
    val caveats: List<String>,
)

fun buildPrivacyReceipt(
    run: PipelineRun,
    routedFields: List<RoutedField> = emptyList(),
    imageBytesSent: Int = 0,
    deid: DeidentifyResult? = null,
    cloudModel: String = CLOUD_MODEL,
): PrivacyReceipt {
    val deidStage = run.steps.filter { it.stageKind == StageKind.DEID }
    val counts = deid?.let { redactionCounts(it.redactions) }.orEmpty()
    val byType = counts.mapKeys { it.key.wire }.toMutableMap()
    // Fall back to notes like "Removed N identifier(s): name=1, phone=1"
    if (byType.isEmpty()) {
        for (step in deidStage) {
            for (n in step.notes.orEmpty()) {
                Regex("(\\w+)=(\\d+)").findAll(n).forEach { m ->
                    byType[m.groupValues[1]] = (byType[m.groupValues[1]] ?: 0) + m.groupValues[2].toInt()
                }
            }
        }
    }
    val deidTotal = deid?.redactions?.size ?: byType.values.sum()
    val deidNotes = deidStage.flatMap { it.notes.orEmpty() }
    val left = run.totals.bytesSent > 0 || imageBytesSent > 0
    val imageLeft = imageBytesSent > 0
    val fields = routedFields.map { it.path }
    val entries = run.steps.map { step ->
        val model = when (step.site) {
            ExecutionSite.IN_CLOUD -> cloudModel
            ExecutionSite.ON_DEVICE -> "gemini-nano-on-device"
            ExecutionSite.LOCAL_CODE -> if (step.stageKind == StageKind.DEID) "deid" else "mock-or-local"
            ExecutionSite.HUMAN -> "human"
            ExecutionSite.SERVER_GPU -> "server_gpu"
        }
        val desc = when {
            step.stageKind == StageKind.DEID ->
                step.notes?.joinToString(" ") ?: "On-device de-identification (counts and types only)."
            step.site == ExecutionSite.IN_CLOUD && step.metrics.bytesSent > 0 ->
                "Sent ${step.metrics.bytesSent} bytes to $cloudModel. Output tokens include thinking tokens (candidates + thoughts)."
            step.site == ExecutionSite.ON_DEVICE || (step.site == ExecutionSite.LOCAL_CODE && step.metrics.bytesSent == 0) ->
                "Ran on this device. No bytes left the device for this stage."
            step.site == ExecutionSite.HUMAN ->
                "Value confirmed or edited by a human reviewer on this device."
            else -> "Stage ${step.stageId} at ${step.site.wire}."
        }
        ReceiptEntry(
            stageId = step.stageId,
            stageKind = step.stageKind.wire,
            site = step.site,
            model = model,
            bytesSent = step.metrics.bytesSent,
            inputTokens = step.metrics.inputTokens,
            outputTokens = step.metrics.outputTokens,
            costUsd = step.metrics.costUsd,
            description = desc,
        )
    }
    val typeList = if (byType.isEmpty()) "none" else byType.entries.joinToString(", ") { "${it.key}=${it.value}" }
    val summary = buildString {
        if (!left) append("Nothing left this device. ")
        else {
            append("This run sent ${run.totals.bytesSent} bytes off-device. ")
            if (imageLeft) append("The document image ($imageBytesSent bytes) was uploaded (cloud OCR). ")
            else append("No document image was uploaded for this path. ")
            if (fields.isNotEmpty()) append("Cloud text request covered: ${fields.joinToString(", ")}. ")
            append("Cloud model: $cloudModel. ")
        }
        append("On-device de-id removed $deidTotal identifier(s) ($typeList).")
    }
    val caveats = buildList {
        add("De-id details are counts and types only; original values are never written to this receipt.")
        add("On-device de-identification covers extracted text only, not pixels in a document image.")
        add("Regex redaction may over-redact and can miss unlabelled names. It is not a guarantee of anonymisation.")
        add("Cloud cost uses official paid-tier rates from benchmarks/pricing.json ($PRICING_SOURCE, retrieved $PRICING_RETRIEVED) when core prices are still placeholders. Output tokens include thinking tokens.")
        add("CER is computed on the raw OCR transcript, before the de-id stage.")
    }
    return PrivacyReceipt(
        runId = run.runId,
        generatedAt = Instant.now().toString(),
        leftTheDevice = left,
        totalBytesSent = run.totals.bytesSent,
        totalCostUsd = run.totals.costUsd,
        fieldsSentToCloud = fields,
        imageLeftDevice = imageLeft,
        imageBytes = imageBytesSent,
        deidRedactions = deidTotal,
        deidByType = byType,
        deidNotes = deidNotes,
        entries = entries,
        summary = summary,
        caveats = caveats,
    )
}

fun promptBytes(prompt: String): Int = utf8Bytes(prompt)

private const val PRICING_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing"
private const val PRICING_RETRIEVED = "2026-11-23"
