// SPDX-License-Identifier: Apache-2.0
/**
 * Stage capabilities, registry and adapters. Every model (Gemini Nano, Firebase AI Logic,
 * PaddleOCR, Qwen, Surya, Tesseract...) is a `Stage`; this file adds what a benchmark portal
 * needs on top of design.md §2: version, runtime, model identity, cost/latency hints, a registry
 * of factories, and a vendor-neutral adapter for stages served over HTTP/JSON.
 *
 * Core never imports a vendor SDK. Vendor code lives in the app (apps/web/src/stages.ts) or in a
 * server, and reaches core either as a `Stage` object or through `createRemoteStage` with an
 * injected `fetch`.
 */
import type { ClinicalDoc, ExecutionSite, Stage, StageContext, StageData, StageKind, StageMetrics, StageResult, TextSpan } from './types.js';
import { assertSerializable, toSerializable } from './hash.js';

/** Where a stage runs. `local-oss` = an open-source model on our own CPU/GPU (PaddleOCR, Qwen, Surya). */
export type StageRuntime = 'device' | 'cloud' | 'local-oss' | 'code' | 'human';

export interface CostHint {
  /** Fixed USD per call (e.g. amortised GPU time) */
  usdPerCall?: number;
  usdPerMTokInput?: number;
  usdPerMTokOutput?: number;
  usdPerPage?: number;
  /** 'actual' bills vs 'estimate' (GPU-hour assumptions), per spec §H */
  basis?: 'actual' | 'estimate';
}

export interface LatencyHint { p50Ms?: number; p95Ms?: number; coldStartMs?: number }

export interface ModelInfo {
  /** e.g. 'paddleocr', 'qwen', 'gemini' */
  family?: string;
  /** e.g. 'PaddleOCR-VL-1.6', 'Qwen3.5-4B', 'gemini-3.5-flash-lite' */
  name?: string;
  /** Weights revision / HF commit sha */
  revision?: string;
  quantization?: 'fp32' | 'fp16' | 'bf16' | 'int8' | 'int4' | string;
  license?: string;
}

export interface StageMeta {
  id: string;
  version: string;
  name: string;
  kind: StageKind;
  runtime: StageRuntime;
  inputs: StageData['kind'][];
  outputs: StageData['kind'][];
  model?: ModelInfo;
  cost?: CostHint;
  latency?: LatencyHint;
  /** Same input + version + config → same output (temperature 0, fixed seed...). */
  deterministic?: boolean;
  /** Payload leaves the device (counts toward bytesSent / privacy budget). */
  sendsDataOffDevice?: boolean;
  /**
   * Extra material that changes output and should invalidate checkpoints (prompt text hash,
   * decoding settings). Folded into the checkpoint input hash.
   */
  fingerprint?: string;
}

/** What a Stage may declare in `stage.meta` (everything optional; `describeStage` fills defaults). */
export type StageMetaInput = Partial<Omit<StageMeta, 'id' | 'kind' | 'inputs'>>;

const SITE_FOR_RUNTIME: Record<StageRuntime, ExecutionSite> = {
  device: 'on_device', cloud: 'in_cloud', 'local-oss': 'server_gpu', code: 'local_code', human: 'human',
};

export function runtimeToSite(r: StageRuntime): ExecutionSite { return SITE_FOR_RUNTIME[r]; }

const DEFAULT_OUTPUTS: Record<StageKind, StageData['kind'][]> = {
  ocr: ['text'], structure: ['fields'], 'ocr+structure': ['fields'], deid: ['text', 'fields'], verify: ['fields'], route: ['fields'],
};

/** Full metadata for any Stage, including legacy ones that declare no `version`/`meta`. */
export function describeStage(stage: Stage): StageMeta {
  const m = stage.meta ?? {};
  return {
    id: stage.id,
    name: m.name ?? stage.name,
    kind: stage.kind,
    version: stage.version ?? m.version ?? '0',
    runtime: m.runtime ?? 'code',
    inputs: [...stage.accepts],
    outputs: m.outputs ?? DEFAULT_OUTPUTS[stage.kind],
    ...(m.model ? { model: m.model } : {}),
    ...(m.cost ? { cost: m.cost } : {}),
    ...(m.latency ? { latency: m.latency } : {}),
    ...(m.deterministic !== undefined ? { deterministic: m.deterministic } : {}),
    ...(m.sendsDataOffDevice !== undefined ? { sendsDataOffDevice: m.sendsDataOffDevice } : { sendsDataOffDevice: m.runtime === 'cloud' }),
    ...(m.fingerprint ? { fingerprint: m.fingerprint } : {}),
  };
}

