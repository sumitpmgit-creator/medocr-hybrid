// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui.screens

import android.Manifest
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.medocr.hybrid.inference.AppInferenceMode
import com.medocr.hybrid.ui.MedOcrViewModel
import com.medocr.hybrid.ui.UiState
import java.util.concurrent.Executors

private const val TAG = "MedOcrCamera"

@Composable
fun CaptureScreen(state: UiState, viewModel: MedOcrViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var showCamera by remember { mutableStateOf(false) }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) viewModel.loadUri(uri)
    }
    val cameraPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        showCamera = granted
    }
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("MedOCR Hybrid", style = MaterialTheme.typography.headlineSmall)
        Text(state.status, style = MaterialTheme.typography.bodyMedium)
        if (state.error != null) Text(state.error, color = MaterialTheme.colorScheme.error)
        Text("Inference", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = state.mode == AppInferenceMode.MOCK, onClick = { viewModel.setMode(AppInferenceMode.MOCK) }, label = { Text("Mock") })
            FilterChip(selected = state.mode == AppInferenceMode.AUTO, onClick = { viewModel.setMode(AppInferenceMode.AUTO) }, label = { Text("Auto (Nano / cloud)") })
        }
        Text(
            "Nano: ${state.nano.message}" + if (state.firebaseConfigured) "" else "  Firebase config is not present; stay on mock or add app/google-services.json.",
            style = MaterialTheme.typography.bodySmall,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { viewModel.prepareNano() }, enabled = !state.busy) { Text("Prepare Nano") }
            OutlinedButton(onClick = { viewModel.refreshNano() }, enabled = !state.busy) { Text("Recheck") }
        }
        if (showCamera) {
            CameraPane(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(280.dp),
                onCapture = { bytes ->
                    showCamera = false
                    viewModel.loadBytes(bytes)
                },
                onClose = { showCamera = false },
            )
        } else {
            state.document?.let { bmp ->
                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = "Document preview",
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(240.dp),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                    if (granted) showCamera = true else cameraPerm.launch(Manifest.permission.CAMERA)
                }) { Text("Camera") }
                OutlinedButton(onClick = {
                    gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }) { Text("Gallery") }
            }
        }
        OutlinedTextField(
            value = state.referenceText,
            onValueChange = viewModel::setReferenceText,
            label = { Text("Optional reference transcript (for CER)") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 2,
        )
        Button(
            onClick = { viewModel.extract() },
            enabled = !state.busy && state.document != null,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (state.busy) "Running…" else "Extract (on-device, cloud, hybrid)") }
    }
}

@Composable
private fun CameraPane(modifier: Modifier, onCapture: (ByteArray) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val imageCapture = remember { ImageCapture.Builder().build() }
    DisposableEffect(Unit) { onDispose { executor.shutdown() } }
    Column(modifier) {
        AndroidView(
            modifier = Modifier
                .fillMaxWidth()
                .height(220.dp),
            factory = { ctx ->
                PreviewView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    val providerFuture = ProcessCameraProvider.getInstance(ctx)
                    providerFuture.addListener({
                        val provider = providerFuture.get()
                        val preview = Preview.Builder().build().also { it.setSurfaceProvider(surfaceProvider) }
                        provider.unbindAll()
                        provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                    }, ContextCompat.getMainExecutor(ctx))
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            Button(onClick = {
                imageCapture.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
                    override fun onCaptureSuccess(image: ImageProxy) {
                        val bmp = image.toBitmapRotated()
                        image.close()
                        val stream = java.io.ByteArrayOutputStream()
                        bmp.compress(Bitmap.CompressFormat.JPEG, 90, stream)
                        onCapture(stream.toByteArray())
                    }
                    override fun onError(exception: ImageCaptureException) {
                        Log.e(TAG, "capture failed", exception)
                    }
                })
            }) { Text("Take photo") }
            OutlinedButton(onClick = onClose) { Text("Close camera") }
        }
    }
}

private fun ImageProxy.toBitmapRotated(): Bitmap {
    val bmp = this.toBitmap()
    val degrees = imageInfo.rotationDegrees
    if (degrees == 0) return bmp
    val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
    return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, matrix, true)
}
