// SPDX-License-Identifier: Apache-2.0
/**
 * Resumable pipeline runner (spec §5 "03 RUN BENCHMARK: checkpoints, retry"). Same semantics as
 * `runPipeline` (keeps every intermediate output, stops at the first failure, returns the partial
 * trace) plus:
 *  - each stage's result is checkpointed with a hash of its input and its version;
 *  - on resume, a stage is reused when a completed checkpoint exists with the same input hash and
 *    stage version; failed or invalidated stages rerun, and so does everything downstream of them;
 *  - retries with backoff, an optional per-stage timeout, AbortSignal honoured throughout;
 *  - a RunRecord with per-stage status, timings, attempts and errors.
 */
import type { Pipeline, PipelineRun, Stage, StageData, StageMetrics, StageResult } from './types.js';
import { emptyMetrics, newRunId } from './pipeline.js';
import { describeStage } from './stage.js';
import { NORMALIZATION_VERSION } from './normalize.js';
import { CloudSafetyError, gateCloudStage, isUndeclaredEgress, type CloudSafetyDecision, type CloudSafetyPolicy } from './cloud-safety.js';
import { assertSerializable, hashValue, toSerializable } from './hash.js';
import { CHECKPOINT_SCHEMA_VERSION, checkpointKey, type AttemptRecord, type CheckpointRecord, type CheckpointStore } from './checkpoint.js';

export const RUN_RECORD_SCHEMA_VERSION = 1;

/** timed_out = the last attempt hit `timeoutMs`; checkpointed as a failure, so a resumed run retries it. */
export type StageRunStatus = 'executed' | 'reused' | 'failed' | 'timed_out' | 'aborted' | 'blocked' | 'skipped';

/** Why a stage was (re)executed instead of reused. */
export type RerunReason = 'no_checkpoint' | 'previous_failure' | 'input_changed' | 'version_changed' | 'upstream_rerun' | 'forced' | 'no_store';

export interface StageRunRecord {
  index: number;
  stageId: string;
  stageVersion: string;
  runtime: string;
  inputHash?: string;
  outputHash?: string;
  status: StageRunStatus;
  rerunReason?: RerunReason;
  /** runId that originally produced a reused checkpoint */
  reusedFromRunId?: string;
  attempts: AttemptRecord[];
  durationMs: number;
  error?: string;
  /** Cloud egress guard outcome (BUG-005); absent for stages that neither declare nor show egress */
  cloudSafety?: CloudSafetyDecision;
  blockedReason?: string;
  /** StageData.image was removed before this egress stage */
  imageStripped?: boolean;
}

export interface RunRecord {
  schemaVersion: number;
  runId: string;
  pipelineId: string;
  docId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stages: StageRunRecord[];
  executed: number;
  reused: number;
  /** Attempts beyond the first, across all stages */
  retries: number;
  failed: boolean;
  aborted: boolean;
  error?: string;
  /** Human-readable privacy flags, e.g. undeclared egress or exempted stages */
  privacyFlags: string[];
}

export interface ResumableRun extends PipelineRun { record: RunRecord }

export interface ResumableRunOptions {
  docId: string;
  runId?: string;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Monotonic ms clock for durations (default performance.now / Date.now). */
  now?: () => number;
  /** Wall clock for ISO timestamps (default () => new Date()). */
  clock?: () => Date;
  store?: CheckpointStore;
  /** Extra attempts after the first failure (default 0). Not applied to aborts. */
  retries?: number | ((stage: Stage) => number);
  /** Delay before retry n (1-based). Default 0. */
  retryDelayMs?: number | ((attempt: number) => number);
  sleep?: (ms: number) => Promise<void>;
  /** Per-stage timeout; the stage's signal is aborted and the attempt fails with timedOut. */
  timeoutMs?: number;
  /** Stage ids to rerun regardless of checkpoints, or true to ignore all checkpoints. */
  force?: string[] | boolean;
  /**
   * After a stage executes, downstream stages: 'rerun' (default, always rerun them) or 'hash'
   * (reuse them if their input hash still matches, e.g. a rerun produced identical output).
   */
  downstream?: 'rerun' | 'hash';
  /** Fail-closed cloud egress guard (BUG-005). On by default; see cloud-safety.ts. */
  cloudSafety?: CloudSafetyPolicy;
}

function addMetrics(a: StageMetrics, b: StageMetrics): StageMetrics {
  return {
    latencyMs: a.latencyMs + b.latencyMs,
    costUsd: a.costUsd + b.costUsd,
    bytesSent: a.bytesSent + b.bytesSent,
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
  };
}

/**
 * Hash that decides checkpoint reuse. Includes the run config, the stage's model/fingerprint and
 * normalize.ts's NORMALIZATION_VERSION, so results produced under different normalisation rules
 * are never mixed in one resumed run.
 */
