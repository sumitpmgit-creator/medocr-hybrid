// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

/**
 * READ_PROMPT is the on-device / cloud OCR instruction.
 *
 * Team decision (benchmarks/FINDINGS.md B3): on-device OCR must transcribe
 * verbatim. Do not mention [REDACTED] or ask the model to strip identifiers.
 * De-identification is a separate stage after OCR (packages/parsing/src/deid
 * and packages/core/src/deid.ts). CER is scored on the raw OCR output.
 *
 * STRUCTURE_PROMPT is still aligned with apps/web/src/stages.ts.
 */

const val READ_PROMPT: String =
    """Transcribe ALL text in this medical document image exactly as written, line by line, in reading order.
Do not correct spellings, do not expand abbreviations, do not add anything. Write [illegible] for unreadable words.
Do not redact, mask, or replace any names, phone numbers, identifiers, or other values."""

const val STRUCTURE_PROMPT: String =
    """Extract medications and lab results from this medical document transcript into the JSON schema.
Copy values exactly as written (e.g. "BD", "1-0-1", "625 mg"). Use null when a value is absent. Never guess:
if a value is unclear, set it to null, lower confidence, and add a note to "abstentions".
confidence is your probability (0-1) that every value in that entry is exactly right.
Transcript:
"""
