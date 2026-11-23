// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.medocr.hybrid.receipt.ModeScore
import com.medocr.hybrid.ui.MedOcrViewModel
import com.medocr.hybrid.ui.UiState

@Composable
fun CompareScreen(state: UiState, viewModel: MedOcrViewModel, modifier: Modifier = Modifier) {
    val report = state.session?.comparison
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("On-device vs cloud vs hybrid", style = MaterialTheme.typography.headlineSmall)
        if (report == null) {
            Text("Run an extraction first.")
            return
        }
        Text(report.disclaimer, style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            report.modes.forEach { mode ->
                ModeCard(mode, Modifier.weight(1f))
            }
        }
        if (state.usedMockFallback) {
            Text("This comparison used mock inference (Nano or Firebase was unavailable).", color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun ModeCard(mode: ModeScore, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(mode.mode, style = MaterialTheme.typography.titleMedium)
            Text("CER vs ref: ${fmtRate(mode.cerVsReference)}")
            Text("CER vs cloud: ${fmtRate(mode.cerVsCloud)}")
            Text("Field F1: ${fmtRate(mode.fieldF1)}")
            Text("Latency: ${mode.latencyMs.toInt()} ms")
            Text("Bytes sent: ${mode.bytesSent}")
            Text("Cost (USD): ${"%.5f".format(mode.costUsd)}")
            Text(mode.note, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun fmtRate(n: Double?): String = if (n == null) "—" else "${"%.1f".format(n * 100)}%"
