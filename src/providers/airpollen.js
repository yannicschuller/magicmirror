// Pollen & air quality.
// - Pollen (Germany): DWD "Pollenflug-Gefahrenindex", open data
//   (https://opendata.dwd.de/climate_environment/health/alerts/s31fg.json),
//   source: Deutscher Wetterdienst. Issued once a day around 11:00 for today,
//   tomorrow and the day after; the file is tiny, so we re-check it hourly.
// - Air quality + pollen elsewhere: Open-Meteo air-quality API (CAMS, free, no key).
import { translator, langOf } from '../../public/shared/i18n.js';
import { resolveLocation } from '../../public/shared/modules.js';
import { POLLEN_TYPES, POLLUTANTS, DWD_REGIONS } from '../../public/shared/modules/airpollen.js';
import { cached, fetchJson, haversineKm, dateKey } from '../util.js';

const DWD_URL = 'https://opendata.dwd.de/climate_environment/health/alerts/s31fg.json';
const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const DWD_TTL = 3600;
const AQ_TTL = 1800;
// Farther than this from every anchor point = outside Germany.
const MAX_ANCHOR_KM = 80;

// Errors carry their message id so provider() can translate them.
function fail(id, params) {
  const err = new Error(translator('en')(id, params));
  err.msgId = id;
  err.params = params;
  return err;
}
const tr = (t, err) => (err.msgId ? t(err.msgId, err.params) : err.message);

// ---- DWD -------------------------------------------------------------------------

// DWD index strings → 0…3 in half steps ("1-2" = 1.5). "-1"/missing = no forecast.
const DWD_LEVELS = { '0': 0, '0-1': 0.5, '1': 1, '1-2': 1.5, '2': 2, '2-3': 2.5, '3': 3 };
export const dwdLevel = (v) => DWD_LEVELS[String(v ?? '').trim()] ?? null;

const DWD_DAYS = ['today', 'tomorrow', 'dayafter_to'];

// Area id as used in DWD_REGIONS: the partregion, or the region where there are none.
const areaId = (c) => String(c.partregion_id > 0 ? c.partregion_id : c.region_id);

