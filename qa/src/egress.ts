/**
 * Network-egress spy. Intercepts every way JS in Node/browser-like tests can
 * send bytes off the device and records them:
 *   globalThis.fetch, XMLHttpRequest, navigator.sendBeacon, WebSocket#send,
 *   node:http / node:https request()  (default-export objects)
 * plus explicit `record()` calls from the Firebase / cloud mocks.
 *
 * Default policy is DENY: nothing reaches the real network. A responder can be
 * supplied to fake a cloud reply. `offline()` makes every request fail the way
 * a browser does with no connectivity (TypeError: Failed to fetch).
 */
import http from 'node:http';
import https from 'node:https';
import { findLeaks, type LeakFinding, type PiiValue, ALL_PII } from './pii.ts';

export interface EgressRecord {
  channel: 'fetch' | 'xhr' | 'beacon' | 'websocket' | 'node-http' | 'mock-cloud';
  url: string;
  bytes: number;
  body: string;
  /** true if the body carried binary/image data we cannot text-scan */
  binary: boolean;
  blocked: boolean;
}

type Responder = (url: string, body: string) => unknown | Promise<unknown>;

function bodyToString(b: unknown): { text: string; bytes: number; binary: boolean } {
  if (b == null) return { text: '', bytes: 0, binary: false };
  if (typeof b === 'string') return { text: b, bytes: Buffer.byteLength(b, 'utf8'), binary: false };
  if (b instanceof URLSearchParams) return bodyToString(b.toString());
  if (b instanceof ArrayBuffer) return { text: Buffer.from(b).toString('latin1'), bytes: b.byteLength, binary: true };
  if (ArrayBuffer.isView(b)) return { text: Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1'), bytes: b.byteLength, binary: true };
  if (typeof Blob !== 'undefined' && b instanceof Blob) return { text: '[blob]', bytes: b.size, binary: true };
  return bodyToString(String(b));
}

/** Image parts inside JSON (Gemini inlineData / our ImagePayload) count as binary egress. */
function hasImagePart(text: string): boolean {
  return /"(inlineData|inline_data)"\s*:|"mimeType"\s*:\s*"image\/|data:image\/|"base64"\s*:\s*"[A-Za-z0-9+/=]{32,}/.test(text);
}

export class EgressSpy {
  records: EgressRecord[] = [];
  private restores: (() => void)[] = [];
  private mode: 'deny' | 'respond' | 'offline' = 'deny';
  private responder: Responder = () => ({ ok: true });

  install(): this {
    const self = this;
    const g = globalThis as any;

    const origFetch = g.fetch;
    g.fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      let body = init?.body;
      if (body === undefined && input && typeof input === 'object' && 'clone' in input) {
        try { body = await input.clone().text(); } catch { /* ignore */ }
      }
      const rec = self.capture('fetch', url, body);
      if (self.mode === 'offline') throw new TypeError('Failed to fetch');
      if (self.mode === 'deny') { rec.blocked = true; throw new Error(`[egress-spy] blocked real network call to ${url}`); }
      const reply = await self.responder(url, rec.body);
      return new Response(JSON.stringify(reply ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    this.restores.push(() => { g.fetch = origFetch; });

    const origXHR = g.XMLHttpRequest;
    g.XMLHttpRequest = class {
      private url = '';
      readyState = 0; status = 0; responseText = '';
      onload: any = null; onerror: any = null;
      open(_m: string, url: string) { this.url = url; this.readyState = 1; }
      setRequestHeader() { /* noop */ }
      send(body?: unknown) {
        self.capture('xhr', this.url, body);
        queueMicrotask(() => {
          if (self.mode === 'respond') { this.status = 200; this.readyState = 4; this.onload?.(); }
          else { this.readyState = 4; this.onerror?.(new TypeError('Network request failed')); }
        });
      }
    };
    this.restores.push(() => { g.XMLHttpRequest = origXHR; });

    const origWS = g.WebSocket;
    g.WebSocket = class {
      constructor(private url: string) {}
      send(data: unknown) { self.capture('websocket', this.url, data); }
      close() { /* noop */ }
    };
    this.restores.push(() => { g.WebSocket = origWS; });

    const nav = g.navigator;
    if (nav) {
      const origBeacon = nav.sendBeacon;
      try {
        Object.defineProperty(nav, 'sendBeacon', { configurable: true, writable: true, value: (url: string, data?: unknown) => { self.capture('beacon', url, data); return self.mode === 'respond'; } });
        this.restores.push(() => { Object.defineProperty(nav, 'sendBeacon', { configurable: true, writable: true, value: origBeacon }); });
      } catch { /* navigator not patchable */ }
    }

    for (const mod of [http, https] as any[]) {
      const origReq = mod.request;
      mod.request = (...args: any[]) => {
        const opt = args[0];
        const url = typeof opt === 'string' ? opt : opt instanceof URL ? opt.href : `${opt?.protocol ?? ''}//${opt?.hostname ?? opt?.host ?? ''}${opt?.path ?? ''}`;
        const chunks: unknown[] = [];
        const fake: any = {
          write: (c: unknown) => { chunks.push(c); return true; },
          end: (c?: unknown) => { if (c) chunks.push(c); self.capture('node-http', url, chunks.map((x) => bodyToString(x).text).join('')); queueMicrotask(() => fake._err?.(new Error('[egress-spy] node http blocked'))); },
          on: (ev: string, fn: any) => { if (ev === 'error') fake._err = fn; return fake; },
          setHeader() { /* noop */ }, destroy() { /* noop */ },
        };
        return fake;
      };
      this.restores.push(() => { mod.request = origReq; });
    }
    return this;
  }

  uninstall(): void { while (this.restores.length) this.restores.pop()!(); }
  reset(): void { this.records = []; }
  deny(): this { this.mode = 'deny'; return this; }
  offline(): this { this.mode = 'offline'; return this; }
  respond(fn: Responder): this { this.mode = 'respond'; this.responder = fn; return this; }
  get isOffline() { return this.mode === 'offline'; }

  /** Explicit capture for mocks that model a cloud SDK call without going through fetch. */
  record(url: string, body: unknown): EgressRecord { return this.capture('mock-cloud', url, body); }

  private capture(channel: EgressRecord['channel'], url: string, body: unknown): EgressRecord {
    const s = bodyToString(body);
    const rec: EgressRecord = { channel, url, bytes: s.bytes, body: s.text, binary: s.binary || hasImagePart(s.text), blocked: false };
    this.records.push(rec);
    return rec;
  }

  get totalBytes(): number { return this.records.reduce((n, r) => n + r.bytes, 0); }
  get attempts(): number { return this.records.length; }

  /** Leaks across all captured payloads (URLs included: query strings leak too). */
  leaks(pii: PiiValue[] = ALL_PII): (LeakFinding & { url: string; channel: string })[] {
    return this.records.flatMap((r) => findLeaks(`${r.url}\n${r.body}`, pii).map((f) => ({ ...f, url: r.url, channel: r.channel })));
  }

  binaryEgress(): EgressRecord[] { return this.records.filter((r) => r.binary); }
}
