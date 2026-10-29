import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { parseDhl, parse17, toIso, nextDelay, routeOf, visibleParcels, provider, _resetState, NOT_FOUND } from '../src/providers/parcels.js';
import schema from '../public/shared/modules/parcels.js';
import de from '../public/shared/locales/de/modules/parcels.js';
import { applyDefaults } from '../public/shared/modules.js';
import { translator } from '../public/shared/i18n.js';

// The German dictionary only takes effect once registered in locales/de/index.js.
const tDe = translator('de');

// Fixtures in the shape of the real API responses (developer.dhl.com, api.17track.net v2.2).
const DHL = JSON.parse(readFileSync(new URL('./fixtures/parcels-dhl.json', import.meta.url)));
const T17 = JSON.parse(readFileSync(new URL('./fixtures/parcels-17track.json', import.meta.url)));
const TZ = 'Europe/Berlin';
const HOUR = 3600 * 1000;

test('toIso: local DHL Paket times are Berlin time, offsets are kept', () => {
  assert.equal(toIso('2026-10-28T21:14:00', TZ), '2026-10-28T20:14:00.000Z'); // CET (after DST end)
  assert.equal(toIso('2026-07-01T10:00:00', TZ), '2026-07-01T08:00:00.000Z'); // CEST
  assert.equal(toIso('2026-10-28T16:12:00+02:00'), '2026-10-28T14:12:00.000Z');
  assert.equal(toIso('2026-10-28T17:45:00Z'), '2026-10-28T17:45:00.000Z');
  assert.equal(toIso(''), null);
  assert.equal(toIso('soon'), null);
});

test('parseDhl: in transit with delivery window', () => {
  const r = parseDhl(DHL.transit, TZ);
  assert.equal(r.status, 'transit');
  assert.equal(r.carrier, 'DHL');
  assert.equal(r.text, 'Die Sendung wurde im Start-Paketzentrum bearbeitet.');
  assert.equal(r.location, 'Radefeld');
  assert.equal(r.time, '2026-10-28T20:14:00.000Z');
  assert.deepEqual(r.eta, { from: '2026-10-30T08:00:00.000Z', to: '2026-10-30T09:30:00.000Z' });
  assert.equal(r.deliveredAt, null);
});

test('parseDhl: "Zustellfahrzeug" means out for delivery', () => {
  const r = parseDhl(DHL.outForDelivery, TZ);
  assert.equal(r.status, 'out');
  assert.equal(r.eta.from, '2026-10-29T10:00:00.000Z');
});

test('parseDhl: a late pre-transit event does not hide the delivery', () => {
  const r = parseDhl(DHL.latePreTransit, TZ);
  assert.equal(r.status, 'delivered');
  assert.equal(r.deliveredAt, '2026-10-28T18:30:00.000Z');
  assert.equal(r.eta, null);
});

test('parseDhl: Express failure → exception', () => {
  const r = parseDhl(DHL.expressFailure, TZ);
  assert.equal(r.status, 'exception');
  assert.equal(r.carrier, 'DHL Express');
  assert.equal(r.text, 'Delivery attempted; recipient not home');
  assert.equal(r.eta.from, '2026-10-28T16:00:00.000Z');
});

test('parseDhl: other status texts', () => {
  const one = (statusCode, description) => parseDhl({ shipments: [{ status: { statusCode, description } }] }).status;
  assert.equal(one('transit', 'The shipment is out for delivery'), 'out');
  assert.equal(one('transit', 'Die Sendung liegt in der Packstation 123 zur Abholung bereit.'), 'pickup');
  assert.equal(one('pre-transit', 'Electronic data received'), 'pre');
  assert.equal(one('unknown', ''), 'unknown');
  assert.equal(parseDhl({}).status, 'unknown');
});

