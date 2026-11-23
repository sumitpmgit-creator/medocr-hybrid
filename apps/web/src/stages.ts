// SPDX-License-Identifier: Apache-2.0
/**
 * Gemini stages for the hackathon app. Each is a core `Stage`, so the SoalTech portal can
 * benchmark Nano / Gemini next to PaddleOCR, Qwen, etc. through the same runner.
 *
 * Firebase AI Logic API names, verified 2026-11-23 against
 * https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
 * https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
 * and firebase@13.4.0 (@firebase/ai 3.1.0) typings:
 *   getAI, getGenerativeModel, GoogleAIBackend, InferenceMode
 *     (PREFER_ON_DEVICE, ONLY_ON_DEVICE, PREFER_IN_CLOUD, ONLY_IN_CLOUD),
 *   onDeviceParams / inCloudParams, initializeDeviceModel(),
 *   generateContent([prompt, { type: 'inlineData', inlineData: { data, mimeType } }]),
 *   result.response.inferenceSource (ON_DEVICE / IN_CLOUD),
 *   usageMetadata.promptTokenCount, candidatesTokenCount, thoughtsTokenCount.
 *
 * Pinned cloud model: gemini-3.5-flash-lite (SDK v13 default; pinned so it cannot drift).
 *
 * Privacy: OCR transcribes verbatim (no redaction in the read prompt). A dedicated
 * on-device de-id stage runs after OCR and before any cloud *text* call. The default
 * hybrid chain (nano-read → deid → cloud-structure) sends de-identified text only.
 * The optional cloud baseline (cloud-read → deid → cloud-structure) sends the page
 * image during cloud-read; it is off by default for user uploads. Every cloud *text*
 * payload is gated by assertSafeForCloud. core/parsing de-id does not inspect pixels.
 */
import { getGenerativeModel, InferenceMode, type GenerativeModel } from 'firebase/ai';
import {
  CLINICAL_DOC_JSON_SCHEMA, costUsd, reconcileLab, reconcileMedication, routeDoc,
  type ClinicalDoc, type Pipeline, type RoutingThresholds, type Stage, type StageData, type StageResult,
} from '@med-ocr/core';
import {
  INVALID_JSON_STATUS,
  OFFLINE_STATUS,
  TIMEOUT_STATUS,
  cloudAbortSignal,
  cloudRequestBytes,
  emptyDoc,
  flagFieldsForHumanConfirm,
  isCloudReachable,
  isNetworkFailure,
  isTimeoutOrAbort,
  parseCloudJson,
  readCloudJsonWithRetry,
  serializeCloudGenerateBody,
  structureRequestBytes,
} from './cloud-call';
import { formatRedactionCounts, humanConfirmNamed, runDeidentify, tryAssertSafeForCloud } from './cloud-guard';
import { CLOUD_MODEL, firebase } from './firebase';
import { usageFromResponse } from './usage';

/** Verbatim transcription. Must not ask the model to redact PHI (CER/WER score this output). */
export const READ_PROMPT = `Transcribe ALL text in this medical document image exactly as written, line by line, in reading order.
Do not correct spellings, do not expand abbreviations, do not add anything. Write [illegible] for unreadable words.`;

export const STRUCTURE_PROMPT = `Extract medications and lab results from this medical document transcript into the JSON schema.
Copy values exactly as written (e.g. "BD", "1-0-1", "625 mg"). Use null when a value is absent. Never guess:
if a value is unclear, set it to null, lower confidence, and add a note to "abstentions".
confidence is your probability (0-1) that every value in that entry is exactly right.
Transcript:
`;

const onDeviceText = (): GenerativeModel => getGenerativeModel(firebase().ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: { expectedInputs: [{ type: 'image' }, { type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] } },
});

const onDeviceJson = (): GenerativeModel => getGenerativeModel(firebase().ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: {
    createOptions: { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] },
    promptOptions: { responseConstraint: CLINICAL_DOC_JSON_SCHEMA },
  },
});

