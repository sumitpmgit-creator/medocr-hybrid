// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.CLOUD_MODEL
import com.medocr.hybrid.core.ClinicalDoc
import com.medocr.hybrid.core.DocumentType
import com.medocr.hybrid.core.ExecutionSite
import com.medocr.hybrid.core.Pipeline
import com.medocr.hybrid.core.RouteDecision
import com.medocr.hybrid.core.RoutingThresholds
import com.medocr.hybrid.core.Stage
import com.medocr.hybrid.core.StageContext
import com.medocr.hybrid.core.StageData
import com.medocr.hybrid.core.StageEgress
import com.medocr.hybrid.core.StageKind
import com.medocr.hybrid.core.StageMetrics
import com.medocr.hybrid.core.StageResult
import com.medocr.hybrid.core.displayCostUsd
import com.medocr.hybrid.core.reconcileLab
import com.medocr.hybrid.core.reconcileMedication
import com.medocr.hybrid.core.routeDoc
import com.medocr.hybrid.core.utf8Bytes
import com.medocr.hybrid.parsing.deid.CloudGate
import com.medocr.hybrid.parsing.deid.deidentify
import com.medocr.hybrid.parsing.deid.gateForCloud
import com.medocr.hybrid.parsing.deid.redactionCounts
import com.medocr.hybrid.parsing.deid.residualSummary
import java.util.Base64

/**
 * Pipeline stages. Order: read (verbatim OCR) → deid (on-device) → structure
 * → optional cloud verify. CER uses the first OCR stage (readingText skips
 * deid). Every cloud *text* call is gated by gateForCloud / assertSafeForCloud.
 */

private fun decodeImage(base64: String): ByteArray = Base64.getDecoder().decode(base64)

private fun usageMetrics(
    site: ExecutionSite,
    prompt: String,
    imageBytes: Int,
    inputTokens: Int,
    outputTokens: Int,
    latencyMs: Double,
): StageMetrics {
    val leftDevice = site == ExecutionSite.IN_CLOUD
    val bytes = if (leftDevice) utf8Bytes(prompt) + imageBytes else 0
    val (cost, _) = if (leftDevice) displayCostUsd(CLOUD_MODEL, inputTokens, outputTokens) else 0.0 to false
    return StageMetrics(
        latencyMs = latencyMs,
        costUsd = cost,
        bytesSent = bytes,
        inputTokens = inputTokens,
        outputTokens = outputTokens,
    )
}

fun readStage(id: String, name: String, target: InferenceTarget, client: LlmClient): Stage =
    object : Stage {
        override val id = id
        override val name = name
        override val kind = StageKind.OCR
        override val accepts = setOf("image")
        override val egress = if (target == InferenceTarget.CLOUD) StageEgress.CLOUD else StageEgress.NONE
        override suspend fun run(input: StageData, ctx: StageContext): StageResult {
            val image = (input as? StageData.Image)?.image
                ?: throw IllegalArgumentException("image required")
            val jpeg = decodeImage(image.base64)
            val t0 = System.currentTimeMillis()
            val r = client.generate(READ_PROMPT, jpeg, image.mimeType, target, GenerateKind.TEXT)
            val latency = (System.currentTimeMillis() - t0).toDouble()
            if (r.error != null) {
                return StageResult(
                    stageId = id, stageKind = kind, site = r.site,
                    output = input, metrics = StageMetrics(latencyMs = latency), raw = r.text, error = r.error,
                )
            }
            val site = if (target == InferenceTarget.CLOUD) ExecutionSite.IN_CLOUD else r.site
            return StageResult(
                stageId = id,
                stageKind = kind,
                site = site,
                output = StageData.Text(text = r.text, image = image),
                raw = r.text,
                metrics = usageMetrics(site, READ_PROMPT, jpeg.size, r.inputTokens, r.outputTokens, latency),
            )
        }
    }