export function stageInputHash(stage: Stage, input: StageData, config?: Record<string, unknown>): string {
  const m = describeStage(stage);
  return hashValue({ stageId: stage.id, input, config: config ?? null, model: m.model ?? null, fingerprint: m.fingerprint ?? null, normalizationVersion: NORMALIZATION_VERSION });
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown, signal?: AbortSignal) => signal?.aborted === true || (e instanceof Error && e.name === 'AbortError');

export async function runPipelineResumable(pipeline: Pipeline, input: StageData, opts: ResumableRunOptions): Promise<ResumableRun> {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const clock = opts.clock ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const runId = opts.runId ?? newRunId(pipeline.id);
  const startedAt = clock().toISOString();
  const t0Run = now();
  const store = opts.store;
  const steps: StageResult[] = [];
  const records: StageRunRecord[] = [];
  let current = input;
  let totals = emptyMetrics();
  let upstreamExecuted = false;
  let failure: { error: string; aborted: boolean } | undefined;
  let deidCompleted = false;
  const privacyFlags: string[] = [];

  for (let index = 0; index < pipeline.stages.length; index++) {
    const stage = pipeline.stages[index]!;
    const meta = describeStage(stage);
    const base = { index, stageId: stage.id, stageVersion: meta.version, runtime: meta.runtime };

    if (failure) { records.push({ ...base, status: 'skipped', attempts: [], durationMs: 0 }); continue; }

    if (!stage.accepts.includes(current.kind)) {
      const error = `Stage ${stage.id} does not accept input kind "${current.kind}"`;
      records.push({ ...base, status: 'failed', attempts: [], durationMs: 0, error });
      failure = { error, aborted: false };
      continue;
    }

    // ---- cloud egress guard (before hashing: the hash covers what the stage actually receives)
    let gate: ReturnType<typeof gateCloudStage>;
    try {
      gate = gateCloudStage(stage, current, deidCompleted, opts.cloudSafety);
    } catch (e) {
      if (!(e instanceof CloudSafetyError)) throw e;
      if (opts.cloudSafety?.throwOnBlock) throw e;
      records.push({ ...base, status: 'blocked', attempts: [], durationMs: 0, error: e.message, cloudSafety: 'blocked', blockedReason: e.reason });
      privacyFlags.push(`blocked ${stage.id}: ${e.reason}`);
      failure = { error: e.message, aborted: false };
      continue;
    }
    if (gate.decision === 'exempt') privacyFlags.push(`exempt ${stage.id}: received data without the cloud safety check`);
    if (gate.decision === 'disabled') privacyFlags.push(`cloud safety disabled for ${stage.id}`);
    const egress = gate.decision !== 'passed' || gate.imageStripped || stage.meta?.runtime === 'cloud' || stage.meta?.sendsDataOffDevice === true;
    const safety = egress ? { cloudSafety: gate.decision, ...(gate.imageStripped ? { imageStripped: true } : {}) } : {};
    current = gate.input;

    const inputHash = stageInputHash(stage, current, opts.config);
    const key = checkpointKey(pipeline.id, opts.docId, index, stage.id);

    // ---- reuse decision
    let reason: RerunReason | undefined;
    let prev: CheckpointRecord | undefined;
    const forced = opts.force === true || (Array.isArray(opts.force) && opts.force.includes(stage.id));
    if (!store) reason = 'no_store';
    else if (forced) reason = 'forced';
    else if (upstreamExecuted && (opts.downstream ?? 'rerun') === 'rerun') reason = 'upstream_rerun';
    else {
      prev = await store.get(key);
      if (!prev || prev.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) reason = 'no_checkpoint';
      else if (prev.status !== 'completed') reason = 'previous_failure';
      else if (prev.stageVersion !== meta.version) reason = 'version_changed';
      else if (prev.inputHash !== inputHash) reason = 'input_changed';
    }

    if (!reason && prev) {
      const res = prev.result;
      steps.push(res);
      totals = addMetrics(totals, res.metrics);
      records.push({ ...base, inputHash, outputHash: prev.outputHash, status: 'reused', reusedFromRunId: prev.runId, attempts: [], durationMs: 0 });
      if (stage.kind === 'deid') deidCompleted = true;
      current = res.output;
      continue;
    }

    // ---- execute with retries
    upstreamExecuted = true;
    const maxRetries = Math.max(0, typeof opts.retries === 'function' ? opts.retries(stage) : opts.retries ?? 0);
    const attempts: AttemptRecord[] = [];
    let result: StageResult | undefined;
    let lastError = '';
    let aborted = false;
    const tStage = now();
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      if (attempt > 1) {
        const d = typeof opts.retryDelayMs === 'function' ? opts.retryDelayMs(attempt - 1) : opts.retryDelayMs ?? 0;
        if (d > 0) await sleep(d);
      }
      if (opts.signal?.aborted) { aborted = true; lastError = `aborted before ${stage.id}`; break; }
      const aStart = clock().toISOString();
      const ta = now();
      const ctrl = new AbortController();
      const onParentAbort = () => ctrl.abort(opts.signal?.reason);
      opts.signal?.addEventListener('abort', onParentAbort, { once: true });
      let timedOut = false;
      const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; ctrl.abort(new Error(`timeout after ${opts.timeoutMs} ms`)); }, opts.timeoutMs) : undefined;
      try {
        // Race against our signal so a stage that ignores AbortSignal cannot hang the runner.
        const res = await Promise.race([
          stage.run(current, { runId, docId: opts.docId, config: opts.config, signal: ctrl.signal }),
          new Promise<never>((_, rej) => {
            if (ctrl.signal.aborted) rej(ctrl.signal.reason);
            ctrl.signal.addEventListener('abort', () => rej(Object.assign(new Error(timedOut ? `Stage ${stage.id} timed out after ${opts.timeoutMs} ms` : `Stage ${stage.id} aborted`), { name: timedOut ? 'TimeoutError' : 'AbortError' })), { once: true });
          }),
        ]);
        const dur = now() - ta;
        if (!res.metrics.latencyMs) res.metrics = { ...res.metrics, latencyMs: dur };
        if (res.error) {
          lastError = res.error;
          attempts.push({ attempt, startedAt: aStart, durationMs: dur, error: res.error });
          result = res;
          continue;
        }
        assertSerializable(res);
        result = toSerializable(res);
        attempts.push({ attempt, startedAt: aStart, durationMs: dur });
        lastError = '';
        break;
      } catch (e) {
        const dur = now() - ta;
        lastError = errMsg(e);
        const wasAbort = !timedOut && isAbort(e, opts.signal);
        attempts.push({ attempt, startedAt: aStart, durationMs: dur, error: lastError, ...(wasAbort ? { aborted: true } : {}), ...(timedOut ? { timedOut: true } : {}) });
        result = undefined;
        if (wasAbort) { aborted = true; break; }
      } finally {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onParentAbort);
      }
    }
    const durationMs = now() - tStage;

    if (lastError || !result) {
      const err = lastError || `Stage ${stage.id} produced no result`;
      const failed: StageResult = result ?? { stageId: stage.id, stageKind: stage.kind, site: 'local_code', output: current, metrics: { ...emptyMetrics(), latencyMs: durationMs }, error: err };
      steps.push(failed);
      totals = addMetrics(totals, failed.metrics);
      records.push({ ...base, inputHash, status: aborted ? 'aborted' : attempts.at(-1)?.timedOut ? 'timed_out' : 'failed', rerunReason: reason, attempts, durationMs, error: err, ...safety });
      if (store && !aborted) {
        await store.put({ schemaVersion: CHECKPOINT_SCHEMA_VERSION, key, pipelineId: pipeline.id, docId: opts.docId, stageIndex: index, stageId: stage.id, stageVersion: meta.version, inputHash, status: 'failed', result: toSerializable({ ...failed, error: err }), attempts, runId, finishedAt: clock().toISOString() });
      }
      failure = { error: err, aborted };
      continue;
    }

    const outputHash = hashValue(result.output);
    steps.push(result);
    totals = addMetrics(totals, result.metrics);
    let safetyRec: Partial<StageRunRecord> = safety;
    if (isUndeclaredEgress(stage, result)) {
      safetyRec = { cloudSafety: 'undeclared_egress' };
      privacyFlags.push(`undeclared egress from ${stage.id} (site ${result.site}, ${result.metrics.bytesSent} bytes): declare meta.runtime 'cloud' so the guard can run first`);
    }
    if (stage.kind === 'deid') deidCompleted = true;
    records.push({ ...base, inputHash, outputHash, status: 'executed', rerunReason: reason, attempts, durationMs, ...safetyRec });
    if (store) {
      await store.put({ schemaVersion: CHECKPOINT_SCHEMA_VERSION, key, pipelineId: pipeline.id, docId: opts.docId, stageIndex: index, stageId: stage.id, stageVersion: meta.version, inputHash, outputHash, status: 'completed', result, attempts, runId, finishedAt: clock().toISOString() });
    }
    current = result.output;
  }

  const finishedAt = clock().toISOString();
  const record: RunRecord = {
    schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    runId, pipelineId: pipeline.id, docId: opts.docId, startedAt, finishedAt,
    durationMs: now() - t0Run,
    stages: records,
    executed: records.filter((r) => r.status === 'executed').length,
    reused: records.filter((r) => r.status === 'reused').length,
    retries: records.reduce((a, r) => a + Math.max(0, r.attempts.length - 1), 0),
    failed: !!failure,
    aborted: failure?.aborted ?? false,
    ...(failure ? { error: failure.error } : {}),
    privacyFlags,
  };
  return { runId, pipelineId: pipeline.id, docId: opts.docId, startedAt, steps, final: current, totals, failed: !!failure, ...(failure ? { error: failure.error } : {}), record };
}
