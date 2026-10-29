// Bike & scooter sharing from public GBFS feeds (v2.x and v3.0).
// gbfs.json (auto-discovery) → station_information + station_status for docked
// systems, free_bike_status (v2) / vehicle_status (v3) for free-floating ones,
// vehicle_types to tell bikes, e-bikes, cargo bikes and scooters apart.
// Status feeds are cached for their `ttl` (30–300 s), static ones for hours.
import { translator, langOf } from '../../public/shared/i18n.js';
import { resolveLocation } from '../../public/shared/modules.js';
import { BIKE_PRESETS } from '../../public/shared/modules/bikes.js';
import { cached, fetchJson, haversineKm } from '../util.js';

// Errors carry their message id so provider() can translate them.
function fail(id, params) {
  const err = new Error(translator('en')(id, params));
  err.msgId = id;
  err.params = params;
  return err;
}

const STATIC_TTL = [3600, 6 * 3600];
const STATUS_TTL = [30, 300];
const BIKE_KINDS = ['bike', 'ebike', 'cargo'];
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---- parsing (pure, exported for tests) -------------------------------------------

export function feedUrl(entry) {
  if (!entry) return null;
  if (entry.preset && entry.preset !== 'custom') return BIKE_PRESETS.find((p) => p.value === entry.preset)?.url || null;
  const url = clean(entry.url);
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

export const presetLabel = (entry) => (entry?.preset && entry.preset !== 'custom' ? BIKE_PRESETS.find((p) => p.value === entry.preset)?.label || '' : '');

// v3 uses localised arrays [{ text, language }], v2 plain strings.
export function localText(v, lang) {
  if (Array.isArray(v)) {
    const hit = v.find((x) => x?.language?.toLowerCase().startsWith(lang)) || v.find((x) => x?.language?.startsWith('en')) || v[0];
    return clean(hit?.text);
  }
  return clean(v);
}

// gbfs.json → { version, feeds: { name: url } }. v2 nests the feed list per
// language, v3 has a single list.
export function parseDiscovery(json, lang = 'en') {
  const data = json?.data;
  if (!data || typeof data !== 'object') throw fail('Not a GBFS feed');
  let list = data.feeds;
  if (!Array.isArray(list)) {
    const langs = Object.keys(data).filter((k) => Array.isArray(data[k]?.feeds));
    const pick = langs.find((k) => k.toLowerCase().startsWith(lang)) || langs.find((k) => k.startsWith('en')) || langs[0];
    list = pick ? data[pick].feeds : null;
  }
  if (!Array.isArray(list)) throw fail('Not a GBFS feed');
  const feeds = {};
  for (const f of list) if (f?.name && f?.url) feeds[f.name] = f.url;
  return { version: String(json.version || '1.0'), feeds };
}

// GBFS form_factor/propulsion_type → bike | ebike | cargo | scooter | moped | null (cars etc.)
export function classify(vt) {
  const form = vt?.form_factor;
  const motor = vt?.propulsion_type && vt.propulsion_type !== 'human';
  if (form === 'bicycle') return motor ? 'ebike' : 'bike';
  if (form === 'cargo_bicycle') return 'cargo';
  if (form === 'scooter' || form === 'scooter_standing' || form === 'scooter_seated') return 'scooter';
  if (form === 'moped') return 'moped';
  if (!form) return motor ? 'ebike' : 'bike';
  return null;
}

// vehicle_types → { id: kind }
export function parseVehicleTypes(json) {
  const out = {};
  for (const vt of json?.data?.vehicle_types || []) if (vt?.vehicle_type_id != null) out[vt.vehicle_type_id] = classify(vt);
  return out;
}

// Kinds that can be found at stations: everything not marked as purely
// free-floating (Bolt and Voi publish parking zones as "stations").
// null = no vehicle_types feed, so nothing is known.
export function dockedKinds(json) {
  const list = json?.data?.vehicle_types;
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter((vt) => vt?.return_constraint !== 'free_floating').map(classify).filter(Boolean))];
}

// Vehicles without a known type are bikes (GBFS < 2.1 only had bikes).
const kindOf = (types, id) => (id == null || !types || !(id in types) ? 'bike' : types[id]);

export function parseStationInfo(json, lang = 'en') {
  return (json?.data?.stations || [])
    .filter((s) => s?.station_id != null && finite(s.lat) && finite(s.lon))
    .map((s) => ({
      id: String(s.station_id),
      name: localText(s.name, lang) || localText(s.short_name, lang) || String(s.station_id),
      lat: s.lat,
      lon: s.lon,
      virtual: s.is_virtual_station === true,
    }));
}

