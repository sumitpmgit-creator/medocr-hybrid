// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid

import android.app.Application
import com.google.firebase.FirebaseApp

class MedOcrApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        try {
            if (FirebaseApp.getApps(this).isEmpty()) {
                FirebaseApp.initializeApp(this)
            }
        } catch (_: Exception) {
            // No google-services.json / placeholder config: mock mode still works.
        }
    }
}
