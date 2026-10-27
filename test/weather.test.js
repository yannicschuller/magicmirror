import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { weather, weatherHints, summarizeAir } from '../src/providers/weather.js';
import { MODULE_TYPES, applyDefaults, normalizeConfig } from '../public/shared/modules.js';
import { monotonePath, hourlyChart, uvLevel, aqiLevel, pollenLevel, tempColor, compass } from '../public/mirror/weather-chart.js';

// ---- stubbed Open-Meteo -------------------------------------------------------
const HOURS = Array.from({ length: 72 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 27, i));
  return d.toISOString().slice(0, 13) + ':00';
});
const hourlyVal = (fn) => HOURS.map((_, i) => fn(i));

function forecast(u) {
  const imperial = u.searchParams.get('temperature_unit') === 'fahrenheit';
  return {
    current: {
      time: '2026-10-27T14:15', temperature_2m: imperial ? 50 : 10, apparent_temperature: 8, relative_humidity_2m: 80, is_day: 1, weather_code: 61,
      wind_speed_10m: 12, wind_gusts_10m: 40, wind_direction_10m: 225, precipitation: 0.2, uv_index: 2.4,
      pressure_msl: 1013, cloud_cover: 75, visibility: imperial ? 52800 : 24000, dew_point_2m: 6,
    },
    hourly: {
      time: HOURS,
      temperature_2m: hourlyVal((i) => 8 + Math.sin(i / 4) * 4),
      precipitation_probability: hourlyVal((i) => (i % 5) * 20),
      precipitation: hourlyVal((i) => (i % 5) * 0.3),
      weather_code: hourlyVal(() => 61),
      uv_index: hourlyVal((i) => (i % 24 > 8 && i % 24 < 16 ? 6 : 0)),
      wind_gusts_10m: hourlyVal(() => 30),
      is_day: hourlyVal((i) => (i % 24 > 7 && i % 24 < 17 ? 1 : 0)),
    },
    daily: {
      time: ['2026-10-27', '2026-10-28', '2026-10-29'],
      weather_code: [61, 3, 0], temperature_2m_max: [12, 14, 9], temperature_2m_min: [5, 6, 1],
      precipitation_probability_max: [80, 20, 0], precipitation_sum: [3.2, 0.1, 0], uv_index_max: [6.2, 3, 1],
      sunrise: ['2026-10-27T07:02', '2026-10-28T07:04', '2026-10-29T07:06'], sunset: ['2026-10-27T16:40', '2026-10-28T16:38', '2026-10-29T16:36'],
      sunshine_duration: [18000, 3600, 0],
    },
  };
}

function airFixture() {
  const t = HOURS.slice(0, 48).map((h) => h.replace('2026-10-27', '2026-10-27'));
  return {
    current: { time: '2026-10-27T14:00', european_aqi: 27 },
    hourly: {
      time: t,
      european_aqi: t.map(() => 30),
      birch_pollen: t.map((_, i) => (i < 24 ? i * 2 : 500)), // today peak 46, tomorrow higher (ignored)
      grass_pollen: t.map(() => 0),
      alder_pollen: t.map(() => null),
      mugwort_pollen: t.map(() => 0),
      ragweed_pollen: t.map(() => 0),
    },
  };
}

const realFetch = globalThis.fetch;
const calls = [];
before(() => {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (u.host === 'air-quality-api.open-meteo.com') {
      if (u.searchParams.get('latitude') === '10.00') return new Response('boom', { status: 500 });
      return Response.json(airFixture());
    }
    if (u.host === 'api.open-meteo.com') return Response.json(forecast(u));
    if (u.host === 'api.brightsky.dev') return Response.json({ alerts: [] });
    throw new Error(`unexpected fetch ${url}`);
  };
});
after(() => { globalThis.fetch = realFetch; });

const cfgAt = (lat, lon) => ({ general: { locale: 'de-DE', timezone: 'Europe/Berlin', location: { name: 'Testhausen', lat, lon } } });
const defaults = (over = {}) => applyDefaults(MODULE_TYPES.weather.fields, over);

