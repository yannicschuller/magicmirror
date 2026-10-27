import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airlineFor, prettyType, bearingDeg, pickNearest, spotlightCandidates, parseRoute, parsePhoto, normalizeAircraft, flights } from '../src/providers/flights.js';
import { MODULE_TYPES } from '../public/shared/modules.js';
import de from '../public/shared/locales/de/modules/flights.js';
import deAll from '../public/shared/locales/de/index.js';

const ME = { lat: 51.36, lon: 12.36 };
const ac = (hex, dist, extra = {}) => ({ hex, dist, ground: false, alt: 30000, callsign: `TST${hex}`, ...extra });

// Trimmed real answers (captured 2026-10-27).
const PLANESPOTTERS = { photos: [{ id: '1981050', thumbnail: { src: 'https://t.plnspttrs.net/09561/1981050_77e29380db_t.jpg', size: { width: 200, height: 133 } }, thumbnail_large: { src: 'https://t.plnspttrs.net/09561/1981050_77e29380db_280.jpg', size: { width: 422, height: 280 } }, link: 'https://www.planespotters.net/photo/1981050/d-aibd-lufthansa-airbus-a319-112?utm_source=api', photographer: 'Steffen Müller' }] };
// Shape from adsb.lol's api_routes.py / provider.py (VRS standing data).
const ROUTESET = [
  { callsign: 'DLH2AT', number: '2AT', airline_code: 'DLH', airport_codes: 'EDDF-EDDP', _airport_codes_iata: 'FRA-LEJ', plausible: true, _airports: [
    { name: 'Frankfurt am Main Airport', icao: 'EDDF', iata: 'FRA', location: 'Frankfurt am Main', countryiso2: 'DE', lat: 50.03, lon: 8.57, alt_feet: 364 },
    { name: 'Leipzig/Halle Airport', icao: 'EDDP', iata: 'LEJ', location: 'Leipzig', countryiso2: 'DE', lat: 51.42, lon: 12.24, alt_feet: 465 },
  ] },
  { callsign: 'XXX123', airport_codes: 'unknown', _airports: [] },
];

test('airline from ICAO prefix, operator as fallback', () => {
  assert.equal(airlineFor('DLH4AB'), 'Lufthansa');
  assert.equal(airlineFor('ezy45ql '), 'easyJet');
  assert.equal(airlineFor('QQQ123', 'Some Operator GmbH'), 'Some Operator GmbH');
  assert.equal(airlineFor('DIBAB', 'Private'), 'Private'); // registration-style callsign
  assert.equal(airlineFor('', ''), '');
});

test('type descriptions are prettified', () => {
  assert.equal(prettyType('AIRBUS A-320neo'), 'Airbus A-320neo');
  assert.equal(prettyType('BOEING 737-800'), 'Boeing 737-800');
  assert.equal(prettyType(undefined), '');
});

test('bearing points the right way', () => {
  assert.ok(Math.abs(bearingDeg(51, 12, 52, 12) - 0) < 0.5);
  assert.ok(Math.abs(bearingDeg(51, 12, 51, 13) - 90) < 1);
  assert.ok(Math.abs(bearingDeg(51, 12, 50, 12) - 180) < 0.5);
  assert.ok(Math.abs(bearingDeg(51, 12, 51, 11) - 270) < 1);
});

test('nearest aircraft with hysteresis', () => {
  const list = [ac('a', 5), ac('b', 4.6), ac('c', 12)];
  assert.equal(pickNearest(list, null).hex, 'b');
  // a is current: b is only 0.4 km (8 %) closer → stay on a
  assert.equal(pickNearest(list, 'a').hex, 'a');
  // b clearly closer (more than 10 % and 1 km) → switch
  assert.equal(pickNearest([ac('a', 5), ac('b', 3.5)], 'a').hex, 'b');
  // 10 % but less than 1 km: stay
  assert.equal(pickNearest([ac('a', 2), ac('b', 1.5)], 'a').hex, 'a');
  // current one left → nearest
  assert.equal(pickNearest([ac('c', 12), ac('b', 4.6)], 'a').hex, 'b');
  assert.equal(pickNearest([], 'a'), null);
});

test('spotlight filters', () => {
  const list = [ac('g', 1, { ground: true, alt: 0 }), ac('low', 2, { alt: 800 }), ac('nocs', 3, { callsign: '' }), ac('ok', 4)];
  assert.deepEqual(spotlightCandidates(list).map((a) => a.hex), ['low', 'nocs', 'ok']);
  assert.deepEqual(spotlightCandidates(list, { minAltitudeFt: 1000 }).map((a) => a.hex), ['nocs', 'ok']);
  assert.deepEqual(spotlightCandidates(list, { requireCallsign: true }).map((a) => a.hex), ['low', 'ok']);
  assert.deepEqual(spotlightCandidates(list, { airborneOnly: false }).map((a) => a.hex), ['g', 'low', 'nocs', 'ok']);
});

