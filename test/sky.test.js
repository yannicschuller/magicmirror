import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, sunPosition, moonIllumination, nextMoonPhase, moonTimes, startOfDay, tzOffset, phaseName, skyData } from '../public/shared/astro.js';
import schema from '../public/shared/modules/sky.js';
import de from '../public/shared/locales/de/modules/sky.js';

const BERLIN = { lat: 52.52, lon: 13.405 };
const MIN = 60000;
const near = (actual, expectedIso, tolMs, what) => {
  const diff = Math.abs(actual - new Date(expectedIso));
  assert.ok(diff <= tolMs, `${what}: got ${actual.toISOString()}, expected ${expectedIso} (±${tolMs / MIN} min), off by ${(diff / MIN).toFixed(1)} min`);
};

// Published values (timeanddate.com / USNO) for Berlin.
test('sunrise/sunset Berlin within ±2 min', () => {
  const summer = sunTimes(new Date('2026-06-21T11:00:00Z'), BERLIN.lat, BERLIN.lon);
  near(summer.sunrise, '2026-06-21T02:43:00Z', 2 * MIN, 'sunrise 21 Jun'); // 04:43 CEST
  near(summer.sunset, '2026-06-21T19:33:00Z', 2 * MIN, 'sunset 21 Jun'); // 21:33 CEST
  const winter = sunTimes(new Date('2026-12-21T11:00:00Z'), BERLIN.lat, BERLIN.lon);
  near(winter.sunrise, '2026-12-21T07:15:00Z', 2 * MIN, 'sunrise 21 Dec'); // 08:15 CET
  near(winter.sunset, '2026-12-21T14:54:00Z', 2 * MIN, 'sunset 21 Dec'); // 15:54 CET
  near(winter.solarNoon, '2026-12-21T11:05:00Z', 2 * MIN, 'solar noon 21 Dec');
  assert.ok(winter.dawn < winter.sunrise && winter.sunrise < winter.goldenHourEnd && winter.goldenHour < winter.sunset && winter.sunset < winter.dusk);
  assert.equal(summer.polar, null);
  assert.ok(Math.abs(summer.dayLength / 3600000 - 16.83) < 0.07);
});

test('polar day and polar night are flagged', () => {
  const svalbard = { lat: 78.22, lon: 15.65 };
  const june = sunTimes(new Date('2026-06-21T12:00:00Z'), svalbard.lat, svalbard.lon);
  assert.equal(june.polar, 'day');
  assert.equal(june.sunrise, null);
  assert.equal(june.dayLength, 86400000);
  const dec = sunTimes(new Date('2026-12-21T12:00:00Z'), svalbard.lat, svalbard.lon);
  assert.equal(dec.polar, 'night');
  assert.equal(dec.dayLength, 0);
});

test('sun position at solar noon is due south at max altitude', () => {
  const p = sunPosition(new Date('2026-06-21T11:09:30Z'), BERLIN.lat, BERLIN.lon);
  assert.ok(Math.abs(p.azimuth - 180) < 2, `azimuth ${p.azimuth}`);
  assert.ok(Math.abs(p.altitude - (90 - 52.52 + 23.44)) < 0.5, `altitude ${p.altitude}`);
});

test('known full and new moons within ±1 day (actually within ±30 min)', () => {
  // Total solar eclipse 2024-04-08 18:21 UTC = new moon; full moons 2026-06-29 23:57, 2026-12-24 01:28 UTC.
  near(nextMoonPhase(new Date('2024-04-01T00:00:00Z'), 0), '2024-04-08T18:21:00Z', 30 * MIN, 'new moon Apr 2024');
  near(nextMoonPhase(new Date('2026-06-20T00:00:00Z'), 180), '2026-06-29T23:57:00Z', 30 * MIN, 'full moon Jun 2026');
  near(nextMoonPhase(new Date('2026-12-01T00:00:00Z'), 180), '2026-12-24T01:28:00Z', 30 * MIN, 'full moon Dec 2026');
  near(nextMoonPhase(new Date('2026-11-01T00:00:00Z'), 0), '2026-11-09T07:02:00Z', 30 * MIN, 'new moon Nov 2026');
});

test('moon illumination and phase names', () => {
  const full = moonIllumination(new Date('2026-06-29T23:57:00Z'));
  assert.ok(full.fraction > 0.99, `full ${full.fraction}`);
  assert.equal(full.name, 'Full moon');
  const nw = moonIllumination(new Date('2024-04-08T18:21:00Z'));
  assert.ok(nw.fraction < 0.01);
  assert.equal(nw.name, 'New moon');
  // First quarter 2026-10-18 16:13 UTC → about half lit, waxing.
  const fq = moonIllumination(new Date('2026-10-18T16:13:00Z'));
  assert.ok(Math.abs(fq.fraction - 0.5) < 0.03);
  assert.equal(fq.waxing, true);
  assert.equal(fq.name, 'First quarter');
  assert.equal(moonIllumination(new Date('2026-10-14T12:00:00Z')).name, 'Waxing crescent');
  assert.equal(moonIllumination(new Date('2026-10-30T12:00:00Z')).name, 'Waning gibbous');
  assert.equal(phaseName(0.99), 'New moon');
  assert.equal(phaseName(0.8), 'Waning crescent');
});

test('moonrise/moonset found once per day when they occur', () => {
  // Berlin 2026-10-27 (just after full moon): moonset in the morning, moonrise late afternoon.
  const mt = moonTimes(startOfDay(new Date('2026-10-27T12:00:00Z'), 'Europe/Berlin'), BERLIN.lat, BERLIN.lon);
  assert.ok(mt.rise && mt.set);
  assert.ok(mt.set < mt.rise);
  // Day after full moon: rises around sunset (~16:50 CET), sets after sunrise.
  near(mt.rise, '2026-10-27T15:45:00Z', 60 * MIN, 'moonrise');
  near(mt.set, '2026-10-27T08:01:00Z', 60 * MIN, 'moonset');
});

test('time zone helpers handle DST', () => {
  assert.equal(tzOffset(new Date('2026-07-01T12:00:00Z'), 'Europe/Berlin'), 2 * 3600000);
  assert.equal(tzOffset(new Date('2026-12-01T12:00:00Z'), 'Europe/Berlin'), 3600000);
  assert.equal(startOfDay(new Date('2026-10-25T12:00:00Z'), 'Europe/Berlin').toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(startOfDay(new Date('2026-10-25T12:00:00Z'), 'Europe/Berlin', 1).toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(startOfDay(new Date('2026-10-24T23:30:00Z'), 'Europe/Berlin').toISOString(), '2026-10-24T22:00:00.000Z');
});

test('skyData: day length shrinks in autumn', () => {
  const d = skyData(new Date('2026-10-27T10:00:00Z'), BERLIN.lat, BERLIN.lon, 'Europe/Berlin');
  assert.ok(d.dayLengthDelta < -3 * MIN && d.dayLengthDelta > -5 * MIN);
  assert.ok(d.nextNew < d.nextFull);
});

test('schema and German strings', () => {
  assert.equal(schema.type, 'sky');
  const ids = [schema.label, schema.description, schema.defaultTitle];
  for (const f of schema.fields) {
    ids.push(f.label);
    for (const o of f.options || []) ids.push(o.label);
  }
  for (const id of ids.filter((x) => x !== 'Location')) assert.ok(de[id], `missing German: ${id}`);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)));
});
