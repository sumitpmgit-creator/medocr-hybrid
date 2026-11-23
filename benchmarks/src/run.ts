#!/usr/bin/env node
// MedOCR Hybrid benchmark harness. Usage: see benchmarks/README.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import os from 'node:os';
import { loadDataset, loadExclusions, mimeOf, DatasetUnavailable, type Sample } from './dataset.ts';
import { charErrors, wordErrors, rate, scoreFields, percentile, mean } from './metrics.ts';
import { loadPricing, costOf } from './cost.ts';
import { extractPhi, findLeaks, maskValue } from './phi.ts';
import { pickOcr, pickDeid } from './stage-select.ts';

/** JSON request bodies: scan the decoded string values, not the escaped JSON text. */
function bodyStrings(b: string): string {
  try {
    const out: string[] = [];
    const walk = (v: any) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(JSON.parse(b));
    return out.join('\n');
  } catch { return b; }
}
import { renderResultsPage } from './report.ts';
import { MODES, type Mode, type Driver, type Blocker } from './types.ts';
import { NodeDriver } from './drivers/node.ts';
import { BrowserDriver } from './drivers/browser.ts';
import { MockDriver } from './drivers/mock.ts';

const BENCH = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(BENCH, '..');

const { values: a } = parseArgs({
  options: {
    modes: { type: 'string', default: 'device,cloud,hybrid' },
    driver: { type: 'string', default: 'node' },                    // node | browser
    pipeline: { type: 'string', default: 'packages/core/src/index.ts' },
    dataset: { type: 'string', default: 'datasets/amr' }, // AMR has transcriptions (CER/WER); EkaCare has none
    limit: { type: 'string' },
    'app-url': { type: 'string', default: 'http://localhost:5174/bench.html' },
    'no-serve': { type: 'boolean', default: false },
    chrome: { type: 'string', default: process.env.CHROME_PATH ?? 'google-chrome' },
    // Browser profile (cookies, Nano model download) must live OUTSIDE the public repo tree.
    'chrome-profile': { type: 'string', default: process.env.MEDOCR_CHROME_PROFILE ?? '/workspace/sage-chrome-profile' },
    headless: { type: 'boolean', default: false },
    'self-test': { type: 'boolean', default: false },
    'no-results-md': { type: 'boolean', default: false },
  },
});

const selfTest = a['self-test']!;
{
  const prof = resolve(a['chrome-profile']!);
  if (prof === ROOT || prof.startsWith(ROOT + '/')) {
    console.error(`refusing --chrome-profile ${prof}: browser profiles must not live inside ${ROOT} (public repo)`);
    process.exit(2);
  }
}
const modes = a.modes!.split(',').map((s) => s.trim()) as Mode[];
for (const m of modes) if (!MODES.includes(m)) throw new Error(`unknown mode ${m}`);
const datasetDir = selfTest ? join(BENCH, 'selftest/fixtures') : resolve(ROOT, a.dataset!);
const limit = a.limit ? Number(a.limit) : undefined;
const pricing = loadPricing(join(BENCH, 'pricing.json'));

const startedAt = new Date();
const result: any = {
  schema_version: 1,
  kind: selfTest ? 'harness-self-test' : 'benchmark',
  ...(selfTest ? { WARNING: 'HARNESS SELF-TEST with a mock pipeline and synthetic fixtures. These numbers are NOT benchmark results.' } : {}),
  started_at: startedAt.toISOString(),
  finished_at: null,
  argv: process.argv.slice(2),
  environment: { node: process.version, os: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length, ram_gb: Math.round((os.totalmem() / 2 ** 30) * 10) / 10 },
  dataset: { path: relative(ROOT, datasetDir) },
  pricing,
  modes: {} as Record<string, any>,
};

