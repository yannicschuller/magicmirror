// Weather (src/providers/weather.js → weather()): current, hourly (48 h from the current hour),
// nowcast (8 quarter hours, rain starting soon), 8 daily rows and – when enabled – air/pollen.
// Times are local wall-clock strings ("YYYY-MM-DDTHH:MM") like Open-Meteo returns them.
import { addDays, dayKey } from './index.js';

const TZ = 'Europe/Berlin';
const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
export const localIso = (d) => {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const r1 = (n) => Math.round(n * 10) / 10;

export default ({ now, settings = {}, long, general = {} }) => {
  const imperial = settings.units === 'imperial';
  const T = (c) => (imperial ? r1((c * 9) / 5 + 32) : c);
  const W = (k) => (imperial ? r1(k / 1.609) : k);
  const P = (mm) => (imperial ? Math.round((mm / 25.4) * 100) / 100 : mm);

  // the quarter hour we are in
  const q = new Date(Math.floor(now.getTime() / 900000) * 900000);
  const curTime = localIso(q);
  const hourStart = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
  const curHour = Number(curTime.slice(11, 13));
  const isDayAt = (h) => h >= 7 && h < 17;

  const base = long ? -17.6 : 4.2; // late-autumn Leipzig (long: a brutal cold snap)
  const swing = long ? 6 : 4;
  const tempAt = (h, dayOffset = 0) => r1(base + dayOffset * 0.4 + swing * Math.sin(((h - 8) / 24) * 2 * Math.PI));

  const current = {
    time: curTime,
    temp: T(tempAt(curHour)),
    feels: T(r1(tempAt(curHour) - (long ? 11.4 : 3.1))),
    humidity: long ? 100 : 87,
    wind: W(long ? 118 : 17),
    gust: W(long ? 154 : 38),
    windDir: long ? 293 : 245,
    code: long ? 75 : 3,
    isDay: isDayAt(curHour),
    uv: isDayAt(curHour) ? (long ? 11 : 1) : 0,
    pressure: imperial ? r1((long ? 1043.7 : 1012.4) * 0.02953 * 100) / 100 : long ? 1043.7 : 1012.4,
    cloudCover: long ? 100 : 92,
    visibility: imperial ? r1((long ? 400 : 18300) / 1609) : long ? 0.4 : 18.3,
    dewPoint: T(long ? -19.8 : 2.1),
    precip: P(long ? 12.4 : 0),
  };

  // rain starts in 45 minutes and gets moderate (long: heavy snow/rain all the time)
  const nowcastMm = long ? [3.2, 4.1, 5.6, 6.8, 5.9, 4.4, 3.8, 2.9] : [0, 0, 0, 0.2, 0.5, 0.8, 0.6, 0.3];
  const nowcast = nowcastMm.map((mm, i) => ({ time: localIso(new Date(q.getTime() + i * 900000)), mm: P(mm) }));

  const hourly = [];
  for (let i = 0; i < 48; i++) {
    const t = new Date(hourStart.getTime() + i * 3600000);
    const h = Number(localIso(t).slice(11, 13));
    const wet = long ? true : i >= 1 && i <= 6;
    const pop = long ? 100 : wet ? [40, 65, 80, 75, 55, 35][i - 1] : i < 20 ? 15 : 5;
    hourly.push({
      time: localIso(t),
      temp: T(tempAt(h, Math.floor(i / 24))),
      pop,
      precip: P(long ? 14.8 : wet ? [0.2, 0.6, 1.1, 0.9, 0.4, 0.2][i - 1] : 0),
      code: long ? (i % 3 ? 75 : 86) : wet ? (pop >= 70 ? 63 : 61) : isDayAt(h) ? 2 : 3,
      uv: isDayAt(h) ? (long ? 11 : h >= 10 && h <= 13 ? 1 : 0) : 0,
      gust: W(long ? 140 + (i % 5) * 4 : wet ? 45 : 28),
      isDay: isDayAt(h),
    });
  }

  const codes = long ? [75, 86, 99, 65, 82, 77, 96, 75] : [61, 3, 2, 80, 0, 45, 71, 1];
  const daily = [];
  for (let i = 0; i < 8; i++) {
    const date = dayKey(addDays(now, i), TZ);
    const sunrise = `${date}T07:${String(30 + Math.min(i, 9)).padStart(2, '0')}`;
    const sunset = `${date}T16:${String(Math.max(0, 9 - i)).padStart(2, '0')}`;
    daily.push({
      date,
      code: codes[i],
      max: T(long ? r1(-11.2 - i * 1.3) : r1(6.8 + ((i * 37) % 5) - 1.5)),
      min: T(long ? r1(-24.6 - i * 0.9) : r1(0.4 + ((i * 23) % 4) - 2)),
      pop: long ? 100 : [85, 20, 10, 60, 5, 15, 45, 0][i],
      precip: P(long ? r1(48.6 + i) : [4.8, 0.2, 0, 2.6, 0, 0.1, 1.4, 0][i]),
      uv: long ? 11 : [1, 1.4, 2, 0.8, 1.9, 1.2, 0.6, 2.1][i],
      sunrise,
      sunset,
      sunshine: long ? 0 : [3600, 9000, 21600, 1800, 25200, 7200, 0, 23400][i],
    });
  }

  const out = {
    location: settings.location?.name || (long ? 'Markkleeberg-Gaschwitz an der Pleiße' : general.location?.name || 'Leipzig'),
    units: settings.units || 'metric',
    current,
    hourly,
    nowcast,
    daily,
  };
  const pollenTypes = (settings.pollen || []).filter((p) => ['alder', 'birch', 'grass', 'mugwort', 'ragweed'].includes(p));
  if (settings.airQuality || pollenTypes.length) {
    const levels = long ? { alder: 410, birch: 2600, grass: 380, mugwort: 95, ragweed: 140 } : { alder: 12, birch: 0, grass: 4, mugwort: 0, ragweed: 0 };
    out.air = { aqi: long ? 187 : 34, pollen: Object.fromEntries(pollenTypes.map((p) => [p, levels[p]])) };
  }
  return out;
};
