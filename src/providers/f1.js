import { translator, langOf } from '../../public/shared/i18n.js';
import { cached, fetchJson } from '../util.js';
import { TRACKS, computeLaps } from './f1-tracks.js';

const API = 'https://api.jolpi.ca/ergast/f1';
const SESSION_KEYS = [
  ['FirstPractice', 'Practice 1'],
  ['SecondPractice', 'Practice 2'],
  ['ThirdPractice', 'Practice 3'],
  ['SprintShootout', 'Sprint Quali'],
  ['SprintQualifying', 'Sprint Quali'],
  ['Sprint', 'Sprint'],
  ['Qualifying', 'Qualifying'],
];

const COUNTRY_DE = {
  Australia: 'Australien', Austria: 'Österreich', Azerbaijan: 'Aserbaidschan', Bahrain: 'Bahrain', Belgium: 'Belgien',
  Brazil: 'Brasilien', Canada: 'Kanada', China: 'China', Hungary: 'Ungarn', Italy: 'Italien', Japan: 'Japan',
  Mexico: 'Mexiko', Monaco: 'Monaco', Netherlands: 'Niederlande', Qatar: 'Katar', 'Saudi Arabia': 'Saudi-Arabien',
  Singapore: 'Singapur', Spain: 'Spanien', UAE: 'VAE', UK: 'Großbritannien', USA: 'USA', 'United States': 'USA',
  Germany: 'Deutschland', France: 'Frankreich', Portugal: 'Portugal', Turkey: 'Türkei', Russia: 'Russland',
};

const iso = (s) => (s?.date ? `${s.date}T${s.time || '12:00:00Z'}` : null);
const get = (path, ttl = 1800) => cached(`f1:${path}`, ttl, () => fetchJson(`${API}${path}`, { timeout: 20000 }));

async function schedule(season) {
  const data = await get(`/${season}.json?limit=100`, 3600);
  return data.MRData.RaceTable.Races || [];
}

