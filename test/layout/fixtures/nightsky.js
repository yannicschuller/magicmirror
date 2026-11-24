// Night sky & ISS: passes, planets, moon and events like buildNightSky() in
// src/providers/nightsky.js.
import { iso, addMin, addDays, dayKey, LONG } from './index.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
const brightness = (el) => (el >= 50 ? 'very bright' : el >= 25 ? 'bright' : 'moderate');

function pass(start, durSec, startAz, maxAz, endAz, maxEl, visible = true, track = false) {
  const end = new Date(start.getTime() + durSec * 1000);
  const max = new Date(start.getTime() + (durSec * 1000) / 2);
  const p = {
    start: iso(start), startAz, startDir: compass(startAz), startEl: 10,
    max: iso(max), maxEl, maxAz, maxDir: compass(maxAz),
    end: iso(end), endAz, endDir: compass(endAz), endEl: 10,
    duration: durSec, visible, brightness: visible ? brightness(maxEl) : null,
  };
  if (track) p.track = Array.from({ length: 7 }, (_, i) => [Math.round((durSec * i) / 6), Math.round(startAz + ((endAz - startAz) * i) / 6), Math.round(10 + (maxEl - 10) * Math.sin((Math.PI * i) / 6))]);
  return p;
}

export default ({ now, settings, long }) => {
  const at = (m) => addMin(now, m);
  const maxPasses = long ? 20 : Math.min(20, Math.max(1, Number(settings.maxPasses) || 4));
  const night = { start: iso(at(45)), end: iso(at(14 * 60)) };
  const passes = [
    pass(at(-2), 360, 245, 200, 110, 58, true, true), // running right now
    pass(at(95), 300, 280, 330, 40, 34, true, true),
    pass(at(24 * 60 - 40), 420, 250, 180, 100, 71),
    pass(at(24 * 60 + 55), 240, 290, 320, 360, 19),
    pass(at(48 * 60 - 85), 390, 230, 170, 95, 46),
  ];
  for (let i = 0; passes.length < maxPasses; i++) passes.push(pass(at(48 * 60 + 30 + i * 97), 200 + (i % 4) * 60, 260 + i * 7, 300, 20 + i * 11, 12 + ((i * 13) % 70), i % 3 !== 2));
  const out = {
    location: 'Leipzig',
    night,
    soonHours: Number(settings.soonHours) || 6,
    iss: { days: long ? 10 : Number(settings.issDays) || 3, passes: passes.slice(0, maxPasses), tleEpoch: iso(addDays(now, -1)) },
  };
  if (settings.showPlanets !== false) {
    const pl = [
      ['Venus', 120, 18, 225, -4.1], ['Saturn', 210, 31, 190, 0.9], ['Jupiter', 480, 52, 165, -2.6], ['Mars', 690, 44, 140, -0.4],
    ];
    if (long) pl.push(['Mercury', 780, 9, 115, 0.2], ['Uranus', 300, 47, 180, 5.7], ['Neptune', 250, 33, 200, 7.8]);
    out.planets = pl.map(([name, m, alt, az, mag]) => ({ id: name.toLowerCase(), name, best: iso(at(m)), alt, az, dir: compass(az), mag, from: iso(at(m - 120)), to: iso(at(m + 120)) }))
      .sort((a, b) => a.best.localeCompare(b.best));
  }
  if (settings.showMoon !== false) {
    out.moon = { rise: iso(at(-190)), set: iso(at(8 * 60 + 12)), fraction: 0.27, phase: 0.172, waxing: true, name: 'Waxing Crescent', up: true, alt: 14, dir: 'SW' };
  }
  if (settings.showEvents !== false) {
    out.events = [
      { type: 'conjunction', a: 'Moon', b: 'Saturn', sep: 1.8, at: iso(at(26 * 60)), alt: 28, dir: 'S' },
      { type: 'conjunction', a: 'Venus', b: 'Jupiter', sep: 2.6, at: iso(at(3 * 24 * 60 + 30)), alt: 12, dir: 'SW' },
      { type: 'meteor', name: 'Geminids', peak: dayKey(addDays(now, 9)), zhr: 150, moon: 0.62 },
      { type: 'meteor', name: 'Ursids', peak: dayKey(addDays(now, 13)), zhr: 10, moon: 0.08 },
    ];
    if (long) out.events.push({ type: 'meteor', name: `${LONG} shower`, peak: dayKey(addDays(now, 14)), zhr: 123456, moon: 1 });
  }
  return out;
};
