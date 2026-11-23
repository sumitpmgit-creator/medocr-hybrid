// SPDX-License-Identifier: Apache-2.0
/**
 * Gemini stages for the hackathon app. Each is a core `Stage`, so the SoalTech portal can
 * benchmark Nano / Gemini next to PaddleOCR, Qwen, etc. through the same runner.
 * API names verified against firebase@13.4.0 (@firebase/ai 3.1.0) type definitions.
 */
import { getGenerativeModel, InferenceMode, type GenerativeModel } from 'firebase/ai';
import {
  CLINICAL_DOC_JSON_SCHEMA, costUsd, deidentify, reconcileLab, reconcileMedication, routeDoc, utf8Bytes,
  type ClinicalDoc, type Pipeline, type RoutingThresholds, type Stage, type StageData, type StageResult,
} from '@med-ocr/core';
import { CLOUD_MODEL, firebase } from './firebase';

const READ_PROMPT = `Transcribe ALL text in this medical document image exactly as written, line by line, in reading order.
Do not correct spellings, do not expand abbreviations, do not add anything. Write [illegible] for unreadable words.
Replace patient names, phone numbers, ABHA/Aadhaar numbers and doctor registration numbers with [REDACTED].`;

const STRUCTURE_PROMPT = `Extract medications and lab results from this medical document transcript into the JSON schema.
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

const cloudText = (): GenerativeModel => getGenerativeModel(firebase().ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: CLOUD_MODEL } });

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

function usage(r: { response: { usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number } } }) {
  return { inputTokens: r.response.usageMetadata?.promptTokenCount ?? 0, outputTokens: r.response.usageMetadata?.candidatesTokenCount ?? 0 };
}

export const nanoRead: Stage = {
  id: 'nano-read', name: 'Gemini Nano read (on-device)', kind: 'ocr', accepts: ['image'],
  async run(input): Promise<StageResult> {
    if (input.kind !== 'image') throw new Error('image required');
    const t0 = t();
    const r = await onDeviceText().generateContent([READ_PROMPT, { type: 'inlineData' as const, inlineData: { data: input.image.base64, mimeType: input.image.mimeType } }]);
    const text = r.response.text();
    return { stageId: this.id, stageKind: 'ocr', site: r.response.inferenceSource ?? 'on_device', output: { kind: 'text', text, image: input.image }, raw: text, metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 } };
  },
};

export const nanoStructure: Stage = {
  id: 'nano-structure', name: 'Gemini Nano structure (on-device)', kind: 'structure', accepts: ['text'],
  async run(input): Promise<StageResult> {
    if (input.kind !== 'text') throw new Error('text required');
    const t0 = t();
    const r = await onDeviceJson().generateContent(STRUCTURE_PROMPT + input.text);
    const raw = r.response.text();
    return { stageId: this.id, stageKind: 'structure', site: r.response.inferenceSource ?? 'on_device', output: { kind: 'fields', doc: parseDoc(raw), text: input.text, image: input.image }, raw, metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 } };
  },
};

export const cloudRead: Stage = {
  id: 'cloud-read', name: `${CLOUD_MODEL} read (cloud, full image)`, kind: 'ocr', accepts: ['image'],
  async run(input): Promise<StageResult> {
    if (input.kind !== 'image') throw new Error('image required');
    const t0 = t();
    const r = await cloudText().generateContent([READ_PROMPT, { type: 'inlineData' as const, inlineData: { data: input.image.base64, mimeType: input.image.mimeType } }]);
    const text = r.response.text();
    const u = usage(r);
    return { stageId: this.id, stageKind: 'ocr', site: 'in_cloud', output: { kind: 'text', text, image: input.image }, raw: text,
      metrics: { latencyMs: t() - t0, costUsd: costUsd(CLOUD_MODEL, u.inputTokens, u.outputTokens), bytesSent: utf8Bytes(READ_PROMPT) + input.image.base64.length, ...u } };
  },
};

export const cloudStructure: Stage = {
  id: 'cloud-structure', name: `${CLOUD_MODEL} structure (cloud)`, kind: 'structure', accepts: ['text'],
  async run(input): Promise<StageResult> {
    if (input.kind !== 'text') throw new Error('text required');
    const t0 = t();
    const prompt = STRUCTURE_PROMPT + input.text;
    const r = await cloudJson().generateContent(prompt);
    const raw = r.response.text();
    const u = usage(r);
    return { stageId: this.id, stageKind: 'structure', site: 'in_cloud', output: { kind: 'fields', doc: parseDoc(raw), text: input.text, image: input.image }, raw,
      metrics: { latencyMs: t() - t0, costUsd: costUsd(CLOUD_MODEL, u.inputTokens, u.outputTokens), bytesSent: utf8Bytes(prompt), ...u } };
  },
};

/** Routes only low-confidence entities, with a de-identified transcript and NO image, to the cloud. */
export function hybridVerify(thresholds: RoutingThresholds): Stage {
  return {
    id: 'cloud-verify', name: 'Cloud verify (de-identified, low-confidence only)', kind: 'verify', accepts: ['fields'],
    async run(input: StageData): Promise<StageResult> {
      if (input.kind !== 'fields') throw new Error('fields required');
      const t0 = t();
      const source = input.text ?? '';
      const routed = routeDoc(input.doc, source, thresholds);
      const notes: string[] = [];
      if (routed.toCloud === 0) {
        notes.push('All entities accepted on-device; nothing sent.');
        return { stageId: this.id, stageKind: 'verify', site: 'local_code', output: input, notes, metrics: { latencyMs: t() - t0, costUsd: 0, bytesSent: 0 } };
      }
      const deid = deidentify(source);
      notes.push(`De-identified ${deid.total} identifiers before upload`);
      const prompt = `${STRUCTURE_PROMPT}${deid.text}\n\nOnly return entries for these items: ${JSON.stringify({
        medications: routed.meds.filter((m) => m.decision === 'send_to_cloud').map((m) => m.entity.name),
        labResults: routed.labs.filter((l) => l.decision === 'send_to_cloud').map((l) => l.entity.test),
      })}`;
      const r = await cloudJson().generateContent(prompt);
      const raw = r.response.text();
      const cloud = parseDoc(raw);
      const u = usage(r);
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
      return { stageId: this.id, stageKind: 'verify', site: 'in_cloud', output: { kind: 'fields', doc, text: input.text, image: input.image }, raw, notes,
        metrics: { latencyMs: t() - t0, costUsd: costUsd(CLOUD_MODEL, u.inputTokens, u.outputTokens), bytesSent: utf8Bytes(prompt), ...u } };
    },
  };
}

export function pipelines(thresholds: RoutingThresholds): Pipeline[] {
  return [
    { id: 'on-device-only', name: 'On-device only (Nano)', stages: [nanoRead, nanoStructure] },
    { id: 'cloud-only', name: `Cloud only (${CLOUD_MODEL})`, stages: [cloudRead, cloudStructure] },
    { id: 'hybrid', name: 'Hybrid (Nano + de-identified cloud verify)', stages: [nanoRead, nanoStructure, hybridVerify(thresholds)] },
  ];
}
