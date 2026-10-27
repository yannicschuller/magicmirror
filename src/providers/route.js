// "Time to leave" helper for the calendar: geocodes an event's LOCATION text
// (Nominatim) and routes there from the mirror (OSRM). API usage stays tiny:
// geocoding results (and misses) are cached for 30 days, routes for 10 min, and
// Nominatim requests are serialized to max. 1 per second (usage policy). The
// app's User-Agent (with contact URL) is sent by util.js.
import { fetchJson, haversineKm } from '../util.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// OSRM demo servers (no live traffic!). FOSSGIS hosts bike and foot profiles.
export const ROUTERS = {
  car: 'https://router.project-osrm.org/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
};
// Cautious (low) average straight-line speeds in km/h: give an upper bound for the
// travel time, used to skip routing calls for events that are still far away.
const MIN_SPEED = { car: 25, bike: 9, foot: 3.5 };
export const MAX_HOURS = 4; // longer trips are not considered

const GEO_TTL = 30 * 86400 * 1000;
const GEO_ERROR_TTL = 3600 * 1000; // network/HTTP errors: retry after an hour
const ROUTE_TTL = 10 * 60 * 1000;
const MAX_ENTRIES = 300;
export const MAX_POINTS = 200;
export const MARGIN_MIN = 15; // compute this much earlier than needed (the calendar refreshes every 10 min)
const MAX_CANDIDATES = 3;
// Online meetings and the like: nothing to drive to.
const VIRTUAL = /https?:\/\/|www\.|\b(zoom|teams|microsoft teams|google meet|meet\.google|webex|skype|jitsi|online|virtuell|virtual|telefon|phone|call)\b/i;

let deps = { fetchJson, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), gapMs: 1100 };
const geoCache = new Map(); // key → { value, expires }
const routeCache = new Map();
const logged = new Set();
let queue = Promise.resolve();
let lastRequest = 0;

// For tests: swap fetch/sleep/clock and clear all caches.
export function __setDeps(over = {}) {
  deps = { ...deps, ...over };
  geoCache.clear();
  routeCache.clear();
  logged.clear();
  queue = Promise.resolve();
  lastRequest = 0;
}

function remember(map, key, value, ttl) {
  if (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value);
  map.set(key, { value, expires: deps.now() + ttl });
  return value;
}
function recall(map, key) {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.expires <= deps.now()) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

const logOnce = (key, msg) => {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(`[calendar] ${msg}`);
};

// Runs fn after all previously queued Nominatim requests, at least gapMs after the last one.
function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastRequest + deps.gapMs - deps.now();
    if (wait > 0) await deps.sleep(wait);
    try {
      return await fn();
    } finally {
      lastRequest = deps.now();
    }
  });
  queue = run.catch(() => {});
  return run;
}

// ---- parsing (exported for tests) ------------------------------------------------------------

