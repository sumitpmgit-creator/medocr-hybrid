import type { Usage } from './cost.ts';

export type Mode = 'device' | 'cloud' | 'hybrid';
export const MODES: Mode[] = ['device', 'cloud', 'hybrid'];
export const MODE_LABEL: Record<Mode, string> = { device: 'On-device only (Gemini Nano)', cloud: 'Cloud (Firebase AI Logic)', hybrid: 'Hybrid' };

/** What the pipeline must return for one document. See CONTRACT.md. */
export interface PipelineOutput {
  text: string;
  fields?: Record<string, unknown>;
  route?: string;                          // which engine produced the final answer, e.g. "device" | "cloud"
  stages?: { name: string; where?: string; score?: number; ms?: number }[];
  /** Per-stage trace with text outputs (in memory only; never persisted raw). See CONTRACT.md §2. */
  steps?: { stageId: string; stageKind: string; site?: string; text?: string }[];
  usage?: Usage[];                         // one entry per cloud model call
}

export interface Blocker { reason: string; owner: string }

export interface SampleRun {
  output: PipelineOutput;
  wallMs: number;
  egress: { requests: number; bytes: number; unmeasuredBodies: number; hosts: Record<string, number> };
  /** Decoded request bodies sent to non-loopback hosts (in memory only, for the leak check). */
  egressBodies?: string[];
}

export interface Driver {
  name: string;
  /** Returns blockers that stop this mode from running for real. Empty = runnable. */
  preflight(mode: Mode): Promise<Blocker[]>;
  /** Optional untimed setup per mode (model load, config fetch). Not attributed to any document. */
  warmup?(mode: Mode): Promise<void>;
  run(mode: Mode, input: { id: string; bytes: Uint8Array; mimeType: string }): Promise<SampleRun>;
  environment(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