const cloudText = (): GenerativeModel => getGenerativeModel(firebase().ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: { model: CLOUD_MODEL },
});

const cloudJson = (): GenerativeModel => getGenerativeModel(firebase().ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: { model: CLOUD_MODEL, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: CLINICAL_DOC_JSON_SCHEMA as unknown as Record<string, unknown> } },
});

/** Must be called from a user gesture (Chrome user-activation rule). */
export async function prepareOnDevice(onProgress: (p: number) => void) {
  await onDeviceText().initializeDeviceModel(onProgress);
  await onDeviceJson().initializeDeviceModel();
}

function parseDoc(raw: string): ClinicalDoc {
  const d = JSON.parse(raw) as Partial<ClinicalDoc>;
  return { documentType: d.documentType ?? 'other', medications: d.medications ?? [], labResults: d.labResults ?? [], abstentions: d.abstentions ?? [] };
}

const t = () => performance.now();

function costOf(u: { inputTokens: number; outputTokens: number }): number {
  return costUsd(CLOUD_MODEL, u.inputTokens, u.outputTokens);
}

function thoughtNote(thoughtsTokenCount: number): string[] {
  return thoughtsTokenCount > 0 ? [`thoughtsTokenCount=${thoughtsTokenCount}`] : [];
}

export const nanoRead: Stage = {
  id: 'nano-read', name: 'Gemini Nano read (on-device, verbatim)', kind: 'ocr', accepts: ['image'],
  async run(input): Promise<StageResult> {
    if (input.kind !== 'image') throw new Error('image required');
    const t0 = t();
    const r = await onDeviceText().generateContent([READ_PROMPT, { type: 'inlineData' as const, inlineData: { data: input.image.base64, mimeType: input.image.mimeType } }]);
    const text = r.response.text();
    const u = usageFromResponse(r);
    return {
      stageId: this.id, stageKind: 'ocr', site: r.response.inferenceSource ?? 'on_device',
      output: { kind: 'text', text, image: input.image }, raw: text,
      notes: thoughtNote(u.thoughtsTokenCount),
      metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0, inputTokens: u.inputTokens, outputTokens: u.outputTokens },
    };
  },
};


/** Machine-readable image egress, parsed by the privacy receipt. */
export const IMAGE_EGRESS_NOTE_PREFIX = 'IMAGE_EGRESS_BYTES=';

export const CLOUD_BASELINE_PIPELINE_ID = 'cloud-only';
export const CLOUD_BASELINE_LABEL = 'Cloud baseline (sends the image)';

export type PipelineSource = 'upload' | 'benchmark';

/** Off by default for user uploads; always on for public benchmark comparison. */
export function isCloudBaselineEnabled(opts: { source: PipelineSource; userEnabled?: boolean }): boolean {
  if (opts.source === 'benchmark') return true;
  return opts.userEnabled === true;
}

export const cloudRead: Stage = {
  id: 'cloud-read', name: `${CLOUD_MODEL} read (cloud, sends the page image)`, kind: 'ocr', accepts: ['image'],
  async run(input, ctx): Promise<StageResult> {
    if (input.kind !== 'image') throw new Error('image required');
    const t0 = t();
    if (!isCloudReachable()) {
      return {
        stageId: this.id, stageKind: 'ocr', site: 'local_code', output: input,
        error: 'Offline: Failed to fetch',
        notes: ['status:offline'],
        metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 },
      };
    }
    const parts = [READ_PROMPT, { type: 'inlineData' as const, inlineData: { data: input.image.base64, mimeType: input.image.mimeType } }];
    const body = serializeCloudGenerateBody(CLOUD_MODEL, [
      { text: READ_PROMPT },
      { type: 'inlineData', inlineData: { data: input.image.base64, mimeType: input.image.mimeType } },
    ]);
    const bytesSent = cloudRequestBytes(body);
    const imageBytes = input.image.base64.length;
    try {
      const r = await cloudText().generateContent(parts, { signal: cloudAbortSignal(ctx.signal) });
      const text = r.response.text();
      const u = usageFromResponse(r);
      return {
        stageId: this.id, stageKind: 'ocr', site: 'in_cloud',
        output: { kind: 'text', text, image: input.image }, raw: text,
        notes: [
          `${IMAGE_EGRESS_NOTE_PREFIX}${imageBytes}`,
          `Full page image left the device (${imageBytes} bytes in the request payload, plus the prompt).`,
          ...thoughtNote(u.thoughtsTokenCount),
        ],
        metrics: { latencyMs: t() - t0, costUsd: costOf(u), bytesSent, inputTokens: u.inputTokens, outputTokens: u.outputTokens },
      };
    } catch (err) {
      const error = isTimeoutOrAbort(err)
        ? 'Cloud timed out or was cancelled'
        : isNetworkFailure(err)
          ? 'Offline: Failed to fetch'
          : err instanceof Error ? err.message : String(err);
      return {
        stageId: this.id, stageKind: 'ocr', site: 'local_code', output: input,
        error, notes: [`status:${isTimeoutOrAbort(err) ? 'timeout' : 'offline'}`],
        metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 },
      };
    }
  },
};

