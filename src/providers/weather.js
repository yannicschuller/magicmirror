import { cached, fetchJson } from '../util.js';
import { resolveLocation } from '../../public/shared/modules.js';

async function openMeteo(loc, timezone, units = 'metric') {
  const lat = loc.lat.toFixed(3);
  const lon = loc.lon.toFixed(3);
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    timezone: timezone || 'auto',
    forecast_days: '8',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_gusts_10m,precipitation',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,uv_index,wind_gusts_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset',
  });
  if (units === 'imperial') {
    params.set('temperature_unit', 'fahrenheit');
    params.set('wind_speed_unit', 'mph');
    params.set('precipitation_unit', 'inch');
  }
  return cached(`openmeteo:${lat}:${lon}:${timezone}:${units}`, 600, () =>
    fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`),
  );
}

function hourlyFromNow(raw) {
  const h = raw.hourly;
  const nowHour = raw.current.time.slice(0, 13); // "YYYY-MM-DDTHH"
  const start = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) >= nowHour));
  const rows = [];
  for (let i = start; i < h.time.length; i++) {
    rows.push({
      time: h.time[i],
      temp: h.temperature_2m[i],
      pop: h.precipitation_probability[i],
      precip: h.precipitation[i],
      code: h.weather_code[i],
      uv: h.uv_index[i],
      gust: h.wind_gusts_10m[i],
      isDay: h.is_day[i] === 1,
    });
  }
  return rows;
}

export async function weather(settings, cfg) {
  const loc = resolveLocation(settings, cfg.general);
  const raw = await openMeteo(loc, cfg.general.timezone, settings.units);
  const c = raw.current;
  const d = raw.daily;
  return {
    location: loc.name,
    units: settings.units,
    current: {
      time: c.time,
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
      gust: c.wind_gusts_10m,
      code: c.weather_code,
      isDay: c.is_day === 1,
    },
    hourly: hourlyFromNow(raw).slice(0, 48),
    daily: d.time.map((date, i) => ({
      date,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      pop: d.precipitation_probability_max[i],
      precip: d.precipitation_sum[i],
      uv: d.uv_index_max[i],
      sunrise: d.sunrise[i],
      sunset: d.sunset[i],
    })),
  };
}

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const THUNDER_CODES = new Set([95, 96, 99]);
const hourLabel = (t) => `${Number(t.slice(11, 13))} Uhr`;
const dayPrefix = (t, today) => (t.slice(0, 10) === today ? '' : 'morgen ');
const at = (t, today) => `${dayPrefix(t, today)}${hourLabel(t)}`;

function uvLevel(uv) {
  if (uv >= 11) return 'extrem';
  if (uv >= 8) return 'sehr hoch';
  if (uv >= 6) return 'hoch';
  return 'mäßig';
}

async function dwdAlerts(loc) {
  const lat = loc.lat.toFixed(3);
  const lon = loc.lon.toFixed(3);
  return cached(`brightsky:${lat}:${lon}`, 600, async () => {
    const data = await fetchJson(`https://api.brightsky.dev/alerts?lat=${lat}&lon=${lon}`);
    return data.alerts || [];
  });
}

