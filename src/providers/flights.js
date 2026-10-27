import { cached, fetchJson, haversineKm } from '../util.js';
import { resolveLocation } from '../../public/shared/modules.js';

const ONLINE = {
  adsblol: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`,
  airplaneslive: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`,
};

export async function flights(settings, cfg) {
  const loc = resolveLocation(settings, cfg.general);
  const lat = loc.lat.toFixed(3);
  const lon = loc.lon.toFixed(3);
  let list;
  if (settings.source === 'local') {
    const url = new URL(settings.localUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs are allowed');
    const data = await cached(`flights:local:${url}`, 2, () => fetchJson(url.toString(), { timeout: 5000 }));
    list = data.aircraft || data.ac || [];
  } else {
    const nm = Math.min(250, Math.ceil(settings.radiusKm / 1.852));
    const build = ONLINE[settings.source] || ONLINE.adsblol;
    // Online APIs are rate limited – never ask more often than every 5 s.
    const data = await cached(`flights:${settings.source}:${lat}:${lon}:${nm}`, Math.max(5, settings.refreshSeconds - 1), () => fetchJson(build(lat, lon, nm), { timeout: 10000 }));
    list = data.ac || data.aircraft || [];
  }

  const aircraft = list
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && (a.seen_pos === undefined || a.seen_pos < 60))
    .map((a) => {
      const alt = a.alt_baro === 'ground' ? 0 : Number.isFinite(a.alt_baro) ? a.alt_baro : Number.isFinite(a.alt_geom) ? a.alt_geom : null;
      return {
        hex: a.hex,
        flight: (a.flight || '').trim() || a.r || a.hex?.toUpperCase(),
        reg: a.r || '',
        type: a.t || '',
        lat: a.lat,
        lon: a.lon,
        alt,
        ground: a.alt_baro === 'ground',
        speed: Number.isFinite(a.gs) ? Math.round(a.gs * 1.852) : null,
        track: Number.isFinite(a.track) ? a.track : Number.isFinite(a.true_heading) ? a.true_heading : null,
        vrate: a.baro_rate ?? a.geom_rate ?? null,
        squawk: a.squawk || '',
        emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null,
        dist: haversineKm(loc.lat, loc.lon, a.lat, a.lon),
      };
    })
    .filter((a) => a.dist <= settings.radiusKm)
    .filter((a) => !settings.maxAltitudeFt || a.alt === null || a.alt <= settings.maxAltitudeFt)
    .sort((a, b) => a.dist - b.dist);

  return { center: { lat: loc.lat, lon: loc.lon }, source: settings.source, aircraft };
}