export const nanoStructure: Stage = {
  id: 'nano-structure', name: 'Gemini Nano structure (on-device)', kind: 'structure', accepts: ['text'],
  async run(input): Promise<StageResult> {
    if (input.kind !== 'text') throw new Error('text required');
    const t0 = t();
    const r = await onDeviceJson().generateContent(STRUCTURE_PROMPT + input.text);
    const raw = r.response.text();
    const u = usageFromResponse(r);
    return {
      stageId: this.id, stageKind: 'structure', site: r.response.inferenceSource ?? 'on_device',
      output: { kind: 'fields', doc: parseDoc(raw), text: input.text, image: input.image }, raw,
      notes: thoughtNote(u.thoughtsTokenCount),
      metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0, inputTokens: u.inputTokens, outputTokens: u.outputTokens },
    };
  },
};

/**
 * On-device de-identification. Must run after OCR and before any cloud stage.
 * Downstream `readingText()` skips this stage, so CER/WER stay on the raw OCR.
 */
export const deidStage: Stage = {
  id: 'deid', name: 'On-device de-identification', kind: 'deid', accepts: ['text', 'fields'],
  async run(input): Promise<StageResult> {
    const source = input.kind === 'image' ? '' : (input.kind === 'text' ? input.text : (input.text ?? ''));
    const result = runDeidentify(source);
    const notes = [
      `De-identified ${result.total} identifier(s): ${formatRedactionCounts(result.redactions)}`,
      'De-id is text-only; it does not inspect or redact pixels.',
    ];
    const output: StageData = input.kind === 'fields'
      ? { kind: 'fields', doc: input.doc, text: result.text, image: input.image }
      : { kind: 'text', text: result.text, image: input.kind === 'text' ? input.image : undefined };
    return { stageId: this.id, stageKind: 'deid', site: 'local_code', output, notes, metrics: { latencyMs: 0, costUsd: 0, bytesSent: 0 } };
  },
};

