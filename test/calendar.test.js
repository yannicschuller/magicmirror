import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { easterSunday, publicHolidays, publicHolidaysBetween } from '../src/providers/holidays.js';
import { calendar, filterEvents, parseBirthday, isBirthdayEvent, toBusy, selectAgenda, gridRange } from '../src/providers/calendar.js';
import { eventSpan, dayOfSpan, groupByDay, eventsOnDay } from '../public/shared/calendar-days.js';
import { MODULE_TYPES, applyDefaults, publicConfig, normalizeConfig, defaultConfig } from '../public/shared/modules.js';
import { translator } from '../public/shared/i18n.js';

const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const defaults = (over = {}) => applyDefaults(MODULE_TYPES.calendar.fields, over);

// ---- public holidays -----------------------------------------------------------------------

test('Easter Sunday', () => {
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
  assert.equal(easterSunday(2038), '2038-04-25');
});

test('nationwide holidays 2026 and 2027', () => {
  const dates = (y) => publicHolidays(y, '').map((h) => `${h.date} ${h.name}`);
  assert.deepEqual(dates(2026), [
    "2026-01-01 New Year's Day", '2026-04-03 Good Friday', '2026-04-06 Easter Monday', '2026-05-01 Labour Day',
    '2026-05-14 Ascension Day', '2026-05-25 Whit Monday', '2026-10-03 German Unity Day', '2026-12-25 Christmas Day', '2026-12-26 Boxing Day',
  ]);
  assert.deepEqual(dates(2027), [
    "2027-01-01 New Year's Day", '2027-03-26 Good Friday', '2027-03-29 Easter Monday', '2027-05-01 Labour Day',
    '2027-05-06 Ascension Day', '2027-05-17 Whit Monday', '2027-10-03 German Unity Day', '2027-12-25 Christmas Day', '2027-12-26 Boxing Day',
  ]);
});

test('state-specific holidays', () => {
  const has = (y, st, date, name) => publicHolidays(y, st).some((h) => h.date === date && h.name === name);
  const count = (y, st) => publicHolidays(y, st).length;
  // Counts per state (2026).
  const expected = { BW: 12, BY: 13, BE: 10, BB: 12, HB: 10, HH: 10, HE: 10, MV: 11, NI: 10, NW: 11, RP: 11, SL: 12, SN: 11, ST: 11, SH: 10, TH: 11 };
  for (const [st, n] of Object.entries(expected)) assert.equal(count(2026, st), n, st);

  assert.ok(has(2026, 'BW', '2026-01-06', 'Epiphany'));
  assert.ok(has(2026, 'BW', '2026-06-04', 'Corpus Christi'));
  assert.ok(has(2027, 'NW', '2027-05-27', 'Corpus Christi'));
  assert.ok(!has(2026, 'NI', '2026-06-04', 'Corpus Christi'));
  assert.ok(has(2026, 'BY', '2026-08-15', 'Assumption Day'));
  assert.ok(has(2026, 'SL', '2026-08-15', 'Assumption Day'));
  assert.ok(has(2026, 'BY', '2026-11-01', "All Saints' Day"));
  assert.ok(has(2026, 'SN', '2026-11-18', 'Day of Repentance and Prayer'));
  assert.ok(has(2027, 'SN', '2027-11-17', 'Day of Repentance and Prayer'));
  assert.ok(!has(2026, 'BY', '2026-11-18', 'Day of Repentance and Prayer'));
  assert.ok(has(2026, 'BE', '2026-03-08', "International Women's Day"));
  assert.ok(has(2026, 'MV', '2026-03-08', "International Women's Day"));
  assert.ok(!has(2022, 'MV', '2022-03-08', "International Women's Day"), 'MV only since 2023');
  assert.ok(has(2026, 'TH', '2026-09-20', "World Children's Day"));
  assert.ok(has(2026, 'HH', '2026-10-31', 'Reformation Day'));
  assert.ok(!has(2017 + 0, 'HH', '2016-10-31', 'Reformation Day'));
  assert.ok(!has(2026, 'BW', '2026-10-31', 'Reformation Day'));
  assert.ok(has(2026, 'BB', '2026-04-05', 'Easter Sunday'));
  assert.ok(has(2027, 'BB', '2027-05-16', 'Whit Sunday'));
  assert.ok(!publicHolidays(2026, 'BY').some((h) => h.date.endsWith('-08-08')), 'Augsburger Friedensfest skipped');
});