test('parse17: statuses, carrier name and ETA', () => {
  const [hermes, pickup] = T17.accepted.data.accepted.map(parse17);
  assert.equal(hermes.status, 'transit');
  assert.equal(hermes.carrier, 'Hermes (DE)');
  assert.equal(hermes.location, 'Graben');
  assert.equal(hermes.time, '2026-10-28T17:45:00.000Z');
  assert.deepEqual(hermes.eta, { from: '2026-10-29T23:00:00.000Z', to: '2026-10-30T23:00:00.000Z' });
  assert.equal(pickup.status, 'pickup');
  assert.equal(pickup.eta, null);
  const st = (status) => parse17({ track_info: { latest_status: { status } } }).status;
  assert.equal(st('OutForDelivery'), 'out');
  assert.equal(st('Delivered'), 'delivered');
  assert.equal(st('DeliveryFailure'), 'exception');
  assert.equal(st('Exception'), 'exception');
  assert.equal(st('InfoReceived'), 'pre');
  assert.equal(st('NotFound'), 'unknown');
  assert.equal(st('Expired'), 'unknown');
});

test('nextDelay keeps DHL within its daily budget', () => {
  assert.equal(nextDelay({ status: 'transit' }, 'dhl', 1), 0.5 * HOUR);
  assert.equal(nextDelay({ status: 'delivered' }, 'dhl', 1), 6 * HOUR);
  assert.equal(nextDelay({ status: 'pre' }, 'dhl', 1), 2 * HOUR);
  assert.equal(nextDelay({ status: NOT_FOUND }, 'dhl', 1), 3 * HOUR);
  assert.equal(nextDelay({ status: 'transit' }, '17track', 10), HOUR);
  // Worst case: every DHL parcel in transit → at most 200 calls a day.
  for (const n of [1, 3, 5, 8, 15]) {
    const perDay = (n * 24 * HOUR) / nextDelay({ status: 'out' }, 'dhl', n);
    assert.ok(perDay <= 200, `${n} parcels → ${perDay} calls/day`);
  }
});

test('routeOf picks a source by carrier and keys', () => {
  const both = { dhl: 'k', t17: 'k' };
  assert.equal(routeOf('auto', both), 'dhl');
  assert.equal(routeOf('auto', both, '17track'), '17track');
  assert.equal(routeOf('auto', { dhl: '', t17: 'k' }), '17track');
  assert.equal(routeOf('other', { dhl: 'k', t17: '' }), null);
  assert.equal(routeOf('dhl', { dhl: '', t17: 'k' }), null);
});

test('visibleParcels: hides old deliveries, sorts out-for-delivery first', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const list = [
    { name: 'a', status: 'transit' },
    { name: 'b', status: 'delivered', deliveredAt: '2026-10-28T12:00:00Z' },
    { name: 'c', status: 'delivered', deliveredAt: '2026-10-20T12:00:00Z' },
    { name: 'd', status: 'out' },
    { name: 'e', status: 'pre' },
  ];
  assert.deepEqual(visibleParcels(list, 2, now).map((p) => p.name), ['d', 'a', 'e', 'b']);
  assert.deepEqual(visibleParcels(list, 0, now).map((p) => p.name), ['d', 'a', 'e']);
});

// ---- provider against a local fake API -------------------------------------------------

let server;
let base;
const calls = [];
let registered = false;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
      const send = (status, json) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
      if (url.pathname === '/dhl') {
        if (req.headers['dhl-api-key'] !== 'dhl-key') return send(401, { status: 401, title: 'Unauthorized' });
        const n = url.searchParams.get('trackingNumber');
        if (n === '00340434161094042557') return send(200, DHL.transit);
        return send(404, DHL.notFound);
      }
      if (req.headers['17token'] !== '17-key') return send(401, {});
      if (url.pathname === '/17/gettrackinfo') return send(200, registered ? { code: 0, data: { accepted: [T17.accepted.data.accepted[0]], rejected: [] } } : T17.notRegistered);
      if (url.pathname === '/17/register') {
        registered = true;
        return send(200, T17.registered);
      }
      send(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  _resetState();
  calls.length = 0;
  registered = false;
});

const cfg = { general: { locale: 'de-DE', timezone: TZ } };
const apis = () => ({ dhl: `${base}/dhl`, t17: `${base}/17`, throttle: (fn) => fn() });
const settings = (over) => applyDefaults(schema.fields, { dhlApiKey: 'dhl-key', trackApiKey: '17-key', ...over }, (s) => s);

