import { expandIcs } from './ical.js';
import { dateKey } from '../util.js';

export async function calendar(settings, cfg) {
  const tz = cfg.general.timezone;
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600 * 1000);
  const to = new Date(now.getTime() + settings.daysAhead * 24 * 3600 * 1000);
  const today = dateKey(now, tz);
  const errors = [];
  const events = [];

  await Promise.all(
    settings.calendars
      .filter((c) => c.enabled && c.url)
      .map(async (c) => {
        try {
          const items = await expandIcs(c.url, from, to);
          for (const it of items) events.push({ ...it, description: undefined, calendar: c.name, color: c.color });
        } catch (err) {
          errors.push(`${c.name}: ${err.message}`);
        }
      }),
  );

  const upcoming = events
    .filter((e) => {
      if (e.allDay) return (e.end || e.start) > today || e.start >= today;
      return new Date(e.end || e.start) > now;
    })
    .sort((a, b) => {
      const ka = a.allDay ? `${a.start}T00:00:00.000Z` : a.start;
      const kb = b.allDay ? `${b.start}T00:00:00.000Z` : b.start;
      return ka.localeCompare(kb) || Number(b.allDay) - Number(a.allDay);
    })
    .slice(0, settings.maxEvents);

  return { today, events: upcoming, errors };
}
