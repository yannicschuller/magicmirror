import { cached, fetchJson, splitList } from '../util.js';
import { transitBaseUrl } from '../../public/shared/modules.js';

const EFA_CLASS = {
  0: 'train', 1: 'sbahn', 2: 'ubahn', 3: 'tram', 4: 'tram', 5: 'bus', 6: 'bus', 7: 'bus', 8: 'other', 9: 'ferry',
  10: 'bus', 11: 'other', 13: 'train', 14: 'train', 15: 'train', 16: 'train', 17: 'bus', 19: 'bus',
};
const HAFAS_PRODUCT = {
  nationalExpress: 'train', national: 'train', regionalExpress: 'train', regional: 'train', regionalExp: 'train',
  suburban: 'sbahn', subway: 'ubahn', tram: 'tram', bus: 'bus', ferry: 'ferry', taxi: 'other',
};

function assertHttpUrl(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed');
  return u;
}

// ---- EFA (Mentz) rapidJSON ----------------------------------------------
async function efaSearch(base, q) {
  const params = new URLSearchParams({ outputFormat: 'rapidJSON', type_sf: 'any', name_sf: q, anyObjFilter_sf: '2', anyMaxSizeHitList: '15' });
  const data = await fetchJson(`${base}XML_STOPFINDER_REQUEST?${params}`);
  return (data.locations || [])
    .filter((l) => l.type === 'stop')
    .sort((a, b) => (b.matchQuality || 0) - (a.matchQuality || 0))
    .map((l) => ({ id: l.id, name: l.name }));
}

async function efaDepartures(base, stopId, count) {
  const params = new URLSearchParams({
    outputFormat: 'rapidJSON', mode: 'direct', type_dm: 'any', name_dm: stopId, useRealtime: '1',
    limit: String(count), depType: 'stopEvents', includeCompleteStopSeq: '0', useAllStops: '1',
  });
  const data = await fetchJson(`${base}XML_DM_REQUEST?${params}`);
  return (data.stopEvents || []).map((e) => {
    const t = e.transportation || {};
    const props = e.location?.properties || {};
    return {
      line: t.disassembledName || t.number || t.name || '?',
      category: EFA_CLASS[t.product?.class] ?? 'other',
      product: t.product?.name || '',
      destination: t.destination?.name || '',
      planned: e.departureTimePlanned,
      realtime: e.departureTimeEstimated || null,
      platform: props.platformName || props.platform || e.location?.disassembledName || '',
      cancelled: (e.realtimeStatus || []).includes('TRIP_CANCELLED') || e.isCancelled === true,
    };
  });
}

// ---- HAFAS REST (db-rest / vbb-rest / transport.rest compatible) -----------
async function hafasSearch(base, q) {
  const data = await fetchJson(`${base}/locations?${new URLSearchParams({ query: q, results: '15', addresses: 'false', poi: 'false' })}`);
  return (Array.isArray(data) ? data : []).filter((l) => l.type === 'stop' || l.type === 'station').map((l) => ({ id: l.id, name: l.name }));
}

async function hafasDepartures(base, stopId, count) {
  const data = await fetchJson(`${base}/stops/${encodeURIComponent(stopId)}/departures?${new URLSearchParams({ duration: '120', results: String(count), remarks: 'false' })}`);
  const list = Array.isArray(data) ? data : data.departures || [];
  return list.map((d) => ({
    line: d.line?.name || '?',
    category: HAFAS_PRODUCT[d.line?.product] || 'other',
    product: d.line?.productName || '',
    destination: d.direction || d.destination?.name || '',
    planned: d.plannedWhen,
    realtime: d.when && d.delay !== null && d.delay !== undefined ? d.when : null,
    platform: d.platform || d.plannedPlatform || '',
    cancelled: d.cancelled === true,
  }));
}

export async function searchStops(settings, q) {
  const base = transitBaseUrl(settings);
  if (!base) throw new Error('No base URL configured');
  assertHttpUrl(base);
  return settings.provider === 'hafas' ? hafasSearch(base, q) : efaSearch(base, q);
}

export async function transit(settings) {
  if (!settings.stop) return { departures: [], needsSetup: true };
  const base = transitBaseUrl(settings);
  if (!base) return { departures: [], needsSetup: true };
  assertHttpUrl(base);
  const fetchCount = Math.min(80, settings.limit * 4 + 10);
  const raw = await cached(`transit:${settings.provider}:${base}:${settings.stop.id}:${fetchCount}`, 25, () =>
    settings.provider === 'hafas' ? hafasDepartures(base, settings.stop.id, fetchCount) : efaDepartures(base, settings.stop.id, fetchCount),
  );

  const lines = splitList(settings.lines);
  const exclude = splitList(settings.excludeDestinations);
  const cats = new Set(settings.categories);
  const earliest = Date.now() + settings.walkMinutes * 60000 - 30000;
  const departures = raw
    .filter((d) => cats.has(d.category))
    .filter((d) => !lines.length || lines.includes(d.line.toLowerCase()))
    .filter((d) => !exclude.some((x) => d.destination.toLowerCase().includes(x)))
    .filter((d) => new Date(d.realtime || d.planned).getTime() >= earliest)
    .sort((a, b) => new Date(a.realtime || a.planned) - new Date(b.realtime || b.planned))
    .slice(0, settings.limit);
  return { stop: settings.stop.name, departures };
}