// station_status → Map(id → { total, types: [{ id, count }] | null, docks, renting })
export function parseStationStatus(json) {
  const out = new Map();
  for (const s of json?.data?.stations || []) {
    if (s?.station_id == null || s.is_installed === false) continue;
    const total = s.num_vehicles_available ?? s.num_bikes_available ?? 0;
    const types = Array.isArray(s.vehicle_types_available) ? s.vehicle_types_available.map((x) => ({ id: x.vehicle_type_id, count: Number(x.count) || 0 })) : null;
    out.set(String(s.station_id), {
      total: Number(total) || 0,
      types,
      docks: finite(s.num_docks_available) ? s.num_docks_available : null,
      renting: s.is_renting !== false,
    });
  }
  return out;
}

// free_bike_status (v2: data.bikes) / vehicle_status (v3: data.vehicles) →
// rentable free-floating vehicles [{ lat, lon, type }]. Vehicles parked at a
// station are already counted by station_status.
export function parseVehicles(json) {
  const list = json?.data?.vehicles || json?.data?.bikes || [];
  const out = [];
  for (const v of list) {
    if (!v || v.is_disabled === true || v.is_reserved === true || v.station_id) continue;
    if (!finite(v.lat) || !finite(v.lon)) continue;
    out.push({ lat: v.lat, lon: v.lon, type: v.vehicle_type_id ?? null });
  }
  return out;
}

// Initial compass bearing in degrees (0 = north, clockwise).
export function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return Math.round(((Math.atan2(y, x) / r) + 360) % 360);
}

const distM = (loc, p) => Math.round(haversineKm(loc.lat, loc.lon, p.lat, p.lon) * 1000);

// Count per kind for a station; only the requested kinds count as available.
export function stationCounts(status, types, kinds, docked = null) {
  const counts = {};
  if (status.types && status.types.length) {
    for (const { id, count } of status.types) {
      const k = kindOf(types, id);
      if (k && count > 0) counts[k] = (counts[k] || 0) + count;
    }
  } else if (status.total > 0) {
    counts[docked?.length === 1 ? docked[0] : 'bike'] = status.total;
  }
  const wanted = Object.fromEntries(Object.entries(counts).filter(([k]) => kinds.includes(k)));
  const available = status.renting ? Object.values(wanted).reduce((a, b) => a + b, 0) : 0;
  return { counts: status.renting ? wanted : {}, available };
}

// Stations within the radius, nearest first.
export function nearestStations(info, status, types, loc, { radius = 500, max = 3, kinds, hideEmpty = false, operator = '', docked = null }) {
  const fallback = docked || ['bike'];
  const out = [];
  for (const st of info) {
    const s = status.get(st.id);
    if (!s) continue;
    const dist = distM(loc, st);
    if (dist > radius) continue;
    // A station offering none of the requested kinds (car sharing, scooter parking zones) is skipped.
    const declared = s.types?.length ? s.types.map((x) => kindOf(types, x.id)) : fallback;
    if (!declared.some((k) => kinds.includes(k))) continue;
    const { counts, available } = stationCounts(s, types, kinds, docked);
    if (hideEmpty && !available) continue;
    // Empty scooter "stations" are just parking spots – not worth a line.
    if (!available && !declared.some((k) => BIKE_KINDS.includes(k))) continue;
    out.push({
      name: st.name,
      operator,
      dist,
      bearing: bearing(loc.lat, loc.lon, st.lat, st.lon),
      counts,
      available,
      docks: st.virtual ? null : s.docks,
      renting: s.renting,
    });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, max);
}

// Free-floating vehicles within the radius: { counts: { scooter: 4 }, total, nearest }
export function countVehicles(vehicles, types, loc, { radius = 500, kinds }) {
  const counts = {};
  let total = 0;
  let nearest = null;
  for (const v of vehicles) {
    const k = kindOf(types, v.type);
    if (!kinds.includes(k)) continue;
    const d = distM(loc, v);
    if (d > radius) continue;
    counts[k] = (counts[k] || 0) + 1;
    total++;
    if (nearest === null || d < nearest.dist) nearest = { dist: d, bearing: bearing(loc.lat, loc.lon, v.lat, v.lon) };
  }
  return { counts, total, nearest };
}

// ---- fetching ---------------------------------------------------------------------

// Last ttl seen per URL, so the next cache period follows the feed's own ttl.
const ttlHint = new Map();

function load(url, range, parse) {
  const ttl = clamp(ttlHint.get(url), range);
  return cached(`bikes:${url}`, ttl, async () => {
    const json = await fetchJson(url);
    ttlHint.set(url, Number(json?.ttl));
    return parse(json);
  });
}

