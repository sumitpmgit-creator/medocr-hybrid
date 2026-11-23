// Independent egress meter for the Node driver: wraps globalThis.fetch and counts every byte
// the process uploads to non-loopback hosts (request line + headers + body). The pipeline's own
// claims are not trusted for "bytes sent to cloud".

export interface MeterSnapshot { requests: number; bytes: number; unmeasuredBodies: number; hosts: Record<string, number> }

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

export class EgressMeter {
  bodies: string[] = [];
  private s: MeterSnapshot = { requests: 0, bytes: 0, unmeasuredBodies: 0, hosts: {} };
  private orig?: typeof fetch;
  private countLoopback: boolean;
  constructor(countLoopback = false) { this.countLoopback = countLoopback; }

  reset(): void { this.s = { requests: 0, bytes: 0, unmeasuredBodies: 0, hosts: {} }; this.bodies = []; }
  snapshot(): MeterSnapshot { return { ...this.s, hosts: { ...this.s.hosts } }; }

  record(url: string, method: string, headerBytes: number, bodyBytes: number | null, bodyText?: string): void {
    let host = '';
    try { host = new URL(url).hostname; } catch { host = 'unknown'; }
    if (!this.countLoopback && LOOPBACK.test(host)) return;
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    const line = Buffer.byteLength(`${method} ${url} HTTP/1.1\r\n`);
    const total = line + headerBytes + (bodyBytes ?? 0);
    if (bodyBytes === null) this.s.unmeasuredBodies++;
    if (bodyText !== undefined) this.bodies.push(bodyText);
    this.s.requests++;
    this.s.bytes += total;
    this.s.hosts[host] = (this.s.hosts[host] ?? 0) + total;
  }

  install(): void {
    if (this.orig) return;
    const orig = globalThis.fetch;
    this.orig = orig;
    const self = this;
    globalThis.fetch = async function metered(input: any, init?: any) {
      const req = new Request(input, init);
      const clone = req.clone();
      let body: number | null = 0;
      let text: string | undefined;
      if (clone.body) {
        try { const buf = await clone.arrayBuffer(); body = buf.byteLength; text = new TextDecoder().decode(buf); } catch { body = null; }
      }
      let hb = 0;
      req.headers.forEach((v, k) => { hb += Buffer.byteLength(`${k}: ${v}\r\n`); });
      self.record(req.url, req.method, hb, body, text);
      return orig(req);
    } as typeof fetch;
  }

  uninstall(): void { if (this.orig) { globalThis.fetch = this.orig; this.orig = undefined; } }
}
