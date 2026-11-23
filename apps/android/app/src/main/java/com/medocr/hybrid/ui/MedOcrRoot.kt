// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CompareArrows
import androidx.compose.material.icons.outlined.FactCheck
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.RateReview
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.medocr.hybrid.ui.screens.CaptureScreen
import com.medocr.hybrid.ui.screens.CompareScreen
import com.medocr.hybrid.ui.screens.ConfirmScreen
import com.medocr.hybrid.ui.screens.ReceiptScreen
import com.medocr.hybrid.ui.screens.ReviewScreen

@Composable
fun MedOcrRoot(viewModel: MedOcrViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val hasRun = state.session != null
    Scaffold(
        bottomBar = {
            if (hasRun) {
                NavigationBar {
                    NavItem("Capture", Icons.Outlined.CameraAlt, state.screen == AppScreen.CAPTURE) { viewModel.go(AppScreen.CAPTURE) }
                    NavItem("Review", Icons.Outlined.RateReview, state.screen == AppScreen.REVIEW) { viewModel.go(AppScreen.REVIEW) }
                    NavItem("Confirm", Icons.Outlined.FactCheck, state.screen == AppScreen.CONFIRM) { viewModel.go(AppScreen.CONFIRM) }
                    NavItem("Receipt", Icons.Outlined.PrivacyTip, state.screen == AppScreen.RECEIPT) { viewModel.go(AppScreen.RECEIPT) }
                    NavItem("Compare", Icons.Outlined.CompareArrows, state.screen == AppScreen.COMPARE) { viewModel.go(AppScreen.COMPARE) }
                }
            }
        },
    ) { padding ->
        val modifier = Modifier.padding(padding)
        when (state.screen) {
            AppScreen.CAPTURE -> CaptureScreen(state, viewModel, modifier)
            AppScreen.REVIEW -> ReviewScreen(state, viewModel, modifier, confirmOnly = false)
            AppScreen.CONFIRM -> ConfirmScreen(state, viewModel, modifier)
            AppScreen.RECEIPT -> ReceiptScreen(state, modifier)
            AppScreen.COMPARE -> CompareScreen(state, viewModel, modifier)
        }
    }
}

@Composable
private fun RowScope.NavItem(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, selected: Boolean, onClick: () -> Unit) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = { Icon(icon, contentDescription = label) },
        label = { Text(label) },
    )
}
