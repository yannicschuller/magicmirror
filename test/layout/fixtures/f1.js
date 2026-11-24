// Formula 1 (src/providers/f1.js): next race weekend (Abu Dhabi), qualifying done, race tomorrow.
// "long": the race is running – live positions of all 22 cars, full grid and standings.
import { iso, addMin, LONG } from './index.js';

const DRIVERS = [
  ['RUS', 'George Russell', 'Mercedes', 'Mercedes'],
  ['NOR', 'Lando Norris', 'McLaren', 'McLaren'],
  ['VER', 'Max Verstappen', 'Red Bull', 'Red Bull'],
  ['PIA', 'Oscar Piastri', 'McLaren', 'McLaren'],
  ['LEC', 'Charles Leclerc', 'Ferrari', 'Ferrari'],
  ['ANT', 'Andrea Kimi Antonelli', 'Mercedes', 'Mercedes'],
  ['HAM', 'Lewis Hamilton', 'Ferrari', 'Ferrari'],
  ['HAD', 'Isack Hadjar', 'Red Bull', 'Red Bull'],
  ['ALO', 'Fernando Alonso', 'Aston Martin', 'Aston Martin'],
  ['SAI', 'Carlos Sainz', 'Williams', 'Williams'],
  ['HUL', 'Nico Hülkenberg', 'Audi', 'Audi'],
  ['GAS', 'Pierre Gasly', 'Alpine F1 Team', 'Alpine'],
  ['ALB', 'Alexander Albon', 'Williams', 'Williams'],
  ['BEA', 'Oliver Bearman', 'Haas F1 Team', 'Haas'],
  ['LAW', 'Liam Lawson', 'RB F1 Team', 'Racing Bulls'],
  ['BOR', 'Gabriel Bortoleto', 'Audi', 'Audi'],
  ['OCO', 'Esteban Ocon', 'Haas F1 Team', 'Haas'],
  ['LIN', 'Arvid Lindblad', 'RB F1 Team', 'Racing Bulls'],
  ['STR', 'Lance Stroll', 'Aston Martin', 'Aston Martin'],
  ['COL', 'Franco Colapinto', 'Alpine F1 Team', 'Alpine'],
  ['PER', 'Sergio Pérez', 'Cadillac F1 Team', 'Cadillac'],
  ['BOT', 'Valtteri Bottas', 'Cadillac F1 Team', 'Cadillac'],
];
const COLORS = { Mercedes: '#27F4D2', McLaren: '#FF8000', 'Red Bull': '#3671C6', Ferrari: '#E8002D', 'Aston Martin': '#229971', Williams: '#64C4FF', Audi: '#F50537', 'Alpine F1 Team': '#FF87BC', 'Haas F1 Team': '#B6BABD', 'RB F1 Team': '#6692FF', 'Cadillac F1 Team': '#D4AF37' };
const NUMBERS = [63, 1, 3, 81, 16, 12, 44, 6, 14, 55, 27, 10, 23, 87, 30, 5, 31, 41, 18, 43, 11, 77];

// Closed circuit outline (scaled to 0..100 like trackShape() does).
function trackPath() {
  const pts = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + 0.18 * Math.sin(3 * a) + 0.1 * Math.cos(5 * a);
    pts.push([50 + 48 * r * Math.cos(a) * 0.95, 32 + 30 * r * Math.sin(a) * 0.95]);
  }
  const minX = Math.min(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const s = pts.map(([x, y]) => [x - minX, y - minY]);
  const w = Math.max(...s.map((p) => p[0]));
  const h = Math.max(...s.map((p) => p[1]));
  const d = s.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z';
  return { d, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, start: s[0].map((v) => Math.round(v * 10) / 10) };
}

