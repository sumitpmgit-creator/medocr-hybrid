// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.DEFAULT_THRESHOLDS
import com.medocr.hybrid.core.RoutingThresholds

/** Firebase Remote Config keys (same names the web app reads). */
const val RC_ACCEPT_ON_DEVICE = "accept_on_device_threshold"
const val RC_HUMAN_REVIEW = "human_review_threshold"

/**
 * Load hybrid routing thresholds. Defaults are 0.85 / 0.5 (packages/core
 * DEFAULT_THRESHOLDS). When Firebase is configured, values come from Remote
 * Config; otherwise the defaults are used so tests and mock mode stay offline.
 */
fun loadThresholds(): RoutingThresholds {
    if (!isFirebaseConfigured()) return DEFAULT_THRESHOLDS
    return try {
        val clazz = Class.forName("com.google.firebase.remoteconfig.FirebaseRemoteConfig")
        val instance = clazz.getMethod("getInstance").invoke(null)
        val getDouble = clazz.getMethod("getDouble", String::class.java)
        val accept = (getDouble.invoke(instance, RC_ACCEPT_ON_DEVICE) as Double).let {
            if (it in 0.0..1.0 && it > 0.0) it else DEFAULT_THRESHOLDS.acceptOnDevice
        }
        val human = (getDouble.invoke(instance, RC_HUMAN_REVIEW) as Double).let {
            if (it in 0.0..1.0) it else DEFAULT_THRESHOLDS.humanReview
        }
        RoutingThresholds(acceptOnDevice = accept, humanReview = human)
    } catch (_: Exception) {
        DEFAULT_THRESHOLDS
    }
}