export class StageAbortedError extends Error {
  constructor(readonly stageId: string, reason?: unknown) {
    super(`Stage ${stageId} aborted${reason instanceof Error ? `: ${reason.message}` : typeof reason === 'string' ? `: ${reason}` : ''}`);
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined, stageId: string): void {
  if (signal?.aborted) throw new StageAbortedError(stageId, signal.reason);
}

/** What a `defineStage` body returns; stageId/kind/site/metrics are filled in for it. */
export interface StageOutput {
  output: StageData;
  confidence?: number;
  raw?: string;
  notes?: string[];
  metrics?: Partial<StageMetrics>;
  /** Override the declared runtime's site (e.g. Firebase AI Logic hybrid fell back to cloud). */
  site?: ExecutionSite;
}

export interface StageDefinition {
  id: string;
  version: string;
  name?: string;
  kind: StageKind;
  runtime: StageRuntime;
  inputs: StageData['kind'][];
  outputs?: StageData['kind'][];
  model?: ModelInfo;
  cost?: CostHint;
  latency?: LatencyHint;
  deterministic?: boolean;
  sendsDataOffDevice?: boolean;
  fingerprint?: string;
  run(input: StageData, ctx: StageContext): Promise<StageOutput>;
}

export class StageContractError extends Error {
  constructor(stageId: string, msg: string) { super(`Stage ${stageId}: ${msg}`); this.name = 'StageContractError'; }
}

/**
 * Build a Stage from a definition. The wrapper enforces the contract every adapter needs:
 * input kind check, AbortSignal honoured before and after the body, output kind ∈ outputs,
 * output is plain serialisable JSON (deep-copied canonically so results are deterministic).
 */
export function defineStage(def: StageDefinition): Stage {
  const outputs = def.outputs ?? DEFAULT_OUTPUTS[def.kind];
  const meta: StageMetaInput = {
    version: def.version, name: def.name ?? def.id, runtime: def.runtime, outputs,
    model: def.model, cost: def.cost, latency: def.latency, deterministic: def.deterministic,
    sendsDataOffDevice: def.sendsDataOffDevice ?? def.runtime === 'cloud', fingerprint: def.fingerprint,
  };
  return {
    id: def.id,
    name: def.name ?? def.id,
    kind: def.kind,
    accepts: [...def.inputs],
    version: def.version,
    meta,
    async run(input, ctx) {
      if (!def.inputs.includes(input.kind)) throw new StageContractError(def.id, `does not accept input kind "${input.kind}"`);
      throwIfAborted(ctx.signal, def.id);
      const out = await def.run(input, ctx);
      throwIfAborted(ctx.signal, def.id);
      if (!outputs.includes(out.output.kind)) throw new StageContractError(def.id, `returned "${out.output.kind}", declared outputs are ${outputs.join(', ')}`);
      const result: StageResult = {
        stageId: def.id,
        stageKind: def.kind,
        site: out.site ?? runtimeToSite(def.runtime),
        output: out.output,
        metrics: { latencyMs: 0, costUsd: 0, bytesSent: 0, ...out.metrics },
        ...(out.confidence !== undefined ? { confidence: out.confidence } : {}),
        ...(out.raw !== undefined ? { raw: out.raw } : {}),
        ...(out.notes ? { notes: out.notes } : {}),
      };
      try { assertSerializable(result); } catch (e) { throw new StageContractError(def.id, (e as Error).message); }
      return toSerializable(result);
    },
  };
}

/** A registered stage type. `create(config)` returns a configured Stage instance. */
export interface StageFactory<C = unknown> {
  meta: Omit<StageMeta, 'version'> & { version: string };
  create(config: C): Stage;
}

export interface StageQuery { runtime?: StageRuntime; kind?: StageKind; accepts?: StageData['kind']; produces?: StageData['kind'] }

/** Modular model registry (spec §4): one adapter per candidate, consistent metadata, lookup by id. */
export class StageRegistry {
  private factories = new Map<string, StageFactory<never>>();

  register<C>(factory: StageFactory<C>, opts: { replace?: boolean } = {}): this {
    const id = factory.meta.id;
    if (this.factories.has(id) && !opts.replace) throw new Error(`Stage "${id}" is already registered`);
    this.factories.set(id, factory as StageFactory<never>);
    return this;
  }

  /** Register a ready-made Stage instance (config-free). */
  registerStage(stage: Stage, opts: { replace?: boolean } = {}): this {
    return this.register({ meta: describeStage(stage), create: () => stage }, opts);
  }

  has(id: string): boolean { return this.factories.has(id); }

  get(id: string): StageFactory<unknown> | undefined { return this.factories.get(id) as StageFactory<unknown> | undefined; }

  create<C = unknown>(id: string, config?: C): Stage {
    const f = this.factories.get(id);
    if (!f) throw new Error(`Unknown stage "${id}". Registered: ${[...this.factories.keys()].sort().join(', ') || '(none)'}`);
    return (f as StageFactory<C | undefined>).create(config);
  }

