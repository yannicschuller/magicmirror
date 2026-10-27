import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { provider, todoistTasks, haTasks, caldavTasks, parseVtodos, extractCalendarData, normalizeDue, sortItems, isOverdue, zonedToIso, filterDue } from '../src/providers/tasks.js';
import schema from '../public/shared/modules/tasks.js';
import de from '../public/shared/locales/de/modules/tasks.js';
import { applyDefaults } from '../public/shared/modules.js';

const TZ = 'Europe/Berlin';
const cfg = { general: { locale: 'de-DE', timezone: TZ } };
const settings = (extra) => applyDefaults(schema.fields, extra);

let server;
let base;
const seen = [];
let haMode = 'ok';

const ICS_TODOS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:1
SUMMARY:Milch kaufen\\, 2 Liter
DUE;VALUE=DATE:20200101
PRIORITY:1
STATUS:NEEDS-ACTION
BEGIN:VALARM
ACTION:DISPLAY
SUMMARY:alarm text
END:VALARM
END:VTODO
BEGIN:VTODO
UID:2
SUMMARY:Steuer
 erklärung
DUE;TZID=Europe/Berlin:20300615T090000
PRIORITY:5
END:VTODO
BEGIN:VTODO
UID:3
SUMMARY:Erledigt
STATUS:COMPLETED
COMPLETED:20240101T100000Z
END:VTODO
BEGIN:VTODO
UID:4
SUMMARY:Abgesagt
STATUS:CANCELLED
END:VTODO
END:VCALENDAR`;

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MULTISTATUS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
 <d:response><d:href>/dav/tasks/1.ics</d:href><d:propstat><d:prop><d:getetag>"a"</d:getetag>
  <cal:calendar-data>${xmlEscape(ICS_TODOS)}</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/dav/tasks/5.ics</d:href><d:propstat><d:prop>
  <C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav"><![CDATA[BEGIN:VCALENDAR
BEGIN:VTODO
SUMMARY:Ohne Status & Datum
END:VTODO
END:VCALENDAR]]></C:calendar-data></d:prop></d:propstat></d:response>
</d:multistatus>`;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      seen.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body });
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

      // ---- Todoist
      if (u.pathname.startsWith('/todoist/')) {
        if (req.headers.authorization !== 'Bearer tok') return json(401, {});
        if (u.pathname === '/todoist/projects') return json(200, { results: [{ id: 'p1', name: 'Inbox' }, { id: 'p2', name: 'Einkauf' }], next_cursor: null });
        if (u.pathname === '/todoist/tasks/filter') {
          return json(200, { results: [
            { id: 'f1', content: 'Filtered A', project_id: 'p2', priority: 4, due: { date: '2020-01-01', is_recurring: false }, child_order: 1 },
            { id: 'f2', content: 'Filtered B', project_id: 'p1', priority: 1, due: null, child_order: 2 },
          ], next_cursor: null });
        }
        if (u.pathname === '/todoist/tasks') {
          if (!u.searchParams.get('cursor')) {
            return json(200, { results: [
              { id: 't2', content: 'Brot', priority: 1, due: null, child_order: 2 },
              { id: 't1', content: 'Zahnarzt anrufen', priority: 4, due: { date: '2030-03-01T10:30:00', timezone: null, is_recurring: false }, child_order: 1 },
            ], next_cursor: 'page2' });
          }
          return json(200, { results: [
            { id: 't3', content: 'Fixed tz', priority: 2, due: { date: '2030-03-02T08:00:00Z', timezone: 'Europe/Berlin' }, child_order: 3 },
            { id: 't4', content: 'Done', checked: true, priority: 1, child_order: 4 },
          ], next_cursor: null });
        }
      }

      // ---- Home Assistant
      if (u.pathname === '/ha/api/services/todo/get_items') {
        if (req.headers.authorization !== 'Bearer hatok') return json(401, { message: 'unauthorized' });
        if (haMode === 'old') return json(400, { message: 'Service does not support responses' });
        return json(200, { changed_states: [], service_response: { 'todo.shopping_list': { items: [
          { summary: 'Eier', uid: 'a', status: 'needs_action' },
          { summary: 'Butter', uid: 'b', status: 'needs_action', due: '2020-05-01' },
          { summary: 'Termin', uid: 'c', status: 'needs_action', due: '2030-05-01T10:00:00+02:00' },
          { summary: 'Alt', uid: 'd', status: 'completed' },
        ] } } });
      }
      if (u.pathname === '/ha/api/shopping_list') return json(200, [{ name: 'Legacy', id: '1', complete: false }, { name: 'Gone', id: '2', complete: true }]);

      // ---- CalDAV
      if (u.pathname === '/dav/tasks/') {
        if (req.headers.authorization !== 'Basic ' + Buffer.from('anna:geheim').toString('base64')) { res.writeHead(401); return res.end(); }
        if (req.method !== 'REPORT') { res.writeHead(405); return res.end(); }
        if (u.searchParams.get('strictfail') && body.includes('is-not-defined')) { res.writeHead(501); return res.end(); }
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(MULTISTATUS);
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const last = (path) => seen.filter((r) => r.path === path).at(-1);

test('schema: secrets and showIf', () => {
  const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]));
  for (const k of ['todoistToken', 'haUrl', 'haToken', 'caldavUrl', 'caldavUser', 'caldavPassword']) assert.equal(byKey[k].secret, true, k);
  assert.deepEqual(byKey.haEntity.showIf, { source: 'homeassistant' });
  assert.deepEqual(byKey.caldavUrl.showIf, { source: 'caldav' });
  const s = settings({});
  assert.equal(s.source, 'todoist');
  assert.equal(s.haEntity, 'todo.shopping_list');
});

