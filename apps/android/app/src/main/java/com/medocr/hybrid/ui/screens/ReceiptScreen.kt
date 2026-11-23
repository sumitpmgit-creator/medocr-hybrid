// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import com.medocr.hybrid.ui.UiState

@Composable
fun ReceiptScreen(state: UiState, modifier: Modifier = Modifier) {
    val receipt = state.session?.receipt
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Privacy receipt", style = MaterialTheme.typography.headlineSmall)
        if (receipt == null) {
            Text("Run an extraction first.")
            return
        }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(receipt.summary, style = MaterialTheme.typography.bodyLarge)
                Text("Bytes sent: ${receipt.totalBytesSent}")
                Text("Cost (USD): ${"%.5f".format(receipt.totalCostUsd)}")
                Text("Image left device: ${if (receipt.imageLeftDevice) "yes (${receipt.imageBytes} bytes)" else "no"}")
                Text("De-id removed: ${receipt.deidRedactions} identifier(s)")
                if (receipt.deidByType.isNotEmpty()) {
                    Text("By type (counts only): " + receipt.deidByType.entries.joinToString { "${it.key}=${it.value}" })
                }
                receipt.deidNotes.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        }
        receipt.entries.forEach { e ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${e.stageId} · ${e.site.wire}", style = MaterialTheme.typography.titleSmall)
                    Text(e.description)
                    Text("bytes=${e.bytesSent}  tokens in=${e.inputTokens ?: 0} out=${e.outputTokens ?: 0}  cost=${"%.5f".format(e.costUsd)}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Text("Caveats", style = MaterialTheme.typography.titleMedium)
        receipt.caveats.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
    }
}