// ---- provider -------------------------------------------------------------------
test('weather: requests and maps the extra variables (metric)', async () => {
  const d = await weather(defaults(), cfgAt(50.1, 8.6));
  const req = calls.find((u) => u.host === 'api.open-meteo.com' && u.searchParams.get('latitude') === '50.100');
  for (const v of ['uv_index', 'pressure_msl', 'cloud_cover', 'visibility', 'dew_point_2m', 'wind_direction_10m']) {
    assert.ok(req.searchParams.get('current').split(',').includes(v), `current ${v}`);
  }
  assert.ok(req.searchParams.get('daily').includes('sunshine_duration'));
  assert.equal(d.current.uv, 2.4);
  assert.equal(d.current.windDir, 225);
  assert.equal(d.current.pressure, 1013);
  assert.equal(d.current.visibility, 24, 'metres → km');
  assert.equal(d.current.cloudCover, 75);
  assert.equal(d.current.dewPoint, 6);
  assert.equal(d.daily[0].sunshine, 18000);
  assert.equal(d.daily[0].uv, 6.2);
  assert.equal(d.hourly[0].time, '2026-10-27T14:00', 'hourly starts at the current hour');
  assert.ok(!('air' in d), 'no air-quality request unless enabled');
  assert.ok(!calls.some((u) => u.host === 'air-quality-api.open-meteo.com'));
});

test('weather: imperial converts visibility and pressure', async () => {
  const d = await weather(defaults({ units: 'imperial' }), cfgAt(40.7, -74));
  const req = calls.find((u) => u.host === 'api.open-meteo.com' && u.searchParams.get('latitude') === '40.700');
  assert.equal(req.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(d.units, 'imperial');
  assert.equal(d.current.visibility, 10, 'feet → miles');
  assert.ok(Math.abs(d.current.pressure - 29.91) < 0.01, 'hPa → inHg');
});

test('weather: air quality and pollen (today peak, null = not available)', async () => {
  const d = await weather(defaults({ airQuality: true, pollen: ['birch', 'grass', 'alder'] }), cfgAt(52.5, 13.4));
  assert.equal(d.air.aqi, 27);
  assert.deepEqual(d.air.pollen, { birch: 46, grass: 0, alder: null });
  const aq = calls.find((u) => u.host === 'air-quality-api.open-meteo.com');
  assert.ok(aq.searchParams.get('hourly').includes('birch_pollen'));
});

test('weather: air-quality failure does not break the module', async () => {
  const d = await weather(defaults({ airQuality: true }), cfgAt(10, 10));
  assert.equal(d.air, null);
  assert.equal(d.current.temp, 10);
});

test('summarizeAir ignores unknown pollen types and missing data', () => {
  assert.deepEqual(summarizeAir({ current: {}, hourly: {} }, ['birch']), { aqi: null, pollen: { birch: null } });
});

test('weatherHints still works with the extended request', async () => {
  const s = applyDefaults(MODULE_TYPES.weather_hints.fields, { dwdWarnings: false });
  const { hints } = await weatherHints(s, cfgAt(48.1, 11.6));
  assert.ok(hints.some((h) => h.kind === 'uv'), 'UV 6 ≥ threshold 5');
  assert.ok(hints.some((h) => h.kind === 'rain'));
});

// ---- schema -----------------------------------------------------------------------
test('old weather settings get defaults that keep the classic look', () => {
  const cfg = normalizeConfig({ modules: [{ id: 'w', type: 'weather', settings: { showCurrent: true, hourlyCount: 6, units: 'metric' } }] });
  const s = cfg.modules[0].settings;
  assert.equal(s.chartStyle, 'icons');
  assert.equal(s.dailyStyle, 'table');
  assert.equal(s.layout, 'detailed');
  assert.equal(s.animation, 'subtle');
  assert.deepEqual(s.extras, ['uv', 'windDirection']);
  assert.equal(s.airQuality, false);
  assert.deepEqual(s.pollen, []);
  const bad = applyDefaults(MODULE_TYPES.weather.fields, { chartStyle: 'pie', extras: ['uv', 'nope'] });
  assert.equal(bad.chartStyle, 'icons');
  assert.deepEqual(bad.extras, ['uv']);
});

// ---- chart helpers --------------------------------------------------------------
const nums = (d) => d.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);