export function parseNominatim(json) {
  const hit = Array.isArray(json) ? json[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Without a name: "50, Karl-Heine-Straße, …" → "Karl-Heine-Straße 50".
  const parts = String(hit.display_name || '').split(',').map((x) => x.trim());
  const label = hit.name || (/^\d+\w?$/.test(parts[0]) && parts[1] ? `${parts[1]} ${parts[0]}` : parts[0]) || '';
  return { lat, lon, label: String(label).trim() };
}

// Evenly thins a line to max. n points (first and last kept).
export function thin(points, n = MAX_POINTS) {
  if (points.length <= n) return points;
  const out = [];
  const step = (points.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(points[Math.round(i * step)]);
  return out;
}

export function parseOsrm(json) {
  const r = json?.code === 'Ok' ? json.routes?.[0] : null;
  if (!r || !Number.isFinite(r.duration)) return null;
  const coords = r.geometry?.coordinates || [];
  const geometry = thin(coords.map(([lon, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]));
  return { durationMin: Math.max(1, Math.round(r.duration / 60)), distanceKm: Math.round(r.distance / 100) / 10, geometry };
}

// ---- API calls -----------------------------------------------------------------------------

const normQuery = (q) => String(q || '').replace(/\s+/g, ' ').trim();

// Location text → { lat, lon, label } or null. `near` biases the search to the mirror's area.
export async function geocode(query, { near, lang = 'de' } = {}) {
  const q = normQuery(query);
  if (!q) return null;
  const key = `${q.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : ''}`;
  const hit = recall(geoCache, key);
  if (hit !== undefined) return hit;
  const pending = recall(geoCache, `pending:${key}`);
  if (pending) return pending;
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q, 'accept-language': lang });
  if (near) params.set('viewbox', [near.lon - 1, near.lat + 0.7, near.lon + 1, near.lat - 0.7].map((n) => n.toFixed(3)).join(','));
  const p = throttled(() => deps.fetchJson(`${NOMINATIM}?${params}`, { timeout: 10000 }))
    .then((json) => {
      const value = parseNominatim(json);
      if (!value) logOnce(`geo:${key}`, `no coordinates found for event location "${q}"`);
      return remember(geoCache, key, value, GEO_TTL);
    })
    .catch((err) => {
      logOnce(`geoerr:${key}`, `geocoding "${q}" failed: ${err.message}`);
      return remember(geoCache, key, null, GEO_ERROR_TTL);
    })
    .finally(() => geoCache.delete(`pending:${key}`));
  remember(geoCache, `pending:${key}`, p, 60000);
  return p;
}

const pt = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

// Route between two points → { durationMin, distanceKm, geometry: [[lat, lon], …] } or null.
export async function route(from, to, mode = 'car') {
  const base = ROUTERS[mode] || ROUTERS.car;
  const key = `${mode}|${pt(from)}|${pt(to)}`;
  const hit = recall(routeCache, key);
  if (hit !== undefined) return hit;
  try {
    const url = `${base}/${from.lon.toFixed(5)},${from.lat.toFixed(5)};${to.lon.toFixed(5)},${to.lat.toFixed(5)}?overview=simplified&geometries=geojson`;
    const value = parseOsrm(await deps.fetchJson(url, { timeout: 15000 }));
    if (!value) logOnce(`route:${key}`, `no ${mode} route found to ${pt(to)}`);
    return remember(routeCache, key, value, ROUTE_TTL);
  } catch (err) {
    logOnce(`routeerr:${mode}`, `routing failed: ${err.message}`);
    return remember(routeCache, key, null, 2 * 60 * 1000);
  }
}

// ---- window logic --------------------------------------------------------------------------

// Timed, upcoming events with a real place, early enough to possibly need the card:
// start − now ≤ lead + buffer + margin + maxHours (an upper bound for any trip).
export function travelCandidates(events, now, s, maxHours = MAX_HOURS) {
  const horizon = (s.travelLeadMinutes + s.travelBufferMinutes + MARGIN_MIN + maxHours * 60) * 60000;
  return events
    .filter((e) => !e.allDay && e.location && !VIRTUAL.test(e.location))
    .filter((e) => {
      const ms = new Date(e.start) - now;
      return ms > 0 && ms <= horizon;
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MAX_CANDIDATES);
}

// When to leave for an event (ms epoch).
export const leaveAtMs = (start, durationMin, bufferMin) => new Date(start).getTime() - (durationMin + bufferMin) * 60000;

// Payload window: from (leave − lead − margin) until the event starts.
export function inTravelWindow(now, start, leaveMs, leadMin, marginMin = MARGIN_MIN) {
  const t = now.getTime();
  return t >= leaveMs - (leadMin + marginMin) * 60000 && t < new Date(start).getTime();
}

// Card visible on the mirror: from (leave − lead) until the event starts.
export const showTravelCard = (now, travel) => now.getTime() >= Date.parse(travel.leaveAt) - travel.lead * 60000 && now < new Date(travel.start);

// Picks the next event that needs the card now (or within the refresh margin) and routes there.
// `events`: candidate events of non-busy-only calendars ({ title, location, start, allDay }).
export async function computeTravel(events, s, from, { now = new Date(deps.now()), lang = 'de' } = {}) {
  const mode = ROUTERS[s.travelMode] ? s.travelMode : 'car';
  const lead = Math.max(0, Number(s.travelLeadMinutes) || 0);
  const buffer = Math.max(0, Number(s.travelBufferMinutes) || 0);
  for (const e of travelCandidates(events, now, { travelLeadMinutes: lead, travelBufferMinutes: buffer })) {
    const to = await geocode(e.location, { near: from, lang });
    if (!to) continue;
    const km = haversineKm(from.lat, from.lon, to.lat, to.lon);
    if (km < 0.15) continue; // the event is here
    // Cheap pre-check: too early even for a slow trip → no routing call yet.
    const maxDuration = Math.min(MAX_HOURS * 60, (km / MIN_SPEED[mode]) * 60 + 10);
    if (!inTravelWindow(now, e.start, leaveAtMs(e.start, maxDuration, buffer), lead)) continue;
    const r = await route(from, to, mode);
    if (!r) continue;
    const leave = leaveAtMs(e.start, r.durationMin, buffer);
    if (!inTravelWindow(now, e.start, leave, lead)) continue;
    return {
      title: e.title,
      location: e.location,
      start: e.start,
      mode,
      lead,
      durationMin: r.durationMin,
      distanceKm: r.distanceKm,
      leaveAt: new Date(leave).toISOString(),
      geometry: r.geometry,
      from: { lat: from.lat, lon: from.lon },
      to: { lat: to.lat, lon: to.lon, label: to.label },
    };
  }
  return null;
}

// Address search for the admin's location fields (streets incl. house numbers).
// Same throttle/User-Agent as above; cached like geocoding.
export async function searchPlaces(query, { near, lang = 'de', limit = 6 } = {}) {
  const q = normQuery(query);
  if (q.length < 3) return [];
  const key = `list:${q.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : ''}`;
  const hit = recall(geoCache, key);
  if (hit !== undefined) return hit;
  const params = new URLSearchParams({ format: 'jsonv2', limit: String(limit), q, 'accept-language': lang, addressdetails: '1' });
  if (near) params.set('viewbox', [near.lon - 1, near.lat + 0.7, near.lon + 1, near.lat - 0.7].map((n) => n.toFixed(3)).join(','));
  const json = await throttled(() => deps.fetchJson(`${NOMINATIM}?${params}`, { timeout: 10000 }));
  const list = (Array.isArray(json) ? json : []).map((r) => {
    const a = r.address || {};
    const street = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
    const town = a.city || a.town || a.village || a.municipality || '';
    return {
      name: street || r.name || String(r.display_name || '').split(',')[0],
      region: [a.postcode, town, a.country].filter(Boolean).join(', '),
      lat: Number(r.lat),
      lon: Number(r.lon),
    };
  }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  return remember(geoCache, key, list, GEO_TTL);
}
