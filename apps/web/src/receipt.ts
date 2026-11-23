// SPDX-License-Identifier: Apache-2.0
/**
 * Privacy receipt: exactly what left the device and what stayed local,
 * built from a core PipelineRun's stage metrics and notes.
 */
import type { ExecutionSite, PipelineRun, StageResult } from '@med-ocr/core';
import { usageFromRun, type UsageView } from './accounting';
import { CLOUD_MODEL } from './firebase';

export const ON_DEVICE_MODEL = 'gemini-nano';

export type ReceiptPayloadKind = 'page-image' | 'deidentified-transcript' | 'prompt' | 'response' | 'note';

export interface ReceiptItem {
  stageId: string;
  site: ExecutionSite;
  kind: ReceiptPayloadKind;
  bytes: number;
  model?: string;
  detail?: string;
}

export interface DeidReceiptSummary {
  /** Total identifiers removed. Values themselves are never included. */
  total: number;
  /** e.g. "name: 2, phone: 1". */
  byType: string;
}

export interface PrivacyReceipt {
  timestamp: string;
  pipelineId: string;
  simulated: boolean;
  cloudModel: string;
  onDeviceModel: string;
  leftDevice: ReceiptItem[];
  stayedLocal: ReceiptItem[];
  totalBytesSent: number;
  totalBytesLocal: number;
  estimatedUsd: number;
  usedEstimate: boolean;
  notes: string[];
  /** What de-id removed (counts and types only, never the values). */
  deid?: DeidReceiptSummary;
  /** False when the cloud baseline sent the page image. */
  imagesStayLocal: boolean;
  /** Bytes of page-image payload that left the device (0 if none). */
  imageBytesSent: number;
}

export function buildPrivacyReceipt(
  run: PipelineRun,
  opts: { now?: () => Date; simulated?: boolean } = {},
): PrivacyReceipt {
  const usage: UsageView = usageFromRun(run);
  const leftDevice: ReceiptItem[] = [];
  const stayedLocal: ReceiptItem[] = [];
  const notes: string[] = [];

  for (const step of run.steps) {
    for (const note of step.notes ?? []) notes.push(note);
    if (step.metrics.bytesSent > 0) {
      leftDevice.push(itemFromStep(step, step.metrics.bytesSent));
    } else {
      stayedLocal.push(itemFromStep(step, step.raw ? new TextEncoder().encode(step.raw).length : 0));
    }
  }

  if (run.error) notes.push(`Run error: ${run.error}`);

  return {
    timestamp: (opts.now ?? (() => new Date()))().toISOString(),
    pipelineId: run.pipelineId,
    simulated: opts.simulated ?? run.pipelineId.startsWith('mock-'),
    cloudModel: CLOUD_MODEL,
    onDeviceModel: ON_DEVICE_MODEL,
    leftDevice,
    stayedLocal,
    totalBytesSent: usage.bytesSent,
    totalBytesLocal: usage.bytesLocal,
    estimatedUsd: usage.estimatedUsd,
    usedEstimate: usage.usedEstimate,
    notes,
    deid: deidSummaryFromNotes(notes),
    imagesStayLocal: !leftDevice.some((item) => item.kind === 'page-image'),
    imageBytesSent: leftDevice.filter((item) => item.kind === 'page-image').reduce((sum, item) => sum + item.bytes, 0),
  };
}

export function deidSummaryFromNotes(notes: string[]): DeidReceiptSummary | undefined {
  const line = notes.find((n) => /De-identified /i.test(n));
  if (!line) return undefined;
  const totalMatch = line.match(/De-identified\s+(\d+)/i);
  const typesMatch = line.match(/identifier\(s\):\s*(.*)$/i);
  return {
    total: totalMatch ? Number(totalMatch[1]) : 0,
    byType: typesMatch?.[1]?.trim() || 'none',
  };
}

function itemFromStep(step: StageResult, bytes: number): ReceiptItem {
  const cloud = step.site === 'in_cloud';
  const imageBytes = imageEgressBytesFromNotes(step.notes ?? []);
  const kind: ReceiptPayloadKind = cloud
    ? (step.stageId === 'cloud-read' || (step.stageKind === 'ocr' && imageBytes !== undefined)
        ? 'page-image'
        : (step.stageId.includes('verify') || step.stageKind === 'structure' ? 'deidentified-transcript' : 'prompt'))
    : step.stageKind === 'deid'
      ? 'note'
      : 'response';
  return {
    stageId: step.stageId,
    site: step.site,
    kind,
    bytes: kind === 'page-image' && imageBytes !== undefined ? imageBytes : bytes,
    model: cloud ? CLOUD_MODEL : step.site === 'on_device' ? ON_DEVICE_MODEL : undefined,
    detail: (step.notes ?? []).join('; ') || undefined,
  };
}

export function imageEgressBytesFromNotes(notes: string[]): number | undefined {
  for (const note of notes) {
    const match = note.match(/^IMAGE_EGRESS_BYTES=(\d+)$/);
    if (match) return Number(match[1]);
  }
  return undefined;
}
