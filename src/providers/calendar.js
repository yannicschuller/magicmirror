import IcalExpander from 'ical-expander';
import { cached, fetchText, dateKey } from '../util.js';
import { translator, langOf } from '../../public/shared/i18n.js';
import { DAY, addDays, eventSpan } from '../../public/shared/calendar-days.js';
import { publicHolidaysBetween, schoolHolidaysBetween } from './holidays.js';
import { resolveLocation } from '../../public/shared/modules.js';
import { computeTravel, geocode } from './route.js';

const GRID_LIMIT = 300;

// ---- ICS loading (same cache key as ical.js, so feeds are shared with other modules) -------

function normalizeUrl(url) {
  return String(url).trim().replace(/^webcals?:\/\//i, 'https://');
}

async function loadIcs(url) {
  return cached(`ics:${url}`, 600, () => fetchText(normalizeUrl(url), { timeout: 20000, headers: { Accept: 'text/calendar, */*' } }));
}

function toItem(src) {
  const allDay = src.startDate.isDate;
  const start = allDay ? src.startDate.toString().slice(0, 10) : src.startDate.toJSDate().toISOString();
  let end = null;
  if (src.endDate) end = allDay ? src.endDate.toString().slice(0, 10) : src.endDate.toJSDate().toISOString();
  return { allDay, start, end };
}

const prop = (ev, name) => String(ev.component?.getFirstPropertyValue(name) || '').toUpperCase();

// Like expandIcs() in ical.js, plus STATUS and CLASS for the filters.
export function expandCalendarIcs(ics, from, to) {
  const expander = new IcalExpander({ ics, maxIterations: 5000, skipInvalidDates: true });
  const { events, occurrences } = expander.between(from, to);
  const items = [];
  const push = (ev, src) => items.push({
    title: ev.summary || '',
    location: ev.location || '',
    description: ev.description || '',
    status: prop(ev, 'status'),
    privacy: prop(ev, 'class'),
    ...toItem(src),
  });
  for (const e of events) push(e, e);
  for (const o of occurrences) push(o.item, o);
  return items;
}

// ---- pure helpers (exported for tests) ---------------------------------------------------------

export const keywordList = (text) => String(text || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);

// Keyword / all-day / status / privacy filters. Holidays are never filtered here.
export function filterEvents(events, s) {
  const exclude = keywordList(s.excludeKeywords);
  const include = keywordList(s.includeKeywords);
  return events.filter((e) => {
    const title = e.title.toLowerCase();
    if (exclude.some((k) => title.includes(k))) return false;
    if (include.length && !include.some((k) => title.includes(k))) return false;
    if (s.hideAllDay && e.allDay) return false;
    if (s.hideCancelled && e.status === 'CANCELLED') return false;
    if (s.hidePrivate && (e.privacy === 'PRIVATE' || e.privacy === 'CONFIDENTIAL')) return false;
    return true;
  });
}

// Strips everything but the timing of a "busy only" calendar's event.
export function toBusy(e, t) {
  return { allDay: e.allDay, start: e.start, end: e.end, title: t('Busy'), location: '' };
}

export function isBirthdayEvent(e, cal, iconRules = []) {
  if (cal?.birthdays) return true;
  const title = e.title.toLowerCase();
  return iconRules.some((r) => r.icon === 'cake' && keywordList(r.keywords).some((k) => title.includes(k)));
}

const BIRTH_WORDS = /\b(geburtstag|birthday|bday|b-day)\b/gi;
const EDGE = /^[\s:,;\-–—|/]+|[\s:,;\-–—|/]+$/g;

// Year of birth in title/description → { name, age } (name = title without year
// and birthday words); null if no plausible year is found.
export function parseBirthday(title, description, eventYear) {
  const re = /(?:^|[^\d])((?:19|20)\d{2})(?!\d)/g;
  const find = (text) => {
    for (const m of String(text || '').matchAll(re)) {
      const y = Number(m[1]);
      if (y >= 1900 && y <= eventYear) return y;
    }
    return null;
  };
  let year = find(title);
  let name = String(title || '');
  if (year) {
    name = name.replace(new RegExp(`\\s*[(\\[]?\\s*(?:\\*|geb\\.?|born|b\\.)?\\s*${year}\\s*[)\\]]?`, 'i'), ' ');
  } else {
    year = find(description);
  }
  if (!year) return null;
  const age = eventYear - year;
  if (age < 1 || age > 130) return null;
  name = name.replace(BIRTH_WORDS, ' ').replace(/\s{2,}/g, ' ').replace(EDGE, '');
  name = name.replace(/^(von|of|from)\s+/i, '').replace(/['’]s$/i, '').replace(EDGE, '').trim();
  return { name: name || String(title || '').replace(String(year), '').replace(EDGE, '').trim(), age };
}

const sortKey = (e) => (e.allDay ? `${e.start}T00:00:00.000Z` : e.start);
const byStart = (a, b) => sortKey(a).localeCompare(sortKey(b)) || Number(b.allDay) - Number(a.allDay);

// Day range of the week/month grid (inclusive) or null for the list view.
export function gridRange(s, today) {
  const weekday = (key) => (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  if (s.view === 'week') {
    const from = s.weekStart === 'today' ? today : addDays(today, -weekday(today));
    return { from, to: addDays(from, 6) };
  }
  if (s.view === 'month') {
    const first = `${today.slice(0, 7)}-01`;
    const [y, m] = today.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from: addDays(first, -weekday(first)), to: addDays(last, 6 - weekday(last)), month: today.slice(0, 7) };
  }
  return null;
}

// Picks the agenda events: upcoming, sorted, limited to maxEvents (holidays optionally extra).
export function selectAgenda(events, s, { now, today, agendaTo, dayKey }) {
  const sorted = events
    .filter((e) => (e.allDay ? (e.end || e.start) > today || e.start >= today : new Date(e.end || e.start) > now))
    .sort(byStart);
  if (s.holidaysCountTowardsMax) return sorted.slice(0, s.maxEvents);
  const regular = sorted.filter((e) => !e.kind).slice(0, s.maxEvents);
  const lastDay = regular.length === s.maxEvents ? eventSpan(regular[regular.length - 1], dayKey).first : agendaTo;
  const holidays = sorted.filter((e) => e.kind && e.start <= lastDay);
  return [...regular, ...holidays].sort(byStart);
}

// ---- provider ----------------------------------------------------------------------------------

export async function calendar(settings, cfg) {
  const s = settings;
  const tz = cfg.general.timezone;
  const lang = langOf(cfg.general.locale);
  const t = translator(lang);
  const dayKey = (d) => dateKey(d, tz);
  const now = new Date();
  const today = dayKey(now);
  const grid = gridRange(s, today);
  const agendaTo = dayKey(new Date(now.getTime() + s.daysAhead * DAY));
  const from = new Date(Math.min(now.getTime() - DAY, grid ? Date.parse(`${grid.from}T00:00:00Z`) - DAY : Infinity));
  const gridEnd = grid ? Date.parse(`${grid.to}T00:00:00Z`) + 2 * DAY : 0;
  const errors = [];
  const agenda = [];
  const gridEvents = [];
  const travelEvents = []; // timed events with a place (never from busy-only calendars)

  const inGrid = (e) => {
    if (!grid) return false;
    const { first, last } = eventSpan(e, dayKey);
    return first <= grid.to && last >= grid.from;
  };

  await Promise.all(
    s.calendars
      .filter((c) => c.enabled && c.url)
      .map(async (c) => {
        try {
          const days = c.daysAhead > 0 ? c.daysAhead : s.daysAhead;
          const until = new Date(now.getTime() + days * DAY);
          const untilKey = dayKey(until);
          const ics = await loadIcs(c.url);
          const items = filterEvents(expandCalendarIcs(ics, from, new Date(Math.max(until.getTime(), gridEnd))), s);
          for (const it of items) {
            if (s.travelCard && !c.busyOnly && !it.allDay && it.location && it.status !== 'CANCELLED') {
              travelEvents.push({ title: it.title, location: it.location, start: it.start, allDay: false });
            }
            let e = c.busyOnly ? toBusy(it, t) : { allDay: it.allDay, start: it.start, end: it.end, title: it.title, location: it.location };
            if (!c.busyOnly && s.birthdayAge && isBirthdayEvent(it, c, s.iconRules)) {
              const year = Number((it.allDay ? it.start : dayKey(new Date(it.start))).slice(0, 4));
              const b = parseBirthday(it.title, it.description, year);
              if (b) e = { ...e, title: b.name, birthday: { age: b.age } };
            }
            e = { ...e, calendar: c.name, color: c.color, icon: c.icon };
            const inWindow = e.allDay ? e.start <= untilKey : new Date(e.start) < until;
            if (inWindow) agenda.push(e);
            // Per-calendar "days ahead" also limits the grid; the module setting does not.
            if (inGrid(e) && (c.daysAhead > 0 ? inWindow : true)) gridEvents.push(e);
          }
        } catch (err) {
          errors.push(`${c.name}: ${err.message}`);
        }
      }),
  );

  // ---- holidays
  const holFrom = grid && grid.from < today ? grid.from : today;
  const holTo = grid && grid.to > agendaTo ? grid.to : agendaTo;
  const holidays = [];
  if (s.showPublicHolidays) {
    for (const h of publicHolidaysBetween(holFrom, holTo, s.holidayState, s.holidayCountry)) {
      holidays.push({ allDay: true, start: h.date, end: addDays(h.date, 1), title: t(h.name), location: '', calendar: t('Public holidays'), color: s.publicHolidayColor, icon: s.publicHolidayIcon, kind: 'holiday' });
    }
  }
  if (s.showSchoolHolidays && s.holidayState) {
    try {
      const publicDays = new Set(holidays.map((h) => h.start));
      for (const h of await schoolHolidaysBetween(holFrom, holTo, s.holidayState, { country: s.holidayCountry, lang })) {
        if (addDays(h.start, 1) === h.end && publicDays.has(h.start)) continue; // already a public holiday
        holidays.push({ allDay: true, start: h.start, end: h.end, title: h.name || t('School holidays'), location: '', calendar: t('School holidays'), color: s.schoolHolidayColor, icon: s.schoolHolidayIcon, kind: 'school' });
      }
    } catch (err) {
      // Public holidays and events keep working without the API.
      console.warn(`[calendar] school holidays unavailable: ${err.message}`);
    }
  }
  for (const h of holidays) {
    if (h.start <= agendaTo) agenda.push(h);
    if (inGrid(h)) gridEvents.push(h);
  }

  const events = selectAgenda(agenda, s, { now, today, agendaTo, dayKey });
  const out = { today, events, errors };
  if (s.travelCard && travelEvents.length) {
    try {
      const base = resolveLocation({ location: s.travelFrom }, cfg.general);
      const from = (s.travelFromAddress && (await geocode(s.travelFromAddress, { near: base, lang }))) || base;
      const travel = await computeTravel(travelEvents, s, from, { now, lang });
      if (travel) out.travel = travel;
    } catch (err) {
      console.warn(`[calendar] time to leave: ${err.message}`);
    }
  }
  if (grid) {
    out.grid = {
      from: grid.from,
      to: grid.to,
      month: grid.month,
      events: gridEvents.sort(byStart).slice(0, GRID_LIMIT).map(({ location, ...e }) => e),
    };
  }
  return out;
}
