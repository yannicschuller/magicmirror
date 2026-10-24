import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { expandIcs } from '../src/providers/ical.js';
import { waste } from '../src/providers/waste.js';
import { calendar } from '../src/providers/calendar.js';
import { normalizeConfig, publicConfig, defaultConfig, MODULE_TYPES, applyDefaults } from '../public/shared/modules.js';

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

// Weekly meeting 10:00 Europe/Berlin with one EXDATE and one moved occurrence,
// plus all-day waste pickups.
const ICS = () => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly@test
DTSTART;TZID=Europe/Berlin:${day(1)}T100000
DTEND;TZID=Europe/Berlin:${day(1)}T110000
RRULE:FREQ=WEEKLY;COUNT=6
EXDATE;TZID=Europe/Berlin:${day(8)}T100000
SUMMARY:Weekly
END:VEVENT
BEGIN:VEVENT
UID:weekly@test
RECURRENCE-ID;TZID=Europe/Berlin:${day(15)}T100000
DTSTART;TZID=Europe/Berlin:${day(15)}T140000
DTEND;TZID=Europe/Berlin:${day(15)}T150000
SUMMARY:Weekly (verschoben)
END:VEVENT
BEGIN:VEVENT
UID:bio@test
DTSTART;VALUE=DATE:${day(2)}
DTEND;VALUE=DATE:${day(3)}
SUMMARY:Biotonne
END:VEVENT
BEGIN:VEVENT
UID:gelb@test
DTSTART;VALUE=DATE:${day(2)}
DTEND;VALUE=DATE:${day(3)}
SUMMARY:Gelber Sack / Leichtverpackungen
END:VEVENT
BEGIN:VEVENT
UID:x@test
DTSTART;VALUE=DATE:${day(4)}
DTEND;VALUE=DATE:${day(5)}
SUMMARY:Weihnachtsbaum-Abholung Sonderaktion
END:VEVENT
END:VCALENDAR`;

let server;
let url;
before(async () => {
  server = http.createServer((req, res) => res.end(ICS()));
  await new Promise((r) => server.listen(0, r));
  url = `http://127.0.0.1:${server.address().port}/cal.ics`;
});
after(() => server.close());

const cfg = { general: { timezone: 'Europe/Berlin' } };

test('expands recurrences with EXDATE and moved occurrences', async () => {
  const items = await expandIcs(url, new Date(), new Date(Date.now() + 60 * 86400000));
  const weekly = items.filter((i) => i.title.startsWith('Weekly')).sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(weekly.length, 5, 'COUNT=6 minus one EXDATE');
  assert.ok(weekly.some((w) => w.title === 'Weekly (verschoben)'), 'recurrence exception used');
  for (const w of weekly.filter((x) => x.title === 'Weekly')) {
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date(w.start));
    assert.equal(hour, '10', `stays at 10:00 local across DST (${w.start})`);
  }
});

test('calendar returns sorted, limited events', async () => {
  const s = applyDefaults(MODULE_TYPES.calendar.fields, { calendars: [{ name: 'Test', url, color: '#f00', enabled: true }], maxEvents: 3 });
  const res = await calendar(s, cfg);
  assert.equal(res.events.length, 3);
  assert.deepEqual(res.errors, []);
  const starts = res.events.map((e) => (e.allDay ? `${e.start}T00:00` : e.start));
  assert.deepEqual([...starts].sort(), starts);
});

test('waste classifies by keywords and merges manual intervals', async () => {
  const s = applyDefaults(MODULE_TYPES.waste.fields, {
    sources: [{ name: 'Stadt', url }],
    manual: [{ type: 'Papier', startDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), intervalWeeks: 4 }],
    daysAhead: 10,
    showUnknown: false,
  });
  const res = await waste(s, cfg);
  const first = res.days[0];
  assert.deepEqual(first.items.map((i) => i.name).sort(), ['Biomüll', 'Gelber Sack', 'Papier']);
  assert.equal(res.days[1].items[0].name, 'Grünschnitt', 'Weihnachtsbaum matches "baum"');
});

test('normalizeConfig repairs broken input and keeps modules valid', () => {
  const cfg = normalizeConfig({
    pages: [{ id: 'a', name: 'A', duration: 1 }, { id: 'a', name: 'dup' }],
    modules: [
      { id: 'x', type: 'clock', region: 'nope', pages: ['missing'], settings: { showSeconds: 'true' } },
      { type: 'unknown' },
      { id: 'x', type: 'weather', pages: ['*', 'a'] },
    ],
  });
  assert.equal(cfg.pages.length, 2);
  assert.notEqual(cfg.pages[0].id, cfg.pages[1].id);
  assert.equal(cfg.pages[0].duration, 5);
  assert.equal(cfg.modules.length, 2);
  assert.equal(cfg.modules[0].region, 'top_left');
  assert.deepEqual(cfg.modules[0].pages, ['a']);
  assert.equal(cfg.modules[0].settings.showSeconds, true);
  assert.notEqual(cfg.modules[0].id, cfg.modules[1].id);
  assert.deepEqual(cfg.modules[1].pages, ['*']);
});

test('publicConfig strips secret URLs', () => {
  const cfg = defaultConfig();
  cfg.modules.find((m) => m.type === 'calendar').settings.calendars = [{ name: 'Privat', url: 'https://secret', color: '#fff', enabled: true }];
  cfg.modules.find((m) => m.type === 'camera').settings.streams = [{ name: 'Tür', url: 'rtsp://user:pw@cam', enabled: true }];
  const pub = JSON.stringify(publicConfig(normalizeConfig(cfg)));
  assert.ok(!pub.includes('https://secret'));
  assert.ok(!pub.includes('rtsp://'));
  assert.ok(pub.includes('Privat'));
});
