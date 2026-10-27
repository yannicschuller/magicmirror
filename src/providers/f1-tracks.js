// Static data, update yearly (last checked for the 2026 calendar).
// Keyed by Ergast/Jolpica circuitId. Race lap records are the fastest laps set
// during a Grand Prix on the current layout (not qualifying). drsZones are the
// 2025 values – DRS was replaced by active aero from 2026, so the mirror only
// shows them for seasons before 2026. Unknown values are simply left out.
export const TRACKS = {
  albert_park: { laps: 58, corners: 14, drsZones: 4, lapRecord: { time: '1:19.813', driver: 'Charles Leclerc', year: 2024 } },
  shanghai: { laps: 56, corners: 16, drsZones: 2, lapRecord: { time: '1:32.238', driver: 'Michael Schumacher', year: 2004 } },
  suzuka: { laps: 53, corners: 18, drsZones: 1, lapRecord: { time: '1:30.965', driver: 'Kimi Antonelli', year: 2025 } },
  bahrain: { laps: 57, corners: 15, drsZones: 3, lapRecord: { time: '1:31.447', driver: 'Pedro de la Rosa', year: 2005 } },
  jeddah: { laps: 50, corners: 27, drsZones: 3, lapRecord: { time: '1:30.734', driver: 'Lewis Hamilton', year: 2021 } },
  miami: { laps: 57, corners: 19, drsZones: 3, lapRecord: { time: '1:29.708', driver: 'Max Verstappen', year: 2023 } },
  villeneuve: { laps: 70, corners: 14, drsZones: 3, lapRecord: { time: '1:13.078', driver: 'Valtteri Bottas', year: 2019 } },
  monaco: { laps: 78, corners: 19, drsZones: 1, lapRecord: { time: '1:12.909', driver: 'Lewis Hamilton', year: 2021 } },
  catalunya: { laps: 66, corners: 14, drsZones: 2, lapRecord: { time: '1:15.743', driver: 'Oscar Piastri', year: 2025 } },
  red_bull_ring: { laps: 71, corners: 10, drsZones: 3, lapRecord: { time: '1:05.619', driver: 'Carlos Sainz', year: 2020 } },
  silverstone: { laps: 52, corners: 18, drsZones: 2, lapRecord: { time: '1:27.097', driver: 'Max Verstappen', year: 2020 } },
  spa: { laps: 44, corners: 19, drsZones: 2, lapRecord: { time: '1:44.701', driver: 'Sergio Pérez', year: 2024 } },
  hungaroring: { laps: 70, corners: 14, drsZones: 2, lapRecord: { time: '1:16.627', driver: 'Lewis Hamilton', year: 2020 } },
  zandvoort: { laps: 72, corners: 14, drsZones: 2, lapRecord: { time: '1:11.097', driver: 'Lewis Hamilton', year: 2021 } },
  monza: { laps: 53, corners: 11, drsZones: 2, lapRecord: { time: '1:20.901', driver: 'Lando Norris', year: 2025 } },
  madring: { corners: 22 },
  baku: { laps: 51, corners: 20, drsZones: 2, lapRecord: { time: '1:43.009', driver: 'Charles Leclerc', year: 2019 } },
  sepang: { laps: 56, corners: 15, lapRecord: { time: '1:34.223', driver: 'Juan Pablo Montoya', year: 2004 } },
  marina_bay: { laps: 62, corners: 19, drsZones: 4, lapRecord: { time: '1:33.808', driver: 'Lewis Hamilton', year: 2025 } },
  americas: { laps: 56, corners: 20, drsZones: 2, lapRecord: { time: '1:36.169', driver: 'Charles Leclerc', year: 2019 } },
  rodriguez: { laps: 71, corners: 17, drsZones: 3, lapRecord: { time: '1:17.774', driver: 'Valtteri Bottas', year: 2021 } },
  interlagos: { laps: 71, corners: 15, drsZones: 2, lapRecord: { time: '1:10.540', driver: 'Valtteri Bottas', year: 2018 } },
  vegas: { laps: 50, corners: 17, drsZones: 2, lapRecord: { time: '1:34.876', driver: 'Lando Norris', year: 2024 } },
  losail: { laps: 57, corners: 16, drsZones: 1, lapRecord: { time: '1:22.384', driver: 'Lando Norris', year: 2024 } },
  yas_marina: { laps: 58, corners: 16, drsZones: 2, lapRecord: { time: '1:26.103', driver: 'Max Verstappen', year: 2021 } },
};

// Race distance rule: the fewest whole laps that exceed 305 km (Monaco: 260 km).
export function computeLaps(lengthMeters, circuitId) {
  if (!lengthMeters) return null;
  const target = circuitId === 'monaco' ? 260000 : 305000;
  return Math.ceil(target / lengthMeters);
}
