import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {
  provider, describe, normalizeUrl, autoIcon, checkCondition, conditionHolds, isWarn, entityIdsOf,
  startHaLive, stopHaLive, haLiveStatus,
} from '../src/providers/homeassistant.js';
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

// ---- conditions & thresholds ------------------------------------------------------

test('checkCondition operators', () => {
  const st = (state) => ({ state });
  assert.equal(checkCondition(st('finished'), 'equals', 'finished'), true);
  assert.equal(checkCondition(st('Finished'), 'equals', ' finished '), true);
  assert.equal(checkCondition(st('running'), 'equals', 'finished'), false);
  assert.equal(checkCondition(st('50.0'), 'equals', '50'), true);
  assert.equal(checkCondition(st('running'), 'not_equals', 'finished'), true);
  assert.equal(checkCondition(st('finished'), 'not_equals', 'finished'), false);
  assert.equal(checkCondition(st('120'), 'above', '50'), true);
  assert.equal(checkCondition(st('12,5'), 'above', '50'), false);
  assert.equal(checkCondition(st('30'), 'above', '50,5'), false);
  assert.equal(checkCondition(st('unavailable'), 'above', '50'), false);
  assert.equal(checkCondition(st('120'), 'above', ''), false);
  assert.equal(checkCondition(st('17.5'), 'below', '18'), true);
  assert.equal(checkCondition(st('unknown'), 'below', '18'), false);
  assert.equal(checkCondition(st('on'), 'on'), true);
  assert.equal(checkCondition(st('open'), 'on'), true);
  assert.equal(checkCondition(st('off'), 'on'), false);
  assert.equal(checkCondition(st('off'), 'off'), true);
  assert.equal(checkCondition(st('locked'), 'off'), true);
  assert.equal(checkCondition(st('0'), 'off'), true);
  assert.equal(checkCondition(st('3'), 'on'), true);
  assert.equal(checkCondition(undefined, 'not_equals', 'x'), false, 'missing entity never matches');
  const lookup = (id) => (id === 'sensor.a' ? { state: '5' } : undefined);
  assert.equal(conditionHolds(lookup, '', 'equals', 'x'), true, 'no condition entity = always');
  assert.equal(conditionHolds(lookup, ' sensor.a ', 'above', '4'), true);
  assert.equal(conditionHolds(lookup, 'sensor.b', 'off'), false);
});

test('isWarn thresholds (empty = off)', () => {
  assert.equal(isWarn(1200, '1000', ''), true);
  assert.equal(isWarn(900, '1000', ''), false);
  assert.equal(isWarn(17.5, '', '18'), true);
  assert.equal(isWarn(17.5, '', '17,5'), false);
  assert.equal(isWarn(20, '', ''), false);
  assert.equal(isWarn(20, undefined, undefined), false);
  assert.equal(isWarn(undefined, '1', '2'), false);
  assert.equal(isWarn(5, 'abc', '2'), false);
});

test('entityIdsOf collects shown and condition entities', () => {
  assert.deepEqual(entityIdsOf({ entities: [{ entity: 'a.b', conditionEntity: 'c.d' }, { entity: ' e.f ' }, { entity: '', conditionEntity: 'x.y' }], moduleConditionEntity: 'g.h' }), ['a.b', 'c.d', 'e.f', 'g.h']);
  assert.deepEqual(entityIdsOf({ entities: [], moduleConditionEntity: 'g.h' }), []);
});

test('provider applies entity / module conditions and thresholds', async () => {
  const s = settings([
    { entity: 'sensor.living_temp', warnBelow: '22' },
    { entity: 'sensor.humidity', warnAbove: '60', warnBelow: '30' },
    { entity: 'sensor.power', conditionEntity: 'sensor.power', conditionOperator: 'above', conditionValue: '50' },
    { entity: 'weather.home', conditionEntity: 'binary_sensor.kitchen_window', conditionOperator: 'on' },
    { entity: 'light.desk', showWhen: 'on', conditionEntity: 'lock.front', conditionOperator: 'equals', conditionValue: 'unlocked' },
  ]);
  const data = await provider(s, cfg);
  assert.deepEqual(data.entities.map((e) => e.id), ['sensor.living_temp', 'sensor.humidity', 'weather.home']);
  assert.equal(data.entities[0].warn, true);
  assert.equal(data.entities[1].warn, undefined);
  // module condition false → nothing shown (renderer hides the module)
  const hidden = await provider({ ...s, moduleConditionEntity: 'binary_sensor.front_door', moduleConditionOperator: 'on' }, cfg);
  assert.deepEqual(hidden, { entities: [], configured: 5, hidden: true, live: false });
  const shown = await provider({ ...s, moduleConditionEntity: 'binary_sensor.front_door', moduleConditionOperator: 'off' }, cfg);
  assert.equal(shown.entities.length, 3);
});

