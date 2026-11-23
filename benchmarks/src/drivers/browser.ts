// Browser driver: launches Chrome, opens the app's benchmark page, and calls
// window.medocrBench.run(input, { mode }) per document over the DevTools protocol.
// Egress is metered by Chrome itself (CDP Network domain), so on-device claims are checked
// independently of the pipeline. Gemini Nano requires headful Chrome on an eligible machine
// (>4 GB VRAM GPU, or >=16 GB RAM + 4 cores; 22 GB free disk) — see README.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { Blocker, Driver, Mode, SampleRun } from '../types.ts';

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

class Cdp {
  private id = 0;
  private pending = new Map<number, (m: any) => void>();
  private listeners: ((m: any) => void)[] = [];
  private ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (e: any) => {
      const m = JSON.parse(String(e.data));
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)!(m); this.pending.delete(m.id); }
      else this.listeners.forEach((l) => l(m));
    });
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    return new Cdp(ws);
  }
  send(method: string, params: any = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(l: (m: any) => void): void { this.listeners.push(l); }
  close(): void { this.ws.close(); }
}

export class BrowserDriver implements Driver {
  name = 'browser';
  private proc?: ChildProcess;
  private cdp?: Cdp;
  private startErr?: Blocker;
  private egress = { requests: 0, bytes: 0, unmeasuredBodies: 0, hosts: {} as Record<string, number> };
  private chromeVersion = '';
  private nano = 'not probed';

