// SPDX-License-Identifier: Apache-2.0
/**
 * Fail-closed cloud egress guard for the runners (BUG-005). Defence in depth: the privacy
 * guarantee must not live only in app stage code.
 *
 * Before a stage that sends data off the device runs (stage.meta.runtime === 'cloud' or
 * stage.meta.sendsDataOffDevice === true):
 *  1. a stage of kind 'deid' must already have completed earlier in the pipeline;
 *  2. raw image input is refused, and `image` is stripped from text/fields input;
 *  3. every string in the input must pass the injected `check` (throws if unsafe).
 * Otherwise the stage does not run, the run fails, and the run record says why.
 * A stage may be exempted by id (explicit consent, e.g. a cloud-only baseline); that is recorded.
 *
 * Stages that do not declare egress cannot be gated in advance; if one reports site 'in_cloud' or
 * bytesSent > 0 the run record flags it as 'undeclared_egress'.
 */
import type { Stage, StageData, StageResult } from './types.js';
import { describeStage } from './stage.js';
import { deidentify } from './deid.js';

/** Throws if `text` is not safe to send to the cloud. Must not include the offending values in its message. */
export type CloudSafetyCheck = (text: string) => void;

export type CloudSafetyBlockReason = 'no_deid_stage' | 'raw_image' | 'unsafe_text';

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
}

export type CloudSafetyDecision = 'passed' | 'exempt' | 'disabled' | 'blocked' | 'undeclared_egress';

export function isEgressStage(stage: Stage): boolean {
  const m = describeStage(stage);
  return m.runtime === 'cloud' || stage.meta?.sendsDataOffDevice === true;
}

/**
 * Interim default check using core's deidentify(): text is safe only if the de-identifier finds
 * nothing left to redact. When Rachel's deid.ts with assertSafeForCloud() lands, switch the default
 * to `fromAssertSafeForCloud(assertSafeForCloud)`.
 */
export const defaultCloudSafetyCheck: CloudSafetyCheck = (text) => {
  const r = deidentify(text);
  if (r.total > 0) {
    const kinds = Object.entries(r.redactions).filter(([, n]) => (n ?? 0) > 0).map(([k, n]) => `${k}×${n}`).join(', ');
    throw new Error(`text still contains identifiers (${kinds})`);
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
