// "Only show when …": per module type, decides from the module's data whether there
// is something worth showing right now. Used by the mirror (hide/show) and the admin
// (which modules offer the option + its label). Pure functions – tested in Node.

const dayKey = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const HOUR = 3600 * 1000;

export const CONDITIONS = {
  tasks: {
    label: 'Only show when there are open tasks',
    test: (d) => (d.items?.length || 0) > 0,
  },
  calendar: {
    label: 'Only show when events are coming up',
    test: (d) => (d.events?.length || 0) > 0 || !!d.travel,
  },
  waste: {
    label: 'Only show when a collection is coming up (within "days ahead")',
    test: (d) => (d.days || []).some((x) => !x.past),
  },
  transit: {
    label: 'Only show when departures are listed',
    test: (d) => !d.needsSetup && (d.departures?.length || 0) > 0,
  },
  flights: {
    label: 'Only show when an aircraft is nearby',
    test: (d) => (d.spotlight ? true : (d.aircraft || []).some((a) => !a.ground)),
  },
  news: {
    label: 'Only show when there are headlines',
    test: (d) => (d.items?.length || 0) > 0,
  },
  homeassistant: {
    label: 'Only show when at least one entity is shown',
    test: (d) => !d.hidden && (d.entities?.length || 0) > 0,
  },
  weather_hints: {
    label: 'Only show when there is a hint',
    test: (d) => (d.hints || []).some((h) => h.level !== 'ok'),
  },
  f1: {
    label: 'Only show on race weekends (from 2 days before the first session)',
    test: (d, now) => {
      if (d.offseason || !d.sessions?.length) return false;
      const first = Math.min(...d.sessions.map((s) => Date.parse(s.start)));
      const last = Math.max(...d.sessions.map((s) => Date.parse(s.start)));
      return now.getTime() >= first - 48 * HOUR && now.getTime() <= last + 4 * HOUR;
    },
  },
  football: {
    label: 'Only show on match days (a match today or live)',
    test: (d, now, tz) => {
      const today = dayKey(now, tz);
      const matches = [...(d.matchday?.matches || []), ...(d.next || []), ...(d.team?.next || []), ...(d.team?.live ? [d.team.live] : [])];
      return matches.some((m) => m && (m.state === 'live' || (m.start && dayKey(new Date(m.start), tz) === today)));
    },
  },
};

// true = show the module. Without data yet, or for types without a condition: show.
export function moduleHasContent(type, data, now = new Date(), tz = 'Europe/Berlin') {
  const c = CONDITIONS[type];
  if (!c || !data) return true;
  try {
    return !!c.test(data, now, tz);
  } catch {
    return true;
  }
}
