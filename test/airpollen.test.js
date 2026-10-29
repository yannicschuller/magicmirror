import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANCHORS, parseDwd, dwdLevel, pickDwdRegion, dwdForDays, camsLevel, camsForDays, aqiCategory, pollutantLevel, summarizeAir, provider,
} from '../src/providers/airpollen.js';
import schema, { DWD_REGIONS } from '../public/shared/modules/airpollen.js';
import { applyDefaults } from '../public/shared/modules.js';
import de from '../public/shared/locales/de/modules/airpollen.js';

const DWD = JSON.parse(readFileSync(new URL('./fixtures/dwd-pollen.json', import.meta.url), 'utf8'));

// Open-Meteo air-quality response (shape of the real API, shortened to a few hours).
const hours = (day, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${day}T${String(from + i).padStart(2, '0')}:00`);
const OM = {
  latitude: 51.3, longitude: 12.4, timezone: 'Europe/Berlin', utc_offset_seconds: 7200,
  current: { time: '2026-04-14T10:00', interval: 3600, european_aqi: 38, pm2_5: 8.4, pm10: 21.6, ozone: 88, nitrogen_dioxide: 14.2, uv_index: 4.35 },
  hourly: {
    time: [...hours('2026-04-14', 9, 12), ...hours('2026-04-15', 9, 10)],
    european_aqi: [30, 38, 52, 47, 60, 61],
    birch_pollen: [100, 230.5, 180, 40, 12, 3],
    grass_pollen: [0, 0, 0.5, 0.2, 2, 6],
    alder_pollen: [0, 0, 0, 0, 0, 0],
    mugwort_pollen: [null, null, null, null, null, null],
    ragweed_pollen: [0, 0, 0, 0, 0, 0],
  },
};

test('dwdLevel maps the index strings', () => {
  assert.deepEqual(['0', '0-1', '1', '1-2', '2', '2-3', '3'].map(dwdLevel), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  assert.equal(dwdLevel('-1'), null);
  assert.equal(dwdLevel(undefined), null);
});

test('parseDwd normalises regions, partregions and pollen types', () => {
  const p = parseDwd(DWD);
  assert.equal(p.issued, '2026-04-14');
  assert.ok(p.areas['81'], 'partregion id');
  assert.ok(p.areas['50'], 'region without partregions (id -1) uses the region id');
  assert.equal(p.areas['81'].name, 'Tiefland Sachsen');
  assert.equal(p.areas['50'].name, 'Brandenburg und Berlin');
  assert.deepEqual(p.areas['81'].pollen.birch, [2.5, 3, 2]);
  assert.deepEqual(p.areas['81'].pollen.hazel, [0, 0, null]);
  assert.deepEqual(p.areas['81'].pollen.ragweed, [0, 0, 0]);
  assert.throws(() => parseDwd({}), /Unexpected response/);
});

test('every DWD area in the live file is in the region list', () => {
  const ids = Object.keys(parseDwd(DWD).areas);
  for (const id of ids) assert.ok(DWD_REGIONS.some((r) => r.id === id), id);
});

test('pickDwdRegion picks the area from coordinates', () => {
  assert.equal(pickDwdRegion(51.3397, 12.3731).id, '81'); // Leipzig
  assert.equal(pickDwdRegion(51.05, 13.74).id, '81'); // Dresden
  assert.equal(pickDwdRegion(50.42, 12.97).id, '82'); // Oberwiesenthal
  assert.equal(pickDwdRegion(52.52, 13.405).id, '50'); // Berlin
  assert.equal(pickDwdRegion(48.137, 11.575).id, '121'); // Munich
  assert.equal(pickDwdRegion(54.1, 12.1).id, '20'); // Rostock
  assert.equal(pickDwdRegion(49.79, 9.95).id, '124'); // Würzburg
  assert.equal(pickDwdRegion(48.21, 16.37), null, 'Vienna is outside Germany');
  assert.equal(pickDwdRegion(48.21, 16.37, { maxKm: Infinity }).id, '121');
  for (const r of DWD_REGIONS) assert.ok(ANCHORS[r.id]?.length, `anchors for ${r.id}`);
});

test('dwdForDays aligns the forecast days with the calendar', () => {
  const p = parseDwd(DWD);
  assert.deepEqual(dwdForDays(p, '81', ['2026-04-14', '2026-04-15'], ['birch', 'ash']), [
    { id: 'birch', values: [2.5, 3] },
    { id: 'ash', values: [1.5, 1] },
  ]);
  // The morning after: yesterday's "tomorrow" is today.
  assert.deepEqual(dwdForDays(p, '81', ['2026-04-15', '2026-04-16', '2026-04-17'], ['birch']), [{ id: 'birch', values: [3, 2, null] }]);
  assert.equal(dwdForDays(p, '999', ['2026-04-14'], ['birch']), null);
});

test('CAMS pollen → daily peak level', () => {
  assert.equal(camsLevel('birch', 0), 0);
  assert.equal(camsLevel('birch', 0.5), 0.5);
  assert.equal(camsLevel('birch', 10), 1);
  assert.equal(camsLevel('birch', 50), 2);
  assert.equal(camsLevel('birch', 230), 3);
  assert.equal(camsLevel('hazel', 230), null, 'not modelled by CAMS');
  const list = camsForDays(OM, ['2026-04-14', '2026-04-15'], ['hazel', 'birch', 'grass', 'mugwort']);
  assert.deepEqual(list, [
    { id: 'birch', values: [3, 1] },
    { id: 'grass', values: [0.5, 2] },
    { id: 'mugwort', values: [null, null] },
  ]);
});

test('air quality categories and summary', () => {
  assert.deepEqual([10, 30, 50, 70, 90, 120, null].map(aqiCategory), ['good', 'fair', 'moderate', 'poor', 'very poor', 'extremely poor', null]);
  assert.equal(pollutantLevel('pm2_5', 8.4), 'good');
  assert.equal(pollutantLevel('ozone', 88), 'fair');
  assert.equal(pollutantLevel('nitrogen_dioxide', 500), 'extremely poor');
  assert.equal(pollutantLevel('uv_index', 6.2), 'moderate');
  const a = summarizeAir(OM, ['pm2_5', 'ozone', 'uv_index']);
  assert.equal(a.aqi, 38);
  assert.equal(a.level, 'fair');
  assert.deepEqual(a.pollutants.map((p) => [p.id, p.level]), [['pm2_5', 'good'], ['ozone', 'fair'], ['uv_index', 'fair']]);
  assert.deepEqual(a.peak, { aqi: 52, time: '2026-04-14T11:00', level: 'moderate' }, 'only later hours of today');
});

// ---- provider with stubbed fetch (no network) ----------------------------------
let calls = [];
const realFetch = globalThis.fetch;
before(() => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-04-14T10:30:00+02:00') });
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('opendata.dwd.de') ? DWD : OM;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
after(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

const cfg = (location, locale = 'de-DE') => ({ general: { location, locale, timezone: 'Europe/Berlin' } });
const LEIPZIG = { name: 'Leipzig', lat: 51.3397, lon: 12.3731 };
const VIENNA = { name: 'Wien', lat: 48.21, lon: 16.37 };

test('provider: Leipzig uses DWD "Tiefland Sachsen", threshold filters types', async () => {
  calls = [];
  const settings = applyDefaults(schema.fields, { pollenTypes: ['hazel', 'alder', 'ash', 'birch', 'grass'], threshold: '1' });
  const d = await provider(settings, cfg(LEIPZIG));
  assert.equal(d.pollen.source, 'dwd');
  assert.equal(d.pollen.region, 'Tiefland Sachsen');
  assert.deepEqual(d.days, ['2026-04-14', '2026-04-15']);
  assert.deepEqual(d.pollen.items.map((p) => [p.id, p.values]), [['ash', [1.5, 1]], ['birch', [2.5, 3]], ['grass', [0.5, 1]]]);
  assert.equal(d.pollen.total, 5);
  assert.equal(d.pollenAlert, true);
  assert.equal(d.air.aqi, 38);
  assert.equal(d.airAlert, false);
  assert.ok(calls.some((u) => u.includes('opendata.dwd.de')));
  assert.ok(calls.some((u) => u.includes('air-quality-api.open-meteo.com') && !u.includes('_pollen')));
});

test('provider: manual region override and "always" threshold', async () => {
  const settings = applyDefaults(schema.fields, { dwdRegion: '82', pollenTypes: ['birch', 'ragweed'], threshold: '0', days: '3', showAir: false });
  const d = await provider(settings, cfg(LEIPZIG));
  assert.equal(d.pollen.region, 'Mittelgebirge Sachsen');
  assert.deepEqual(d.pollen.items.map((p) => [p.id, p.values]), [['birch', [1, 1.5, 2]], ['ragweed', [0, 0, 0]]]);
  assert.equal(d.air, null);
  assert.equal(d.pollenAlert, true);
});

test('provider: outside Germany falls back to CAMS pollen', async () => {
  calls = [];
  const settings = applyDefaults(schema.fields, { pollenTypes: ['hazel', 'birch', 'grass'], threshold: '2', days: '1' });
  const d = await provider(settings, cfg(VIENNA));
  assert.equal(d.pollen.source, 'cams');
  assert.deepEqual(d.pollen.items.map((p) => [p.id, p.values]), [['birch', [3]]]);
  assert.ok(!calls.some((u) => u.includes('opendata.dwd.de')));
  assert.ok(calls.some((u) => u.includes('birch_pollen')));
});

// (German error texts only appear once the module's dictionary is registered in locales/de/index.js.)
test('provider: errors when nothing can be shown, partial failures keep the rest', async () => {
  globalThis.fetch = async () => new Response('nope', { status: 503 });
  const settings = applyDefaults(schema.fields, {});
  await assert.rejects(provider(settings, cfg({ name: 'Praha', lat: 50.08, lon: 14.42 })), /(Air quality service not reachable|Luftqualitätsdienst nicht erreichbar) \(HTTP 503/);
  // DWD is cached from earlier tests; a failing air-quality request still leaves the pollen.
  const d = await provider(settings, cfg({ name: 'Görlitz', lat: 51.15, lon: 14.99 }));
  assert.equal(d.pollen.region, 'Tiefland Sachsen');
  assert.match(d.air.error, /HTTP 503/);
});

test('German translations cover all schema and renderer strings', () => {
  const strings = new Set([schema.label, schema.description, schema.defaultTitle]);
  for (const f of schema.fields) {
    if (f.key === 'location') continue; // shared field
    strings.add(f.label);
    if (f.help) strings.add(f.help);
    if (f.key !== 'dwdRegion') for (const o of f.options || []) strings.add(o.label);
  }
  strings.add('Automatic (from location)');
  const src = readFileSync(new URL('../public/mirror/modules/airpollen.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bt\('([^']+)'/g)) strings.add(m[1]);
  for (const m of src.matchAll(/(?:LEVEL_TEXT = \[|AQI_TEXT = \{)([^\n]+)/g)) for (const s of m[1].matchAll(/'([A-Z][^']*)'/g)) strings.add(s[1]);
  const prov = readFileSync(new URL('../src/providers/airpollen.js', import.meta.url), 'utf8');
  for (const m of prov.matchAll(/\b(?:fail|t)\('([^']+)'/g)) strings.add(m[1]);
  const missing = [...strings].filter((s) => !(s in de));
  assert.deepEqual(missing, []);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});