test('old configs get the new defaults and behave as before', () => {
  const s = applyDefaults(schema.fields, { url: 'http://x', token: 't', entities: [{ entity: 'a.b', showWhen: 'on' }] });
  assert.equal(s.live, true);
  assert.equal(s.moduleConditionEntity, '');
  assert.deepEqual([s.entities[0].conditionEntity, s.entities[0].conditionOperator, s.entities[0].warnAbove, s.entities[0].warnBelow], ['', 'equals', '', '']);
  const url = schema.fields.find((f) => f.key === 'url');
  const token = schema.fields.find((f) => f.key === 'token');
  assert.ok(url.secret && token.secret, 'url and token stay server-side');
});

// ---- live updates via a fake Home Assistant websocket server -------------------------

function readFrame(buf) {
  if (buf.length < 2) return null;
  const op = buf[0] & 0x0f;
  const masked = buf[1] & 0x80;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  let mask = null;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.subarray(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { op, payload, size: off + len };
}

function writeFrame(socket, op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  if (!socket.destroyed) socket.write(Buffer.concat([head, payload]));
}

const compress = (s) => ({ s: s.state, a: s.attributes || {}, c: 'ctx', lu: Date.now() / 1000 });

function fakeHa({ token, states, subscribeEntities = true }) {
  const map = new Map(states.map((s) => [s.entity_id, structuredClone(s)]));
  const clients = new Set();
  const stats = { rest: 0, connections: 0, auths: 0, subscribes: [] };
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/states') { res.statusCode = 404; return res.end('{}'); }
    if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; return res.end('{}'); }
    stats.rest++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify([...map.values()]));
  });
  const send = (c, msg) => writeFrame(c.socket, 1, Buffer.from(JSON.stringify(msg)));
  function handle(c, m) {
    if (m.type === 'auth') {
      stats.auths++;
      if (m.access_token === token) { c.authed = true; send(c, { type: 'auth_ok', ha_version: '2026.10.0' }); }
      else { send(c, { type: 'auth_invalid', message: 'Invalid access token' }); writeFrame(c.socket, 8, Buffer.alloc(0)); c.socket.end(); }
      return;
    }
    if (!c.authed) return;
    switch (m.type) {
      case 'subscribe_entities':
        if (!subscribeEntities) return send(c, { id: m.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } });
        stats.subscribes.push(m.entity_ids);
        c.subs.push({ id: m.id, kind: 'entities', ids: m.entity_ids ? new Set(m.entity_ids) : null });
        send(c, { id: m.id, type: 'result', success: true, result: null });
        send(c, { id: m.id, type: 'event', event: { a: Object.fromEntries([...map.values()].filter((s) => !m.entity_ids || m.entity_ids.includes(s.entity_id)).map((s) => [s.entity_id, compress(s)])) } });
        return;
      case 'get_states': return send(c, { id: m.id, type: 'result', success: true, result: [...map.values()] });
      case 'subscribe_events':
        c.subs.push({ id: m.id, kind: 'events' });
        return send(c, { id: m.id, type: 'result', success: true, result: null });
      case 'ping': return send(c, { id: m.id, type: 'pong' });
      default: return send(c, { id: m.id, type: 'result', success: false, error: { code: 'unknown_command' } });
    }
  }
  server.on('upgrade', (req, socket) => {
    if (req.url !== '/api/websocket') return socket.destroy();
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    stats.connections++;
    const c = { socket, authed: false, subs: [] };
    clients.add(c);
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      let f;
      while ((f = readFrame(buf))) {
        buf = buf.subarray(f.size);
        if (f.op === 8) { writeFrame(socket, 8, Buffer.alloc(0)); socket.end(); }
        else if (f.op === 9) writeFrame(socket, 10, f.payload);
        else if (f.op === 1) { try { handle(c, JSON.parse(f.payload.toString())); } catch { /* ignore */ } }
      }
    });
    socket.on('close', () => clients.delete(c));
    socket.on('error', () => {});
    send(c, { type: 'auth_required', ha_version: '2026.10.0' });
  });
  return {
    server,
    stats,
    clients,
    listen: (port = 0, host = '127.0.0.1') => new Promise((r) => server.listen(port, host, () => r(`http://${host}:${server.address().port}`))),
    setState(id, state, attributes) {
      const old = map.get(id) || { entity_id: id, attributes: {} };
      const next = { ...old, state: String(state), attributes: attributes || old.attributes, last_changed: new Date().toISOString() };
      map.set(id, next);
      for (const c of clients) for (const s of c.subs) {
        if (s.kind === 'entities' && (!s.ids || s.ids.has(id))) send(c, { id: s.id, type: 'event', event: { c: { [id]: { '+': { s: next.state, lu: Date.now() / 1000 } } } } });
        if (s.kind === 'events') send(c, { id: s.id, type: 'event', event: { event_type: 'state_changed', data: { entity_id: id, old_state: old, new_state: next } } });
      }
    },
    dropAll() { for (const c of clients) c.socket.destroy(); clients.clear(); },
    close() { this.dropAll(); return new Promise((r) => server.close(r)); },
  };
}

