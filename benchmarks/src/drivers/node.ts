// Node driver: imports the pipeline module (default packages/core/src/index.ts) in-process.
// Suitable for cloud-only via the Firebase JS SDK. Gemini Nano is a Chrome built-in, so device and
// hybrid modes are only runnable here if the module's capabilities() says so (it normally won't).
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { EgressMeter } from '../meter.ts';
import type { Blocker, Driver, Mode, SampleRun } from '../types.ts';

export class NodeDriver implements Driver {
  name = 'node';
  private mod: any;
  private loadErr?: Blocker;
  private meter: EgressMeter;
  private modulePath: string;
  private owner: string;
  constructor(modulePath: string, owner: string, countLoopback = false) {
    this.modulePath = modulePath;
    this.owner = owner;
    this.meter = new EgressMeter(countLoopback);
  }

  private async load(): Promise<void> {
    if (this.mod || this.loadErr) return;
    const p = resolve(this.modulePath);
    if (!existsSync(p)) {
      const dir = dirname(p);
      const listing = existsSync(dir) ? readdirSync(dir).join(', ') || '(empty)' : '(dir missing)';
      this.loadErr = { reason: `pipeline entry ${this.modulePath} does not exist (${dir} contains: ${listing})`, owner: this.owner };
      return;
    }
    try {
      this.mod = await import(pathToFileURL(p).href);
    } catch (e) {
      this.loadErr = { reason: `pipeline entry ${this.modulePath} failed to import: ${(e as Error).message}`, owner: this.owner };
      return;
    }
    if (typeof this.mod.runPipeline !== 'function') {
      this.loadErr = { reason: `${this.modulePath} does not export runPipeline(input, { mode }) (see benchmarks/CONTRACT.md)`, owner: this.owner };
    }
  }

  async preflight(mode: Mode): Promise<Blocker[]> {
    await this.load();
    if (this.loadErr) return [this.loadErr];
    const out: Blocker[] = [];
    let caps: any = null;
    if (typeof this.mod.capabilities === 'function') {
      try { caps = await this.mod.capabilities(); } catch (e) { out.push({ reason: `capabilities() threw: ${(e as Error).message}`, owner: this.owner }); }
    }
    const needDevice = mode !== 'cloud';
    const needCloud = mode !== 'device';
    if (needDevice && !(caps && caps.device === true)) {
      out.push({ reason: `Gemini Nano (Chrome Prompt API) is not reachable from Node${caps?.deviceReason ? `: ${caps.deviceReason}` : ''}; run this mode with --driver browser on an eligible machine`, owner: 'harness/QA (use browser driver)' });
    }
    if (needCloud && caps && caps.cloud === false) {
      out.push({ reason: `pipeline reports cloud unavailable${caps.cloudReason ? `: ${caps.cloudReason}` : ''}`, owner: 'Sumit (Firebase project) / ' + this.owner });
    }
    return out;
  }

  async run(mode: Mode, input: { id: string; bytes: Uint8Array; mimeType: string }): Promise<SampleRun> {
    await this.load();
    this.meter.install();
    this.meter.reset();
    const t0 = performance.now();
    try {
      const output = await this.mod.runPipeline(input, { mode });
      const wallMs = performance.now() - t0;
      return { output, wallMs, egress: this.meter.snapshot(), egressBodies: [...this.meter.bodies] };
    } finally {
      this.meter.uninstall();
    }
  }

  async environment(): Promise<Record<string, unknown>> {
    return { driver: 'node', pipelineModule: this.modulePath };
  }

  async close(): Promise<void> { this.meter.uninstall(); }
}