test('German dictionary covers every schema string', () => {
  const ids = [schema.label, schema.description, schema.defaultTitle];
  for (const f of schema.fields) {
    ids.push(f.label);
    for (const o of f.options || []) ids.push(o.label);
  }
  for (const id of ids) assert.ok(de[id], `missing German for "${id}"`);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});

test('due normalisation and overdue', () => {
  assert.deepEqual(normalizeDue('2026-10-27', TZ), { due: '2026-10-27', allDay: true });
  assert.equal(normalizeDue('2026-07-01T10:00:00', TZ).due, '2026-07-01T08:00:00.000Z'); // floating → CEST
  assert.equal(normalizeDue('2026-12-01T10:00:00', TZ).due, '2026-12-01T09:00:00.000Z'); // CET
  assert.equal(normalizeDue('2026-12-01T10:00:00+05:00', TZ).due, '2026-12-01T05:00:00.000Z');
  assert.equal(zonedToIso(2026, 3, 29, 3, 30, 0, TZ), '2026-03-29T01:30:00.000Z'); // just after DST switch
  assert.deepEqual(normalizeDue(null, TZ), { due: null, allDay: false });
  const now = new Date('2026-10-27T22:30:00Z'); // 23:30 in Berlin, still the 27th
  assert.equal(isOverdue({ due: '2026-10-27', allDay: true }, now, TZ), false);
  assert.equal(isOverdue({ due: '2026-10-26', allDay: true }, now, TZ), true);
  assert.equal(isOverdue({ due: '2026-10-27T22:00:00.000Z', allDay: false }, now, TZ), true);
  assert.equal(isOverdue({ due: null }, now, TZ), false);
});

test('sorting', () => {
  const items = [
    { title: 'none', due: null, allDay: false, priority: 3 },
    { title: 'day', due: '2026-10-28', allDay: true, priority: 0 },
    { title: 'timed', due: '2026-10-28T10:00:00.000Z', allDay: false, priority: 1 },
    { title: 'early', due: '2026-10-20', allDay: true, priority: 0 },
  ];
  assert.deepEqual(sortItems(items, 'due').map((i) => i.title), ['early', 'timed', 'day', 'none']);
  assert.deepEqual(sortItems(items, 'priority').map((i) => i.title), ['none', 'timed', 'early', 'day']);
  assert.deepEqual(sortItems(items, 'source').map((i) => i.title), ['none', 'day', 'timed', 'early']);
});

