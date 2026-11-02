import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { provider, hourly, cheapestWindow, level } from '../src/providers/energy.js';
import schema from '../public/shared/modules/energy.js';
import { applyDefaults } from '../public/shared/modules.js';
import { CONDITIONS } from '../public/shared/conditions.js';
import de from '../public/shared/locales/de/modules/energy.js';

const HOUR = 3600000;
const CFG = { general: { timezone: 'Europe/Berlin' }, modules: [] };
const settings = (o) => ({ ...applyDefaults(schema.fields, {}), ...o });

test('15-minute slots → hourly averages; cheapest window from now', () => {
  const t0 = Date.parse('2026-11-03T00:00:00Z');
  const h = hourly([{ start: t0, price: 10 }, { start: t0 + 15 * 60000, price: 20 }, { start: t0 + HOUR, price: 5 }]);
  assert.deepEqual(h, [{ start: t0, price: 15 }, { start: t0 + HOUR, price: 5 }]);
  const hours = [30, 20, 10, 12, 40].map((p, i) => ({ start: t0 + i * HOUR, price: p }));
  assert.deepEqual(cheapestWindow(hours, 2, t0 + 30 * 60000), { start: t0 + 2 * HOUR, end: t0 + 4 * HOUR, avg: 11 });
  assert.equal(cheapestWindow(hours, 2, t0 + 4.5 * HOUR), null, 'not enough hours left');
  assert.equal(level(8, 10, 0), 'cheap');
  assert.equal(level(12, 10, 0), 'expensive');
  assert.equal(level(9.5, 10, 9), 'normal');
});

test('provider: exchange price with surcharge and VAT, current hour, condition', async () => {
  const now = Date.parse('2026-11-03T11:20:00Z'); // 12:20 in Berlin
  const start = Date.parse('2026-11-02T23:00:00Z'); // 00:00 Berlin
  const secs = Array.from({ length: 96 }, (_, i) => (start + i * 15 * 60000) / 1000);
  const price = secs.map((_, i) => (Math.floor(i / 4) === 13 ? 20 : 100)); // €/MWh, 13:00–14:00 Berlin cheap
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    assert.match(String(url), /api\.energy-charts\.info\/price\?bzn=DE-LU/);
    return new Response(JSON.stringify({ unix_seconds: secs, price }), { status: 200 });
  });
  try {
    const d = await provider(settings({ surcharge: 10, vat: 0, windowHours: 1 }), CFG, {}, { now });
    assert.equal(d.hours.length, 24);
    assert.equal(d.current.price, 20); // 10 ct exchange + 10 ct surcharge
    assert.equal(d.current.level, 'normal');
    assert.equal(d.window.start, start + 13 * HOUR);
    assert.equal(d.window.avg, 12);
    assert.equal(d.hasTomorrow, false);
    assert.equal(CONDITIONS.energy.test({ current: { level: 'cheap' } }), true);
  } finally {
    fetchMock.mock.restore();
  }
});

test('provider: Tibber needs a token', async () => {
  assert.deepEqual(await provider(settings({ source: 'tibber' }), CFG, {}), { needsSetup: true });
});

test('schema and renderer strings have German translations', () => {
  const ids = [schema.label, schema.description, schema.defaultTitle, CONDITIONS.energy.label];
  for (const f of schema.fields) {
    ids.push(f.label);
    if (f.help) ids.push(f.help);
    for (const o of f.options || []) ids.push(o.label);
  }
  const src = readFileSync(new URL('../public/mirror/modules/energy.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bt\('([^']+)'/g)) if (m[1] !== 'Tomorrow') ids.push(m[1]);
  for (const id of ids) assert.ok(de[id], `missing German: ${id}`);
});
