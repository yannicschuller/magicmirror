import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pollOnce, luxBrightness, isPresent, haConnection, _resetSensors } from '../src/sensors.js';
import { displayState } from '../public/shared/night.js';

test('lux → brightness: minimum when dark, full when bright, logarithmic between', () => {
  const g = { luxDark: 5, luxBright: 500, luxMinBrightness: 20 };
  assert.equal(luxBrightness(1, g), 0.2);
  assert.equal(luxBrightness(600, g), 1);
  assert.equal(luxBrightness(50, g), 0.6);
  assert.equal(luxBrightness('unavailable', g), null);
});

test('display state: absence switches off, light dims, the remote wins', () => {
  const g = { dimEnabled: false };
  assert.deepEqual(displayState(g, new Date(), null, { absent: true }), { mode: 'off', brightness: 0 });
  assert.deepEqual(displayState(g, new Date(), null, { absent: false, brightness: 0.4 }), { mode: 'day', brightness: 0.4 });
  assert.deepEqual(displayState(g, new Date(), { mode: 'on' }, { absent: true }), { mode: 'day', brightness: 1 });
  const night = { dimEnabled: true, dimFrom: '00:00', dimTo: '23:59', timezone: 'UTC', nightMode: 'dim', dimBrightness: 50 };
  assert.equal(displayState(night, new Date('2026-11-03T12:00:00Z'), null, { brightness: 0.3 }).brightness, 0.3, 'the darker one wins');
  assert.equal(isPresent('on'), true);
  assert.equal(isPresent('not_home'), false);
});

test('presence and lux polled from Home Assistant; unreachable keeps the screen on', async () => {
  const states = { 'binary_sensor.motion': 'off', 'sensor.lux': '500' };
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer t1') return res.writeHead(401).end();
    const id = decodeURIComponent(req.url.split('/').pop());
    if (!(id in states)) return res.writeHead(404).end();
    res.end(JSON.stringify({ state: states[id] }));
  }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const cfg = { general: { presenceEntity: 'binary_sensor.motion', presenceOffMinutes: 10, luxEntity: 'sensor.lux' }, modules: [{ type: 'homeassistant', settings: { url, token: 't1' } }] };
  assert.equal(haConnection(cfg).token, 't1', 'falls back to the Home Assistant module');
  _resetSensors();
  const t0 = Date.now();
  let s = await pollOnce(cfg, t0);
  assert.deepEqual(s, { absent: false, brightness: 1, error: null });
  s = await pollOnce(cfg, t0 + 11 * 60000);
  assert.equal(s.absent, true, 'nobody for 11 minutes');
  states['binary_sensor.motion'] = 'on';
  s = await pollOnce(cfg, t0 + 12 * 60000);
  assert.equal(s.absent, false, 'on again at once');
  server.close();
  s = await pollOnce({ ...cfg, modules: [{ type: 'homeassistant', settings: { url: 'http://127.0.0.1:1', token: 't1' } }] }, t0 + 30 * 60000);
  assert.equal(s.absent, false);
  assert.ok(s.error);
});