test('todoist: paginated task list with bearer token', async () => {
  const before = seen.length;
  const items = await todoistTasks(settings({ todoistToken: 'tok' }), TZ, `${base}/todoist`);
  const reqs = seen.slice(before);
  assert.equal(reqs.length, 2);
  assert.equal(reqs[0].method, 'GET');
  assert.equal(reqs[0].headers.authorization, 'Bearer tok');
  assert.equal(reqs[0].query.limit, '200');
  assert.equal(reqs[1].query.cursor, 'page2');
  assert.deepEqual(items.map((i) => i.title), ['Zahnarzt anrufen', 'Brot', 'Fixed tz']);
  assert.deepEqual(items[0], { title: 'Zahnarzt anrufen', due: '2030-03-01T09:30:00.000Z', allDay: false, priority: 3 });
  assert.equal(items[2].due, '2030-03-02T08:00:00.000Z');
  assert.equal(items[2].priority, 1);
  assert.equal(items[1].due, null);
});

test('todoist: project by name and filter query', async () => {
  const items = await todoistTasks(settings({ todoistToken: 'tok', todoistProject: 'einkauf' }), TZ, `${base}/todoist`);
  assert.equal(last('/todoist/tasks').query.project_id, 'p2');
  assert.ok(items.length);
  const filtered = await todoistTasks(settings({ todoistToken: 'tok', todoistProject: 'p2', todoistFilter: 'today | overdue' }), TZ, `${base}/todoist`);
  assert.equal(last('/todoist/tasks/filter').query.query, 'today | overdue');
  assert.deepEqual(filtered.map((i) => i.title), ['Filtered A']);
  assert.deepEqual(filtered[0], { title: 'Filtered A', due: '2020-01-01', allDay: true, priority: 3 });
  await assert.rejects(todoistTasks(settings({ todoistToken: 'tok', todoistProject: 'Nope' }), TZ, `${base}/todoist`), /not found/);
  await assert.rejects(todoistTasks(settings({ todoistToken: 'bad' }), TZ, `${base}/todoist`), /rejected the API token/);
  await assert.rejects(todoistTasks(settings({}), TZ, `${base}/todoist`), /No Todoist API token/);
});

test('home assistant: todo.get_items with return_response', async () => {
  haMode = 'ok';
  const s = settings({ source: 'homeassistant', haUrl: `${base}/ha/`, haToken: 'hatok' });
  const items = await haTasks(s, TZ);
  const r = last('/ha/api/services/todo/get_items');
  assert.equal(r.method, 'POST');
  assert.equal('return_response' in r.query, true);
  assert.equal(r.headers.authorization, 'Bearer hatok');
  assert.match(r.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(r.body), { entity_id: 'todo.shopping_list', status: 'needs_action' });
  assert.deepEqual(items, [
    { title: 'Eier', due: null, allDay: false, priority: 0 },
    { title: 'Butter', due: '2020-05-01', allDay: true, priority: 0 },
    { title: 'Termin', due: '2030-05-01T08:00:00.000Z', allDay: false, priority: 0 },
  ]);
});

test('home assistant: fallback to legacy shopping list API, errors', async () => {
  haMode = 'old';
  const s = settings({ source: 'homeassistant', haUrl: `${base}/ha`, haToken: 'hatok' });
  assert.deepEqual((await haTasks(s, TZ)).map((i) => i.title), ['Legacy']);
  await assert.rejects(haTasks({ ...s, haEntity: 'todo.other' }, TZ), /HTTP 400/);
  haMode = 'ok';
  await assert.rejects(haTasks({ ...s, haToken: 'wrong' }, TZ), /401/);
  await assert.rejects(haTasks({ ...s, haEntity: 'light.kitchen' }, TZ), /Invalid to-do entity/);
  await assert.rejects(haTasks({ ...s, haUrl: 'http://127.0.0.1:1' }, TZ), /not reachable/);
});

