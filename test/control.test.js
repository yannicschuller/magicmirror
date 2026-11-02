import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { controlRouter, duePowerAction, parseTime } from '../src/control.js';
import { publicConfig, defaultConfig } from '../public/shared/modules.js';

function app(general) {
  const calls = [];
  let override = null;
  const cfg = { general, pages: [{ id: 'main', name: 'Main' }, { id: 'f1', name: 'Formel 1' }] };
  const a = express();
  a.use('/api/control', controlRouter({
    getConfig: () => cfg,
    getDisplay: () => ({ mode: override === 'off' ? 'off' : 'day', override }),
    setDisplayOverride: (m, min) => calls.push(['display', (override = m), min]),
    broadcast: (type, data) => calls.push([type, data]),
    clientCount: () => 1,
    power: async (action) => (calls.push(['power', action]), { ok: true, action }),
    notify: (n) => (n.title || n.message ? (calls.push(['notify', n.title, n.level]), { id: 'x' }) : null),
  }));
  const server = http.createServer(a).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/control`;
  return { calls, base, close: () => server.close() };
}

test('control API: token required, screen, pages, power', async () => {
  const off = app({ controlToken: '' });
  assert.equal((await fetch(`${off.base}/status`)).status, 404, 'no token configured → API off');
  off.close();

  const { calls, base, close } = app({ controlToken: 'secret-1' });
  const auth = { headers: { Authorization: 'Bearer secret-1' } };
  assert.equal((await fetch(`${base}/screen/off`)).status, 401);
  assert.equal((await fetch(`${base}/screen/off`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/screen/off?minutes=30`, auth)).status, 200);
  assert.deepEqual(calls.at(-1), ['display', 'off', 30]);
  await fetch(`${base}/screen/auto?token=secret-1`, { method: 'POST' });
  assert.deepEqual(calls.at(-1), ['display', null, 0]);
  await fetch(`${base}/page/next`, auth);
  assert.deepEqual(calls.at(-1), ['nav', { action: 'next', minutes: 0 }]);
  await fetch(`${base}/page/formel%201`, auth);
  assert.deepEqual(calls.at(-1), ['page', { page: 'f1' }]);
  assert.equal((await fetch(`${base}/page/nope`, auth)).status, 404);
  assert.equal((await (await fetch(`${base}/power/reboot`, auth)).json()).action, 'reboot');
  assert.equal((await fetch(`${base}/power/explode`, auth)).status, 400);
  await fetch(`${base}/notify?title=W%C3%A4sche&level=success`, auth);
  assert.deepEqual(calls.at(-1), ['notify', 'Wäsche', 'success']);
  assert.equal((await fetch(`${base}/notify`, { ...auth, method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  const st = await (await fetch(`${base}/status`, auth)).json();
  assert.equal(st.screen, 'day');
  assert.equal(st.pages.length, 2);
  close();
});

test('control token never reaches the mirror', () => {
  const cfg = defaultConfig();
  cfg.general.controlToken = 'secret-2';
  assert.equal(publicConfig(cfg).general.controlToken, undefined);
});

test('scheduled shutdown / restart: once per day within a 5 minute window', () => {
  assert.equal(parseTime('23:30'), 1410);
  assert.equal(parseTime('7.05'), 425);
  assert.equal(parseTime('25:00'), null);
  const g = { timezone: 'Europe/Berlin', shutdownAt: '23:30', rebootAt: '' };
  const done = {};
  assert.equal(duePowerAction(g, new Date('2026-11-03T22:29:00Z'), done), null);
  const due = duePowerAction(g, new Date('2026-11-03T22:31:00Z'), done);
  assert.deepEqual(due, { action: 'shutdown', day: '2026-11-03' });
  done.shutdown = due.day;
  assert.equal(duePowerAction(g, new Date('2026-11-03T22:32:00Z'), done), null);
  assert.equal(duePowerAction(g, new Date('2026-11-03T22:40:00Z'), {}), null, 'outside the window');
});

test('notifications: normalized from query/JSON and ntfy', async () => {
  const { makeNotification, fromNtfy } = await import('../src/notify.js');
  assert.equal(makeNotification({}), null);
  const n = makeNotification({ title: 'Waschmaschine', message: 'fertig', duration: '20' }, { notifyDuration: 15 });
  assert.equal(n.level, 'info');
  assert.equal(n.duration, 20);
  assert.equal(n.wake, false);
  const a = makeNotification({ title: 'Rauchmelder', level: 'alert' }, { notifyDuration: 15 });
  assert.equal(a.duration, 30, 'alerts stay longer');
  assert.equal(a.wake, true, 'alerts wake the screen');
  assert.equal(makeNotification({ title: 'x', wake: 'false' }).wake, false);
  assert.deepEqual(fromNtfy({ title: 'Paket', message: 'ist da', priority: 4, tags: ['package'] }), { title: 'Paket', message: 'ist da', level: 'warn', icon: 'package' });
});
