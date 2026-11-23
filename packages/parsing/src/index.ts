// Public exports for @med-ocr/parsing. Each module adds its own export line.
// De-identification and clinical normalization now live in @med-ocr/core and
// are re-exported here for Node consumers (QA, scripts). Web should import
// assertSafeForCloud from "@med-ocr/parsing/deid" until it switches to
// @med-ocr/core — the package root also re-exports Node dataset loaders
// (`node:fs` / `node:path`).
export * from "./extraction/index.js";
export * from "./datasets/index.js";
export {
  PLACEHOLDERS,
  UnsafeForCloudError,
  assertSafeForCloud,
  deidentify,
  utf8Bytes,
  type DeidResult,
  type PhiSpan,
  type PhiType,
} from "@med-ocr/core";