test('holidays between two dates span years', () => {
  const list = publicHolidaysBetween('2026-12-20', '2027-01-10', 'BW');
  assert.deepEqual(list.map((h) => h.date), ['2026-12-25', '2026-12-26', '2027-01-01', '2027-01-06']);
});

// ---- birthdays -----------------------------------------------------------------------------

test('birthday year parsing', () => {
  assert.deepEqual(parseBirthday('Anna (1994)', '', 2026), { name: 'Anna', age: 32 });
  assert.deepEqual(parseBirthday('Anna *1994', '', 2026), { name: 'Anna', age: 32 });
  assert.deepEqual(parseBirthday('Geburtstag Anna 1994', '', 2026), { name: 'Anna', age: 32 });
  assert.deepEqual(parseBirthday('Geburtstag von Tom (1980)', '', 2027), { name: 'Tom', age: 47 });
  assert.deepEqual(parseBirthday("Max's birthday", 'born 1990 in Ulm', 2026), { name: 'Max', age: 36 });
  assert.deepEqual(parseBirthday('Oma Erika [geb. 1941]', '', 2026), { name: 'Oma Erika', age: 85 });
  assert.equal(parseBirthday('Anna', '', 2026), null, 'no year');
  assert.equal(parseBirthday('Party 2026', '', 2026), null, 'age 0');
  assert.equal(parseBirthday('Anna 1850', '', 2026), null, 'before 1900');
  assert.equal(parseBirthday('Anna 2030', '', 2026), null, 'future year');
  assert.equal(parseBirthday('Raum 19945', '', 2026), null, 'part of a longer number');
});

test('birthday detection via calendar flag or cake keyword rule', () => {
  const rules = defaults().iconRules;
  assert.ok(isBirthdayEvent({ title: 'Geburtstag Anna' }, {}, rules));
  assert.ok(isBirthdayEvent({ title: 'Anna' }, { birthdays: true }, rules));
  assert.ok(!isBirthdayEvent({ title: 'Zahnarzt 2020' }, {}, rules));
});

// ---- filters & privacy -----------------------------------------------------------------------

test('keyword, all-day, cancelled and private filters', () => {
  const evs = [
    { title: 'Team Meeting', allDay: false, status: '', privacy: '' },
    { title: 'Rufbereitschaft', allDay: false, status: '', privacy: '' },
    { title: 'Urlaub', allDay: true, status: '', privacy: '' },
    { title: 'Abgesagt', allDay: false, status: 'CANCELLED', privacy: '' },
    { title: 'Geheim', allDay: false, status: '', privacy: 'PRIVATE' },
    { title: 'Vertraulich', allDay: false, status: '', privacy: 'CONFIDENTIAL' },
  ];
  const titles = (s) => filterEvents(evs, defaults(s)).map((e) => e.title);
  assert.deepEqual(titles({}), ['Team Meeting', 'Rufbereitschaft', 'Urlaub', 'Geheim', 'Vertraulich'], 'cancelled hidden by default');
  assert.deepEqual(titles({ hideCancelled: false }).length, 6);
  assert.deepEqual(titles({ excludeKeywords: 'ruf, URLAUB' }), ['Team Meeting', 'Geheim', 'Vertraulich']);
  assert.deepEqual(titles({ includeKeywords: 'meeting' }), ['Team Meeting']);
  assert.deepEqual(titles({ hideAllDay: true, hidePrivate: true }), ['Team Meeting', 'Rufbereitschaft']);
});

test('busy-only keeps only the timing', () => {
  const e = toBusy({ title: 'Arzt', location: 'Praxis', description: 'x', allDay: false, start: 'a', end: 'b', status: '', privacy: '' }, translator('de'));
  assert.deepEqual(e, { allDay: false, start: 'a', end: 'b', title: 'Termin', location: '' });
});

// ---- multi-day helpers -----------------------------------------------------------------------

