// SPDX-License-Identifier: Apache-2.0
/**
 * Public benchmark documents that already have ground-truth transcriptions.
 * Served from /datasets/ by the Vite plugin (dev and preview).
 */
import type { ImagePayload, Reference } from '@med-ocr/core';
import { blobToImagePayload } from './pdf';

export interface CatalogDoc {
  id: string;
  dataset: string;
  label: string;
  license: string;
  imageUrl: string;
  reference: Reference;
}

interface ManifestRow {
  id?: string;
  document_id?: string;
  dataset?: string;
  imagePath?: string;
  image_path?: string;
  referenceText?: string;
  reference_text?: string;
  license?: string;
  documentType?: string;
  document_type?: string;
}

function rowToDoc(row: ManifestRow): CatalogDoc | undefined {
  const id = row.id ?? row.document_id;
  const imagePath = row.imagePath ?? row.image_path;
  const referenceText = row.referenceText ?? row.reference_text;
  if (!id || !imagePath || !referenceText) return undefined;
  return {
    id,
    dataset: row.dataset ?? 'unknown',
    label: id,
    license: row.license ?? '',
    imageUrl: '/' + imagePath.replace(/^\//, ''),
    reference: { docId: id, text: referenceText },
  };
}

export async function loadManifest(url: string): Promise<CatalogDoc[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  const docs: CatalogDoc[] = [];
  for (const line of (await res.text()).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as ManifestRow;
    const doc = rowToDoc(row);
    if (doc) docs.push(doc);
  }
  return docs;
}

/** African Medical Records: English clinical notes with transcriptions (3 docs in-repo). */
export async function loadAmrCatalog(): Promise<CatalogDoc[]> {
  return loadManifest('/datasets/amr/manifest.jsonl');
}

export async function fetchCatalogImage(doc: CatalogDoc): Promise<ImagePayload> {
  const res = await fetch(doc.imageUrl);
  if (!res.ok) throw new Error(`Could not load ${doc.imageUrl}: ${res.status}`);
  const blob = await res.blob();
  const mime = blob.type || (doc.imageUrl.endsWith('.jpg') || doc.imageUrl.endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
  return blobToImagePayload(blob, mime);
}