/** On-device de-identification. Records counts and types, never the raw values. */
fun deidStage(): Stage = object : Stage {
    override val id = "deid"
    override val name = "De-identify (on-device)"
    override val kind = StageKind.DEID
    override val accepts = setOf("text")
    override val egress = StageEgress.NONE
    override suspend fun run(input: StageData, ctx: StageContext): StageResult {
        val textIn = input as? StageData.Text ?: throw IllegalArgumentException("text required")
        val t0 = System.currentTimeMillis()
        val result = deidentify(textIn.text)
        val counts = redactionCounts(result.redactions)
        val notes = if (result.redactions.isEmpty()) {
            listOf("No identifiers removed.")
        } else {
            listOf(
                "Removed ${result.redactions.size} identifier(s): " +
                    counts.entries.joinToString(", ") { "${it.key.wire}=${it.value}" },
            )
        }
        return StageResult(
            stageId = id,
            stageKind = kind,
            site = ExecutionSite.LOCAL_CODE,
            output = StageData.Text(text = result.text, spans = textIn.spans, image = textIn.image),
            notes = notes,
            metrics = StageMetrics(latencyMs = (System.currentTimeMillis() - t0).toDouble(), costUsd = 0.0, bytesSent = 0),
        )
    }
}

fun structureStage(id: String, name: String, target: InferenceTarget, client: LlmClient): Stage =
    object : Stage {
        override val id = id
        override val name = name
        override val kind = StageKind.STRUCTURE
        override val accepts = setOf("text")
        override val egress = if (target == InferenceTarget.CLOUD) StageEgress.CLOUD else StageEgress.NONE
        override suspend fun run(input: StageData, ctx: StageContext): StageResult {
            val textIn = input as? StageData.Text ?: throw IllegalArgumentException("text required")
            val t0 = System.currentTimeMillis()
            if (target == InferenceTarget.CLOUD) {
                when (val gate = gateForCloud(textIn.text)) {
                    is CloudGate.Blocked -> {
                        val summary = residualSummary(gate.findings)
                        return StageResult(
                            stageId = id,
                            stageKind = kind,
                            site = ExecutionSite.LOCAL_CODE,
                            output = StageData.Fields(
                                doc = ClinicalDoc(
                                    documentType = DocumentType.OTHER,
                                    abstentions = listOf("HUMAN CONFIRM all fields: cloud structure skipped ($summary). Nothing was sent."),
                                ),
                                text = textIn.text,
                                image = textIn.image,
                            ),
                            notes = listOf("Cloud call blocked: $summary. Fields stayed local and were queued for human confirm."),
                            metrics = StageMetrics(latencyMs = (System.currentTimeMillis() - t0).toDouble(), costUsd = 0.0, bytesSent = 0),
                        )
                    }
                    is CloudGate.Safe -> {
                        val prompt = STRUCTURE_PROMPT + gate.text
                        val r = client.generate(prompt, null, null, target, GenerateKind.JSON)
                        val latency = (System.currentTimeMillis() - t0).toDouble()
                        if (r.error != null) {
                            return StageResult(
                                stageId = id, stageKind = kind, site = ExecutionSite.IN_CLOUD,
                                output = input, metrics = StageMetrics(latencyMs = latency), raw = r.text, error = r.error,
                            )
                        }
                        val doc = parseClinicalDoc(r.text)
                        return StageResult(
                            stageId = id,
                            stageKind = kind,
                            site = ExecutionSite.IN_CLOUD,
                            output = StageData.Fields(doc = doc, text = textIn.text, image = textIn.image),
                            raw = r.text,
                            metrics = usageMetrics(ExecutionSite.IN_CLOUD, prompt, 0, r.inputTokens, r.outputTokens, latency),
                        )
                    }
                }
            }
            val prompt = STRUCTURE_PROMPT + textIn.text
            val r = client.generate(prompt, null, null, target, GenerateKind.JSON)
            val latency = (System.currentTimeMillis() - t0).toDouble()
            if (r.error != null) {
                return StageResult(
                    stageId = id, stageKind = kind, site = r.site,
                    output = input, metrics = StageMetrics(latencyMs = latency), raw = r.text, error = r.error,
                )
            }
            val doc = parseClinicalDoc(r.text)
            return StageResult(
                stageId = id,
                stageKind = kind,
                site = r.site,
                output = StageData.Fields(doc = doc, text = textIn.text, image = textIn.image),
                raw = r.text,
                metrics = usageMetrics(r.site, prompt, 0, r.inputTokens, r.outputTokens, latency),
            )
        }
    }


/**
 * Window of de-identified source text around a mid-confidence field value,
 * sent to cloud-structure instead of the full transcript (BUG-026).
 */
internal fun snippetAround(text: String, needle: String?, radius: Int = 180): String? {
    if (needle.isNullOrBlank()) return null
    val idx = text.indexOf(needle, ignoreCase = true)
    if (idx < 0) return needle
    val start = (idx - radius).coerceAtLeast(0)
    val endIdx = (idx + needle.length + radius).coerceAtMost(text.length)
    return text.substring(start, endIdx).trim()
}