let samples: Sample[] = [];
let datasetBlocker: Blocker | null = null;
try {
  const exclusions = selfTest ? [] : loadExclusions(join(BENCH, 'exclusions.json'), relative(ROOT, datasetDir));
  const d = loadDataset(datasetDir, limit, exclusions);
  samples = d.samples;
  for (const x of d.excluded) if (!x.found) console.warn(`warning: exclusion ${x.id} not found in ${relative(ROOT, datasetDir)}`);
  Object.assign(result.dataset, { manifest_sha256: d.manifestSha256, manifest_records: d.manifestCount, excluded: d.excluded, n_samples: samples.length, limit: limit ?? null,
    without_reference: samples.filter((s) => !s.reference_text).map((s) => ({ id: s.id, reference_type: s.reference_type ?? null })),
    with_reference_text: samples.filter((s) => s.reference_text).length, with_fields: samples.filter((s) => s.fields).length });
} catch (e) {
  if (!(e instanceof DatasetUnavailable)) throw e;
  datasetBlocker = { reason: e.message + (relative(ROOT, datasetDir) === 'datasets/ekacare' ? ' Run `HF_TOKEN=hf_... python3 scripts/import_datasets.py ekacare --limit 20` (needs pyarrow) after clicking "Agree" on the gated HF page ekacare/medical_records_parsing_validation_set.' : ' Import it with scripts/import_datasets.py (manifest format: benchmarks/CONTRACT.md).'), owner: 'Rachel (datasets/); the gated HF terms need an account that has clicked Agree' };
  result.dataset.error = 'dataset not imported';
}

let driver: Driver;
if (selfTest) driver = new MockDriver(new Map(samples.map((s) => [s.id, s])));
else if (a.driver === 'browser') driver = new BrowserDriver({ appUrl: a['app-url']!, chrome: a.chrome!, profile: a['chrome-profile']!, port: 9400 + Math.floor(Math.random() * 500), headless: a.headless!, appOwner: 'Avenger (apps/web)',
  serve: a['no-serve'] ? undefined : { cmd: join(ROOT, 'apps/web/node_modules/.bin/vite'), args: ['--config', join(BENCH, 'web/vite.config.mjs')], cwd: join(BENCH, 'web') } });
else driver = new NodeDriver(resolve(ROOT, a.pipeline!), 'Louis (packages/core)');

