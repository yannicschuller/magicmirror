import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { expandIcs } from '../src/providers/ical.js';
import { waste } from '../src/providers/waste.js';
import { calendar } from '../src/providers/calendar.js';
import { normalizeConfig, publicConfig, defaultConfig, MODULE_TYPES, GENERAL_FIELDS, REGIONS, applyDefaults } from '../public/shared/modules.js';
import { translator } from '../public/shared/i18n.js';
import de from '../public/shared/locales/de/index.js';

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
  }, translator('de'));
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

test('defaults follow the configured language', () => {
  const en = defaultConfig('en-GB');
  const deCfg = defaultConfig('de-DE');
  assert.deepEqual(en.pages.map((p) => p.name), ['Home', 'On the go']);
  assert.deepEqual(deCfg.pages.map((p) => p.name), ['Start', 'Unterwegs']);
  assert.equal(deCfg.modules.find((m) => m.type === 'waste').title, 'Müllabfuhr');
  // An existing German config keeps German defaults for newly added settings.
  const migrated = normalizeConfig({ general: { locale: 'de-AT' }, modules: [{ type: 'greeting' }] });
  assert.match(migrated.modules[0].settings.morning, /^Guten Morgen/);
});

test('every schema string has a German translation', () => {
  const missing = new Set();
  // Strings that read the same in both languages.
  const same = new Set(['0°', '180°', 'Bus', 'Countdown', 'Icon', 'Name', 'Person', 'S-Bahn', 'Sport', 'Stream', 'Streams', 'Text', 'Radius (km)',
    'VVS Stuttgart', 'VRR / NRW', 'Baden-Württemberg (bwegt / NVBW)', '°C, km/h, mm', '°F, mph, inch',
    'Deutsch (Deutschland)', 'Deutsch (Österreich)', 'Deutsch (Schweiz)', 'English (UK)', 'English (US)']);
  const check = (s) => s && /[a-z]/i.test(s) && !same.has(s) && !(s in de) && missing.add(s);
  const walk = (fields) => {
    for (const f of fields) {
      check(f.label);
      check(f.itemLabel);
      (f.options || []).forEach((o) => check(o.label));
      if (f.fields) walk(f.fields);
    }
  };
  for (const t of Object.values(MODULE_TYPES)) {
    check(t.label);
    check(t.description);
    check(t.defaultTitle);
    walk(t.fields);
  }
  walk(GENERAL_FIELDS);
  REGIONS.forEach((r) => check(r.label));
  assert.deepEqual([...missing], []);
});

test('old "use global location" switch is migrated', () => {
  const cfg = normalizeConfig({ modules: [
    { id: 'a', type: 'weather', settings: { useGlobalLocation: true, location: { name: 'Alt', lat: 1, lon: 2 } } },
    { id: 'b', type: 'weather', settings: { useGlobalLocation: false, location: { name: 'Hamburg', lat: 53.55, lon: 10 } } },
  ] });
  assert.equal(cfg.modules[0].settings.location, null);
  assert.equal(cfg.modules[1].settings.location.name, 'Hamburg');
  assert.ok(!('useGlobalLocation' in cfg.modules[1].settings));
});

test('module schedule: days, time window and windows past midnight', async () => {
  const { scheduleActive, normalizeSchedule } = await import('../public/shared/schedule.js');
  const at = (iso) => new Date(iso); // UTC; Berlin is UTC+1 in winter
  const weekdayMorning = normalizeSchedule({ enabled: true, days: [1, 2, 3, 4, 5], from: '06:00', to: '09:00' });
  assert.equal(scheduleActive(weekdayMorning, at('2026-11-02T06:30:00Z'), 'Europe/Berlin'), true); // Mon 07:30
  assert.equal(scheduleActive(weekdayMorning, at('2026-11-02T08:00:00Z'), 'Europe/Berlin'), false); // Mon 09:00
  assert.equal(scheduleActive(weekdayMorning, at('2026-11-01T06:30:00Z'), 'Europe/Berlin'), false); // Sun
  const night = normalizeSchedule({ enabled: true, days: [5], from: '22:00', to: '02:00' });
  assert.equal(scheduleActive(night, at('2026-11-06T22:30:00Z'), 'Europe/Berlin'), true); // Fri 23:30
  assert.equal(scheduleActive(night, at('2026-11-07T00:30:00Z'), 'Europe/Berlin'), true); // Sat 01:30 belongs to Fri
  assert.equal(scheduleActive(night, at('2026-11-08T00:30:00Z'), 'Europe/Berlin'), false); // Sun 01:30
  assert.equal(scheduleActive(normalizeSchedule(null), at('2026-11-08T00:30:00Z')), true);
  const cfg = normalizeConfig({ modules: [{ type: 'clock', height: 'fill', schedule: { enabled: true, days: [9, 2], from: 'x' } }] });
  assert.equal(cfg.modules[0].height, 'fill');
  assert.deepEqual(cfg.modules[0].schedule, { enabled: true, days: [2], from: '06:00', to: '09:00' });
});

test('page options: schedule, date range, exclusive and skip-empty', async () => {
  const { activePages } = await import('../public/shared/schedule.js');
  const cfg = normalizeConfig({
    general: { timezone: 'Europe/Berlin' },
    pages: [
      { id: 'home', name: 'Home' },
      { id: 'morning', name: 'Morning', exclusive: true, schedule: { enabled: true, days: [1, 2, 3, 4, 5], from: '06:00', to: '08:00' } },
      { id: 'xmas', name: 'Xmas', dateFrom: '2026-12-01', dateTo: '2026-12-26' },
      { id: 'transit', name: 'Transit' },
    ],
    modules: [
      { id: 'c', type: 'clock', pages: ['*'] },
      { id: 't', type: 'transit', pages: ['transit'], schedule: { enabled: true, days: [1, 2, 3, 4, 5], from: '06:00', to: '09:00' } },
    ],
  });
  const ids = (d) => activePages(cfg, new Date(d)).map((p) => p.id);
  assert.deepEqual(ids('2026-11-02T05:30:00Z'), ['morning']); // Mon 06:30 → exclusive morning page only
  assert.deepEqual(ids('2026-11-02T07:30:00Z'), ['home', 'transit']); // Mon 08:30 → morning over, transit module still on
  assert.deepEqual(ids('2026-11-02T08:30:00Z'), ['home']); // Mon 09:30 → transit page has nothing to show → skipped
  assert.deepEqual(ids('2026-12-24T10:00:00Z'), ['home', 'xmas']); // Thu: Christmas page in its date range
  assert.equal(cfg.pages[1].exclusive, true);
  assert.equal(cfg.pages[0].skipEmpty, true);
});

test('F1 track layout: GeoJSON line becomes a normalised SVG path', async () => {
  const { trackShape } = await import('../src/providers/f1.js');
  const shape = trackShape({ properties: { Name: 'Test', length: 4300, firstgp: 1990 }, geometry: { type: 'LineString', coordinates: [[10, 50], [10.02, 50], [10.02, 50.01], [10, 50.01]] } });
  assert.match(shape.d, /^M0\.0 77\.[0-9]L/); // first point = start/finish, north up
  assert.ok(shape.d.endsWith('Z'));
  assert.equal(shape.w, 100);
  assert.ok(shape.h > 0 && shape.h < 100);
  assert.deepEqual([shape.length, shape.firstGp], [4300, 1990]);
});
