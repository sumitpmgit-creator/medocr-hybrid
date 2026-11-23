// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.medocr.hybrid.core.DEFAULT_THRESHOLDS
import com.medocr.hybrid.core.ImagePayload
import com.medocr.hybrid.core.PipelineRun
import com.medocr.hybrid.core.Reference
import com.medocr.hybrid.inference.AppInferenceMode
import com.medocr.hybrid.inference.MockLlmClient
import com.medocr.hybrid.inference.NanoAvailability
import com.medocr.hybrid.inference.NanoStatus
import com.medocr.hybrid.inference.SessionResult
import com.medocr.hybrid.inference.checkNanoStatus
import com.medocr.hybrid.inference.downloadNanoModel
import com.medocr.hybrid.inference.fallbackClient
import com.medocr.hybrid.inference.isFirebaseConfigured
import com.medocr.hybrid.inference.runSession
import com.medocr.hybrid.receipt.ReviewField
import com.medocr.hybrid.receipt.applyHumanEdit
import com.medocr.hybrid.receipt.confirmField
import java.io.ByteArrayOutputStream
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class AppScreen { CAPTURE, REVIEW, CONFIRM, RECEIPT, COMPARE }

data class UiState(
    val screen: AppScreen = AppScreen.CAPTURE,
    val mode: AppInferenceMode = AppInferenceMode.MOCK,
    val firebaseConfigured: Boolean = false,
    val nano: NanoStatus = NanoStatus(NanoAvailability.UNKNOWN, "Not checked yet."),
    val document: Bitmap? = null,
    val busy: Boolean = false,
    val status: String = "Capture or pick a document to begin. Mock inference is on, so this works without Firebase or Nano.",
    val session: SessionResult? = null,
    val review: List<ReviewField> = emptyList(),
    val error: String? = null,
    val usedMockFallback: Boolean = false,
    val referenceText: String = "",
)

class MedOcrViewModel(app: Application) : AndroidViewModel(app) {
    private val _state = MutableStateFlow(UiState(firebaseConfigured = isFirebaseConfigured()))
    val state: StateFlow<UiState> = _state

    init {
        refreshNano()
    }

    fun setMode(mode: AppInferenceMode) {
        _state.update { it.copy(mode = mode, status = if (mode == AppInferenceMode.MOCK) "Mock inference: no data leaves the device." else "Auto: try Firebase / Nano, fall back to mock if anything fails.") }
    }

    fun setReferenceText(text: String) {
        _state.update { it.copy(referenceText = text) }
    }

    fun go(screen: AppScreen) {
        _state.update { it.copy(screen = screen) }
    }

    fun refreshNano() {
        viewModelScope.launch {
            val status = withContext(Dispatchers.IO) { checkNanoStatus() }
            _state.update { it.copy(nano = status, firebaseConfigured = isFirebaseConfigured()) }
        }
    }

    fun prepareNano() {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, status = "Preparing on-device model…") }
            try {
                downloadNanoModel().collect { s ->
                    _state.update { it.copy(nano = s, status = s.message) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(status = "Prepare failed: ${e.message}", error = e.message) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    fun setDocument(bitmap: Bitmap) {
        _state.value.document?.takeIf { it != bitmap }?.recycleSafely()
        _state.update {
            it.copy(
                document = bitmap,
                session = null,
                review = emptyList(),
                error = null,
                status = "Document ready. Run extraction when you are.",
                screen = AppScreen.CAPTURE,
            )
        }
    }

    fun loadUri(uri: Uri) {
        viewModelScope.launch {
            val bmp = withContext(Dispatchers.IO) {
                getApplication<Application>().contentResolver.openInputStream(uri)?.use {
                    BitmapFactory.decodeStream(it)
                }
            }
            if (bmp != null) setDocument(bmp)
            else _state.update { it.copy(error = "Could not read that image.") }
        }
    }

    fun loadBytes(bytes: ByteArray) {
        viewModelScope.launch {
            val bmp = withContext(Dispatchers.IO) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
            if (bmp != null) setDocument(bmp)
            else _state.update { it.copy(error = "Could not decode the captured image.") }
        }
    }

    fun extract() {
        val bmp = _state.value.document
        if (bmp == null) {
            _state.update { it.copy(error = "Capture or pick a document first.") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, status = "Running on-device, cloud, and hybrid pipelines…") }
            try {
                val payload = withContext(Dispatchers.IO) { bmp.toJpegPayload() }
                val wantAuto = _state.value.mode == AppInferenceMode.AUTO
                val firebaseOk = isFirebaseConfigured()
                var client = fallbackClient(_state.value.mode, firebaseOk)
                var usedFallback = client is MockLlmClient && wantAuto
                val refText = _state.value.referenceText.trim().ifEmpty { null }
                val ref = refText?.let { Reference(docId = "upload", text = it) }
                var result = try {
                    withContext(Dispatchers.IO) { runSession(payload, client, DEFAULT_THRESHOLDS, ref) }
                } catch (e: Exception) {
                    if (client !is MockLlmClient) {
                        usedFallback = true
                        client = MockLlmClient()
                        withContext(Dispatchers.IO) { runSession(payload, client, DEFAULT_THRESHOLDS, ref) }
                    } else throw e
                }
                if (result.hybrid.failed && client !is MockLlmClient) {
                    usedFallback = true
                    result = withContext(Dispatchers.IO) { runSession(payload, MockLlmClient(), DEFAULT_THRESHOLDS, ref) }
                }
                val queue = result.review.count { it.needsConfirm }
                val status = buildString {
                    append("Done via ${result.clientLabel}.")
                    if (usedFallback) append(" Fell back to mock inference.")
                    append(" ${result.review.size} fields extracted.")
                    if (queue > 0) append(" $queue need your confirmation.")
                }
                _state.update {
                    it.copy(
                        session = result,
                        review = result.review,
                        busy = false,
                        status = status,
                        usedMockFallback = usedFallback,
                        screen = if (queue > 0) AppScreen.CONFIRM else AppScreen.REVIEW,
                        firebaseConfigured = firebaseOk,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message, status = "Extraction failed: ${e.message}") }
            }
        }
    }

    fun editField(path: String, value: String?) {
        _state.update { it.copy(review = applyHumanEdit(it.review, path, value)) }
    }

    fun confirm(path: String) {
        _state.update { it.copy(review = confirmField(it.review, path)) }
    }

    fun confirmAllVisible() {
        _state.update { s ->
            var list = s.review
            s.review.filter { it.needsConfirm }.forEach { list = confirmField(list, it.path) }
            s.copy(review = list)
        }
    }

    private fun Bitmap.recycleSafely() {
        try { if (!isRecycled) recycle() } catch (_: Exception) {}
    }
}

fun Bitmap.toJpegPayload(quality: Int = 85): ImagePayload {
    val stream = ByteArrayOutputStream()
    val ok = compress(Bitmap.CompressFormat.JPEG, quality, stream)
    check(ok) { "JPEG compress failed" }
    val bytes = stream.toByteArray()
    val b64 = Base64.getEncoder().encodeToString(bytes)
    return ImagePayload(mimeType = "image/jpeg", base64 = b64, width = width, height = height)
}
