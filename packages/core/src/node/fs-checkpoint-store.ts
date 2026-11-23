// SPDX-License-Identifier: Apache-2.0
/**
 * Filesystem CheckpointStore (Node only). Exported from `@med-ocr/core/node`, never from the
 * browser entry. One JSON file per stage checkpoint; writes are atomic (temp file + rename).
 * The fs module is injected or loaded lazily, so core compiles without @types/node.
 */
import type { CheckpointRecord, CheckpointStore } from '../checkpoint.js';

/** The subset of `node:fs/promises` this store uses. */
export interface MinimalFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, opts: { force: true }): Promise<void>;
}

/** One file per key; URI-encoding the whole key makes it a single, reversible, portable file name. */
const fileFor = (key: string) => `${encodeURIComponent(key)}.json`;
const keyFor = (file: string) => decodeURIComponent(file.slice(0, -'.json'.length));

let seq = 0;

export class FsCheckpointStore implements CheckpointStore {
  private fsP: Promise<MinimalFs> | undefined;
  constructor(readonly dir: string, fs?: MinimalFs) {
    if (fs) this.fsP = Promise.resolve(fs);
  }

  private fs(): Promise<MinimalFs> {
    if (!this.fsP) {
      const spec = 'node:fs/promises';
      this.fsP = import(/* @vite-ignore */ spec) as Promise<MinimalFs>;
    }
    return this.fsP;
  }

  private path(file: string): string { return `${this.dir.replace(/[\\/]+$/, '')}/${file}`; }

  async get(key: string): Promise<CheckpointRecord | undefined> {
    const fs = await this.fs();
    try { return JSON.parse(await fs.readFile(this.path(fileFor(key)), 'utf8')) as CheckpointRecord; }
    catch (e) { if ((e as { code?: string }).code === 'ENOENT') return undefined; throw e; }
  }

  async put(record: CheckpointRecord): Promise<void> {
    const fs = await this.fs();
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.path(fileFor(record.key));
    const tmp = `${target}.tmp-${Date.now().toString(36)}-${(seq++).toString(36)}`;
    await fs.writeFile(tmp, JSON.stringify(record), 'utf8');
    try { await fs.rename(tmp, target); }
    catch (e) { await fs.rm(tmp, { force: true }).catch(() => undefined); throw e; }
  }

  async delete(key: string): Promise<void> {
    const fs = await this.fs();
    await fs.rm(this.path(fileFor(key)), { force: true });
  }

  async list(prefix: string): Promise<CheckpointRecord[]> {
    const fs = await this.fs();
    let files: string[];
    try { files = await fs.readdir(this.dir); }
    catch (e) { if ((e as { code?: string }).code === 'ENOENT') return []; throw e; }
    const keys = files.filter((f) => f.endsWith('.json')).map(keyFor).filter((k) => k.startsWith(prefix)).sort();
    const out: CheckpointRecord[] = [];
    for (const k of keys) { const r = await this.get(k); if (r) out.push(r); }
    return out;
  }
}
