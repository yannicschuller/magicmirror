// Electricity: hourly day-ahead prices for today and tomorrow (exchange price + surcharge),
// the cheapest window and solar/grid/battery, like src/providers/energy.js.
import { dayKey } from './index.js';

const HOUR = 3600000;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
// a typical winter day curve in ct/kWh: cheap at night, peaks in the morning and evening
const CURVE = [27.8, 26.9, 26.1, 25.7, 25.9, 27.2, 31.4, 36.8, 38.9, 35.2, 31.6, 29.4, 28.1, 27.6, 28.3, 30.2, 34.1, 39.7, 42.3, 40.1, 35.6, 32.4, 30.1, 28.9];
const level = (p, avg) => (p < avg * 0.9 ? 'cheap' : p > avg * 1.1 ? 'expensive' : 'normal');

export default ({ now, settings, long }) => {
  const t = now.getTime();
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(t + 24 * HOUR));
  const scale = long ? 4.71 : 1; // long: three-digit prices
  const hours = [];
  for (let h = Math.floor(t / HOUR) * HOUR - 30 * HOUR; h < t + 54 * HOUR; h += HOUR) {
    const k = dayKey(new Date(h));
    if (k !== today && (k !== tomorrow)) continue;
    const hr = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date(h)));
    hours.push({ start: h, price: round((CURVE[hr] + (k === tomorrow ? -1.3 : 0)) * scale, 2) });
  }
  const todayH = hours.filter((h) => dayKey(new Date(h.start)) === today);
  const prices = todayH.map((h) => h.price);
  const avg = round(prices.reduce((a, b) => a + b, 0) / prices.length, 2);
  const cur = hours.find((h) => h.start <= t && t < h.start + HOUR);
  const n = Math.min(12, Math.max(0, Number(settings.windowHours) || 0));
  let window = null;
  if (n) {
    const from = hours.findIndex((h) => h.start + HOUR > t);
    for (let i = from; i >= 0 && i + n <= hours.length; i++) {
      const block = hours.slice(i, i + n);
      const a = block.reduce((s, h) => s + h.price, 0) / n;
      if (!window || a < window.avg) window = { start: block[0].start, end: block[n - 1].start + HOUR, avg: round(a, 2) };
    }
  }
  return {
    source: 'exchange',
    current: cur ? { price: cur.price, level: level(cur.price, avg) } : null,
    today: { min: Math.min(...prices), max: Math.max(...prices), avg },
    hours: hours.map((h) => ({ ...h, level: level(h.price, avg) })),
    window,
    windowHours: n,
    hasTomorrow: hours.some((h) => dayKey(new Date(h.start)) === tomorrow),
    home: long ? { pv: 123.46, grid: -98.76, battery: 100 } : { pv: 1.84, grid: 0.42, battery: 63 },
  };
};
