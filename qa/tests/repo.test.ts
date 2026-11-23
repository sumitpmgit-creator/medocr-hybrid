/** Area: REPO - build/test/infra health that blocks every other area. Read-only checks. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, pkgDir } from '../src/repo.ts';
import { core, parsing, describeLoad } from '../src/core.ts';

const workspacePkgs = ['packages/core', 'packages/parsing', 'apps/web'].filter((p) => existsSync(pkgDir(`${p}/package.json`)));
const pj = (p: string) => JSON.parse(readFileSync(pkgDir(`${p}/package.json`), 'utf8'));

function listFiles(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map(String).filter((f) => re.test(f) && !f.includes('node_modules'));
}

describe('REPO: public entry points', () => {
  it('REPO-01 @med-ocr/core exports["."] resolves to an existing file and imports cleanly', () => {
    expect(core.entryOk, describeLoad(core)).toBe(true);
  });
  it('REPO-02 @med-ocr/parsing public entry exports at least one symbol', () => {
    expect(Object.keys(parsing.mod).length, describeLoad(parsing)).toBeGreaterThan(0);
  });
  it('REPO-03 every core src module imports without error (fallback load)', () => {
    expect(core.loadErrors.filter((e) => !e.startsWith('entry missing')), describeLoad(core)).toEqual([]);
  });
});

describe('REPO: install / scripts', () => {
  it('REPO-04 pnpm-lock.yaml has an importer for every workspace package (frozen install works)', () => {
    const lock = readFileSync(path.join(REPO, 'pnpm-lock.yaml'), 'utf8');
    const missing = workspacePkgs.filter((p) => !new RegExp(`^  ${p.replace('/', '\\/')}:$`, 'm').test(lock));
    expect(missing).toEqual([]);
  });
  it('REPO-05 every package with a vitest "test" script has its runner installed and at least one test file', () => {
    const problems: string[] = [];
    for (const p of workspacePkgs) {
      const s = pj(p).scripts?.test ?? '';
      if (!s.includes('vitest')) continue;
      if (!existsSync(pkgDir(`${p}/node_modules/vitest`))) problems.push(`${p}: vitest not installed (node_modules missing)`);
      if (!listFiles(pkgDir(p), /\.(test|spec)\.[cm]?[jt]sx?$/).length) problems.push(`${p}: no *.test.* files -> "vitest run" exits 1`);
    }
    expect(problems).toEqual([]);
  });
  it('REPO-06 every package with a tsc typecheck script has a tsconfig.json', () => {
    const missing = workspacePkgs.filter((p) => /tsc/.test(pj(p).scripts?.typecheck ?? '') && !existsSync(pkgDir(`${p}/tsconfig.json`)));
    expect(missing).toEqual([]);
  });
  it('REPO-07 root script "import:ekacare" points at an existing file', () => {
    const cmd: string = pj('.').scripts?.['import:ekacare'] ?? '';
    const file = cmd.split(/\s+/).find((t) => /\.(py|mjs|js|ts)$/.test(t));
    expect(file && existsSync(path.join(REPO, file)), `script: ${cmd}`).toBe(true);
  });
  it('REPO-08 packages/core typechecks with its own tsconfig', () => {
    const tsc = path.join(REPO, 'node_modules/typescript/bin/tsc');
    let out = '';
    try { execFileSync(process.execPath, [tsc, '--noEmit', '-p', pkgDir('packages/core')], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (e: any) { out = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
    expect(out).toBe('');
  }, 60_000);
  it('REPO-09 core declares every bare-specifier package it imports', () => {
    const deps = { ...pj('packages/core').dependencies, ...pj('packages/core').devDependencies, ...pj('packages/core').peerDependencies };
    const imports = new Set<string>();
    for (const f of listFiles(pkgDir('packages/core/src'), /\.[cm]?[jt]s$/)) {
      const src = readFileSync(path.join(pkgDir('packages/core/src'), f), 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1]!; if (spec.startsWith('node:')) continue;
        imports.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);
      }
    }
    expect([...imports].filter((i) => !(i in deps))).toEqual([]);
  });
});

describe('REPO: benchmark data', () => {
  it('REPO-10 datasets/ekacare contains the 288 test images (or a manifest) for benchmark runs', () => {
    const files = listFiles(pkgDir('datasets/ekacare'), /\.(png|jpe?g|webp|parquet|jsonl|json|csv)$/i);
    expect(files.length, `found: ${readdirSync(pkgDir('datasets/ekacare')).join(', ')}`).toBeGreaterThan(0);
  });
});