async function trackWeather(race) {
  const lat = Number(race.Circuit.Location.lat);
  const lon = Number(race.Circuit.Location.long);
  const raceDay = race.date;
  const diffDays = (new Date(raceDay) - Date.now()) / 86400000;
  if (diffDays > 15 || diffDays < -1) return null;
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    start_date: raceDay,
    end_date: raceDay,
  });
  const data = await cached(`f1weather:${race.season}:${race.round}`, 3600, () => fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`));
  const d = data.daily;
  return { code: d.weather_code[0], max: d.temperature_2m_max[0], min: d.temperature_2m_min[0], pop: d.precipitation_probability_max[0], timezone: data.timezone };
}

const driverName = (d) => `${d.givenName} ${d.familyName}`;

// Track layouts: bacinger/f1-circuits (MIT, GeoJSON). Matched to the race by
// coordinates and turned into a small SVG path (equirectangular projection).
const CIRCUITS_URL = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson';

export function trackShape(feature) {
  const coords = feature.geometry.type === 'LineString' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const pts = coords.map(([lon, lat]) => [lon * k, -lat]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const scaled = pts.map(([x, y]) => [((x - minX) / span) * 100, ((y - minY) / span) * 100]);
  const w = Math.max(...scaled.map((p) => p[0]));
  const h = Math.max(...scaled.map((p) => p[1]));
  const d = scaled.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z';
  const p = feature.properties;
  return { d, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, start: scaled[0].map((v) => Math.round(v * 10) / 10), length: p.length || null, firstGp: p.firstgp || null, name: p.Name };
}

async function trackLayout(race) {
  const data = await cached('f1:circuits', 7 * 86400, () => fetchJson(CIRCUITS_URL, { timeout: 20000 }));
  const lat = Number(race.Circuit.Location.lat);
  const lon = Number(race.Circuit.Location.long);
  let best = null;
  for (const f of data.features) {
    const c = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat();
    const [flon, flat] = c[0];
    const dist = Math.hypot((flat - lat) * 111, (flon - lon) * 111 * Math.cos((lat * Math.PI) / 180));
    if (!best || dist < best.dist) best = { f, dist };
  }
  return best && best.dist < 8 ? trackShape(best.f) : null;
}

// ---- live timing (OpenF1) ------------------------------------------------------
// Free tier: historical data, 3 req/s and 30 req/min, no account. Data counts as
// "live" from 30 min before a session until 30 min after it ends – during that
// window the free tier may refuse requests (sponsor accounts only). Then we say
// so and show the final classification as soon as it is free (delayed).
const OPENF1 = 'https://api.openf1.org/v1';
const MIN = 60000;
// Rough session lengths (min) to know when a session is over before OpenF1 tells us.
const SESSION_MINUTES = { FirstPractice: 60, SecondPractice: 60, ThirdPractice: 60, SprintShootout: 45, SprintQualifying: 45, Sprint: 60, Qualifying: 60, Race: 150 };
const RACE_KEYS = new Set(['Race', 'Sprint']);
const COMPOUNDS = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
const LIVE_BEFORE = 10 * MIN; // start polling fast this long before a session
const DELAYED_FOR = 3 * 3600 * 1000; // show the delayed classification this long after the end

let queue = Promise.resolve();
// OpenF1 allows 3 requests per second – space our calls out.
function throttled(url) {
  const run = queue.then(() => fetchJson(url, { timeout: 15000 }));
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 350)));
  return run;
}
const of1 = (path, ttl) => cached(`of1:${path}`, ttl, () => throttled(`${OPENF1}${path}`));
const isoMin = (ms) => new Date(ms).toISOString().slice(0, 19);

// Which session of the weekend (if any) is running or just finished at `now`?
// Returns { session, phase: 'soon' | 'live' | 'after' } with the planned end.
export function liveSessionAt(sessions, now, ends = {}) {
  // the most recent session whose window has opened (a later session takes over)
  const s = [...sessions].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).filter((x) => Date.parse(x.start) - LIVE_BEFORE <= now).at(-1);
  if (!s) return null;
  const start = Date.parse(s.start);
  const end = ends[s.key] ?? start + (SESSION_MINUTES[s.key] || 60) * MIN;
  if (now > end + 30 * MIN + DELAYED_FOR) return null;
  const phase = now < start ? 'soon' : now <= end + 30 * MIN ? 'live' : 'after';
  return { session: s, phase, start, end, ended: now > end };
}

const fmtGap = (v) => (typeof v === 'number' ? (v === 0 ? '' : `+${v.toFixed(3)}`) : v ? String(v) : '');
const fmtLap = (sec) => {
  if (typeof sec !== 'number' || !sec) return '';
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(3).padStart(6, '0');
  return m ? `${m}:${s}` : s;
};
const colour = (c) => (/^[0-9a-f]{6}$/i.test(c || '') ? `#${c}` : null);
const byDriver = (rows = []) => {
  const m = new Map();
  for (const r of rows) m.set(r.driver_number, r); // OpenF1 returns rows in time order – last one wins
  return m;
};

function driverExtras({ stints = [], pit = [], drivers = [] }, lap = 0) {
  const stint = new Map();
  for (const s of stints) {
    if (lap && s.lap_start > lap) continue; // replay: stint not started yet
    if (!stint.has(s.driver_number) || s.stint_number >= stint.get(s.driver_number).stint_number) stint.set(s.driver_number, s);
  }
  const pits = new Map();
  for (const p of pit) pits.set(p.driver_number, (pits.get(p.driver_number) || 0) + 1);
  const drv = new Map(drivers.map((d) => [d.driver_number, d]));
  return (num) => {
    const d = drv.get(num) || {};
    const st = stint.get(num);
    return {
      num,
      code: d.name_acronym || String(num),
      name: d.full_name || '',
      team: d.team_name || '',
      color: colour(d.team_colour),
      tyre: st ? COMPOUNDS[st.compound] || '?' : null,
      pits: pits.get(num) || 0,
    };
  };
}

// Live order from /position (+ /intervals in races, best laps from /laps otherwise).
export function parseLive({ position = [], intervals = [], stints = [], pit = [], drivers = [], laps = [] }, { count = 10, race = true } = {}) {
  let lap = 0;
  for (const l of laps) lap = Math.max(lap, l.lap_number || 0);
  const extra = driverExtras({ stints, pit, drivers }, race ? lap : 0);
  const pos = byDriver(position);
  const iv = byDriver(intervals);
  const best = new Map();
  for (const l of laps) {
    if (l.lap_duration && !l.is_pit_out_lap && (!best.has(l.driver_number) || l.lap_duration < best.get(l.driver_number))) best.set(l.driver_number, l.lap_duration);
  }
  const order = [...pos.values()].sort((a, b) => a.position - b.position);
  const leaderBest = order.length ? best.get(order[0].driver_number) : null;
  const rows = order.slice(0, count).map((p, i) => {
    const row = { pos: p.position, ...extra(p.driver_number) };
    if (race) {
      const x = iv.get(p.driver_number);
      row.gap = i === 0 ? '' : fmtGap(x?.gap_to_leader);
      row.interval = i === 0 ? '' : fmtGap(x?.interval);
    } else {
      const b = best.get(p.driver_number);
      row.best = fmtLap(b);
      row.gap = i === 0 || !b || !leaderBest ? '' : fmtGap(Math.round((b - leaderBest) * 1000) / 1000);
    }
    return row;
  });
  return { rows, lap: race && lap ? lap : null };
}

// Final classification from /session_result (free ~30 min after the session).
export function parseSessionResult({ result = [], stints = [], pit = [], drivers = [] }, { count = 10 } = {}) {
  const extra = driverExtras({ stints, pit, drivers });
  const last = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).at(-1) : v);
  const rows = result
    .filter((r) => r.position)
    .sort((a, b) => a.position - b.position)
    .slice(0, count)
    .map((r, i) => ({ pos: r.position, ...extra(r.driver_number), gap: i === 0 ? '' : fmtGap(last(r.gap_to_leader)), best: fmtLap(last(r.duration)) }));
  return { rows };
}

