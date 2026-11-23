// SPDX-License-Identifier: Apache-2.0
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { parseCsv } from "./csv.js";
import { BILINGUAL_SOURCE } from "./sources.js";
import type { ImportResult, ImportWarning, ManifestRecord } from "./types.js";

export interface ImportBilingualOptions {
  annotationsPath: string;
  /** Directory containing the image files (must be under datasets/raw/). */
  imagesDir: string;
  /** Repository root, used to write repo-relative image_path values. */
  repoRoot: string;
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"];

interface Annotation {
  csvFilename: string;
  resolvedFilename: string | null;
  descriptionEnglish: string;
  descriptionBangla: string;
}

/**
 * Import the Mendeley bilingual prescription dataset (version 1) from a
 * local annotations CSV plus an images directory.
 */
export function importBilingualPrescriptions(options: ImportBilingualOptions): ImportResult {
  const warnings: ImportWarning[] = [];
  const csvText = readFileSync(options.annotationsPath, "utf8");
  const rows = parseCsv(csvText);
  const annotations = rows.map((row, i) => parseAnnotationRow(row, i, warnings));

  const imageIndex = indexImages(options.imagesDir);

  const byStem = new Map<string, Annotation[]>();
  for (const ann of annotations) {
    const stem = stemOf(ann.resolvedFilename ?? ann.csvFilename);
    if (!stem) continue;
    const list = byStem.get(stem) ?? [];
    list.push(ann);
    byStem.set(stem, list);
  }

  const usedStems = new Set<string>();
  const records: ManifestRecord[] = [];

  // One record per image on disk so missing CSV rows still appear.
  const stems = [...imageIndex.keys()].sort();
  for (const stem of stems) {
    const imageFile = imageIndex.get(stem);
    if (!imageFile) continue;
    usedStems.add(stem);
    const documentId = `bmpd-1-${stem}`;
    const issues: string[] = [];
    const group = byStem.get(stem) ?? [];

    let english: string | null = null;
    let bangla: string | null = null;
    let variants: Annotation[] | undefined;
    let referenceType: ManifestRecord["reference_type"] = "transcription";

    if (group.length === 0) {
      issues.push("missing_annotation");
      referenceType = "none";
      warnings.push({
        code: "missing_annotation",
        message: `Image ${imageFile} has no CSV annotation`,
        document_id: documentId,
      });
    } else if (group.length === 1) {
      const only = group[0];
      if (!only) {
        issues.push("missing_annotation");
        referenceType = "none";
      } else {
        english = only.descriptionEnglish;
        bangla = only.descriptionBangla;
        if (only.csvFilename !== (only.resolvedFilename ?? only.csvFilename)) {
          issues.push("filename_typo");
        }
        const expectedExt = extname(only.csvFilename).toLowerCase();
        const actualExt = extname(imageFile).toLowerCase();
        if (expectedExt && actualExt && expectedExt !== actualExt) {
          issues.push("extension_mismatch");
        }
      }
    } else if (allEquivalent(group)) {
      const first = group[0];
      english = first?.descriptionEnglish ?? null;
      bangla = first?.descriptionBangla ?? null;
      issues.push("duplicate_annotation");
      warnings.push({
        code: "duplicate_annotation",
        message: `Image ${stem} has ${group.length} equivalent CSV rows; keeping the first`,
        document_id: documentId,
      });
      variants = group;
    } else {
      issues.push("conflicting_annotations");
      warnings.push({
        code: "conflicting_annotations",
        message: `Image ${stem} has ${group.length} conflicting CSV transcriptions; both are stored, neither is discarded`,
        document_id: documentId,
      });
      const first = group[0];
      english = first?.descriptionEnglish ?? null;
      bangla = first?.descriptionBangla ?? null;
      variants = group;
    }

    const csvName = group[0]?.resolvedFilename ?? group[0]?.csvFilename;
    if (csvName) {
      const expectedExt = extname(csvName).toLowerCase();
      const actualExt = extname(imageFile).toLowerCase();
      if (expectedExt && actualExt && expectedExt !== actualExt && !issues.includes("extension_mismatch")) {
        issues.push("extension_mismatch");
      }
    }

    const srcImage = join(options.imagesDir, imageFile);
    if (!existsSync(srcImage)) {
      warnings.push({
        code: "missing_image_file",
        message: `Indexed image ${imageFile} was not found at ${srcImage}`,
        document_id: documentId,
      });
      continue;
    }

    const rec: ManifestRecord = {
      document_id: documentId,
      dataset: BILINGUAL_SOURCE.dataset,
      dataset_version: BILINGUAL_SOURCE.dataset_version,
      document_type: "prescription",
      language: ["bn", "en"],
      handwritten: true,
      page_count: 1,
      reference_type: referenceType,
      reference_verified_by: null,
      license_status: "reviewed",
      image_path: toPosix(relative(options.repoRoot, srcImage)),
      reference_path: null,
      source_url: BILINGUAL_SOURCE.source_url,
      license: BILINGUAL_SOURCE.license,
      license_url: BILINGUAL_SOURCE.license_url,
      access: "public",
    };
    if (english !== null) rec.reference_text = english;
    if (bangla !== null) rec.reference_text_bangla = bangla;
    if (issues.length) rec.annotation_issues = issues;
    records.push(rec);
  }

  for (const [stem, group] of byStem) {
    if (usedStems.has(stem)) continue;
    const first = group[0];
    warnings.push({
      code: "annotation_without_image",
      message: `CSV filename ${first?.csvFilename ?? stem} has no matching image in ${options.imagesDir}`,
    });
  }

  if (BILINGUAL_SOURCE.expected_records !== null && records.length !== BILINGUAL_SOURCE.expected_records) {
    warnings.push({
      code: "count_mismatch",
      message: `Imported ${records.length} bilingual-prescriptions records; version 1 is documented as ${BILINGUAL_SOURCE.expected_records} images`,
    });
  }

  return {
    records,
    warnings,
    source: BILINGUAL_SOURCE,
    imported_records: records.length,
  };
}

/**
 * Fix a recurring typo in the v1 CSV (`0174,jpg` instead of `0174.jpg`)
 * and similar comma-for-dot extension errors.
 */
export function repairCsvFilename(filename: string): { filename: string; typo: boolean } {
  const trimmed = filename.trim();
  const repaired = trimmed.replace(/,([A-Za-z][A-Za-z0-9]*)$/, ".$1");
  return { filename: repaired, typo: repaired !== trimmed };
}

export function normalizeAnnotationText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[;,:/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseAnnotationRow(
  row: Record<string, string>,
  index: number,
  warnings: ImportWarning[],
): Annotation {
  const rawName = (row.image_filename ?? "").trim();
  const repaired = repairCsvFilename(rawName);
  if (repaired.typo) {
    warnings.push({
      code: "filename_typo",
      message: `CSV row ${index + 2} filename ${JSON.stringify(rawName)} repaired to ${JSON.stringify(repaired.filename)}`,
    });
  }
  return {
    csvFilename: rawName,
    resolvedFilename: repaired.filename || null,
    descriptionEnglish: row.description_english ?? "",
    descriptionBangla: row.description_bangla ?? "",
  };
}

function allEquivalent(group: Annotation[]): boolean {
  const first = group[0];
  if (!first) return true;
  const en = normalizeAnnotationText(first.descriptionEnglish);
  const bn = normalizeAnnotationText(first.descriptionBangla);
  return group.every(
    (a) =>
      normalizeAnnotationText(a.descriptionEnglish) === en &&
      normalizeAnnotationText(a.descriptionBangla) === bn,
  );
}

function indexImages(imagesDir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(imagesDir)) {
    throw new Error(`Images directory does not exist: ${imagesDir}`);
  }
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!IMAGE_EXTS.includes(extname(name))) continue;
      const stem = stemOf(name);
      if (!stem) continue;
      const rel = toPosix(relative(imagesDir, abs));
      // Documents are written flat under documents/; keep the first match per stem.
      if (!map.has(stem)) map.set(stem, rel);
    }
  };
  walk(imagesDir);
  return map;
}

function stemOf(filename: string): string {
  const base = basename(filename);
  const ext = extname(base);
  return ext ? base.slice(0, base.length - ext.length) : base;
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}
