// SPDX-License-Identifier: Apache-2.0
/**
 * Core data model shared by the hackathon app and the SoalTech portal.
 * Every model or processing step is a Stage; a Pipeline is an ordered chain of Stages.
 */

/** Normalised bounding box (0..1 of image width/height). */
export interface BBox { x: number; y: number; w: number; h: number }

export interface TextSpan { text: string; bbox?: BBox; confidence?: number }

export interface ImagePayload {
  mimeType: 'image/png' | 'image/jpeg';
  /** base64 without the data: prefix */
  base64: string;
  width?: number;
  height?: number;
}

export type DocumentType = 'prescription' | 'lab_report' | 'discharge_summary' | 'other';

export interface Medication {
  name: string;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  dose?: string | null;
  route?: string | null;
  /** Canonical form like 1-0-1 when derivable */
  frequency?: string | null;
  timing?: string | null;
  duration?: string | null;
  quantity?: string | null;
  instructions?: string | null;
  confidence?: number;
  sourceText?: string;
  bbox?: BBox;
}

export interface LabResult {
  test: string;
  value: string;
  unit?: string | null;
  referenceRange?: string | null;
  flag?: 'high' | 'low' | 'normal' | 'abnormal' | null;
  confidence?: number;
  sourceText?: string;
  bbox?: BBox;
}

export interface ClinicalDoc {
  documentType: DocumentType;
  medications: Medication[];
  labResults: LabResult[];
  /** Free-form uncertain items the model refused to guess (safe abstention). */
  abstentions?: string[];
}

/** What flows between stages. */
export type StageData =
  | { kind: 'image'; image: ImagePayload }
  | { kind: 'text'; text: string; spans?: TextSpan[]; image?: ImagePayload }
  | { kind: 'fields'; doc: ClinicalDoc; text?: string; image?: ImagePayload };

export type StageKind = 'ocr' | 'structure' | 'ocr+structure' | 'deid' | 'verify' | 'route';

/** Where the stage actually executed. on_device/in_cloud mirror Firebase AI Logic's InferenceSource. */
export type ExecutionSite = 'on_device' | 'in_cloud' | 'local_code' | 'server_gpu' | 'human';

export interface StageMetrics {
  latencyMs: number;
  /** USD; 0 for on-device */
  costUsd: number;
  /** UTF-8 bytes of payload that left the device for this stage (0 if on-device) */
  bytesSent: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface StageResult {
  stageId: string;
  stageKind: StageKind;
  site: ExecutionSite;
  output: StageData;
  /** Overall self/heuristic confidence 0..1 */
  confidence?: number;
  metrics: StageMetrics;
  /** Model raw text, for audit */
  raw?: string;
  error?: string;
  notes?: string[];
}

export interface StageContext {
  runId: string;
  docId: string;
  signal?: AbortSignal;
  /** Free-form config, e.g. thresholds pulled from Remote Config */
  config?: Record<string, unknown>;
}

export interface Stage {
  id: string;
  name: string;
  kind: StageKind;
  /** Accepted input kinds */
  accepts: StageData['kind'][];
  run(input: StageData, ctx: StageContext): Promise<StageResult>;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

export interface PipelineRun {
  runId: string;
  pipelineId: string;
  docId: string;
  startedAt: string;
  steps: StageResult[];
  final: StageData;
  totals: StageMetrics;
  failed: boolean;
  error?: string;
}

/** Ground truth for one document. Either part may be missing (e.g. EkaCare has rubrics, not transcriptions). */
export interface Reference {
  docId: string;
  text?: string;
  doc?: ClinicalDoc;
  rubrics?: string[];
}

export interface DatasetItem {
  id: string;
  dataset: string;
  /** Dataset revision (e.g. HF commit sha) */
  datasetVersion: string;
  license: string;
  imagePath: string;
  documentType?: string;
  referenceText?: string;
  rubrics?: string[];
  prompt?: string;
  handwritten?: boolean;
}
