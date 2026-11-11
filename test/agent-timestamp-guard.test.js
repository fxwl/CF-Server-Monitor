import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimestamp, normalizeMetricSamples } from '../src/handlers/update.js';

test('accepts a valid agent timestamp in milliseconds', () => {
  assert.equal(normalizeTimestamp(1700000000000, 1700000001000), 1700000000000);
});

test('accepts a valid agent timestamp in seconds', () => {
  assert.equal(normalizeTimestamp(1700000000, 1700000001000), 1700000000000);
});

test('clamps future timestamps to the Worker receive time', () => {
  assert.equal(normalizeTimestamp(1700004000000, 1700000000000), 1700000000000);
});

test('accepts minor clock drift within two minutes', () => {
  assert.equal(normalizeTimestamp(1700000120000, 1700000000000), 1700000120000);
});

test('normalizes batched samples with future dates', () => {
  const before = Date.now();
  const samples = normalizeMetricSamples({
    samples: [{ ts: before + 3600000, metrics: { cpu: 10 } }]
  });
  const after = Date.now();
  assert.equal(samples.length, 1);
  assert.ok(samples[0].ts >= before && samples[0].ts <= after);
});
