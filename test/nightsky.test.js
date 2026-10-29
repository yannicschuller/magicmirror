import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sat from 'satellite.js';
import { Observer } from 'astronomy-engine';
import {
  compass, brightness, parseTle, findPasses, nightWindow, planetsTonight, moonInfo, separation,
  conjunctions, meteorShowers, buildNightSky, provider,
} from '../src/providers/nightsky.js';
import { sunPosition } from '../public/shared/astro.js';
import schema from '../public/shared/modules/nightsky.js';
import de from '../public/shared/locales/de/modules/nightsky.js';
import { applyDefaults } from '../public/shared/modules.js';

// ISS element set as served by CelesTrak (epoch 2026-10-29 04:14 UTC).
const TLE = `ISS (ZARYA)
1 25544U 98067A   26302.17661613  .00005622  00000+0  10975-3 0  9993
2 25544  51.6334 357.0447 0007004 322.8383  37.2120 15.49096712592526
`;
const BERLIN = { lat: 52.52, lon: 13.405 };
const NOON = Date.parse('2026-10-29T12:00:00Z');
const DAY = 86400000;
const { line1, line2 } = parseTle(TLE);
const satrec = sat.twoline2satrec(line1, line2);

test('compass maps azimuths to 8 points', () => {
  assert.equal(compass(0), 'N');
  assert.equal(compass(359), 'N');
  assert.equal(compass(22), 'N');
  assert.equal(compass(23), 'NE');
  assert.equal(compass(90), 'E');
  assert.equal(compass(180), 'S');
  assert.equal(compass(225), 'SW');
  assert.equal(compass(315), 'NW');
  assert.equal(compass(-45), 'NW');
  assert.equal(compass(720 + 90), 'E');
});

test('brightness category follows max elevation', () => {
  assert.equal(brightness(80), 'very bright');
  assert.equal(brightness(30), 'bright');
  assert.equal(brightness(12), 'moderate');
});

test('parseTle accepts 2 and 3 line sets and rejects garbage', () => {
  assert.equal(parseTle(TLE).name, 'ISS (ZARYA)');
  assert.equal(parseTle(`${line1}\r\n${line2}\r\n`).line2, line2);
  assert.throws(() => parseTle('<html>error</html>'), /Invalid ISS orbit data/);
});

test('all passes: ordered times, elevations within bounds', () => {
  const always = { sunAltitude: () => -20, sunlit: () => true };
  const passes = findPasses(satrec, BERLIN, NOON, NOON + 2 * DAY, { minElevation: 0, ...always });
  assert.ok(passes.length >= 6, `ISS passes Berlin several times a day (${passes.length})`);
  let prevEnd = 0;
  for (const p of passes) {
    const s = Date.parse(p.start), m = Date.parse(p.max), e = Date.parse(p.end);
    assert.ok(s <= m && m <= e, 'start ≤ max ≤ end');
    assert.ok(s > prevEnd, 'passes do not overlap');
    prevEnd = e;
    assert.ok(p.duration > 0 && p.duration < 15 * 60, `duration ${p.duration}`);
    assert.ok(p.maxEl >= 0 && p.maxEl <= 90);
    assert.ok(p.startEl <= 1 && p.endEl <= 1, 'rise and set lie on the horizon');
    assert.ok(p.maxEl >= p.startEl && p.maxEl >= p.endEl);
    assert.ok(p.visible, 'always dark + always sunlit → visible');
    assert.equal(p.brightness, brightness(p.maxEl));
  }
  // ISS inclination 51.6° → from 52.5° N it never culminates in the north-west quadrant at high elevation
  const hi = findPasses(satrec, BERLIN, NOON, NOON + 2 * DAY, { minElevation: 30, ...always });
  assert.ok(hi.length < passes.length && hi.every((p) => p.maxEl >= 30));
});

test('visibility rule: needs dark sky and a sunlit ISS', () => {
  const window = [NOON, NOON + DAY];
  const day = findPasses(satrec, BERLIN, ...window, { minElevation: 0, sunAltitude: () => 10, sunlit: () => true });
  assert.ok(day.length > 0 && day.every((p) => !p.visible && p.brightness === null));
  const shadow = findPasses(satrec, BERLIN, ...window, { minElevation: 0, sunAltitude: () => -20, sunlit: () => false });
  assert.ok(shadow.length > 0 && shadow.every((p) => !p.visible));
  // Civil twilight (-3°) is too bright, nautical (-8°) is fine.
  assert.ok(findPasses(satrec, BERLIN, ...window, { minElevation: 0, sunAltitude: () => -3, sunlit: () => true }).every((p) => !p.visible));
  assert.ok(findPasses(satrec, BERLIN, ...window, { minElevation: 0, sunAltitude: () => -8, sunlit: () => true }).every((p) => p.visible));
});

