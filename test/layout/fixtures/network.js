// Internet & network: latency, DNS, speed test, public IP and presence (provider() in
// src/providers/network.js).
import { iso, addMin, LONG } from './index.js';

const HISTORY = 40;

export default ({ now, settings, long }) => {
  const warnMs = Number(settings.warnMs) || 0;
  const badMs = Number(settings.badMs) || 0;
  const history = Array.from({ length: HISTORY }, (_, i) => (long ? (i % 11 === 5 ? null : 180 + ((i * 53) % 140)) : i === 23 ? null : Math.round((14 + ((i * 7) % 9) + (i === 31 ? 68 : 0)) * 10) / 10));
  const base = long
    ? {
      latency: 312.4, reachable: 3, total: 4, loss: 0.33,
      targets: [{ label: '1.1.1.1', ok: true, ms: 298.2 }, { label: '9.9.9.9', ok: true, ms: 312.4 }, { label: 'heise.de', ok: true, ms: 1234.5 }, { label: 'router.fritz.box', ok: false, ms: null }],
      dns: { host: 'cloudflare.com', ok: true, ms: 456.7 },
    }
    : {
      latency: 16.8, reachable: 2, total: 2, loss: 0,
      targets: [{ label: '1.1.1.1', ok: true, ms: 14.2 }, { label: '9.9.9.9', ok: true, ms: 19.3 }],
      dns: { host: 'cloudflare.com', ok: true, ms: 8.4 },
    };
  const status = long ? 'slow' : 'ok';
  const level = long ? 'severe' : 'ok';
  const devices = long
    ? [
      { name: 'Anna', home: true, where: '', lastSeen: iso(addMin(now, -2)) },
      { name: 'Ben', home: false, where: 'Arbeit (Leipziger Messe, Halle 3)', lastSeen: iso(addMin(now, -190)) },
      { name: 'Clara-Sophie Müller-Lüdenscheidt', home: true, where: '', lastSeen: iso(addMin(now, -1)) },
      { name: 'Opa Heinz', home: false, where: '', lastSeen: iso(addMin(now, -3000)) },
      { name: LONG, home: false, where: `Schrebergarten ${LONG}`, lastSeen: iso(addMin(now, -45)) },
      { name: 'Tablet Küche', home: true, where: '', lastSeen: iso(addMin(now, -5)) },
      { name: 'Smart-TV Wohnzimmer', home: true, where: '', lastSeen: iso(addMin(now, -9)) },
      { name: 'Laptop Arbeitszimmer', home: false, where: '', lastSeen: iso(addMin(now, -700)) },
    ]
    : [
      { name: 'Anna', home: true, where: '', lastSeen: iso(addMin(now, -3)) },
      { name: 'Ben', home: false, where: 'Arbeit', lastSeen: iso(addMin(now, -190)) },
      { name: 'Clara', home: true, where: '', lastSeen: iso(addMin(now, -12)) },
    ];
  return {
    ...base,
    measuredAt: iso(addMin(now, -0.2)),
    status, level, warnMs, badMs, history,
    speed: long ? { down: 1234.5, up: 987.6, at: iso(addMin(now, -60 * 26)), mb: 50 } : { down: 247.3, up: 48.9, at: iso(addMin(now, -95)), mb: 10 },
    speedRunning: false,
    speedError: null,
    publicIp: long ? { ip: '2003:e5:3f12:ab00:1c4d:9eff:fe21:7a3b', loc: 'DE', colo: 'FRA' } : { ip: '91.64.172.38', loc: 'DE', colo: 'FRA' },
    devices,
  };
};
