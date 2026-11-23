// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal ZIP reader for store-only (uncompressed or deflate) archives.
 * Used to unpack the Mendeley v1 zip without adding a dependency.
 */
import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  isDirectory: boolean;
}

export function readZip(buffer: Uint8Array): ZipEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocd = findEocd(view);
  const cdOffset = view.getUint32(eocd + 16, true);
  const cdEntries = view.getUint16(eocd + 10, true);
  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory");
    }
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const uncompSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = textDecoder.decode(buffer.subarray(pos + 46, pos + 46 + nameLen));
    const data = readLocalFile(buffer, view, localOffset, method, compSize, uncompSize);
    entries.push({ name, data, isDirectory: name.endsWith("/") });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function extractZip(buffer: Uint8Array, destDir: string): string[] {
  const written: string[] = [];
  for (const entry of readZip(buffer)) {
    if (entry.isDirectory) {
      mkdirSync(join(destDir, entry.name), { recursive: true });
      continue;
    }
    const dest = join(destDir, entry.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entry.data);
    written.push(dest);
  }
  return written;
}

function readLocalFile(
  buffer: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compSize: number,
  uncompSize: number,
): Uint8Array {
  if (view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error("Invalid ZIP local file header");
  }
  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLen + extraLen;
  const raw = buffer.subarray(start, start + compSize);
  if (method === 0) {
    return raw;
  }
  if (method === 8) {
    const out = inflateRawSync(raw);
    if (uncompSize && out.byteLength !== uncompSize) {
      throw new Error(`ZIP inflate size mismatch for entry at ${localOffset}`);
    }
    return out;
  }
  throw new Error(`Unsupported ZIP compression method ${method}`);
}

function findEocd(view: DataView): number {
  // EOCD is at the end, possibly followed by a comment (up to 64 KiB).
  const min = Math.max(0, view.byteLength - 22 - 65535);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("ZIP end of central directory not found");
}

const textDecoder = new TextDecoder("utf-8");
