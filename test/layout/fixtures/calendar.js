// Calendar (src/providers/calendar.js): { today, events, errors } – events sorted by start, at most
// maxEvents. Timed events: ISO instants; all-day events: "YYYY-MM-DD" with an exclusive end.
// No grid (list view is the default); with view week/month a grid with the same events is added.
import { iso, addMin, addDays, dayKey, LONG } from './index.js';

const TZ = 'Europe/Berlin';
const CAL = {
  family: { calendar: 'Familie', color: '#7dd3fc', icon: 'home' },
  work: { calendar: 'Arbeit', color: '#fbbf24', icon: 'work' },
  private: { calendar: 'Privat', color: '#c084fc', icon: 'calendar' },
  birthdays: { calendar: 'Geburtstage', color: '#f472b6', icon: 'cake' },
  holidays: { calendar: 'Feiertage', color: '#f87171', icon: 'flag' },
};

// local wall-clock time h:m on the day `n` days from now, as a Date
function at(now, n, h, m = 0) {
  const key = dayKey(addDays(now, n), TZ);
  const guess = new Date(`${key}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local - utc));
}

export default ({ now, settings = {}, long }) => {
  const today = dayKey(now, TZ);
  const day = (n) => dayKey(addDays(now, n), TZ);
  const q = new Date(Math.floor(now.getTime() / 900000) * 900000);
  const timed = (cal, title, start, durMin, location = '') => ({ allDay: false, start: iso(start), end: iso(addMin(start, durMin)), title, location, ...CAL[cal] });
  const allDay = (cal, title, from, days, location = '') => ({ allDay: true, start: day(from), end: day(from + days), title, location, ...CAL[cal] });

  let events;
  if (!long) {
    events = [
      allDay('private', 'Urlaub Ostsee', -1, 5, 'Warnemünde'),
      allDay('birthdays', 'Geburtstag Oma Gisela', 0, 1),
      timed('work', 'Team-Meeting', addMin(q, -30), 90, 'Büro, Raum 3.14'),
      timed('family', 'Zahnarzt Dr. Weber', addMin(q, 15), 45, 'Karl-Liebknecht-Straße 12, Leipzig'),
      timed('family', 'Yoga im Clara-Zetkin-Park', addMin(q, 180), 60, 'Clara-Zetkin-Park'),
      timed('work', 'Projekt-Review Q4', at(now, 1, 9, 30), 60, 'Microsoft Teams'),
      timed('family', 'Elternabend Kita', at(now, 1, 18), 90, 'Kita Sonnenschein, Gohlis'),
      allDay('private', 'Altpapier rausstellen', 2, 1),
      timed('private', 'Konzert Gewandhaus', at(now, 3, 20), 150, 'Gewandhaus zu Leipzig'),
      timed('family', 'TÜV Auto', at(now, 6, 8, 15), 60, 'DEKRA Leipzig-Nord'),
      allDay('holidays', 'Buß- und Bettag', 8, 1),
      timed('work', 'Weihnachtsfeier', at(now, 11, 19), 240, 'Moritzbastei'),
    ];
  } else {
    const titles = [
      `Jahreshauptversammlung des ${LONG}vereins Leipzig-Connewitz e. V. mit anschließender Neuwahl des Vorstands`,
      'Abstimmungstermin Projektlenkungsausschuss Digitalisierungsstrategie öffentliche Verwaltung Sachsen',
      'Ganztägige Fortbildungsveranstaltung „Arbeitssicherheit und Gesundheitsschutz am Bildschirmarbeitsplatz“',
      `Geburtstagsfeier von Großtante Hildegard ${LONG}`,
      'Kinderarzttermin U9-Vorsorgeuntersuchung mit Impfberatung und Sehtest',
    ];
    const cals = ['work', 'family', 'private', 'birthdays', 'family'];
    const loc = `Neues Rathaus, Martin-Luther-Ring 4–6, 04109 Leipzig, Festsaal im 2. Obergeschoss, ${LONG}`;
    const n = Math.max(settings.maxEvents || 10, 1);
    events = Array.from({ length: n }, (_, i) => {
      const title = titles[i % titles.length];
      if (i === 0) return allDay('private', `Mehrtägige Klassenfahrt nach ${LONG}`, -2, 7, loc);
      if (i === 1) return timed('work', title, addMin(q, -45), 180, loc);
      if (i % 4 === 0) return allDay(cals[i % 5], title, Math.floor(i / 2), 1, loc);
      return timed(cals[i % 5], title, at(now, Math.floor(i / 2), 7 + ((i * 3) % 13), (i * 15) % 60), 60 + i * 30, loc);
    });
  }
  // sort like the provider: by start (all-day events at the start of their day)
  const key = (e) => (e.allDay ? `${e.start}T00` : `${dayKey(new Date(e.start), TZ)}T1${new Date(e.start).getTime()}`);
  events = events.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).slice(0, settings.maxEvents || 10);
  const out = { today, events, errors: [] };
  if (settings.view === 'week' || settings.view === 'month') {
    out.grid = { from: day(-7), to: day(35), month: today.slice(0, 7), events: events.map(({ location, ...e }) => e) };
  }
  return out;
};
