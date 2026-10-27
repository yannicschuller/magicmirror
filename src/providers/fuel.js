// Fuel prices from Tankerkönig (https://creativecommons.tankerkoenig.de).
// Data: MTS-K, licence CC BY 4.0. Tankerkönig asks clients not to poll more
// often than every 5 minutes, so every request is cached for at least 300 s.
import { translator, langOf } from '../../public/shared/i18n.js';
import { resolveLocation } from '../../public/shared/modules.js';
import { cached, fetchJson, haversineKm } from '../util.js';

const API = 'https://creativecommons.tankerkoenig.de/json';
export const TYPES = ['e5', 'e10', 'diesel'];
const MIN_TTL = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tankerkönig uses null/false/0 for "no price".
const price = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const address = (s) => clean(`${clean(s.street)} ${clean(s.houseNumber)}`);

function check(json) {
  if (!json || json.ok !== true) throw new Error(`Tankerkönig: ${json?.message || 'invalid response'}`);
  return json;
}

// list.php → normalised stations. Handles type=all (e5/e10/diesel) and a
// single type (`price`).
export function parseList(json, type = 'all') {
  check(json);
  return (json.stations || []).map((s) => ({
    id: s.id,
    name: clean(s.name),
    brand: clean(s.brand),
    street: address(s),
    place: clean(s.place),
    lat: s.lat,
    lng: s.lng,
    dist: typeof s.dist === 'number' ? s.dist : null,
    open: s.isOpen !== false,
    prices: Object.fromEntries(TYPES.map((k) => [k, price(type === 'all' ? s[k] : k === type ? s.price : null)])),
  }));
}

// prices.php → { id: { open, status, prices } }
export function parsePrices(json) {
  check(json);
  const out = {};
  for (const [id, p] of Object.entries(json.prices || {})) {
    out[id] = { status: p.status, open: p.status === 'open', prices: Object.fromEntries(TYPES.map((k) => [k, price(p[k])])) };
  }
  return out;
}

// detail.php → station meta data (prices there are not used).
export function parseDetail(json) {
  check(json);
  const s = json.station || {};
  return { id: s.id, name: clean(s.name), brand: clean(s.brand), street: address(s), place: clean(s.place), lat: s.lat, lng: s.lng };
}

const byNull = (a, b) => (a === null) - (b === null) || (a ?? 0) - (b ?? 0);

// Filter by fuel types / opening state, sort and cap.
export function selectStations(stations, { fuelTypes, sort = 'price', maxStations = 5, onlyOpen = true }) {
  const types = fuelTypes.length ? fuelTypes : TYPES;
  const main = types[0];
  return stations
    .filter((s) => !onlyOpen || s.open)
    .filter((s) => types.some((k) => s.prices[k] !== null))
    .sort((a, b) =>
      sort === 'price'
        ? byNull(a.open ? a.prices[main] : null, b.open ? b.prices[main] : null) || byNull(a.dist, b.dist)
        : byNull(a.dist, b.dist) || byNull(a.prices[main], b.prices[main]),
    )
    .slice(0, maxStations);
}

// Cheapest open station per fuel type: { e5: { price, id } | null, ... }
export function cheapestOf(stations, fuelTypes) {
  const out = {};
  for (const k of fuelTypes) {
    let best = null;
    for (const s of stations) {
      const p = s.open ? s.prices[k] : null;
      if (p !== null && (!best || p < best.price)) best = { price: p, id: s.id };
    }
    out[k] = best;
  }
  return out;
}

const ttlOf = (settings) => Math.max(MIN_TTL, (Number(settings.refreshSeconds) || 600) - 15);
const get = (path, params, key, ttl) =>
  cached(`tk:${key}`, ttl, async () => check(await fetchJson(`${API}/${path}?${new URLSearchParams(params)}`)));

async function nearby(settings, loc, apikey) {
  const params = { lat: loc.lat.toFixed(4), lng: loc.lon.toFixed(4), rad: String(Math.min(25, Math.max(1, settings.radius))), sort: 'dist', type: 'all', apikey };
  const json = await get('list.php', params, `list:${params.lat}:${params.lng}:${params.rad}:${apikey}`, ttlOf(settings));
  return parseList(json, 'all');
}

async function selected(settings, loc, apikey, t) {
  const entries = [];
  const seen = new Set();
  for (const e of settings.stations || []) {
    const id = clean(e.id).toLowerCase();
    if (!UUID.test(id) || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, custom: clean(e.name) });
  }
  if (!entries.length) return [];
  const list = entries.slice(0, 10); // prices.php accepts at most 10 ids
  const ids = list.map((e) => e.id).join(',');
  const prices = parsePrices(await get('prices.php', { ids, apikey }, `prices:${ids}:${apikey}`, ttlOf(settings)));
  // Station details change rarely – one request per station and day.
  const details = await Promise.all(
    list.map((e) => get('detail.php', { id: e.id, apikey }, `detail:${e.id}:${apikey}`, 86400).then(parseDetail).catch(() => null)),
  );
  return list.map((e, i) => {
    const d = details[i] || {};
    const p = prices[e.id] || { open: false, status: 'no stations', prices: { e5: null, e10: null, diesel: null } };
    const dist = Number.isFinite(d.lat) && Number.isFinite(d.lng) ? Math.round(haversineKm(loc.lat, loc.lon, d.lat, d.lng) * 10) / 10 : null;
    return {
      id: e.id,
      name: e.custom || d.name || t('Unknown station'),
      brand: e.custom ? '' : d.brand || '',
      custom: !!e.custom,
      street: d.street || '',
      place: d.place || '',
      lat: d.lat ?? null,
      lng: d.lng ?? null,
      dist,
      open: p.open,
      prices: p.prices,
    };
  });
}

export async function provider(settings, cfg) {
  const t = translator(langOf(cfg.general.locale));
  const apikey = clean(settings.apiKey);
  if (!apikey) throw new Error(t('No Tankerkönig API key set'));
  const fuelTypes = (settings.fuelTypes || []).filter((k) => TYPES.includes(k));
  const types = fuelTypes.length ? fuelTypes : TYPES;
  const loc = resolveLocation(settings, cfg.general);
  const all = settings.mode === 'stations' ? await selected(settings, loc, apikey, t) : await nearby(settings, loc, apikey);
  const stations = selectStations(all, { fuelTypes: types, sort: settings.sort, maxStations: settings.maxStations, onlyOpen: settings.onlyOpen });
  return {
    mode: settings.mode,
    fuelTypes: types,
    location: loc.name || '',
    stations: stations.map(({ lat, lng, ...s }) => s),
    cheapest: cheapestOf(stations, types),
  };
}

export const fuel = provider;
