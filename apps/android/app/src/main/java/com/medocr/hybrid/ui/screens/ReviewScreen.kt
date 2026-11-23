// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.medocr.hybrid.receipt.ReviewField
import com.medocr.hybrid.ui.MedOcrViewModel
import com.medocr.hybrid.ui.UiState

@Composable
fun ReviewScreen(
    state: UiState,
    viewModel: MedOcrViewModel,
    modifier: Modifier = Modifier,
    confirmOnly: Boolean = false,
) {
    val rows = if (confirmOnly) state.review.filter { it.needsConfirm } else state.review
    Column(modifier = modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (confirmOnly) "Human confirm queue" else "Field review", style = MaterialTheme.typography.headlineSmall)
        Text(
            if (confirmOnly) {
                if (rows.isEmpty()) "Nothing left to confirm."
                else "These fields need a human check (disagreement or residual identifiers). Edit or confirm each one."
            } else "Each field shows a crop of the document, a confidence badge, and its source.",
            style = MaterialTheme.typography.bodyMedium,
        )
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxSize()) {
            items(rows, key = { it.path }) { field ->
                FieldCard(field, state, viewModel)
            }
        }
    }
}

@Composable
private fun FieldCard(field: ReviewField, state: UiState, viewModel: MedOcrViewModel) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                state.document?.let { bmp ->
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = "Document crop for ${field.label}",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.width(72.dp).height(72.dp),
                    )
                }
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(field.label, style = MaterialTheme.typography.titleSmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ConfidenceBadge(field.confidence)
                        SourceChip(field.source)
                        if (field.needsConfirm) Text("needs confirm", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            OutlinedTextField(
                value = field.value ?: "",
                onValueChange = { viewModel.editField(field.path, it) },
                label = { Text(field.path) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
