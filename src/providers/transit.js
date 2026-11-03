import { cached, fetchJson, splitList } from '../util.js';
import { transitBaseUrl } from '../../public/shared/modules.js';

export const EFA_CLASS = {
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

// Disruption texts are HTML snippets: plain text, shortened.
export const plainText = (html, max = 240) => {
  const s = String(html || '').replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')} …` : s;
};

function efaInfos(e) {
  return (e.infos || []).flatMap((i) => (i.infoLinks?.length ? i.infoLinks : [i]).map((l) => ({
    id: i.id || l.urlText,
    title: plainText(l.urlText || l.subtitle || l.title || '', 120),
    text: plainText(l.content || l.subtitle || ''),
    priority: i.priority || 'normal',
  }))).filter((x) => x.title || x.text);
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

async function efaDepartures(base, stopId, count, withStops = false) {
  const params = new URLSearchParams({
    outputFormat: 'rapidJSON', mode: 'direct', type_dm: 'any', name_dm: stopId, useRealtime: '1',
    limit: String(count), depType: 'stopEvents', includeCompleteStopSeq: withStops ? '1' : '0', useAllStops: '1',
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
      // following stops (only requested for the "via" filter)
      next: (e.onwardLocations || []).map((o) => o.parent?.name || o.name || '').filter(Boolean),
      infos: efaInfos(e),
    };
  });
}

// ---- HAFAS REST (db-rest / vbb-rest / transport.rest compatible) -----------
async function hafasSearch(base, q) {
  const data = await fetchJson(`${base}/locations?${new URLSearchParams({ query: q, results: '15', addresses: 'false', poi: 'false' })}`);
  return (Array.isArray(data) ? data : []).filter((l) => l.type === 'stop' || l.type === 'station').map((l) => ({ id: l.id, name: l.name }));
}

async function hafasDepartures(base, stopId, count, withStops = false, remarks = false) {
  const data = await fetchJson(`${base}/stops/${encodeURIComponent(stopId)}/departures?${new URLSearchParams({ duration: '120', results: String(count), remarks: String(remarks), stopovers: String(withStops) })}`);
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
    next: (d.nextStopovers || []).slice(1).map((s) => s.stop?.name || '').filter(Boolean),
    // only warnings (disruptions), not hints like "bicycles allowed"
    infos: (d.remarks || []).filter((r) => r.type === 'warning').map((r) => ({ id: r.id || r.summary, title: plainText(r.summary || '', 120), text: plainText(r.text || ''), priority: r.priority > 50 ? 'high' : 'normal' })),
  }));
}

// "Leipzig, Augustusplatz" → "augustusplatz" for matching; umlauts/ß folded.
export const normStop = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const shortStop = (s) => s.replace(/^[^,]+,\s*/, '');

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
  // "via" filter: only departures that stop at one of these stops later on.
  const via = splitList(settings.viaStops).map(normStop);
  const fetchCount = Math.min(via.length ? 120 : 80, settings.limit * (via.length ? 8 : 4) + 10);
  const remarks = settings.showDisruptions !== false;
  const raw = await cached(`transit:${settings.provider}:${base}:${settings.stop.id}:${fetchCount}:${via.length > 0}:${remarks}`, 25, () =>
    settings.provider === 'hafas' ? hafasDepartures(base, settings.stop.id, fetchCount, via.length > 0, remarks) : efaDepartures(base, settings.stop.id, fetchCount, via.length > 0),
  );

  const lines = splitList(settings.lines);
  const exclude = splitList(settings.excludeDestinations);
  const cats = new Set(settings.categories);
  // With the leave-now indicator, departures you can still catch by hurrying (rushMinutes) stay
  // on the board; with hideUnreachable off, missed ones are kept too (shown greyed out).
  const goNow = settings.goNow;
  const walk = goNow ? (settings.hideUnreachable === false ? 0 : Math.max(0, settings.walkMinutes - (settings.rushMinutes ?? 3))) : settings.walkMinutes;
  const earliest = Date.now() + walk * 60000 - 30000;
  const departures = raw
    .map((d) => {
      if (!via.length) return d;
      const hit = d.next.find((n) => via.some((v) => normStop(n).includes(v)));
      return hit ? { ...d, via: shortStop(hit) } : null;
    })
    .filter(Boolean)
    .map(({ next, ...d }) => d)
    .filter((d) => !(settings.hideCancelled && d.cancelled))
    .filter((d) => cats.has(d.category))
    .filter((d) => !lines.length || lines.includes(d.line.toLowerCase()))
    .filter((d) => !exclude.some((x) => d.destination.toLowerCase().includes(x)));
  // Disruptions of the lines that run here (after the filters, over all fetched departures –
  // also lines that leave later), each message once with the lines it affects.
  const infos = new Map();
  if (remarks) {
    for (const d of departures) {
      for (const i of d.infos || []) {
        const e = infos.get(i.id) || { ...i, lines: [] };
        if (!e.lines.some((l) => l.line === d.line)) e.lines.push({ line: d.line, category: d.category });
        infos.set(i.id, e);
      }
    }
  }
  const board = departures
    .map(({ infos: _i, ...d }) => d)
    .filter((d) => new Date(d.realtime || d.planned).getTime() >= earliest)
    .sort((a, b) => new Date(a.realtime || a.planned) - new Date(b.realtime || b.planned))
    .slice(0, settings.limit);
  const disruptions = [...infos.values()].sort((a, b) => (b.priority === 'high') - (a.priority === 'high')).slice(0, Math.max(1, Number(settings.disruptionsMax) || 2));
  return { stop: settings.stop.name, departures: board, ...(disruptions.length ? { disruptions } : {}) };
}
