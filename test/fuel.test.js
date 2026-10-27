import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parsePrices, parseDetail, selectStations, cheapestOf, provider } from '../src/providers/fuel.js';
import schema from '../public/shared/modules/fuel.js';
import { applyDefaults } from '../public/shared/modules.js';

// Fixtures in the shape of the real Tankerkönig API responses.
const LIST_ALL = {
  ok: true,
  license: 'CC BY 4.0 -  https://creativecommons.tankerkoenig.de',
  data: 'MTS-K',
  status: 'ok',
  stations: [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Aral Tankstelle', brand: 'ARAL', street: 'Holzmarktstraße', houseNumber: '12/14', postCode: 10179, place: 'Berlin', lat: 52.51, lng: 13.42, dist: 1.4, e5: 1.869, e10: 1.809, diesel: 1.739, isOpen: true },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Freie Tankstelle', brand: '', street: 'Hauptstr. ', houseNumber: '5', place: 'Berlin', lat: 52.52, lng: 13.43, dist: 0.6, e5: 1.789, e10: 1.729, diesel: null, isOpen: true },
    { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'JET', brand: 'JET', street: 'Ring', houseNumber: '', place: 'Berlin', lat: 52.53, lng: 13.44, dist: 2.2, e5: 1.749, e10: 1.689, diesel: 1.659, isOpen: false },
    { id: 'aaaaaaaa-0000-0000-0000-000000000004', name: 'Shell', brand: 'Shell', street: 'Allee', houseNumber: '1', place: 'Berlin', lat: 52.5, lng: 13.4, dist: 3.0, e5: 1.899, e10: false, diesel: 1.799, isOpen: true },
  ],
};

const LIST_SINGLE = {
  ok: true,
  status: 'ok',
  stations: [{ id: 'bbbbbbbb-0000-0000-0000-000000000001', name: 'ENI', brand: 'ENI', street: 'X', houseNumber: '1', place: 'Stuttgart', lat: 48.8, lng: 9.2, dist: 4.1, price: 1.009, isOpen: true }],
};

const PRICES = {
  ok: true,
  license: 'CC BY 4.0 -  https://creativecommons.tankerkoenig.de',
  data: 'MTS-K',
  prices: {
    'aaaaaaaa-0000-0000-0000-000000000001': { status: 'open', e5: 1.869, e10: 1.809, diesel: 1.739 },
    'aaaaaaaa-0000-0000-0000-000000000003': { status: 'closed' },
    'aaaaaaaa-0000-0000-0000-000000000009': { status: 'no prices' },
  },
};