const lap = (ms) => {
  const m = Math.floor(ms / 60000);
  return `${m}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
};

export default ({ now, settings, long }) => {
  const season = String(now.getUTCFullYear());
  // normal: qualifying 3 h ago, race in ~21 h; long: race started 50 min ago
  const raceAt = long ? addMin(now, -50) : addMin(now, 21 * 60);
  const qualiAt = addMin(raceAt, -24 * 60);
  const sessions = [
    { key: 'FirstPractice', label: '1. Training', start: iso(addMin(raceAt, -(2 * 24 * 60 + 3 * 60))) },
    { key: 'SecondPractice', label: '2. Training', start: iso(addMin(raceAt, -(2 * 24 * 60 - 60))) },
    { key: 'ThirdPractice', label: '3. Training', start: iso(addMin(raceAt, -(24 * 60 + 3 * 60))) },
    { key: 'Qualifying', label: 'Qualifying', start: iso(qualiAt) },
    { key: 'Race', label: 'Rennen', start: iso(raceAt) },
  ];
  const nextSession = sessions.find((s) => new Date(s.start).getTime() + 2 * 3600 * 1000 > now.getTime()) || sessions.at(-1);
  const count = long ? 22 : Math.max(1, Number(settings.liveCount) || 10);
  const standingsCount = long ? 22 : Number(settings.standingsCount) || 5;
  const name = (n) => (long && n === 'Valtteri Bottas' ? `Valtteri Viktor ${LONG}` : n);

  const result = {
    season,
    round: 24,
    totalRounds: 24,
    raceName: long ? 'Etihad Airways Abu Dhabi GP – Saisonfinale unter Flutlicht' : 'Abu Dhabi GP',
    raceNameFull: 'Abu Dhabi Grand Prix',
    circuit: long ? 'Yas Marina Circuit (Yas Island Abu Dhabi Rennstrecke mit Hotelüberfahrt)' : 'Yas Marina Circuit',
    locality: 'Abu Dhabi',
    country: 'VAE',
    isSprint: false,
    sessions,
    nextSession,
    raceStart: iso(raceAt),
  };

  const tr = trackPath();
  if (settings.showTrackMap) result.track = { ...tr, length: 5281, firstGp: '2009', name: 'Yas Marina Circuit' };
  if (settings.showTrackInfo !== false) {
    result.trackInfo = { laps: 58, lapsComputed: false, lengthKm: 5.281, distanceKm: 306.3, corners: 16, drsZones: null, lapRecord: { time: '1:26.103', driver: 'Max Verstappen', year: 2021 } };
  }
  if (settings.trackTime && settings.trackTime !== 'off') {
    result.trackTz = 'Asia/Dubai';
    const f = (o) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Asia/Dubai', ...o });
    for (const s of sessions) s.track = { wd: f({ weekday: 'short' }).format(new Date(s.start)).replace('.', ''), time: f({ hour: '2-digit', minute: '2-digit' }).format(new Date(s.start)) };
  }

  if (long && settings.liveTiming !== false) {
    const tyres = ['M', 'H', 'H', 'M', 'S', 'H', 'M', 'H', 'I', 'M', 'H', 'H', 'S', 'M', 'H', 'W', 'M', 'H', 'H', 'M', 'S', 'H'];
    let gap = 0;
    result.live = {
      key: 'Race',
      label: 'Rennen',
      status: 'live',
      ended: false,
      lap: 31,
      rows: DRIVERS.slice(0, count).map(([code, n, team], i) => {
        const interval = i === 0 ? 0 : 0.4 + ((i * 7919) % 53) / 10;
        gap += interval;
        return {
          pos: i + 1, number: NUMBERS[i], code, name: name(n), team, color: COLORS[team], tyre: tyres[i], pits: i % 3 === 0 ? 2 : 1,
          gap: i === 0 ? '' : i > 18 ? '1 LAP' : `+${gap.toFixed(3)}`,
          interval: i === 0 ? '' : i > 18 ? '1 LAP' : `+${interval.toFixed(3)}`,
        };
      }),
    };
    result.refresh = 15;
  }
  if (settings.showQualifying !== false) {
    result.grid = {
      key: 'Qualifying',
      label: 'Qualifying',
      rows: DRIVERS.slice(0, count).map(([code, n, team], i) => ({
        pos: i + 1, code, name: name(n), team, time: lap(82208 + i * 137 + ((i * 31) % 90)), segment: i < 10 ? 'Q3' : i < 16 ? 'Q2' : 'Q1',
      })),
    };
  }
  if (settings.showTrackWeather) result.trackWeather = { code: 1, max: 29.4, min: 23.1, pop: 3, timezone: 'Asia/Dubai' };
  if (settings.showPreviousWinner) result.previousWinner = { name: 'Max Verstappen', team: 'Red Bull', season: String(Number(season) - 1) };
  if (settings.showLastRace) {
    result.lastRace = {
      name: long ? 'Qatar Airways Grand Prix von Katar in Lusail' : 'Qatar GP',
      podium: [
        { pos: 1, code: 'NOR', name: 'Lando Norris', team: 'McLaren' },
        { pos: 2, code: 'VER', name: 'Max Verstappen', team: 'Red Bull' },
        { pos: 3, code: 'RUS', name: 'George Russell', team: 'Mercedes' },
      ],
    };
  }
  const points = [412, 398, 377, 361, 274, 233, 198, 142, 96, 88, 71, 64, 59, 47, 41, 33, 27, 22, 18, 9, 4, 1];
  const order = [1, 2, 3, 0, 4, 6, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  if (settings.showDriverStandings) {
    result.driverStandings = order.slice(0, standingsCount).map((di, i) => {
      const [code, n, team] = DRIVERS[di];
      return { pos: i + 1, code, name: name(n), team, points: long ? points[i] * 10 : points[i] };
    });
  }
  if (settings.showConstructorStandings || long) {
    const teams = ['McLaren', 'Mercedes', 'Red Bull', 'Ferrari', 'Williams', 'Aston Martin', 'RB F1 Team', 'Audi', 'Haas F1 Team', 'Alpine F1 Team', 'Cadillac F1 Team'];
    const tp = [759, 631, 519, 472, 147, 114, 63, 92, 63, 37, 5];
    result.constructorStandings = teams.slice(0, standingsCount).map((n, i) => ({ pos: i + 1, name: long && i === 10 ? `Cadillac Formula 1 Team ${LONG}` : n, points: long ? tp[i] * 10 : tp[i] }));
  }
  return result;
};