test('monotonePath does not overshoot monotone data', () => {
  const pts = [[0, 50], [10, 40], [20, 10], [30, 9], [40, 9]];
  const d = monotonePath(pts);
  assert.match(d, /^M0 50C/);
  const ys = nums(d).filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) >= 9 && Math.max(...ys) <= 50, `control points stay in range: ${ys}`);
  assert.equal(monotonePath([]), '');
  assert.equal(monotonePath([[1, 2]]), 'M1 2');
});

const hours = Array.from({ length: 30 }, (_, i) => ({ time: `2026-10-27T${String((14 + i) % 24).padStart(2, '0')}:00`, temp: 10 + i / 2, pop: i * 3, precip: i / 10, code: 3, isDay: true }));

test('hourlyChart: line only', () => {
  const { svg, labels } = hourlyChart(hours, { count: 6, step: 2, nowFrac: 0.25, uid: 'x' });
  assert.match(svg, /^<svg class="w-chart-svg" viewBox="0 0 200 85"/);
  assert.equal(labels.length, 6);
  assert.equal(labels[0].hour.time.slice(11, 13), '16');
  assert.ok(!svg.includes('wc-bar'));
  assert.ok(svg.includes('class="wc-now"') && svg.includes('wc-nowdot'));
  assert.ok(svg.includes('>10°<') && svg.includes('>16°<'), 'min and max labels');
  assert.ok(svg.includes('id="wg-x"'));
  assert.ok(labels.every((l, i, a) => i === 0 || l.xPct > a[i - 1].xPct));
});

test('hourlyChart: precipitation bars and label thinning', () => {
  const { svg } = hourlyChart(hours, { count: 6, step: 2, bars: 'probability', uid: 'y' });
  assert.match(svg, /viewBox="0 0 200 111"/);
  assert.equal((svg.match(/class="wc-bar"/g) || []).length, 12, 'one bar per hour, zero values skipped');
  const amount = hourlyChart(hours, { count: 6, step: 2, bars: 'amount', amountMin: 2, fmtBar: (h) => h.precip.toFixed(1) });
  assert.ok(amount.svg.includes('>0.2<'));
  const thin = hourlyChart(hours, { count: 24, step: 1, maxLabels: 6, width: 300 });
  assert.equal(thin.labels.length, 6);
  assert.match(thin.svg, /viewBox="0 0 300 85"/);
  assert.deepEqual(hourlyChart(hours.slice(0, 1), { count: 6, step: 2 }), { svg: '', labels: [] });
});

test('scales', () => {
  assert.deepEqual([0, 2.9, 3, 5.9, 6, 7.9, 8, 10.9, 11].map(uvLevel), ['low', 'low', 'moderate', 'moderate', 'high', 'high', 'very high', 'very high', 'extreme']);
  assert.equal(uvLevel(null), null);
  assert.deepEqual([10, 30, 50, 70, 90, 120].map(aqiLevel), ['good', 'fair', 'moderate', 'poor', 'very poor', 'extremely poor']);
  assert.equal(pollenLevel('birch', 0), null);
  assert.equal(pollenLevel('birch', 46), 'moderate');
  assert.equal(pollenLevel('grass', 25), 'high');
  assert.equal(pollenLevel('ragweed', 600), 'very high');
  assert.equal(pollenLevel('unknown', 600), null);
  assert.equal(compass(0), 'N');
  assert.equal(compass(225), 'SW');
  assert.equal(compass(359), 'N');
  assert.equal(tempColor(-30), 'rgb(165,180,252)');
  assert.equal(tempColor(0), 'rgb(125,211,252)');
  assert.match(tempColor(20), /^rgb\(\d+,\d+,\d+\)$/);
});
