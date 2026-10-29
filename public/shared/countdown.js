// Countdown date math – pure functions shared by the mirror renderer, the
// "only show when …" condition and the tests. Days are counted on calendar
// dates in the mirror's time zone (not 24 h blocks), so DST never shifts them.
import { tzOffset } from './astro.js';

const DAY = 86400000;
const keyFmts = new Map();

/** YYYY-MM-DD of `date` in time zone `tz`. */
export function dayKeyIn(date, tz) {
  if (!keyFmts.has(tz)) keyFmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return keyFmts.get(tz).format(date);
}

/** Whole calendar days from key `a` to key `b` (negative if b is earlier). */
export const keyDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad = (n) => String(n).padStart(2, '0');

/** "2026-12-24" → { y, m, d } or null. */
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** "18:30" → { h, min } or null. */
export function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return { h: Number(m[1]), min: Number(m[2]) };
}

/** Month/day in year `y`; 29 February falls back to the 28th in non-leap years. */
export function keyInYear(date, y) {
  const d = date.m === 2 && date.d === 29 && !isLeap(y) ? 28 : date.d;
  return `${y}-${pad(date.m)}-${pad(d)}`;
}

/** UTC instant of wall-clock time h:min on day `key` in `tz` (handles DST). */
export function zonedTime(key, h, min, tz) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - tzOffset(new Date(guess), tz);
  t = guess - tzOffset(new Date(t), tz); // second pass across a DST change
  return new Date(t);
}

/**
 * The relevant occurrence of one event relative to `todayKey`: the next one
 * for yearly events (today counts as next), the date itself for one-time
 * events (possibly in the past). null if the date is invalid.
 */
export function occurrence(ev, todayKey) {
  const date = parseDate(ev.date);
  if (!date) return null;
  if (ev.repeat !== 'yearly') return { key: keyInYear(date, date.y), years: null };
  let y = Number(todayKey.slice(0, 4));
  if (keyInYear(date, y) < todayKey) y++;
  // An occurrence before the start year makes no sense (e.g. a date entered in the future).
  if (y < date.y) y = date.y;
  return { key: keyInYear(date, y), years: y - date.y };
}

/**
 * Upcoming (and optionally past) events at `now` in `tz`, as plain objects:
 * { name, icon, color, key, days, at (Date|null, if a time is set), years, yearly, past, index }.
 * opts: hidePast (default true), withinDays (0 = no limit), sort ('next' | 'list'), max.
 */
export function upcoming(events, now, tz, opts = {}) {
  const { hidePast = true, withinDays = 0, sort = 'next', max = 0 } = opts;
  const today = dayKeyIn(now, tz);
  const out = [];
  (events || []).forEach((ev, index) => {
    if (!ev || ev.enabled === false) return;
    const occ = occurrence(ev, today);
    if (!occ) return;
    const days = keyDiff(today, occ.key);
    const past = days < 0;
    if (past && hidePast) return;
    if (withinDays > 0 && days > withinDays) return;
    const time = parseTime(ev.time);
    out.push({
      name: String(ev.name || ''),
      icon: String(ev.icon || ''),
      color: String(ev.color || ''),
      key: occ.key,
      days,
      at: time ? zonedTime(occ.key, time.h, time.min, tz) : null,
      years: occ.years,
      yearsStyle: ev.years || 'none',
      yearly: ev.repeat === 'yearly',
      past,
      index,
    });
  });
  if (sort === 'next') {
    // Upcoming first (soonest first), past ones after them (most recent first).
    const rank = (x) => (x.past ? [1, -x.days] : [0, x.days]);
    out.sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)];
      return ra[0] - rb[0] || ra[1] - rb[1] || (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) || a.index - b.index;
    });
  }
  return max > 0 ? out.slice(0, max) : out;
}

/**
 * What is left until an item, independent of language:
 * { kind: 'days', days } | { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'ago', days }
 * | { kind: 'hours', h, m } (precise, under a day) | { kind: 'dayhours', d, h } (precise, under 2 days)
 * | { kind: 'now' } (precise, the time has passed today).
 * `precise` only matters for events with a time of day.
 */
export function remaining(item, now, precise = false) {
  if (item.past) return { kind: 'ago', days: -item.days };
  if (precise && item.at && item.days <= 2) {
    const ms = item.at.getTime() - now.getTime();
    if (ms <= 0) return item.days === 0 ? { kind: 'now' } : { kind: 'today' };
    const totalMin = Math.ceil(ms / 60000);
    if (totalMin < 24 * 60) return { kind: 'hours', h: Math.floor(totalMin / 60), m: totalMin % 60 };
    if (totalMin < 48 * 60) return { kind: 'dayhours', d: 1, h: Math.floor((totalMin - 24 * 60) / 60) };
  }
  if (item.days === 0) return { kind: 'today' };
  if (item.days === 1) return { kind: 'tomorrow' };
  return { kind: 'days', days: item.days };
}

/** True if at least one event is coming up within `withinDays` (the module setting) – used by conditions. */
export function hasUpcoming(data, now, tz) {
  if (!data?.events) return false;
  return upcoming(data.events, now, tz, { hidePast: true, withinDays: data.withinDays || 0 }).length > 0;
}
