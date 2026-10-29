import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  feedUrl, localText, parseDiscovery, classify, parseVehicleTypes, parseStationInfo, parseStationStatus,
  parseVehicles, bearing, nearestStations, countVehicles, stationCounts, dockedKinds, provider,
} from '../src/providers/bikes.js';
import schema from '../public/shared/modules/bikes.js';
import { applyDefaults } from '../public/shared/modules.js';
import { readFileSync } from 'node:fs';
import de from '../public/shared/locales/de/modules/bikes.js';
import core from '../public/shared/locales/de/index.js';
import { BIKE_PRESETS } from '../public/shared/modules/bikes.js';

const LOC = { name: 'Home', lat: 51.34, lon: 12.37 };

// ---- GBFS 2.3 fixtures (shape of nextbike / Dott feeds) ----------------------------

const V2_DISCOVERY = (base) => ({
  last_updated: 1793309652,
  ttl: 60,
  version: '2.3',
  data: {
    de: { feeds: [{ name: 'station_status', url: `${base}/de/station_status.json` }] },
    en: {
      feeds: [
        { name: 'system_information', url: `${base}/v2/system_information.json` },
        { name: 'vehicle_types', url: `${base}/v2/vehicle_types.json` },
        { name: 'station_information', url: `${base}/v2/station_information.json` },
        { name: 'station_status', url: `${base}/v2/station_status.json` },
        { name: 'free_bike_status', url: `${base}/v2/free_bike_status.json` },
      ],
    },
  },
});

const V2_TYPES = {
  ttl: 60,
  version: '2.3',
  data: {
    vehicle_types: [
      { vehicle_type_id: '71', form_factor: 'bicycle', propulsion_type: 'human', name: 'Classic Bike' },
      { vehicle_type_id: '143', form_factor: 'bicycle', propulsion_type: 'electric_assist', name: 'E-Bike' },
      { vehicle_type_id: '200', form_factor: 'cargo_bicycle', propulsion_type: 'human', name: 'Cargo' },
      { vehicle_type_id: 'dott_scooter', form_factor: 'scooter', propulsion_type: 'electric' },
    ],
  },
};

const V2_INFO = {
  ttl: 60,
  version: '2.3',
  data: {
    stations: [
      { station_id: 'far', name: 'Far away', lat: 51.36, lon: 12.37, capacity: 10 },
      { station_id: 'a', name: 'Augustusplatz', lat: 51.3409, lon: 12.37, capacity: 20 },
      { station_id: 'b', name: 'Hauptbahnhof', lat: 51.3402, lon: 12.3712, capacity: 12, is_virtual_station: true },
      { station_id: 'c', name: 'Empty one', lat: 51.3395, lon: 12.3695, capacity: 8 },
      { station_id: 'gone', name: 'Not installed', lat: 51.3401, lon: 12.3701 },
      { station_id: 'bad', name: 'No coords' },
    ],
  },
};

const V2_STATUS = {
  ttl: 60,
  version: '2.3',
  data: {
    stations: [
      { station_id: 'far', num_bikes_available: 5, num_docks_available: 5, is_installed: true, is_renting: true },
      { station_id: 'a', num_bikes_available: 4, vehicle_types_available: [{ vehicle_type_id: '71', count: 3 }, { vehicle_type_id: '143', count: 1 }], num_docks_available: 16, is_installed: true, is_renting: true },
      { station_id: 'b', num_bikes_available: 2, num_docks_available: 10, is_installed: true, is_renting: true },
      { station_id: 'c', num_bikes_available: 0, vehicle_types_available: [], num_docks_available: 8, is_installed: true, is_renting: true },
      { station_id: 'gone', num_bikes_available: 3, is_installed: false, is_renting: true },
    ],
  },
};

const V2_BIKES = {
  ttl: 0,
  version: '2.3',
  data: {
    bikes: [
      { bike_id: '1', lat: 51.3405, lon: 12.3705, vehicle_type_id: 'dott_scooter', is_reserved: false, is_disabled: false },
      { bike_id: '2', lat: 51.3410, lon: 12.3700, vehicle_type_id: 'dott_scooter', is_reserved: false, is_disabled: false },
      { bike_id: '3', lat: 51.3420, lon: 12.3700, vehicle_type_id: 'dott_scooter', is_reserved: true, is_disabled: false },
      { bike_id: '4', lat: 51.3420, lon: 12.3700, vehicle_type_id: 'dott_scooter', is_reserved: false, is_disabled: true },
      { bike_id: '5', lat: 51.3600, lon: 12.3700, vehicle_type_id: 'dott_scooter', is_reserved: false, is_disabled: false },
      { bike_id: '6', lat: 51.3409, lon: 12.37, vehicle_type_id: '71', station_id: 'a', is_reserved: false, is_disabled: false },
      { bike_id: '7', lat: 51.3401, lon: 12.3698, vehicle_type_id: '143', is_reserved: false, is_disabled: false },
    ],
  },
};

