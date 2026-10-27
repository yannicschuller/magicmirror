import { cached, fetchJson, haversineKm } from '../util.js';
import { resolveLocation } from '../../public/shared/modules.js';

// Minimum seconds between calls to the free online APIs (daily request limits).
export const ONLINE_MIN_INTERVAL = 180;

const ONLINE = {
  adsblol: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`,
  airplaneslive: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`,
};
// adsb.lol's route API; adsb.im runs the same code (tar1090 uses it) and serves as fallback.
const ROUTESET_URLS = ['https://api.adsb.lol/api/0/routeset', 'https://adsb.im/api/0/routeset'];
const PHOTO_URL = 'https://api.planespotters.net/pub/photos';

// ICAO airline designator (first three letters of the callsign) → name.
// Deliberately small: the airlines you see most over Central Europe plus the big long-haul carriers.
export const AIRLINES = {
  AAL: 'American Airlines', ACA: 'Air Canada', AEA: 'Air Europa', AEE: 'Aegean Airlines', AFL: 'Aeroflot', AFR: 'Air France',
  AHO: 'Air Hamburg', AMC: 'Air Malta', ANA: 'All Nippon Airways', AUA: 'Austrian Airlines', AZA: 'ITA Airways', BAW: 'British Airways',
  BCS: 'European Air Transport (DHL)', BEL: 'Brussels Airlines', BOX: 'AeroLogic', BTI: 'airBaltic', CCA: 'Air China', CES: 'China Eastern',
  CFG: 'Condor', CLH: 'Lufthansa CityLine', CLX: 'Cargolux', CPA: 'Cathay Pacific', CSA: 'Czech Airlines', CSN: 'China Southern',
  CTN: 'Croatia Airlines', DAL: 'Delta Air Lines', DHK: 'DHL Air', DLA: 'Air Dolomiti', DLH: 'Lufthansa', EIN: 'Aer Lingus',
  ELY: 'El Al', ENT: 'Enter Air', EJU: 'easyJet Europe', ETD: 'Etihad Airways', ETH: 'Ethiopian Airlines', EVA: 'EVA Air',
  EWG: 'Eurowings', EXS: 'Jet2', EZS: 'easyJet Switzerland', EZY: 'easyJet', FDX: 'FedEx', FIN: 'Finnair', GEC: 'Lufthansa Cargo',
  GWI: 'Germanwings', HOP: 'Air France Hop', IBE: 'Iberia', IBK: 'Norwegian', ICE: 'Icelandair', JAL: 'Japan Airlines',
  KAL: 'Korean Air', KLM: 'KLM', LGL: 'Luxair', LOT: 'LOT Polish Airlines', MSR: 'EgyptAir', NAX: 'Norwegian', NOZ: 'Norwegian',
  NSZ: 'Norwegian', OAW: 'Helvetic Airways', PGT: 'Pegasus', QTR: 'Qatar Airways', RJA: 'Royal Jordanian', ROT: 'TAROM',
  RYR: 'Ryanair', RUK: 'Ryanair UK', SAS: 'SAS', SDM: 'Rossiya', SIA: 'Singapore Airlines', SWR: 'Swiss', SXS: 'SunExpress',
  TAP: 'TAP Air Portugal', TAY: 'ASL Airlines Belgium', THA: 'Thai Airways', THY: 'Turkish Airlines', TOM: 'TUI Airways',
  TRA: 'Transavia', TUI: 'TUIfly', TVF: 'Transavia France', UAE: 'Emirates', UAL: 'United Airlines', UPS: 'UPS Airlines',
  VLG: 'Vueling', VOE: 'Volotea', WZZ: 'Wizz Air', WMT: 'Wizz Air Malta', WUK: 'Wizz Air UK', MBU: 'Marabu', DCS: 'DC Aviation',
  GAF: 'German Air Force', NJE: 'NetJets Europe', LDM: 'Lauda Europe', SVA: 'Saudia', KZR: 'Air Astana', AIC: 'Air India',
  CAI: 'Corendon Airlines', CXI: 'Corendon Europe', BBT: 'Air Belgium', ABR: 'ASL Airlines Ireland', MSC: 'Air Cairo',
};

