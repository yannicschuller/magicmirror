import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { occurrence, upcoming, remaining, zonedTime, keyDiff, dayKeyIn, hasUpcoming, parseTime } from '../public/shared/countdown.js';
import { provider } from '../src/providers/countdown.js';
import schema from '../public/shared/modules/countdown.js';
import de from '../public/shared/locales/de/modules/countdown.js';

const TZ = 'Europe/Berlin';
const at = (iso) => new Date(iso);

test('calendar-day difference ignores DST changes', () => {
  // 25 Oct 2026: clocks go back (CEST → CET); 29 Mar 2026: forward.
  assert.equal(keyDiff('2026-10-24', '2026-10-26'), 2);
  assert.equal(keyDiff('2026-03-28', '2026-03-30'), 2);
  // Shortly after local midnight on the DST day, 00:30 CEST = 22:30 UTC the day before.
  const now = at('2026-10-24T22:30:00Z');
  assert.equal(dayKeyIn(now, TZ), '2026-10-25');
  const [it] = upcoming([{ name: 'X', date: '2026-10-26' }], now, TZ);
  assert.equal(it.days, 1);
  // Late evening before the spring change: 23:30 CET = 22:30 UTC.
  const [sp] = upcoming([{ name: 'Y', date: '2026-03-30' }], at('2026-03-28T22:30:00Z'), TZ);
  assert.equal(sp.days, 2);
});

test('wall-clock time in the time zone, across DST', () => {
  assert.equal(zonedTime('2026-10-24', 12, 0, TZ).toISOString(), '2026-10-24T10:00:00.000Z'); // CEST
  assert.equal(zonedTime('2026-10-25', 12, 0, TZ).toISOString(), '2026-10-25T11:00:00.000Z'); // CET
  assert.equal(zonedTime('2026-03-29', 12, 0, TZ).toISOString(), '2026-03-29T10:00:00.000Z');
  assert.equal(zonedTime('2026-07-01', 9, 30, 'America/New_York').toISOString(), '2026-07-01T13:30:00.000Z');
  // Precise countdown over the October change: 24 h wall clock = 25 h real time.
  const [it] = upcoming([{ name: 'X', date: '2026-10-25', time: '12:00' }], at('2026-10-24T10:00:00Z'), TZ);
  assert.deepEqual(remaining(it, at('2026-10-24T10:00:00Z'), true), { kind: 'dayhours', d: 1, h: 1 });
  assert.deepEqual(remaining(it, at('2026-10-24T10:00:00Z'), false), { kind: 'tomorrow' });
});

test('yearly events roll over and count years', () => {
  assert.deepEqual(occurrence({ date: '1990-03-05', repeat: 'yearly' }, '2026-10-29'), { key: '2027-03-05', years: 37 });
  assert.deepEqual(occurrence({ date: '1990-10-29', repeat: 'yearly' }, '2026-10-29'), { key: '2026-10-29', years: 36 });
  assert.deepEqual(occurrence({ date: '1990-10-28', repeat: 'yearly' }, '2026-10-29'), { key: '2027-10-28', years: 37 });
  assert.deepEqual(occurrence({ date: '2026-12-24', repeat: 'none' }, '2026-10-29'), { key: '2026-12-24', years: null });
  // A yearly date in the future starts in its own year.
  assert.deepEqual(occurrence({ date: '2028-05-01', repeat: 'yearly' }, '2026-10-29'), { key: '2028-05-01', years: 0 });
  assert.equal(occurrence({ date: 'nope' }, '2026-10-29'), null);
});

test('29 February falls on the 28th in non-leap years', () => {
  const ev = { date: '2000-02-29', repeat: 'yearly' };
  assert.deepEqual(occurrence(ev, '2026-10-29'), { key: '2027-02-28', years: 27 });
  assert.deepEqual(occurrence(ev, '2027-02-28'), { key: '2027-02-28', years: 27 });
  assert.deepEqual(occurrence(ev, '2027-03-01'), { key: '2028-02-29', years: 28 });
  assert.deepEqual(occurrence(ev, '2100-01-01'), { key: '2100-02-28', years: 100 }); // 2100 is no leap year
});

test('past one-time events disappear the day after', () => {
  const evs = [{ name: 'Party', date: '2026-10-29' }];
  const dayOf = at('2026-10-29T21:00:00Z'); // 22:00 CET
  assert.equal(upcoming(evs, dayOf, TZ)[0].days, 0);
  assert.deepEqual(remaining(upcoming(evs, dayOf, TZ)[0], dayOf), { kind: 'today' });
  const next = at('2026-10-29T23:30:00Z'); // 00:30 the next day
  assert.equal(upcoming(evs, next, TZ).length, 0);
  const shown = upcoming(evs, next, TZ, { hidePast: false });
  assert.equal(shown[0].past, true);
  assert.deepEqual(remaining(shown[0], next), { kind: 'ago', days: 1 });
});

