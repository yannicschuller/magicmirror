// Day-key helpers for calendar events, shared by the server provider and the
// mirror renderer. Day keys are 'YYYY-MM-DD' strings in the mirror's time zone;
// all-day events carry day keys, timed events ISO timestamps. All-day `end`
// is exclusive (iCal semantics).

export const DAY = 86400000;

export function addDays(key, n) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

// Whole days from key a to key b.
export function keyDiff(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
}

// First and last day (inclusive) an event covers. dayKey(Date) → key in the mirror's zone.
export function eventSpan(e, dayKey) {
  if (e.allDay) {
    const last = e.end && e.end > e.start ? addDays(e.end, -1) : e.start;
    return { first: e.start, last };
  }
  const s = new Date(e.start);
  const end = e.end ? new Date(e.end) : s;
  const first = dayKey(s);
  const last = end > s ? dayKey(new Date(end.getTime() - 1)) : first;
  return { first, last: last < first ? first : last };
}

// { day, days } ("Day 2 of 5") for a multi-day event shown on `day`; null for single-day events.
export function dayOfSpan(e, day, dayKey) {
  const { first, last } = eventSpan(e, dayKey);
  const days = keyDiff(first, last) + 1;
  if (days < 2) return null;
  return { day: Math.min(days, Math.max(1, keyDiff(first, day) + 1)), days };
}

// Groups events by day for the agenda: each event appears once, on its start
// day – or today if it started earlier (running multi-day events).
export function groupByDay(events, today, dayKey) {
  const groups = new Map();
  for (const e of events) {
    let k = eventSpan(e, dayKey).first;
    if (k < today) k = today;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return groups;
}

// Events covering a given day (week/month grids).
export function eventsOnDay(events, day, dayKey) {
  return events.filter((e) => {
    const { first, last } = eventSpan(e, dayKey);
    return first <= day && last >= day;
  });
}