async function openf1Session(s) {
  const start = Date.parse(s.start);
  const list = await of1(`/sessions?date_start>=${isoMin(start - 3 * 3600 * 1000)}&date_start<=${isoMin(start + 3 * 3600 * 1000)}`, 1800);
  let best = null;
  for (const x of list || []) {
    const d = Math.abs(Date.parse(x.date_start) - start);
    if (!best || d < best.d) best = { x, d };
  }
  return best && best.d <= 30 * MIN ? best.x : null;
}

// One slot only (no growing cache on the Pi): the live snapshot of the last ~15 s.
// Per 15 s: position, intervals, laps (+ stints/pit every 30 s) ≈ 16 requests/min.
let liveMemo = null;
function memoLive(id, fn) {
  if (liveMemo?.id === id) return liveMemo.promise;
  const promise = fn();
  liveMemo = { id, promise };
  promise.catch(() => liveMemo?.promise === promise && (liveMemo = null));
  return promise;
}

async function fetchLive(key, now, race) {
  const get1 = (path) => throttled(`${OPENF1}${path}`);
  // "now" may be in the past when replaying a session for checks
  const upTo = Math.abs(Date.now() - now) > 5 * MIN ? `&date<=${isoMin(now + MIN)}` : '';
  const position = await get1(`/position?session_key=${key}${upTo}`);
  if (!Array.isArray(position)) throw new Error('HTTP 403 (OpenF1: no access)');
  if (!position.length) return null;
  const drivers = await of1(`/drivers?session_key=${key}`, 3600);
  const stints = await of1(`/stints?session_key=${key}`, 30);
  const pit = await of1(`/pit?session_key=${key}${upTo}`, 30);
  const intervals = race ? await get1(`/intervals?session_key=${key}&date>=${isoMin(now - MIN)}&date<=${isoMin(now)}`) : [];
  const laps = race
    ? await get1(`/laps?session_key=${key}&date_start>=${isoMin(now - 4 * MIN)}&date_start<=${isoMin(now)}`)
    : await get1(`/laps?session_key=${key}&date_start<=${isoMin(now)}`);
  return parseLive({ position, intervals, stints, pit, drivers, laps }, { count: 22, race });
}

const restricted = new Map(); // session_key → retry time, so a refusing API isn't hammered

