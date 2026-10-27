// "Time to leave" card of the calendar: geocoding/routing parsing, caching,
// Nominatim serialization, window logic and privacy (busy-only calendars).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  __setDeps, parseNominatim, parseOsrm, thin, geocode, route, travelCandidates, inTravelWindow, leaveAtMs, showTravelCard, computeTravel, MAX_POINTS,
} from '../src/providers/route.js';
import { calendar } from '../src/providers/calendar.js';
import { MODULE_TYPES, applyDefaults } from '../public/shared/modules.js';

const NOMINATIM_FIXTURE = [{
  place_id: 135433250, lat: '51.3379614', lon: '12.3790732', category: 'building', type: 'office', name: 'City-Hochhaus',
  display_name: 'City-Hochhaus, 9, Augustusplatz, Zentrum, Mitte, Leipzig, Sachsen, 04109, Deutschland',
}];
const osrmFixture = (n = 12, duration = 1260.4, distance = 18234) => ({
  code: 'Ok',
  routes: [{ duration, distance, geometry: { type: 'LineString', coordinates: Array.from({ length: n }, (_, i) => [12.382 + i * 0.0001, 51.3455 - i * 0.0007]) } }],
});

const HBF = { lat: 51.3455, lon: 12.382 };
const defaults = (over = {}) => applyDefaults(MODULE_TYPES.calendar.fields, over);

// Fake fetch + clock: records each request with the (fake) time it was made.
function fakeNet({ geo = () => NOMINATIM_FIXTURE, osrm = () => osrmFixture() } = {}) {
  const calls = [];
  let clock = Date.parse('2026-10-27T12:00:00Z');
  const deps = {
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchJson: async (url) => {
      calls.push({ url, at: clock });
      clock += 200; // request time
      return url.includes('nominatim') ? geo(url) : osrm(url);
    },
  };
  __setDeps(deps);
  return { calls, advance: (ms) => { clock += ms; }, now: () => clock };
}

beforeEach(() => __setDeps({ gapMs: 1100 }));
after(() => __setDeps({}));

test('parses Nominatim and OSRM responses', () => {
  assert.deepEqual(parseNominatim(NOMINATIM_FIXTURE), { lat: 51.3379614, lon: 12.3790732, label: 'City-Hochhaus' });
  assert.equal(parseNominatim([]), null);
  assert.equal(parseNominatim([{ lat: 'x', lon: '1' }]), null);
  assert.deepEqual(parseNominatim([{ lat: '1', lon: '2', name: '', display_name: 'Augustusplatz, Leipzig' }]).label, 'Augustusplatz');
  assert.equal(parseNominatim([{ lat: '1', lon: '2', name: '', display_name: '50, Karl-Heine-Straße, Plagwitz, Leipzig' }]).label, 'Karl-Heine-Straße 50');

  const r = parseOsrm(osrmFixture(500));
  assert.equal(r.durationMin, 21);
  assert.equal(r.distanceKm, 18.2);
  assert.equal(r.geometry.length, MAX_POINTS);
  assert.deepEqual(r.geometry[0], [51.3455, 12.382], '[lat, lon] order');
  assert.deepEqual(r.geometry.at(-1), [Math.round((51.3455 - 499 * 0.0007) * 1e5) / 1e5, Math.round((12.382 + 499 * 0.0001) * 1e5) / 1e5], 'last point kept');
  assert.equal(parseOsrm({ code: 'NoRoute', routes: [] }), null);
  assert.equal(thin([1, 2, 3], 200).length, 3);
});

