// SPDX-License-Identifier: Apache-2.0
import type { BBox, ImagePayload } from '@med-ocr/core';

export interface PixelBox { sx: number; sy: number; sw: number; sh: number }

/** Convert a core normalised box (or a already-pixel box) into canvas source pixels. */
export function boxToPixels(box: BBox, width: number, height: number): PixelBox {
  const normalized = box.x <= 1 && box.y <= 1 && box.w <= 1 && box.h <= 1;
  const x = normalized ? box.x * width : box.x;
  const y = normalized ? box.y * height : box.y;
  const w = normalized ? box.w * width : box.w;
  const h = normalized ? box.h * height : box.h;
  const sx = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const sw = Math.max(1, Math.min(width - sx, Math.ceil(w)));
  const sh = Math.max(1, Math.min(height - sy, Math.ceil(h)));
  return { sx, sy, sw, sh };
}

export function imagePayloadToDataUrl(image: ImagePayload): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

/** Crop a region from a data URL. Returns the original image if the box is missing or cropping fails. */
export async function cropToDataUrl(dataUrl: string, box: BBox | undefined, width?: number, height?: number): Promise<string> {
  if (!box) return dataUrl;
  if (typeof document === 'undefined') return dataUrl;
  const img = await loadImage(dataUrl);
  const w = width ?? img.naturalWidth;
  const h = height ?? img.naturalHeight;
  const { sx, sy, sw, sh } = boxToPixels(box, w, h);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for crop'));
    img.src = dataUrl;
  });
}
