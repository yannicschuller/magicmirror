import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { provider, fromKuma, fromJson, fromStatuspage, normStatus } from '../src/providers/status.js';
import schema from '../public/shared/modules/status.js';
import { applyDefaults } from '../public/shared/modules.js';
import { CONDITIONS } from '../public/shared/conditions.js';
import de from '../public/shared/locales/de/modules/status.js';

const CUSTOM = JSON.parse(readFileSync(new URL('./fixtures/status-custom.json', import.meta.url), 'utf8'));
const settings = (o) => ({ ...applyDefaults(schema.fields, {}), ...o });

test('status words of all kinds', () => {
  assert.equal(normStatus('UP'), 'up');
  assert.equal(normStatus('operational'), 'up');
  assert.equal(normStatus('partial_outage'), 'degraded');
  assert.equal(normStatus('major outage'), 'down');
  assert.equal(normStatus(false), 'down');
  assert.equal(normStatus('under_maintenance'), 'maintenance');
  assert.equal(normStatus('???'), 'unknown');
});

test('own JSON: services map with latency, days as history, keys capitalised', () => {
  const d = fromJson(CUSTOM);
  assert.equal(d.services.length, Object.keys(CUSTOM.services).length);
  const app = d.services.find((x) => x.key === 'app');
  assert.equal(app.name, 'App');
  assert.ok(['up', 'degraded', 'down'].includes(app.status));
  assert.ok(Number.isFinite(app.latency));
  assert.ok(app.history.length >= 1);
  // simpler shapes
  assert.deepEqual(fromJson({ web: 'ok', db: { status: 'down', message: 'timeout' } }).services.map((x) => [x.name, x.status, x.message]), [['Web', 'up', null], ['Db', 'down', 'timeout']]);
  assert.deepEqual(fromJson([{ name: 'Mail', status: 'degraded' }]).services.map((x) => [x.name, x.status]), [['Mail', 'degraded']]);
  const days = fromJson({ services: { a: { status: 'up' } }, days: { a: { '2026-11-15': { n: 10, down: 1 }, '2026-11-16': { n: 10, down: 0 } } } }).services[0];
  assert.deepEqual(days.history, ['down', 'up']);
  assert.equal(days.uptime, 0.95);
});

test('Uptime Kuma: groups, last beat, since, 24 h uptime, incidents (1.x and 2.x)', () => {
  const page = { config: { title: 'Home' }, incident: { title: 'Router reboot', style: 'warning' }, publicGroupList: [{ name: 'Net', monitorList: [{ id: 1, name: 'Router' }, { id: 2, name: 'NAS' }] }], maintenanceList: [] };
  const beats = {
    heartbeatList: {
      1: [{ status: 1, time: '2026-11-16 10:00:00', ping: 3 }, { status: 0, time: '2026-11-16 10:01:00', ping: null }, { status: 0, time: '2026-11-16 10:02:00', ping: null }],
      2: [{ status: 1, time: '2026-11-16 10:02:00.123', ping: 12 }],
    },
    uptimeList: { '1_24': 0.97, '2_24': 1 },
  };
  const d = fromKuma(page, beats);
  assert.equal(d.title, 'Home');
  const router = d.services[0];
  assert.deepEqual([router.status, router.since, router.uptime], ['down', '2026-11-16T10:01:00.000Z', 0.97]);
  assert.deepEqual(router.history, ['up', 'down', 'down']);
  assert.deepEqual([d.services[1].status, d.services[1].latency], ['up', 12]);
  assert.deepEqual(d.incidents, [{ title: 'Router reboot', status: 'degraded', since: null }]);
  assert.equal(fromKuma({ ...page, incident: undefined, incidents: [{ title: 'A', style: 'danger' }] }, beats).incidents[0].status, 'down');
});

test('Statuspage.io: components without groups and "Visit …", incidents', () => {
  const d = fromStatuspage({ page: { name: 'GitHub' }, components: [
    { id: 'g', name: 'Group', status: 'operational', group: true },
    { id: 'a', name: 'Git Operations', status: 'operational', group: false },
    { id: 'b', name: 'Actions', status: 'partial_outage', group: false, group_id: 'g' },
    { id: 'v', name: 'Visit www.githubstatus.com for more information', status: 'operational', group: false },
  ], incidents: [{ name: 'Delays', impact: 'minor', created_at: '2026-11-16T10:00:00Z' }] });
  assert.deepEqual(d.services.map((x) => [x.name, x.status, x.group]), [['Git Operations', 'up', null], ['Actions', 'degraded', 'Group']]);
  assert.equal(d.incidents[0].title, 'Delays');
});

test('provider: names, hidden services, problem count, condition', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ services: { app: { status: 'up' }, api: { status: 'down' }, docs: { status: 'up' } } }), { status: 200 }));
  try {
    const d = await provider(settings({ source: 'json', url: 'https://example.org/s.json', names: 'api=API', hide: 'docs' }));
    assert.deepEqual(d.services.map((x) => x.name), ['App', 'API']);
    assert.equal(d.problems, 1);
    assert.equal(d.total, 2);
    assert.equal(CONDITIONS.status.test(d), true);
    assert.equal(CONDITIONS.status.test({ problems: 0, incidents: [] }), false);
  } finally {
    fetchMock.mock.restore();
  }
  assert.deepEqual(await provider(settings({ source: 'uptimekuma' })), { needsSetup: true });
});

test('German strings', () => {
  const ids = [schema.label, schema.description, schema.defaultTitle, CONDITIONS.status.label];
  for (const f of schema.fields) {
    ids.push(f.label);
    if (f.help) ids.push(f.help);
    if (f.placeholder && /[a-z]/i.test(f.placeholder)) ids.push(f.placeholder);
    for (const o of f.options || []) ids.push(o.label);
  }
  const src = readFileSync(new URL('../public/mirror/modules/status.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bt\('([^']+)'/g)) ids.push(m[1]);
  ids.push('Running', 'Degraded', 'Down', 'Maintenance', 'Pending', 'Unknown');
  for (const id of ids) assert.ok(de[id], `missing German: ${id}`);
});
