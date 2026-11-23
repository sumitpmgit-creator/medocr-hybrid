// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  BILINGUAL_FILE_ID,
  BILINGUAL_PINNED_VERSION,
  BILINGUAL_SOURCE,
  BILINGUAL_ZIP_SHA256,
  EKACARE_SOURCE,
} from "./sources.js";

export interface DownloadResult {
  ok: boolean;
  path?: string;
  sha256?: string;
  bytes?: number;
  blocker?: string;
  status?: number;
}

export async function downloadBilingualZip(destPath: string): Promise<DownloadResult> {
  const listed = await listMendeleyV1Files();
  const zip = listed.find((f) => f.filename.toLowerCase().endsWith(".zip")) ?? listed[0];
  if (!zip) {
    return { ok: false, blocker: "Mendeley v1 file listing returned no files" };
  }
  const url =
    zip.content_details?.download_url ??
    `https://data.mendeley.com/public-files/datasets/tg2hm7n2bs/files/${BILINGUAL_FILE_ID}/file_downloaded`;
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "med-ocr-dataset-importer/0.1" } });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      blocker: `Bilingual zip download failed with HTTP ${res.status} from ${url}`,
    };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha256 = sha256Of(bytes);
  if (sha256 !== BILINGUAL_ZIP_SHA256) {
    return {
      ok: false,
      sha256,
      bytes: bytes.byteLength,
      blocker: `Downloaded zip sha256 ${sha256} does not match the pinned v1 hash ${BILINGUAL_ZIP_SHA256}`,
    };
  }
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, bytes);
  return { ok: true, path: destPath, sha256, bytes: bytes.byteLength };
}

interface MendeleyFile {
  filename: string;
  id: string;
  content_details?: { download_url?: string; sha256_hash?: string; size?: number };
  size?: number;
}

export async function listMendeleyV1Files(): Promise<MendeleyFile[]> {
  const url =
    "https://data.mendeley.com/public-api/datasets/tg2hm7n2bs/files" +
    `?folder_id=root&version=${BILINGUAL_PINNED_VERSION}&$start=0&$limit=1000`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.mendeley-public-dataset.1+json",
      "User-Agent": "med-ocr-dataset-importer/0.1",
    },
  });
  if (!res.ok) {
    throw new Error(`Mendeley file listing failed with HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  if (!Array.isArray(body)) {
    throw new Error("Mendeley file listing was not an array");
  }
  return body as MendeleyFile[];
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function sha256Of(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// Keep the source URL discoverable for documentation.
export const BILINGUAL_PAGE = BILINGUAL_SOURCE.source_url;
export const EKACARE_PAGE = EKACARE_SOURCE.source_url;
