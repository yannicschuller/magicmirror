// "Night sky": visible ISS passes (SGP4 on a CelesTrak TLE), planets and moon
// for tonight, close conjunctions and meteor shower peaks. Everything except the
// TLE is computed locally – satellite.js (MIT) for SGP4, astronomy-engine (MIT)
// for planets and the moon.
//
// CelesTrak asks clients not to download the same element set more than once
// per update (~2 h) and blocks IPs that keep requesting failing URLs. The TLE is
// therefore kept for 12 h (stale copies up to 7 days are used when the fetch
// fails) and a failed fetch is not retried for 30 min.
import * as sat from 'satellite.js';
import * as Astronomy from 'astronomy-engine';
import { translator, langOf } from '../../public/shared/i18n.js';
import { resolveLocation } from '../../public/shared/modules.js';
import { sunPosition, moonIllumination } from '../../public/shared/astro.js';
import { cached, fetchText, dateKey } from '../util.js';

// Errors carry their message id so provider() can translate them.
function fail(id, params) {
  const err = new Error(translator('en')(id, params));
  err.msgId = id;
  err.params = params;
  return err;
}

const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE';
const TLE_TTL = 12 * 3600 * 1000;
const TLE_MAX_AGE = 7 * 86400 * 1000;
const TLE_RETRY = 30 * 60 * 1000;
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const rad = Math.PI / 180;
const norm360 = (x) => ((x % 360) + 360) % 360;
const round1 = (x) => Math.round(x * 10) / 10;
const iso = (ms) => new Date(ms).toISOString();

// ---- helpers -------------------------------------------------------------------

export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Azimuth in degrees (0 = N, 90 = E) → 8-point compass id. */
export const compass = (az) => COMPASS[Math.round(norm360(az) / 45) % 8];

/** Rough brightness category of an ISS pass from its highest elevation. */
export function brightness(maxEl) {
  if (maxEl >= 50) return 'very bright';
  if (maxEl >= 25) return 'bright';
  return 'moderate';
}

/** "Name\nline1\nline2" (name optional) → { name, line1, line2 }. */
export function parseTle(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const i = lines.findIndex((l) => l.startsWith('1 '));
  if (i < 0 || !lines[i + 1]?.startsWith('2 ')) throw fail('Invalid ISS orbit data');
  return { name: i > 0 ? lines[i - 1].trim() : 'ISS', line1: lines[i], line2: lines[i + 1] };
}

// ---- ISS passes ----------------------------------------------------------------

const defaultSunAltitude = (lat, lon) => (date) => sunPosition(date, lat, lon).altitude;
// Lit when less than half of the sun's disc is hidden by the earth.
const defaultSunlit = (eci, date) => sat.shadowFraction(sat.sunPos(sat.jday(date)).rsun, eci) < 0.5;

function lookFn(satrec, obs) {
  const geo = { latitude: obs.lat * rad, longitude: obs.lon * rad, height: (obs.height || 0) / 1000 };
  return (ms) => {
    const date = new Date(ms);
    const pv = sat.propagate(satrec, date);
    if (!pv?.position) return null;
    const ecf = sat.eciToEcf(pv.position, sat.gstime(date));
    const la = sat.ecfToLookAngles(geo, ecf);
    return { t: ms, el: la.elevation / rad, az: norm360(la.azimuth / rad), eci: pv.position };
  };
}

/**
 * All passes above the horizon between `from` and `to` (Date or ms).
 * A sample is *visible* when the ISS is above the horizon, sunlit and the
 * observer's sun altitude is below `twilight`. For visible passes start/end/max
 * describe the visible part (like Heavens-Above), otherwise the whole pass.
 * Passes whose (visible) max elevation is below `minElevation` are dropped.
 * `sunAltitude(date)` and `sunlit(eci, date)` can be replaced (tests).
 */
