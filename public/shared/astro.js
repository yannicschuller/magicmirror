// Compact sun & moon astronomy for the mirror (no network, no dependencies).
//
// Algorithms follow the well-known low-precision formulas from
// "Astronomy Answers" by Dr. Louis Strous (aa.quae.nl/en/reken/zonpositie.html,
// .../hemelpositie.html) as popularised by the SunCalc library
// (github.com/mourner/suncalc, BSD-2-Clause, © Vladimir Agafonkin) and the
// lunar longitude series from Jean Meeus, "Astronomical Algorithms" ch. 47
// (main periodic terms only). Re-implemented from the published formulas.
// Accuracy: sun times ±1 min, moon phase instants ±1 h, moonrise/-set ±5 min
// at mid latitudes – plenty for a mirror.

const PI = Math.PI;
const rad = PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = rad * 23.4397;

const toJulian = (date) => date.valueOf() / DAY_MS - 0.5 + J1970;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * DAY_MS);
const toDays = (date) => toJulian(date) - J2000;
const norm360 = (x) => ((x % 360) + 360) % 360;

const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const azimuthOf = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitudeOf = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;

function astroRefraction(h) {
  if (h < 0) h = 0; // formula only valid for positive altitudes
  return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}

// ---- sun ---------------------------------------------------------------------
const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
// `d` (optional) adds the precession of the perihelion so the longitude refers
// to the equinox of date (matches the moon series and the sidereal time below;
// without it new/full moon instants come out ~45 min early in 2026).
function eclipticLongitude(M, d = 0) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)); // equation of center
  const P = rad * (102.9372 + 0.0000470767 * d); // perihelion of the Earth
  return M + C + P + PI;
}
function sunCoords(d) {
  const L = eclipticLongitude(solarMeanAnomaly(d), d);
  return { dec: declination(L, 0), ra: rightAscension(L, 0), lon: L };
}

/** Sun position: altitude above horizon and compass azimuth (0 = N, 90 = E), both in degrees. */
export function sunPosition(date, lat, lon) {
  const lw = rad * -lon, phi = rad * lat, d = toDays(date);
  const c = sunCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  return { altitude: altitudeOf(H, phi, c.dec) / rad, azimuth: norm360(azimuthOf(H, phi, c.dec) / rad + 180) };
}

const J0 = 0.0009;
const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * PI));
const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h, phi, d) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
const observerAngle = (height) => (-2.076 * Math.sqrt(height)) / 60;

// [angle (deg), morning name, evening name]
const SUN_EVENTS = [
  [-0.833, 'sunrise', 'sunset'],
  [-6, 'dawn', 'dusk'],
  [-12, 'nauticalDawn', 'nauticalDusk'],
  [6, 'goldenHourEnd', 'goldenHour'],
];

/**
 * Sun events of the solar day closest to `date` (pass local noon for "today").
 * Events that do not happen (polar day/night) are null. `polar` is
 * 'day' | 'night' | null when the sun never sets / never rises.
 */
export function sunTimes(date, lat, lon, height = 0) {
  const lw = rad * -lon, phi = rad * lat;
  const dh = observerAngle(height);
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const Jnoon = solarTransitJ(ds, M, L);
  const out = { solarNoon: fromJulian(Jnoon), nadir: fromJulian(Jnoon - 0.5) };
  for (const [angle, rise, set] of SUN_EVENTS) {
    const h0 = (angle + dh) * rad;
    const w = hourAngle(h0, phi, dec);
    if (Number.isNaN(w)) { out[rise] = out[set] = null; continue; }
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
    const Jrise = Jnoon - (Jset - Jnoon);
    out[rise] = fromJulian(Jrise);
    out[set] = fromJulian(Jset);
  }
  const noonAlt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec)) / rad;
  out.polar = out.sunrise ? null : noonAlt > 0 ? 'day' : 'night';
  out.dayLength = out.sunrise ? out.sunset - out.sunrise : out.polar === 'day' ? DAY_MS : 0; // ms
  return out;
}