// ---- GBFS 3.0 fixtures (shape of MobiData BW feeds) ------------------------------

const V3_DISCOVERY = (base) => ({
  last_updated: '2026-10-29T14:23:37.000+00:00',
  ttl: 86400,
  version: '3.0',
  data: {
    feeds: [
      { name: 'system_information', url: `${base}/v3/system_information` },
      { name: 'vehicle_types', url: `${base}/v3/vehicle_types` },
      { name: 'station_information', url: `${base}/v3/station_information` },
      { name: 'station_status', url: `${base}/v3/station_status` },
      { name: 'vehicle_status', url: `${base}/v3/vehicle_status` },
    ],
  },
});

const V3_SYSINFO = { ttl: 86400, version: '3.0', data: { system_id: 'regiorad', name: [{ text: 'RegioRad Stuttgart', language: 'de' }] } };
const V3_TYPES = {
  ttl: 86400,
  version: '3.0',
  data: {
    vehicle_types: [
      { vehicle_type_id: 'CAB:bike', form_factor: 'bicycle', propulsion_type: 'human', name: [{ text: 'bike', language: 'de' }] },
      { vehicle_type_id: 'CAB:pedelec', form_factor: 'bicycle', propulsion_type: 'electric_assist' },
      { vehicle_type_id: 'VOI:scooter', form_factor: 'scooter_standing', propulsion_type: 'electric' },
      { vehicle_type_id: 'CAR', form_factor: 'car', propulsion_type: 'combustion' },
    ],
  },
};
const V3_INFO = {
  ttl: 86400,
  version: '3.0',
  data: {
    stations: [
      { station_id: 'S1', name: [{ text: 'Rathaus', language: 'de' }, { text: 'Town hall', language: 'en' }], lat: 51.3403, lon: 12.37 },
      { station_id: 'S2', name: [{ text: 'Carsharing', language: 'de' }], lat: 51.3401, lon: 12.37 },
    ],
  },
};
const V3_STATUS = {
  ttl: 240,
  version: '3.0',
  data: {
    stations: [
      { station_id: 'S1', num_vehicles_available: 3, vehicle_types_available: [{ vehicle_type_id: 'CAB:bike', count: 1 }, { vehicle_type_id: 'CAB:pedelec', count: 2 }], num_docks_available: 7, is_installed: true, is_renting: false, is_returning: true, last_reported: '2026-10-29T21:33:02.000+00:00' },
      { station_id: 'S2', num_vehicles_available: 2, vehicle_types_available: [{ vehicle_type_id: 'CAR', count: 2 }], is_installed: true, is_renting: true },
    ],
  },
};
const V3_VEHICLES = {
  ttl: 240,
  version: '3.0',
  data: {
    vehicles: [
      { vehicle_id: 'v1', lat: 51.3402, lon: 12.3702, vehicle_type_id: 'VOI:scooter', is_reserved: false, is_disabled: false },
      { vehicle_id: 'v2', lat: 51.3403, lon: 12.37, vehicle_type_id: 'CAB:bike', station_id: 'S1', is_reserved: false, is_disabled: false },
    ],
  },
};

const KINDS = ['bike', 'ebike', 'cargo', 'scooter'];

// ---- parsing ----------------------------------------------------------------------

test('feedUrl resolves presets and validates custom URLs', () => {
  assert.equal(feedUrl({ preset: 'nextbike_le' }), 'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_le/gbfs.json');
  assert.equal(feedUrl({ preset: 'mbw_voi_de' }), 'https://api.mobidata-bw.de/sharing/gbfs/v3/voi_de/gbfs');
  assert.equal(feedUrl({ preset: 'custom', url: ' https://example.org/gbfs.json ' }), 'https://example.org/gbfs.json');
  assert.equal(feedUrl({ preset: 'custom', url: 'file:///etc/passwd' }), null);
  assert.equal(feedUrl({ preset: 'nope' }), null);
});

