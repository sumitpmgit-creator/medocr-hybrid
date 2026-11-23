// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(here, '../../firestore.rules'), 'utf8');

const metrics = {
  pipelineId: 'hybrid',
  cer: 0.12,
  wer: 0.2,
  fieldF1: 0.91,
  latencyMs: 1500,
  bytesSent: 420,
  costUsd: 0.0012,
  failed: false,
};

function runDoc(over: Record<string, unknown> = {}) {
  return { ...metrics, createdAt: serverTimestamp(), ...over };
}

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-med-ocr',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });
});

afterEach(async () => {
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

function db(uid?: string) {
  const ctx = uid ? env.authenticatedContext(uid) : env.unauthenticatedContext();
  return ctx.firestore();
}

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

describe('users/{uid}/runs', () => {
  it('denies unauthenticated read and write', async () => {
    await seed('users/alice/runs/r1', { ...metrics, createdAt: Timestamp.now() });
    await assertFails(getDoc(doc(db(), 'users/alice/runs/r1')));
    await assertFails(setDoc(doc(db(), 'users/alice/runs/r2'), runDoc()));
  });

  it('allows the owner to create the current web-app metrics payload', async () => {
    const ref = await assertSucceeds(addDoc(collection(db('alice'), 'users/alice/runs'), runDoc()));
    expect(ref.id).toBeTruthy();
  });

  it('allows CER greater than 1.0 (error rate can exceed 1)', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ cer: 1.5 })));
  });

  it('allows null scores (no reference transcription)', async () => {
    await assertSucceeds(
      setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ cer: null, wer: null, fieldF1: null })),
    );
  });

  it('denies a missing required field', async () => {
    const { pipelineId: _omit, ...rest } = runDoc() as typeof metrics & { createdAt: unknown; pipelineId: string };
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), rest));
  });

  it('denies negative latency', async () => {
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ latencyMs: -1 })));
  });

  it('denies fieldF1 outside 0..1', async () => {
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ fieldF1: 1.2 })));
  });

  it('denies an oversized error string', async () => {
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ error: 'x'.repeat(2001) })));
  });

  it('denies image / base64 / raw transcript fields (no medical images or PHI payloads)', async () => {
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ base64: 'aaaa' })));
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ image: { mimeType: 'image/png' } })));
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ rawText: 'Patient: Ravi' })));
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ patientName: 'Ravi' })));
  });

  it('denies unknown keys', async () => {
    await assertFails(setDoc(doc(db('alice'), 'users/alice/runs/r1'), runDoc({ unexpected: true })));
  });

  it('denies results text on a run (metrics only; no medications or lab values)', async () => {
    await assertFails(
      setDoc(
        doc(db('alice'), 'users/alice/runs/r1'),
        runDoc({
          documentType: 'prescription',
          medications: [{ name: 'Zifi', strength: '200mg', confidence: 0.9, sourceText: 'Zifi 200 mg BD' }],
          labResults: [],
          abstentions: ['dose unclear'],
        }),
      ),
    );
  });

  it('denies writing into another user path', async () => {
    await assertFails(setDoc(doc(db('alice'), 'users/bob/runs/r1'), runDoc()));
  });

  it('denies Bob reading or deleting Alice’s run', async () => {
    await seed('users/alice/runs/r1', { ...metrics, createdAt: Timestamp.now() });
    await assertFails(getDoc(doc(db('bob'), 'users/alice/runs/r1')));
    await assertFails(deleteDoc(doc(db('bob'), 'users/alice/runs/r1')));
  });

  it('allows Alice to read, update (without changing createdAt), and delete her run', async () => {
    const createdAt = Timestamp.fromMillis(1_700_000_000_000);
    await seed('users/alice/runs/r1', { ...metrics, createdAt });
    await assertSucceeds(getDoc(doc(db('alice'), 'users/alice/runs/r1')));
    await assertSucceeds(updateDoc(doc(db('alice'), 'users/alice/runs/r1'), { failed: true, createdAt }));
    await assertFails(updateDoc(doc(db('alice'), 'users/alice/runs/r1'), { createdAt: Timestamp.now() }));
    await assertSucceeds(deleteDoc(doc(db('alice'), 'users/alice/runs/r1')));
  });

  it('denies an update that adds a forbidden field', async () => {
    const createdAt = Timestamp.now();
    await seed('users/alice/runs/r1', { ...metrics, createdAt });
    await assertFails(updateDoc(doc(db('alice'), 'users/alice/runs/r1'), { rawText: 'leak' }));
  });

  it('allows Alice to list only her own runs', async () => {
    await seed('users/alice/runs/r1', { ...metrics, createdAt: Timestamp.now() });
    await seed('users/bob/runs/r1', { ...metrics, createdAt: Timestamp.now() });
    const snap = await assertSucceeds(getDocs(collection(db('alice'), 'users/alice/runs')));
    expect(snap.size).toBe(1);
    await assertFails(getDocs(collection(db('alice'), 'users/bob/runs')));
  });
});

describe('users/{uid}/results', () => {
  it('denies writing users/{uid}/results even for the owner (metrics only; path is deny-by-default)', async () => {
    const payload = {
      createdAt: serverTimestamp(),
      runId: 'run_1',
      pipelineId: 'hybrid',
      documentType: 'lab_report',
      medications: [],
      labResults: [],
    };
    await assertFails(setDoc(doc(db('alice'), 'users/alice/results/res1'), payload));
    await assertFails(setDoc(doc(db('bob'), 'users/alice/results/res1'), payload));
    await assertFails(setDoc(doc(db(), 'users/alice/results/res1'), payload));
  });

  it('denies reading users/{uid}/results even for the owner', async () => {
    await seed('users/alice/results/res1', { pipelineId: 'hybrid', createdAt: Timestamp.now() });
    await assertFails(getDoc(doc(db('alice'), 'users/alice/results/res1')));
    await assertFails(getDoc(doc(db(), 'users/alice/results/res1')));
  });
});

describe('default deny', () => {
  it('denies writes to the user parent doc and to any other collection', async () => {
    await assertFails(setDoc(doc(db('alice'), 'users/alice'), { ok: true }));
    await assertFails(setDoc(doc(db('alice'), 'runs/r1'), runDoc()));
    await assertFails(setDoc(doc(db('alice'), 'public/doc'), { open: true }));
  });
});
