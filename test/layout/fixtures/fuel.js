// Fuel prices (src/providers/fuel.js): Tankerkönig stations around Leipzig.
import { LONG } from './index.js';

const STATIONS = [
  ['ARAL', 'Aral Tankstelle', 'Prager Straße 128', 'Leipzig', 1.2, [1.789, 1.729, 1.659]],
  ['JET', 'JET Leipzig Torgauer Str.', 'Torgauer Straße 241', 'Leipzig', 3.4, [1.739, 1.679, 1.619]],
  ['Shell', 'Shell Leipzig Riebeckstr.', 'Riebeckstraße 50', 'Leipzig', 1.8, [1.809, 1.749, 1.689]],
  ['Star', 'star Tankstelle', 'Zschochersche Straße 2', 'Leipzig', 2.6, [1.759, 1.699, 1.639]],
  ['TotalEnergies', 'TotalEnergies Leipzig', 'Maximilianallee 14', 'Leipzig', 4.1, [1.799, 1.739, 1.669]],
  ['ESSO', 'Esso Station', 'Delitzscher Straße 90', 'Leipzig', 2.9, [1.779, 1.719, null]],
  ['HEM', 'HEM Tankstelle', 'Gerberstraße 21', 'Leipzig', 0.7, [1.749, 1.689, 1.629]],
  ['AVIA', 'AVIA Xpress', 'Lützner Straße 179', 'Leipzig', 4.8, [1.769, 1.709, 1.649]],
  ['OIL!', 'OIL! Tankstelle', 'Bornaische Straße 210', 'Leipzig', 3.9, [1.745, null, 1.625]],
  ['Agip', 'ENI Station', 'Merseburger Straße 101', 'Leipzig', 3.1, [1.795, 1.735, 1.675]],
];

export default ({ settings, long, general }) => {
  const types = (settings.fuelTypes || []).filter((k) => ['e5', 'e10', 'diesel'].includes(k));
  const fuelTypes = types.length ? types : ['e5', 'e10', 'diesel'];
  const max = long ? 20 : Number(settings.maxStations) || 5;
  const all = [];
  for (let i = 0; all.length < max; i++) {
    const [brand, name, street, place, dist, prices] = STATIONS[i % STATIONS.length];
    const round = Math.floor(i / STATIONS.length);
    const p = prices.map((v) => (v === null ? null : Math.round((v + round * 0.011) * 1000) / 1000));
    all.push({
      id: `0000000${i}-dead-beef-cafe-00000000000${i % 10}`,
      name: long && i === 1 ? `${name} ${LONG}` : name,
      brand: long && i === 1 ? `Tankstelle Freie Tankstelle Großzschocher-Windorf ${LONG}` : brand,
      street: long ? `${street} (Ecke Richard-Wagner-Straße / Einfahrt über den Hinterhof)` : street,
      place,
      dist: Math.round((dist + round * 0.9) * 10) / 10,
      // one closed station when closed ones are shown
      open: settings.onlyOpen === false ? i !== 3 : true,
      prices: { e5: p[0], e10: p[1], diesel: p[2] },
    });
  }
  const main = fuelTypes[0];
  const stations = all
    .filter((s) => fuelTypes.some((k) => s.prices[k] !== null))
    .sort((a, b) => (settings.sort === 'dist' ? a.dist - b.dist : (a.open ? a.prices[main] ?? 9 : 9) - (b.open ? b.prices[main] ?? 9 : 9) || a.dist - b.dist));
  const cheapest = {};
  for (const k of fuelTypes) {
    let best = null;
    for (const s of stations) {
      const p = s.open ? s.prices[k] : null;
      if (p !== null && (!best || p < best.price)) best = { price: p, id: s.id };
    }
    cheapest[k] = best;
  }
  return { mode: settings.mode, fuelTypes, location: (settings.location || general.location)?.name || '', stations, cheapest };
};
