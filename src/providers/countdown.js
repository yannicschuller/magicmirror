// Countdown – nothing to fetch: the mirror computes everything from the settings.
// This only hands the events back as module data so the "only show when an
// event is coming up" condition (public/shared/conditions.js) has something to test.

export async function provider(settings) {
  const events = (settings.events || [])
    .filter((e) => e && e.enabled !== false && e.date)
    .map(({ name, date, time, repeat }) => ({ name, date, time, repeat }));
  return { events, withinDays: settings.withinDays || 0 };
}