test('visible part of a pass is cut where the ISS enters the earth shadow', () => {
  const window = [NOON, NOON + DAY];
  const full = findPasses(satrec, BERLIN, ...window, { minElevation: 10, sunAltitude: () => -20, sunlit: () => true });
  const p0 = full[0];
  const cut = Date.parse(p0.max); // ISS disappears at culmination
  const half = findPasses(satrec, BERLIN, ...window, { minElevation: 10, sunAltitude: () => -20, sunlit: (eci, d) => d.getTime() <= cut });
  const h0 = half.find((p) => p.start === p0.start);
  assert.ok(h0?.visible);
  assert.ok(Date.parse(h0.end) <= cut + 5000 && Date.parse(h0.end) < Date.parse(p0.end));
});

test('real sun/shadow model: visible passes happen in the dark', () => {
  const passes = findPasses(satrec, BERLIN, NOON, NOON + 3 * DAY, { minElevation: 10 }).filter((p) => p.visible);
  assert.ok(passes.length >= 1, 'late October has morning passes over Berlin');
  for (const p of passes) {
    assert.ok(sunPosition(new Date(p.start), BERLIN.lat, BERLIN.lon).altitude < -6);
    assert.ok(p.maxEl >= 10);
  }
});

test('min elevation filters the visible part', () => {
  const opts = { sunAltitude: () => -20, sunlit: () => true };
  const lo = findPasses(satrec, BERLIN, NOON, NOON + 2 * DAY, { minElevation: 0, ...opts });
  const hi = findPasses(satrec, BERLIN, NOON, NOON + 2 * DAY, { minElevation: 45, ...opts });
  assert.deepEqual(hi.map((p) => p.start), lo.filter((p) => p.maxEl >= 45).map((p) => p.start));
});

const obs = new Observer(BERLIN.lat, BERLIN.lon, 0);

test('night window is dark and ordered; none in polar summer', () => {
  const n = nightWindow(obs, new Date(NOON));
  assert.ok(n.start > new Date(NOON) && n.end > n.start);
  assert.ok(sunPosition(new Date((+n.start + +n.end) / 2), BERLIN.lat, BERLIN.lon).altitude < -6);
  const inNight = nightWindow(obs, new Date('2026-10-29T23:00:00Z'));
  assert.ok(inNight.start < new Date('2026-10-29T23:00:00Z') && inNight.end > new Date('2026-10-29T23:00:00Z'));
  assert.equal(nightWindow(new Observer(78.2, 15.6, 0), new Date('2026-06-21T12:00:00Z')), null);
});

test('planets tonight (Berlin, 29 Oct 2026): Saturn evening, Jupiter morning, Venus not', () => {
  const now = new Date(NOON);
  const list = planetsTonight(obs, nightWindow(obs, now), now);
  const by = Object.fromEntries(list.map((p) => [p.id, p]));
  // Saturn was at opposition on 4 Oct 2026 – up in the evening, culminating in the south.
  assert.ok(by.saturn, 'Saturn visible');
  assert.ok(by.saturn.alt > 20 && ['S', 'SE', 'SW'].includes(by.saturn.dir));
  // Jupiter is a morning object in autumn 2026 and bright.
  assert.ok(by.jupiter && Date.parse(by.jupiter.best) > Date.parse('2026-10-29T23:00:00Z') && by.jupiter.mag < -1.5);
  // Venus is at inferior conjunction (24 Oct 2026) – not in a dark sky.
  assert.equal(by.venus, undefined);
  for (const p of list) assert.ok(p.from <= p.best && p.best <= p.to && p.alt >= 5);
  assert.deepEqual(list.map((p) => p.best), [...list.map((p) => p.best)].sort());
  assert.deepEqual(planetsTonight(obs, null, now), []);
});

test('moon info', () => {
  const m = moonInfo(obs, new Date(NOON));
  assert.ok(m.fraction > 0.7 && m.fraction < 1, `fraction ${m.fraction}`); // full moon 26 Oct 2026
  assert.equal(m.waxing, false);
  assert.ok(Date.parse(m.rise) > NOON && Date.parse(m.set) > NOON);
});