test('discovery: v2 picks the requested language, falls back to en; v3 has one list', () => {
  const v2 = parseDiscovery(V2_DISCOVERY('http://x'), 'fr');
  assert.equal(v2.version, '2.3');
  assert.equal(v2.feeds.free_bike_status, 'http://x/v2/free_bike_status.json');
  assert.equal(parseDiscovery(V2_DISCOVERY('http://x'), 'de').feeds.station_status, 'http://x/de/station_status.json');
  const v3 = parseDiscovery(V3_DISCOVERY('http://y'), 'de');
  assert.equal(v3.version, '3.0');
  assert.equal(v3.feeds.vehicle_status, 'http://y/v3/vehicle_status');
  assert.throws(() => parseDiscovery({ foo: 1 }), /Not a GBFS feed/);
});

test('localText handles v3 arrays and v2 strings', () => {
  const n = [{ text: 'Rathaus', language: 'de' }, { text: 'Town hall', language: 'en' }];
  assert.equal(localText(n, 'de'), 'Rathaus');
  assert.equal(localText(n, 'en'), 'Town hall');
  assert.equal(localText(n, 'fr'), 'Town hall');
  assert.equal(localText('  Plain  name ', 'de'), 'Plain name');
});

test('vehicle types are classified into bike / ebike / cargo / scooter / moped', () => {
  assert.deepEqual(parseVehicleTypes(V2_TYPES), { 71: 'bike', 143: 'ebike', 200: 'cargo', dott_scooter: 'scooter' });
  assert.deepEqual(parseVehicleTypes(V3_TYPES), { 'CAB:bike': 'bike', 'CAB:pedelec': 'ebike', 'VOI:scooter': 'scooter', CAR: null });
  assert.equal(classify({ form_factor: 'moped', propulsion_type: 'electric' }), 'moped');
  assert.equal(classify({ form_factor: 'scooter_seated', propulsion_type: 'electric' }), 'scooter');
});

test('station information and status (v2 + v3)', () => {
  const info = parseStationInfo(V2_INFO, 'de');
  assert.equal(info.length, 5); // "No coords" dropped
  assert.equal(info.find((s) => s.id === 'b').virtual, true);
  const status = parseStationStatus(V2_STATUS);
  assert.equal(status.has('gone'), false); // not installed
  assert.deepEqual(status.get('a'), { total: 4, types: [{ id: '71', count: 3 }, { id: '143', count: 1 }], docks: 16, renting: true });
  assert.equal(status.get('b').types, null);

  assert.equal(parseStationInfo(V3_INFO, 'en')[0].name, 'Town hall');
  const s3 = parseStationStatus(V3_STATUS);
  assert.equal(s3.get('S1').total, 3);
  assert.equal(s3.get('S1').renting, false);
});

test('free-floating vehicles exclude docked, reserved and disabled ones (v2 bikes, v3 vehicles)', () => {
  const v2 = parseVehicles(V2_BIKES);
  assert.deepEqual(v2.map((v) => v.type), ['dott_scooter', 'dott_scooter', 'dott_scooter', '143']);
  const v3 = parseVehicles(V3_VEHICLES);
  assert.deepEqual(v3, [{ lat: 51.3402, lon: 12.3702, type: 'VOI:scooter' }]);
});

test('bearing gives compass degrees', () => {
  assert.equal(bearing(51, 12, 52, 12), 0);
  assert.equal(bearing(51, 12, 50, 12), 180);
  assert.equal(bearing(0, 0, 0, 1), 90);
  assert.equal(bearing(0, 0, 0, -1), 270);
});

test('stationCounts splits bikes and e-bikes and respects chosen kinds', () => {
  const types = parseVehicleTypes(V2_TYPES);
  const st = parseStationStatus(V2_STATUS).get('a');
  assert.deepEqual(stationCounts(st, types, KINDS), { counts: { bike: 3, ebike: 1 }, available: 4 });
  assert.deepEqual(stationCounts(st, types, ['ebike']), { counts: { ebike: 1 }, available: 1 });
  // no per-type breakdown → all count as bikes
  assert.deepEqual(stationCounts(parseStationStatus(V2_STATUS).get('b'), types, KINDS), { counts: { bike: 2 }, available: 2 });
});