export function findPasses(satrec, obs, from, to, opts = {}) {
  const {
    minElevation = 10,
    twilight = -6,
    step = 30000,
    sample = 5000,
    trackUntil = 0,
    sunAltitude = defaultSunAltitude(obs.lat, obs.lon),
    sunlit = defaultSunlit,
  } = opts;
  const look = lookFn(satrec, obs);
  const elAt = (ms) => look(ms)?.el ?? -90;
  // Elevation zero crossing between a (sign sa) and b.
  const cross = (a, b) => {
    const up = elAt(a) < 0;
    for (let i = 0; i < 8; i++) {
      const m = (a + b) / 2;
      if ((elAt(m) < 0) === up) a = m; else b = m;
    }
    return (a + b) / 2;
  };
  const t0 = +from, t1 = +to;
  const passes = [];
  let prev = elAt(t0);
  let rise = prev >= 0 ? t0 : null;
  for (let t = t0 + step; t <= t1; t += step) {
    const el = elAt(t);
    if (prev < 0 && el >= 0) rise = cross(t - step, t);
    else if (prev >= 0 && el < 0 && rise !== null) {
      const pass = describe(look, rise, cross(t - step, t), { minElevation, twilight, sample, trackUntil, sunAltitude, sunlit });
      if (pass) passes.push(pass);
      rise = null;
    }
    prev = el;
  }
  return passes;
}

function describe(look, rise, set, o) {
  const samples = [];
  for (let t = rise; t < set; t += o.sample) {
    const p = look(t);
    if (!p) continue;
    const date = new Date(t);
    p.visible = p.el >= 0 && o.sunAltitude(date) < o.twilight && o.sunlit(p.eci, date);
    samples.push(p);
  }
  const end = look(set);
  if (end) samples.push({ ...end, visible: samples.at(-1)?.visible && end.el >= -0.5 });
  if (!samples.length) return null;
  const first = samples.findIndex((p) => p.visible);
  const last = samples.findLastIndex((p) => p.visible);
  const visible = first >= 0 && last > first;
  const seg = visible ? samples.slice(first, last + 1) : samples;
  const max = seg.reduce((a, b) => (b.el > a.el ? b : a));
  if (max.el < o.minElevation) return null;
  const a = seg[0], b = seg.at(-1);
  const pass = {
    start: iso(a.t),
    startAz: Math.round(a.az),
    startDir: compass(a.az),
    startEl: Math.round(Math.max(0, a.el)),
    max: iso(max.t),
    maxEl: Math.round(max.el),
    maxAz: Math.round(max.az),
    maxDir: compass(max.az),
    end: iso(b.t),
    endAz: Math.round(b.az),
    endDir: compass(b.az),
    endEl: Math.round(Math.max(0, b.el)),
    duration: Math.round((b.t - a.t) / 1000),
    visible,
    brightness: visible ? brightness(max.el) : null,
  };
  // Coarse track for "look NW" while the pass is running (only for passes soon).
  if (a.t < o.trackUntil) pass.track = seg.filter((_, i) => i % 6 === 0 || i === seg.length - 1).map((p) => [Math.round((p.t - a.t) / 1000), Math.round(p.az), Math.round(p.el)]);
  return pass;
}

// ---- planets, moon, events -----------------------------------------------------

export const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
const PLANET_MIN_ALT = 5;

function horizon(body, date, observer) {
  const eq = Astronomy.Equator(body, date, observer, true, true);
  const h = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
  return { alt: h.altitude, az: h.azimuth, ra: eq.ra, dec: eq.dec };
}

const sunAlt = (date, observer) => horizon(Astronomy.Body.Sun, date, observer).alt;
const searchSun = (observer, dir, from, days, alt) => Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, dir, from, days, alt)?.date ?? null;

/**
 * Current or next dark window (sun below `twilight`) as { start, end } Dates.
 * null when it does not get dark within two days (polar summer). In polar
 * night `end` is capped at 24 h.
 */
export function nightWindow(observer, now, twilight = -6) {
  const n = new Date(+now);
  if (sunAlt(n, observer) < twilight) {
    const dusk = searchSun(observer, -1, new Date(+n - DAY), 1, twilight);
    const dawn = searchSun(observer, +1, n, 1, twilight);
    return { start: dusk && dusk <= n ? dusk : n, end: dawn || new Date(+n + DAY) };
  }
  const dusk = searchSun(observer, -1, n, 2, twilight);
  if (!dusk) return null;
  const dawn = searchSun(observer, +1, dusk, 1, twilight);
  return { start: dusk, end: dawn || new Date(+dusk + DAY) };
}