async function loadSystem(url, lang, wantStations, wantVehicles) {
  let disc;
  try {
    disc = await load(url, STATIC_TTL, (j) => parseDiscovery(j, lang));
  } catch (err) {
    if (err.msgId) throw err;
    throw fail('Feed could not be loaded ({error})', { error: err.message });
  }
  const f = disc.feeds;
  const optional = (name, range, parse) => (f[name] ? load(f[name], range, parse).catch(() => null) : Promise.resolve(null));
  const vehicleFeed = f.vehicle_status ? 'vehicle_status' : 'free_bike_status';
  const [sysInfo, vt, info, status, vehicles] = await Promise.all([
    optional('system_information', STATIC_TTL, (j) => ({ name: localText(j?.data?.name, lang) })),
    optional('vehicle_types', STATIC_TTL, (j) => ({ map: parseVehicleTypes(j), docked: dockedKinds(j) })),
    wantStations && f.station_information ? load(f.station_information, STATIC_TTL, (j) => parseStationInfo(j, lang)) : null,
    wantStations && f.station_status ? load(f.station_status, STATUS_TTL, parseStationStatus) : null,
    wantVehicles && f[vehicleFeed] ? load(f[vehicleFeed], STATUS_TTL, parseVehicles) : null,
  ]);
  const statusTtl = [f.station_status, f[vehicleFeed]].map((u) => ttlHint.get(u)).filter(finite);
  return { name: sysInfo?.name || '', types: vt?.map || null, docked: vt?.docked || null, info, status, vehicles, ttl: statusTtl.length ? Math.min(...statusTtl) : null };
}

export async function provider(settings, cfg) {
  const lang = langOf(cfg.general.locale);
  const t = translator(lang);
  const loc = resolveLocation(settings, cfg.general);
  const entries = (settings.feeds || []).map((e) => ({ e, url: feedUrl(e) })).filter((x) => x.url);
  const radius = Number(settings.radius) || 500;
  const kinds = settings.kinds?.length ? settings.kinds : ['bike', 'ebike', 'cargo', 'scooter'];
  const max = Number.isFinite(Number(settings.maxStations)) ? Number(settings.maxStations) : 3;
  const base = { location: loc.name || '', radius, stations: [], vehicles: [], errors: [], refresh: 90 };
  if (!entries.length) return { ...base, needsSetup: true };

  const results = await Promise.all(
    entries.map(({ e, url }) =>
      loadSystem(url, lang, max > 0, settings.showFreeFloating !== false).then(
        (sys) => ({ e, url, sys }),
        (err) => ({ e, url, err }),
      ),
    ),
  );
  const nameOf = (r) => clean(r.e.name) || presetLabel(r.e).split(' – ')[0] || r.sys?.name || new URL(r.url).host;
  const errors = [];
  let stations = [];
  const ttls = [];
  for (const r of results) {
    if (r.err) {
      const msg = r.err.msgId ? t(r.err.msgId, r.err.params) : r.err.message;
      errors.push(`${nameOf(r)}: ${msg}`);
      continue;
    }
    const { sys } = r;
    const operator = nameOf(r);
    if (finite(sys.ttl)) ttls.push(sys.ttl);
    if (sys.info && sys.status) stations.push(...nearestStations(sys.info, sys.status, sys.types, loc, { radius, max, kinds, hideEmpty: settings.hideEmpty, operator, docked: sys.docked }));
    // Only systems that actually have free-floating vehicles of these kinds get a
    // line; station-based ones only when some are nearby ("none" would be noise).
    if (sys.vehicles?.some((v) => kinds.includes(kindOf(sys.types, v.type)))) {
      const counted = countVehicles(sys.vehicles, sys.types, loc, { radius, kinds });
      const stationBased = sys.info?.length && (sys.docked || ['bike']).some((k) => BIKE_KINDS.includes(k));
      if (counted.total || !stationBased) base.vehicles.push({ operator, ...counted });
    }
  }
  if (errors.length === results.length) throw new Error(errors[0]);
  stations = stations.sort((a, b) => a.dist - b.dist).slice(0, max);
  const operators = new Set(stations.map((s) => s.operator));
  return {
    ...base,
    stations,
    multiOperator: operators.size > 1,
    errors,
    // Follow the feeds' own update rhythm, but stay between 60 s and 5 min.
    refresh: ttls.length ? Math.min(300, Math.max(60, Math.min(...ttls))) : 90,
  };
}

export const bikes = provider;