async function liveTiming(sessions, now, count) {
  let cur = liveSessionAt(sessions, now);
  if (!cur) return null;
  const base = { key: cur.session.key, label: cur.session.label };
  if (cur.phase === 'soon') return { ...base, status: 'soon' };
  const sess = await openf1Session(cur.session).catch(() => null);
  if (!sess) return cur.phase === 'live' ? { ...base, status: 'waiting' } : null;
  cur = liveSessionAt(sessions, now, { [cur.session.key]: Date.parse(sess.date_end) });
  if (!cur || cur.session.key !== base.key) return null;
  const key = sess.session_key;
  const race = RACE_KEYS.has(base.key);
  const blocked = (err) => /HTTP (401|403)/.test(err.message);
  if (cur.phase === 'live') {
    if ((restricted.get(key) || 0) > Date.now()) return { ...base, status: 'restricted' };
    try {
      const live = await memoLive(`${key}:${Math.floor(now / 15000)}`, () => fetchLive(key, now, race));
      if (!live) return { ...base, status: 'waiting' };
      return { ...base, status: 'live', ended: cur.ended, lap: live.lap, rows: live.rows.slice(0, count) };
    } catch (err) {
      if (!blocked(err)) throw err;
      restricted.set(key, Date.now() + 60000);
      return { ...base, status: 'restricted' };
    }
  }
  // after the session: final classification, free to use
  const result = await of1(`/session_result?session_key=${key}`, 600).catch(() => null);
  if (!result?.length) return null;
  const [drivers, stints, pit] = [await of1(`/drivers?session_key=${key}`, 3600), await of1(`/stints?session_key=${key}`, 3600), await of1(`/pit?session_key=${key}`, 3600)];
  return { ...base, status: 'delayed', ...parseSessionResult({ result, stints, pit, drivers }, { count }) };
}

// ---- qualifying / sprint result of the weekend (Jolpica) -------------------------
const bestQ = (r) => r.Q3 || r.Q2 || r.Q1 || '';
export function parseQualifying(json, count = 10) {
  const race = json?.MRData?.RaceTable?.Races?.[0];
  if (!race?.QualifyingResults?.length) return null;
  return race.QualifyingResults.slice(0, count).map((r) => ({
    pos: Number(r.position), code: r.Driver.code, name: driverName(r.Driver), team: r.Constructor.name, time: bestQ(r), segment: r.Q3 ? 'Q3' : r.Q2 ? 'Q2' : 'Q1',
  }));
}
export function parseSprint(json, count = 10) {
  const race = json?.MRData?.RaceTable?.Races?.[0];
  if (!race?.SprintResults?.length) return null;
  return race.SprintResults.slice(0, count).map((r) => ({
    pos: Number(r.position), code: r.Driver.code, name: driverName(r.Driver), team: r.Constructor.name, time: r.Time?.time || r.status || '',
  }));
}

async function weekendGrid(next, sessions, now, count, t) {
  const done = (key) => sessions.some((s) => s.key === key && Date.parse(s.start) + (SESSION_MINUTES[key] || 60) * MIN < now);
  if (!done('Qualifying') && !done('Sprint') && !done('SprintQualifying') && !done('SprintShootout')) return null;
  const path = `/${next.season}/${next.round}`;
  if (Date.parse(iso(next)) + 60 * MIN < now) {
    const res = await get(`${path}/results.json?limit=1`, 300).catch(() => null);
    if (Number(res?.MRData?.total) > 0) return null; // race result exists → podium / last race take over
  }
  if (done('Qualifying')) {
    const rows = parseQualifying(await get(`${path}/qualifying.json`, 600).catch(() => null), count);
    if (rows) return { key: 'Qualifying', label: t('Qualifying'), rows };
  }
  if (done('Sprint')) {
    const rows = parseSprint(await get(`${path}/sprint.json`, 600).catch(() => null), count);
    if (rows) return { key: 'Sprint', label: t('Sprint'), rows };
  }
  // Sprint qualifying isn't in Jolpica – take OpenF1's (free) final classification.
  const sq = sessions.find((s) => s.key === 'SprintQualifying' || s.key === 'SprintShootout');
  if (sq && done(sq.key)) {
    const sess = await openf1Session(sq).catch(() => null);
    if (sess && Date.parse(sess.date_end) + 30 * MIN < now) {
      const result = await of1(`/session_result?session_key=${sess.session_key}`, 3600).catch(() => null);
      const drivers = result?.length ? await of1(`/drivers?session_key=${sess.session_key}`, 3600).catch(() => []) : [];
      const parsed = result?.length ? parseSessionResult({ result, drivers }, { count }) : null;
      if (parsed?.rows.length) return { key: sq.key, label: sq.label, rows: parsed.rows.map((r) => ({ pos: r.pos, code: r.code, name: r.name, team: r.team, color: r.color, time: r.best })) };
    }
  }
  return null;
}