test('nearestStations sorts by distance, applies radius, limit and hideEmpty', () => {
  const info = parseStationInfo(V2_INFO);
  const status = parseStationStatus(V2_STATUS);
  const types = parseVehicleTypes(V2_TYPES);
  const list = nearestStations(info, status, types, LOC, { radius: 500, max: 5, kinds: KINDS, operator: 'nextbike' });
  assert.deepEqual(list.map((s) => s.name), ['Empty one', 'Hauptbahnhof', 'Augustusplatz']);
  const [empty, hbf, aug] = list;
  assert.ok(empty.dist < hbf.dist && hbf.dist < aug.dist);
  assert.equal(empty.available, 0);
  assert.equal(hbf.docks, null); // virtual station: docks are meaningless
  assert.equal(aug.docks, 16);
  assert.equal(aug.bearing, 0);
  assert.equal(aug.dist, 100);
  assert.deepEqual(aug.counts, { bike: 3, ebike: 1 });
  assert.equal(aug.operator, 'nextbike');

  assert.deepEqual(nearestStations(info, status, types, LOC, { radius: 500, max: 2, kinds: KINDS }).map((s) => s.name), ['Empty one', 'Hauptbahnhof']);
  assert.deepEqual(nearestStations(info, status, types, LOC, { radius: 500, max: 5, kinds: KINDS, hideEmpty: true }).map((s) => s.name), ['Hauptbahnhof', 'Augustusplatz']);
  assert.equal(nearestStations(info, status, types, LOC, { radius: 5000, max: 10, kinds: KINDS }).length, 4);
});

test('nearestStations skips stations that only hold other vehicle kinds (v3 cars)', () => {
  const list = nearestStations(parseStationInfo(V3_INFO, 'de'), parseStationStatus(V3_STATUS), parseVehicleTypes(V3_TYPES), LOC, { radius: 500, max: 5, kinds: KINDS });
  assert.deepEqual(list.map((s) => s.name), ['Rathaus']);
  assert.equal(list[0].renting, false);
  assert.equal(list[0].available, 0);
});

test('countVehicles counts free-floating vehicles per kind within the radius', () => {
  const types = parseVehicleTypes(V2_TYPES);
  const r = countVehicles(parseVehicles(V2_BIKES), types, LOC, { radius: 300, kinds: KINDS });
  assert.deepEqual(r.counts, { scooter: 2, ebike: 1 });
  assert.equal(r.total, 3);
  assert.equal(r.nearest.dist, 18);
  assert.deepEqual(countVehicles(parseVehicles(V2_BIKES), types, LOC, { radius: 300, kinds: ['bike'] }).total, 0);
});

