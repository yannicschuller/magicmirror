// Public transport for the calendar's "time to leave" card: EFA trip parsing (recorded VVO
// responses, no network), journey choice, auto mode and the fallback to walking/driving.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  __setTripDeps, parseEfaTrip, pickJourney, isFootpath, efaTripUrl, efaDateTime, travelTransitBase, transitTrip,
} from '../src/providers/trip.js';
import { __setDeps, computeTravel, travelModeFor } from '../src/providers/route.js';
import { MODULE_TYPES, applyDefaults } from '../public/shared/modules.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/efa-trip-${name}.json`, import.meta.url), 'utf8'));
// Leipzig Hbf → Augustusplatz 9, arriving by 2026-10-28 09:00 (CET) = 08:00Z.
const AUG = fixture('augustusplatz');
// Karl-Heine-Straße 50 → Gohlis, recorded live (a tram 19 min late, an S-Bahn, interchanges).
const CHG = fixture('interchange');
const HBF = { lat: 51.3455, lon: 12.382 };
const NOMINATIM = [{ lat: '51.3379614', lon: '12.3790732', name: 'City-Hochhaus', display_name: 'City-Hochhaus, 9, Augustusplatz, Leipzig' }];
const OSRM = { code: 'Ok', routes: [{ duration: 1260, distance: 1800, geometry: { coordinates: [[12.382, 51.3455], [12.379, 51.338]] } }] };
const defaults = (over = {}) => applyDefaults(MODULE_TYPES.calendar.fields, over);

beforeEach(() => {
  __setTripDeps({ now: () => Date.now() });
  __setDeps({ gapMs: 0 });
});
after(() => {
  __setTripDeps({});
  __setDeps({});
});

test('footpath detection', () => {
  assert.ok(isFootpath({ transportation: { product: { class: 100, name: 'footpath' } } }));
  assert.ok(isFootpath({ transportation: { product: { class: 99, name: 'Fussweg' } } }));
  assert.ok(isFootpath({ transportation: { product: { name: 'Fußweg' } } }));
  assert.ok(isFootpath({}), 'no transportation at all');
  assert.ok(!isFootpath({ transportation: { number: '7', disassembledName: '7', product: { class: 4, name: 'Tram' } } }));
  assert.ok(!isFootpath({ transportation: { number: 'S1', product: { class: 1, name: 'S-Bahn' } } }));
});

test('parses EFA trips: legs, stops, [lat, lon] coordinates, real-time delays', () => {
  const js = parseEfaTrip(AUG);
  assert.equal(js.length, 4);
  const [first] = js;
  assert.equal(first.depart, '2026-10-28T07:45:00.000Z');
  assert.equal(first.arrive, '2026-10-28T07:56:00.000Z');
  assert.equal(first.interchanges, 0);
  assert.deepEqual(first.legs.map((l) => (l.walk ? `walk ${l.min}` : `${l.category} ${l.line}`)), ['walk 5', 'tram 15', 'walk 4']);
  const tram = first.legs[1];
  assert.equal(tram.product, 'Tram');
  assert.equal(tram.direction, 'Meusdorf');
  assert.deepEqual(tram.from, { name: 'Hauptbahnhof', time: '2026-10-28T07:50:00Z', delay: 0, platform: '' });
  assert.equal(tram.to.name, 'Augustusplatz');
  for (const l of first.legs) {
    assert.ok(l.coords.length >= 2);
    for (const [lat, lon] of l.coords) assert.ok(lat > 51.3 && lat < 51.4 && lon > 12.3 && lon < 12.4, `[lat, lon] order: ${lat}, ${lon}`);
  }
  // Walking only.
  assert.deepEqual(js[3].legs.map((l) => l.walk), [true]);

  const c = parseEfaTrip(CHG);
  const late = c[0].legs[2];
  assert.equal(late.line, '12');
  assert.equal(late.from.name, 'Goerdelerring');
  assert.equal(late.from.delay, 19, '16:55 planned → 17:13:54 estimated');
  assert.equal(late.from.time, '2026-10-27T17:13:54Z', 'real-time preferred');
  assert.ok(late.realtime);
  assert.equal(c[0].interchanges, 1);
  assert.equal(c[0].arrive, '2026-10-27T17:23:54.000Z');
  // S-Bahn without disassembledName; stops given as platforms ("1") → name of the parent stop.
  const s1 = c[1].legs[1];
  assert.deepEqual([s1.line, s1.category, s1.from.name, s1.to.name, s1.from.platform], ['S1', 'sbahn', 'S-Bf. Plagwitz', 'S-Bahnhof Gohlis', '1']);
  assert.equal(s1.to.delay, -1);

  assert.deepEqual(parseEfaTrip({ systemMessages: [{ type: 'error' }] }), []);
  assert.deepEqual(parseEfaTrip(null), []);
});

