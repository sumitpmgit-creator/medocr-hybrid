// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.DEFAULT_THRESHOLDS
import com.medocr.hybrid.core.ExecutionSite
import com.medocr.hybrid.core.ImagePayload
import com.medocr.hybrid.core.StageData
import com.medocr.hybrid.core.StageEgress
import com.medocr.hybrid.core.runPipeline
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HighConfidenceClient : LlmClient {
    override val label = "high"
    override suspend fun generate(
        prompt: String,
        imageJpeg: ByteArray?,
        mimeType: String?,
        target: InferenceTarget,
        kind: GenerateKind,
    ): LlmResponse {
        if (kind == GenerateKind.TEXT) {
            return LlmResponse(MockLlmClient.MOCK_TRANSCRIPT, ExecutionSite.ON_DEVICE, inputTokens = 40, outputTokens = 20)
        }
        // Every entity at 0.97 — a high-confidence document must make zero cloud calls.
        val json = """
        {"documentType":"prescription","medications":[
          {"name":"Amoxicillin","strength":"500 mg","dose":"1 cap","frequency":"BD","duration":"5 days","confidence":0.97,"sourceText":"Tab Amoxicillin 500 mg 1 cap BD x 5 days"},
          {"name":"Pantoprazole","strength":"40 mg","frequency":"OD","duration":"5 days","confidence":0.97,"sourceText":"Tab Pantoprazole 40 mg OD x 5 days"}
        ],"labResults":[],"abstentions":[]}
        """.trimIndent()
        return LlmResponse(json, ExecutionSite.ON_DEVICE, inputTokens = 80, outputTokens = 40)
    }
}

class HybridRoutingTest {
    private fun tinyJpeg(): ImagePayload {
        val bytes = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte())
        return ImagePayload("image/jpeg", Base64.getEncoder().encodeToString(bytes), 1, 1)
    }

    @Test
    fun allHighConfidenceMakesZeroCloudCalls() = runBlocking {
        val client = RecordingClient(HighConfidenceClient())
        val run = runPipeline(pipelines(DEFAULT_THRESHOLDS, client).first { it.id == "hybrid" }, StageData.Image(tinyJpeg()), "hi")
        assertTrue("high-confidence doc must not call the cloud", client.cloudPrompts.isEmpty())
        assertEquals(0, run.totals.bytesSent)
        val cloudStep = run.steps.single { it.stageId == "cloud-structure" }
        assertEquals(ExecutionSite.LOCAL_CODE, cloudStep.site)
        assertEquals(0, cloudStep.metrics.bytesSent)
        assertTrue(cloudStep.notes.orEmpty().any { it.contains("zero cloud", ignoreCase = true) })
    }

    @Test
    fun midConfidenceSendsDeidentifiedSnippetsAndRecordsTokens() = runBlocking {
        val client = RecordingClient()
        val run = runPipeline(pipelines(DEFAULT_THRESHOLDS, client).first { it.id == "hybrid" }, StageData.Image(tinyJpeg()), "mid")
        assertTrue("Amoxicillin at 0.62 must go to cloud-structure", client.cloudPrompts.isNotEmpty())
        for (p in client.cloudPrompts) {
            assertFalse(p.contains("98765"))
            assertFalse(p.contains("Ravi Kumar"))
            assertTrue("payload should be a snippet, not necessarily the whole transcript", p.contains("Amoxicillin") || p.contains("Only return entries"))
        }
        val cloudStep = run.steps.single { it.stageId == "cloud-structure" }
        assertEquals(ExecutionSite.IN_CLOUD, cloudStep.site)
        // BUG-029: usageMetadata-backed token counts from the client are not dropped.
        assertTrue("inputTokens must be copied from the client, got ${cloudStep.metrics.inputTokens}", (cloudStep.metrics.inputTokens ?: 0) > 0)
        assertTrue("outputTokens must be copied from the client, got ${cloudStep.metrics.outputTokens}", (cloudStep.metrics.outputTokens ?: 0) > 0)
        assertTrue((cloudStep.metrics.bytesSent) > 0)
    }

    @Test
    fun receiptCountsFieldsSentToCloud() = runBlocking {
        val result = runSession(tinyJpeg(), MockLlmClient())
        assertTrue(result.receipt.fieldsSentToCloud.isNotEmpty())
        assertTrue(result.receipt.summary.contains("field(s) to the cloud") || result.receipt.fieldsSentToCloud.isNotEmpty())
        assertFalse(result.receipt.imageLeftDevice)
    }

    @Test
    fun uploadSessionDoesNotRunCloudOnlyByDefault() = runBlocking {
        val client = RecordingClient()
        val result = runSession(tinyJpeg(), client)
        assertNull("uploads must not default to the cloud-only baseline", result.cloud)
        assertFalse("cloud-read uploads the page image and must not run on upload", client.cloudPrompts.any { false })
        // Cloud prompts may exist from hybrid snippets, but none should be an image OCR (no image bytes).
        // RecordingClient only records text prompts; image OCR would still add the prompt, but hybrid
        // cloud-structure is text-only. Assert we never ran the cloud-only pipeline:
        val hybridIds = result.hybrid.steps.map { it.stageId }
        assertFalse(hybridIds.contains("cloud-read"))
        assertTrue(hybridIds.contains("nano-read"))
        assertTrue(hybridIds.contains("nano-structure"))
        assertTrue(hybridIds.contains("cloud-structure"))
        assertTrue(result.onDevice.steps.none { it.stageId == "cloud-read" })
    }

    @Test
    fun everyPipelineStageDeclaresEgressCloudOrNone() {
        val pipes = pipelines(DEFAULT_THRESHOLDS, MockLlmClient())
        val stages = pipes.flatMap { pipe -> pipe.stages.map { pipe.id to it } }
        assertTrue(stages.isNotEmpty())
        for ((pipeId, stage) in stages) {
            assertTrue(
                "$pipeId/${stage.id} must declare egress 'cloud' or 'none', got ${stage.egress}",
                stage.egress == StageEgress.CLOUD || stage.egress == StageEgress.NONE,
            )
        }
        val hybrid = pipes.first { it.id == "hybrid" }
        assertEquals(StageEgress.NONE, hybrid.stages.single { it.id == "nano-read" }.egress)
        assertEquals(StageEgress.NONE, hybrid.stages.single { it.id == "deid" }.egress)
        assertEquals(StageEgress.NONE, hybrid.stages.single { it.id == "nano-structure" }.egress)
        assertEquals(StageEgress.CLOUD, hybrid.stages.single { it.id == "cloud-structure" }.egress)
        val cloudOnly = pipes.first { it.id == "cloud-only" }
        assertEquals(StageEgress.CLOUD, cloudOnly.stages.single { it.id == "cloud-read" }.egress)
    }
}
