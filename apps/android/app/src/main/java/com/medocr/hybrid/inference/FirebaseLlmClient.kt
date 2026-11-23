// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import android.graphics.BitmapFactory
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.FirebaseApp
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.ondevice.DownloadStatus
import com.google.firebase.ai.ondevice.FirebaseAIOnDevice
import com.google.firebase.ai.ondevice.OnDeviceModelStatus
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.medocr.hybrid.core.CLOUD_MODEL
import com.medocr.hybrid.core.billedOutputTokens
import com.medocr.hybrid.core.ExecutionSite
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

private const val TAG = "MedOcrFirebase"

fun isFirebaseConfigured(): Boolean = try {
    FirebaseApp.getInstance()
    true
} catch (_: Exception) {
    false
}

@OptIn(PublicPreviewAPI::class)
suspend fun checkNanoStatus(): NanoStatus {
    if (!isFirebaseConfigured()) {
        return NanoStatus(NanoAvailability.FIREBASE_MISSING, "Firebase is not configured. Copy google-services.json.template to app/google-services.json (Donna owns the real project), or stay in mock mode.")
    }
    return try {
        when (val status = FirebaseAIOnDevice.checkStatus()) {
            OnDeviceModelStatus.AVAILABLE ->
                NanoStatus(NanoAvailability.AVAILABLE, "Gemini Nano is available on this device via AICore.")
            OnDeviceModelStatus.DOWNLOADABLE ->
                NanoStatus(NanoAvailability.DOWNLOADABLE, "Gemini Nano can be downloaded on this device. Tap “Prepare on-device model”.")
            OnDeviceModelStatus.DOWNLOADING ->
                NanoStatus(NanoAvailability.DOWNLOADING, "Gemini Nano is downloading.")
            OnDeviceModelStatus.UNAVAILABLE ->
                NanoStatus(NanoAvailability.UNAVAILABLE, "Gemini Nano / AICore is not available on this device. Hybrid will fall back to mock or cloud.")
            else ->
                NanoStatus(NanoAvailability.UNKNOWN, "Unexpected on-device status: $status")
        }
    } catch (e: Exception) {
        Log.w(TAG, "checkStatus failed", e)
        NanoStatus(NanoAvailability.UNKNOWN, "Could not check Nano status: ${e.message}")
    }
}

@OptIn(PublicPreviewAPI::class)
fun downloadNanoModel(): Flow<NanoStatus> = flow {
    emit(NanoStatus(NanoAvailability.DOWNLOADING, "Starting Gemini Nano download…"))
    try {
        FirebaseAIOnDevice.download().collect { status ->
            when (status) {
                is DownloadStatus.DownloadStarted ->
                    emit(NanoStatus(NanoAvailability.DOWNLOADING, "Starting download — ${status.bytesToDownload} bytes", bytesTotal = status.bytesToDownload))
                is DownloadStatus.DownloadInProgress ->
                    emit(NanoStatus(NanoAvailability.DOWNLOADING, "Downloading… ${status.totalBytesDownloaded} bytes", bytesDownloaded = status.totalBytesDownloaded))
                is DownloadStatus.DownloadCompleted ->
                    emit(NanoStatus(NanoAvailability.AVAILABLE, "On-device model download complete."))
                is DownloadStatus.DownloadFailed ->
                    emit(NanoStatus(NanoAvailability.DOWNLOADABLE, "Download failed: $status"))
                else ->
                    emit(NanoStatus(NanoAvailability.DOWNLOADING, "Download status: $status"))
            }
        }
    } catch (e: Exception) {
        emit(NanoStatus(NanoAvailability.DOWNLOADABLE, "Download failed: ${e.message}"))
    }
}

/**
 * Real Firebase AI Logic client.
 *
 * Verified API names (docs updated 2026-11-18):
 *   Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
 *     modelName = CLOUD_MODEL,
 *     onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_ON_DEVICE | ONLY_IN_CLOUD),
 *   )
 *   result.response.inferenceSource  // ON_DEVICE or IN_CLOUD
 *
 * https://firebase.google.com/docs/ai-logic/hybrid/android/get-started
 * https://firebase.google.com/docs/ai-logic/hybrid/android/configuration-options
 */
class FirebaseLlmClient : LlmClient {
    override val label: String = "firebase"

    @OptIn(PublicPreviewAPI::class)
    override suspend fun generate(
        prompt: String,
        imageJpeg: ByteArray?,
        mimeType: String?,
        target: InferenceTarget,
        kind: GenerateKind,
    ): LlmResponse {
        if (!isFirebaseConfigured()) {
            return LlmResponse("", ExecutionSite.LOCAL_CODE, error = "Firebase is not configured")
        }
        val mode = when (target) {
            InferenceTarget.ON_DEVICE -> InferenceMode.ONLY_ON_DEVICE
            InferenceTarget.CLOUD -> InferenceMode.ONLY_IN_CLOUD
        }
        val config = if (kind == GenerateKind.JSON) {
            generationConfig { responseMimeType = "application/json" }
        } else {
            null
        }
        return try {
            val model = Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
                modelName = CLOUD_MODEL,
                generationConfig = config,
                onDeviceConfig = OnDeviceConfig(mode = mode),
            )
            val response = if (imageJpeg != null) {
                val bmp = BitmapFactory.decodeByteArray(imageJpeg, 0, imageJpeg.size)
                    ?: return LlmResponse("", ExecutionSite.LOCAL_CODE, error = "Could not decode document image")
                model.generateContent(
                    content {
                        image(bmp)
                        text(prompt)
                    },
                )
            } else {
                model.generateContent(prompt)
            }
            val site = when (response.inferenceSource) {
                InferenceSource.ON_DEVICE -> ExecutionSite.ON_DEVICE
                InferenceSource.IN_CLOUD -> ExecutionSite.IN_CLOUD
                else -> if (target == InferenceTarget.CLOUD) ExecutionSite.IN_CLOUD else ExecutionSite.ON_DEVICE
            }
            val text = response.text ?: ""
            val usage = response.usageMetadata
            // Kotlin SDK: UsageMetadata.thoughtsTokenCount — billed at the output rate.
            // https://firebase.google.com/docs/reference/kotlin/com/google/firebase/ai/type/UsageMetadata
            val candidates = usage?.candidatesTokenCount ?: 0
            val thoughts = usage?.thoughtsTokenCount ?: 0
            LlmResponse(
                text = text,
                site = site,
                inputTokens = usage?.promptTokenCount ?: 0,
                outputTokens = billedOutputTokens(candidates, thoughts),
                candidatesTokenCount = candidates,
                thoughtsTokenCount = thoughts,
            )
        } catch (e: Exception) {
            Log.e(TAG, "generate failed ($target $kind)", e)
            LlmResponse(
                text = "",
                site = if (target == InferenceTarget.CLOUD) ExecutionSite.IN_CLOUD else ExecutionSite.ON_DEVICE,
                error = e.message ?: e.toString(),
            )
        }
    }
}

fun fallbackClient(preferred: AppInferenceMode, firebaseOk: Boolean): LlmClient {
    return if (preferred == AppInferenceMode.MOCK || !firebaseOk) MockLlmClient() else FirebaseLlmClient()
}
