// SPDX-License-Identifier: Apache-2.0
/**
 * Type-only shim for `@med-ocr/parsing`.
 *
 * The package entry re-exports Node dataset loaders (`node:fs`, etc.) and
 * currently fails `tsc` on its own de-id counters. Web only needs the cloud
 * guard at runtime (Vite/pnpm still resolve the real workspace package).
 * This file is referenced from tsconfig paths so `tsc --noEmit` does not
 * typecheck parsing's Node-only graph.
 *
 * TODO: drop this shim and paths mapping once Louis lands the deid superset
 * on `@med-ocr/core` (or parsing's index stops exporting dataset tooling).
 */
export declare class UnsafeForCloudError extends Error {
  readonly findings: ReadonlyArray<{ type: string; start: number; end: number }>;
  constructor(findings: ReadonlyArray<{ type: string; start: number; end: number }>, sample: string);
}

export declare function assertSafeForCloud(text: string): void;