test('picks the latest journey that still arrives in time', () => {
  const js = parseEfaTrip(AUG);
  // By 08:00: tram 15 (07:45 → 07:56), tram 7 (07:49 → 08:00:54, within 1 min), tram 12 (→ 08:02, too late), walk (07:45).
  const j = pickJourney(js, Date.parse('2026-10-28T08:00:00Z'));
  assert.equal(j.depart, '2026-10-28T07:49:00.000Z');
  assert.equal(j.legs[1].line, '7');
  assert.equal(j.late, undefined);
  assert.equal(pickJourney(js, Date.parse('2026-10-28T08:05:00Z')).legs[1].line, '12');
  assert.equal(pickJourney(js, Date.parse('2026-10-28T07:58:00Z')).legs[1].line, '15');
  // None in time → the earliest arrival, marked late.
  const none = pickJourney(js, Date.parse('2026-10-28T07:30:00Z'));
  assert.equal(none.arrive, '2026-10-28T07:56:00.000Z');
  assert.equal(none.late, true);
  assert.equal(pickJourney([], 0), null);
  assert.equal(pickJourney(null, 0), null);

  // Real-time counts: the delayed tram 12 (arrives 17:23:54) misses 17:20, the S-Bahn (17:35) misses 17:31.
  const c = parseEfaTrip(CHG);
  assert.equal(pickJourney(c, Date.parse('2026-10-27T17:31:00Z')).depart, '2026-10-27T17:00:00.000Z');
});

test('auto mode: public transport within the radius, car beyond', () => {
  const s = (over) => ({ travelMode: 'auto', travelTransitRadiusKm: 15, ...over });
  assert.equal(travelModeFor(s(), 4.3), 'transit');
  assert.equal(travelModeFor(s(), 15), 'transit');
  assert.equal(travelModeFor(s(), 15.1), 'car');
  assert.equal(travelModeFor(s({ travelTransitRadiusKm: 5 }), 8), 'car');
  assert.equal(travelModeFor(s({ travelTransitRadiusKm: undefined }), 10), 'transit', 'default 15 km');
  assert.equal(travelModeFor({ travelMode: 'transit' }, 80), 'transit');
  assert.equal(travelModeFor({ travelMode: 'bike' }, 3), 'bike');
  assert.equal(travelModeFor({ travelMode: 'nonsense' }, 3), 'car');
  assert.equal(defaults().travelMode, 'car', 'old configs keep the car');
  assert.equal(defaults().travelTransitRadiusKm, 15);
  assert.equal(defaults().travelMap, true);
});

test('network: own choice, else the departures module, else VVS', () => {
  assert.equal(travelTransitBase({ travelTransitNetwork: 'sachsen' }), 'https://efa.vvo-online.de/VMSSL3/');
  assert.equal(travelTransitBase({ travelTransitNetwork: 'custom', travelTransitUrl: 'https://efa.example.de/efa' }), 'https://efa.example.de/efa/');
  const mods = [
    { type: 'transit', enabled: false, settings: { efaPreset: 'mvv' } },
    { type: 'transit', settings: { provider: 'hafas', baseUrl: 'https://v6.vbb.transport.rest' } },
    { type: 'transit', settings: { provider: 'efa', efaPreset: 'sachsen' } },
  ];
  assert.equal(travelTransitBase({ travelTransitNetwork: '' }, mods), 'https://efa.vvo-online.de/VMSSL3/');
  assert.equal(travelTransitBase({ travelTransitNetwork: '' }, [{ type: 'transit', settings: {} }]), 'https://www3.vvs.de/mngvvs/');
  assert.equal(travelTransitBase({}, []), 'https://www3.vvs.de/mngvvs/');
});

