import type { Mode } from './types.ts';
import { MODES, MODE_LABEL } from './types.ts';

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const ms = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);
const usd = (x: number | null | undefined, digits = 5) => (x === null || x === undefined ? '—' : `$${x.toFixed(digits)}`);
const bytes = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x >= 1024 * 1024 ? `${(x / 1048576).toFixed(2)} MB` : x >= 1024 ? `${(x / 1024).toFixed(1)} KB` : `${Math.round(x)} B`);

export function renderResultsMd(r: any, jsonRel: string): string {
  if (r.kind !== 'benchmark') throw new Error('refusing to render a non-benchmark (self-test) run into RESULTS.md');
  const L: string[] = [];
  L.push('# MedOCR Hybrid — benchmark results', '');
  L.push(`Generated from [\`${jsonRel}\`](${jsonRel}) by \`node benchmarks/src/run.ts\`. Do not edit by hand; rerun the harness.`, '');
  L.push(`- Run: ${r.started_at} → ${r.finished_at} (UTC)`);
  L.push(`- Dataset: \`${r.dataset.path}\` — ${r.dataset.n_samples ?? 0} documents${r.dataset.manifest_sha256 ? ` (manifest sha256 \`${r.dataset.manifest_sha256.slice(0, 12)}\`)` : ''}${r.dataset.error ? ` — **${r.dataset.error}**` : ''}`);
  L.push(`- Driver: ${r.environment.driver}${r.environment.chrome ? ` (${r.environment.chrome})` : ''}; host: ${r.environment.os}, ${r.environment.cpus} CPUs, ${r.environment.ram_gb} GB RAM`);
  L.push('');
  L.push('| Mode | Status | Docs | CER ↓ | WER ↓ | Field accuracy ↑ | Latency p50 | Latency p95 | Est. cost / doc | Est. cost / 1k docs | Bytes sent to cloud / doc | Errors |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of MODES as Mode[]) {
    const x = r.modes[m];
    if (!x) continue;
    if (x.status !== 'RAN') {
      L.push(`| ${MODE_LABEL[m]} | **${x.status}** | — | — | — | — | — | — | — | — | — | — |`);
      continue;
    }
    const s = x.summary;
    L.push(`| ${MODE_LABEL[m]} | RAN | ${s.docs_ok}/${s.docs} | ${pct(s.cer)} | ${pct(s.wer)} | ${pct(s.field_accuracy)} | ${ms(s.latency_ms_p50)} | ${ms(s.latency_ms_p95)} | ${usd(s.cost_usd_per_doc)} | ${usd(s.cost_usd_per_doc === null ? null : s.cost_usd_per_doc * 1000, 2)} | ${bytes(s.bytes_sent_per_doc)} | ${s.errors} |`);
  }
  L.push('');
  const notRun = (MODES as Mode[]).filter((m) => r.modes[m] && r.modes[m].status !== 'RAN');
  if (notRun.length) {
    L.push('## Modes not run', '');
    for (const m of notRun) {
      L.push(`**${MODE_LABEL[m]} — ${r.modes[m].status}**`);
      for (const b of r.modes[m].blockers) L.push(`- ${b.reason} _(owner: ${b.owner})_`);
      L.push('');
    }
  }
  const caveats = (MODES as Mode[]).flatMap((m) => (r.modes[m]?.summary?.caveats ?? []).map((c: string) => `${MODE_LABEL[m]}: ${c}`));
  if (caveats.length) { L.push('## Caveats', '', ...caveats.map((c) => `- ${c}`), ''); }
  L.push('## How each column is measured', '');
  L.push('- **CER / WER**: Levenshtein edits ÷ reference length over NFKC-normalised, lower-cased, whitespace-collapsed text, micro-averaged over documents that have a `reference_text`. "—" means no document had one.');
  L.push('- **Field accuracy**: every leaf of the ground-truth `fields` JSON is one field; exact match after value normalisation (case, whitespace, trailing punctuation, numeric form). Missing = wrong; extra predicted fields are ignored. Micro-averaged.');
  L.push('- **Latency**: wall-clock per document as seen by the harness (nearest-rank p50/p95), documents run sequentially, failed documents excluded.');
  L.push(`- **Cost**: token counts reported by the pipeline (Firebase AI Logic \`usageMetadata\`) × rates in \`benchmarks/pricing.json\` — ${r.pricing.tier}, source ${r.pricing.source}, retrieved ${r.pricing.retrieved}. On-device calls are $0 API cost. "—" = cost unknown (no usage reported), never guessed.`);
  L.push('- **Bytes sent to cloud**: measured by the harness, not reported by the pipeline — request line + headers + body of every request to a non-loopback host (Node: wrapped `fetch`; browser: Chrome DevTools Network domain). Mean per document.');
  L.push('');
  return L.join('\n');
}
