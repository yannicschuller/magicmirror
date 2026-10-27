import { translator, langOf } from '../../public/shared/i18n.js';
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
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,uv_index,pressure_msl,cloud_cover,visibility,dew_point_2m',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,uv_index,wind_gusts_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset,sunshine_duration',
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

// Open-Meteo air-quality API (CAMS). Pollen is only modelled for Europe and
// comes back as null elsewhere; failures never break the weather module.
export const POLLEN_TYPES = ['alder', 'birch', 'grass', 'mugwort', 'ragweed'];

async function airQuality(loc, timezone) {
  const lat = loc.lat.toFixed(2);
  const lon = loc.lon.toFixed(2);
  const vars = ['european_aqi', ...POLLEN_TYPES.map((p) => `${p}_pollen`)].join(',');
  const params = new URLSearchParams({ latitude: lat, longitude: lon, timezone: timezone || 'auto', forecast_days: '2', current: 'european_aqi', hourly: vars });
  return cached(`openmeteo-aq:${lat}:${lon}:${timezone}`, 1800, () =>
    fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`),
  );
}

// Current AQI + today's peak per pollen type (null = not available here).
export function summarizeAir(raw, pollenTypes) {
  const h = raw.hourly || {};
  const today = (raw.current?.time || h.time?.[0] || '').slice(0, 10);
  const idx = (h.time || []).map((t, i) => (t.slice(0, 10) === today ? i : -1)).filter((i) => i >= 0);
  const peak = (arr) => {
    const vals = idx.map((i) => arr?.[i]).filter((v) => typeof v === 'number');
    return vals.length ? Math.max(...vals) : null;
  };
  const aqi = raw.current?.european_aqi ?? null;
  const pollen = {};
  for (const p of pollenTypes) pollen[p] = peak(h[`${p}_pollen`]);
  return { aqi: typeof aqi === 'number' ? aqi : null, pollen };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export async function weather(settings, cfg) {
  const loc = resolveLocation(settings, cfg.general);
  const imperial = settings.units === 'imperial';
  const raw = await openMeteo(loc, cfg.general.timezone, settings.units);
  const c = raw.current;
  const d = raw.daily;
  const pollenTypes = (settings.pollen || []).filter((p) => POLLEN_TYPES.includes(p));
  let air;
  if (settings.airQuality || pollenTypes.length) {
    try {
      air = summarizeAir(await airQuality(loc, cfg.general.timezone), pollenTypes);
    } catch (err) {
      console.warn('[weather] air quality unavailable:', err.message);
      air = null;
    }
  }
  // Visibility: metres (metric) or feet (imperial) → km / miles.
  const vis = isNum(c.visibility) ? (imperial ? c.visibility / 5280 : c.visibility / 1000) : null;
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
      windDir: c.wind_direction_10m ?? null,
      code: c.weather_code,
      isDay: c.is_day === 1,
      uv: c.uv_index ?? null,
      // hPa, or inHg for imperial
      pressure: isNum(c.pressure_msl) ? (imperial ? c.pressure_msl * 0.02953 : c.pressure_msl) : null,
      cloudCover: c.cloud_cover ?? null,
      visibility: vis,
      dewPoint: c.dew_point_2m ?? null,
      precip: c.precipitation ?? null,
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
      sunshine: d.sunshine_duration?.[i] ?? null, // seconds
    })),
    ...(air !== undefined ? { air } : {}),
  };
}

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const THUNDER_CODES = new Set([95, 96, 99]);
// "15:00" / "tomorrow 15:00" (German: "15 Uhr" / "morgen 15 Uhr")
function atFn(t, today) {
  return (time) => {
    const label = t('{h}:00', { h: Number(time.slice(11, 13)) });
    return time.slice(0, 10) === today ? label : t('tomorrow {time}', { time: label });
  };
}

function uvLevel(uv) {
  if (uv >= 11) return 'extreme';
  if (uv >= 8) return 'very high';
  if (uv >= 6) return 'high';
  return 'moderate';
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
  const lang = langOf(cfg.general.locale);
  const t = translator(lang);
  const at = atFn(t, today);
  const dec = (n) => (lang === 'de' ? n.replace('.', ',') : n);

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
        title: t("Don't forget your umbrella!"),
        detail: `${now ? t('Raining already') : t('Rain from {time}', { time: at(wet[0].time) })} · ${t('up to {p} %', { p: maxPop })} · ${t('approx. {mm} mm', { mm: dec(total.toFixed(1)) })}${thunder ? ` · ${t('thunderstorms possible')}` : ''}`,
      });
    }
  }

  if (settings.snow) {
    const snowy = hours.find((h) => SNOW_CODES.has(h.code));
    if (snowy) hints.push({ kind: 'snow', level: 'warn', title: t('Snow expected – dress warmly!'), detail: t('from {time}', { time: at(snowy.time) }) });
  }

  if (settings.uv) {
    const day = hours.filter((h) => h.isDay && h.uv != null);
    if (day.length) {
      const peak = day.reduce((a, b) => (b.uv > a.uv ? b : a));
      if (peak.uv >= settings.uvThreshold) {
        hints.push({
          kind: 'uv',
          level: peak.uv >= 8 ? 'warn' : 'info',
          title: t("Don't forget sunscreen!"),
          detail: t('UV index {uv} ({level}) around {time}', { uv: Math.round(peak.uv), level: t(uvLevel(peak.uv)), time: at(peak.time) }),
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
        title: coldest.temp <= 0 ? t('Frost – watch out for ice & scrape the windscreen') : t("Cold – don't forget your jacket"),
        detail: t('Low of {temp} °C at {time}', { temp: Math.round(coldest.temp), time: at(coldest.time) }),
      });
    }
  }

  if (settings.heat && hours.length) {
    const hottest = hours.reduce((a, b) => (b.temp > a.temp ? b : a));
    if (hottest.temp >= settings.heatTemp) {
      hints.push({ kind: 'heat', level: hottest.temp >= 35 ? 'warn' : 'info', title: t('Hot – drink plenty!'), detail: t('Up to {temp} °C at {time}', { temp: Math.round(hottest.temp), time: at(hottest.time) }) });
    }
  }

  if (settings.wind && hours.length) {
    const windiest = hours.reduce((a, b) => (b.gust > a.gust ? b : a));
    if (windiest.gust >= settings.windGust) {
      hints.push({
        kind: 'wind',
        level: windiest.gust >= 90 ? 'severe' : 'warn',
        title: t('Stormy – secure loose objects'),
        detail: t('Gusts up to {gust} km/h at {time}', { gust: Math.round(windiest.gust), time: at(windiest.time) }),
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
        const event = lang === 'de' ? a.event_de : a.event_en || a.event_de;
        hints.push({ kind: 'dwd', level: sev, title: (lang === 'de' ? a.headline_de : a.headline_en) || event || t('Weather warning'), detail: event ? `DWD · ${event}` : 'DWD' });
      }
    } catch (err) {
      console.warn('[hints] DWD warnings unavailable:', err.message);
    }
  }

  const order = { severe: 0, warn: 1, info: 2 };
  hints.sort((a, b) => order[a.level] - order[b.level]);
  if (!hints.length && settings.showWhenNone) {
    hints.push({ kind: 'ok', level: 'ok', title: t('No umbrella needed'), detail: t('The weather is playing along.') });
  }
  return { hints };
}