test('trip request: coordinates, local date/time of arrival, 3-minute cache', async () => {
  assert.deepEqual(efaDateTime(Date.parse('2026-10-28T08:00:00Z'), 'Europe/Berlin'), { date: '20261028', time: '0900' });
  assert.deepEqual(efaDateTime(Date.parse('2026-10-24T22:30:00Z'), 'Europe/Berlin'), { date: '20261025', time: '0030' }, 'summer time');
  const u = new URL(efaTripUrl('https://efa.vvo-online.de/VMSSL3/', HBF, { lat: 51.338, lon: 12.379 }, Date.parse('2026-10-28T08:00:00Z'), 'Europe/Berlin'));
  assert.equal(u.pathname, '/VMSSL3/XML_TRIP_REQUEST2');
  const p = Object.fromEntries(u.searchParams);
  assert.equal(p.name_origin, '12.38200:51.34550:WGS84[dd.ddddd]');
  assert.equal(p.name_destination, '12.37900:51.33800:WGS84[dd.ddddd]');
  assert.equal(p.type_origin, 'coord');
  assert.equal(p.itdTripDateTimeDepArr, 'arr');
  assert.equal(p.itdDate, '20261028');
  assert.equal(p.itdTime, '0900');
  assert.equal(p.useRealtime, '1');

  let clock = 0;
  const calls = [];
  __setTripDeps({ now: () => clock, fetchJson: async (url) => { calls.push(url); return AUG; } });
  const to = { lat: 51.338, lon: 12.379 };
  const by = Date.parse('2026-10-28T08:00:20Z');
  assert.equal((await transitTrip('https://x/', HBF, to, by)).length, 4);
  await transitTrip('https://x/', HBF, to, by + 10000);
  assert.equal(calls.length, 1, 'same minute → cached');
  clock += 3 * 60000 + 1;
  await transitTrip('https://x/', HBF, to, by);
  assert.equal(calls.length, 2);

  __setTripDeps({ now: () => clock, fetchJson: async () => { throw new Error('HTTP 503'); } });
  assert.equal(await transitTrip('https://x/', HBF, to, by), null);
  assert.equal(await transitTrip('', HBF, to, by), null);
});

test('computeTravel: public transport card, fallback to walking when EFA fails', async () => {
  const now = new Date('2026-10-28T07:30:00Z');
  const start = '2026-10-28T08:05:00.000Z'; // buffer 5 → arrive by 08:00
  const ev = [{ title: 'Zahnarzt', location: 'Augustusplatz 9, Leipzig', start }];
  const trips = [];
  __setDeps({ gapMs: 0, now: () => now.getTime(), fetchJson: async (url) => (url.includes('nominatim') ? NOMINATIM : OSRM) });
  __setTripDeps({ now: () => now.getTime(), fetchJson: async (url) => { trips.push(url); return AUG; } });
  const s = defaults({ travelCard: true, travelMode: 'auto' });
  const opts = { now, transitBase: 'https://efa.vvo-online.de/VMSSL3/', timeZone: 'Europe/Berlin' };

  const x = await computeTravel(ev, s, HBF, opts);
  assert.equal(x.mode, 'transit');
  assert.equal(x.leaveAt, '2026-10-28T07:49:00.000Z', 'leave = start of the first (walking) leg');
  assert.equal(x.arriveAt, '2026-10-28T08:00:54.000Z');
  assert.equal(x.durationMin, 12);
  assert.equal(x.interchanges, 0);
  assert.equal(x.legs[1].line, '7');
  assert.equal(x.title, 'Zahnarzt');
  assert.equal(x.lead, 30);
  assert.equal(new URL(trips[0]).searchParams.get('itdTime'), '0900');

  // Too early for the card (even with the refresh margin): no trip request at all.
  trips.length = 0;
  assert.equal(await computeTravel(ev, s, HBF, { ...opts, now: new Date('2026-10-28T06:00:00Z') }), null);
  assert.equal(trips.length, 0);

  // EFA down → walk (destination < 2 km) via OSRM, silently.
  __setTripDeps({ now: () => now.getTime(), fetchJson: async () => { throw new Error('timeout'); } });
  const f = await computeTravel(ev, s, HBF, opts);
  assert.equal(f.mode, 'foot');
  assert.equal(f.durationMin, 21);
  assert.equal(f.legs, undefined);

  // Car mode never asks EFA.
  trips.length = 0;
  __setTripDeps({ now: () => now.getTime(), fetchJson: async (url) => { trips.push(url); return AUG; } });
  assert.equal((await computeTravel(ev, defaults({ travelCard: true }), HBF, opts)).mode, 'car');
  assert.equal(trips.length, 0);
});
