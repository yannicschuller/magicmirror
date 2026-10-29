import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {
  parseTargets, median, latencyStats, classify, mbps, parseTrace, probeHost, tcpConnect, applyGrace,
  haPresence, speedDue, downloadSpeed, uploadSpeed, provider,
} from '../src/providers/network.js';
import schema from '../public/shared/modules/network.js';
import { applyDefaults } from '../public/shared/modules.js';
import deNet from '../public/shared/locales/de/modules/network.js';

let tcp;
let tcpPort;
let closedPort;
let web;
let base;
let uploaded = 0;

before(async () => {
  tcp = net.createServer((s) => s.end());
  await new Promise((r) => tcp.listen(0, '127.0.0.1', r));
  tcpPort = tcp.address().port;
  // A port that was just free → connection refused.
  const tmp = net.createServer();
  await new Promise((r) => tmp.listen(0, '127.0.0.1', r));
  closedPort = tmp.address().port;
  await new Promise((r) => tmp.close(r));

  web = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__down') {
      const n = Number(u.searchParams.get('bytes'));
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': n });
      return res.end(Buffer.alloc(n));
    }
    if (u.pathname === '/__up') {
      req.on('data', (c) => (uploaded += c.length));
      return req.on('end', () => res.end('ok'));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${web.address().port}`;
});

after(() => {
  tcp.close();
  web.close();
});

test('parseTargets handles IPv4, IPv6, host names and default port', () => {
  assert.deepEqual(parseTargets('1.1.1.1:443, 9.9.9.9:53 [2606:4700::1111]:443 example.com, 2001:db8::1,, bad:99999'), [
    { host: '1.1.1.1', port: 443, label: '1.1.1.1:443' },
    { host: '9.9.9.9', port: 53, label: '9.9.9.9:53' },
    { host: '2606:4700::1111', port: 443, label: '[2606:4700::1111]:443' },
    { host: 'example.com', port: 443, label: 'example.com' },
    { host: '2001:db8::1', port: 443, label: '2001:db8::1' },
  ]);
  assert.deepEqual(parseTargets(''), []);
});

test('median and latency stats', () => {
  assert.equal(median([]), null);
  assert.equal(median([5, null, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  const s = latencyStats([
    { label: 'a', samples: [10, 12, 11] },
    { label: 'b', samples: [20, null, 30] },
    { label: 'c', samples: [null, null, null] },
  ]);
  assert.equal(s.latency, 12); // median of 10, 11, 12, 20, 30
  assert.equal(s.reachable, 2);
  assert.equal(s.total, 3);
  assert.equal(s.loss, 0.44);
  assert.deepEqual(s.targets.map((x) => [x.label, x.ok, x.ms]), [['a', true, 11], ['b', true, 25], ['c', false, null]]);
});

test('classify status levels', () => {
  assert.deepEqual(classify({ latency: null, reachable: 0, total: 2 }, 80, 250), { status: 'offline', level: 'severe' });
  assert.deepEqual(classify({ latency: 20, reachable: 2, total: 2, dnsOk: false }, 80, 250), { status: 'dns', level: 'severe' });
  assert.deepEqual(classify({ latency: 300, reachable: 2, total: 2 }, 80, 250), { status: 'slow', level: 'severe' });
  assert.deepEqual(classify({ latency: 100, reachable: 2, total: 2 }, 80, 250), { status: 'slow', level: 'warn' });
  assert.deepEqual(classify({ latency: 20, reachable: 1, total: 2 }, 80, 250), { status: 'degraded', level: 'warn' });
  assert.deepEqual(classify({ latency: 20, reachable: 2, total: 2, dnsOk: true }, 80, 250), { status: 'ok', level: 'ok' });
  assert.deepEqual(classify({ latency: 900, reachable: 1, total: 1 }, 0, 0), { status: 'ok', level: 'ok' });
});

test('speed from bytes and time', () => {
  assert.equal(mbps(10e6, 1000), 80);
  assert.equal(mbps(25e6, 2000), 100);
  assert.equal(mbps(1e6, 3000), 2.7);
  assert.equal(mbps(0, 1000), null);
  assert.equal(mbps(1000, 0), null);
});

test('speed test schedule', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const h = 3600e3;
  assert.equal(speedDue(undefined, 6, now), true);
  assert.equal(speedDue({ result: { at: now - 5 * h }, attempt: now - 5 * h }, 6, now), false);
  assert.equal(speedDue({ result: { at: now - 7 * h }, attempt: now - 7 * h }, 6, now), true);
  assert.equal(speedDue({ error: 'x', attempt: now - 10 * 60e3 }, 6, now), false); // retry after 30 min
  assert.equal(speedDue({ error: 'x', attempt: now - 40 * 60e3 }, 6, now), true);
});

test('download and upload speed against a local server', async () => {
  const down = await downloadSpeed(2e6, base);
  assert.ok(down > 0);
  const up = await uploadSpeed(1e6, base);
  assert.ok(up > 0);
  assert.equal(uploaded, 1e6 + 1);
});

test('Cloudflare trace parsing', () => {
  const tr = parseTrace('fl=470f412\nh=1.1.1.1\nip=203.0.113.7\nts=1793309701.000\nvisit_scheme=https\nloc=DE\ncolo=FRA\nwarp=off\n');
  assert.equal(tr.ip, '203.0.113.7');
  assert.equal(tr.loc, 'DE');
  assert.equal(tr.colo, 'FRA');
  assert.deepEqual(parseTrace(''), {});
});

test('TCP connect: open, refused, timeout', async () => {
  const open = await tcpConnect('127.0.0.1', tcpPort, 1000);
  assert.equal(open.ok, true);
  assert.ok(open.ms >= 0);
  const refused = await tcpConnect('127.0.0.1', closedPort, 1000);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'ECONNREFUSED');
});

test('presence probe: listening = up, refused = up, unroutable = down', async () => {
  assert.equal(await probeHost('127.0.0.1', [tcpPort], 1000), true);
  assert.equal(await probeHost('127.0.0.1', [closedPort], 1000), true);
  // TEST-NET-1 is never routed: timeout or "unreachable" → down.
  const t0 = Date.now();
  assert.equal(await probeHost('192.0.2.1', [80, 443], 300), false);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(await probeHost('', [80], 300), false);
  assert.equal(await probeHost('127.0.0.1', [], 300), false);
});

test('grace period keeps devices home for a while', () => {
  const seen = new Map();
  const t0 = 1_000_000;
  assert.equal(applyGrace('a', false, 10, t0, seen).home, false);
  assert.equal(applyGrace('a', true, 10, t0, seen).home, true);
  assert.equal(applyGrace('a', false, 10, t0 + 9 * 60e3, seen).home, true);
  assert.equal(applyGrace('a', false, 10, t0 + 11 * 60e3, seen).home, false);
  assert.equal(applyGrace('a', false, 0, t0 + 1, seen).home, false);
});

test('Home Assistant presence states', () => {
  assert.deepEqual(haPresence({ state: 'home' }), { home: true, where: '' });
  assert.deepEqual(haPresence({ state: 'not_home' }), { home: false, where: '' });
  assert.deepEqual(haPresence({ state: 'Work' }), { home: false, where: 'Work' });
  assert.deepEqual(haPresence(undefined), { home: false, where: '' });
});

test('provider end to end with local targets', async () => {
  const settings = applyDefaults(schema.fields, {
    targets: `127.0.0.1:${tcpPort}, 127.0.0.1:${closedPort}`,
    samples: 2,
    dnsHost: '',
    speedTest: true,
    speedSize: 1,
    presence: 'probe',
    devices: [{ name: 'Anna', host: '127.0.0.1', port: tcpPort }, { name: 'Ben', host: '192.0.2.1', port: 80 }],
  });
  const cfg = { general: { locale: 'de-DE', timezone: 'Europe/Berlin' } };
  const d = await provider(settings, cfg, { id: 'net-test' }, { speedBase: base, awaitSpeed: true });
  assert.equal(d.total, 2);
  assert.equal(d.reachable, 1);
  assert.equal(d.status, 'degraded');
  assert.equal(d.history.length, 1);
  assert.ok(d.speed.down > 0);
  assert.equal(d.speed.up, null);
  assert.deepEqual(d.devices.map((x) => [x.name, x.home]), [['Anna', true], ['Ben', false]]);

  const ha = await provider({ ...settings, targets: `127.0.0.1:${tcpPort}`, speedTest: false, presence: 'homeassistant', haUrl: '', haToken: '' }, cfg, { id: 'net-test-2' });
  assert.equal(ha.status, 'ok');
  assert.equal(ha.presenceError, 'Home-Assistant-URL oder Token fehlt');
});

test('German translations cover all schema strings', () => {
  const ids = [schema.label, schema.description];
  const walk = (fields) => {
    for (const f of fields) {
      ids.push(f.label);
      if (f.help) ids.push(f.help);
      if (f.itemLabel) ids.push(f.itemLabel);
      for (const o of f.options || []) ids.push(o.label);
      if (f.fields) walk(f.fields);
    }
  };
  walk(schema.fields);
  const missing = ids.filter((id) => !(id in deNet));
  assert.deepEqual(missing, []);
  const keys = Object.keys(deNet);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});