test('route parsing', () => {
  const r = parseRoute(ROUTESET, 'DLH2AT');
  assert.equal(r.from.iata, 'FRA');
  assert.equal(r.from.city, 'Frankfurt am Main');
  assert.equal(r.to.iata, 'LEJ');
  assert.equal(r.to.name, 'Leipzig/Halle Airport');
  assert.deepEqual(r.via, []);
  assert.equal(parseRoute(ROUTESET, 'XXX123'), null);
  assert.equal(parseRoute(ROUTESET, 'NOPE1'), null);
  assert.equal(r.plausible, true);
  assert.equal(parseRoute([{ ...ROUTESET[0], plausible: false }], 'DLH2AT').plausible, false);
  assert.equal(parseRoute('', 'DLH2AT'), null);
  // multi-leg: first → last, stop-over in via
  const multi = parseRoute([{ callsign: 'ABC1', airport_codes: 'EDDF-EDDP-EKCH', _airports: [] }], 'ABC1');
  assert.equal(multi.from.icao, 'EDDF');
  assert.equal(multi.to.icao, 'EKCH');
  assert.equal(multi.via[0].icao, 'EDDP');
});

test('photo parsing keeps the photographer credit', () => {
  const p = parsePhoto(PLANESPOTTERS);
  assert.equal(p.src, 'https://t.plnspttrs.net/09561/1981050_77e29380db_280.jpg');
  assert.equal(p.photographer, 'Steffen Müller');
  assert.match(p.link, /^https:\/\/www\.planespotters\.net\/photo\//);
  assert.equal(p.width, 422);
  assert.equal(parsePhoto({ photos: [] }), null);
  assert.equal(parsePhoto({ error: 'x' }), null);
  assert.equal(parsePhoto({ photos: [{ thumbnail_large: { src: 'javascript:alert(1)' } }] }), null);
});

test('aircraft normalisation adds bearing, description and operator', () => {
  const [a] = normalizeAircraft([{ hex: '3c6444', flight: 'DLH2AT  ', r: 'D-AIBD', t: 'A319', desc: 'AIRBUS A-319', ownOp: 'Lufthansa', lat: 51.5, lon: 12.36, alt_baro: 12000, gs: 300, track: 90, baro_rate: -1200 }], ME);
  assert.equal(a.callsign, 'DLH2AT');
  assert.equal(a.desc, 'Airbus A-319');
  assert.equal(a.bearing, 0);
  assert.equal(a.speed, 556);
  assert.ok(Math.abs(a.dist - 15.6) < 0.2);
});

test('provider: spotlight only when asked, enrichment can be switched off (no network)', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ac: [
      { hex: 'aaaaaa', flight: 'DLH1', lat: 51.40, lon: 12.36, alt_baro: 20000 },
      { hex: 'bbbbbb', flight: 'EZY2', lat: 51.36, lon: 12.40, alt_baro: 'ground' },
    ] }), { status: 200 });
  };
  try {
    const general = { location: { name: 'Leipzig', ...ME } };
    const base = { source: 'adsblol', radiusKm: 40, refreshSeconds: 10, maxAltitudeFt: 0, useGlobalLocation: true };
    const map = await flights({ ...base, display: 'map' }, { general }, { id: 't1' });
    assert.equal(map.spotlight, undefined);
    assert.equal(map.aircraft.length, 2);
    const near = await flights({ ...base, display: 'nearest', showRoute: false, showPhoto: false }, { general }, { id: 't2' });
    assert.equal(near.spotlight.hex, 'aaaaaa'); // the closer one is on the ground
    assert.equal(near.spotlight.airline, 'Lufthansa');
    assert.equal(near.spotlight.route, null);
    assert.equal(near.spotlight.photo, null);
    assert.equal(calls.length, 1); // only the cached aircraft request, no route/photo lookups
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('new flights settings keep old behaviour and are translated', () => {
  const fields = Object.fromEntries(MODULE_TYPES.flights.fields.map((f) => [f.key, f]));
  assert.equal(fields.display.default, 'map');
  assert.equal(fields.units.default, 'ft_kmh');
  for (const f of MODULE_TYPES.flights.fields) {
    if (f.key === 'display' || f.key === 'units' || f.key.startsWith('spot') || ['showRoute', 'showPhoto', 'showSquawk', 'trailLength'].includes(f.key)) {
      assert.ok(f.label in deAll, f.label);
      (f.options || []).forEach((o) => assert.ok(o.label in deAll, o.label));
    }
  }
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
});
