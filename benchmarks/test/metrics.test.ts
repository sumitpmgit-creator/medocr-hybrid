import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, charErrors, wordErrors, rate, scoreFields, percentile, normalizeValue, flattenFields } from '../src/metrics.ts';
import { costOf } from '../src/cost.ts';
import { EgressMeter } from '../src/meter.ts';

test('levenshtein', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', 'abc'), 0);
});

test('CER/WER with normalisation', () => {
  assert.deepEqual(charErrors('Hello  World', 'hello world'), { edits: 0, refLen: 11 });
  assert.deepEqual(charErrors('helo world', 'hello world'), { edits: 1, refLen: 11 });
  assert.deepEqual(wordErrors('the cat sat', 'the cat sat down'), { edits: 1, refLen: 4 });
  assert.equal(rate([{ edits: 1, refLen: 10 }, { edits: 3, refLen: 10 }]), 0.2);
  assert.equal(rate([]), null);
});

test('field scoring: numbers, order-insensitive named arrays, missing = wrong', () => {
  assert.equal(normalizeValue('13.50'), '13.5');
  assert.equal(normalizeValue('2,50,000'), '250000');
  const gt = { age: '42', tests: [{ name: 'Hb', value: '13.5' }, { name: 'PLT', value: '250000' }] };
  const pred = { Age: 42, tests: [{ name: 'plt', value: '2,50,000' }, { name: 'HB', value: '13.50' }] };
  assert.deepEqual(Object.keys(flattenFields(gt)).sort(), ['age', 'tests[hb].value', 'tests[plt].value']);
  const r = scoreFields(pred, gt);
  assert.equal(r.total, 3);
  assert.equal(r.correct, 3);
  assert.equal(scoreFields({}, gt).correct, 0);
  assert.equal(scoreFields(undefined, gt).total, 3);
});

test('nearest-rank percentiles', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(xs, 50), 5);
  assert.equal(percentile(xs, 95), 10);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 50), null);
});

test('cost never guesses', () => {
  const p: any = { models: { 'gemini-2.5-flash-lite': { input_per_1m_usd: 0.1, output_per_1m_usd: 0.4 } } };
  assert.deepEqual(costOf([], 0, p), { usd: 0 });
  assert.equal(costOf([], 2, p).usd, null);
  assert.equal(costOf([{ model: 'unknown', promptTokens: 1, outputTokens: 1 }], 1, p).usd, null);
  assert.ok(Math.abs(costOf([{ model: 'gemini-2.5-flash-lite', promptTokens: 1_000_000, outputTokens: 1_000_000 }], 1, p).usd! - 0.5) < 1e-12);
});

test('egress meter ignores loopback by default and counts bodies', () => {
  const m = new EgressMeter();
  m.record('http://localhost:5173/x', 'POST', 10, 100);
  m.record('https://firebasevertexai.googleapis.com/v1beta/x', 'POST', 20, 1000);
  const s = m.snapshot();
  assert.equal(s.requests, 1);
  assert.ok(s.bytes > 1020);
  assert.deepEqual(Object.keys(s.hosts), ['firebasevertexai.googleapis.com']);
});
