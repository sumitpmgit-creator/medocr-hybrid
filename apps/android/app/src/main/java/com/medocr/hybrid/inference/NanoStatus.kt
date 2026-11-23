// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

/**
 * On-device model availability, using the official Firebase AI Logic names from
 * https://firebase.google.com/docs/ai-logic/hybrid/android/get-started (updated 2026-11-18):
 *
 *   val status = FirebaseAIOnDevice.checkStatus()
 *   OnDeviceModelStatus.UNAVAILABLE | DOWNLOADABLE | DOWNLOADING | AVAILABLE
 *   FirebaseAIOnDevice.download() emits DownloadStatus.*
 */

enum class NanoAvailability {
    UNKNOWN,
    UNAVAILABLE,
    DOWNLOADABLE,
    DOWNLOADING,
    AVAILABLE,
    FIREBASE_MISSING,
}

data class NanoStatus(
    val availability: NanoAvailability,
    val message: String,
    val bytesDownloaded: Long? = null,
    val bytesTotal: Long? = null,
)