// ---- track time & track facts --------------------------------------------------
async function trackTimezone(race) {
  const lat = Number(race.Circuit.Location.lat).toFixed(3);
  const lon = Number(race.Circuit.Location.long).toFixed(3);
  const data = await cached(`f1tz:${race.Circuit.circuitId}`, 30 * 86400, () =>
    fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&current=temperature_2m`),
  );
  return data.timezone || null;
}

// "So" / "21:00" for an ISO time in a given time zone and locale.
export function trackTimeParts(isoTime, timeZone, locale = 'en-GB') {
  const d = new Date(isoTime);
  return {
    wd: new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(d).replace('.', ''),
    time: new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(d),
  };
}

export function trackInfo(circuitId, lengthMeters, season) {
  const s = TRACKS[circuitId] || {};
  const laps = s.laps || computeLaps(lengthMeters, circuitId);
  const info = {
    laps,
    lapsComputed: !s.laps && !!laps,
    lengthKm: lengthMeters ? lengthMeters / 1000 : null,
    distanceKm: laps && lengthMeters ? Math.round(laps * lengthMeters / 100) / 10 : null,
    corners: s.corners || null,
    drsZones: Number(season) < 2026 ? s.drsZones || null : null,
    lapRecord: s.lapRecord || null,
  };
  return Object.values(info).some((v) => v) ? info : null;
}

export async function f1(settings, cfg, mod, { now = Date.now() } = {}) {
  const lang = langOf(cfg.general.locale);
  const t = translator(lang);
  const year = new Date(now).getUTCFullYear();
  let races = await schedule('current');
  // A race weekend stays "next" until ~3h after the race start.
  let next = races.find((r) => new Date(iso(r)).getTime() + 3 * 3600 * 1000 > now);
  if (!next) {
    races = await schedule(year + 1).catch(() => []);
    next = races[0];
  }
  if (!next) return { offseason: true };

  const sessions = SESSION_KEYS.filter(([k]) => next[k]).map(([k, label]) => ({ key: k, label: t(label), start: iso(next[k]) }));
  sessions.push({ key: 'Race', label: t('Race'), start: iso(next) });
  sessions.sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = sessions.find((s) => new Date(s.start).getTime() + 2 * 3600 * 1000 > now) || sessions[sessions.length - 1];

  const result = {
    season: next.season,
    round: Number(next.round),
    totalRounds: races.length,
    raceName: next.raceName.replace('Grand Prix', 'GP'),
    raceNameFull: next.raceName,
    circuit: next.Circuit.circuitName,
    locality: next.Circuit.Location.locality,
    country: (lang === 'de' && COUNTRY_DE[next.Circuit.Location.country]) || next.Circuit.Location.country,
    isSprint: sessions.some((s) => s.key === 'Sprint'),
    sessions,
    nextSession: upcoming,
    raceStart: iso(next),
  };

  const tasks = [];
  const count = Math.max(1, Number(settings.liveCount) || 10);
  if (settings.showTrackMap || settings.showTrackInfo !== false) {
    tasks.push(
      trackLayout(next)
        .catch(() => null)
        .then((tr) => {
          if (settings.showTrackMap && tr) result.track = tr;
          if (settings.showTrackInfo !== false) result.trackInfo = trackInfo(next.Circuit.circuitId, tr?.length, next.season);
        }),
    );
  }
  if (settings.trackTime && settings.trackTime !== 'off') {
    tasks.push(
      trackTimezone(next)
        .then((tz) => {
          if (!tz) return;
          result.trackTz = tz;
          for (const s of sessions) s.track = trackTimeParts(s.start, tz, cfg.general.locale);
        })
        .catch(() => {}),
    );
  }
  if (settings.liveTiming !== false) {
    tasks.push(liveTiming(sessions, now, count).then((l) => l && (result.live = l)).catch((err) => console.warn(`[f1] live timing: ${err.message}`)));
  }
  if (settings.showQualifying !== false) {
    tasks.push(weekendGrid(next, sessions, now, count, t).then((g) => g && (result.grid = g)).catch(() => {}));
  }
  if (settings.showTrackWeather) {
    tasks.push(trackWeather(next).then((w) => (result.trackWeather = w)).catch(() => {}));
  }
  if (settings.showPreviousWinner) {
    tasks.push(
      get(`/${Number(next.season) - 1}/circuits/${next.Circuit.circuitId}/results/1.json`, 86400)
        .then((d) => {
          const r = d.MRData.RaceTable.Races[0];
          if (r) result.previousWinner = { name: driverName(r.Results[0].Driver), team: r.Results[0].Constructor.name, season: r.season };
        })
        .catch(() => {}),
    );
  }
  if (settings.showLastRace) {
    tasks.push(
      get('/current/last/results.json?limit=3')
        .then((d) => {
          const r = d.MRData.RaceTable.Races[0];
          if (r && r.season === next.season) {
            result.lastRace = {
              name: r.raceName.replace('Grand Prix', 'GP'),
              podium: r.Results.slice(0, 3).map((x) => ({ pos: Number(x.position), code: x.Driver.code, name: driverName(x.Driver), team: x.Constructor.name })),
            };
          }
        })
        .catch(() => {}),
    );
  }
  if (settings.showDriverStandings) {
    tasks.push(
      get('/current/driverStandings.json')
        .then((d) => {
          const list = d.MRData.StandingsTable.StandingsLists[0]?.DriverStandings || [];
          result.driverStandings = list.slice(0, settings.standingsCount).map((s) => ({
            pos: Number(s.position || s.positionText), code: s.Driver.code, name: driverName(s.Driver), team: s.Constructors.at(-1)?.name, points: Number(s.points),
          }));
          const fav = settings.favoriteDrivers.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
          if (fav.length) {
            for (const s of list) {
              if (fav.includes(s.Driver.code) && !result.driverStandings.some((x) => x.code === s.Driver.code)) {
                result.driverStandings.push({ pos: Number(s.position || s.positionText), code: s.Driver.code, name: driverName(s.Driver), team: s.Constructors.at(-1)?.name, points: Number(s.points) });
              }
            }
          }
        })
        .catch(() => {}),
    );
  }
  if (settings.showConstructorStandings) {
    tasks.push(
      get('/current/constructorStandings.json')
        .then((d) => {
          const list = d.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings || [];
          result.constructorStandings = list.slice(0, settings.standingsCount).map((s) => ({ pos: Number(s.position || s.positionText), name: s.Constructor.name, points: Number(s.points) }));
        })
        .catch(() => {}),
    );
  }
  await Promise.all(tasks);
  // Same session already shown as qualifying/sprint grid → no second list.
  if (result.live?.status === 'delayed' && result.grid?.key === result.live.key) delete result.live;
  // Refresh hint for the mirror: fast while a session runs, wake up shortly before one starts.
  const st = result.live?.status;
  if (st === 'live' || st === 'waiting' || st === 'soon') result.refresh = 15;
  else if (st === 'restricted') result.refresh = 120;
  else if (settings.showQualifying !== false && !result.grid && sessions.some((x) => ['Qualifying', 'Sprint', 'SprintQualifying', 'SprintShootout'].includes(x.key) && now - Date.parse(x.start) > 0 && now - Date.parse(x.start) < 4 * 3600 * 1000)) {
    result.refresh = 300; // result is due soon
  } else if (settings.liveTiming !== false) {
    const upcomingStart = sessions.map((x) => Date.parse(x.start) - LIVE_BEFORE).find((x) => x > now);
    if (upcomingStart && upcomingStart - now < 3600 * 1000) result.refresh = Math.max(30, Math.round((upcomingStart - now) / 1000));
  }
  return result;
}