test('every schema and renderer string has a German translation', () => {
  const ids = new Set([schema.label, schema.description, schema.defaultTitle]);
  const presets = new Set(BIKE_PRESETS.map((p) => p.value));
  const walk = (fields) => {
    for (const f of fields) {
      for (const k of ['label', 'help', 'itemLabel']) if (f[k]) ids.add(f[k]);
      for (const o of f.options || []) if (!presets.has(o.value)) ids.add(o.label);
      if (f.fields) walk(f.fields);
    }
  };
  walk(schema.fields);
  for (const file of ['../public/mirror/modules/bikes.js', '../src/providers/bikes.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\b(?:t|fail)\('([^']+)'/g)) ids.add(m[1]);
  }
  const missing = [...ids].filter((id) => !(id in de) && !(id in core));
  assert.deepEqual(missing, []);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});

test('schema defaults are valid', () => {
  const s = applyDefaults(schema.fields, {});
  assert.deepEqual(s.feeds, []);
  assert.equal(s.radius, 500);
  assert.equal(s.layout, 'list');
  const withFeed = applyDefaults(schema.fields, { feeds: [{}] });
  assert.equal(withFeed.feeds[0].preset, 'nextbike_le');
});

// ---- provider against a local HTTP server --------------------------------------

let server;
let base;
const hits = {};
before(async () => {
  server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    const routes = {
      '/v2/gbfs.json': V2_DISCOVERY(base),
      '/v2/system_information.json': { ttl: 60, data: { name: 'nextbike Leipzig' } },
      '/v2/vehicle_types.json': V2_TYPES,
      '/v2/station_information.json': V2_INFO,
      '/v2/station_status.json': V2_STATUS,
      '/v2/free_bike_status.json': V2_BIKES,
      '/v3/gbfs': V3_DISCOVERY(base),
      '/v3/system_information': V3_SYSINFO,
      '/v3/vehicle_types': V3_TYPES,
      '/v3/station_information': V3_INFO,
      '/v3/station_status': V3_STATUS,
      '/v3/vehicle_status': V3_VEHICLES,
    };
    const body = routes[req.url];
    if (!body) {
      res.writeHead(404).end('nope');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const cfg = { general: { locale: 'en-GB', location: LOC } };

test('provider merges v2 and v3 systems and reports broken feeds', async () => {
  const settings = applyDefaults(schema.fields, {
    feeds: [
      { preset: 'custom', url: `${base}/v2/gbfs.json`, name: 'nextbike' },
      { preset: 'custom', url: `${base}/v3/gbfs` },
      { preset: 'custom', url: `${base}/missing/gbfs.json`, name: 'Broken' },
    ],
    radius: 300,
    maxStations: 3,
  });
  const d = await provider(settings, cfg);
  assert.deepEqual(d.stations.map((s) => s.name), ['Town hall', 'Empty one', 'Hauptbahnhof']);
  assert.equal(d.multiOperator, true);
  assert.equal(d.stations[0].operator, 'RegioRad Stuttgart');
  assert.deepEqual(d.vehicles.map((v) => [v.operator, v.total]), [['nextbike', 3], ['RegioRad Stuttgart', 1]]);
  assert.equal(d.errors.length, 1);
  assert.match(d.errors[0], /^Broken: Feed could not be loaded \(HTTP 404/);
  assert.equal(d.refresh, 60);

  // Second call is served from the cache (station_information is not refetched).
  const before = hits['/v2/station_information.json'];
  await provider(settings, cfg);
  assert.equal(hits['/v2/station_information.json'], before);
});

test('provider: no feeds → needsSetup; all feeds broken → error', async () => {
  const d = await provider(applyDefaults(schema.fields, {}), cfg);
  assert.equal(d.needsSetup, true);
  const broken = applyDefaults(schema.fields, { feeds: [{ preset: 'custom', url: `${base}/nothing/gbfs.json`, name: 'X' }] });
  await assert.rejects(provider(broken, cfg), /X: Feed could not be loaded/);
});

test('scooter parking zones of free-floating systems are not listed as stations', () => {
  const typesJson = { data: { vehicle_types: [{ vehicle_type_id: 'BLT', form_factor: 'scooter_standing', propulsion_type: 'electric', return_constraint: 'free_floating' }] } };
  const info = parseStationInfo({ data: { stations: [{ station_id: 'P', name: [{ text: 'Parking', language: 'en' }], lat: 51.3401, lon: 12.37, is_virtual_station: true }] } });
  const status = parseStationStatus({ data: { stations: [{ station_id: 'P', num_vehicles_available: 0, vehicle_types_available: [], is_installed: true, is_renting: true }] } });
  const opts = { radius: 500, max: 5, kinds: KINDS, docked: dockedKinds(typesJson) };
  assert.deepEqual(opts.docked, []);
  assert.equal(nearestStations(info, status, parseVehicleTypes(typesJson), LOC, opts).length, 0);
  // Without vehicle_types an untyped station counts as a bike station.
  assert.equal(nearestStations(info, status, null, LOC, { ...opts, docked: null }).length, 1);
  assert.deepEqual(dockedKinds(V2_TYPES), ['bike', 'ebike', 'cargo', 'scooter']);
});

test('empty scooter-only stations are skipped, filled ones are shown', () => {
  const types = { S: 'scooter' };
  const info = parseStationInfo({ data: { stations: [
    { station_id: 'E', name: 'Empty hub', lat: 51.3401, lon: 12.37 },
    { station_id: 'F', name: 'Full hub', lat: 51.3402, lon: 12.37 },
  ] } });
  const status = parseStationStatus({ data: { stations: [
    { station_id: 'E', num_bikes_available: 0, vehicle_types_available: [{ vehicle_type_id: 'S', count: 0 }] },
    { station_id: 'F', num_bikes_available: 2, vehicle_types_available: [{ vehicle_type_id: 'S', count: 2 }] },
  ] } });
  const list = nearestStations(info, status, types, LOC, { radius: 500, max: 5, kinds: KINDS, docked: ['scooter'] });
  assert.deepEqual(list.map((s) => [s.name, s.counts]), [['Full hub', { scooter: 2 }]]);
});
