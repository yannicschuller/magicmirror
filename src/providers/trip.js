// Public transport for the calendar's "time to leave" card: one EFA trip request
// (XML_TRIP_REQUEST2, rapidJSON) from the mirror to the event, arriving by
// "event start − buffer". Results (and failures) are cached for 3 minutes; the
// request is only made inside the card's time window (see route.js).
import { fetchJson } from '../util.js';
import { EFA_PRESETS, transitBaseUrl } from '../../public/shared/modules.js';
import { EFA_CLASS } from './transit.js';

const TRIP_TTL = 3 * 60 * 1000;
const MAX_ENTRIES = 100;
const MAX_POINTS = 200; // all legs together
const COORD = 'WGS84[dd.ddddd]';

let deps = { fetchJson, now: () => Date.now() };
const cache = new Map();
const logged = new Set();

// For tests: swap fetch/clock and clear the cache.
export function __setTripDeps(over = {}) {
  deps = { ...deps, ...over };
  cache.clear();
  logged.clear();
}

// ---- network choice --------------------------------------------------------------------------

// EFA base URL for the card: the module's own choice, else the network of the first EFA
// departures module, else VVS (most EFA servers also route outside their region).
export function travelTransitBase(s, modules = []) {
  const net = s.travelTransitNetwork || '';
  if (net === 'custom') return transitBaseUrl({ provider: 'efa', efaPreset: 'custom', baseUrl: s.travelTransitUrl || '' });
  if (net && EFA_PRESETS.some((p) => p.value === net)) return transitBaseUrl({ provider: 'efa', efaPreset: net });
  const dep = (modules || []).find((m) => m?.type === 'transit' && m.enabled !== false && (m.settings?.provider || 'efa') === 'efa');
  const url = dep ? transitBaseUrl({ provider: 'efa', efaPreset: dep.settings?.efaPreset || 'vvs', baseUrl: dep.settings?.baseUrl }) : '';
  return url || transitBaseUrl({ provider: 'efa', efaPreset: 'vvs' });
}

// ---- parsing (exported for tests) ------------------------------------------------------------

// Footpaths (also short walks between platforms) have product class 99/100 or the name "footpath".
export function isFootpath(leg) {
  const p = leg?.transportation?.product;
  if (!p) return !leg?.transportation?.number && !leg?.transportation?.disassembledName;
  return p.class === 99 || p.class === 100 || /^(footpath|fu(ß|ss)weg)$/i.test(p.name || '');
}

// "Leipzig, Hauptbahnhof" / platform "1" of "S-Bf. Plagwitz" → "Hauptbahnhof" / "S-Bf. Plagwitz".
function stopName(o = {}) {
  if (o.type === 'platform' && o.parent) return o.parent.disassembledName || String(o.parent.name || '').replace(/^[^,]+,\s*/, '');
  if (o.disassembledName) return o.disassembledName;
  return String(o.name || '').replace(/^\([^)]*\),\s*/, '').replace(/^[^,]+,\s*/, '');
}

const r5 = (n) => Math.round(Number(n) * 1e5) / 1e5;
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const delayMin = (planned, est) => (est && planned ? Math.round((ms(est) - ms(planned)) / 60000) : 0);

function coordsOf(leg) {
  const c = Array.isArray(leg.coords) ? leg.coords : [];
  // coordOutputFormat=WGS84[dd.ddddd] → [lat, lon]
  return c.filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))).map(([lat, lon]) => [r5(lat), r5(lon)]);
}

// Evenly thins each leg so that all legs together have max. `n` points (first/last kept).
function thinLegs(legs, n = MAX_POINTS) {
  const total = legs.reduce((sum, l) => sum + l.coords.length, 0);
  if (total <= n) return legs;
  return legs.map((l) => {
    const k = Math.max(2, Math.floor((n * l.coords.length) / total));
    if (l.coords.length <= k) return l;
    const step = (l.coords.length - 1) / (k - 1);
    return { ...l, coords: Array.from({ length: k }, (_, i) => l.coords[Math.round(i * step)]) };
  });
}

