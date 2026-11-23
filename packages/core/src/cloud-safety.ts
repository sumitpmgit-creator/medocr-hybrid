// SPDX-License-Identifier: Apache-2.0
/**
 * Fail-closed cloud egress guard for the runners (BUG-005). Defence in depth: the privacy
 * guarantee must not live only in app stage code.
 *
 * Before a stage that sends data off the device runs (stage.meta.runtime === 'cloud' or
 * stage.meta.sendsDataOffDevice === true):
 *  1. a stage of kind 'deid' must already have completed earlier in the pipeline;
 *  2. raw image input is refused, and `image` is stripped from text/fields input;
 *  3. every string in the input must pass the injected `check` (default: deid.ts assertSafeForCloud).
 * Otherwise the stage does not run, the run fails, and the run record says why.
 * A stage may be exempted by id (explicit consent, e.g. a cloud-only baseline); that is recorded.
 *
 * Stages that do not declare egress cannot be gated in advance; if one reports site 'in_cloud' or
 * bytesSent > 0 it is 'undeclared_egress'. Policy `undeclaredEgress`:
 *  - 'warn' (current default): the run continues and record.privacyFlags says so;
 *  - 'fail': the stage is recorded as blocked, its output is discarded (nothing downstream sees it,
 *    no completed checkpoint is stored) and the run fails. The data has already left by then; 'fail'
 *    makes the leak loud and stops it from propagating, it cannot undo it.
 */
import type { Stage, StageData, StageResult } from './types.js';
import { describeStage } from './stage.js';
import { assertSafeForCloud, UnsafeForCloudError } from './deid.js';

/** Throws if `text` is not safe to send to the cloud. Must not include the offending values in its message. */
export type CloudSafetyCheck = (text: string) => void;

export type CloudSafetyBlockReason = 'no_deid_stage' | 'raw_image' | 'unsafe_text' | 'undeclared_egress';

export type UndeclaredEgressMode = 'warn' | 'fail';
export const DEFAULT_UNDECLARED_EGRESS: UndeclaredEgressMode = 'warn';

export class CloudSafetyError extends Error {
  constructor(readonly stageId: string, readonly reason: CloudSafetyBlockReason, detail: string) {
    super(`Cloud safety: refusing to run ${stageId} (${reason}): ${detail}`);
    this.name = 'CloudSafetyError';
  }
}

export interface CloudSafetyPolicy {
  /** Default true. false disables the guard entirely (recorded as 'disabled' on egress stages). */
  enabled?: boolean;
  /** Text check. Default: defaultCloudSafetyCheck. */
  check?: CloudSafetyCheck;
  /** Stage ids allowed to receive un-deidentified data (explicit, recorded consent). */
  exempt?: string[];
  /** Strip StageData.image before egress stages (default true). */
  stripImage?: boolean;
  /** Throw CloudSafetyError from the runner instead of returning a failed run (default false). */
  throwOnBlock?: boolean;
  /**
   * What to do when a stage that did not declare egress reports data leaving the device
   * (site 'in_cloud' or bytesSent > 0). Default DEFAULT_UNDECLARED_EGRESS. Exempt stages and a
   * disabled guard always only warn.
   */
  undeclaredEgress?: UndeclaredEgressMode;
}

/** Resolved undeclared-egress mode for a stage under a policy. */
export function undeclaredEgressMode(stage: Stage, policy: CloudSafetyPolicy = {}): UndeclaredEgressMode {
  if (policy.enabled === false || policy.exempt?.includes(stage.id)) return 'warn';
  return policy.undeclaredEgress ?? DEFAULT_UNDECLARED_EGRESS;
}

export type CloudSafetyDecision = 'passed' | 'exempt' | 'disabled' | 'blocked' | 'undeclared_egress';

export function isEgressStage(stage: Stage): boolean {
  const m = describeStage(stage);
  return m.runtime === 'cloud' || stage.meta?.sendsDataOffDevice === true;
}

/**
 * Default check: Rachel's fail-closed assertSafeForCloud() from deid.ts. Its UnsafeForCloudError
 * message quotes the offending text, so it is rethrown with identifier types and offsets only:
 * refusal messages end up in run records and logs and must not carry PHI.
 */
export const defaultCloudSafetyCheck: CloudSafetyCheck = (text) => {
  try {
    assertSafeForCloud(text);
  } catch (e) {
    if (e instanceof UnsafeForCloudError) {
      const kinds = [...new Set(e.findings.map((f) => f.type))].sort().join(', ');
      throw new Error(`text still contains ${e.findings.length} identifier(s): ${kinds}`);
    }
    throw e;
  }
};

/** Adapter: wrap any `assertSafeForCloud(text)` that throws when unsafe (Rachel's deid.ts API). */
export function fromAssertSafeForCloud(assertSafeForCloud: (text: string) => void): CloudSafetyCheck {
  return (text) => assertSafeForCloud(text);
}

/** Every string reachable in the payload that would leave the device (image excluded; handled separately). */
export function egressStrings(input: StageData): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v.trim()) out.push(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'image' && k !== 'bbox') walk(x);
  };
  if (input.kind === 'text') { walk(input.text); walk(input.spans); }
  else if (input.kind === 'fields') { walk(input.text); walk(input.doc); }
  return out;
}

/**
 * Decide whether `stage` may run on `input`. Returns the input to pass (image stripped) and the
 * decision, or throws CloudSafetyError.
 */
export function gateCloudStage(stage: Stage, input: StageData, deidCompleted: boolean, policy: CloudSafetyPolicy = {}): { input: StageData; decision: CloudSafetyDecision; imageStripped: boolean } {
  if (!isEgressStage(stage)) return { input, decision: 'passed', imageStripped: false };
  if (policy.enabled === false) return { input, decision: 'disabled', imageStripped: false };
  if (policy.exempt?.includes(stage.id)) return { input, decision: 'exempt', imageStripped: false };
  if (input.kind === 'image') throw new CloudSafetyError(stage.id, 'raw_image', 'a raw image cannot be de-identified; add an on-device reading + deid stage first, or exempt the stage explicitly');
  if (!deidCompleted) throw new CloudSafetyError(stage.id, 'no_deid_stage', 'no deid stage completed before this cloud stage');
  const check = policy.check ?? defaultCloudSafetyCheck;
  for (const s of egressStrings(input)) {
    try { check(s); } catch (e) { throw new CloudSafetyError(stage.id, 'unsafe_text', e instanceof Error ? e.message : String(e)); }
  }
  let imageStripped = false;
  let out: StageData = input;
  if ((policy.stripImage ?? true) && 'image' in input && input.image !== undefined) {
    const { image: _drop, ...rest } = input;
    out = rest as StageData;
    imageStripped = true;
  }
  return { input: out, decision: 'passed', imageStripped };
}

/** Post-hoc: a stage that did not declare egress but reports data leaving the device. */
export function isUndeclaredEgress(stage: Stage, result: StageResult): boolean {
  return !isEgressStage(stage) && (result.site === 'in_cloud' || (result.metrics.bytesSent ?? 0) > 0);
}
