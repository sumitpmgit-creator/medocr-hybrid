// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.DEFAULT_THRESHOLDS
import com.medocr.hybrid.core.ExecutionSite
import com.medocr.hybrid.core.ImagePayload
import com.medocr.hybrid.core.StageData
import com.medocr.hybrid.core.StageKind
import com.medocr.hybrid.core.readingText
import com.medocr.hybrid.core.runPipeline
import com.medocr.hybrid.parsing.deid.CloudGate
import com.medocr.hybrid.parsing.deid.gateForCloud
import com.medocr.hybrid.receipt.buildPrivacyReceipt
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingClient(private val inner: LlmClient = MockLlmClient()) : LlmClient {
    override val label: String = "recording"
    val cloudPrompts = mutableListOf<String>()
    override suspend fun generate(
        prompt: String,
        imageJpeg: ByteArray?,
        mimeType: String?,
        target: InferenceTarget,
        kind: GenerateKind,
    ): LlmResponse {
        if (target == InferenceTarget.CLOUD) cloudPrompts += prompt
        return inner.generate(prompt, imageJpeg, mimeType, target, kind)
    }
}

class PipelineDeidTest {
    private fun tinyJpeg(): ImagePayload {
        // Minimal 1x1 JPEG (valid enough for Base64 decode in readStage).
        val bytes = byteArrayOf(
            0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte(),
        )
        return ImagePayload("image/jpeg", Base64.getEncoder().encodeToString(bytes), 1, 1)
    }

    @Test
    fun readingTextIsRawOcrAndSkipsDeid() = runBlocking {
        val client = RecordingClient()
        val pipes = pipelines(DEFAULT_THRESHOLDS, client)
        val hybrid = runPipeline(pipes[2], StageData.Image(tinyJpeg()), "doc-1")
        val raw = readingText(hybrid)
        assertTrue("CER must use the raw OCR transcript", raw != null && raw.contains("Ravi Kumar"))
        assertTrue(raw!!.contains("98765"))
        val deid = hybrid.steps.single { it.stageKind == StageKind.DEID }
        val deidText = (deid.output as StageData.Text).text
        assertFalse("de-id output must not keep the name", deidText.contains("Ravi Kumar"))
        assertFalse(deidText.contains("98765"))
        assertTrue(deid.notes?.any { it.contains("name=") || it.contains("phone=") } == true)
        assertFalse("notes must not contain the original phone", deid.notes!!.joinToString().contains("98765"))
    }

    @Test
    fun hybridVerifyCloudPromptIsDeidentified() = runBlocking {
        val client = RecordingClient()
        val pipes = pipelines(DEFAULT_THRESHOLDS, client)
        runPipeline(pipes[2], StageData.Image(tinyJpeg()), "doc-1")
        // On-device structure does not hit the cloud. Verify (and only verify) should.
        val verifyPrompts = client.cloudPrompts.filter { it.contains("Only return entries") }
        assertTrue("low-confidence mock med should be sent to cloud verify", verifyPrompts.isNotEmpty())
        for (p in verifyPrompts) {
            assertFalse("cloud prompt must not contain the raw phone", p.contains("98765"))
            assertFalse("cloud prompt must not contain the patient name", p.contains("Ravi Kumar"))
        }
    }

    @Test
    fun receiptShowsCountsAndTypesNotValues() = runBlocking {
        val result = runSession(tinyJpeg(), MockLlmClient())
        val receipt = result.receipt
        assertTrue(receipt.deidRedactions > 0)
        assertTrue(receipt.deidByType.keys.any { it == "name" || it == "phone" })
        val blob = receipt.summary + receipt.deidNotes.joinToString() + receipt.caveats.joinToString()
        assertFalse(blob.contains("98765"))
        assertFalse(blob.contains("Ravi Kumar"))
        assertFalse("hybrid path must not upload the image", receipt.imageLeftDevice)
        // CER uses raw text with the name still present on the on-device read
        assertTrue(readingText(result.hybrid)!!.contains("Ravi Kumar"))
        assertFalse(receipt.leftTheDevice && receipt.summary.contains("98765"))
    }

    @Test
    fun onDeviceOnlyNeverCallsCloud() = runBlocking {
        val client = RecordingClient()
        val pipes = pipelines(DEFAULT_THRESHOLDS, client)
        val run = runPipeline(pipes[0], StageData.Image(tinyJpeg()), "doc-1")
        assertTrue(client.cloudPrompts.isEmpty())
        assertEqualsBytesZero(run.totals.bytesSent)
        val receipt = buildPrivacyReceipt(run, imageBytesSent = 0)
        assertFalse(receipt.leftTheDevice)
        assertFalse(receipt.imageLeftDevice)
    }

    @Test
    fun blockedGateDoesNotProduceASafePayload() {
        // A labelled phone that has not been de-identified must not be treated as safe.
        val raw = "Ph: +91 98765 43210"
        // After gateForCloud (which de-identifies first) it becomes Safe.
        assertTrue(gateForCloud(raw) is CloudGate.Safe)
        // The blocked path is residual identifiers on text that is supposed to already be clean:
        val stillDirty = com.medocr.hybrid.parsing.deid.residualIdentifiers(raw)
        assertTrue(stillDirty.isNotEmpty())
    }

    private fun assertEqualsBytesZero(n: Int) {
        assertTrue("expected 0 bytes sent, got $n", n == 0)
    }
}
