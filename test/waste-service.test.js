import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { waste, wasteAdminRouter, WASTE_SERVICE_DOWN } from '../src/providers/waste.js';
import { MODULE_TYPES, applyDefaults, publicConfig } from '../public/shared/modules.js';
import { dateKey } from '../src/util.js';

const TZ = 'Europe/Berlin';
const cfg = { general: { timezone: TZ } };
const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d, TZ);
};

// Fake "wastecollect" sidecar.
let sidecar;
let calls = [];
before(async () => {
  sidecar = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/fetch') {
        const { source, args } = JSON.parse(body);
        if (source === 'broken') {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'We could not find values for the argument', argument: 'street', suggestions: ['Hauptstraße'] }));
        }
        assert.equal(args.street, 'Hauptstraße');
        return res.end(
          JSON.stringify({
            source,
            entries: [
              { date: day(1), type: 'Restabfalltonne (Abholzeit)', icon: '' },
              { date: day(1), type: 'Biotonne', icon: '' },
              { date: day(3), type: 'Gelbe Tonne', icon: '' },
              { date: day(5), type: 'Weihnachtsbaum-Sammlung', icon: '' },
              { date: day(6), type: 'Mysterytonne', icon: '' },
              { date: day(400), type: 'Restabfall', icon: '' },
            ],
          }),
        );
      }
      if (req.url.startsWith('/search')) return res.end(JSON.stringify([{ id: 'x', title: 'Leipzig', source: 'stadtreinigung_leipzig_de', args_template: {} }]));
      if (req.url.startsWith('/source/stuttgart_de/options')) return res.end(JSON.stringify({ param: 'street', options: [{ value: 'Marktplatz M', label: 'Marktplatz M' }] }));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  });
  await new Promise((r) => sidecar.listen(0, '127.0.0.1', r));
  process.env.WASTECOLLECT_URL = `http://127.0.0.1:${sidecar.address().port}/`;
});
after(() => sidecar.close());

const settings = (extra) => applyDefaults(MODULE_TYPES.waste.fields, extra);

test('schema: wasteService value survives coercion, invalid values become null, secret for the mirror', () => {
  const service = { source: 'stadtreinigung_leipzig_de', title: 'Stadtreinigung Leipzig', args: { street: 'Hauptstraße', house_number: '7' }, labels: {} };
  const s = settings({ service });
  assert.deepEqual(s.service, service);
  assert.equal(settings({}).service, null);
  assert.equal(settings({ service: 'bsr_de' }).service, null);
  assert.equal(settings({ service: { source: '../etc' } }).service, null);
  assert.deepEqual(settings({ service: { source: 'bsr_de', args: 'x' } }).service, { source: 'bsr_de', title: 'bsr_de', args: {}, labels: {} });
  const pub = publicConfig({ modules: [{ type: 'waste', settings: s }] });
  assert.equal(pub.modules[0].settings.service, undefined);
});

test('provider: service entries are mapped onto the waste types like iCal entries and merged with manual intervals', async () => {
  calls = [];
  const s = settings({
    service: { source: 'fake_de', title: 'Fake', args: { street: 'Hauptstraße', _city: '12' } },
    manual: [{ type: 'Glass', startDate: day(2), intervalWeeks: 4 }],
    maxEntries: 10,
  });
  s.types.find((t) => t.name === 'Garden waste').enabled = false; // "baum" → hidden
  const data = await waste(s, cfg);
  assert.deepEqual(data.errors, []);
  const byDay = Object.fromEntries(data.days.map((d) => [d.date, d.items.map((i) => i.name)]));
  assert.deepEqual(byDay[day(1)], ['General waste', 'Organic waste']);
  assert.deepEqual(byDay[day(2)], ['Glass']);
  assert.deepEqual(byDay[day(3)], ['Recycling (yellow bag)']);
  assert.equal(byDay[day(5)], undefined); // disabled type
  assert.deepEqual(byDay[day(6)], ['Mysterytonne']); // unknown → shown with its own title
  assert.equal(byDay[day(400)], undefined); // outside daysAhead
  assert.equal(data.days.find((d) => d.date === day(1)).items[0].color, '#9ca3af');
  const fetchCall = calls.find((c) => c.url === '/fetch');
  assert.equal(fetchCall.body.source, 'fake_de');
  // second call is served from the cache
  await waste(s, cfg);
  assert.equal(calls.filter((c) => c.url === '/fetch').length, 1);
});

test('provider: errors from the sidecar end up in errors[], other sources still work', async () => {
  const s = settings({ service: { source: 'broken', title: 'Broken', args: { street: 'x' } }, manual: [{ type: 'Paper', startDate: day(0), intervalWeeks: 1 }] });
  const data = await waste(s, cfg);
  assert.equal(data.errors.length, 1);
  assert.match(data.errors[0], /^Broken: We could not find/);
  assert.ok(data.days.length > 0);
});

test('provider: unreachable sidecar gives a clear message', async () => {
  const url = process.env.WASTECOLLECT_URL;
  process.env.WASTECOLLECT_URL = 'http://127.0.0.1:1';
  try {
    const data = await waste(settings({ service: { source: 'other_de', title: 'Other', args: { a: '1' } } }), cfg);
    assert.deepEqual(data.errors, [`Other: ${WASTE_SERVICE_DOWN}`]);
  } finally {
    process.env.WASTECOLLECT_URL = url;
  }
});

test('admin router proxies search/options and reports a missing sidecar', async () => {
  const app = express();
  app.use('/waste', wasteAdminRouter());
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}/waste`;
  try {
    const found = await (await fetch(`${base}/search?q=Leipzig`)).json();
    assert.equal(found[0].title, 'Leipzig');
    assert.deepEqual(await (await fetch(`${base}/search?q=L`)).json(), []);
    const opts = await (await fetch(`${base}/options?source=stuttgart_de&param=street&q=Markt`)).json();
    assert.equal(opts.options[0].value, 'Marktplatz M');
    assert.equal((await fetch(`${base}/params?source=../x`)).status, 400);
    const bad = await fetch(`${base}/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'broken', args: {} }) });
    assert.equal(bad.status, 400);
    assert.deepEqual((await bad.json()).suggestions, ['Hauptstraße']);
    const url = process.env.WASTECOLLECT_URL;
    process.env.WASTECOLLECT_URL = 'http://127.0.0.1:1';
    const down = await fetch(`${base}/search?q=Leipzig`);
    process.env.WASTECOLLECT_URL = url;
    assert.equal(down.status, 503);
    assert.equal((await down.json()).error, WASTE_SERVICE_DOWN);
  } finally {
    srv.close();
  }
});