/**
 * BUG-026 hybrid routing stage. Nano has already read and extracted fields
 * on-device. Fields with confidence >= acceptOnDevice stay local. Fields in
 * [humanReview, acceptOnDevice) are sent to the cloud as de-identified, gated
 * text snippets. Fields below humanReview go to the human-confirm queue and
 * never leave the device. A document whose fields all score high makes zero
 * cloud calls. Metrics include usageMetadata token counts (BUG-029).
 */
fun hybridCloudStructureStage(thresholds: RoutingThresholds, client: LlmClient): Stage =
    object : Stage {
        override val id = "cloud-structure"
        override val name = "Cloud structure (de-identified snippets, mid-confidence only)"
        override val kind = StageKind.STRUCTURE
        override val accepts = setOf("fields")
        override val egress = StageEgress.CLOUD

        override suspend fun run(input: StageData, ctx: StageContext): StageResult {
            val fields = input as? StageData.Fields ?: throw IllegalArgumentException("fields required")
            val t0 = System.currentTimeMillis()
            val source = fields.text ?: ""
            val routed = routeDoc(fields.doc, source, thresholds)
            val notes = mutableListOf<String>()
            val meds = fields.doc.medications.toMutableList()
            val labs = fields.doc.labResults.toMutableList()
            val abstentions = (fields.doc.abstentions ?: emptyList()).toMutableList()

            fun queueHuman(reason: String, medIdx: List<Int>, labIdx: List<Int>) {
                for (i in medIdx) {
                    abstentions += "HUMAN CONFIRM medication \"${meds[i].name}\": $reason"
                }
                for (i in labIdx) {
                    abstentions += "HUMAN CONFIRM lab \"${labs[i].test}\": $reason"
                }
            }

            val humanMeds = routed.meds.filter { it.decision == RouteDecision.HUMAN_CONFIRM }
            val humanLabs = routed.labs.filter { it.decision == RouteDecision.HUMAN_CONFIRM }
            queueHuman("confidence below ${thresholds.humanReview}", humanMeds.map { it.index }, humanLabs.map { it.index })

            val midMeds = routed.meds.filter { it.decision == RouteDecision.SEND_TO_CLOUD }
            val midLabs = routed.labs.filter { it.decision == RouteDecision.SEND_TO_CLOUD }

            fun localResult(extraNotes: List<String> = emptyList()): StageResult {
                val doc = ClinicalDoc(fields.doc.documentType, meds, labs, abstentions)
                return StageResult(
                    stageId = id,
                    stageKind = kind,
                    site = ExecutionSite.LOCAL_CODE,
                    output = StageData.Fields(doc = doc, text = fields.text, image = fields.image),
                    notes = notes + extraNotes + "fieldsSentToCloud: ${routed.toCloud}",
                    metrics = StageMetrics(latencyMs = (System.currentTimeMillis() - t0).toDouble(), costUsd = 0.0, bytesSent = 0, inputTokens = 0, outputTokens = 0),
                )
            }

            if (midMeds.isEmpty() && midLabs.isEmpty()) {
                val msg = if (humanMeds.isEmpty() && humanLabs.isEmpty()) {
                    "All fields accepted on-device; zero cloud calls."
                } else {
                    "No mid-confidence fields to send; ${routed.toHuman} queued for human confirm. Zero cloud calls."
                }
                notes += msg
                return localResult()
            }

            val snippets = buildList {
                for (m in midMeds) {
                    snippetAround(source, m.entity.name)?.let { add(it) }
                    snippetAround(source, m.entity.sourceText)?.let { add(it) }
                }
                for (l in midLabs) {
                    snippetAround(source, l.entity.test)?.let { add(it) }
                    snippetAround(source, l.entity.sourceText)?.let { add(it) }
                }
            }.distinct()
            val payload = snippets.joinToString("\n---\n").ifBlank { midMeds.joinToString("\n") { it.entity.name } }

            when (val gate = gateForCloud(payload)) {
                is CloudGate.Blocked -> {
                    val summary = residualSummary(gate.findings)
                    notes += "Cloud call blocked: $summary. Mid-confidence fields stayed local."
                    queueHuman("residual identifiers, cloud skipped", midMeds.map { it.index }, midLabs.map { it.index })
                    return localResult()
                }
                is CloudGate.Safe -> {
                    notes += "De-identified ${gate.deid.total} identifier(s) in snippets: " +
                        redactionCounts(gate.deid.redactions).entries.joinToString(", ") { "${it.key.wire}=${it.value}" }.ifEmpty { "none" }
                    val subset = buildString {
                        append("{\"medications\":[")
                        append(midMeds.joinToString(",") { "\"${it.entity.name}\"" })
                        append("],\"labResults\":[")
                        append(midLabs.joinToString(",") { "\"${it.entity.test}\"" })
                        append("]}")
                    }
                    val prompt = STRUCTURE_PROMPT + gate.text + "\n\nOnly return entries for these items: " + subset
                    val r = client.generate(prompt, null, null, InferenceTarget.CLOUD, GenerateKind.JSON)
                    val latency = (System.currentTimeMillis() - t0).toDouble()
                    if (r.error != null) {
                        notes += "Cloud structure failed: ${r.error}. Fields stayed local."
                        queueHuman("cloud structure failed", midMeds.map { it.index }, midLabs.map { it.index })
                        return localResult()
                    }
                    val cloud = parseClinicalDoc(r.text)
                    for (m in midMeds) {
                        val rec = reconcileMedication(
                            m.entity,
                            cloud.medications.find { it.name.equals(m.entity.name, ignoreCase = true) },
                            thresholds,
                        )
                        meds[m.index] = rec.value
                        if (rec.decision == RouteDecision.HUMAN_CONFIRM) {
                            abstentions += "HUMAN CONFIRM medication \"${m.entity.name}\": ${rec.disagreements.joinToString(", ").ifEmpty { "low confidence" }}"
                        }
                    }
                    for (l in midLabs) {
                        val rec = reconcileLab(
                            l.entity,
                            cloud.labResults.find { it.test.equals(l.entity.test, ignoreCase = true) },
                            thresholds,
                        )
                        labs[l.index] = rec.value
                        if (rec.decision == RouteDecision.HUMAN_CONFIRM) {
                            abstentions += "HUMAN CONFIRM lab \"${l.entity.test}\": ${rec.disagreements.joinToString(", ").ifEmpty { "low confidence" }}"
                        }
                    }
                    notes += "Sent ${routed.toCloud} field(s) to the cloud as de-identified snippets."
                    notes += "fieldsSentToCloud: ${routed.toCloud}"
                    val doc = ClinicalDoc(fields.doc.documentType, meds, labs, abstentions)
                    return StageResult(
                        stageId = id,
                        stageKind = kind,
                        site = ExecutionSite.IN_CLOUD,
                        output = StageData.Fields(doc = doc, text = fields.text, image = fields.image),
                        raw = r.text,
                        notes = notes,
                        // BUG-029: copy usageMetadata-backed token counts from the client.
                        metrics = usageMetrics(ExecutionSite.IN_CLOUD, prompt, 0, r.inputTokens, r.outputTokens, latency),
                    )
                }
            }
        }
    }

