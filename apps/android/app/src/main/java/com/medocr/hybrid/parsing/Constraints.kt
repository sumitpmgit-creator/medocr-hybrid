// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing

/**
 * Kotlin mirror of packages/parsing/src/extraction/constraints.ts.
 *
 * Android-specific overrides are documented in [ANDROID_NANO_MAX_TOKENS] and the README.
 * The web package recorded 9216 tokens from the Firebase hybrid *web* get-started guide.
 * The Android guide (updated 2026-11-18) states a 4000-token on-device request limit.
 *
 * https://firebase.google.com/docs/ai-logic/hybrid/android/get-started
 * https://firebase.google.com/docs/ai-logic/hybrid/android/generate-structured-output
 */

/** On-device context window stated in the Firebase hybrid web get-started guide (mirrored). */
const val NANO_MAX_TOKENS = 9216

/**
 * Tighter Android on-device request limit from
 * https://firebase.google.com/docs/ai-logic/hybrid/android/get-started (updated 2026-11-18):
 * "The maximum token limit for the entire on-device inference request is 4000 tokens."
 */
const val ANDROID_NANO_MAX_TOKENS = 4000

val NANO_LANGUAGES = listOf("en", "ja", "es", "de", "fr")

/** Image MIME types Firebase documents as supported for on-device inference. */
val NANO_IMAGE_MIME_TYPES = listOf("image/jpeg", "image/png")

/**
 * Android on-device inference has only been validated for English and Korean
 * (same Firebase Android hybrid get-started page). This is a mismatch with
 * NANO_LANGUAGES from the web Prompt API notes.
 */
val ANDROID_VALIDATED_LANGUAGES = listOf("en", "ko")
