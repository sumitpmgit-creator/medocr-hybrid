// SPDX-License-Identifier: Apache-2.0
/** Render the demo lab sheet to a PNG so field crops have something to show. */
import type { ImagePayload } from '@med-ocr/core';
import { SAMPLE_TRANSCRIPT } from './mock';

export function renderDemoSampleImage(): ImagePayload {
  const width = 800;
  const height = 1100;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.fillStyle = '#f8f4ea';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1f2933';
  ctx.font = '600 28px "Palatino Linotype", "Times New Roman", serif';
  ctx.fillText('Sunrise Diagnostics', 48, 64);
  ctx.font = '16px "Palatino Linotype", "Times New Roman", serif';
  const lines = SAMPLE_TRANSCRIPT.trim().split('\n');
  let y = 110;
  for (const line of lines) {
    ctx.fillText(line, 48, y);
    y += 28;
  }
  ctx.strokeStyle = '#c4b89a';
  ctx.strokeRect(24, 24, width - 48, height - 48);
  return {
    mimeType: 'image/png',
    base64: canvas.toDataURL('image/png').split(',')[1]!,
    width,
    height,
  };
}