test('multi-day events: span, "day x of y" and grouping', () => {
  const trip = { allDay: true, start: '2026-10-25', end: '2026-10-30' }; // 25.–29.
  assert.deepEqual(eventSpan(trip, dayKey), { first: '2026-10-25', last: '2026-10-29' });
  assert.deepEqual(dayOfSpan(trip, '2026-10-27', dayKey), { day: 3, days: 5 });
  assert.equal(dayOfSpan({ allDay: true, start: '2026-10-27', end: '2026-10-28' }, '2026-10-27', dayKey), null);
  const night = { allDay: false, start: '2026-10-27T20:00:00Z', end: '2026-10-28T06:00:00Z' };
  assert.deepEqual(dayOfSpan(night, '2026-10-28', dayKey), { day: 2, days: 2 });
  const untilMidnight = { allDay: false, start: '2026-10-27T17:00:00Z', end: '2026-10-27T23:00:00Z' }; // 18:00–00:00 CET
  assert.equal(dayOfSpan(untilMidnight, '2026-10-27', dayKey), null, 'ending at midnight is one day');

  const groups = groupByDay([trip, { allDay: false, start: '2026-10-28T09:00:00Z' }], '2026-10-27', dayKey);
  assert.deepEqual([...groups.keys()], ['2026-10-27', '2026-10-28'], 'running trip shown once, today');
  assert.equal(groups.get('2026-10-27')[0], trip);
  assert.equal(eventsOnDay([trip], '2026-10-29', dayKey).length, 1);
  assert.equal(eventsOnDay([trip], '2026-10-30', dayKey).length, 0);
});

