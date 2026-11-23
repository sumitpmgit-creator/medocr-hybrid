// SPDX-License-Identifier: Apache-2.0
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { extractZip, readZip } from "./zip.js";

export interface ExtractedBilingual {
  annotationsPath: string;
  imagesDir: string;
  readmePath: string | null;
  zipPath: string;
  imageCount: number;
}

/**
 * Unpack the Mendeley v1 archive into datasets/raw/<dataset>/.
 * Images, the original zip, the CSV, and README.pdf stay under raw/.
 */
export function extractBilingualArchive(zipPath: string, rawDir: string): ExtractedBilingual {
  mkdirSync(rawDir, { recursive: true });
  const destZip = join(rawDir, "Prescription_Dataset(600)-t4I2Mj.zip");
  if (zipPath !== destZip) {
    copyFileSync(zipPath, destZip);
  }
  const unpacked = join(rawDir, "_unpacked");
  extractZip(readFileSync(zipPath), unpacked);

  const annotationsPath = findFile(unpacked, (n) => n.toLowerCase().endsWith(".csv"));
  if (!annotationsPath) {
    throw new Error(`No annotations CSV found in ${zipPath}`);
  }
  const csvDest = join(rawDir, "annotations.csv");
  copyFileSync(annotationsPath, csvDest);

  const readmeSrc = findFile(unpacked, (n) => basename(n).toLowerCase() === "readme.pdf");
  let readmePath: string | null = null;
  if (readmeSrc) {
    readmePath = join(rawDir, "README.pdf");
    copyFileSync(readmeSrc, readmePath);
  }

  const innerZip = findFile(
    unpacked,
    (n) => n.toLowerCase().endsWith(".zip") && basename(n) !== basename(destZip),
  );
  const imagesDir = join(rawDir, "documents");
  mkdirSync(imagesDir, { recursive: true });
  let imageCount = 0;
  if (innerZip) {
    const entries = readZip(readFileSync(innerZip));
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const ext = extname(entry.name).toLowerCase();
      if (![".jpg", ".jpeg", ".png"].includes(ext)) continue;
      writeFileSync(join(imagesDir, basename(entry.name)), entry.data);
      imageCount += 1;
    }
  } else {
    for (const img of listFiles(unpacked)) {
      if (![".jpg", ".jpeg", ".png"].includes(extname(img).toLowerCase())) continue;
      copyFileSync(img, join(imagesDir, basename(img)));
      imageCount += 1;
    }
  }

  rmSync(unpacked, { recursive: true, force: true });

  return {
    annotationsPath: csvDest,
    imagesDir,
    readmePath,
    zipPath: destZip,
    imageCount,
  };
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(abs);
    }
  };
  walk(root);
  return out;
}

function findFile(root: string, pred: (path: string) => boolean): string | null {
  return listFiles(root).find((p) => pred(p)) ?? null;
}