fun hybridVerifyStage(thresholds: RoutingThresholds, client: LlmClient): Stage =
    hybridCloudStructureStage(thresholds, client)

fun pipelines(thresholds: RoutingThresholds, client: LlmClient): List<Pipeline> = listOf(
    Pipeline(
        id = "on-device-only",
        name = "On-device only (Nano)",
        stages = listOf(
            readStage("nano-read", "Gemini Nano read (on-device)", InferenceTarget.ON_DEVICE, client),
            deidStage(),
            structureStage("nano-structure", "Gemini Nano structure (on-device)", InferenceTarget.ON_DEVICE, client),
        ),
    ),
    Pipeline(
        id = "cloud-only",
        name = "Cloud only ($CLOUD_MODEL)",
        stages = listOf(
            // Cloud OCR still uploads the document image; de-id cannot inspect pixels.
            readStage("cloud-read", "Cloud read (full image)", InferenceTarget.CLOUD, client),
            deidStage(),
            structureStage("cloud-structure", "Cloud structure", InferenceTarget.CLOUD, client),
        ),
    ),
    Pipeline(
        id = "hybrid",
        name = "Hybrid (Nano extract + mid-confidence cloud-structure snippets)",
        stages = listOf(
            readStage("nano-read", "Gemini Nano read (on-device)", InferenceTarget.ON_DEVICE, client),
            deidStage(),
            structureStage("nano-structure", "Gemini Nano structure (on-device)", InferenceTarget.ON_DEVICE, client),
            hybridCloudStructureStage(thresholds, client),
        ),
    ),
)