const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const LIVE_STATES = [
  { entity_id: 'sensor.co2', state: '800', attributes: { friendly_name: 'CO2', unit_of_measurement: 'ppm', device_class: 'carbon_dioxide' } },
  { entity_id: 'sensor.washer_state', state: 'running', attributes: { friendly_name: 'Washer' } },
  { entity_id: 'sensor.other', state: '1', attributes: {} },
];

async function liveSetup({ subscribeEntities = true, token = TOKEN, throttleMs = 150, minDelay = 50 } = {}) {
  const ha = fakeHa({ token: TOKEN, states: LIVE_STATES, subscribeEntities });
  const url = await ha.listen();
  const mod = {
    id: 'm_ha', type: 'homeassistant', enabled: true,
    settings: applyDefaults(schema.fields, { url, token, entities: [
      { entity: 'sensor.co2', warnAbove: '1000' },
      { entity: 'binary_sensor.washer_done', label: 'Washer finished', conditionEntity: 'sensor.washer_state', conditionValue: 'finished' },
    ] }),
  };
  let config = { general: cfg.general, modules: [mod] };
  const calls = [];
  const listeners = [];
  startHaLive(() => config, (event, data) => calls.push({ event, data, at: Date.now() }), (fn) => listeners.push(fn), { throttleMs, minDelay, maxDelay: Math.max(200, minDelay), authFailDelay: 300 });
  const setConfig = (next) => { config = next; listeners.forEach((fn) => fn(next)); };
  return { ha, mod, calls, setConfig, getConfig: () => config };
}

test('live: auth, subscribe_entities, serves from the state map, broadcasts changes', async (t) => {
  const { ha, mod, calls } = await liveSetup();
  t.after(async () => { stopHaLive(); await ha.close(); });
  await waitFor(() => haLiveStatus()[0]?.ready);
  assert.equal(ha.stats.auths, 1);
  assert.deepEqual(ha.stats.subscribes[0].sort(), ['binary_sensor.washer_done', 'sensor.co2', 'sensor.washer_state']);
  const restBefore = ha.stats.rest;
  let data = await provider(mod.settings, cfg);
  assert.equal(data.live, true);
  assert.equal(ha.stats.rest, restBefore, 'no REST call while live');
  assert.deepEqual(data.entities.map((e) => [e.id, e.value, !!e.warn]), [['sensor.co2', 800, false]]);

  calls.length = 0;
  ha.setState('sensor.co2', '1250');
  await waitFor(() => calls.length >= 1);
  assert.deepEqual(calls[0], { event: 'refresh', data: { module: 'm_ha' }, at: calls[0].at });
  data = await provider(mod.settings, cfg);
  assert.equal(data.entities[0].value, 1250);
  assert.equal(data.entities[0].warn, true);

  // entity condition: washer finished → condition entity flips, entry appears
  ha.setState('binary_sensor.washer_done', 'on', { friendly_name: 'Washer done' });
  ha.setState('sensor.washer_state', 'finished');
  await waitFor(async () => (await provider(mod.settings, cfg)).entities.length === 2);

  // unrelated entity → no broadcast
  await new Promise((r) => setTimeout(r, 200));
  calls.length = 0;
  ha.setState('sensor.other', '2');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(calls.length, 0);
});

