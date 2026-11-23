// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.medocr.hybrid.receipt.FieldSource

@Composable
fun ConfidenceBadge(confidence: Double, modifier: Modifier = Modifier) {
    val color = when {
        confidence >= 0.85 -> Color(0xFF047857)
        confidence >= 0.5 -> Color(0xFFB45309)
        else -> Color(0xFFB91C1C)
    }
    Text(
        text = "${(confidence * 100).toInt()}%",
        color = Color.White,
        style = MaterialTheme.typography.labelMedium,
        modifier = modifier
            .background(color, RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

@Composable
fun SourceChip(source: FieldSource, modifier: Modifier = Modifier) {
    val label = when (source) {
        FieldSource.ON_DEVICE -> "on-device"
        FieldSource.IN_CLOUD -> "cloud"
        FieldSource.HYBRID -> "hybrid"
        FieldSource.HUMAN -> "human"
        FieldSource.MOCK -> "mock"
    }
    Text(
        text = label,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = modifier
            .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
