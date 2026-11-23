// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.medocr.hybrid.ui.AppScreen
import com.medocr.hybrid.ui.MedOcrViewModel
import com.medocr.hybrid.ui.UiState

@Composable
fun ConfirmScreen(state: UiState, viewModel: MedOcrViewModel, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        ReviewScreen(state, viewModel, Modifier.weight(1f), confirmOnly = true)
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(onClick = { viewModel.confirmAllVisible() }, modifier = Modifier.weight(1f)) {
                androidx.compose.material3.Text("Confirm remaining")
            }
            Button(onClick = { viewModel.go(AppScreen.RECEIPT) }, modifier = Modifier.weight(1f)) {
                androidx.compose.material3.Text("Go to receipt")
            }
        }
    }
}
