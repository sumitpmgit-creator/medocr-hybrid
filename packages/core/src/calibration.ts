// SPDX-License-Identifier: Apache-2.0
/**
 * Confidence calibration (spec §F: "self-reported model confidence is not a valid probability
 * unless independently calibrated"). Expected Calibration Error over equal-width bins:
 *   ECE = Σ_b (n_b / N) · |accuracy_b − meanConfidence_b|
 * plus Maximum Calibration Error, Brier score and a per-bin table for a reliability diagram.
 */
import type { ClinicalDoc } from './types.js';
import type { FieldScore } from './field-scorer.js';

export interface CalibrationSample { confidence: number; correct: boolean; field?: string }

export interface CalibrationBin { lower: number; upper: number; count: number; meanConfidence: number | null; accuracy: number | null; gap: number | null }

export interface CalibrationReport {
  schemaVersion: 1;
  bins: CalibrationBin[];
  samples: number;
  /** Samples dropped because confidence was missing or outside [0, 1] */
  dropped: number;
  ece: number;
  mce: number;
  brier: number;
  /** Optional per-field breakdown (only when samples carry `field`) */
  byField?: Record<string, { samples: number; ece: number; brier: number }>;
}

export function calibrationReport(samples: readonly CalibrationSample[], nBins = 10, perField = true): CalibrationReport {
  if (!Number.isInteger(nBins) || nBins < 1) throw new RangeError('nBins must be a positive integer');
  const ok = samples.filter((s) => Number.isFinite(s.confidence) && s.confidence >= 0 && s.confidence <= 1);
  const bins = Array.from({ length: nBins }, (_, i) => ({ lower: i / nBins, upper: (i + 1) / nBins, n: 0, conf: 0, hit: 0 }));
  let brier = 0;
  for (const s of ok) {
    const b = bins[Math.min(nBins - 1, Math.floor(s.confidence * nBins))]!; // 1.0 goes into the last bin
    b.n++; b.conf += s.confidence; b.hit += s.correct ? 1 : 0;
    brier += (s.confidence - (s.correct ? 1 : 0)) ** 2;
  }
  const N = ok.length;
  let ece = 0, mce = 0;
  const out: CalibrationBin[] = bins.map((b) => {
    if (!b.n) return { lower: b.lower, upper: b.upper, count: 0, meanConfidence: null, accuracy: null, gap: null };
    const mc = b.conf / b.n, acc = b.hit / b.n, gap = Math.abs(acc - mc);
    ece += (b.n / N) * gap; mce = Math.max(mce, gap);
    return { lower: b.lower, upper: b.upper, count: b.n, meanConfidence: mc, accuracy: acc, gap };
  });
  const report: CalibrationReport = { schemaVersion: 1, bins: out, samples: N, dropped: samples.length - N, ece: N ? ece : 0, mce, brier: N ? brier / N : 0 };
  if (perField && ok.some((s) => s.field)) {
    const groups = new Map<string, CalibrationSample[]>();
    for (const s of ok) if (s.field) groups.set(s.field, [...(groups.get(s.field) ?? []), s]);
    report.byField = Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, xs]) => {
      const r = calibrationReport(xs, nBins, false);
      return [f, { samples: r.samples, ece: r.ece, brier: r.brier }];
    }));
  }
  return report;
}

/**
 * Calibration samples from a scored document: each predicted value that was aligned to a reference
 * record inherits its record's `confidence` (ClinicalDoc entities carry one confidence each).
 * Correct = outcome 'correct'. Unaligned predictions (hallucinated records) count as incorrect.
 */
export function calibrationSamples(score: FieldScore, predicted: ClinicalDoc): CalibrationSample[] {
  const out: CalibrationSample[] = [];
  for (const c of score.comparisons) {
    if (c.actual === null || c.predIndex === undefined) continue;
    const ent = c.entityType === 'medication' ? predicted.medications[c.predIndex] : predicted.labResults[c.predIndex];
    const conf = ent?.confidence;
    if (conf === undefined) continue;
    out.push({ confidence: conf, correct: c.outcome === 'correct', field: `${c.entityType}.${c.field}` });
  }
  return out;
}
