// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_THRESHOLDS, readingText, runPipeline, type ClinicalDoc, type ImagePayload } from '@med-ocr/core';
import { describe, expect, it } from 'vitest';
import { formatRedactionCounts, runDeidentify, tryAssertSafeForCloud } from './cloud-guard';
import { SAMPLE_TRANSCRIPT, mockPipelines } from './mock';
import { READ_PROMPT, deidStage, hybridVerify } from './stages';

const PHI_TRANSCRIPT = `Patient Name: Ravi Kumar Sharma
Ph: +91 98765 43210
ABHA: 12-3456-7890-1234
Tab Dolo 650 BD
Haemoglobin 12.5 g/dL`;

const image: ImagePayload = { mimeType: 'image/png', base64: 'aaaa' };

describe('OCR prompt (verbatim, no redaction)', () => {
  it('does not instruct the model to redact PHI', () => {
    expect(READ_PROMPT).toMatch(/exactly as written/i);
    expect(READ_PROMPT).not.toMatch(/\[REDACTED\]/);
    expect(READ_PROMPT).not.toMatch(/redact/i);
    expect(READ_PROMPT).not.toMatch(/Replace patient names/i);
    expect(READ_PROMPT).not.toMatch(/ABHA|Aadhaar|phone numbers/i);
  });
});

describe('de-identification vs raw OCR', () => {
  it('keeps PHI in the raw OCR transcript and only redacts in the de-id stage', async () => {
    expect(SAMPLE_TRANSCRIPT).toContain('Anita Rao');
    expect(SAMPLE_TRANSCRIPT).toContain('Dr. Mehta');

    const result = runDeidentify(PHI_TRANSCRIPT);
    expect(result.total).toBeGreaterThan(0);
    expect(result.text).not.toMatch(/Ravi Kumar|98765|3456-7890/);
    expect(result.text).toContain('Tab Dolo 650 BD');
    expect(result.text).toContain('Haemoglobin 12.5 g/dL');
    expect(formatRedactionCounts(result.redactions)).toMatch(/name|phone|abha/i);

    const deidOut = await deidStage.run({ kind: 'text', text: PHI_TRANSCRIPT, image }, { runId: 't', docId: 't' });
    expect(deidOut.output.kind).toBe('text');
    if (deidOut.output.kind === 'text') {
      expect(deidOut.output.text).not.toMatch(/Ravi Kumar/);
      expect(deidOut.output.text).toContain('Tab Dolo 650 BD');
    }
    expect(deidOut.metrics.bytesSent).toBe(0);
    expect(deidOut.notes?.join(' ')).toMatch(/De-identified/i);
  });

  it('leaves CER/WER on the raw OCR stage, not the de-id output', async () => {
    const [onDevice, , hybrid] = mockPipelines(DEFAULT_THRESHOLDS);
    const run = await runPipeline(hybrid!, { kind: 'image', image }, { docId: 'sample-lab-1' });
    const raw = readingText(run);
    expect(raw).toContain('Anita Rao');
    expect(raw).toContain('Dr. Mehta');
    const deidStep = run.steps.find((s) => s.stageKind === 'deid');
    expect(deidStep).toBeDefined();
    if (deidStep?.output.kind === 'fields' || deidStep?.output.kind === 'text') {
      const deidText = deidStep.output.kind === 'text' ? deidStep.output.text : deidStep.output.text;
      expect(deidText).not.toBe(raw);
    }
    expect(onDevice).toBeDefined();
  });
});

describe('assertSafeForCloud gate', () => {
  it('allows de-identified lab text through', () => {
    const clean = runDeidentify('Haemoglobin 12.5 g/dL 13.0-17.0\nPlatelets 250000 /cumm').text;
    expect(tryAssertSafeForCloud(clean)).toEqual({ ok: true });
  });

  it('blocks residual PHI and keeps those fields local for human confirm', async () => {
    // Core de-id does not cover street addresses or PIN codes; parsing's
    // assertSafeForCloud still flags them. This is the residual-PHI case.
    const residual = 'Address: Flat 3B, Green Park, New Delhi - 110016\nPIN: 411001\nTab Dolo 650 BD';
    expect(runDeidentify(residual).text).toContain('Green Park');
    const blocked = tryAssertSafeForCloud(residual);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('expected block');
    expect(blocked.residualCount).toBeGreaterThan(0);
    expect(blocked.message).toMatch(/blocked/i);
    // Receipt / error text must not include the identifier values.
    expect(blocked.message).not.toMatch(/Green Park|110016|411001/);

    const doc: ClinicalDoc = {
      documentType: 'prescription',
      medications: [{ name: 'Dolo', strength: '650', confidence: 0.4 }],
      labResults: [],
    };
    let cloudCalled = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      cloudCalled += 1;
      throw new Error('network should not be used');
    }) as typeof fetch;

    try {
      const stage = hybridVerify(DEFAULT_THRESHOLDS);
      const result = await stage.run(
        { kind: 'fields', doc, text: residual, image },
        { runId: 't', docId: 't' },
      );
      expect(cloudCalled).toBe(0);
      expect(result.site).toBe('local_code');
      expect(result.metrics.bytesSent).toBe(0);
      expect(result.output.kind).toBe('fields');
      if (result.output.kind === 'fields') {
        expect(result.output.doc.medications[0]?.name).toBe('Dolo');
        expect(result.output.doc.abstentions?.some((a) => a.includes('HUMAN CONFIRM') && a.includes('Dolo'))).toBe(true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