test('geocoding: cached (hits and misses) and serialized to max. 1 request per second', async () => {
  const net = fakeNet({ geo: (url) => (url.includes('Nirgendwo') ? [] : NOMINATIM_FIXTURE) });
  const [a, b, c] = await Promise.all([
    geocode('Augustusplatz 9, Leipzig', { near: HBF }),
    geocode('Nirgendwo 1', { near: HBF }),
    geocode('Markt 1, Leipzig', { near: HBF }),
  ]);
  assert.equal(a.label, 'City-Hochhaus');
  assert.equal(b, null);
  assert.ok(c);
  assert.equal(net.calls.length, 3);
  for (let i = 1; i < net.calls.length; i++) assert.ok(net.calls[i].at - net.calls[i - 1].at >= 1100, 'gap between Nominatim requests');
  const u = new URL(net.calls[0].url);
  assert.equal(u.searchParams.get('format'), 'jsonv2');
  assert.equal(u.searchParams.get('limit'), '1');
  assert.equal(u.searchParams.get('q'), 'Augustusplatz 9, Leipzig');

  // Same queries again (also differently spaced/cased) → from cache, misses included.
  await geocode('  augustusplatz 9,   Leipzig ', { near: HBF });
  await geocode('Nirgendwo 1', { near: HBF });
  assert.equal(net.calls.length, 3);
  // Concurrent identical requests share one fetch.
  await Promise.all([geocode('Neu 1', { near: HBF }), geocode('Neu 1', { near: HBF })]);
  assert.equal(net.calls.length, 4);
  // After 30 days the cache expires.
  net.advance(31 * 86400 * 1000);
  await geocode('Augustusplatz 9, Leipzig', { near: HBF });
  assert.equal(net.calls.length, 5);
});

