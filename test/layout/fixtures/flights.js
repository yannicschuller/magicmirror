// Aircraft map (src/providers/flights.js): traffic around Leipzig (LEJ approach, overflights),
// spotlight aircraft with route and photo when the display shows the nearest aircraft.
import { LONG } from './index.js';

const R = Math.PI / 180;
const distKm = (lat1, lon1, lat2, lon2) => {
  const a = Math.sin(((lat2 - lat1) * R) / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(((lon2 - lon1) * R) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};
const bearing = (lat1, lon1, lat2, lon2) => {
  const y = Math.sin((lon2 - lon1) * R) * Math.cos(lat2 * R);
  const x = Math.cos(lat1 * R) * Math.sin(lat2 * R) - Math.sin(lat1 * R) * Math.cos(lat2 * R) * Math.cos((lon2 - lon1) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
};

// [hex, callsign, reg, type, desc, ownOp, dLat, dLon, alt(ft|'ground'), gs(kt), track, baroRate]
const BASE = [
  ['3c6752', 'DLH2AT', 'D-AIBF', 'A319', 'Airbus A319', 'Lufthansa', 0.032, -0.041, 4300, 168, 262, -832],
  ['3c56f4', 'EWG7RN', 'D-AEWN', 'A320', 'Airbus A320', 'Eurowings', 0.081, 0.102, 11800, 286, 241, -1216],
  ['3c4b2c', 'DHK45', 'D-ALEI', 'B77L', 'Boeing 777F', 'European Air Transport Leipzig', 0.095, -0.161, 2400, 152, 266, -704],
  ['4ca7b9', 'RYR3MA', 'EI-DWF', 'B738', 'Boeing 737-800', 'Ryanair', -0.152, 0.214, 36000, 462, 118, 0],
  ['3c66a9', 'CFG1KX', 'D-ASGE', 'A20N', 'Airbus A320neo', 'Condor', -0.061, -0.252, 24200, 398, 194, 1792],
  ['4b1806', 'SWR1349', 'HB-JCN', 'BCS3', 'Airbus A220-300', 'Swiss', 0.212, 0.054, 37000, 471, 15, 0],
  ['3c4dc5', 'BOX512', 'D-AALD', 'B77L', 'Boeing 777F', 'AeroLogic', 0.071, -0.198, 'ground', 12, 82, null],
  ['47a1c6', 'NOZ42T', 'LN-NGY', 'B38M', 'Boeing 737 MAX 8', 'Norwegian', -0.244, -0.081, 38000, 455, 160, 0],
  ['3e1bd8', '', 'D-EKLH', 'C172', 'Cessna 172 Skyhawk', '', -0.034, 0.091, 2200, 98, 47, 128],
  ['3c5ee7', 'CHX63', 'D-HDSD', 'EC35', 'Airbus Helicopters H135', 'ADAC Luftrettung', 0.018, 0.028, 1100, 112, 301, -256],
  ['4baa8c', 'THY1CP', 'TC-JFV', 'B738', 'Boeing 737-800', 'Turkish Airlines', 0.301, -0.112, 34000, 448, 302, 0],
  ['896473', 'UAE15E', 'A6-EOD', 'A388', 'Airbus A380-800', 'Emirates', -0.198, 0.331, 39000, 489, 128, -64],
];

export default ({ now, settings, long, general }) => {
  const c = settings.location || general.location || { lat: 51.34, lon: 12.37 };
  const radius = Number(settings.radiusKm) || 40;
  const rows = [...BASE];
  if (long) {
    // dense traffic: 80 aircraft with long type names and big numbers
    for (let i = 0; rows.length < 80; i++) {
      const a = (i * 137.5) * R;
      const r = 0.03 + ((i * 37) % 22) / 100;
      rows.push([
        (0x3d0000 + i * 97).toString(16), `DLH${400 + i}`, `D-A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 7) % 26))}${String.fromCharCode(65 + ((i * 3) % 26))}`,
        i % 3 ? 'A359' : 'B748', i % 3 ? `Airbus A350-941 ${LONG}` : 'Boeing 747-8 Intercontinental', 'Lufthansa',
        r * Math.cos(a), r * Math.sin(a) * 1.5, 2000 + ((i * 1234) % 43000), 180 + ((i * 17) % 420), (i * 53) % 360, i % 4 ? -1408 : 2240,
      ]);
    }
  }
  const aircraft = rows
    .map(([hex, callsign, reg, type, desc, ownOp, dLat, dLon, alt, gs, track, vrate], i) => {
      const lat = c.lat + dLat;
      const lon = c.lon + dLon;
      return {
        hex,
        flight: callsign || reg,
        callsign,
        reg,
        type,
        desc,
        year: i % 4 === 0 ? 2008 + (i % 15) : null,
        ownOp,
        lat,
        lon,
        alt: alt === 'ground' ? 0 : alt,
        ground: alt === 'ground',
        speed: Math.round(gs * 1.852),
        track,
        vrate,
        squawk: String(1000 + ((i * 1371) % 6000)).padStart(4, '0'),
        emergency: null,
        dist: distKm(c.lat, c.lon, lat, lon),
        bearing: Math.round(bearing(c.lat, c.lon, lat, lon)),
      };
    })
    .filter((a) => a.dist <= radius)
    .filter((a) => !settings.maxAltitudeFt || a.alt === null || a.alt <= settings.maxAltitudeFt)
    .sort((a, b) => a.dist - b.dist);

  const result = { center: { lat: c.lat, lon: c.lon }, source: settings.source, aircraft };
  if (!settings.display || settings.display === 'map') return result;

  const pick = aircraft.find((a) => !a.ground && a.callsign) || null;
  result.spotlight = pick && {
    ...pick,
    airline: pick.ownOp,
    route: {
      from: { icao: 'EDDF', iata: 'FRA', name: 'Frankfurt am Main Airport', city: long ? `Frankfurt am Main ${LONG}` : 'Frankfurt am Main', country: 'DE', lat: 50.0333, lon: 8.5706 },
      to: { icao: 'EDDP', iata: 'LEJ', name: 'Leipzig/Halle Airport', city: 'Leipzig', country: 'DE', lat: 51.4239, lon: 12.2364 },
      via: [],
      plausible: true,
    },
    photo: { src: 'https://t.plnspttrs.net/12345/1234567_abcdef1234_280.jpg', width: 280, height: 175, photographer: 'Jens Müller', link: 'https://www.planespotters.net/photo/1234567' },
  };
  return result;
};