export const cloudStructure: Stage = {
  id: 'cloud-structure', name: `${CLOUD_MODEL} structure (cloud, de-identified text only)`, kind: 'structure', accepts: ['text'],
  async run(input, ctx): Promise<StageResult> {
    if (input.kind !== 'text') throw new Error('text required');
    const t0 = t();
    const prompt = STRUCTURE_PROMPT + input.text;

    const fallback = async (reason: string, status: string): Promise<StageResult> => {
      let doc = emptyDoc();
      try {
        const r = await onDeviceJson().generateContent(prompt, { signal: cloudAbortSignal(ctx.signal) });
        doc = parseCloudJson(r.response.text()) ?? doc;
      } catch { /* keep empty doc if Nano is also unavailable */ }
      doc = flagFieldsForHumanConfirm(doc, reason, input.text);
      return {
        stageId: this.id, stageKind: 'structure', site: 'on_device',
        output: { kind: 'fields', doc, text: input.text, image: input.image },
        notes: [reason, `status:${status}`],
        metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 },
      };
    };

    if (!isCloudReachable()) return fallback(OFFLINE_STATUS, 'offline');
    const guard = tryAssertSafeForCloud(prompt);
    if (!guard.ok) {
      const doc = flagFieldsForHumanConfirm(emptyDoc(), guard.message, input.text);
      return {
        stageId: this.id, stageKind: 'structure', site: 'local_code',
        output: { kind: 'fields', doc, text: input.text, image: input.image },
        notes: [guard.message],
        metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 },
      };
    }

    const signal = cloudAbortSignal(ctx.signal);
    let bytesSent = 0;
    try {
      const { doc, raw, retried } = await readCloudJsonWithRetry(
        async (p) => {
          bytesSent += structureRequestBytes(p);
          return (await cloudJson().generateContent(p, { signal })).response.text();
        },
        prompt,
      );
      if (!doc) return fallback(INVALID_JSON_STATUS, 'invalid-json');
      return {
        stageId: this.id, stageKind: 'structure', site: 'in_cloud',
        output: { kind: 'fields', doc, text: input.text, image: input.image }, raw,
        notes: [
          'Sent de-identified transcript only; no image.',
          ...(retried ? ['Retried once after a non-JSON cloud reply.'] : []),
        ],
        metrics: { latencyMs: t() - t0, costUsd: costOf({ inputTokens: 0, outputTokens: 0 }), bytesSent, inputTokens: 0, outputTokens: 0 },
      };
    } catch (err) {
      if (isTimeoutOrAbort(err)) return fallback(TIMEOUT_STATUS, 'timeout');
      if (isNetworkFailure(err)) return fallback(OFFLINE_STATUS, 'offline');
      throw err;
    }
  },
};

