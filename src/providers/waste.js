import { expandIcs, eventDay } from './ical.js';
import { dateKey, splitList } from '../util.js';

function addDays(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function waste(settings, cfg) {
  const tz = cfg.general.timezone;
  const now = new Date();
  const today = dateKey(now, tz);
  const last = addDays(today, settings.daysAhead);
  const types = settings.types.map((t) => ({ ...t, keys: splitList(t.keywords) }));
  const byName = new Map(types.map((t) => [t.name.toLowerCase(), t]));
  const days = new Map();
  const errors = [];

  const add = (day, item) => {
    if (day < today || day > last) return;
    if (!days.has(day)) days.set(day, []);
    const list = days.get(day);
    if (!list.some((i) => i.name === item.name)) list.push(item);
  };

  const classify = (title) => {
    const t = title.toLowerCase();
    return types.find((type) => type.keys.some((k) => t.includes(k)));
  };

  await Promise.all(
    settings.sources
      .filter((s) => s.url)
      .map(async (s) => {
        try {
          const items = await expandIcs(s.url, new Date(now.getTime() - 86400000), new Date(now.getTime() + (settings.daysAhead + 1) * 86400000));
          for (const it of items) {
            const type = classify(it.title);
            if (type) {
              if (type.enabled) add(eventDay(it, tz), { name: type.name, color: type.color });
            } else if (settings.showUnknown && it.title) {
              add(eventDay(it, tz), { name: it.title, color: '#9ca3af' });
            }
          }
        } catch (err) {
          errors.push(`${s.name}: ${err.message}`);
        }
      }),
  );

  for (const m of settings.manual) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.startDate)) continue;
    const type = byName.get(m.type.toLowerCase());
    if (type && !type.enabled) continue;
    const step = m.intervalWeeks * 7;
    const start = new Date(`${m.startDate}T12:00:00Z`);
    const diffDays = Math.round((new Date(`${today}T12:00:00Z`) - start) / 86400000);
    let k = diffDays > 0 ? Math.ceil(diffDays / step) : 0;
    for (let day = addDays(m.startDate, k * step); day <= last; day = addDays(m.startDate, ++k * step)) {
      add(day, { name: type?.name || m.type, color: type?.color || '#9ca3af' });
    }
  }

  const list = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, settings.maxEntries)
    .map(([date, items]) => ({ date, items }));

  return { today, tomorrow: addDays(today, 1), days: list, errors };
}
