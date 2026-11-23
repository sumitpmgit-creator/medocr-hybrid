// SPDX-License-Identifier: Apache-2.0
import { findRedactions } from "./find.js";
import type { PhiSpan } from "./types.js";

export class UnsafeForCloudError extends Error {
  readonly findings: PhiSpan[];
  constructor(findings: PhiSpan[], sample: string) {
    const preview = findings
      .slice(0, 6)
      .map((f) => `${f.type}@${f.start}-${f.end} (${JSON.stringify(sample.slice(f.start, f.end))})`)
      .join("; ");
    super(`Text is not safe to send to the cloud: ${findings.length} residual identifier(s): ${preview}`);
    this.name = "UnsafeForCloudError";
    this.findings = findings;
  }
}

/**
 * Fail-closed guard. Throws if any de-identification pattern still matches.
 * Call after deidentify() (or on text that should already be clean) and
 * before a cloud request. Does not inspect images.
 */
export function assertSafeForCloud(text: string): void {
  const findings = findRedactions(text ?? "");
  if (findings.length > 0) {
    throw new UnsafeForCloudError(findings, text ?? "");
  }
}
