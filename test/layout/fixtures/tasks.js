// Tasks (src/providers/tasks.js): { items: [{ ref, title, due, allDay, priority, overdue }], total, receivedAt, stale }.
// Sorted by due date (overdue first, no due date last), cut to maxItems; total counts all.
import { iso, addMin, addDays, dayKey, LONG } from './index.js';

const TZ = 'Europe/Berlin';

export default ({ now, settings = {}, long }) => {
  const day = (n) => dayKey(addDays(now, n), TZ);
  const q = new Date(Math.floor(now.getTime() / 900000) * 900000);
  const t = (title, due, allDay, priority = 0) => ({ title, due, allDay, priority });

  let all;
  if (!long) {
    all = [
      t('Steuererklärung abgeben', day(-23), true, 3),
      t('Rückruf Hausverwaltung', iso(addMin(q, -120)), false, 2),
      t('Rezept in der Apotheke abholen', day(0), true, 1),
      t('Paket zur Packstation bringen', iso(addMin(q, 150)), false),
      t('Geschenk für Oma Gisela besorgen', day(1), true, 2),
      t('Winterreifen wechseln lassen', iso(addMin(addDays(q, 2), 60)), false),
      t('GEZ-Lastschrift prüfen', day(5), true),
      t('Kita-Beitrag überweisen', day(9), true, 1),
      t('Milch', null, false),
      t('Haferflocken', null, false),
      t('Batterien AA', null, false),
      t('Glühbirne Flur', null, false),
    ];
  } else {
    const titles = [
      `Antrag auf Verlängerung der ${LONG}genehmigung beim Ordnungsamt einreichen`,
      'Kündigungsbestätigung des Fitnessstudio-Vertrags inklusive Sonderkündigungsrecht schriftlich anfordern',
      'Unterlagen für die Nebenkostenabrechnung 2025 sortieren, einscannen und an die Hausverwaltung schicken',
      'Bio-Vollkorn-Dinkel-Haferflocken-Großpackung (zartschmelzend, glutenreduziert)',
    ];
    all = Array.from({ length: 137 }, (_, i) => {
      const title = `${titles[i % titles.length]} (${i + 1})`;
      if (i % 5 === 4) return t(title, null, false, 3);
      if (i % 2) return t(title, iso(addMin(addDays(q, i - 40), 30)), false, i % 4);
      return t(title, day(i - 40 - 400 * (i === 0)), true, 3);
    });
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const dueKey = (i) => (i.due ? (i.allDay ? `${i.due}T99` : i.due) : '~');
  const isOverdue = (i) => (!i.due ? false : i.allDay ? i.due < day(0) : Date.parse(i.due) < now.getTime());
  if (settings.sort === 'priority') all.sort((a, b) => b.priority - a.priority || cmp(dueKey(a), dueKey(b)));
  else all.sort((a, b) => cmp(dueKey(a), dueKey(b)) || b.priority - a.priority);
  if (settings.overdue === 'last' || settings.overdue === 'hide') {
    const late = all.filter(isOverdue);
    all = [...all.filter((i) => !isOverdue(i)), ...(settings.overdue === 'last' ? late : [])];
  }
  const items = all.slice(0, settings.maxItems || 10).map((i, k) => ({ ref: `td:${8812040 + k}`, ...i, overdue: isOverdue(i) }));
  return { items, total: all.length, receivedAt: null, stale: false };
};
