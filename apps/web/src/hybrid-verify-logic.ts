// SPDX-License-Identifier: Apache-2.0
/**
 * Hybrid routing (BUG-026): Nano has already read and structured the document
 * on-device. Only mid-confidence fields leave the device, as one de-identified
 * text snippet each, after assertSafeForCloud.
 *
 *   confidence >= acceptOnDevice (default 0.85) → stay local, no cloud
 *   humanReview <= confidence < acceptOnDevice (default 0.5–0.85) → one gated snippet
 *   confidence < humanReview (default 0.5) → human confirm, no cloud
 */
import {
  reconcileLab,
  reconcileMedication,
  type ClinicalDoc,
  type RoutingThresholds,
  type StageContext,
  type StageData,
  type StageResult,
} from '@med-ocr/core';
import {
  INVALID_JSON_STATUS,
  OFFLINE_STATUS,
  TIMEOUT_STATUS,
  cloudAbortSignal,
  isCloudReachable,
  isNetworkFailure,
  isTimeoutOrAbort,
  readCloudJsonWithRetry,
  structureRequestBytes,
} from './cloud-call';
import { formatRedactionCounts, humanConfirmNamed, runDeidentify, tryAssertSafeForCloud } from './cloud-guard';
import type { ModelUsage } from './usage';

export const FIELDS_SENT_TO_CLOUD_PREFIX = 'FIELDS_SENT_TO_CLOUD=';

export type ConfidenceBand = 'accept' | 'cloud' | 'human';

export interface BandedField {
  kind: 'medication' | 'lab';
  index: number;
  label: string;
  confidence: number;
  band: ConfidenceBand;
}

export function confidenceBand(confidence: number, thresholds: RoutingThresholds): ConfidenceBand {
  if (confidence >= thresholds.acceptOnDevice) return 'accept';
  if (confidence < thresholds.humanReview) return 'human';
  return 'cloud';
}

export function bandFields(doc: ClinicalDoc, thresholds: RoutingThresholds): BandedField[] {
  const meds: BandedField[] = doc.medications.map((m, index) => ({
    kind: 'medication',
    index,
    label: m.name,
    confidence: m.confidence ?? 0,
    band: confidenceBand(m.confidence ?? 0, thresholds),
  }));
  const labs: BandedField[] = doc.labResults.map((l, index) => ({
    kind: 'lab',
    index,
    label: l.test,
    confidence: l.confidence ?? 0,
    band: confidenceBand(l.confidence ?? 0, thresholds),
  }));
  return [...meds, ...labs];
}

/** A short, field-local excerpt — not the whole transcript. */
export function fieldSnippet(sourceText: string, label: string): string {
  const lines = sourceText.split(/\r?\n/);
  const needle = label.toLowerCase();
  const idx = lines.findIndex((line) => line.toLowerCase().includes(needle));
  if (idx < 0) return label;
  const from = Math.max(0, idx - 1);
  const to = Math.min(lines.length, idx + 2);
  return lines.slice(from, to).join('\n').trim() || label;
}

/** Placeholders only — never the original date values — so a per-field snippet still carries policy tokens. */
export function datePlaceholderContext(deidentifiedText: string): string {
  const tokens: string[] = [];
  if (deidentifiedText.includes('[DOB]')) tokens.push('[DOB]');
  if (deidentifiedText.includes('[DATE]')) tokens.push('[DATE]');
  return tokens.join(' ');
}

/** De-identify a per-field snippet and attach any [DOB]/[DATE] tokens from the already-de-identified source. */
export function gatedFieldPayload(sourceText: string, label: string): { text: string; deidTotal: number; redactions: ReturnType<typeof runDeidentify>['redactions'] } {
  const deidSource = runDeidentify(sourceText);
  const deidSnippet = runDeidentify(fieldSnippet(deidSource.text, label));
  const tokens = datePlaceholderContext(deidSource.text);
  const text = tokens ? `${tokens}\n${deidSnippet.text}` : deidSnippet.text;
  return { text, deidTotal: deidSnippet.total + deidSource.total, redactions: deidSnippet.redactions };
}