test('live: refresh broadcasts are throttled per module', async (t) => {
  const { ha, calls } = await liveSetup({ throttleMs: 400 });
  t.after(async () => { stopHaLive(); await ha.close(); });
  await waitFor(() => haLiveStatus()[0]?.ready);
  await new Promise((r) => setTimeout(r, 900)); // initial snapshot refresh (+ trailing one) is out
  calls.length = 0;
  for (let i = 0; i < 10; i++) ha.setState('sensor.co2', String(900 + i));
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(calls.length, 1, 'first change goes out at once, the rest is coalesced');
  await waitFor(() => calls.length === 2);
  assert.ok(calls[1].at - calls[0].at >= 380);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(calls.length, 2);
});

test('live: reconnects after the server drops the connection and resyncs', async (t) => {
  const { ha, mod, calls } = await liveSetup({ minDelay: 400 });
  t.after(async () => { stopHaLive(); await ha.close(); });
  await waitFor(() => haLiveStatus()[0]?.ready);
  await new Promise((r) => setTimeout(r, 400));
  ha.dropAll();
  ha.setState('sensor.co2', '1500'); // changed while nobody listens
  calls.length = 0;
  await waitFor(() => !haLiveStatus()[0].ready);
  // falls back to REST while disconnected
  const restBefore = ha.stats.rest;
  const data = await provider(mod.settings, cfg);
  assert.equal(data.live, false);
  assert.equal(ha.stats.rest, restBefore + 1);
  assert.equal(data.entities[0].value, 1500);
  assert.equal(calls.length, 0);
  await waitFor(() => haLiveStatus()[0].ready && ha.stats.connections === 2);
  await waitFor(() => calls.length >= 1); // snapshot after reconnect differs → refresh
  assert.equal((await provider(mod.settings, cfg)).entities[0].value, 1500);
  ha.setState('sensor.co2', '700');
  await waitFor(async () => (await provider(mod.settings, cfg)).entities[0].value === 700);
});

test('live: falls back to get_states + state_changed on old Home Assistant', async (t) => {
  const { ha, mod, calls } = await liveSetup({ subscribeEntities: false });
  t.after(async () => { stopHaLive(); await ha.close(); });
  await waitFor(() => haLiveStatus()[0]?.ready);
  calls.length = 0;
  ha.setState('sensor.co2', '1111');
  await waitFor(() => calls.length >= 1);
  const data = await provider(mod.settings, cfg);
  assert.equal(data.live, true);
  assert.equal(data.entities[0].value, 1111);
});

test('live: config changes resubscribe; live=false and bad token disable it', async (t) => {
  const { ha, mod, setConfig, getConfig } = await liveSetup();
  t.after(async () => { stopHaLive(); await ha.close(); });
  await waitFor(() => haLiveStatus()[0]?.ready);
  const s2 = { ...mod.settings, entities: [...mod.settings.entities, { entity: 'sensor.other', label: '', icon: 'auto', showWhen: 'always', decimals: 'auto', conditionEntity: '', conditionOperator: 'equals', conditionValue: '', warnAbove: '', warnBelow: '' }] };
  setConfig({ ...getConfig(), modules: [{ ...mod, settings: s2 }] });
  await waitFor(() => ha.stats.subscribes.length === 2 && haLiveStatus()[0].ready);
  assert.ok(ha.stats.subscribes[1].includes('sensor.other'));
  setConfig({ ...getConfig(), modules: [{ ...mod, settings: { ...s2, live: false } }] });
  assert.deepEqual(haLiveStatus(), []);
  await waitFor(() => ha.clients.size === 0);
  // wrong token: auth_invalid, no live data, provider reports the REST error
  setConfig({ ...getConfig(), modules: [{ ...mod, settings: { ...s2, token: 'wrong' } }] });
  await waitFor(() => /rejected/.test(haLiveStatus()[0]?.error || ''));
  assert.equal(haLiveStatus()[0].ready, false);
  await assert.rejects(provider({ ...s2, token: 'wrong' }, cfg), /rejected the access token/);
});
