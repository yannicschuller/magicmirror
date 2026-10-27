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
