#!/usr/bin/env node
// MedOCR Hybrid benchmark harness. Usage: see benchmarks/README.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import os from 'node:os';
import { loadDataset, mimeOf, DatasetUnavailable, type Sample } from './dataset.ts';
import { charErrors, wordErrors, rate, scoreFields, percentile, mean } from './metrics.ts';
import { loadPricing, costOf } from './cost.ts';
import { renderResultsMd } from './report.ts';
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
    dataset: { type: 'string', default: 'datasets/ekacare' },
    limit: { type: 'string' },
    'app-url': { type: 'string', default: 'http://localhost:5173/bench.html' },
    chrome: { type: 'string', default: process.env.CHROME_PATH ?? 'google-chrome' },
    'chrome-profile': { type: 'string', default: join(BENCH, 'chrome-profile') },
    headless: { type: 'boolean', default: false },
    'self-test': { type: 'boolean', default: false },
    'no-results-md': { type: 'boolean', default: false },
  },
});

const selfTest = a['self-test']!;
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
  environment: { node: process.version, os: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length, ram_gb: Math.round(os.totalmem() / 2 ** 30) },
  dataset: { path: relative(ROOT, datasetDir) },
  pricing,
  modes: {} as Record<string, any>,
};

let samples: Sample[] = [];
let datasetBlocker: Blocker | null = null;
try {
  const d = loadDataset(datasetDir, limit);
  samples = d.samples;
  Object.assign(result.dataset, { manifest_sha256: d.manifestSha256, n_samples: samples.length, limit: limit ?? null,
    with_reference_text: samples.filter((s) => s.reference_text).length, with_fields: samples.filter((s) => s.fields).length });
} catch (e) {
  if (!(e instanceof DatasetUnavailable)) throw e;
  datasetBlocker = { reason: e.message + ' Import it with an importer that writes manifest.jsonl per benchmarks/CONTRACT.md (note: the HF dataset ekacare/medical_records_parsing_validation_set is gated — accept its terms and provide an HF token).', owner: 'Rachel (datasets/)' };
  result.dataset.error = 'dataset not imported';
}

let driver: Driver;
if (selfTest) driver = new MockDriver(new Map(samples.map((s) => [s.id, s])));
else if (a.driver === 'browser') driver = new BrowserDriver({ appUrl: a['app-url']!, chrome: a.chrome!, profile: a['chrome-profile']!, port: 9400 + Math.floor(Math.random() * 500), headless: a.headless!, appOwner: 'Avenger (apps/)' });
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
  console.log(`[${mode}] running ${samples.length} documents…`);
  const per: any[] = [];
  for (const s of samples) {
    const bytesIn = readFileSync(join(datasetDir, s.image));
    const rec: any = { id: s.id, document_type: s.document_type ?? null };
    try {
      const r = await driver.run(mode, { id: s.id, bytes: new Uint8Array(bytesIn), mimeType: mimeOf(s.image) });
      rec.ok = true;
      rec.latency_ms = r.wallMs;
      rec.route = r.output.route ?? null;
      rec.stages = r.output.stages ?? null;
      rec.egress = r.egress;
      if (s.reference_text !== undefined) { rec.char = charErrors(r.output.text ?? '', s.reference_text); rec.word = wordErrors(r.output.text ?? '', s.reference_text); }
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
  const summary = {
    docs: per.length, docs_ok: ok.length, errors: per.length - ok.length,
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
  const md = renderResultsMd(result, relative(BENCH, outPath));
  writeFileSync(join(BENCH, 'RESULTS.md'), md);
  console.log('wrote benchmarks/RESULTS.md');
}
if (selfTest && existsSync(join(BENCH, 'RESULTS.md'))) console.log('self-test: RESULTS.md left untouched');
