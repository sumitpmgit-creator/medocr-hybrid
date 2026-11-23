// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.receipt

import com.medocr.hybrid.core.PipelineRun
import com.medocr.hybrid.core.Reference
import com.medocr.hybrid.core.StageData
import com.medocr.hybrid.core.cer
import com.medocr.hybrid.core.readingText
import com.medocr.hybrid.core.scoreFields
import com.medocr.hybrid.parsing.toClinicalDoc
import com.medocr.hybrid.parsing.toClinicalFields
import com.medocr.hybrid.parsing.NanoExtraction

data class ModeScore(
    val mode: String,
    val cerVsReference: Double?,
    val cerVsCloud: Double?,
    val fieldF1: Double?,
    val costUsd: Double,
    val bytesSent: Int,
    val latencyMs: Double,
    val note: String,
)

data class ComparisonReport(
    val modes: List<ModeScore>,
    val referenceKind: String,
    val disclaimer: String,
)

/**
 * Compare on-device, cloud, and hybrid runs.
 * If [reference] has text/doc, CER and field F1 are against that ground truth.
 * Otherwise CER is reported against the cloud (or hybrid) raw text and labelled as such.
 */
fun compareModes(
    onDevice: PipelineRun?,
    cloud: PipelineRun?,
    hybrid: PipelineRun?,
    onDeviceExtraction: NanoExtraction? = null,
    cloudExtraction: NanoExtraction? = null,
    hybridExtraction: NanoExtraction? = null,
    reference: Reference? = null,
): ComparisonReport {
    val cloudText = cloud?.let { readingText(it) } ?: cloudExtraction?.rawText
    val refText = reference?.text
    val refKind = when {
        refText != null -> "ground_truth"
        cloudText != null -> "cloud_as_reference"
        else -> "none"
    }
    fun textOf(run: PipelineRun?, extraction: NanoExtraction?): String? =
        run?.let { readingText(it) } ?: extraction?.rawText

    fun score(name: String, run: PipelineRun?, extraction: NanoExtraction?): ModeScore? {
        if (run == null && extraction == null) return null
        val text = textOf(run, extraction)
        val cerRef = if (refText != null && text != null) cer(refText, text).rate else null
        val cerCloud = if (refKind == "cloud_as_reference" && name != "cloud" && cloudText != null && text != null) {
            cer(cloudText, text).rate
        } else if (name == "cloud" && refKind == "cloud_as_reference") 0.0 else null
        val f1 = if (reference?.doc != null && extraction != null) {
            scoreFields(reference.doc, toClinicalDoc(toClinicalFields(extraction))).f1
        } else null
        val note = when {
            run == null -> "Extraction only (no full pipeline run)."
            run.failed -> "Run failed: ${run.error ?: "unknown error"}"
            else -> "Completed."
        }
        return ModeScore(
            mode = name,
            cerVsReference = cerRef,
            cerVsCloud = cerCloud,
            fieldF1 = f1,
            costUsd = run?.totals?.costUsd ?: 0.0,
            bytesSent = run?.totals?.bytesSent ?: 0,
            latencyMs = run?.totals?.latencyMs ?: 0.0,
            note = note,
        )
    }
    val modes = listOfNotNull(
        score("on_device", onDevice, onDeviceExtraction),
        score("cloud", cloud, cloudExtraction),
        score("hybrid", hybrid, hybridExtraction),
    )
    val disclaimer = when (refKind) {
        "ground_truth" -> "CER and field F1 are scored against the provided reference (packages/core/src/text-metrics.ts, field-scorer.ts)."
        "cloud_as_reference" -> "No ground-truth transcript was provided. CER is reported against the cloud output and is not a measure of clinical accuracy."
        else -> "No reference text was available, so CER is omitted."
    }
    return ComparisonReport(modes, refKind, disclaimer)
}