export async function weatherHints(settings, cfg) {
  const loc = resolveLocation(settings, cfg.general);
  const raw = await openMeteo(loc, cfg.general.timezone, 'metric');
  const today = raw.current.time.slice(0, 10);
  const hours = hourlyFromNow(raw).slice(0, settings.lookaheadHours);
  const hints = [];

  if (settings.rain && hours.length) {
    const wet = hours.filter((h) => h.pop >= settings.rainProbability && h.precip >= settings.rainMinMm);
    if (wet.length) {
      const maxPop = Math.max(...wet.map((h) => h.pop));
      const total = hours.reduce((s, h) => s + (h.precip || 0), 0);
      const now = wet[0] === hours[0];
      const thunder = wet.some((h) => THUNDER_CODES.has(h.code));
      hints.push({
        kind: thunder ? 'thunder' : 'rain',
        level: thunder || total >= 15 ? 'warn' : 'info',
        title: 'Regenschirm nicht vergessen!',
        detail: `${now ? 'Regen schon jetzt' : `Regen ab ${at(wet[0].time, today)}`} · bis ${maxPop} % · ca. ${total.toFixed(1).replace('.', ',')} mm${thunder ? ' · Gewitter möglich' : ''}`,
      });
    }
  }

  if (settings.snow) {
    const snowy = hours.find((h) => SNOW_CODES.has(h.code));
    if (snowy) hints.push({ kind: 'snow', level: 'warn', title: 'Schnee erwartet – warm anziehen!', detail: `ab ${at(snowy.time, today)}` });
  }

  if (settings.uv) {
    const day = hours.filter((h) => h.isDay && h.uv != null);
    if (day.length) {
      const peak = day.reduce((a, b) => (b.uv > a.uv ? b : a));
      if (peak.uv >= settings.uvThreshold) {
        hints.push({
          kind: 'uv',
          level: peak.uv >= 8 ? 'warn' : 'info',
          title: 'Eincremen nicht vergessen!',
          detail: `UV-Index ${Math.round(peak.uv)} (${uvLevel(peak.uv)}) gegen ${at(peak.time, today)}`,
        });
      }
    }
  }

  if (settings.frost && hours.length) {
    const coldest = hours.reduce((a, b) => (b.temp < a.temp ? b : a));
    if (coldest.temp <= settings.frostTemp) {
      hints.push({
        kind: 'frost',
        level: coldest.temp <= -5 ? 'warn' : 'info',
        title: coldest.temp <= 0 ? 'Frost – Vorsicht Glätte & Scheibe kratzen' : 'Kalt – an die Jacke denken',
        detail: `Tiefstwert ${Math.round(coldest.temp)} °C ${at(coldest.time, today)}`,
      });
    }
  }

  if (settings.heat && hours.length) {
    const hottest = hours.reduce((a, b) => (b.temp > a.temp ? b : a));
    if (hottest.temp >= settings.heatTemp) {
      hints.push({ kind: 'heat', level: hottest.temp >= 35 ? 'warn' : 'info', title: 'Heiß – viel trinken!', detail: `bis ${Math.round(hottest.temp)} °C ${at(hottest.time, today)}` });
    }
  }

  if (settings.wind && hours.length) {
    const windiest = hours.reduce((a, b) => (b.gust > a.gust ? b : a));
    if (windiest.gust >= settings.windGust) {
      hints.push({
        kind: 'wind',
        level: windiest.gust >= 90 ? 'severe' : 'warn',
        title: 'Stürmisch – lose Gegenstände sichern',
        detail: `Böen bis ${Math.round(windiest.gust)} km/h ${at(windiest.time, today)}`,
      });
    }
  }

  if (settings.dwdWarnings) {
    try {
      const alerts = await dwdAlerts(loc);
      const now = Date.now();
      for (const a of alerts) {
        if (a.expires && new Date(a.expires).getTime() < now) continue;
        const sev = a.severity === 'extreme' || a.severity === 'severe' ? 'severe' : a.severity === 'moderate' ? 'warn' : 'info';
        hints.push({ kind: 'dwd', level: sev, title: a.headline_de || a.event_de || 'Wetterwarnung', detail: a.event_de ? `DWD · ${a.event_de}` : 'DWD' });
      }
    } catch (err) {
      console.warn('[hints] DWD-Warnungen nicht verfügbar:', err.message);
    }
  }

  const order = { severe: 0, warn: 1, info: 2 };
  hints.sort((a, b) => order[a.level] - order[b.level]);
  if (!hints.length && settings.showWhenNone) {
    hints.push({ kind: 'ok', level: 'ok', title: 'Kein Regenschirm nötig', detail: 'Das Wetter spielt mit.' });
  }
  return { hints };
}