for (const mode of modes) {
  const blockers: Blocker[] = [];
  if (datasetBlocker) blockers.push(datasetBlocker);
  blockers.push(...(await driver.preflight(mode)));
  if (blockers.length) {
    result.modes[mode] = { status: 'NOT RUN', blockers };
    console.log(`[${mode}] NOT RUN`);
    for (const b of blockers) console.log(`   - ${b.reason} (owner: ${b.owner})`);
    continue;
  }
  if (driver.warmup) {
    try { await driver.warmup(mode); }
    catch (e) {
      result.modes[mode] = { status: 'NOT RUN', blockers: [{ reason: `warm-up failed: ${(e as Error).message.split('\n')[0]}`, owner: mode === 'cloud' ? 'Avenger (apps/web) / Sumit (Firebase project)' : 'Avenger (apps/web) / Sumit (eligible machine)' }] };
      console.log(`[${mode}] NOT RUN (warm-up failed: ${(e as Error).message.split('\n')[0]})`);
      continue;
    }
  }
  console.log(`[${mode}] running ${samples.length} documents…`);
  const per: any[] = [];
  for (const s of samples) {
    const bytesIn = readFileSync(s.image);
    const rec: any = { id: s.id, document_type: s.document_type ?? null };
    try {
      const r = await driver.run(mode, { id: s.id, bytes: new Uint8Array(bytesIn), mimeType: mimeOf(s.image) });
      rec.ok = true;
      rec.latency_ms = r.wallMs;
      rec.route = r.output.route ?? null;
      rec.self_reported = (r.output as any).selfReported ?? null;
      rec.stages = r.output.stages ?? null;
      rec.egress = r.egress;
      const ocr = pickOcr(r.output.steps, r.output.text);
      rec.ocr_text_source = ocr.source;
      if (s.reference_text !== undefined && ocr.text !== undefined) { rec.char = charErrors(ocr.text, s.reference_text); rec.word = wordErrors(ocr.text, s.reference_text); }
      // De-id leak check (values are masked before anything is persisted).
      const phi = extractPhi({ referenceText: s.reference_text, phi: s.phi as any });
      const deid = pickDeid(r.output.steps);
      const bodies = (r.egressBodies ?? []).map(bodyStrings);
      const leakDeid = deid.texts.length ? findLeaks(phi, deid.texts) : null;
      const leakEgress = r.egressBodies ? findLeaks(phi, bodies) : null;
      const b64head = Buffer.from(bytesIn).toString('base64').slice(0, 96);
      rec.deid = {
        phi_items: phi.length,
        phi_types: phi.reduce((m: any, i) => ((m[i.type] = (m[i.type] ?? 0) + 1), m), {}),
        deid_stages: deid.stageIds,
        leaks_in_deid_output: leakDeid === null ? null : leakDeid.map(maskValue),
        leaks_in_cloud_payloads: leakEgress === null ? null : leakEgress.map(maskValue),
        image_uploaded: r.egressBodies ? bodies.some((b) => b.includes(b64head)) : null,
      };
      if (s.fields !== undefined) { const f = scoreFields(r.output.fields, s.fields); rec.fields = { correct: f.correct, total: f.total, misses: f.fields.filter((x) => !x.match) }; }
      rec.usage = r.output.usage ?? [];
      const c = costOf(r.output.usage, r.egress.requests, pricing);
      rec.cost_usd = c.usd; if (c.reason) rec.cost_note = c.reason;
    } catch (e) {
      rec.ok = false;
      rec.error = String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ');
    }
    per.push(rec);
    process.stdout.write(rec.ok ? '.' : 'x');
  }
  process.stdout.write('\n');
  const ok = per.filter((p) => p.ok);
  const lat = ok.map((p) => p.latency_ms);
  const fTot = ok.reduce((t, p) => t + (p.fields?.total ?? 0), 0);
  const costs = ok.map((p) => p.cost_usd);
  const caveats: string[] = [];
  if (ok.length && !ok.some((p) => p.char)) caveats.push('no reference_text in ground truth, so CER/WER are not computed');
  if (costs.some((c) => c === null)) caveats.push(`${costs.filter((c) => c === null).length} documents had unknown cost (no token usage reported); cost columns blank`);
  if (ok.some((p) => p.egress.unmeasuredBodies)) caveats.push('some request bodies could not be measured; bytes sent is a lower bound');
  if (mode === 'device' && ok.some((p) => p.egress.requests > 0)) caveats.push(`PRIVACY: on-device mode made ${ok.reduce((t, p) => t + p.egress.requests, 0)} non-loopback requests — file a bug`);
  const sumLeaks = (k: 'leaks_in_deid_output' | 'leaks_in_cloud_payloads') => {
    const docs = ok.filter((p) => p.deid?.[k] !== null && p.deid?.[k] !== undefined);
    if (docs.length === 0) return null;
    const items = docs.reduce((t, p) => t + p.deid.phi_items, 0);
    const leaks = docs.flatMap((p) => p.deid[k]);
    return { docs_checked: docs.length, phi_items: items, leaks: leaks.length, leak_rate: items ? leaks.length / items : null,
      docs_with_leak: docs.filter((p) => p.deid[k].length > 0).length,
      leaked_types: leaks.reduce((m: any, l: any) => ((m[l.type] = (m[l.type] ?? 0) + 1), m), {}) };
  };
  const deidSummary = {
    phi_items: ok.reduce((t, p) => t + (p.deid?.phi_items ?? 0), 0),
    deid_stage_present_docs: ok.filter((p) => p.deid?.deid_stages?.length).length,
    in_deid_output: sumLeaks('leaks_in_deid_output'),
    in_cloud_payloads: sumLeaks('leaks_in_cloud_payloads'),
    full_image_uploaded_docs: ok.filter((p) => p.deid?.image_uploaded).length,
    ocr_text_sources: ok.reduce((m: any, p) => ((m[p.ocr_text_source] = (m[p.ocr_text_source] ?? 0) + 1), m), {}),
  };
  if (ok.length && deidSummary.deid_stage_present_docs === 0) caveats.push('no de-id stage in this pipeline\'s trace, so the de-id output leak check is not available (cloud-payload check still applies)');
  if (deidSummary.full_image_uploaded_docs) caveats.push(`full document image uploaded to the cloud for ${deidSummary.full_image_uploaded_docs}/${ok.length} documents: every identifier in the image leaves the device (not counted in text leak numbers)`);
  if (ok.some((p) => !String(p.ocr_text_source).startsWith('stage:'))) caveats.push('CER/WER fell back to output.text for some documents (no OCR stage in trace)');
  const summary = {
    deid: deidSummary,
    docs: per.length, docs_ok: ok.length, errors: per.length - ok.length,
    cer_wer_docs_scored: ok.filter((p) => p.char).length,
    cer: rate(ok.filter((p) => p.char).map((p) => p.char)),
    wer: rate(ok.filter((p) => p.word).map((p) => p.word)),
    field_accuracy: fTot ? ok.reduce((t, p) => t + (p.fields?.correct ?? 0), 0) / fTot : null,
    latency_ms_p50: percentile(lat, 50), latency_ms_p95: percentile(lat, 95), latency_ms_mean: mean(lat),
    cost_usd_per_doc: costs.length && costs.every((c) => c !== null) ? mean(costs as number[]) : null,
    bytes_sent_per_doc: mean(ok.map((p) => p.egress.bytes)),
    cloud_requests_per_doc: mean(ok.map((p) => p.egress.requests)),
    route_counts: ok.reduce((m: any, p) => ((m[p.route ?? 'unknown'] = (m[p.route ?? 'unknown'] ?? 0) + 1), m), {}),
    caveats,
  };
  // A mode where nothing succeeded is a failure, not a result.
  result.modes[mode] = ok.length === 0
    ? { status: 'FAILED', blockers: [{ reason: `all ${per.length} documents errored; first: ${per[0]?.error}`, owner: a.driver === 'browser' ? 'Avenger (apps/) / Louis (packages/core)' : 'Louis (packages/core)' }], samples: per }
    : { status: 'RAN', summary, samples: per };
  console.log(`[${mode}] ${result.modes[mode].status}`, ok.length ? JSON.stringify({ cer: summary.cer, wer: summary.wer, field_accuracy: summary.field_accuracy, p50: summary.latency_ms_p50, p95: summary.latency_ms_p95, cost: summary.cost_usd_per_doc, bytes: summary.bytes_sent_per_doc }) : '');
}

Object.assign(result.environment, await driver.environment());
await driver.close();
result.finished_at = new Date().toISOString();

const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const outDir = join(BENCH, 'results', selfTest ? 'selftest' : '');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${stamp}.json`);
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(`wrote ${relative(ROOT, outPath)}`);

if (!selfTest && !a['no-results-md']) {
  // One section per dataset, each from that dataset's most recent real (non-self-test) run.
  const resDir = join(BENCH, 'results');
  const latest = new Map<string, { file: string; r: any }>();
  for (const f of readdirSync(resDir).filter((f) => f.endsWith('.json')).sort()) {
    const r = JSON.parse(readFileSync(join(resDir, f), 'utf8'));
    if (r.kind !== 'benchmark' || r.argv?.includes('--no-results-md')) continue;
    latest.set(r.dataset.path, { file: f, r });
  }
  const md = renderResultsPage([...latest.values()].map((x) => ({ r: x.r, rel: `results/${x.file}` })));
  writeFileSync(join(BENCH, 'RESULTS.md'), md);
  console.log('wrote benchmarks/RESULTS.md');
}
if (selfTest && existsSync(join(BENCH, 'RESULTS.md'))) console.log('self-test: RESULTS.md left untouched');
