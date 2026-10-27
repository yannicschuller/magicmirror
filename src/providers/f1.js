import { translator, langOf } from '../../public/shared/i18n.js';
import { cached, fetchJson } from '../util.js';

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

export async function f1(settings, cfg) {
  const lang = langOf(cfg.general.locale);
  const t = translator(lang);
  const now = Date.now();
  const year = new Date().getUTCFullYear();
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
  if (settings.showTrackMap) {
    tasks.push(trackLayout(next).then((tr) => (result.track = tr)).catch(() => {}));
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
  return result;
}