  private async probeNano(): Promise<string> {
    const srv = createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>nano probe</title>'); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    try {
      await this.cdp!.send('Page.navigate', { url: `http://localhost:${(srv.address() as any).port}/` });
      await new Promise((r) => setTimeout(r, 1000));
      return await this.eval(`(async () => typeof LanguageModel === 'undefined' ? 'no LanguageModel global' : await LanguageModel.availability({ expectedInputs: [{ type: 'image' }] }))()`).catch((e) => String(e));
    } finally { srv.close(); }
  }

  private opts: { appUrl: string; chrome: string; profile: string; port: number; headless: boolean; appOwner: string };
  constructor(opts: BrowserDriver['opts']) { this.opts = opts; }

  private async start(): Promise<void> {
    if (this.cdp || this.startErr) return;
    mkdirSync(this.opts.profile, { recursive: true });
    const args = [`--remote-debugging-port=${this.opts.port}`, `--user-data-dir=${this.opts.profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'];
    if (this.opts.headless) args.unshift('--headless=new');
    this.proc = spawn(this.opts.chrome, args, { stdio: 'ignore' });
    const base = `http://127.0.0.1:${this.opts.port}`;
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      try { const v = await (await fetch(`${base}/json/version`)).json(); this.chromeVersion = v.Browser; ok = true; }
      catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    if (!ok) { this.startErr = { reason: `could not start Chrome (${this.opts.chrome})`, owner: 'harness/QA' }; return; }
    const targets = await (await fetch(`${base}/json/list`)).json();
    const page = targets.find((t: any) => t.type === 'page');
    this.cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await this.cdp.send('Network.enable', { maxPostDataSize: 64 * 1024 * 1024 });
    await this.cdp.send('Runtime.enable');
    this.cdp.on(async (m) => {
      if (m.method !== 'Network.requestWillBeSent') return;
      const r = m.params.request;
      let host = '';
      try { host = new URL(r.url).hostname; } catch { return; }
      if (LOOPBACK.test(host) || /^(data|blob|chrome|about):/.test(r.url)) return;
      let body: number | null = 0;
      if (r.hasPostData) {
        // Prefer exact byte counts: postDataEntries carry base64 bytes; getRequestPostData may be base64 too.
        if (Array.isArray(r.postDataEntries) && r.postDataEntries.every((e: any) => typeof e.bytes === 'string')) {
          body = r.postDataEntries.reduce((t: number, e: any) => t + Buffer.from(e.bytes, 'base64').length, 0);
        } else {
          try {
            const pd = await this.cdp!.send('Network.getRequestPostData', { requestId: m.params.requestId });
            body = pd.base64Encoded ? Buffer.from(pd.postData ?? '', 'base64').length : Buffer.byteLength(pd.postData ?? '');
          } catch { body = null; }
        }
      }
      const hb = Object.entries(r.headers ?? {}).reduce((s, [k, v]) => s + Buffer.byteLength(`${k}: ${v}\r\n`), 0);
      const total = Buffer.byteLength(`${r.method} ${r.url} HTTP/1.1\r\n`) + hb + (body ?? 0);
      if (body === null) this.egress.unmeasuredBodies++;
      this.egress.requests++;
      this.egress.bytes += total;
      this.egress.hosts[host] = (this.egress.hosts[host] ?? 0) + total;
    });
    // Probe Gemini Nano independently of the app, on a throwaway localhost page (Prompt API needs a secure context).
    this.nano = await this.probeNano();
    try {
      await this.cdp.send('Page.enable');
      const nav = await this.cdp.send('Page.navigate', { url: this.opts.appUrl });
      if (nav.errorText) throw new Error(nav.errorText);
    } catch (e) {
      this.startErr = { reason: `could not open ${this.opts.appUrl}: ${(e as Error).message}`, owner: this.opts.appOwner };
      return;
    }
    for (let i = 0; i < 40; i++) {
      const ready = await this.eval('typeof window.medocrBench === "object" && typeof window.medocrBench.run === "function"').catch(() => false);
      if (ready) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    this.startErr = { reason: `${this.opts.appUrl} did not expose window.medocrBench.run within 10 s (is the app dev server running and does it ship the bench page? see CONTRACT.md)`, owner: this.opts.appOwner };
  }

  private async eval(expression: string): Promise<any> {
    const r = await this.cdp!.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async preflight(mode: Mode): Promise<Blocker[]> {
    await this.start();
    const out: Blocker[] = [];
    if (mode !== 'cloud' && this.nano !== 'available') {
      out.push({ reason: `Gemini Nano image input not available in this Chrome (${this.chromeVersion || this.opts.chrome}) on this machine: LanguageModel.availability({expectedInputs:[{type:'image'}]}) = "${this.nano}"`, owner: 'Sumit (needs an eligible machine) — see README hardware requirements' });
    }
    if (this.startErr) return [...out, this.startErr];
    const caps = await this.eval(`(async () => window.medocrBench.capabilities ? await window.medocrBench.capabilities() : null)()`).catch(() => null);
    if (mode !== 'device' && caps && caps.cloud === false) out.push({ reason: `app reports cloud unavailable${caps.cloudReason ? `: ${caps.cloudReason}` : ''}`, owner: 'Sumit (Firebase project config) / ' + this.opts.appOwner });
    return out;
  }

  async run(mode: Mode, input: { id: string; bytes: Uint8Array; mimeType: string }): Promise<SampleRun> {
    await this.start();
    const b64 = Buffer.from(input.bytes).toString('base64');
    this.egress = { requests: 0, bytes: 0, unmeasuredBodies: 0, hosts: {} };
    const t0 = performance.now();
    const output = await this.eval(`(async () => {
      const bin = atob(${JSON.stringify(b64)}); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return await window.medocrBench.run({ id: ${JSON.stringify(input.id)}, bytes, mimeType: ${JSON.stringify(input.mimeType)} }, { mode: ${JSON.stringify(mode)} });
    })()`);
    const wallMs = performance.now() - t0; // includes base64 decode in page (~ms); documented in README
    await new Promise((r) => setTimeout(r, 50)); // let trailing Network events land
    return { output, wallMs, egress: { ...this.egress, hosts: { ...this.egress.hosts } } };
  }

  async environment(): Promise<Record<string, unknown>> {
    return { driver: 'browser', chrome: this.chromeVersion, appUrl: this.opts.appUrl, headless: this.opts.headless };
  }

  async close(): Promise<void> {
    this.cdp?.close();
    this.proc?.kill();
  }
}
