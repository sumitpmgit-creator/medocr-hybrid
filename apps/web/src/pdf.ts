// SPDX-License-Identifier: Apache-2.0
/** Nano cannot read PDFs: render page 1 to PNG with pdf.js first. */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ImagePayload } from '@med-ocr/core';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfFirstPageToPng(file: File, scale = 2): Promise<ImagePayload> {
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
  return { mimeType: 'image/png', base64: canvas.toDataURL('image/png').split(',')[1]!, width: canvas.width, height: canvas.height };
}

export async function fileToImage(file: File): Promise<ImagePayload> {
  if (file.type === 'application/pdf') return pdfFirstPageToPng(file);
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('Nano accepts only PNG or JPEG');
  const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  return { mimeType: file.type, base64: dataUrl.split(',')[1]! };
}