/** Routes only low-confidence entities, with de-identified text and NO image, to the cloud. */
export function hybridVerify(thresholds: RoutingThresholds): Stage {
  return {
    id: 'cloud-verify', name: 'Cloud verify (de-identified text, low-confidence only)', kind: 'verify', accepts: ['fields'],
    async run(input: StageData, ctx): Promise<StageResult> {
      if (input.kind !== 'fields') throw new Error('fields required');
      const t0 = t();
      const source = input.text ?? '';
      const routed = routeDoc(input.doc, source, thresholds);
      const notes: string[] = [];
      const keepLocal = (reason: string, status: string): StageResult => {
        const doc = flagFieldsForHumanConfirm(input.doc, reason, source, thresholds);
        notes.push(reason, `status:${status}`);
        return {
          stageId: this.id, stageKind: 'verify', site: 'local_code',
          output: { kind: 'fields', doc, text: input.text, image: input.image },
          notes, metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 },
        };
      };
      if (routed.toCloud === 0) {
        notes.push('All entities accepted on-device; nothing sent.');
        return { stageId: this.id, stageKind: 'verify', site: 'local_code', output: input, notes, metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 } };
      }
      if (!isCloudReachable()) return keepLocal(OFFLINE_STATUS, 'offline');
      // Safety net: de-id again even if a prior deid stage already ran.
      const deid = runDeidentify(source);
      notes.push(`De-identified ${deid.total} identifier(s): ${formatRedactionCounts(deid.redactions)}`);
      const medNames = routed.meds.filter((m) => m.decision === 'send_to_cloud').map((m) => m.entity.name);
      const labNames = routed.labs.filter((l) => l.decision === 'send_to_cloud').map((l) => l.entity.test);
      const prompt = `${STRUCTURE_PROMPT}${deid.text}\n\nOnly return entries for these items: ${JSON.stringify({
        medications: medNames,
        labResults: labNames,
      })}`;
      const guard = tryAssertSafeForCloud(prompt);
      if (!guard.ok) {
        notes.push(guard.message);
        const doc = humanConfirmNamed(input.doc, medNames, labNames, guard.message);
        return {
          stageId: this.id, stageKind: 'verify', site: 'local_code',
          output: { kind: 'fields', doc, text: input.text, image: input.image },
          notes,
          metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 },
        };
      }
      const signal = cloudAbortSignal(ctx.signal);
      let bytesSent = 0;
      let raw: string;
      let retried = false;
      let cloud: ClinicalDoc;
      try {
        const result = await readCloudJsonWithRetry(
          async (p) => {
            bytesSent += structureRequestBytes(p);
            return (await cloudJson().generateContent(p, { signal })).response.text();
          },
          prompt,
        );
        raw = result.raw;
        retried = result.retried;
        if (!result.doc) return keepLocal(INVALID_JSON_STATUS, 'invalid-json');
        cloud = result.doc;
      } catch (err) {
        if (isTimeoutOrAbort(err)) return keepLocal(TIMEOUT_STATUS, 'timeout');
        if (isNetworkFailure(err)) return keepLocal(OFFLINE_STATUS, 'offline');
        throw err;
      }
      const u = { inputTokens: 0, outputTokens: 0, thoughtsTokenCount: 0 };
      const doc: ClinicalDoc = { ...input.doc, medications: [...input.doc.medications], labResults: [...input.doc.labResults], abstentions: [...(input.doc.abstentions ?? [])] };
      for (const m of routed.meds.filter((x) => x.decision === 'send_to_cloud')) {
        const rec = reconcileMedication(m.entity, cloud.medications.find((c) => c.name.toLowerCase() === m.entity.name.toLowerCase()), thresholds);
        doc.medications[m.index] = rec.value;
        if (rec.decision === 'human_confirm') doc.abstentions!.push(`HUMAN CONFIRM medication "${m.entity.name}": ${rec.disagreements.join(', ') || 'low confidence'}`);
      }
      for (const l of routed.labs.filter((x) => x.decision === 'send_to_cloud')) {
        const rec = reconcileLab(l.entity, cloud.labResults.find((c) => c.test.toLowerCase() === l.entity.test.toLowerCase()), thresholds);
        doc.labResults[l.index] = rec.value;
        if (rec.decision === 'human_confirm') doc.abstentions!.push(`HUMAN CONFIRM lab "${l.entity.test}": ${rec.disagreements.join(', ') || 'low confidence'}`);
      }
      notes.push(`Sent de-identified text for: ${[...medNames, ...labNames].join(', ')}. No image.`);
      if (retried) notes.push('Retried once after a non-JSON cloud reply.');
      notes.push(...thoughtNote(u.thoughtsTokenCount ?? 0));
      return {
        stageId: this.id, stageKind: 'verify', site: 'in_cloud',
        output: { kind: 'fields', doc, text: input.text, image: input.image }, raw, notes,
        metrics: { latencyMs: t() - t0, costUsd: costOf(u), bytesSent, inputTokens: u.inputTokens, outputTokens: u.outputTokens },
      };
    },
  };
}

/**
 * Default hybrid: nano-read → deid → cloud-structure (de-identified text only).
 * Cloud baseline (`cloud-only`): cloud-read → deid → cloud-structure. This
 * sends the page image; the UI keeps it off for uploads unless toggled, and
 * enables it for public benchmark comparison. Sage's harness calls `pipelines()`.
 */
export function pipelines(thresholds: RoutingThresholds): Pipeline[] {
  return [
    { id: 'on-device-only', name: 'On-device only (Nano)', stages: [nanoRead, nanoStructure] },
    { id: CLOUD_BASELINE_PIPELINE_ID, name: CLOUD_BASELINE_LABEL, stages: [cloudRead, deidStage, cloudStructure] },
    { id: 'hybrid', name: 'Hybrid (Nano read + de-identified cloud structure)', stages: [nanoRead, deidStage, cloudStructure] },
  ];
}

export function pipelinesForUi(thresholds: RoutingThresholds, opts: { source: PipelineSource; userEnabled?: boolean }): Pipeline[] {
  const all = pipelines(thresholds);
  if (isCloudBaselineEnabled(opts)) return all;
  return all.filter((p) => p.id !== CLOUD_BASELINE_PIPELINE_ID);
}
