/**
 * Gemini Nano mock: installs a fake Chrome Prompt API (`globalThis.LanguageModel`,
 * the global Chrome 138+ exposes) whose prompt() output is scripted by the test.
 * Never touches the network; the egress spy will prove that.
 */
export type NanoAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface NanoMockOptions {
  availability?: NanoAvailability;
  /** Maps prompt input -> model text. Default: echo input. */
  respond?: (input: string) => string | Promise<string>;
  /** Simulated latency in ms (uses real timers; keep small). */
  latencyMs?: number;
  /** Make prompt() throw (e.g. model crashed / quota). */
  fail?: string;
}

export interface NanoMock {
  calls: string[];
  set(opts: Partial<NanoMockOptions>): void;
  uninstall(): void;
  /** Direct client used by mock Stages (same behaviour as the global). */
  availability(): Promise<NanoAvailability>;
  prompt(input: string): Promise<string>;
}

export function installNanoMock(initial: NanoMockOptions = {}): NanoMock {
  const g = globalThis as any;
  const prev = g.LanguageModel;
  let opts: NanoMockOptions = { availability: 'available', ...initial };
  const calls: string[] = [];
  const prompt = async (input: unknown) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    calls.push(text);
    if (opts.availability !== 'available') throw new DOMException('Model not available', 'NotSupportedError');
    if (opts.fail) throw new Error(opts.fail);
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    return opts.respond ? opts.respond(text) : text;
  };
  const api = {
    availability: async () => opts.availability!,
    params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1 }),
    create: async () => {
      if (opts.availability === 'unavailable') throw new DOMException('Model not available', 'NotSupportedError');
      return { prompt, promptStreaming: undefined, destroy() { /* noop */ }, inputUsage: 0, inputQuota: 6144 };
    },
  };
  g.LanguageModel = api;
  return {
    calls,
    set(o) { opts = { ...opts, ...o }; },
    uninstall() { g.LanguageModel = prev; },
    availability: api.availability,
    prompt,
  };
}