// ---- moon --------------------------------------------------------------------
// Geocentric ecliptic coordinates with the largest periodic terms (Meeus ch. 47).
function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d); // mean longitude
  const Mm = rad * (134.963 + 13.064993 * d); // mean anomaly
  const F = rad * (93.272 + 13.22935 * d); // argument of latitude
  const D = rad * (297.8502 + 12.19074912 * d); // mean elongation
  const Ms = solarMeanAnomaly(d);
  const l = L + rad * (6.289 * Math.sin(Mm) + 1.274 * Math.sin(2 * D - Mm) + 0.658 * Math.sin(2 * D)
    + 0.214 * Math.sin(2 * Mm) - 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F) + 0.059 * Math.sin(2 * D - 2 * Mm)
    + 0.057 * Math.sin(2 * D - Ms - Mm) + 0.053 * Math.sin(2 * D + Mm) + 0.046 * Math.sin(2 * D - Ms) + 0.041 * Math.sin(Ms - Mm)
    - 0.035 * Math.sin(D) - 0.031 * Math.sin(Ms + Mm));
  const b = rad * (5.128 * Math.sin(F) + 0.281 * Math.sin(Mm + F) + 0.278 * Math.sin(Mm - F) + 0.173 * Math.sin(2 * D - F));
  const dist = 385001 - 20905 * Math.cos(Mm) - 3699 * Math.cos(2 * D - Mm) - 2956 * Math.cos(2 * D); // km
  return { ra: rightAscension(l, b), dec: declination(l, b), lon: l, lat: b, dist };
}

/** Moon altitude (deg, incl. refraction) and compass azimuth. */
export function moonPosition(date, lat, lon) {
  const lw = rad * -lon, phi = rad * lat, d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitudeOf(H, phi, c.dec);
  const pa = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(c.dec) - Math.sin(c.dec) * Math.cos(H)); // parallactic angle
  h += astroRefraction(h);
  return { altitude: h / rad, azimuth: norm360(azimuthOf(H, phi, c.dec) / rad + 180), distance: c.dist, parallacticAngle: pa };
}

const SUN_DIST = 149598000; // km
// Elongation of the moon from the sun in ecliptic longitude, 0..360 (0 = new, 180 = full).
function elongation(date) {
  const d = toDays(date);
  return norm360((moonCoords(d).lon - sunCoords(d).lon) / rad);
}

export const PHASE_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
// A principal phase (new/quarter/full) is named within ±1 day of the exact instant.
const PRINCIPAL_WINDOW = 1 / 29.530589;

export function phaseName(phase) {
  for (let i = 0; i < 4; i++) {
    const center = i / 4;
    let diff = Math.abs(phase - center);
    diff = Math.min(diff, 1 - diff);
    if (diff <= PRINCIPAL_WINDOW) return PHASE_NAMES[i * 2];
  }
  return PHASE_NAMES[Math.floor(phase * 4) * 2 + 1];
}

/**
 * Moon illumination: fraction lit (0..1), phase (0 = new, .25 = first quarter,
 * .5 = full, .75 = last quarter), waxing flag and English phase name.
 */
export function moonIllumination(date) {
  const d = toDays(date);
  const m = moonCoords(d);
  const s = sunCoords(d);
  const cosPhi = Math.cos(m.lat) * Math.cos(m.lon - s.lon);
  const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi))); // geocentric elongation
  const inc = Math.atan2(SUN_DIST * Math.sin(phi), m.dist - SUN_DIST * Math.cos(phi)); // phase angle
  const phase = norm360((m.lon - s.lon) / rad) / 360;
  return { fraction: (1 + Math.cos(inc)) / 2, phase, waxing: phase < 0.5, name: phaseName(phase) };
}

