// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

/**
 * Kotlin mirror of packages/core/src/types.ts.
 * Keep field names and union values in lock-step with that file.
 */

/** Normalised bounding box (0..1 of image width/height). */
data class BBox(val x: Double, val y: Double, val w: Double, val h: Double)

data class TextSpan(
    val text: String,
    val bbox: BBox? = null,
    val confidence: Double? = null,
)

data class ImagePayload(
    val mimeType: String, // "image/png" | "image/jpeg"
    /** base64 without the data: prefix */
    val base64: String,
    val width: Int? = null,
    val height: Int? = null,
)

enum class DocumentType(val wire: String) {
    PRESCRIPTION("prescription"),
    LAB_REPORT("lab_report"),
    DISCHARGE_SUMMARY("discharge_summary"),
    OTHER("other");

    companion object {
        fun fromWire(value: String): DocumentType =
            entries.firstOrNull { it.wire == value } ?: OTHER
    }
}

data class Medication(
    val name: String,
    val genericName: String? = null,
    val strength: String? = null,
    val dosageForm: String? = null,
    val dose: String? = null,
    val route: String? = null,
    /** Canonical form like 1-0-1 when derivable */
    val frequency: String? = null,
    val timing: String? = null,
    val duration: String? = null,
    val quantity: String? = null,
    val instructions: String? = null,
    val confidence: Double? = null,
    val sourceText: String? = null,
    val bbox: BBox? = null,
)

enum class LabFlag(val wire: String) {
    HIGH("high"),
    LOW("low"),
    NORMAL("normal"),
    ABNORMAL("abnormal");

    companion object {
        fun fromWireOrNull(value: String?): LabFlag? =
            entries.firstOrNull { it.wire == value }
    }
}

data class LabResult(
    val test: String,
    val value: String,
    val unit: String? = null,
    val referenceRange: String? = null,
    val flag: LabFlag? = null,
    val confidence: Double? = null,
    val sourceText: String? = null,
    val bbox: BBox? = null,
)

data class ClinicalDoc(
    val documentType: DocumentType,
    val medications: List<Medication> = emptyList(),
    val labResults: List<LabResult> = emptyList(),
    /** Free-form uncertain items the model refused to guess (safe abstention). */
    val abstentions: List<String>? = null,
)

sealed class StageData {
    data class Image(val image: ImagePayload) : StageData()
    data class Text(
        val text: String,
        val spans: List<TextSpan>? = null,
        val image: ImagePayload? = null,
    ) : StageData()
    data class Fields(
        val doc: ClinicalDoc,
        val text: String? = null,
        val image: ImagePayload? = null,
    ) : StageData()

    val kind: String
        get() = when (this) {
            is Image -> "image"
            is Text -> "text"
            is Fields -> "fields"
        }
}

enum class StageKind(val wire: String) {
    OCR("ocr"),
    STRUCTURE("structure"),
    OCR_STRUCTURE("ocr+structure"),
    DEID("deid"),
    VERIFY("verify"),
    ROUTE("route"),
}

/**
 * Where the stage actually executed.
 * on_device/in_cloud mirror Firebase AI Logic's InferenceSource.
 */
enum class ExecutionSite(val wire: String) {
    ON_DEVICE("on_device"),
    IN_CLOUD("in_cloud"),
    LOCAL_CODE("local_code"),
    SERVER_GPU("server_gpu"),
    HUMAN("human"),
}

data class StageMetrics(
    val latencyMs: Double = 0.0,
    /** USD; 0 for on-device */
    val costUsd: Double = 0.0,
    /** UTF-8 bytes of payload that left the device for this stage (0 if on-device) */
    val bytesSent: Int = 0,
    val inputTokens: Int? = 0,
    val outputTokens: Int? = 0,
)

data class StageResult(
    val stageId: String,
    val stageKind: StageKind,
    val site: ExecutionSite,
    val output: StageData,
    /** Overall self/heuristic confidence 0..1 */
    val confidence: Double? = null,
    val metrics: StageMetrics,
    /** Model raw text, for audit */
    val raw: String? = null,
    val error: String? = null,
    val notes: List<String>? = null,
)

data class StageContext(
    val runId: String,
    val docId: String,
    val config: Map<String, Any?>? = null,
)

/**
 * Whether a stage may send a payload off the device.
 * Mirrors core stage meta (`runtime: "cloud"` / `sendsDataOffDevice`).
 * Every pipeline stage must declare [CLOUD] or [NONE].
 */
enum class StageEgress(val wire: String) {
    CLOUD("cloud"),
    NONE("none"),
}

interface Stage {
    val id: String
    val name: String
    val kind: StageKind
    val accepts: Set<String>
    /** Required. "cloud" if this stage can send data off-device, otherwise "none". */
    val egress: StageEgress
    suspend fun run(input: StageData, ctx: StageContext): StageResult
}

data class Pipeline(
    val id: String,
    val name: String,
    val stages: List<Stage>,
)

data class PipelineRun(
    val runId: String,
    val pipelineId: String,
    val docId: String,
    val startedAt: String,
    val steps: List<StageResult>,
    val final: StageData,
    val totals: StageMetrics,
    val failed: Boolean,
    val error: String? = null,
)

data class Reference(
    val docId: String,
    val text: String? = null,
    val doc: ClinicalDoc? = null,
    val rubrics: List<String>? = null,
)