test('time-of-day events: hours and minutes, then "now" on the day', () => {
  const evs = [{ name: 'Flight', date: '2026-10-30', time: '07:15' }];
  const now = at('2026-10-29T19:00:00Z'); // 20:00 CET
  const [it] = upcoming(evs, now, TZ);
  assert.equal(it.at.toISOString(), '2026-10-30T06:15:00.000Z');
  assert.deepEqual(remaining(it, now, true), { kind: 'hours', h: 11, m: 15 });
  assert.deepEqual(remaining(it, at('2026-10-30T06:10:30Z'), true), { kind: 'hours', h: 0, m: 5 });
  const after = at('2026-10-30T08:00:00Z');
  assert.deepEqual(remaining(upcoming(evs, after, TZ)[0], after, true), { kind: 'now' });
  // Without a time "precise" falls back to days.
  const [noTime] = upcoming([{ name: 'X', date: '2026-10-30' }], now, TZ);
  assert.deepEqual(remaining(noTime, now, true), { kind: 'tomorrow' });
  assert.deepEqual(remaining({ days: 12, past: false, at: null }, now, true), { kind: 'days', days: 12 });
  assert.equal(parseTime('24:00'), null);
});

test('sorting, limit, disabled entries and "show from N days before"', () => {
  const evs = [
    { name: 'Christmas', date: '2026-12-24' },
    { name: 'Anna', date: '1990-11-02', repeat: 'yearly' },
    { name: 'Off', date: '2026-11-01', enabled: false },
    { name: 'Bad', date: '' },
    { name: 'Trip', date: '2026-11-20' },
  ];
  const now = at('2026-10-29T10:00:00Z');
  assert.deepEqual(upcoming(evs, now, TZ).map((x) => x.name), ['Anna', 'Trip', 'Christmas']);
  assert.deepEqual(upcoming(evs, now, TZ, { sort: 'list' }).map((x) => x.name), ['Christmas', 'Anna', 'Trip']);
  assert.deepEqual(upcoming(evs, now, TZ, { max: 2 }).map((x) => x.name), ['Anna', 'Trip']);
  assert.deepEqual(upcoming(evs, now, TZ, { withinDays: 30 }).map((x) => x.name), ['Anna', 'Trip']);
  assert.deepEqual(upcoming(evs, now, TZ, { withinDays: 4 }).map((x) => x.name), ['Anna']);
});

test('provider + condition helper', async () => {
  const data = await provider({ withinDays: 10, events: [
    { name: 'A', date: '2026-11-20', time: '', repeat: 'none', icon: '🎉', color: '#fff', enabled: true },
    { name: 'B', date: '', enabled: true },
    { name: 'C', date: '2026-11-01', enabled: false },
  ] });
  assert.deepEqual(data, { events: [{ name: 'A', date: '2026-11-20', time: '', repeat: 'none' }], withinDays: 10 });
  assert.equal(hasUpcoming(data, at('2026-10-29T10:00:00Z'), TZ), false); // 22 days away
  assert.equal(hasUpcoming(data, at('2026-11-12T10:00:00Z'), TZ), true);
  assert.equal(hasUpcoming(data, at('2026-11-21T10:00:00Z'), TZ), false); // past
  assert.equal(hasUpcoming({ ...data, withinDays: 0 }, at('2026-10-29T10:00:00Z'), TZ), true);
  assert.equal(hasUpcoming({}, new Date(), TZ), false);
});

test('schema and German strings', () => {
  assert.equal(schema.type, 'countdown');
  const ids = [schema.label, schema.description, schema.defaultTitle];
  const walk = (fields) => fields.forEach((f) => {
    ids.push(f.label);
    if (f.help) ids.push(f.help);
    if (f.itemLabel) ids.push(f.itemLabel);
    if (f.placeholder && /[a-z]/i.test(f.placeholder)) ids.push(f.placeholder);
    for (const o of f.options || []) ids.push(o.label);
    if (f.fields) walk(f.fields);
  });
  walk(schema.fields);
  // Renderer strings: every t('…') literal.
  const src = readFileSync(new URL('../public/mirror/modules/countdown.js', import.meta.url), 'utf8');
  const core = new Set(['Today', 'Tomorrow', 'Yesterday']); // in the core mirror dictionary
  for (const m of src.matchAll(/\bt\('([^']+)'/g)) if (!core.has(m[1])) ids.push(m[1]);
  for (const id of ids) assert.ok(de[id], `missing German: ${id}`);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});