test('routing: endpoints per mode and a 10-minute cache', async () => {
  const net = fakeNet();
  const to = { lat: 51.338, lon: 12.379 };
  const r = await route(HBF, to, 'car');
  assert.equal(r.durationMin, 21);
  await route(HBF, to, 'car');
  assert.equal(net.calls.length, 1);
  assert.match(net.calls[0].url, /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/12\.38200,51\.34550;12\.37900,51\.33800\?overview=simplified&geometries=geojson$/);
  await route(HBF, to, 'bike');
  await route(HBF, to, 'foot');
  assert.match(net.calls[1].url, /routing\.openstreetmap\.de\/routed-bike\/route\/v1\/driving\//);
  assert.match(net.calls[2].url, /routing\.openstreetmap\.de\/routed-foot\/route\/v1\/driving\//);
  net.advance(11 * 60000);
  await route(HBF, to, 'car');
  assert.equal(net.calls.length, 4);
});

test('window logic: which events are considered and when the card shows', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const at = (min) => new Date(now.getTime() + min * 60000).toISOString();
  const s = { travelLeadMinutes: 30, travelBufferMinutes: 5 };
  const evs = [
    { title: 'Zahnarzt', location: 'Augustusplatz 9, Leipzig', start: at(40) },
    { title: 'Ganztags', location: 'Leipzig', start: '2026-10-27', allDay: true },
    { title: 'Call', location: 'https://zoom.us/j/123', start: at(30) },
    { title: 'Teams', location: 'Microsoft Teams-Besprechung', start: at(35) },
    { title: 'Vorbei', location: 'Markt 1', start: at(-5) },
    { title: 'Ohne Ort', location: '', start: at(20) },
    { title: 'Morgen', location: 'Markt 1', start: at(24 * 60) },
  ];
  assert.deepEqual(travelCandidates(evs, now, s).map((e) => e.title), ['Zahnarzt']);

  // 40 min to start, 20 min drive + 5 buffer → leave at +15; card from −15 (lead 30).
  const leave = leaveAtMs(at(40), 20, 5);
  assert.equal(new Date(leave).toISOString(), at(15));
  assert.ok(inTravelWindow(now, at(40), leave, 30));
  const travel = { leaveAt: new Date(leave).toISOString(), lead: 30, start: at(40) };
  assert.ok(showTravelCard(now, travel));
  assert.ok(showTravelCard(new Date(at(30)), travel), 'late: still shown until the start');
  assert.ok(!showTravelCard(new Date(at(40)), travel), 'gone once the event starts');
  assert.ok(!showTravelCard(new Date(at(-16)), travel), 'not before leave − lead');
  // Payload is prepared up to 15 min (refresh margin) before the card shows.
  assert.ok(inTravelWindow(new Date(at(-25)), at(40), leave, 30));
  assert.ok(!inTravelWindow(new Date(at(-31)), at(40), leave, 30));
});

test('computeTravel: routes only events inside the window', async () => {
  const net = fakeNet();
  const now = new Date(net.now());
  const at = (min) => new Date(now.getTime() + min * 60000).toISOString();
  const s = defaults({ travelCard: true });

  const soon = await computeTravel([{ title: 'Zahnarzt Dr. Weber', location: 'Augustusplatz 9, Leipzig', start: at(40) }], s, HBF, { now });
  assert.equal(soon.title, 'Zahnarzt Dr. Weber');
  assert.equal(soon.durationMin, 21);
  assert.equal(soon.distanceKm, 18.2);
  assert.equal(soon.leaveAt, at(40 - 21 - 5));
  assert.equal(soon.lead, 30);
  assert.equal(soon.mode, 'car');
  assert.deepEqual(soon.to, { lat: 51.3379614, lon: 12.3790732, label: 'City-Hochhaus' });
  assert.ok(soon.geometry.length > 1);

  // 3 h ahead and close by: geocoded (cached anyway) but no routing request.
  const before = net.calls.length;
  const later = await computeTravel([{ title: 'Später', location: 'Augustusplatz 9, Leipzig', start: at(180) }], s, HBF, { now });
  assert.equal(later, null);
  assert.equal(net.calls.length, before, 'no Nominatim (cached) and no OSRM call');
});

test('computeTravel: geocoding failure → no card', async () => {
  fakeNet({ geo: () => [] });
  const now = new Date('2026-10-27T12:00:00Z');
  const res = await computeTravel([{ title: 'X', location: 'Unbekannter Ort 99', start: new Date(now.getTime() + 30 * 60000).toISOString() }], defaults({ travelCard: true }), HBF, { now });
  assert.equal(res, null);
});

// ---- provider integration (real ICS over HTTP, fake geocoding/routing) -------------------------

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const vevent = (lines) => ['BEGIN:VEVENT', 'DTSTAMP:20260101T000000Z', ...lines, 'END:VEVENT'].join('\r\n');
const ics = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
let server;
let base;
let startAt;
before(async () => {
  server = http.createServer((req, res) => {
    const s = new Date(startAt);
    const e = new Date(startAt + 3600000);
    const feeds = {
      '/travel-main.ics': ics([vevent(['UID:t1', `DTSTART:${stamp(s)}`, `DTEND:${stamp(e)}`, 'SUMMARY:Zahnarzt Dr. Weber', 'LOCATION:Augustusplatz 9\\, Leipzig'])]),
      '/travel-busy.ics': ics([vevent(['UID:t2', `DTSTART:${stamp(new Date(startAt - 600000))}`, `DTEND:${stamp(e)}`, 'SUMMARY:Therapie', 'LOCATION:Geheimweg 7\\, Leipzig'])]),
    };
    if (!feeds[req.url]) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/calendar' }).end(feeds[req.url]);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('provider: travel card payload; busy-only calendars are never geocoded', async () => {
  startAt = Date.now() + 40 * 60000;
  const calls = [];
  __setDeps({
    gapMs: 0,
    now: () => Date.now(),
    fetchJson: async (url) => {
      calls.push(url);
      return url.includes('nominatim') ? NOMINATIM_FIXTURE : osrmFixture(30, 900, 5400);
    },
  });
  const cfg = { general: { timezone: 'Europe/Berlin', locale: 'de-DE', location: { name: 'Leipzig', ...HBF } } };
  const cals = [
    { name: 'Busy', url: `${base}/travel-busy.ics`, color: '#f0a', enabled: true, busyOnly: true },
    { name: 'Main', url: `${base}/travel-main.ics`, color: '#0af', enabled: true },
  ];

  const off = await calendar(defaults({ calendars: cals }), cfg);
  assert.equal(off.travel, undefined, 'off by default');
  assert.equal(calls.length, 0);

  const res = await calendar(defaults({ calendars: cals, travelCard: true }), cfg);
  assert.deepEqual(res.errors, []);
  assert.equal(res.travel.title, 'Zahnarzt Dr. Weber');
  assert.equal(res.travel.location, 'Augustusplatz 9, Leipzig');
  assert.equal(res.travel.durationMin, 15);
  assert.equal(res.travel.distanceKm, 5.4);
  assert.deepEqual(res.travel.from, { lat: HBF.lat, lon: HBF.lon });
  assert.ok(calls.length >= 2);
  assert.ok(!calls.some((u) => /Geheimweg|Therapie/.test(decodeURIComponent(u))), 'busy-only location never sent');
  assert.ok(!JSON.stringify(res).includes('Geheimweg'));

  // Only busy-only calendars → nothing is looked up at all.
  calls.length = 0;
  const busy = await calendar(defaults({ calendars: [cals[0]], travelCard: true }), cfg);
  assert.equal(busy.travel, undefined);
  assert.equal(calls.length, 0);
});