/** Next instant after `date` when the moon reaches the given elongation (0 new, 90 first quarter, 180 full, 270 last quarter). */
export function nextMoonPhase(date, target) {
  const g = (t) => {
    const x = norm360(elongation(new Date(t)) - target);
    return x > 180 ? x - 360 : x; // signed distance, -180..180
  };
  const step = DAY_MS / 4;
  let a = date.valueOf();
  let ga = g(a);
  for (let i = 0; i < 4 * 32; i++) {
    const b = a + step;
    const gb = g(b);
    if (ga < 0 && gb >= 0 && gb - ga < 90) {
      let lo = a, hi = b;
      for (let k = 0; k < 30 && hi - lo > 1000; k++) {
        const mid = (lo + hi) / 2;
        if (g(mid) < 0) lo = mid; else hi = mid;
      }
      return new Date(Math.round((lo + hi) / 2));
    }
    a = b; ga = gb;
  }
  return null;
}

/**
 * Moonrise/moonset within 24 h after `start` (pass local midnight).
 * Hourly altitude samples with quadratic interpolation (as in SunCalc).
 */
export function moonTimes(start, lat, lon) {
  const t0 = start.valueOf();
  const hc = 0.133; // horizon correction (deg)
  const alt = (h) => moonPosition(new Date(t0 + h * 3600000), lat, lon).altitude - hc;
  let h0 = alt(0);
  let rise = null, set = null, ye;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = alt(i), h2 = alt(i + 1);
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a);
    ye = (a * xe + b) * xe + h1;
    const d = b * b - 4 * a * h1;
    let roots = 0, x1 = 0, x2 = 0;
    if (d >= 0) {
      const dx = Math.sqrt(d) / (Math.abs(a) * 2);
      x1 = xe - dx; x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1; else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }
    if (rise !== null && set !== null) break;
    h0 = h2;
  }
  const at = (h) => (h === null ? null : new Date(t0 + h * 3600000));
  return {
    rise: at(rise),
    set: at(set),
    alwaysUp: rise === null && set === null && ye > 0,
    alwaysDown: rise === null && set === null && ye <= 0,
  };
}

// ---- time zone helpers ---------------------------------------------------------
const offsetFmts = new Map();
/** Offset of `tz` from UTC at `date`, in ms. */
export function tzOffset(date, tz) {
  if (!offsetFmts.has(tz)) {
    offsetFmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  }
  const p = Object.fromEntries(offsetFmts.get(tz).formatToParts(date).map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(date.valueOf() / 1000) * 1000;
}

/** Local midnight (start of the calendar day) in `tz` for the day containing `date`, shifted by `dayOffset` days. */
export function startOfDay(date, tz, dayOffset = 0) {
  const local = new Date(date.valueOf() + tzOffset(date, tz));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset);
  let t = guess - tzOffset(new Date(guess), tz);
  t = guess - tzOffset(new Date(t), tz); // second pass for DST transitions
  return new Date(t);
}

/**
 * Everything the "sky" module shows, for `now` at lat/lon in time zone `tz`.
 * Pure function – the renderer calls it every minute.
 */
export function skyData(now, lat, lon, tz) {
  const midnight = startOfDay(now, tz);
  const noon = new Date(midnight.valueOf() + DAY_MS / 2);
  const sun = sunTimes(noon, lat, lon);
  const yesterday = sunTimes(new Date(noon.valueOf() - DAY_MS), lat, lon);
  const moon = moonIllumination(now);
  return {
    sun,
    sunPos: sunPosition(now, lat, lon),
    dayLength: sun.dayLength,
    dayLengthDelta: sun.dayLength - yesterday.dayLength,
    moon,
    moonPos: moonPosition(now, lat, lon),
    moonTimes: moonTimes(midnight, lat, lon),
    nextFull: nextMoonPhase(now, 180),
    nextNew: nextMoonPhase(now, 0),
  };
}
