// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing

/**
 * Kotlin mirror of packages/parsing/src/extraction/constraints.ts, plus
 * Android-specific on-device limits.
 *
 * The Android Nano request limit is the named constant [ANDROID_NANO_MAX_TOKENS]
 * (4000). Per-platform limits are documented in the repo CONTRACT
 * (`benchmarks/CONTRACT.md`, Nano token limits section).
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
 * Keep this as a named constant; do not inline 4000 at call sites.
 */
const val ANDROID_NANO_MAX_TOKENS = 4000

/** Official Prompt API expected-input / expected-output language tags (web mirror). */
val NANO_LANGUAGES = listOf("en", "ja", "es", "de", "fr")

/** Image MIME types Firebase documents as supported for on-device inference. */
val NANO_IMAGE_MIME_TYPES = listOf("image/jpeg", "image/png")

/**
 * Languages this demo validates for on-device inference: English only.
 *
 * Firebase's Android hybrid get-started page also lists Korean (`ko`) as a
 * validated on-device language; `ko` and other languages are supported later,
 * once the demo is extended past English.
 */
val ANDROID_VALIDATED_LANGUAGES = listOf("en")