test('provider: DHL parcel, then cached', async () => {
  const s = settings({ parcels: [{ name: 'Schuhe', number: '0034 0434 1610 9404 2557', carrier: 'auto', postalCode: '04109' }] });
  const d = await provider(s, cfg, { id: 'm1' }, apis());
  assert.equal(d.parcels.length, 1);
  const p = d.parcels[0];
  assert.equal(p.name, 'Schuhe');
  assert.equal(p.status, 'transit');
  assert.equal(p.error, null);
  assert.equal(JSON.stringify(d).includes('00340434161094042557'), false, 'tracking number never reaches the mirror');
  assert.equal(calls[0].query.trackingNumber, '00340434161094042557');
  assert.equal(calls[0].query.recipientPostalCode, '04109');
  assert.equal(calls[0].query.language, 'de');
  await provider(s, cfg, { id: 'm1' }, apis());
  assert.equal(calls.length, 1, 'second call served from cache');
});

test('provider: unknown at DHL → registered at 17TRACK, then tracked there', async () => {
  const s = settings({ parcels: [{ name: '', number: '09445440123456', carrier: 'auto' }] });
  const d = await provider(s, cfg, { id: 'm1' }, apis());
  assert.deepEqual(calls.map((c) => c.path), ['/dhl', '/17/gettrackinfo', '/17/register']);
  assert.deepEqual(JSON.parse(calls[2].body), [{ number: '09445440123456', auto_detection: true }]);
  assert.equal(d.parcels[0].name, '…3456');
  assert.equal(d.parcels[0].status, 'unknown');
  assert.equal(d.parcels[0].text, tDe('Registered at 17TRACK – waiting for the first update'));
});

test('provider: 17TRACK only, per-parcel errors are translated', async () => {
  registered = true;
  const s = settings({
    dhlApiKey: '',
    parcels: [
      { name: 'Hermes', number: '09445440123456', carrier: 'other' },
      { name: 'Nur DHL', number: '123', carrier: 'dhl' },
    ],
  });
  const d = await provider(s, cfg, { id: 'm1' }, apis());
  const hermes = d.parcels.find((p) => p.name === 'Hermes');
  assert.equal(hermes.status, 'transit');
  assert.equal(hermes.carrier, 'Hermes (DE)');
  assert.equal(d.parcels.find((p) => p.name === 'Nur DHL').error, tDe('No DHL API key set'));
});

test('provider: wrong key → error per parcel, no keys → module error', async () => {
  const s = settings({ dhlApiKey: 'nope', trackApiKey: '', parcels: [{ name: 'X', number: '00340434161094042557' }] });
  const d = await provider(s, cfg, { id: 'm1' }, apis());
  assert.equal(d.parcels[0].error, tDe('DHL rejected the API key'));
  await assert.rejects(provider(settings({ dhlApiKey: '', trackApiKey: '', parcels: [{ number: '1' }] }), cfg, { id: 'm1' }, apis()), { message: tDe('No DHL or 17TRACK API key set') });
  assert.deepEqual(await provider(settings({}), cfg, { id: 'm1' }, apis()), { parcels: [], total: 0, hidden: 0 });
});

test('suggested condition: only while a parcel is on its way', () => {
  const cond = (d) => (d.parcels || []).some((p) => p.status !== 'delivered');
  assert.equal(cond({ parcels: [{ status: 'delivered' }] }), false);
  assert.equal(cond({ parcels: [] }), false);
  assert.equal(cond({ parcels: [{ status: 'delivered' }, { status: 'out' }] }), true);
});

test('German dictionary: sorted and covers the schema', () => {
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  const strings = [schema.label, schema.description, schema.defaultTitle];
  const walk = (fields) => {
    for (const f of fields) {
      strings.push(f.label);
      if (f.help) strings.push(f.help);
      if (f.itemLabel) strings.push(f.itemLabel);
      if (f.placeholder && !/\d/.test(f.placeholder)) strings.push(f.placeholder);
      for (const o of f.options || []) strings.push(o.label);
      if (f.fields) walk(f.fields);
    }
  };
  walk(schema.fields);
  for (const s of strings) assert.ok(s in de, `missing German string: ${s}`);
});
