// Countdown (src/providers/countdown.js): { events, withinDays, contacts? }. The mirror computes the
// own events from the settings; the server adds birthdays/anniversaries from the address book
// (contacts) – those are what this fixture supplies, relative to now.
import { addDays, dayKey, LONG } from './index.js';

const TZ = 'Europe/Berlin';

export default ({ now, settings = {}, long }) => {
  const icon = settings.contactsIcon ?? '🎂';
  const color = settings.contactsColor || '#ffffff';
  const md = (n) => dayKey(addDays(now, n), TZ).slice(5); // "MM-DD", n days from today
  const bday = (name, n, year) => ({ name, date: `${year}-${md(n)}`, repeat: 'yearly', years: 'age', icon, color, fromContacts: true });
  const anniv = (name, n, year) => ({ name, date: `${year}-${md(n)}`, repeat: 'yearly', years: 'count', icon: '💍', color, fromContacts: true });

  let contacts;
  if (!long) {
    contacts = [
      bday('Oma Gisela', 0, 1941),
      bday('Jonas Krüger', 1, 1994),
      anniv('Lena & Tobias Weber', 6, 2015),
      bday('Mia', 12, 2019),
      bday('Frank Hoffmann', 38, 1968),
      bday('Sophie Lehmann', 70, 1990),
    ];
  } else {
    const names = [
      'Prof. Dr. Maximilian-Alexander Freiherr von Schönhausen-Wittgenstein',
      `Anna-Katharina ${LONG}`,
      'Großtante Hildegard Wilhelmine Müller-Lüdenscheidt aus Bad Lausick',
      'Familie Oberbürgermeister-Stellvertreterin Schulze-Brandenburg',
      'Kindergartengruppe „Kleine Entdecker“ der Kita Sonnenschein Leipzig-Gohlis',
    ];
    const n = Math.max(settings.maxItems || 5, 5) + 3;
    contacts = Array.from({ length: n }, (_, i) => (i % 4 === 3
      ? anniv(names[i % names.length], i * 2, 1926)
      : bday(names[i % names.length] + (i >= names.length ? ` (${i + 1})` : ''), i * 2, 1925 + i)));
  }
  const own = (settings.events || []).filter((e) => e && e.enabled !== false && e.date).map(({ name, date, time, repeat }) => ({ name, date, time, repeat }));
  return {
    events: [...own, ...contacts.map(({ name, date, repeat }) => ({ name, date, repeat }))],
    withinDays: settings.withinDays || 0,
    contacts,
  };
};
