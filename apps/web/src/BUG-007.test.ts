// SPDX-License-Identifier: Apache-2.0
import { type StageContext } from '@med-ocr/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TIMEOUT_STATUS,
  cloudAbortSignal,
  isTimeoutOrAbort,
  setCloudReachableForTests,
} from './cloud-call';
import { CLEAN_CLOUD_TRANSCRIPT, mockCloudStructure, setMockCloudBehavior } from './mock';

const ctx = (signal?: AbortSignal): StageContext => ({ runId: 'bug-007', docId: 'bug-007', signal });
const cleanText = { kind: 'text' as const, text: CLEAN_CLOUD_TRANSCRIPT };

afterEach(() => {
  setMockCloudBehavior('ok');
  setCloudReachableForTests(undefined);
});

describe('BUG-007: AbortSignal.timeout plus user cancel on every cloud call', () => {
  it('combines AbortSignal.timeout with the user cancel signal', async () => {
    const user = new AbortController();
    const signal = cloudAbortSignal(user.signal, 40);
    const started = Date.now();
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
      setTimeout(() => reject(new Error('timeout signal never aborted')), 200);
    });
    expect(Date.now() - started).toBeLessThan(200);
    expect(signal.aborted).toBe(true);
    expect(isTimeoutOrAbort(signal.reason) || isTimeoutOrAbort(new DOMException('The operation was aborted.', 'TimeoutError'))).toBe(true);
  });

  it('aborts immediately when the user cancels', () => {
    const user = new AbortController();
    user.abort(new DOMException('cancelled', 'AbortError'));
    const signal = cloudAbortSignal(user.signal, 20_000);
    expect(signal.aborted).toBe(true);
    expect(isTimeoutOrAbort(signal.reason)).toBe(true);
  });

  it('treats a stalled cloud call timeout like offline: human review, run not failed', async () => {
    setMockCloudBehavior('hang', { timeoutMs: 30 });
    const result = await mockCloudStructure.run(cleanText, ctx());
    expect(result.error).toBeUndefined();
    expect(result.site).toBe('on_device');
    expect(result.notes?.join('\n')).toContain(TIMEOUT_STATUS);
    expect(result.notes?.join('\n')).toContain('status:timeout');
    expect(result.metrics.bytesSent).toBe(0);
    if (result.output.kind !== 'fields') throw new Error('expected fields');
    expect(result.output.doc.abstentions?.join('\n')).toMatch(/HUMAN CONFIRM/);
  });

  it('treats a user cancel during a stalled cloud call as human review, not a crash', async () => {
    setMockCloudBehavior('hang', { timeoutMs: 20_000 });
    const user = new AbortController();
    const running = mockCloudStructure.run(cleanText, ctx(user.signal));
    await new Promise((r) => setTimeout(r, 20));
    user.abort();
    const result = await running;
    expect(result.error).toBeUndefined();
    expect(result.site).toBe('on_device');
    expect(result.notes?.join('\n')).toContain(TIMEOUT_STATUS);
    if (result.output.kind !== 'fields') throw new Error('expected fields');
    expect(result.output.doc.abstentions?.join('\n')).toMatch(/HUMAN CONFIRM/);
  });
});
