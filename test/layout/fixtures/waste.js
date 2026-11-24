// Waste calendar (src/providers/waste.js): { today, tomorrow, days: [{ date, items: [{ name, color }], past }], errors }.
// Names and colours come from the module's configured waste types (German defaults).
import { addDays, dayKey, LONG } from './index.js';

const TZ = 'Europe/Berlin';
const FALLBACK = [
  { name: 'Restmüll', color: '#9ca3af' }, { name: 'Biotonne', color: '#a16207' }, { name: 'Papier', color: '#3b82f6' },
  { name: 'Gelbe Tonne', color: '#facc15' }, { name: 'Glas', color: '#22c55e' }, { name: 'Grünschnitt', color: '#4ade80' },
  { name: 'Sperrmüll', color: '#c084fc' }, { name: 'Schadstoffe', color: '#ef4444' },
];

export default ({ now, settings = {}, long }) => {
  const types = (settings.types?.length ? settings.types : FALLBACK).filter((t) => t.enabled !== false).map(({ name, color }) => ({ name, color }));
  const pick = (i) => types[i % types.length];
  const max = settings.maxEntries || 4;
  const today = dayKey(now, TZ);
  const day = (n) => dayKey(addDays(now, n), TZ);

  let plan;
  if (!long) {
    // tomorrow: general + organic, then paper, yellow bin, glass
    plan = [[1, [0, 1]], [4, [2]], [8, [3]], [13, [4, 0]]];
  } else {
    // every day another pile; today all types at once plus an unmatched entry with a long name
    plan = Array.from({ length: Math.max(max, 1) }, (_, i) => [i, i === 0 ? types.map((_, k) => k) : [i % types.length, (i + 3) % types.length, (i + 5) % types.length]]);
  }
  const days = plan.slice(0, max).map(([n, idx]) => {
    const items = [...new Map(idx.map((i) => [pick(i).name, pick(i)])).values()];
    if (long && n === 0) items.push({ name: `Schadstoffmobil – Haltestelle Karl-Liebknecht-Straße / Ecke ${LONG}`, color: '#9ca3af' });
    return { date: day(n), items, past: false };
  });
  return { today, tomorrow: day(1), days, errors: [] };
};
