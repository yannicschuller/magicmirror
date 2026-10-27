import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { provider, describe, normalizeUrl, autoIcon } from '../src/providers/homeassistant.js';
import schema from '../public/shared/modules/homeassistant.js';
import de from '../public/shared/locales/de/modules/homeassistant.js';
import { applyDefaults } from '../public/shared/modules.js';

const TOKEN = 'test-token-123';
const cfg = { general: { locale: 'en-GB', timezone: 'Europe/Berlin' } };

const STATES = [
  { entity_id: 'sensor.living_temp', state: '21.53', attributes: { friendly_name: 'Living room', unit_of_measurement: '°C', device_class: 'temperature' }, last_changed: '2026-10-27T08:00:00+00:00' },
  { entity_id: 'sensor.humidity', state: '48', attributes: { friendly_name: 'Humidity', unit_of_measurement: '%', device_class: 'humidity' } },
  { entity_id: 'sensor.power', state: '0', attributes: { friendly_name: 'Washer power', unit_of_measurement: 'W', device_class: 'power' } },
  { entity_id: 'binary_sensor.kitchen_window', state: 'on', attributes: { friendly_name: 'Kitchen window', device_class: 'window' } },
  { entity_id: 'binary_sensor.bath_window', state: 'off', attributes: { friendly_name: 'Bathroom window', device_class: 'window' } },
  { entity_id: 'binary_sensor.front_door', state: 'off', attributes: { friendly_name: 'Front door', device_class: 'door' } },
  { entity_id: 'binary_sensor.hall_motion', state: 'on', attributes: { friendly_name: 'Hall motion', device_class: 'motion' } },
  { entity_id: 'lock.front', state: 'locked', attributes: { friendly_name: 'Front lock' } },
  { entity_id: 'light.desk', state: 'on', attributes: { friendly_name: 'Desk lamp' } },
  { entity_id: 'sensor.pv', state: 'unavailable', attributes: { friendly_name: 'PV', unit_of_measurement: 'W', device_class: 'power' } },
  { entity_id: 'weather.home', state: 'cloudy', attributes: { friendly_name: 'Forecast' } },
];

let server;
let base;
let hits = 0;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url !== '/api/states') { res.statusCode = 404; return res.end('{}'); }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.statusCode = 401; return res.end('{"message":"Invalid token"}'); }
    hits++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(STATES));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const settings = (entities, extra = {}) => applyDefaults(schema.fields, { url: base, token: TOKEN, entities, ...extra });

test('normalizeUrl validates and trims', () => {
  assert.equal(normalizeUrl('http://homeassistant.local:8123/'), 'http://homeassistant.local:8123');
  assert.equal(normalizeUrl(' https://ha.example.com/api/ '), 'https://ha.example.com');
  assert.throws(() => normalizeUrl('ftp://x'), /http\(s\)/);
  assert.throws(() => normalizeUrl('file:///etc/passwd'), /http\(s\)/);
  assert.throws(() => normalizeUrl('not a url'), /Invalid/);
  assert.throws(() => normalizeUrl(''), /No Home Assistant URL/);
});

test('provider fetches /api/states with bearer token, filters and caches', async () => {
  const s = settings([
    { entity: 'sensor.living_temp' },
    { entity: 'binary_sensor.kitchen_window', label: 'Küche', showWhen: 'on' },
    { entity: 'binary_sensor.bath_window', showWhen: 'on' },
    { entity: 'binary_sensor.front_door', showWhen: 'off', icon: 'lock' },
    { entity: 'sensor.power', showWhen: 'on' },
    { entity: 'sensor.humidity', decimals: '1' },
    { entity: 'sensor.pv', showWhen: 'always' },
    { entity: 'sensor.does_not_exist' },
    { entity: '' },
  ]);
  const data = await provider(s, cfg);
  assert.equal(hits, 1);
  assert.equal(data.configured, 8);
  const ids = data.entities.map((e) => e.id);
  assert.deepEqual(ids, ['sensor.living_temp', 'binary_sensor.kitchen_window', 'binary_sensor.front_door', 'sensor.humidity', 'sensor.pv', 'sensor.does_not_exist']);
  const [temp, kitchen, door, hum, pv, missing] = data.entities;
  assert.equal(temp.label, 'Living room');
  assert.equal(temp.value, 21.53);
  assert.equal(temp.decimals, 1);
  assert.equal(temp.unit, '°C');
  assert.equal(temp.icon, 'thermometer');
  assert.equal(kitchen.label, 'Küche');
  assert.equal(kitchen.state, 'Open');
  assert.equal(kitchen.active, true);
  assert.equal(kitchen.icon, 'window');
  assert.equal(door.state, 'Closed');
  assert.equal(door.icon, 'lock');
  assert.equal(hum.decimals, 1);
  assert.equal(pv.available, false);
  assert.equal(pv.state, 'Unavailable');
  assert.equal(missing.missing, true);
  // second call within 15 s is served from cache
  await provider(s, cfg);
  assert.equal(hits, 1);
});

test('wrong token gives a clear error', async () => {
  await assert.rejects(provider(settings([{ entity: 'sensor.power' }], { token: 'wrong' }), cfg), /rejected the access token/);
});

test('missing settings', async () => {
  await assert.rejects(provider(settings([{ entity: 'sensor.power' }], { url: '' }), cfg), /No Home Assistant URL/);
  await assert.rejects(provider(settings([{ entity: 'sensor.power' }], { token: '' }), cfg), /No access token/);
  assert.deepEqual(await provider(settings([]), cfg), { entities: [], configured: 0 });
});

test('unreachable host', async () => {
  await assert.rejects(provider(settings([{ entity: 'x.y' }], { url: 'http://127.0.0.1:1' }), cfg), /not reachable/);
});

test('describe translates states (German)', () => {
  const t = (id) => de[id] ?? id;
  const st = (id) => STATES.find((s) => s.entity_id === id);
  const d = (entity) => describe({ entity, icon: 'auto', decimals: 'auto' }, st(entity), t);
  assert.equal(d('binary_sensor.kitchen_window').state, 'Offen');
  assert.equal(d('binary_sensor.front_door').state, 'Geschlossen');
  assert.equal(d('binary_sensor.hall_motion').state, 'Erkannt');
  assert.equal(d('lock.front').state, 'Verriegelt');
  assert.equal(d('lock.front').icon, 'lock');
  assert.equal(d('lock.front').inactive, true);
  assert.equal(d('light.desk').state, 'An');
  assert.equal(d('light.desk').icon, 'light');
  assert.equal(d('sensor.pv').state, 'Nicht verfügbar');
  assert.equal(d('weather.home').state, 'cloudy');
  assert.equal(describe({ entity: 'a.b', icon: 'auto' }, undefined, t).state, 'Nicht gefunden');
  assert.equal(autoIcon('sensor', 'battery'), 'battery');
});

test('German dictionary covers every schema string and is sorted', () => {
  const ids = new Set([schema.label, schema.description, schema.defaultTitle]);
  const walk = (fields) => fields.forEach((f) => {
    ids.add(f.label);
    if (f.itemLabel) ids.add(f.itemLabel);
    (f.options || []).forEach((o) => /[a-z]/i.test(o.label) && ids.add(o.label));
    if (f.fields) walk(f.fields);
  });
  walk(schema.fields);
  for (const id of ids) assert.ok(id in de, `missing German translation for "${id}"`);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b, 'en')));
});
