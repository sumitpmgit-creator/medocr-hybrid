import type { Usage } from './cost.ts';

export type Mode = 'device' | 'cloud' | 'hybrid';
export const MODES: Mode[] = ['device', 'cloud', 'hybrid'];
export const MODE_LABEL: Record<Mode, string> = { device: 'On-device only (Gemini Nano)', cloud: 'Cloud only (Firebase AI Logic)', hybrid: 'Hybrid' };

/** What the pipeline must return for one document. See CONTRACT.md. */
export interface PipelineOutput {
  text: string;
  fields?: Record<string, unknown>;
  route?: string;                          // which engine produced the final answer, e.g. "device" | "cloud"
  stages?: { name: string; where?: 'device' | 'cloud'; score?: number; ms?: number }[];
  usage?: Usage[];                         // one entry per cloud model call
}

export interface Blocker { reason: string; owner: string }

export interface SampleRun {
  output: PipelineOutput;
  wallMs: number;
  egress: { requests: number; bytes: number; unmeasuredBodies: number; hosts: Record<string, number> };
}

export interface Driver {
  name: string;
  /** Returns blockers that stop this mode from running for real. Empty = runnable. */
  preflight(mode: Mode): Promise<Blocker[]>;
  run(mode: Mode, input: { id: string; bytes: Uint8Array; mimeType: string }): Promise<SampleRun>;
  environment(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