export function fieldsSentNote(count: number): string {
  return `${FIELDS_SENT_TO_CLOUD_PREFIX}${count}`;
}

export function fieldsSentToCloudFromNotes(notes: readonly string[]): number | undefined {
  for (const note of notes) {
    const match = note.match(/^FIELDS_SENT_TO_CLOUD=(\d+)$/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

export interface HybridGenerateResult {
  text: string;
  usage?: ModelUsage;
}

export interface HybridVerifyDeps {
  stageId: string;
  structurePrompt: string;
  thresholds: RoutingThresholds;
  timeoutMs?: number;
  costOf: (usage: { inputTokens: number; outputTokens: number }) => number;
  generate: (prompt: string, signal: AbortSignal) => Promise<HybridGenerateResult>;
  now?: () => number;
}

export async function executeHybridVerify(
  input: StageData,
  ctx: StageContext,
  deps: HybridVerifyDeps,
): Promise<StageResult> {
  if (input.kind !== 'fields') throw new Error('fields required');
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const t0 = now();
  const source = input.text ?? '';
  const notes: string[] = [];
  const fields = bandFields(input.doc, deps.thresholds);
  const mid = fields.filter((f) => f.band === 'cloud');
  const low = fields.filter((f) => f.band === 'human');

  const doc: ClinicalDoc = {
    ...input.doc,
    medications: [...input.doc.medications],
    labResults: [...input.doc.labResults],
    abstentions: [...(input.doc.abstentions ?? [])],
  };

  for (const field of low) {
    const kind = field.kind === 'medication' ? 'medication' : 'lab';
    doc.abstentions!.push(`HUMAN CONFIRM ${kind} "${field.label}": confidence ${field.confidence} is below the human-review threshold`);
  }

  const done = (opts: {
    site: StageResult['site'];
    sent: number;
    extraNotes?: string[];
    bytesSent?: number;
    usage?: { inputTokens: number; outputTokens: number; thoughtsTokenCount?: number };
    raw?: string;
  }): StageResult => {
    const allNotes = [...notes, ...(opts.extraNotes ?? []), fieldsSentNote(opts.sent)];
    return {
      stageId: deps.stageId,
      stageKind: 'verify',
      site: opts.site,
      output: { kind: 'fields', doc, text: input.text, image: input.image },
      raw: opts.raw,
      notes: allNotes,
      metrics: {
        latencyMs: now() - t0,
        costUsd: deps.costOf(opts.usage ?? { inputTokens: 0, outputTokens: 0 }),
        bytesSent: opts.bytesSent ?? 0,
        inputTokens: opts.usage?.inputTokens ?? 0,
        outputTokens: opts.usage?.outputTokens ?? 0,
      },
    };
  };

  if (mid.length === 0) {
    if (low.length === 0) notes.push('All entities accepted on-device; nothing sent.');
    else notes.push('Low-confidence fields were sent to human review; nothing left the device.');
    return done({ site: 'local_code', sent: 0 });
  }

  if (!isCloudReachable()) {
    const names = mid.filter((f) => f.kind === 'medication').map((f) => f.label);
    const labs = mid.filter((f) => f.kind === 'lab').map((f) => f.label);
    const flagged = humanConfirmNamed(doc, names, labs, OFFLINE_STATUS);
    doc.medications = flagged.medications;
    doc.labResults = flagged.labResults;
    doc.abstentions = flagged.abstentions;
    notes.push(OFFLINE_STATUS, 'status:offline');
    return done({ site: 'local_code', sent: 0 });
  }

  const signal = cloudAbortSignal(ctx.signal, deps.timeoutMs);
  let bytesSent = 0;
  let sent = 0;
  const usage = { inputTokens: 0, outputTokens: 0, thoughtsTokenCount: 0 };
  const rawParts: string[] = [];

  const failRemaining = (fromIndex: number, reason: string, status: string) => {
    const rest = mid.slice(fromIndex);
    const names = rest.filter((f) => f.kind === 'medication').map((f) => f.label);
    const labs = rest.filter((f) => f.kind === 'lab').map((f) => f.label);
    const flagged = humanConfirmNamed(doc, names, labs, reason);
    doc.medications = flagged.medications;
    doc.labResults = flagged.labResults;
    doc.abstentions = flagged.abstentions;
    notes.push(reason, `status:${status}`);
  };

  for (let i = 0; i < mid.length; i++) {
    const field = mid[i]!;
    const payload = gatedFieldPayload(source, field.label);
    notes.push(`De-identified snippet for "${field.label}": ${payload.deidTotal} identifier(s): ${formatRedactionCounts(payload.redactions)}`);
    const prompt = `${deps.structurePrompt}${payload.text}\n\nOnly return a JSON object with the single ${field.kind} "${field.label}".`;
    const guard = tryAssertSafeForCloud(prompt);
    if (!guard.ok) {
      const flagged = humanConfirmNamed(doc, field.kind === 'medication' ? [field.label] : [], field.kind === 'lab' ? [field.label] : [], guard.message);
      doc.medications = flagged.medications;
      doc.labResults = flagged.labResults;
      doc.abstentions = flagged.abstentions;
      notes.push(guard.message);
      continue;
    }
    try {
      const result = await readCloudJsonWithRetry(async (p) => {
        bytesSent += structureRequestBytes(p);
        const generated = await deps.generate(p, signal);
        if (generated.usage) {
          usage.inputTokens += generated.usage.inputTokens;
          usage.outputTokens += generated.usage.outputTokens;
          usage.thoughtsTokenCount += generated.usage.thoughtsTokenCount;
        }
        return generated.text;
      }, prompt);
      rawParts.push(result.raw);
      if (!result.doc) {
        const flagged = humanConfirmNamed(doc, field.kind === 'medication' ? [field.label] : [], field.kind === 'lab' ? [field.label] : [], INVALID_JSON_STATUS);
        doc.medications = flagged.medications;
        doc.labResults = flagged.labResults;
        doc.abstentions = flagged.abstentions;
        notes.push(INVALID_JSON_STATUS);
        continue;
      }
      if (field.kind === 'medication') {
        const rec = reconcileMedication(
          doc.medications[field.index]!,
          result.doc.medications.find((c) => c.name.toLowerCase() === field.label.toLowerCase()),
          deps.thresholds,
        );
        doc.medications[field.index] = rec.value;
        if (rec.decision === 'human_confirm') {
          doc.abstentions!.push(`HUMAN CONFIRM medication "${field.label}": ${rec.disagreements.join(', ') || 'low confidence'}`);
        }
      } else {
        const rec = reconcileLab(
          doc.labResults[field.index]!,
          result.doc.labResults.find((c) => c.test.toLowerCase() === field.label.toLowerCase()),
          deps.thresholds,
        );
        doc.labResults[field.index] = rec.value;
        if (rec.decision === 'human_confirm') {
          doc.abstentions!.push(`HUMAN CONFIRM lab "${field.label}": ${rec.disagreements.join(', ') || 'low confidence'}`);
        }
      }
      sent += 1;
    } catch (err) {
      if (isTimeoutOrAbort(err)) {
        failRemaining(i, TIMEOUT_STATUS, 'timeout');
        break;
      }
      if (isNetworkFailure(err)) {
        failRemaining(i, OFFLINE_STATUS, 'offline');
        break;
      }
      throw err;
    }
  }

  if (sent > 0) notes.push(`Sent de-identified snippets for ${sent} field(s). No image.`);
  return done({
    site: sent > 0 ? 'in_cloud' : 'local_code',
    sent,
    bytesSent,
    usage,
    raw: rawParts.join('\n'),
  });
}
