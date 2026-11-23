import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * One benchmark sample. Ground-truth contract for datasets/<name>/manifest.jsonl (one JSON object per line).
 * See benchmarks/CONTRACT.md.
 */
export interface Sample {
  id: string;
  image: string;            // path relative to the dataset dir
  document_type?: string;   // e.g. lab_report | prescription
  reference_text?: string;  // full-page transcript -> enables CER/WER
  fields?: Record<string, unknown>; // structured ground truth -> enables field accuracy
  rubrics?: unknown;        // EkaCare rubric list (carried through, not scored here)
  phi?: { type: any; value: string }[]; // optional structured identifiers for the de-id leak check
  reference_type?: string;
  annotation_issues?: string[];
  language?: string[];
}

export class DatasetUnavailable extends Error {}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' };
export function mimeOf(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Accepts both the harness format (image relative to the dataset dir, reference_text, fields) and
 * Rachel's importer format = core DatasetItem (imagePath relative to the repo root, referenceText,
 * rubrics, optional referenceDoc = core ClinicalDoc). Returns image as an absolute path.
 */
function normalizeItem(r: any, dir: string): Sample {
  const repoRoot = resolve(dir, '..', '..');
  const rawImage: string | undefined = r.image ?? r.imagePath ?? r.image_path;
  let image = '';
  if (rawImage) {
    const a = isAbsolute(rawImage) ? rawImage : join(dir, rawImage);
    const b = isAbsolute(rawImage) ? rawImage : join(repoRoot, rawImage);
    image = existsSync(a) ? a : b;
  }
  // reference_type 'none' (e.g. bilingual bmpd-1-0186) means there is no transcription to score.
  const refType = r.reference_type ?? r.referenceType;
  const refText = refType === 'none' ? undefined : (r.reference_text ?? r.referenceText);
  return {
    id: r.id ?? r.document_id, image,
    reference_type: refType,
    annotation_issues: r.annotation_issues,
    language: r.language,
    document_type: r.document_type ?? r.documentType,
    reference_text: refText,
    fields: r.fields ?? r.referenceDoc ?? r.doc,
    rubrics: r.rubrics,
    phi: r.phi,
  };
}

export interface Exclusion { id: string; reason: string }

/** Explicit, documented exclusions from benchmarks/exclusions.json, keyed by dataset path relative to the repo root. */
export function loadExclusions(file: string, datasetRel: string): Exclusion[] {
  if (!existsSync(file)) return [];
  const all = JSON.parse(readFileSync(file, 'utf8'));
  const xs = (all[datasetRel] ?? []) as Exclusion[];
  for (const x of xs) if (!x.id || !x.reason) throw new Error(`exclusions.json: every exclusion for ${datasetRel} needs id and reason`);
  return xs;
}

export function loadDataset(dir: string, limit?: number, exclusions: Exclusion[] = []): { samples: Sample[]; manifestSha256: string; manifestPath: string; manifestCount: number; excluded: (Exclusion & { found: boolean })[] } {
  const manifestPath = join(dir, 'manifest.jsonl');
  if (!existsSync(dir)) throw new DatasetUnavailable(`dataset dir ${dir} does not exist`);
  if (!existsSync(manifestPath)) {
    const present = readdirSync(dir).join(', ') || '(empty)';
    throw new DatasetUnavailable(`${manifestPath} not found (dir contains: ${present}). The EkaCare images and ground truth have not been imported yet.`);
  }
  const raw = readFileSync(manifestPath, 'utf8');
  const samples: Sample[] = [];
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let s: Sample;
    try { s = JSON.parse(line); } catch (e) { throw new DatasetUnavailable(`manifest line ${i + 1} is not JSON: ${(e as Error).message}`); }
    s = normalizeItem(s as any, dir);
    if (!s.id || !s.image) throw new DatasetUnavailable(`manifest line ${i + 1} lacks id or image/imagePath`);
    if (!existsSync(s.image)) throw new DatasetUnavailable(`manifest line ${i + 1}: image ${s.image} missing`);
    samples.push(s);
  });
  if (samples.length === 0) throw new DatasetUnavailable(`${manifestPath} has no samples`);
  samples.sort((a, b) => a.id.localeCompare(b.id));
  const manifestCount = samples.length;
  const ex = new Map(exclusions.map((x) => [x.id, x]));
  const excluded = exclusions.map((x) => ({ ...x, found: samples.some((s) => s.id === x.id) }));
  const kept = samples.filter((s) => !ex.has(s.id));
  return {
    manifestCount,
    excluded,
    samples: limit ? kept.slice(0, limit) : kept,
    manifestSha256: createHash('sha256').update(raw).digest('hex'),
    manifestPath,
  };
}
