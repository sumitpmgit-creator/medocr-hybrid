// SPDX-License-Identifier: Apache-2.0
/**
 * Render a user-chosen PDF page to a PNG ImagePayload with pdf.js.
 * Nano cannot read PDFs directly.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ImagePayload } from '@med-ocr/core';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfDocumentHandle {
  pageCount: number;
  renderPage(pageNumber: number, scale?: number): Promise<ImagePayload>;
  destroy(): void;
}

export async function loadPdf(file: File): Promise<PdfDocumentHandle> {
  // pdfjs-dist 6.x: destroy() lives on PDFDocumentLoadingTask, not PDFDocumentProxy.
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await loadingTask.promise;
  return {
    pageCount: doc.numPages,
    async renderPage(pageNumber, scale = 2) {
      if (pageNumber < 1 || pageNumber > doc.numPages) {
        throw new Error(`PDF has ${doc.numPages} page(s); asked for ${pageNumber}`);
      }
      const page = await doc.getPage(pageNumber);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
      return {
        mimeType: 'image/png',
        base64: canvas.toDataURL('image/png').split(',')[1]!,
        width: canvas.width,
        height: canvas.height,
      };
    },
    destroy() {
      void loadingTask.destroy();
    },
  };
}

export async function imageFileToPayload(file: File): Promise<ImagePayload> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    throw new Error('Nano accepts only PNG or JPEG images (render PDFs to PNG first)');
  }
  const dataUrl = await readDataUrl(file);
  const img = await loadImage(dataUrl);
  return { mimeType: file.type, base64: dataUrl.split(',')[1]!, width: img.naturalWidth, height: img.naturalHeight };
}

/** Images are used as-is; PDFs default to page 1 until the picker chooses another. */
export async function fileToImage(file: File): Promise<ImagePayload> {
  if (file.type === 'application/pdf') {
    const pdf = await loadPdf(file);
    try {
      return await pdf.renderPage(1);
    } finally {
      pdf.destroy();
    }
  }
  return imageFileToPayload(file);
}

export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });
}

export function asImageMime(value: string | undefined): ImagePayload['mimeType'] {
  return value === 'image/jpeg' || value === 'image/jpg' || value === 'image/pjpeg' ? 'image/jpeg' : 'image/png';
}

export async function blobToImagePayload(blob: Blob, mimeType?: string): Promise<ImagePayload> {
  const type = asImageMime(mimeType ?? blob.type);
  const dataUrl = await readDataUrl(blob);
  const img = await loadImage(dataUrl);
  return { mimeType: type, base64: dataUrl.split(',')[1]!, width: img.naturalWidth, height: img.naturalHeight };
}