test('caldav: VTODO parsing', () => {
  const todos = parseVtodos(ICS_TODOS, TZ);
  assert.equal(todos.length, 4);
  assert.deepEqual(todos[0], { summary: 'Milch kaufen, 2 Liter', due: { due: '2020-01-01', allDay: true }, priority: 1, status: 'NEEDS-ACTION' });
  assert.equal(todos[1].summary, 'Steuererklärung');
  assert.deepEqual(todos[1].due, { due: '2030-06-15T07:00:00.000Z', allDay: false });
  assert.equal(extractCalendarData(MULTISTATUS).length, 2);
});

test('caldav: REPORT calendar-query with basic auth', async () => {
  const s = settings({ source: 'caldav', caldavUrl: `${base}/dav/tasks/`, caldavUser: 'anna', caldavPassword: 'geheim' });
  const items = await caldavTasks(s, TZ);
  const r = last('/dav/tasks/');
  assert.equal(r.method, 'REPORT');
  assert.equal(r.headers.depth, '1');
  assert.match(r.headers['content-type'], /application\/xml/);
  assert.match(r.body, /<c:calendar-query/);
  assert.match(r.body, /<c:comp-filter name="VTODO">/);
  assert.match(r.body, /<c:prop-filter name="COMPLETED"><c:is-not-defined\/>/);
  assert.deepEqual(items, [
    { title: 'Milch kaufen, 2 Liter', due: '2020-01-01', allDay: true, priority: 3 },
    { title: 'Steuererklärung', due: '2030-06-15T07:00:00.000Z', allDay: false, priority: 2 },
    { title: 'Ohne Status & Datum', due: null, allDay: false, priority: 0 },
  ]);
  // Server without is-not-defined support → retried with the plain VTODO filter.
  const before = seen.length;
  const retry = await caldavTasks({ ...s, caldavUrl: `${base}/dav/tasks/?strictfail=1` }, TZ);
  assert.equal(seen.length - before, 2);
  assert.doesNotMatch(seen.at(-1).body, /is-not-defined/);
  assert.equal(retry.length, 3);
  await assert.rejects(caldavTasks({ ...s, caldavPassword: 'x' }, TZ), /login failed/);
});

test('provider: sorted, limited, overdue flag, translated errors', async () => {
  const s = settings({ source: 'caldav', caldavUrl: `${base}/dav/tasks/`, caldavUser: 'anna', caldavPassword: 'geheim', maxItems: 2 });
  const data = await provider(s, cfg);
  assert.equal(data.total, 3);
  assert.deepEqual(data.items.map((i) => [i.title, i.overdue]), [['Milch kaufen, 2 Liter', true], ['Steuererklärung', false]]);
  // cached for 60 s: no new request
  const before = seen.length;
  await provider(s, cfg);
  assert.equal(seen.length, before);
  await assert.rejects(provider(settings({ source: 'caldav' }), { general: { locale: 'en-GB', timezone: TZ } }), /No CalDAV URL configured/);
});

test('filterDue: due within n days, overdue kept, no-due optional', () => {
  const now = new Date('2026-10-27T10:00:00Z');
  const items = [
    { title: 'over', due: '2026-10-20', allDay: true },
    { title: 'today', due: '2026-10-27T16:00:00.000Z', allDay: false },
    { title: 'in3', due: '2026-10-30', allDay: true },
    { title: 'in10', due: '2026-11-06', allDay: true },
    { title: 'none', due: null, allDay: false },
  ];
  const t = (days, noDue) => filterDue(items, days, noDue, now, 'Europe/Berlin').map((i) => i.title);
  assert.deepEqual(t(0, false), ['over', 'today', 'in3', 'in10', 'none']);
  assert.deepEqual(t(3, true), ['over', 'today', 'in3', 'none']);
  assert.deepEqual(t(3, false), ['over', 'today', 'in3']);
  assert.deepEqual(t(1, false), ['over', 'today']);
});