  /** Metadata of registered stages, sorted by id, optionally filtered. */
  list(q: StageQuery = {}): StageFactory<unknown>['meta'][] {
    return [...this.factories.values()].map((f) => f.meta)
      .filter((m) => (!q.runtime || m.runtime === q.runtime) && (!q.kind || m.kind === q.kind)
        && (!q.accepts || m.inputs.includes(q.accepts)) && (!q.produces || m.outputs.includes(q.produces)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

// ---------------------------------------------------------------------------------------------
// Vendor-neutral HTTP/JSON adapter (PaddleOCR / Surya / Qwen behind a small server).

/** Minimal fetch shape so core needs neither DOM fetch types at runtime nor node-fetch. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface RemoteStageOptions extends Omit<StageDefinition, 'run' | 'runtime'> {
  runtime?: StageRuntime;
  endpoint: string;
  fetch: FetchLike;
  headers?: Record<string, string>;
  /** Build the JSON request body. Default: `{ input, config }` (image base64 stays in the body). */
  buildRequest?: (input: StageData, ctx: StageContext) => unknown;
  /** Turn the server JSON into a StageOutput. Default: `parseOcrResponse` for ocr stages, otherwise `parseFieldsResponse`. */
  parseResponse?: (body: unknown, input: StageData) => StageOutput;
}

export class RemoteStageError extends Error {
  constructor(readonly stageId: string, readonly status: number, detail: string) {
    super(`Stage ${stageId}: HTTP ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    this.name = 'RemoteStageError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accepts `{ text, spans?: [{ text, bbox?, confidence? }], confidence?, usage? }`. */
export function parseOcrResponse(body: unknown): StageOutput {
  if (!isObj(body) || typeof body.text !== 'string') throw new Error('OCR response must be an object with a string "text"');
  const spans = Array.isArray(body.spans) ? (body.spans as TextSpan[]).filter((s) => isObj(s) && typeof s.text === 'string') : undefined;
  return {
    output: { kind: 'text', text: body.text, ...(spans ? { spans } : {}) },
    ...(typeof body.confidence === 'number' ? { confidence: body.confidence } : {}),
    raw: JSON.stringify(body),
    metrics: usageMetrics(body.usage),
  };
}

/** Accepts `{ doc: ClinicalDoc, text?, confidence?, usage? }` or a bare ClinicalDoc. */
export function parseFieldsResponse(body: unknown, input?: StageData): StageOutput {
  const docLike = isObj(body) && isObj(body.doc) ? body.doc : body;
  if (!isObj(docLike) || !Array.isArray(docLike.medications) || !Array.isArray(docLike.labResults)) {
    throw new Error('Fields response must be a ClinicalDoc (medications[] and labResults[]) or { doc: ClinicalDoc }');
  }
  const text = isObj(body) && typeof body.text === 'string' ? body.text : input?.kind === 'text' ? input.text : undefined;
  return {
    output: { kind: 'fields', doc: docLike as unknown as ClinicalDoc, ...(text !== undefined ? { text } : {}) },
    ...(isObj(body) && typeof body.confidence === 'number' ? { confidence: body.confidence } : {}),
    raw: JSON.stringify(body),
    metrics: usageMetrics(isObj(body) ? body.usage : undefined),
  };
}

function usageMetrics(u: unknown): Partial<StageMetrics> {
  if (!isObj(u)) return {};
  const m: Partial<StageMetrics> = {};
  if (typeof u.inputTokens === 'number') m.inputTokens = u.inputTokens;
  if (typeof u.outputTokens === 'number') m.outputTokens = u.outputTokens;
  if (typeof u.costUsd === 'number') m.costUsd = u.costUsd;
  return m;
}

/** A Stage backed by an HTTP/JSON model server. Defaults to runtime 'local-oss'. */
export function createRemoteStage(o: RemoteStageOptions): Stage {
  const runtime = o.runtime ?? 'local-oss';
  const parse = o.parseResponse ?? (o.kind === 'ocr' ? parseOcrResponse : parseFieldsResponse);
  return defineStage({
    ...o,
    runtime,
    async run(input, ctx) {
      const body = JSON.stringify(o.buildRequest ? o.buildRequest(input, ctx) : { input, config: ctx.config ?? null });
      const res = await o.fetch(o.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...o.headers }, body, signal: ctx.signal });
      if (!res.ok) throw new RemoteStageError(o.id, res.status, await res.text().catch(() => ''));
      const out = parse(await res.json(), input);
      const sent = runtime === 'device' ? 0 : new TextEncoder().encode(body).length;
      return { ...out, metrics: { bytesSent: sent, ...out.metrics } };
    },
  });
}
