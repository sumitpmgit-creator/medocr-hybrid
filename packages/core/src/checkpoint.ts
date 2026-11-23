// SPDX-License-Identifier: Apache-2.0
/**
 * Checkpoint storage for the resumable runner. Browser-safe: the filesystem implementation lives
 * in `src/node/fs-checkpoint-store.ts` and is exported only from `@med-ocr/core/node`.
 */
import type { StageResult } from './types.js';

export const CHECKPOINT_SCHEMA_VERSION = 1;

export interface AttemptRecord {
  attempt: number;
  startedAt: string;
  durationMs: number;
  error?: string;
  aborted?: boolean;
  timedOut?: boolean;
}

export interface CheckpointRecord {
  schemaVersion: number;
  key: string;
  pipelineId: string;
  docId: string;
  stageIndex: number;
  stageId: string;
  stageVersion: string;
  /** sha256 over canonical { stageId, input, config, model, fingerprint } */
  inputHash: string;
  /** sha256 over the canonical output StageData (absent for failures) */
  outputHash?: string;
  status: 'completed' | 'failed';
  result: StageResult;
  attempts: AttemptRecord[];
  runId: string;
  finishedAt: string;
}

export interface CheckpointStore {
  get(key: string): Promise<CheckpointRecord | undefined>;
  put(record: CheckpointRecord): Promise<void>;
  delete(key: string): Promise<void>;
  /** All records whose key starts with `prefix`, sorted by key. */
  list(prefix: string): Promise<CheckpointRecord[]>;
}

/** `${pipelineId}/${docId}/` — every stage checkpoint of one (pipeline, document) pair. */
export function checkpointPrefix(pipelineId: string, docId: string): string {
  return `${encodeURIComponent(pipelineId)}/${encodeURIComponent(docId)}/`;
}

export function checkpointKey(pipelineId: string, docId: string, stageIndex: number, stageId: string): string {
  return `${checkpointPrefix(pipelineId, docId)}${String(stageIndex).padStart(3, '0')}-${encodeURIComponent(stageId)}`;
}

/** In-memory store. Records are deep-copied on put/get so callers cannot mutate stored state. */
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly map = new Map<string, string>();
  async get(key: string) { const v = this.map.get(key); return v === undefined ? undefined : (JSON.parse(v) as CheckpointRecord); }
  async put(r: CheckpointRecord) { this.map.set(r.key, JSON.stringify(r)); }
  async delete(key: string) { this.map.delete(key); }
  async list(prefix: string) {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => JSON.parse(this.map.get(k)!) as CheckpointRecord);
  }
  get size(): number { return this.map.size; }
}
