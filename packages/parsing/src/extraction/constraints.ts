// SPDX-License-Identifier: Apache-2.0
/**
 * Documented Gemini Nano / Chrome Prompt API / Firebase AI Logic hybrid limits
 * that the on-device extraction prompt and schema were written against.
 *
 * These notes were taken from public docs on 2026-11-23. Nothing here was
 * verified by running against a real Gemini Nano session.
 *
 * Chrome Prompt API (page updated 2026-10-21):
 *   https://developer.chrome.com/docs/ai/prompt-api
 *   https://developer.chrome.com/docs/ai/structured-output-for-prompt-api
 *   https://developer.chrome.com/docs/modern-web-guidance/guides/built-in-ai/language-model
 *   https://github.com/webmachinelearning/prompt-api
 *
 * Firebase AI Logic hybrid for web (page updated 2026-11-18):
 *   https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
 *   https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output
 *   https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
 */

/** On-device context window stated in the Firebase hybrid web get-started guide. */
export const NANO_MAX_TOKENS = 9216;

/** Official Prompt API expected-input / expected-output language tags. */
export const NANO_LANGUAGES = ["en", "ja", "es", "de", "fr"] as const;

/** Image MIME types Firebase documents as supported for on-device inference. */
export const NANO_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;

/**
 * Session options for a single-turn text + one image Prompt API call.
 * Declare modalities at LanguageModel.create() time; pass the prompt text and
 * one image in the same prompt() content array. expectedOutputs is text only.
 */
export const NANO_SESSION_OPTIONS = {
  expectedInputs: [
    { type: "text", languages: ["en"] },
    { type: "image" },
  ],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
} as const;

/**
 * Pass the schema as a plain object (do not JSON.stringify it first).
 * The schema is also described in the prompt so callers can set
 * omitResponseConstraintInput: true if they want to save context-window tokens
 * (Chrome may otherwise inject the schema into the model input).
 *
 * Unsupported JSON Schema keywords throw NotSupportedError. This package
 * therefore avoids $ref, oneOf/anyOf/allOf, if/then, pattern, format, and
 * maxLength (Chrome warns that maxLength can yield nonsensical output).
 */
export const NANO_STRUCTURED_OUTPUT_NOTES = {
  responseConstraintProperty: "responseConstraint",
  passSchemaAsObject: true,
  structuredOutputSinceChrome: 137,
  /** Firebase hybrid on-device path: onDeviceParams.promptOptions.responseConstraint */
  firebaseOnDevicePath: "onDeviceParams.promptOptions.responseConstraint",
  /** Firebase hybrid cloud fallback path, not used by this package. */
  firebaseCloudPath: "inCloudParams.generationConfig.responseSchema",
} as const;
