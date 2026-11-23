// HARNESS SELF-TEST ONLY. A fake pipeline that degrades the ground truth deterministically and
// makes a real HTTP upload to a local sink so the egress meter is exercised. Its numbers are
// meaningless and are written only to results/selftest/, never to RESULTS.md.
import { createServer, type Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import { EgressMeter } from '../meter.ts';
import type { Blocker, Driver, Mode, SampleRun } from '../types.ts';
import type { Sample } from '../dataset.ts';

function corrupt(s: string, every: number): string {
  return Array.from(s).map((c, i) => (i % every === every - 1 && /[a-z]/i.test(c) ? '#' : c)).join('');
}

export class MockDriver implements Driver {
  name = 'mock (self-test)';
  private server?: Server;
  private port = 0;
  private meter = new EgressMeter(true); // count loopback: the sink stands in for the cloud
  private truth: Map<string, Sample>;
  constructor(truth: Map<string, Sample>) { this.truth = truth; }

  private async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', () => r()));
    this.port = (this.server.address() as any).port;
  }

  async preflight(mode: Mode): Promise<Blocker[]> {
    await this.start();
    void mode;
    return [];
  }

  async run(mode: Mode, input: { id: string; bytes: Uint8Array; mimeType: string }): Promise<SampleRun> {
    await this.start();
    const s = this.truth.get(input.id)!;
    this.meter.install();
    this.meter.reset();
    const t0 = performance.now();
    try {
      const useCloud = mode === 'cloud' || (mode === 'hybrid' && input.id.endsWith('2'));
      const ref = s.reference_text ?? '';
      // Synthetic de-id that deliberately misses record IDs, so the leak check has something to find.
      const deidText = ref.replace(/(Patient(?:['’]s)? name:\s*)[^\n]+/gi, '$1[NAME]');
      if (mode === 'cloud') await fetch(`http://127.0.0.1:${this.port}/v1/generate`, { method: 'POST', body: JSON.stringify({ inlineData: Buffer.from(input.bytes).toString('base64'), text: 'read' }) });
      else if (useCloud) await fetch(`http://127.0.0.1:${this.port}/v1/generate`, { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: deidText }] }] }) });
      const every = mode === 'device' ? 7 : useCloud ? 1000 : 7;
      const fields = JSON.parse(JSON.stringify(s.fields ?? {}));
      if (mode === 'device' && fields.patient_age) fields.patient_age = '99';
      return {
        output: {
          text: corrupt(s.reference_text ?? '', every),
          fields,
          route: useCloud ? 'cloud' : 'device',
          steps: [
            { stageId: mode === 'cloud' ? 'cloud-read' : 'nano-read', stageKind: 'ocr', text: corrupt(ref, every) },
            ...(mode === 'cloud' ? [] : [{ stageId: 'nano-deid', stageKind: 'deid', text: deidText }]),
            { stageId: 'structure', stageKind: 'structure', text: mode === 'cloud' ? corrupt(ref, every) : deidText },
          ],
          usage: useCloud ? [{ model: 'gemini-2.5-flash-lite', promptTokens: 1290, outputTokens: 400 }] : [],
        },
        wallMs: performance.now() - t0,
        egress: this.meter.snapshot(),
        egressBodies: [...this.meter.bodies],
      };
    } finally {
      this.meter.uninstall();
    }
  }

  async environment(): Promise<Record<string, unknown>> { return { driver: 'mock', note: 'HARNESS SELF-TEST — synthetic pipeline, numbers are not real' }; }
  async close(): Promise<void> { await new Promise((r) => this.server?.close(() => r(null)) ?? r(null)); }
}
