// Pollen & air quality: DWD pollen forecast (Tiefland Sachsen) + CAMS air quality, like
// src/providers/airpollen.js.
import { addDays, addMin, dayKey } from './index.js';

const POLLEN = ['hazel', 'alder', 'ash', 'birch', 'grass', 'rye', 'mugwort', 'ragweed'];
// Berlin wall-clock time as Open-Meteo returns it ("2026-11-24T16:00").
const local = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const BASE = { hazel: [1.5, 2, 2.5], alder: [1, 1.5, 1], ash: [0.5, 0.5, 0], birch: [0.5, 1, 1.5], grass: [0, 0.5, 0.5], rye: [0, 0, 0.5], mugwort: [0.5, 0, 0], ragweed: [3, 2.5, 2] };
const LEVEL = (id, v) => {
  const b = { pm2_5: [10, 20, 25, 50, 75], pm10: [20, 40, 50, 100, 150], nitrogen_dioxide: [40, 90, 120, 230, 340], ozone: [50, 100, 130, 240, 380], uv_index: [2.99, 5.99, 7.99, 10.99, Infinity] }[id];
  const i = b.findIndex((x) => v <= x);
  return ['good', 'fair', 'moderate', 'poor', 'very poor', 'extremely poor'][i < 0 ? 5 : i];
};

export default ({ now, settings, long }) => {
  const n = long ? 3 : Math.min(3, Math.max(1, Number(settings.days) || 2));
  const days = Array.from({ length: n }, (_, i) => dayKey(addDays(now, i)));
  const types = long ? POLLEN : (settings.pollenTypes || []).filter((x) => POLLEN.includes(x));
  const threshold = Number(settings.threshold) || 0;
  const items = types
    .map((id) => {
      const values = BASE[id].slice(0, n);
      const max = Math.max(...values);
      return { id, values, max, alert: max >= Math.max(threshold, 0.5) };
    })
    .filter((p) => long || threshold === 0 || p.max >= threshold);
  const pollutants = long ? ['pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'uv_index'] : settings.pollutants || [];
  const VAL = long ? { pm2_5: 48.6, pm10: 123.4, ozone: 61, nitrogen_dioxide: 37.2, uv_index: 1.2 } : { pm2_5: 8.4, pm10: 17, ozone: 54, nitrogen_dioxide: 21.7, uv_index: 0.8 };
  const aqi = long ? 78 : 34;
  const level = aqi <= 20 ? 'good' : aqi <= 40 ? 'fair' : aqi <= 60 ? 'moderate' : 'poor';
  const peakAqi = long ? 96 : 52;
  const peakTime = local(addMin(now, 120)).slice(0, 13) + ':00';
  const peak = settings.showAirForecast === false ? null : { aqi: peakAqi, time: peakTime, level: peakAqi <= 60 ? 'moderate' : 'very poor' };
  return {
    location: 'Leipzig',
    days,
    threshold,
    pollen: { source: 'dwd', region: 'Tiefland Sachsen', items, total: types.length, error: null, updated: dayKey(now) },
    air: {
      aqi,
      level,
      time: `${local(now).slice(0, 13)}:00`,
      pollutants: pollutants.map((id) => ({ id, value: VAL[id], unit: id === 'uv_index' ? '' : 'µg/m³', level: LEVEL(id, VAL[id]) })),
      peak,
    },
    pollenAlert: items.some((p) => p.alert),
    airAlert: aqi > 40,
  };
};
