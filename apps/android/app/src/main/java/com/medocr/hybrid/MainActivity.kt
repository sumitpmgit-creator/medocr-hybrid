// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.medocr.hybrid.ui.MedOcrRoot
import com.medocr.hybrid.ui.MedOcrViewModel
import com.medocr.hybrid.ui.theme.MedOcrTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MedOcrViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MedOcrTheme {
                MedOcrRoot(viewModel)
            }
        }
    }
}
