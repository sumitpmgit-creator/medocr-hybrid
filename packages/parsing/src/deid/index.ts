// SPDX-License-Identifier: Apache-2.0
/**
 * Browser-safe re-export of `@med-ocr/core` de-identification for apps/web
 * until it switches the import to core. Import this subpath
 * (`@med-ocr/parsing/deid`), not the package root — the root still
 * re-exports Node dataset loaders (`node:fs` / `node:path`).
 *
 * Core's public root index does not import Node builtins; those live on
 * `@med-ocr/core/node`.
 */
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