/** Planets above PLANET_MIN_ALT during the (rest of the) night: best time = highest point. */
export function planetsTonight(observer, night, now, stepMin = 10) {
  if (!night) return [];
  const from = Math.max(+now, +night.start), to = +night.end;
  const out = [];
  for (const name of PLANETS) {
    let best = null, first = null, last = null;
    for (let t = from; t <= to; t += stepMin * MIN) {
      const h = horizon(Astronomy.Body[name], new Date(t), observer);
      if (h.alt < PLANET_MIN_ALT) continue;
      first ??= t;
      last = t;
      if (!best || h.alt > best.alt) best = { ...h, t };
    }
    if (!best) continue;
    out.push({
      id: name.toLowerCase(),
      name,
      best: iso(best.t),
      alt: Math.round(best.alt),
      az: Math.round(best.az),
      dir: compass(best.az),
      mag: round1(Astronomy.Illumination(Astronomy.Body[name], new Date(best.t)).mag),
      from: iso(first),
      to: iso(last),
    });
  }
  return out.sort((a, b) => a.best.localeCompare(b.best));
}

export function moonInfo(observer, now) {
  const n = new Date(+now);
  const rise = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, +1, n, 2)?.date ?? null;
  const set = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, -1, n, 2)?.date ?? null;
  const h = horizon(Astronomy.Body.Moon, n, observer);
  const ill = moonIllumination(n);
  return {
    rise: rise && iso(+rise),
    set: set && iso(+set),
    fraction: Math.round(ill.fraction * 100) / 100,
    phase: Math.round(ill.phase * 1000) / 1000,
    waxing: ill.waxing,
    name: ill.name,
    up: h.alt > 0,
    alt: Math.round(h.alt),
    dir: compass(h.az),
  };
}

// Angular distance between two RA (hours) / Dec (degrees) positions, degrees.
export function separation(a, b) {
  const ra1 = a.ra * 15 * rad, ra2 = b.ra * 15 * rad, d1 = a.dec * rad, d2 = b.dec * rad;
  const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, c))) / rad;
}

/** Closest approach per pair (moon + planets) within `maxDeg`, both bodies up in the dark, over `nights` nights. */
export function conjunctions(observer, now, { nights = 7, maxDeg = 3, stepMin = 30 } = {}) {
  const bodies = ['Moon', ...PLANETS];
  const bestByPair = new Map();
  let night = nightWindow(observer, now);
  for (let k = 0; k < nights && night; k++) {
    for (let t = Math.max(+now, +night.start); t <= +night.end; t += stepMin * MIN) {
      const date = new Date(t);
      const pos = bodies.map((b) => horizon(Astronomy.Body[b], date, observer));
      for (let i = 0; i < bodies.length; i++) {
        if (pos[i].alt < PLANET_MIN_ALT) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          if (pos[j].alt < PLANET_MIN_ALT) continue;
          const sep = separation(pos[i], pos[j]);
          const key = `${bodies[i]}|${bodies[j]}`;
          if (sep <= maxDeg && (!bestByPair.has(key) || sep < bestByPair.get(key).sep)) {
            bestByPair.set(key, { type: 'conjunction', a: bodies[i], b: bodies[j], sep: round1(sep), at: iso(t), alt: Math.round(Math.min(pos[i].alt, pos[j].alt)), dir: compass(pos[i].az) });
          }
        }
      }
    }
    night = nightWindow(observer, new Date(+night.end + HOUR));
  }
  return [...bestByPair.values()].sort((a, b) => a.at.localeCompare(b.at));
}

// Major annual meteor showers (IMO calendar; peak dates shift by about a day between years).
export const METEOR_SHOWERS = [
  { name: 'Quadrantids', month: 1, day: 3, zhr: 80 },
  { name: 'Lyrids', month: 4, day: 22, zhr: 18 },
  { name: 'Eta Aquariids', month: 5, day: 6, zhr: 50 },
  { name: 'Southern Delta Aquariids', month: 7, day: 30, zhr: 25 },
  { name: 'Perseids', month: 8, day: 12, zhr: 100 },
  { name: 'Draconids', month: 10, day: 8, zhr: 10 },
  { name: 'Orionids', month: 10, day: 21, zhr: 20 },
  { name: 'Leonids', month: 11, day: 17, zhr: 15 },
  { name: 'Geminids', month: 12, day: 14, zhr: 150 },
  { name: 'Ursids', month: 12, day: 22, zhr: 10 },
];

/** Meteor shower peaks from yesterday up to `days` ahead (local dates in `tz`). */
export function meteorShowers(now, tz, days = 14) {
  const today = dateKey(now, tz);
  const year = +today.slice(0, 4);
  const lo = Date.parse(`${today}T00:00:00Z`) - DAY;
  const hi = Date.parse(`${today}T00:00:00Z`) + days * DAY;
  const out = [];
  for (const y of [year, year + 1]) {
    for (const s of METEOR_SHOWERS) {
      const peak = Date.UTC(y, s.month - 1, s.day);
      if (peak < lo || peak > hi) continue;
      out.push({ type: 'meteor', name: s.name, peak: new Date(peak).toISOString().slice(0, 10), zhr: s.zhr, moon: Math.round(moonIllumination(new Date(peak + DAY)).fraction * 100) / 100 });
    }
  }
  return out.sort((a, b) => a.peak.localeCompare(b.peak));
}

