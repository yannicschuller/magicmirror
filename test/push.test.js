import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Isolated data dir – must be set before the server modules are imported.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-push-'));
const express = (await import('express')).default;
const { parseReminders, pushRouter } = await import('../src/push.js');
const { provider } = await import('../src/providers/tasks.js');
const { applyDefaults, MODULE_TYPES } = await import('../public/shared/modules.js');

test('parses plain text lines with optional due date and priority', () => {
  const items = parseReminders('Milch\n- Brot | 2026-10-28\nZahnarzt anrufen | 2026-10-28T09:00:00+01:00 | high\n\n   \nDone | | ');
  assert.deepEqual(items.map((i) => i.title), ['Milch', 'Brot', 'Zahnarzt anrufen', 'Done']);
  assert.deepEqual(items[1], { title: 'Brot', due: '2026-10-28', allDay: true, priority: 0 });
  assert.equal(items[2].due, '2026-10-28T08:00:00.000Z');
  assert.equal(items[2].allDay, false);
  assert.equal(items[2].priority, 3);
});

test('parses JSON arrays/objects and drops completed items', () => {
  assert.deepEqual(parseReminders(['A', 'B']).map((i) => i.title), ['A', 'B']);
  const items = parseReminders({ items: [{ title: 'Eier', priority: 1 }, { name: 'Alt', isCompleted: true }, { title: '' }, { title: 'Ölwechsel', dueDate: 'garbage', priority: 9 }] });
  assert.deepEqual(items, [
    { title: 'Eier', due: null, allDay: false, priority: 3 },
    { title: 'Ölwechsel', due: null, allDay: false, priority: 1 },
  ]);
  assert.deepEqual(parseReminders('[{"title":"x"}]').map((i) => i.title), ['x']);
});

test('push endpoint checks the token, stores items and feeds the provider', async () => {
  const settings = applyDefaults(MODULE_TYPES.tasks.fields, { source: 'shortcuts', pushToken: 'secret-token-123', sort: 'source' });
  const cfg = { general: { locale: 'de-DE', timezone: 'Europe/Berlin' }, modules: [{ id: 'm_tasks', type: 'tasks', settings }] };
  const pushed = [];
  const app = express();
  app.use('/api/push', pushRouter(() => cfg, (id) => pushed.push(id)));
  const server = http.createServer(app).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/push/tasks`;
  try {
    await assert.rejects(provider(settings, cfg, cfg.modules[0]), /Kurzbefehl/);

    const bad = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: 'x' });
    assert.equal(bad.status, 401);

    const ok = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer secret-token-123', 'Content-Type': 'text/plain' }, body: 'Milch\nBrot | 2020-01-01' });
    assert.deepEqual(await ok.json(), { ok: true, received: 2 });
    assert.deepEqual(pushed, ['m_tasks']);

    // Shortcuts may also upload the text as a file (octet-stream) and pass the token as query.
    const file = await fetch(`${url}?token=secret-token-123`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'Milch\nBrot | 2020-01-01\nKäse' });
    assert.equal((await file.json()).received, 3);

    const data = await provider(settings, cfg, cfg.modules[0]);
    assert.deepEqual(data.items.map((i) => i.title), ['Milch', 'Brot', 'Käse']);
    assert.equal(data.items[1].overdue, true);
    assert.ok(data.receivedAt);
    assert.equal(data.stale, false);
    assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, 'push', 'tasks-m_tasks.json')));
  } finally {
    server.close();
  }
});

test('every tasks module gets its own random push token', () => {
  const a = applyDefaults(MODULE_TYPES.tasks.fields, {}).pushToken;
  const b = applyDefaults(MODULE_TYPES.tasks.fields, {}).pushToken;
  assert.match(a, /^[0-9a-f]{36}$/);
  assert.notEqual(a, b);
  assert.equal(MODULE_TYPES.tasks.fields.find((f) => f.key === 'pushToken').secret, true);
});

test('duplicate reminder lines are merged', () => {
  const items = parseReminders('Milch\nBrot | 2026-10-28\nmilch\nBrot | 2026-10-28\nBrot | 2026-10-29');
  assert.deepEqual(items.map((i) => `${i.title}|${i.due || ''}`), ['Milch|', 'Brot|2026-10-28', 'Brot|2026-10-29']);
});