// rapidJSON → [{ depart, arrive, interchanges, legs }] (times ISO, real-time preferred).
export function parseEfaTrip(json) {
  const out = [];
  for (const j of Array.isArray(json?.journeys) ? json.journeys : []) {
    const raw = Array.isArray(j.legs) ? j.legs : [];
    if (!raw.length) continue;
    const first = raw[0].origin || {};
    const last = raw[raw.length - 1].destination || {};
    const depart = first.departureTimeEstimated || first.departureTimePlanned;
    const arrive = last.arrivalTimeEstimated || last.arrivalTimePlanned;
    if (!Number.isFinite(ms(depart)) || !Number.isFinite(ms(arrive))) continue;
    const legs = [];
    for (const l of raw) {
      const o = l.origin || {};
      const d = l.destination || {};
      const coords = coordsOf(l);
      if (isFootpath(l)) {
        const sec = Number(l.duration) || (ms(d.arrivalTimePlanned) - ms(o.departureTimePlanned)) / 1000 || 0;
        const min = Math.round(sec / 60);
        if (min < 1 && legs.length && raw.indexOf(l) < raw.length - 1) continue; // platform change
        legs.push({ walk: true, min: Math.max(1, min), coords });
        continue;
      }
      const t = l.transportation || {};
      legs.push({
        line: String(t.disassembledName || t.number || t.name || '?'),
        category: EFA_CLASS[t.product?.class] ?? 'other',
        product: t.product?.name || '',
        direction: String(t.destination?.name || '').replace(/^[^,]+,\s*/, ''),
        from: {
          name: stopName(o),
          time: o.departureTimeEstimated || o.departureTimePlanned,
          delay: delayMin(o.departureTimePlanned, o.departureTimeEstimated),
          platform: String(o.properties?.platformName || o.properties?.platform || ''),
        },
        to: {
          name: stopName(d),
          time: d.arrivalTimeEstimated || d.arrivalTimePlanned,
          delay: delayMin(d.arrivalTimePlanned, d.arrivalTimeEstimated),
        },
        realtime: Array.isArray(l.realtimeStatus) && l.realtimeStatus.includes('MONITORED'),
        coords,
      });
    }
    const rides = legs.filter((l) => !l.walk).length;
    out.push({
      depart: new Date(ms(depart)).toISOString(),
      arrive: new Date(ms(arrive)).toISOString(),
      interchanges: Number.isFinite(j.interchanges) ? j.interchanges : Math.max(0, rides - 1),
      legs: thinLegs(legs),
    });
  }
  return out;
}

// The journey to recommend: of those arriving by `arriveByMs` (1 min tolerance – EFA adds
// seconds to footpaths), the one that leaves latest; if none is in time, the earliest arrival.
export function pickJourney(journeys, arriveByMs, toleranceMs = 60000) {
  if (!journeys?.length) return null;
  const inTime = journeys.filter((j) => Date.parse(j.arrive) <= arriveByMs + toleranceMs);
  if (inTime.length) return inTime.reduce((a, b) => (Date.parse(b.depart) > Date.parse(a.depart) || (b.depart === a.depart && Date.parse(b.arrive) < Date.parse(a.arrive)) ? b : a));
  return { ...journeys.reduce((a, b) => (Date.parse(b.arrive) < Date.parse(a.arrive) ? b : a)), late: true };
}

// ---- request ---------------------------------------------------------------------------------

// Local date/time of the mirror for itdDate/itdTime.
export function efaDateTime(epochMs, timeZone = 'Europe/Berlin') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(epochMs)).map((x) => [x.type, x.value]));
  return { date: `${p.year}${p.month}${p.day}`, time: `${p.hour}${p.minute}` };
}

const coordParam = (p) => `${Number(p.lon).toFixed(5)}:${Number(p.lat).toFixed(5)}:${COORD}`;

export function efaTripUrl(base, from, to, arriveByMs, timeZone) {
  const { date, time } = efaDateTime(arriveByMs, timeZone);
  const params = new URLSearchParams({
    outputFormat: 'rapidJSON', coordOutputFormat: COORD,
    type_origin: 'coord', name_origin: coordParam(from),
    type_destination: 'coord', name_destination: coordParam(to),
    itdDate: date, itdTime: time, itdTripDateTimeDepArr: 'arr',
    calcNumberOfTrips: '3', useRealtime: '1',
  });
  return `${base}XML_TRIP_REQUEST2?${params}`;
}

// Journeys from → to arriving around `arriveByMs` (or null when EFA fails / finds nothing).
export async function transitTrip(base, from, to, arriveByMs, { timeZone = 'Europe/Berlin' } = {}) {
  if (!base) return null;
  const url = efaTripUrl(base, from, to, Math.floor(arriveByMs / 60000) * 60000, timeZone);
  const hit = cache.get(url);
  if (hit && hit.expires > deps.now()) return hit.value;
  let value = null;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) URLs are allowed');
    const journeys = parseEfaTrip(await deps.fetchJson(url, { timeout: 15000 }));
    value = journeys.length ? journeys : null;
    if (!value) logOnce(`trip:${base}`, `no public transport connection found (${u.host})`);
  } catch (err) {
    logOnce(`triperr:${base}`, `public transport routing failed: ${err.message}`);
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(url, { value, expires: deps.now() + TRIP_TTL });
  return value;
}

function logOnce(key, msg) {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(`[calendar] ${msg}`);
}
