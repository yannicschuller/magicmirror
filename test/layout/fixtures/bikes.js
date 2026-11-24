// Bike & scooter sharing (src/providers/bikes.js): nextbike stations around Leipzig city centre
// plus free-floating scooters.
import { LONG } from './index.js';

const STATIONS = [
  ['Augustusplatz', 'nextbike', 140, 32, { bike: 6, ebike: 2 }, 8],
  ['Leipzig Hbf / Westseite', 'nextbike', 380, 318, { bike: 3, ebike: 1, cargo: 1 }, 12],
  ['Wilhelm-Leuschner-Platz', 'nextbike', 460, 205, {}, 15],
  ['Johannisplatz', 'nextbike', 520, 101, { bike: 4 }, 6],
  ['Neues Rathaus', 'nextbike', 610, 236, { bike: 1, ebike: 3 }, 9],
  ['Gewandhaus / Universität', 'nextbike', 210, 172, { bike: 2 }, 10],
  ['Bayerischer Bahnhof', 'nextbike', 1450, 168, { bike: 5, cargo: 2 }, 4],
  ['Waldplatz', 'nextbike', 1780, 277, { ebike: 7 }, 11],
  ['Südplatz', 'nextbike', 1990, 190, { bike: 9 }, 3],
  ['Connewitz, Kreuz', 'nextbike', 2900, 181, { bike: 12, ebike: 4 }, 2],
];

export default ({ settings, long, general }) => {
  const loc = settings.location || general.location || { name: '' };
  const radius = long ? 3000 : Number(settings.radius) || 500;
  const max = long ? 10 : Number.isFinite(Number(settings.maxStations)) ? Number(settings.maxStations) : 3;
  const kinds = settings.kinds?.length ? settings.kinds : ['bike', 'ebike', 'cargo', 'scooter'];
  const stations = STATIONS.filter((s) => s[2] <= radius)
    .map(([name, operator, dist, bearing, counts0, docks], i) => {
      const counts = Object.fromEntries(Object.entries(counts0).filter(([k]) => kinds.includes(k)).map(([k, v]) => [k, long ? v * 11 : v]));
      const available = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        name: long ? (i === 1 ? `${name} – ${LONG}` : `${name} (Station am Haupteingang gegenüber der Haltestelle)`) : name,
        operator: long && i % 2 ? 'Donkey Republic Leipzig' : operator,
        dist, bearing, counts, available, docks, renting: !(long && i === 4),
      };
    })
    .filter((s) => !settings.hideEmpty || s.available)
    .slice(0, max);
  const vehicles = [];
  if (kinds.includes('scooter')) vehicles.push({ operator: 'TIER', counts: { scooter: long ? 187 : 7 }, total: long ? 187 : 7, nearest: { dist: 90, bearing: 64 } });
  if (long) vehicles.push({ operator: `Bolt Scooter Leipzig ${LONG}`, counts: { scooter: 64, ebike: 23 }, total: 87, nearest: { dist: 40, bearing: 300 } });
  if (long) vehicles.push({ operator: 'Lime', counts: {}, total: 0, nearest: null });
  const operators = new Set(stations.map((s) => s.operator));
  return { location: loc.name || '', radius, stations, vehicles, errors: [], refresh: 60, multiOperator: operators.size > 1 };
};
