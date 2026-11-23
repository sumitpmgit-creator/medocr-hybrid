// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing

/**
 * Kotlin mirror of packages/parsing/src/extraction/prompt.ts.
 * Keep the prompt text byte-for-byte in sync with that file (aside from Kotlin quoting).
 */

/**
 * Single-turn user prompt sent to Gemini Nano with one document image.
 *
 * Keep this short: the prompt, the responseConstraint schema, the image, and
 * the model's JSON all share the on-device token window.
 *
 * Android note: Firebase AI Logic's Android hybrid get-started page
 * (https://firebase.google.com/docs/ai-logic/hybrid/android/get-started,
 * updated 2026-11-18) states a 4000-token on-device request limit, which is
 * tighter than the 9216-token window documented for the web hybrid path
 * (packages/parsing/src/extraction/constraints.ts NANO_MAX_TOKENS). The
 * prompt itself is short enough for either window.
 */
const val NANO_EXTRACTION_PROMPT: String =
    """Extract structured fields from this single medical document image.

Rules:
- Read only what is written. Do not infer, translate, normalize, convert units, compute lab flags, or substitute a generic name for a brand (or the reverse).
- If a field is missing or unreadable, set its value to null. Do not guess.
- Give every value field a confidence number from 0 to 1, including nulls. High confidence on null means you are sure the field is absent or unreadable.
- documentType must be exactly "prescription", "lab_report", or "other". Use "other" for discharge summaries, notes, forms, or unclear documents.
- medications: "name" is the drug as written. "dose", "frequency", and "duration" are also as written (for example "500 mg", "1-0-1", "5 days").
- labResults: "test", "value", "unit", and "referenceRange" as written.
- rawText is a plain transcription of useful visible text, or null if the image is unreadable.
- Use an empty array when there are no medications or no lab results.
- Return one JSON object only. No markdown fences and no commentary.

Required shape:
{
  "documentType": "prescription" | "lab_report" | "other",
  "documentTypeConfidence": 0-1,
  "rawText": string | null,
  "medications": [{
    "name": string | null, "nameConfidence": 0-1,
    "dose": string | null, "doseConfidence": 0-1,
    "frequency": string | null, "frequencyConfidence": 0-1,
    "duration": string | null, "durationConfidence": 0-1
  }],
  "labResults": [{
    "test": string | null, "testConfidence": 0-1,
    "value": string | null, "valueConfidence": 0-1,
    "unit": string | null, "unitConfidence": 0-1,
    "referenceRange": string | null, "referenceRangeConfidence": 0-1
  }]
}"""

/** Prompt used when low-confidence fields are re-read in the cloud. */
fun cloudRereadPrompt(paths: List<String>): String = buildString {
    appendLine("Re-read only these low-confidence fields from the medical document image:")
    paths.forEach { appendLine("- $it") }
    appendLine()
    appendLine("Follow the same rules and JSON shape as this extraction prompt.")
    appendLine("Fill every field; copy previous high-confidence values if you agree with them, and correct only the listed fields.")
    appendLine()
    append(NANO_EXTRACTION_PROMPT)
}
