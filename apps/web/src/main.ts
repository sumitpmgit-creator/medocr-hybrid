// SPDX-License-Identifier: Apache-2.0
import { runPipeline, scoreRun, ErrorRegister, type ClinicalDoc, type ImagePayload, type PipelineRun, type Reference } from '@med-ocr/core';
import { isConfigured, loadThresholds, saveRunSummary } from './firebase';
import { cloudSafetyForPipeline, pipelinesForUi, prepareOnDevice } from './stages';
import { fileToImage } from './pdf';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
let image: ImagePayload | undefined;

if (!isConfigured) status.textContent = 'Firebase not configured: fill apps/web/.env.local (see .env.example).';

$('init').addEventListener('click', async () => {
  try {
    status.textContent = 'Preparing on-device model…';
    await prepareOnDevice((p) => (status.textContent = `Downloading Gemini Nano ${(p * 100).toFixed(0)}%`));
    status.textContent = 'On-device model ready';
  } catch (e) {
    status.textContent = `On-device unavailable: ${(e as Error).message}. Use Chrome desktop 139+ with chrome://flags/#prompt-api-for-gemini-nano-multimodal-input enabled.`;
  }
});

$<HTMLInputElement>('file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  image = await fileToImage(f);
  $<HTMLImageElement>('preview').src = `data:${image.mimeType};base64,${image.base64}`;
  $<HTMLButtonElement>('run').disabled = false;
});

function card(run: PipelineRun, name: string, ref: Reference): string {
  const s = scoreRun(run, ref, new ErrorRegister());
  const fmt = (n?: number) => (n === undefined ? '—' : (n * 100).toFixed(1) + '%');
  const final = run.final.kind === 'fields' ? run.final.doc : undefined;
  return `<div class="card"><h2>${name}</h2><table>
    <tr><td>CER</td><td>${fmt(s.cer)}</td></tr>
    <tr><td>WER</td><td>${fmt(s.wer)}</td></tr>
    <tr><td>Field F1</td><td>${fmt(s.fieldF1)}</td></tr>
    <tr><td>Safety screen</td><td>${s.passesSafetyScreen === undefined ? '—' : s.passesSafetyScreen ? 'pass' : 'FAIL'}</td></tr>
    <tr><td>Latency</td><td>${s.latencyMs.toFixed(0)} ms</td></tr>
    <tr><td>Bytes left device</td><td>${s.bytesSent.toLocaleString()}</td></tr>
    <tr><td>Cost (USD)</td><td>${s.costUsd.toFixed(5)}</td></tr>
    <tr><td>Stages</td><td>${run.steps.map((x) => `${x.stageId} (${x.site})`).join(' → ')}</td></tr>
  </table>
  ${run.error ? `<p class="human">Error: ${run.error}</p>` : ''}
  ${(final?.abstentions ?? []).map((a) => `<p class="human">${a}</p>`).join('')}
  <pre>${final ? JSON.stringify({ medications: final.medications, labResults: final.labResults }, null, 1) : ''}</pre></div>`;
}

$('run').addEventListener('click', async () => {
  if (!image) return;
  const results = $('results');
  results.innerHTML = 'Running…';
  const refText = $<HTMLTextAreaElement>('refText').value.trim() || undefined;
  let refDoc: ClinicalDoc | undefined;
  try { const j = $<HTMLTextAreaElement>('refJson').value.trim(); if (j) refDoc = JSON.parse(j); } catch { alert('Reference JSON is invalid'); }
  const ref: Reference = { docId: 'upload', text: refText, doc: refDoc };
  const thresholds = await loadThresholds().catch(() => ({ acceptOnDevice: 0.85, humanReview: 0.5 }));
  const cards: string[] = [];
  for (const p of pipelinesForUi(thresholds, { source: 'upload' })) {
    const run = await runPipeline(p, { kind: 'image', image }, { docId: 'upload', cloudSafety: cloudSafetyForPipeline(p) });
    cards.push(card(run, p.name, ref));
    results.innerHTML = cards.join('');
    const s = scoreRun(run, ref);
    saveRunSummary({ pipelineId: p.id, cer: s.cer ?? null, wer: s.wer ?? null, fieldF1: s.fieldF1 ?? null, latencyMs: s.latencyMs, bytesSent: s.bytesSent, costUsd: s.costUsd, failed: run.failed }).catch(() => {});
  }
});
