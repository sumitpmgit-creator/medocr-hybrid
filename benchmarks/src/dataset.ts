import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
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
}

export class DatasetUnavailable extends Error {}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' };
export function mimeOf(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
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
    if (!s.id || !s.image) throw new DatasetUnavailable(`manifest line ${i + 1} lacks id or image`);
    if (!existsSync(join(dir, s.image))) throw new DatasetUnavailable(`manifest line ${i + 1}: image ${s.image} missing`);
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