// Airline for a callsign: built-in table first, then the operator from the data source.
export function airlineFor(callsign, ownOp = '') {
  const m = /^([A-Z]{3})\d/.exec(String(callsign || '').trim().toUpperCase());
  if (m && AIRLINES[m[1]]) return AIRLINES[m[1]];
  return String(ownOp || '').trim();
}

// "AIRBUS A-320neo" → "Airbus A-320neo": readsb's type descriptions are all caps.
export function prettyType(desc) {
  return String(desc || '')
    .trim()
    .split(/\s+/)
    .map((w) => (/^[A-Z]{3,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// Initial great-circle bearing (0 = north) from point 1 to point 2.
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

// Aircraft eligible for the spotlight.
export function spotlightCandidates(aircraft, { airborneOnly = true, minAltitudeFt = 0, requireCallsign = false } = {}) {
  return aircraft.filter((a) => {
    if (airborneOnly && a.ground) return false;
    if (minAltitudeFt > 0 && (a.alt === null || a.alt < minAltitudeFt)) return false;
    if (requireCallsign && !a.callsign) return false;
    return true;
  });
}

/**
 * Nearest aircraft with hysteresis: the current one stays in the spotlight until it is gone
 * or another one is clearly closer (more than `ratio` AND more than `minGainKm` nearer).
 */
export function pickNearest(candidates, currentHex, { ratio = 0.1, minGainKm = 1 } = {}) {
  if (!candidates.length) return null;
  const nearest = candidates.reduce((best, a) => (a.dist < best.dist ? a : best));
  const current = currentHex && candidates.find((a) => a.hex === currentHex);
  if (!current || current === nearest) return nearest;
  const gain = current.dist - nearest.dist;
  return gain > current.dist * ratio && gain > minGainKm ? nearest : current;
}

// adsb.lol /api/0/routeset answer → { from, to, via } for one callsign (null when unknown).
export function parseRoute(json, callsign) {
  if (!Array.isArray(json)) return null;
  const r = json.find((x) => x && String(x.callsign || '').trim().toUpperCase() === callsign) || null;
  if (!r || !r.airport_codes || r.airport_codes === 'unknown') return null;
  const codes = String(r.airport_codes).split('-');
  const airports = Array.isArray(r._airports) ? r._airports : [];
  const ap = (icao) => {
    const a = airports.find((x) => x && x.icao === icao) || {};
    const lat = Number(a.lat);
    const lon = Number(a.lon);
    return { icao, iata: a.iata || '', name: a.name || '', city: a.location || '', country: a.countryiso2 || '', ...(Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon } : {}) };
  };
  if (codes.length < 2) return null;
  // `plausible: false` = the position doesn't fit the route (callsign reused, diverted, …): shown with a "?".
  return { from: ap(codes[0]), to: ap(codes[codes.length - 1]), via: codes.slice(1, -1).map(ap), plausible: r.plausible !== false };
}

// planespotters.net photo answer → { src, width, height, photographer, link } or null.
export function parsePhoto(json) {
  const p = json && Array.isArray(json.photos) ? json.photos[0] : null;
  const img = p && (p.thumbnail_large || p.thumbnail);
  if (!img || !/^https:\/\//.test(img.src || '')) return null;
  return {
    src: img.src,
    width: img.size?.width || null,
    height: img.size?.height || null,
    photographer: String(p.photographer || '').trim(),
    link: /^https:\/\//.test(p.link || '') ? p.link : 'https://www.planespotters.net/',
  };
}

// A failed lookup is cached as `null` too, so a missing route/photo isn't retried every refresh.
const orNull = (fn) => async () => {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[flights] ${err.message}`);
    return null;
  }
};

async function routeFor(a) {
  if (!a.callsign) return null;
  return cached(`flights:route:${a.callsign}`, 3600, orNull(async () => {
    const body = JSON.stringify({ planes: [{ callsign: a.callsign, lat: a.lat, lng: a.lon }] });
    let lastErr;
    for (const url of ROUTESET_URLS) {
      try {
        const json = await fetchJson(url, { method: 'POST', timeout: 6000, headers: { 'Content-Type': 'application/json' }, body });
        if (Array.isArray(json)) return parseRoute(json, a.callsign);
        lastErr = new Error(`unexpected route answer from ${new URL(url).host}`);
      } catch (err) {
        lastErr = err; // e.g. 429 or an empty body – try the next mirror
      }
    }
    throw lastErr;
  }));
}

async function photoFor(a) {
  if (!/^[0-9a-f]{6}$/i.test(a.hex || '')) return null;
  return cached(`flights:photo:${a.hex}`, 86400, orNull(async () => {
    let photo = parsePhoto(await fetchJson(`${PHOTO_URL}/hex/${a.hex.toLowerCase()}`, { timeout: 6000 }));
    if (!photo && /^[A-Z0-9-]{3,10}$/i.test(a.reg)) photo = parsePhoto(await fetchJson(`${PHOTO_URL}/reg/${encodeURIComponent(a.reg)}`, { timeout: 6000 }));
    return photo;
  }));
}

// Current spotlight aircraft per module (hysteresis state).
const spotState = new Map();

export function normalizeAircraft(list, loc) {
  return list
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && (a.seen_pos === undefined || a.seen_pos < 60))
    .map((a) => {
      const alt = a.alt_baro === 'ground' ? 0 : Number.isFinite(a.alt_baro) ? a.alt_baro : Number.isFinite(a.alt_geom) ? a.alt_geom : null;
      const callsign = (a.flight || '').trim();
      return {
        hex: a.hex,
        flight: callsign || a.r || a.hex?.toUpperCase(),
        callsign,
        reg: a.r || '',
        type: a.t || '',
        desc: prettyType(a.desc),
        ownOp: a.ownOp || '',
        lat: a.lat,
        lon: a.lon,
        alt,
        ground: a.alt_baro === 'ground',
        speed: Number.isFinite(a.gs) ? Math.round(a.gs * 1.852) : null,
        track: Number.isFinite(a.track) ? a.track : Number.isFinite(a.true_heading) ? a.true_heading : null,
        vrate: a.baro_rate ?? a.geom_rate ?? null,
        squawk: a.squawk || '',
        emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null,
        dist: haversineKm(loc.lat, loc.lon, a.lat, a.lon),
        bearing: Math.round(bearingDeg(loc.lat, loc.lon, a.lat, a.lon)),
      };
    });
}

export async function flights(settings, cfg, mod) {
  const loc = resolveLocation(settings, cfg.general);
  const lat = loc.lat.toFixed(3);
  const lon = loc.lon.toFixed(3);
  let list;
  if (settings.source === 'local') {
    const url = new URL(settings.localUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs are allowed');
    const data = await cached(`flights:local:${url}`, 2, () => fetchJson(url.toString(), { timeout: 5000 }));
    list = data.aircraft || data.ac || [];
  } else {
    const nm = Math.min(250, Math.ceil(settings.radiusKm / 1.852));
    const build = ONLINE[settings.source] || ONLINE.adsblol;
    // Online APIs are rate limited – never ask more often than every 5 s.
    // adsb.lol allows ~500 requests per day and IP – at most one call every 3 min keeps it running 24/7.
    const data = await cached(`flights:${settings.source}:${lat}:${lon}:${nm}`, Math.max(ONLINE_MIN_INTERVAL, settings.refreshSeconds - 1), () => fetchJson(build(lat, lon, nm), { timeout: 10000 }));
    list = data.ac || data.aircraft || [];
  }

  const aircraft = normalizeAircraft(list, loc)
    .filter((a) => a.dist <= settings.radiusKm)
    .filter((a) => !settings.maxAltitudeFt || a.alt === null || a.alt <= settings.maxAltitudeFt)
    .sort((a, b) => a.dist - b.dist);

  const result = { center: { lat: loc.lat, lon: loc.lon }, source: settings.source, aircraft };
  if (!settings.display || settings.display === 'map') return result;

  const stateKey = mod?.id || `${lat}:${lon}`;
  const candidates = spotlightCandidates(aircraft, {
    airborneOnly: settings.spotAirborneOnly !== false,
    minAltitudeFt: settings.spotMinAltitudeFt || 0,
    requireCallsign: !!settings.spotRequireCallsign,
  });
  const pick = pickNearest(candidates, spotState.get(stateKey));
  spotState.set(stateKey, pick?.hex || null);
  if (pick) {
    const [route, photo] = await Promise.all([
      settings.showRoute === false ? null : routeFor(pick),
      settings.showPhoto === false ? null : photoFor(pick),
    ]);
    result.spotlight = { ...pick, airline: airlineFor(pick.callsign, pick.ownOp), route, photo };
  } else {
    result.spotlight = null;
  }
  return result;
}