test('grid ranges for week and month', () => {
  assert.deepEqual(gridRange({ view: 'week', weekStart: 'monday' }, '2026-10-29'), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(gridRange({ view: 'week', weekStart: 'today' }, '2026-10-29'), { from: '2026-10-29', to: '2026-11-04' });
  assert.deepEqual(gridRange({ view: 'month' }, '2026-10-29'), { from: '2026-09-28', to: '2026-11-01', month: '2026-10' });
  assert.equal(gridRange({ view: 'list' }, '2026-10-29'), null);
});

test('holidays can be excluded from the max. events count', () => {
  const now = new Date('2026-12-20T08:00:00Z');
  const evs = [
    { allDay: false, start: '2026-12-21T09:00:00Z', title: 'A' },
    { allDay: false, start: '2026-12-28T09:00:00Z', title: 'B' },
    { allDay: true, start: '2026-12-25', end: '2026-12-26', title: 'X-mas', kind: 'holiday' },
    { allDay: true, start: '2027-01-01', end: '2027-01-02', title: 'New Year', kind: 'holiday' },
  ];
  const opts = { now, today: '2026-12-20', agendaTo: '2027-01-03', dayKey };
  assert.deepEqual(selectAgenda(evs, defaults({ maxEvents: 2 }), opts).map((e) => e.title), ['A', 'X-mas']);
  assert.deepEqual(selectAgenda(evs, defaults({ maxEvents: 2, holidaysCountTowardsMax: false }), opts).map((e) => e.title), ['A', 'X-mas', 'B']);
});

// ---- provider end to end (local ICS server, no network) -----------------------------------------

const ymd = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
const vevent = (lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const ics = (events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const FEEDS = {
  '/main.ics': () => ics([
    vevent(['UID:m1', `DTSTART:${ymd(1)}T090000Z`, `DTEND:${ymd(1)}T100000Z`, 'SUMMARY:Meeting', 'LOCATION:Büro']),
    vevent(['UID:m2', `DTSTART:${ymd(1)}T110000Z`, `DTEND:${ymd(1)}T120000Z`, 'SUMMARY:Abgesagt', 'STATUS:CANCELLED']),
    vevent(['UID:m3', `DTSTART:${ymd(2)}T110000Z`, `DTEND:${ymd(2)}T120000Z`, 'SUMMARY:Geheim', 'CLASS:PRIVATE']),
    vevent(['UID:m4', `DTSTART;VALUE=DATE:${ymd(3)}`, `DTEND;VALUE=DATE:${ymd(4)}`, 'SUMMARY:Geburtstag Anna (1994)']),
    vevent(['UID:m5', `DTSTART:${ymd(10)}T090000Z`, `DTEND:${ymd(10)}T100000Z`, 'SUMMARY:Später']),
  ]),
  '/busy.ics': () => ics([
    vevent(['UID:b1', `DTSTART:${ymd(2)}T080000Z`, `DTEND:${ymd(2)}T090000Z`, 'SUMMARY:Psychotherapie Dr. Geheim', 'LOCATION:Geheimstraße 1', 'DESCRIPTION:streng vertraulich']),
  ]),
};
let server;
let base;
before(async () => {
  server = http.createServer((req, res) => {
    const feed = FEEDS[req.url];
    if (!feed) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/calendar' }).end(feed());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const cfg = { general: { timezone: 'Europe/Berlin', locale: 'de-DE' } };

test('provider: filters, birthdays, busy-only, per-calendar days and holidays', async () => {
  const s = defaults({
    calendars: [
      { name: 'Main', url: `${base}/main.ics`, color: '#0af', enabled: true, daysAhead: 5 },
      { name: 'Therapie', url: `${base}/busy.ics`, color: '#f0a', enabled: true, busyOnly: true },
    ],
    hidePrivate: true,
    birthdayAge: true,
    showPublicHolidays: true,
    holidayState: 'BW',
    daysAhead: 30,
    maxEvents: 50,
  });
  const res = await calendar(s, cfg);
  assert.deepEqual(res.errors, []);
  const titles = res.events.filter((e) => !e.kind).map((e) => e.title);
  assert.deepEqual(titles, ['Meeting', 'Termin', 'Anna'], 'cancelled, private and >5 days filtered');
  const anna = res.events.find((e) => e.title === 'Anna');
  assert.equal(anna.birthday.age, Number(ymd(3).slice(0, 4)) - 1994);
  const json = JSON.stringify(res);
  for (const secret of ['Psychotherapie', 'Geheimstraße', 'vertraulich']) assert.ok(!json.includes(secret), `${secret} must not leave the server`);
  assert.ok(!res.events.some((e) => 'description' in e));
  const expected = publicHolidaysBetween(res.today, dayKey(new Date(Date.now() + 30 * 86400000)), 'BW').map((h) => h.date);
  const shown = res.events.filter((e) => e.kind === 'holiday');
  assert.deepEqual(shown.map((e) => e.start), expected);
  assert.ok(shown.every((e) => e.calendar === 'Feiertage' && e.icon === 'flag' && e.allDay));
  assert.equal(res.grid, undefined, 'no grid in list view');
});

test('provider: month view returns grid events beyond max. events', async () => {
  const s = defaults({ calendars: [{ name: 'Main', url: `${base}/main.ics`, color: '#0af', enabled: true }], view: 'month', maxEvents: 1, showPublicHolidays: true, holidayState: 'BY' });
  const res = await calendar(s, cfg);
  assert.equal(res.events.length, 1);
  assert.ok(res.grid.from <= res.today && res.grid.to >= res.today);
  const inMonth = (await calendar(defaults({ ...s, view: 'list', maxEvents: 50, daysAhead: 365 }), cfg)).events.filter((e) => eventSpan(e, dayKey).first <= res.grid.to);
  assert.ok(res.grid.events.length >= Math.min(inMonth.length, 2));
  assert.ok(res.grid.events.every((e) => !('location' in e)));
});

// ---- schema compatibility ----------------------------------------------------------------------

test('existing calendar settings keep their values and get the new defaults', () => {
  const old = { calendars: [{ name: 'Privat', url: 'https://secret.example/x.ics', color: '#fff', icon: 'heart', enabled: true }], style: 'bar', daysAhead: 7, maxEvents: 5 };
  const cfgIn = defaultConfig('de-DE');
  cfgIn.modules.find((m) => m.type === 'calendar').settings = old;
  const norm = normalizeConfig(cfgIn);
  const s = norm.modules.find((m) => m.type === 'calendar').settings;
  assert.equal(s.style, 'bar');
  assert.equal(s.view, 'list');
  assert.equal(s.calendars[0].busyOnly, false);
  assert.equal(s.calendars[0].daysAhead, 0);
  assert.equal(s.showPublicHolidays, false);
  assert.ok(!JSON.stringify(publicConfig(norm)).includes('secret.example'));
});