test('separation and conjunctions', () => {
  assert.equal(Math.round(separation({ ra: 0, dec: 0 }, { ra: 1, dec: 0 })), 15);
  assert.equal(Math.round(separation({ ra: 5, dec: 89 }, { ra: 17, dec: 89 })), 2);
  const list = conjunctions(obs, new Date(NOON), { nights: 7, maxDeg: 3 });
  for (const c of list) assert.ok(c.sep <= 3 && c.alt >= 5);
  assert.ok(conjunctions(obs, new Date(NOON), { nights: 7, maxDeg: 10 }).length >= list.length);
});

test('meteor showers near the current date', () => {
  const dec = meteorShowers(new Date('2026-12-05T12:00:00Z'), 'Europe/Berlin', 14);
  assert.deepEqual(dec.map((e) => e.name), ['Geminids']);
  assert.equal(dec[0].peak, '2026-12-14');
  const yearEnd = meteorShowers(new Date('2026-12-28T12:00:00Z'), 'Europe/Berlin', 14).map((e) => e.peak);
  assert.deepEqual(yearEnd, ['2027-01-03']);
  assert.deepEqual(meteorShowers(new Date('2026-03-01T12:00:00Z'), 'UTC', 14), []);
});

test('buildNightSky: settings, filters and data shape', () => {
  const settings = applyDefaults(schema.fields, {});
  const d = buildNightSky(settings, { ...BERLIN, now: new Date(NOON), tleText: TLE });
  assert.ok(d.night && d.iss.passes.length <= settings.maxPasses);
  assert.ok(d.iss.passes.every((p) => p.visible));
  assert.ok(d.iss.tleEpoch.startsWith('2026-10-29T04:14'));
  assert.ok(Array.isArray(d.planets) && d.moon && Array.isArray(d.events));
  // passes within the next 24 h carry a coarse track for "look NW"
  for (const p of d.iss.passes) if (Date.parse(p.start) < NOON + DAY) assert.ok(p.track.length >= 2);

  const all = buildNightSky({ ...settings, onlyVisible: false, maxPasses: 20, issDays: 1 }, { ...BERLIN, now: new Date(NOON), tleText: TLE });
  assert.ok(all.iss.passes.some((p) => !p.visible));
  assert.ok(all.iss.passes.every((p) => Date.parse(p.start) < NOON + DAY + 15 * 60000));

  const bare = buildNightSky({ ...settings, showPlanets: false, showMoon: false, showEvents: false }, { ...BERLIN, now: new Date(NOON), tleError: 'offline' });
  assert.equal(bare.iss.error, 'offline');
  assert.equal(bare.planets, undefined);
  assert.equal(bare.moon, undefined);
  assert.equal(bare.events, undefined);
});

// provider(): CelesTrak is mocked; the TLE must be downloaded only once.
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

test('provider downloads the TLE once and caches it', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(TLE, { status: 200 });
  };
  const cfg = { general: { locale: 'de-DE', timezone: 'Europe/Berlin', location: { name: 'Berlin', ...BERLIN } } };
  const settings = applyDefaults(schema.fields, {});
  const a = await provider(settings, cfg);
  const b = await provider({ ...settings, issDays: 2 }, cfg);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /celestrak\.org\/NORAD\/elements\/gp\.php\?CATNR=25544&FORMAT=TLE/);
  assert.equal(a.location, 'Berlin');
  assert.ok(a.iss && !a.iss.error && b.iss.days === 2);
});

test('German strings cover schema and renderer and are sorted', () => {
  const ids = [schema.label, schema.description, schema.defaultTitle];
  for (const f of schema.fields) {
    if (f.key === 'location') continue;
    ids.push(f.label);
    if (f.help) ids.push(f.help);
    for (const o of f.options || []) ids.push(o.label);
  }
  const src = readFileSync(new URL('../public/mirror/modules/nightsky.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bt\('([^']+)'/g)) ids.push(m[1]);
  const prov = readFileSync(new URL('../src/providers/nightsky.js', import.meta.url), 'utf8');
  for (const m of prov.matchAll(/fail\('([^']+)'/g)) ids.push(m[1]);
  for (const m of prov.matchAll(/name: '([^']+)', month/g)) ids.push(m[1]);
  ids.push('Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Moon', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'very bright', 'bright', 'moderate');
  const missing = [...new Set(ids)].filter((id) => !(id in de));
  assert.deepEqual(missing, []);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});