// ---- TLE download --------------------------------------------------------------

let tle = null; // { text, fetched }
let tleFailedAt = 0;
let tlePending = null;

async function loadTle(now = Date.now()) {
  if (tle && now - tle.fetched < TLE_TTL) return tle.text;
  if (now - tleFailedAt < TLE_RETRY) {
    if (tle && now - tle.fetched < TLE_MAX_AGE) return tle.text;
    throw fail('ISS orbit data unavailable');
  }
  tlePending ??= (async () => {
    try {
      const text = await fetchText(TLE_URL);
      parseTle(text);
      tle = { text, fetched: Date.now() };
      return text;
    } catch (err) {
      tleFailedAt = Date.now();
      console.warn(`[nightsky] TLE: ${err.message}`);
      if (tle && Date.now() - tle.fetched < TLE_MAX_AGE) return tle.text;
      throw fail('ISS orbit data unavailable');
    } finally {
      tlePending = null;
    }
  })();
  return tlePending;
}

// ---- provider ------------------------------------------------------------------

const clamp = (v, lo, hi, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

/** Pure part of the provider: everything for `now` with a given TLE text (or an error). */
export function buildNightSky(settings, { lat, lon, tz = 'Europe/Berlin', now = new Date(), tleText = null, tleError = null } = {}) {
  const observer = new Astronomy.Observer(lat, lon, 0);
  const days = clamp(settings.issDays, 1, 10, 3);
  const minElevation = clamp(settings.minElevation, 0, 80, 10);
  const maxPasses = clamp(settings.maxPasses, 1, 20, 5);
  const night = nightWindow(observer, now);
  const out = {
    night: night && { start: iso(+night.start), end: iso(+night.end) },
    soonHours: clamp(settings.soonHours, 1, 48, 6),
    iss: { days, passes: [] },
  };

  if (tleText) {
    const { line1, line2 } = parseTle(tleText);
    const satrec = sat.twoline2satrec(line1, line2);
    const from = +now - 15 * MIN; // keep a pass that is running right now
    let passes = findPasses(satrec, { lat, lon }, from, +now + days * DAY, { minElevation, trackUntil: +now + DAY });
    passes = passes.filter((p) => Date.parse(p.end) > +now);
    if (settings.onlyVisible !== false) passes = passes.filter((p) => p.visible);
    out.iss.passes = passes.slice(0, maxPasses);
    out.iss.tleEpoch = iso((satrec.jdsatepoch - 2440587.5) * DAY + (satrec.jdsatepochF || 0) * DAY);
  } else if (tleError) out.iss.error = tleError;

  if (settings.showPlanets !== false) out.planets = planetsTonight(observer, night, now);
  if (settings.showMoon !== false) out.moon = moonInfo(observer, now);
  if (settings.showEvents !== false) {
    out.events = [
      ...conjunctions(observer, now, { nights: 7, maxDeg: clamp(settings.conjunctionDeg, 0.5, 10, 3) }),
      ...meteorShowers(now, tz, 14),
    ];
  }
  return out;
}

export async function provider(settings, cfg) {
  const t = translator(langOf(cfg.general.locale));
  const loc = resolveLocation(settings, cfg.general);
  const tz = cfg.general.timezone || 'Europe/Berlin';
  let tleText = null, tleError = null;
  try {
    tleText = await loadTle();
  } catch (err) {
    tleError = err.msgId ? t(err.msgId, err.params) : err.message;
  }
  const key = ['nightsky', loc.lat.toFixed(3), loc.lon.toFixed(3), tz, cfg.general.locale, JSON.stringify(settings), tleText ? tleText.length + tleText.slice(-40) : tleError].join(':');
  try {
    // The mirror polls every 30 min; recompute at most every 10 min per configuration.
    return await cached(key, 600, async () => ({ location: loc.name || '', ...buildNightSky(settings, { lat: loc.lat, lon: loc.lon, tz, tleText, tleError }) }));
  } catch (err) {
    if (err.msgId) throw new Error(t(err.msgId, err.params));
    throw err;
  }
}

export const nightsky = provider;
