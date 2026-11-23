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
  const rawImage: string | undefined = r.image ?? r.imagePath;
  let image = '';
  if (rawImage) {
    const a = isAbsolute(rawImage) ? rawImage : join(dir, rawImage);
    const b = isAbsolute(rawImage) ? rawImage : join(repoRoot, rawImage);
    image = existsSync(a) ? a : b;
  }
  return {
    id: r.id, image,
    document_type: r.document_type ?? r.documentType,
    reference_text: r.reference_text ?? r.referenceText,
    fields: r.fields ?? r.referenceDoc ?? r.doc,
    rubrics: r.rubrics,
    phi: r.phi,
  };
}

export function loadDataset(dir: string, limit?: number): { samples: Sample[]; manifestSha256: string; manifestPath: string } {
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
  return {
    samples: limit ? samples.slice(0, limit) : samples,
    manifestSha256: createHash('sha256').update(raw).digest('hex'),
    manifestPath,
  };
}
