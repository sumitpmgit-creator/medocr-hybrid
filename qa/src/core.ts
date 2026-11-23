/**
 * Loads @med-ocr/core and @med-ocr/parsing through their PUBLIC entry points
 * (package.json "exports"["."]). If an entry file does not exist yet, we fall
 * back to importing every src/*.ts module so the code that DOES exist can still
 * be tested; `entryOk` records that the public entry is broken (REPO-01).
 *
 * `pick()` resolves a capability by a list of candidate export names, so tests
 * keep working whatever Louis/Rachel finally name things. Edit CANDIDATES in
 * one place if a name is chosen that is not listed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pkgDir } from './repo.ts';

export interface LoadedPkg {
  name: string;
  dir: string;
  entry: string | null;
  entryOk: boolean;
  via: 'package-entry' | 'module-fallback' | 'none';
  mod: Record<string, any>;
  loadErrors: string[];
}

async function load(rel: string): Promise<LoadedPkg> {
  const dir = pkgDir(rel);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const exp = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.'] ?? pkg.main ?? null;
  const entry = exp ? path.join(dir, exp) : null;
  const loadErrors: string[] = [];
  const out: LoadedPkg = { name: pkg.name, dir, entry, entryOk: false, via: 'none', mod: {}, loadErrors };
  if (entry && existsSync(entry)) {
    try {
      out.mod = { ...(await import(/* @vite-ignore */ pathToFileURL(entry).href)) };
      out.entryOk = true;
      out.via = 'package-entry';
      return out;
    } catch (e) {
      loadErrors.push(`entry ${entry}: ${(e as Error).message}`);
    }
  } else {
    loadErrors.push(`entry missing: ${entry}`);
  }
  const src = path.join(dir, 'src');
  if (existsSync(src)) {
    for (const f of readdirSync(src).filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.endsWith('.d.ts')).sort()) {
      try {
        Object.assign(out.mod, await import(/* @vite-ignore */ pathToFileURL(path.join(src, f)).href));
        out.via = 'module-fallback';
      } catch (e) {
        loadErrors.push(`${f}: ${(e as Error).message}`);
      }
    }
  }
  return out;
}

export const core = await load('packages/core');
export const parsing = await load('packages/parsing');

/** Candidate export names per capability (first match wins, core then parsing). */
export const CANDIDATES = {
  runPipeline: ['runPipeline'],
  readingText: ['readingText'],
  cer: ['cer'],
  wer: ['wer'],
  numericAccuracy: ['numericAccuracy'],
  similarity: ['similarity'],
  fuzzyContains: ['fuzzyContains'],
  omissionInvention: ['omissionInvention'],
  scoreFields: ['scoreFields'],
  // --- not implemented yet as of 23 Nov 2026 ---
  deidentify: ['deidentify', 'deIdentify', 'redact', 'redactPII', 'redactPhi', 'scrub', 'scrubPII', 'anonymize'],
  deidStage: ['createDeidStage', 'deidStage', 'makeDeidStage', 'redactionStage'],
  reidentify: ['reidentify', 'reIdentify', 'restore', 'unredact'],
  route: ['route', 'decideRoute', 'chooseRoute', 'routeDocument', 'createRouter', 'routeStage', 'createRouteStage'],
  hybridPipeline: ['createHybridPipeline', 'hybridPipeline', 'buildHybridPipeline', 'createPipeline'],
  calibrate: ['calibrate', 'calibrateConfidence', 'expectedCalibrationError', 'ece', 'reliabilityDiagram'],
  connectivity: ['isOnline', 'connectivity', 'createConnectivity', 'withOfflineFallback', 'offlineFallback'],
} as const;

export type Capability = keyof typeof CANDIDATES;

export function pick<T = any>(cap: Capability): T | undefined {
  for (const n of CANDIDATES[cap]) {
    if (n in core.mod) return core.mod[n] as T;
    if (n in parsing.mod) return parsing.mod[n] as T;
  }
  return undefined;
}

export function has(cap: Capability): boolean {
  return pick(cap) !== undefined;
}

export function describeLoad(p: LoadedPkg): string {
  return `${p.name}: via=${p.via} entryOk=${p.entryOk} exports=[${Object.keys(p.mod).join(', ')}]` +
    (p.loadErrors.length ? ` errors=${p.loadErrors.join(' | ')}` : '');
}
