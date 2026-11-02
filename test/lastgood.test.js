import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-lastgood-'));
const { rememberData, lastGood, flushLastGood, _resetLastGood, MAX_AGE_MS } = await import('../src/lastgood.js');

test('last good data: per settings key, survives a restart, expires', () => {
  const now = Date.now();
  rememberData('m1', 'k1', { temp: 12 }, now);
  assert.deepEqual(lastGood('m1', 'k1', now).data, { temp: 12 });
  assert.equal(lastGood('m1', 'other-settings', now), null, 'settings changed → no fallback');
  assert.equal(lastGood('m2', 'k1', now), null);

  flushLastGood();
  _resetLastGood(); // "restart": read back from disk
  assert.deepEqual(lastGood('m1', 'k1', now).data, { temp: 12 });
  assert.equal(lastGood('m1', 'k1', now + MAX_AGE_MS + 1), null, 'too old');
});

test('large payloads are not kept', () => {
  rememberData('big', 'k', { blob: 'x'.repeat(300 * 1024) });
  assert.equal(lastGood('big', 'k'), null);
});
