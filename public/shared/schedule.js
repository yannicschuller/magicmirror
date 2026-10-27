// Module schedule: show a module only on certain weekdays / between two times
// (in the mirror's time zone). A window whose end is before its start runs
// past midnight, e.g. 22:00–06:00. Shared by the mirror and the tests.

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]; // ISO: 1 = Monday … 7 = Sunday

const minutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : null;
};

export function normalizeSchedule(s) {
  const src = s && typeof s === 'object' ? s : {};
  const days = Array.isArray(src.days) ? [...new Set(src.days.map(Number).filter((d) => WEEKDAYS.includes(d)))].sort() : [...WEEKDAYS];
  return {
    enabled: src.enabled === true,
    days: days.length ? days : [...WEEKDAYS],
    from: minutes(src.from) === null ? '06:00' : String(src.from).padStart(5, '0'),
    to: minutes(src.to) === null ? '09:00' : String(src.to).padStart(5, '0'),
  };
}

// Weekday (1–7) and minutes since midnight of `date` in time zone `tz`.
function localParts(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
  return { day, min: Number(p.hour) * 60 + Number(p.minute) };
}

export function scheduleActive(schedule, date = new Date(), tz = 'Europe/Berlin') {
  if (!schedule || !schedule.enabled) return true;
  const from = minutes(schedule.from);
  const to = minutes(schedule.to);
  const { day, min } = localParts(date, tz);
  if (from === null || to === null || from === to) return schedule.days.includes(day);
  if (from < to) return schedule.days.includes(day) && min >= from && min < to;
  // Over midnight: the part after midnight belongs to the previous day's window.
  if (min >= from) return schedule.days.includes(day);
  const prev = day === 1 ? 7 : day - 1;
  return min < to && schedule.days.includes(prev);
}

// Calendar date (YYYY-MM-DD) of `date` in time zone `tz`.
export function dateKeyIn(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Inclusive date range; an empty bound is open (e.g. only "until 2026-12-24").
export function dateRangeActive(from, to, date = new Date(), tz = 'Europe/Berlin') {
  if (!from && !to) return true;
  const key = dateKeyIn(date, tz);
  return (!from || key >= from) && (!to || key <= to);
}

const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Page options: schedule, date range, exclusive (while active only these pages
// rotate) and skipEmpty (skip when all of its own modules are hidden – by their schedules or,
// on the mirror, by their "only show when …" condition).
export function normalizePageOptions(p) {
  return {
    schedule: normalizeSchedule(p.schedule),
    dateFrom: isDateKey(p.dateFrom) ? p.dateFrom : '',
    dateTo: isDateKey(p.dateTo) ? p.dateTo : '',
    exclusive: p.exclusive === true,
    skipEmpty: p.skipEmpty !== false,
    // only rotate while this module has something to show (its "only show when …" condition)
    showWhen: typeof p.showWhen === 'string' ? p.showWhen : '',
    // animated background with the current weather: off / subtle / full
    ambient: ['subtle', 'full'].includes(p.ambient) ? p.ambient : 'off',
  };
}

// Pages that should rotate right now.
// hiddenByContent(module) → true while the module's "only show when …" condition is not met;
// hasContent(moduleId) → whether that module currently has something to show (page "showWhen").
export function activePages(config, date = new Date(), hiddenByContent = () => false, hasContent = () => true) {
  const tz = config.general.timezone;
  const enabled = config.pages.filter((p) => p.enabled);
  const emptyPage = (p) => {
    const own = config.modules.filter((m) => m.enabled && !m.pages.includes('*') && m.pages.includes(p.id));
    return own.length > 0 && !own.some((m) => scheduleActive(m.schedule, date, tz) && !hiddenByContent(m));
  };
  let list = enabled.filter((p) => scheduleActive(p.schedule, date, tz) && dateRangeActive(p.dateFrom, p.dateTo, date, tz) && !(p.skipEmpty && emptyPage(p)) && (!p.showWhen || hasContent(p.showWhen)));
  const exclusive = list.filter((p) => p.exclusive);
  if (exclusive.length) list = exclusive;
  if (!list.length) list = (enabled.length ? enabled : config.pages).slice(0, 1);
  return list;
}
