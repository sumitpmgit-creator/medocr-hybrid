// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Teal = Color(0xFF0F766E)
private val TealDark = Color(0xFF115E59)
private val Mist = Color(0xFFF4F7F7)
private val Ink = Color(0xFF0F172A)
private val Danger = Color(0xFFB91C1C)

private val LightColors = lightColorScheme(
    primary = Teal,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCCFBF1),
    onPrimaryContainer = TealDark,
    secondary = Color(0xFF334155),
    background = Mist,
    surface = Color.White,
    onBackground = Ink,
    onSurface = Ink,
    error = Danger,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF5EEAD4),
    onPrimary = Color(0xFF042F2E),
    background = Color(0xFF0B1212),
    surface = Color(0xFF111827),
    onBackground = Color(0xFFE2E8F0),
    onSurface = Color(0xFFE2E8F0),
    error = Color(0xFFFCA5A5),
)

@Composable
fun MedOcrTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