const DETAIL = {
  ok: true,
  status: 'ok',
  station: { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Aral Tankstelle', brand: 'ARAL', street: 'Holzmarktstraße ', houseNumber: '12/14', place: 'Berlin', lat: 52.514153, lng: 13.421487, isOpen: true, e5: 1.1 },
};

test('parseList normalises type=all responses', () => {
  const s = parseList(LIST_ALL);
  assert.equal(s.length, 4);
  assert.deepEqual(s[0].prices, { e5: 1.869, e10: 1.809, diesel: 1.739 });
  assert.equal(s[0].street, 'Holzmarktstraße 12/14');
  assert.equal(s[1].street, 'Hauptstr. 5');
  assert.equal(s[1].prices.diesel, null);
  assert.equal(s[2].open, false);
  assert.equal(s[3].prices.e10, null, 'false means "not sold"');
});

test('parseList handles single-type responses', () => {
  const [s] = parseList(LIST_SINGLE, 'diesel');
  assert.deepEqual(s.prices, { e5: null, e10: null, diesel: 1.009 });
});

test('API errors (HTTP 200 with ok:false) throw', () => {
  assert.throws(() => parseList({ status: 'error', ok: false, message: 'apikey nicht angegeben, falsch, oder im falschen Format' }), /Tankerkönig: apikey/);
});

test('parsePrices and parseDetail', () => {
  const p = parsePrices(PRICES);
  assert.equal(p['aaaaaaaa-0000-0000-0000-000000000001'].open, true);
  assert.equal(p['aaaaaaaa-0000-0000-0000-000000000001'].prices.diesel, 1.739);
  assert.equal(p['aaaaaaaa-0000-0000-0000-000000000003'].open, false);
  assert.deepEqual(p['aaaaaaaa-0000-0000-0000-000000000009'].prices, { e5: null, e10: null, diesel: null });
  const d = parseDetail(DETAIL);
  assert.equal(d.brand, 'ARAL');
  assert.equal(d.street, 'Holzmarktstraße 12/14');
});

test('selectStations filters, sorts and caps', () => {
  const all = parseList(LIST_ALL);
  const ids = (l) => l.map((s) => s.id.slice(-1));
  // Diesel by price: station 2 sells no diesel, station 3 is closed.
  assert.deepEqual(ids(selectStations(all, { fuelTypes: ['diesel'], sort: 'price', maxStations: 5, onlyOpen: true })), ['1', '4']);
  assert.deepEqual(ids(selectStations(all, { fuelTypes: ['e10', 'diesel'], sort: 'price', maxStations: 5, onlyOpen: true })), ['2', '1', '4']);
  assert.deepEqual(ids(selectStations(all, { fuelTypes: ['e5'], sort: 'dist', maxStations: 2, onlyOpen: false })), ['2', '1']);
  // Closed stations sort behind open ones when sorting by price.
  assert.deepEqual(ids(selectStations(all, { fuelTypes: ['e5'], sort: 'price', maxStations: 5, onlyOpen: false })), ['2', '1', '4', '3']);
});

test('cheapestOf ignores closed stations and missing prices', () => {
  const all = parseList(LIST_ALL);
  const c = cheapestOf(all, ['e5', 'e10', 'diesel']);
  assert.deepEqual(c.e5, { price: 1.789, id: 'aaaaaaaa-0000-0000-0000-000000000002' });
  assert.deepEqual(c.diesel, { price: 1.739, id: 'aaaaaaaa-0000-0000-0000-000000000001' });
  assert.deepEqual(cheapestOf([], ['e5']), { e5: null });
});

// ---- provider with a stubbed fetch -----------------------------------------
const realFetch = globalThis.fetch;
const calls = [];
before(() => {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const body =
      u.pathname.endsWith('/list.php') ? LIST_ALL
        : u.pathname.endsWith('/prices.php') ? PRICES
          : u.pathname.endsWith('/detail.php') && u.searchParams.get('id') === DETAIL.station.id ? DETAIL
            : { ok: false, status: 'error', message: 'Station nicht vorhanden oder geschlossen' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});
after(() => { globalThis.fetch = realFetch; });

const cfg = { general: { locale: 'de-DE', timezone: 'Europe/Berlin', location: { name: 'Berlin', lat: 52.521, lon: 13.438 } } };

test('provider: missing API key gives an error', async () => {
  const settings = applyDefaults(schema.fields, {});
  await assert.rejects(provider(settings, cfg), /(No Tankerkönig API key set|Kein Tankerkönig-API-Schlüssel)/);
});

test('provider: nearby mode', async () => {
  const settings = applyDefaults(schema.fields, { apiKey: 'test-key-1', radius: 99, fuelTypes: ['e10', 'diesel'], maxStations: 2 });
  assert.equal(settings.radius, 25);
  const d = await provider(settings, cfg);
  const req = calls.find((u) => u.pathname.endsWith('/list.php'));
  assert.equal(req.searchParams.get('type'), 'all');
  assert.equal(req.searchParams.get('rad'), '25');
  assert.equal(req.searchParams.get('apikey'), 'test-key-1');
  assert.deepEqual(d.fuelTypes, ['e10', 'diesel']);
  assert.deepEqual(d.stations.map((s) => s.name), ['Freie Tankstelle', 'Aral Tankstelle']);
  assert.equal(d.cheapest.e10.price, 1.729);
  assert.equal(d.stations[0].lat, undefined, 'coordinates are not sent to the mirror');
  // Second call within the TTL is served from cache.
  const n = calls.length;
  await provider(settings, cfg);
  assert.equal(calls.length, n);
});

test('provider: selected stations mode', async () => {
  const settings = applyDefaults(schema.fields, {
    apiKey: 'test-key-2',
    mode: 'stations',
    sort: 'dist',
    onlyOpen: false,
    stations: [
      { id: 'AAAAAAAA-0000-0000-0000-000000000001' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'JET am Ring' },
      { id: 'not-a-uuid' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'duplicate' },
    ],
  });
  const d = await provider(settings, cfg);
  const req = calls.find((u) => u.pathname.endsWith('/prices.php'));
  assert.equal(req.searchParams.get('ids'), 'aaaaaaaa-0000-0000-0000-000000000001,aaaaaaaa-0000-0000-0000-000000000003');
  assert.equal(d.stations.length, 1, 'closed station without prices is dropped');
  const [aral] = d.stations;
  assert.equal(aral.brand, 'ARAL');
  assert.equal(aral.street, 'Holzmarktstraße 12/14');
  assert.ok(aral.dist > 1 && aral.dist < 2, `distance ${aral.dist}`);
  assert.equal(d.cheapest.diesel.price, 1.739);
});

test('provider: no stations configured', async () => {
  const settings = applyDefaults(schema.fields, { apiKey: 'k', mode: 'stations' });
  const d = await provider(settings, cfg);
  assert.deepEqual(d.stations, []);
});