// "2026-10-29 11:00 Uhr" → "2026-10-29"
const issueDate = (s) => String(s || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;

// → { issued: 'YYYY-MM-DD', nextUpdate, areas: { id: { name, region, pollen: { hazel: [today, tomorrow, dayafter] } } } }
export function parseDwd(json) {
  if (!json || !Array.isArray(json.content)) throw fail('Unexpected response from the DWD pollen service');
  const areas = {};
  for (const c of json.content) {
    const pollen = {};
    for (const p of POLLEN_TYPES) {
      const v = c.Pollen?.[p.dwd];
      pollen[p.value] = DWD_DAYS.map((d) => dwdLevel(v?.[d]));
    }
    areas[areaId(c)] = { name: (c.partregion_name || c.region_name || '').trim(), region: (c.region_name || '').trim(), pollen };
  }
  return { issued: issueDate(json.last_update), nextUpdate: json.next_update || null, areas };
}

// A few representative places per DWD area; the nearest one wins.
export const ANCHORS = {
  11: [[54.48, 9.05], [54.9, 8.32], [54.19, 9.1], [53.92, 9.14], [54.5, 8.65]],
  12: [[54.32, 10.13], [53.87, 10.69], [53.55, 9.99], [54.78, 9.43], [54.07, 9.98], [54.32, 9.7]],
  20: [[54.09, 12.1], [53.63, 11.41], [53.56, 13.26], [54.09, 13.38], [54.31, 13.09], [53.18, 12.49]],
  31: [[53.08, 8.8], [53.14, 8.21], [52.28, 8.05], [53.37, 7.2], [52.52, 7.32], [53.86, 8.69], [53.53, 8.11]],
  32: [[52.37, 9.73], [52.27, 10.52], [53.25, 10.41], [51.54, 9.93], [52.42, 10.79], [52.62, 10.08], [52.97, 10.56]],
  41: [[50.94, 6.96], [51.23, 6.78], [51.51, 7.47], [51.46, 7.01], [51.96, 7.63], [50.78, 6.08], [51.43, 6.76]],
  42: [[52.02, 8.53], [51.72, 8.75], [52.29, 8.92], [51.94, 8.88]],
  43: [[50.87, 8.02], [51.19, 8.53], [51.4, 8.06], [51.22, 7.63], [50.56, 6.24]],
  50: [[52.52, 13.4], [52.4, 13.06], [51.76, 14.33], [52.34, 14.55], [53.32, 13.86], [53.0, 11.75], [52.0, 13.5]],
  61: [[52.13, 11.63], [51.48, 11.97], [51.83, 12.24], [52.6, 11.86], [52.85, 11.15]],
  62: [[51.83, 10.78], [51.8, 10.62], [51.64, 11.14]],
  71: [[50.98, 11.03], [50.93, 11.59], [50.88, 12.08], [51.5, 10.79], [50.98, 11.33], [51.21, 10.45]],
  72: [[50.61, 10.69], [50.7, 10.73], [50.68, 10.92], [50.36, 11.17], [50.65, 11.36]],
  81: [[51.34, 12.37], [51.05, 13.74], [51.56, 13.0], [51.18, 14.42], [51.44, 14.25], [51.31, 13.29], [51.15, 14.99]],
  82: [[50.83, 12.92], [50.58, 13.0], [50.5, 12.14], [50.72, 12.49], [50.91, 13.34], [50.42, 12.97], [50.9, 14.8]],
  91: [[51.31, 9.48], [50.55, 9.68], [50.8, 8.77], [50.58, 8.68], [50.87, 9.71]],
  92: [[50.11, 8.68], [49.87, 8.65], [50.08, 8.24], [50.1, 8.77], [50.13, 8.92]],
  101: [[50.0, 8.27], [49.48, 8.44], [50.36, 7.59], [49.75, 6.64], [49.2, 8.12], [49.84, 7.87], [49.63, 8.36]],
  102: [[49.44, 7.77], [50.44, 7.83], [49.98, 7.52], [50.2, 6.83], [49.2, 7.6], [49.71, 7.31]],
  103: [[49.24, 6.99], [49.35, 7.18], [49.31, 6.75], [49.47, 7.17]],
  111: [[49.01, 8.4], [49.49, 8.47], [49.4, 8.67], [47.99, 7.85], [48.47, 7.94], [48.76, 8.24]],
  112: [[48.78, 9.18], [49.14, 9.22], [48.4, 9.99], [47.78, 9.61], [49.11, 9.74], [47.65, 9.48], [48.1, 9.79]],
  113: [[48.46, 8.41], [47.9, 8.15], [48.06, 8.46], [48.21, 9.02], [48.84, 10.09], [49.52, 9.32], [47.98, 8.82]],
  121: [[48.14, 11.58], [47.73, 10.31], [47.49, 11.1], [47.86, 12.12], [48.57, 13.43], [49.02, 13.23], [48.37, 10.9]],
  122: [[49.01, 12.1], [48.76, 11.42], [48.88, 12.57], [48.84, 12.96], [48.72, 10.78], [48.45, 10.28]],
  123: [[49.45, 11.08], [49.94, 11.58], [50.31, 11.92], [49.44, 11.86], [49.68, 12.16], [49.89, 10.89], [50.26, 10.96], [49.3, 10.57]],
  124: [[49.79, 9.95], [50.05, 10.23], [49.98, 9.15], [49.74, 10.16]],
};

// → { id, km } of the nearest DWD area, or null when the location is outside Germany.
export function pickDwdRegion(lat, lon, { maxKm = MAX_ANCHOR_KM } = {}) {
  let best = null;
  for (const [id, pts] of Object.entries(ANCHORS)) {
    for (const [a, b] of pts) {
      const km = haversineKm(lat, lon, a, b);
      if (!best || km < best.km) best = { id, km };
    }
  }
  return best && best.km <= maxKm ? best : null;
}

const addDays = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const keyDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

// Level of one area for the given calendar days (the file may be from yesterday).
export function dwdForDays(parsed, id, dayKeys, types) {
  const area = parsed.areas[id];
  if (!area) return null;
  return types.map((type) => ({
    id: type,
    values: dayKeys.map((k) => {
      const i = parsed.issued ? keyDiff(parsed.issued, k) : -1;
      return i >= 0 && i < DWD_DAYS.length ? area.pollen[type]?.[i] ?? null : null;
    }),
  }));
}

// ---- Open-Meteo / CAMS ------------------------------------------------------------

// CAMS models only these; grains/m³ → DWD-like 0…3 (thresholds low/medium/high, roughly NAB scale).
const CAMS_POLLEN = {
  alder: [1, 15, 90], birch: [1, 15, 90], grass: [1, 5, 20], mugwort: [1, 10, 50], ragweed: [1, 10, 50],
};
export function camsLevel(type, v) {
  const th = CAMS_POLLEN[type];
  if (!th || typeof v !== 'number') return null;
  if (v < 0.1) return 0;
  if (v < th[0]) return 0.5;
  if (v < th[1]) return 1;
  if (v < th[2]) return 2;
  return 3;
}

// Daily peak per pollen type from the hourly CAMS values.
export function camsForDays(raw, dayKeys, types) {
  const h = raw?.hourly || {};
  const times = h.time || [];
  return types
    .filter((type) => CAMS_POLLEN[type] && Array.isArray(h[`${type}_pollen`]))
    .map((type) => ({
      id: type,
      values: dayKeys.map((k) => {
        let max = null;
        times.forEach((t, i) => {
          const v = h[`${type}_pollen`][i];
          if (t.startsWith(k) && typeof v === 'number' && (max === null || v > max)) max = v;
        });
        return camsLevel(type, max);
      }),
    }));
}

// European Air Quality Index bands (as used by Open-Meteo / CAMS).
export function aqiCategory(aqi) {
  if (typeof aqi !== 'number') return null;
  if (aqi <= 20) return 'good';
  if (aqi <= 40) return 'fair';
  if (aqi <= 60) return 'moderate';
  if (aqi <= 80) return 'poor';
  if (aqi <= 100) return 'very poor';
  return 'extremely poor';
}
const CATS = ['good', 'fair', 'moderate', 'poor', 'very poor', 'extremely poor'];

// Band upper limits (µg/m³) per pollutant, EAQI; UV uses the WHO scale.
const BANDS = {
  pm2_5: [10, 20, 25, 50, 75],
  pm10: [20, 40, 50, 100, 150],
  nitrogen_dioxide: [40, 90, 120, 230, 340],
  ozone: [50, 100, 130, 240, 380],
  uv_index: [2.99, 5.99, 7.99, 10.99, Infinity],
};
export function pollutantLevel(id, v) {
  const b = BANDS[id];
  if (!b || typeof v !== 'number') return null;
  const i = b.findIndex((x) => v <= x);
  return CATS[i < 0 ? 5 : i];
}

// Current values + the highest AQI still to come today.
export function summarizeAir(raw, pollutants) {
  const cur = raw?.current || {};
  const aqi = typeof cur.european_aqi === 'number' ? Math.round(cur.european_aqi) : null;
  const now = cur.time || '';
  let peak = null;
  const h = raw?.hourly || {};
  (h.time || []).forEach((t, i) => {
    const v = h.european_aqi?.[i];
    if (t.slice(0, 10) === now.slice(0, 10) && t > now && typeof v === 'number' && (!peak || v > peak.aqi)) peak = { aqi: Math.round(v), time: t };
  });
  if (peak) peak.level = aqiCategory(peak.aqi);
  return {
    aqi,
    level: aqiCategory(aqi),
    time: now || null,
    pollutants: pollutants
      .filter((id) => typeof cur[id] === 'number')
      .map((id) => ({ id, value: cur[id], unit: id === 'uv_index' ? '' : 'µg/m³', level: pollutantLevel(id, cur[id]) })),
    peak: peak && aqi !== null && peak.aqi > aqi ? peak : null,
  };
}

function airRequest(loc, tz, { air, pollen }) {
  const lat = loc.lat.toFixed(2);
  const lon = loc.lon.toFixed(2);
  const params = { latitude: lat, longitude: lon, timezone: tz, forecast_days: pollen ? '3' : '1' };
  if (air) params.current = ['european_aqi', ...POLLUTANTS.map((p) => p.value)].join(',');
  params.hourly = [...(air ? ['european_aqi'] : []), ...(pollen ? Object.keys(CAMS_POLLEN).map((p) => `${p}_pollen`) : [])].join(',');
  const qs = new URLSearchParams(params);
  return cached(`airpollen:om:${qs}`, AQ_TTL, async () => {
    try {
      const json = await fetchJson(`${AQ_URL}?${qs}`);
      if (json?.error) throw new Error(json.reason || 'error');
      return json;
    } catch (err) {
      throw fail('Air quality service not reachable ({reason})', { reason: err.message });
    }
  });
}

function dwdRequest() {
  return cached('airpollen:dwd', DWD_TTL, async () => {
    let json;
    try {
      json = await fetchJson(DWD_URL);
    } catch (err) {
      throw fail('DWD pollen forecast not reachable ({reason})', { reason: err.message });
    }
    return parseDwd(json);
  });
}

// ---- provider ---------------------------------------------------------------------

export async function provider(settings, cfg) {
  const t = translator(langOf(cfg.general.locale));
  const tz = cfg.general.timezone || 'Europe/Berlin';
  const loc = resolveLocation(settings, cfg.general);
  const known = POLLEN_TYPES.map((p) => p.value);
  const types = (settings.pollenTypes || []).filter((x) => known.includes(x));
  const threshold = Number(settings.threshold) || 0;
  const nDays = Math.min(3, Math.max(1, Number(settings.days) || 2));
  const today = dateKey(new Date(), tz);
  const dayKeys = Array.from({ length: nDays }, (_, i) => addDays(today, i));
  const showPollen = settings.showPollen !== false && types.length > 0;

  // Which pollen source?
  let source = null;
  let regionId = null;
  if (showPollen) {
    const manual = DWD_REGIONS.some((r) => r.id === settings.dwdRegion) ? settings.dwdRegion : null;
    const auto = manual ? null : pickDwdRegion(loc.lat, loc.lon, settings.source === 'dwd' ? { maxKm: Infinity } : undefined);
    if (settings.source === 'cams') source = 'cams';
    else if (manual || auto) [source, regionId] = ['dwd', manual || auto.id];
    else source = settings.source === 'dwd' ? 'dwd' : 'cams';
  }
  const wantAir = settings.showAir !== false;
  const needOm = wantAir || source === 'cams';

  const [dwd, om] = await Promise.allSettled([
    source === 'dwd' ? dwdRequest() : null,
    needOm ? airRequest(loc, tz, { air: wantAir, pollen: source === 'cams' }) : null,
  ]);

  const out = { location: loc.name || '', days: dayKeys, threshold, pollen: null, air: null, pollenAlert: false, airAlert: false };
  const errors = [];

  if (showPollen) {
    let list = null;
    let region = '';
    let error = null;
    if (source === 'dwd') {
      if (dwd.status === 'rejected') error = tr(t, dwd.reason);
      else {
        list = dwdForDays(dwd.value, regionId, dayKeys, types);
        region = dwd.value.areas[regionId]?.name || DWD_REGIONS.find((r) => r.id === regionId)?.name || '';
        if (!list) error = t('No DWD pollen forecast for this region');
      }
    } else if (om.status === 'rejected') error = tr(t, om.reason);
    else list = camsForDays(om.value, dayKeys, types);
    if (error) errors.push(error);
    const items = (list || [])
      .map((p) => {
        const vals = p.values.filter((v) => v !== null);
        const max = vals.length ? Math.max(...vals) : null;
        return { ...p, max, alert: max !== null && max >= Math.max(threshold, 0.5) };
      })
      .filter((p) => p.max !== null && (threshold === 0 || p.max >= threshold));
    out.pollen = { source, region, items, total: (list || []).length, error, updated: source === 'dwd' && dwd.value ? dwd.value.issued : null };
    out.pollenAlert = items.some((p) => p.alert);
  }

  if (wantAir) {
    if (om.status === 'rejected') {
      errors.push(tr(t, om.reason));
      out.air = { error: tr(t, om.reason) };
    } else {
      const pollutants = (settings.pollutants || []).filter((x) => POLLUTANTS.some((p) => p.value === x));
      out.air = summarizeAir(om.value, pollutants);
      if (!settings.showAirForecast) out.air.peak = null;
      out.airAlert = out.air.aqi !== null && out.air.aqi > 40;
    }
  }

  // Nothing at all to show → let the mirror display the error.
  if (errors.length && !(out.pollen && !out.pollen.error) && !(out.air && !out.air.error)) throw new Error(errors[0]);
  return out;
}

export const airpollen = provider;
