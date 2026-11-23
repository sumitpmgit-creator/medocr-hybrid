// Exposes window.medocrBench for the harness. Runs the REAL pipelines from apps/web/src/stages.ts
// through @med-ocr/core's runPipeline. Nothing here is mocked.
import { runPipeline, readingText, DEFAULT_THRESHOLDS, type RoutingThresholds } from '@med-ocr/core';
import { pipelines, prepareOnDevice } from '../../apps/web/src/stages.ts';
import { isConfigured, loadThresholds, CLOUD_MODEL } from '../../apps/web/src/firebase.ts';

const PIPELINE_FOR = { device: 'on-device-only', cloud: 'cloud-only', hybrid: 'hybrid' } as const;
type Mode = keyof typeof PIPELINE_FOR;

let thresholds: { value: RoutingThresholds; source: string } | undefined;
async function getThresholds() {
  if (!thresholds) {
    try { thresholds = { value: await loadThresholds(), source: 'remote-config (or its defaults)' }; }
    catch (e) { thresholds = { value: DEFAULT_THRESHOLDS, source: `core DEFAULT_THRESHOLDS (${(e as Error).message})` }; }
  }
  return thresholds;
}

let deviceReady: Promise<void> | undefined;

/** Which modes' pipelines contain an on-device (Nano) stage, read from the real pipeline definitions. */
function needsDevice(): Record<Mode, boolean> {
  const ps = pipelines(DEFAULT_THRESHOLDS);
  const out = {} as Record<Mode, boolean>;
  for (const m of Object.keys(PIPELINE_FOR) as Mode[]) {
    const p = ps.find((x) => x.id === PIPELINE_FOR[m]);
    out[m] = !!p && p.stages.some((s) => /^nano-/.test(s.id) || /on-device/i.test(s.name));
  }
  return out;
}
function pipelineDesc(): Record<Mode, string> {
  const ps = pipelines(DEFAULT_THRESHOLDS);
  const out = {} as Record<Mode, string>;
  for (const m of Object.keys(PIPELINE_FOR) as Mode[]) {
    const p = ps.find((x) => x.id === PIPELINE_FOR[m]);
    out[m] = p ? `${p.name}: ${p.stages.map((s) => s.id).join(' → ')}` : 'missing';
  }
  return out;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

(window as any).medocrBench = {
  /** Untimed: loads thresholds and, for device/hybrid, prepares Gemini Nano. Egress here is not attributed to any document. */
  async warmup(mode: Mode) {
    await getThresholds();
    if (needsDevice()[mode]) { deviceReady ??= prepareOnDevice(() => {}); await deviceReady; }
    return true;
  },
  async capabilities() {
    let nano = 'no LanguageModel global';
    try { if (typeof (globalThis as any).LanguageModel !== 'undefined') nano = await (globalThis as any).LanguageModel.availability({ expectedInputs: [{ type: 'image' }] }); } catch (e) { nano = String(e); }
    return {
      device: nano === 'available' || nano === 'downloadable' || nano === 'downloading', deviceReason: `LanguageModel.availability(image) = ${nano}`,
      cloud: isConfigured, cloudReason: isConfigured ? '' : 'Firebase web config missing: apps/web/.env.local not filled (see apps/web/.env.example)',
      cloudModel: CLOUD_MODEL,
      needsDevice: needsDevice(),
      pipelines: pipelineDesc(),
    };
  },
  async run(input: { id: string; bytes: Uint8Array; mimeType: string }, { mode }: { mode: Mode }) {
    if (input.mimeType !== 'image/png' && input.mimeType !== 'image/jpeg') throw new Error(`unsupported mimeType ${input.mimeType}`);
    if (needsDevice()[mode]) { deviceReady ??= prepareOnDevice(() => {}); await deviceReady; }
    const th = await getThresholds();
    const p = pipelines(th.value).find((x) => x.id === PIPELINE_FOR[mode])!;
    const run = await runPipeline(p, { kind: 'image', image: { mimeType: input.mimeType, base64: b64(input.bytes) } }, { docId: input.id });
    if (run.failed) throw new Error(`pipeline ${p.id} failed: ${run.error}`);
    const cloudSteps = run.steps.filter((s) => s.site === 'in_cloud');
    return {
      text: readingText(run) ?? '',
      fields: run.final.kind === 'fields' ? run.final.doc : undefined,
      route: cloudSteps.length ? (run.steps.some((s) => s.site === 'on_device') ? 'device+cloud' : 'cloud') : 'device',
      // Text output of every stage, so the harness can score raw OCR and check de-id output by stage name.
      steps: run.steps.map((s) => ({ stageId: s.stageId, stageKind: s.stageKind, site: s.site,
        text: s.output.kind === 'text' ? s.output.text : s.output.kind === 'fields' ? s.output.text : undefined })),
      stages: run.steps.map((s) => ({ name: s.stageId, where: s.site, score: s.confidence, ms: s.metrics.latencyMs, notes: s.notes })),
      usage: cloudSteps.map((s) => ({ model: CLOUD_MODEL, promptTokens: s.metrics.inputTokens ?? 0, outputTokens: s.metrics.outputTokens ?? 0 })),
      selfReported: { ...run.totals, thresholds: th.source },
    };
  },
};
document.getElementById('log')!.textContent = 'medocrBench ready';
