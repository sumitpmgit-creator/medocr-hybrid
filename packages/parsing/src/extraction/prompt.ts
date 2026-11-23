// SPDX-License-Identifier: Apache-2.0
/**
 * Single-turn user prompt sent to Gemini Nano with one document image.
 *
 * Keep this short: the prompt, the responseConstraint schema, the image, and
 * the model's JSON all share the on-device 9216-token window.
 *
 * Intended Prompt API usage (no network call is made by this package):
 *
 *   const session = await LanguageModel.create({
 *     ...NANO_SESSION_OPTIONS,
 *   });
 *   const raw = await session.prompt(
 *     [{ role: "user", content: [
 *       { type: "text", value: NANO_EXTRACTION_PROMPT },
 *       { type: "image", value: imageBlob },
 *     ]}],
 *     { responseConstraint: NANO_RESPONSE_SCHEMA },
 *   );
 *
 * Firebase hybrid equivalent: PREFER_ON_DEVICE / ONLY_ON_DEVICE with the same
 * prompt plus one inline JPEG or PNG, and responseConstraint on onDeviceParams.
 */

export const NANO_EXTRACTION_PROMPT = `Extract structured fields from this single medical document image.

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
}`;
