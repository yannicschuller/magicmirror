// Parcel tracking.
//
// DHL "Shipment Tracking – Unified" (developer.dhl.com): free plan = 250 calls
// per day and at most one call every 5 s. Every tracking number is polled on
// its own cadence (see nextDelay): 30 min while on its way, 2 h before the
// first scan, 6 h once delivered (and not at all after it is hidden). The
// interval is stretched to 86400 s × (DHL parcels) / DHL_BUDGET, so the total
// stays ≤ 200 calls/day however many parcels are configured – e.g. 3 parcels
// in transit ≈ 144 calls/day, 6 parcels ≈ 200 (every 43 min). A daily hard cap
// (DHL_DAILY_CAP) and a 5.5 s gap between calls guard the rest.
//
// 17TRACK (api.17track.net, v2.2): every newly registered number uses one unit
// of the account quota (new accounts get 200 once). Reading registered numbers
// with /gettrackinfo is free; 17TRACK itself refreshes carriers only every few
// hours, so we ask hourly (3 req/s allowed).
//
// Results live in a module-level map (not util.cached) because the next poll
// time depends on the result. Errors keep the last good result.
import { createHash } from 'node:crypto';
import { fetchRaw } from '../util.js';
import { translator, langOf } from '../../public/shared/i18n.js';

const DHL_API = 'https://api-eu.dhl.com/track/shipments';
const T17_API = 'https://api.17track.net/track/v2.2';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DHL_BUDGET = 200;
const DHL_DAILY_CAP = 235;
const DHL_GAP = 5500;
const MAX_PARCELS = 15;

// Errors carry their message id so they can be translated (see tasks.js).
function fail(id, params) {
  const err = new Error(translator('en')(id, params));
  err.msgId = id;
  err.params = params;
  return err;
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const hash = (...parts) => createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 12);

// ---- time ---------------------------------------------------------------------------

function tzOffset(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// ISO with offset → as is; DHL Paket sends local wall-clock time without
// offset ("2026-10-28T09:12:00") → interpret in the mirror's time zone.
export function toIso(value, timeZone = 'Europe/Berlin') {
  const s = clean(value);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  if (m[7]) {
    const t = Date.parse(s.replace(' ', 'T'));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  let t = guess - tzOffset(new Date(guess), timeZone);
  t = guess - tzOffset(new Date(t), timeZone);
  return new Date(t).toISOString();
}

// ---- status -------------------------------------------------------------------------
// Normalised statuses: pre | transit | out | pickup | delivered | exception | unknown

const OUT_RE = /out for delivery|with delivery courier|on (the )?vehicle for delivery|in zustellung|zustellfahrzeug|zustellung heute|wird heute zugestellt|heute zugestellt/i;
const PICKUP_RE = /ready for pick|available for pick|awaiting collection|abholbereit|zur abholung|kann .*abgeholt werden|liegt .*(filiale|packstation|paketshop).*bereit/i;

const DHL_RANK = { unknown: -1, 'pre-transit': 0, transit: 1, failure: 1, delivered: 2 };

function dhlStatus(code, text) {
  if (code === 'delivered') return 'delivered';
  if (code === 'failure') return 'exception';
  if (code === 'pre-transit') return 'pre';
  if (code === 'transit') {
    if (OUT_RE.test(text)) return 'out';
    if (PICKUP_RE.test(text)) return 'pickup';
    return 'transit';
  }
  return 'unknown';
}

const dhlText = (e) => clean(e?.description) || clean(e?.status);
const dhlPlace = (e) => clean(e?.location?.address?.addressLocality);

// One shipment of a DHL response → normalised parcel info.
export function parseDhl(json, timeZone = 'Europe/Berlin') {
  const s = json?.shipments?.[0];
  if (!s) return { status: 'unknown', text: '', location: '', time: null, eta: null, carrier: 'DHL' };
  let latest = s.status || {};
  // DHL Paket sometimes sends a late "pre-transit" (electronic data received)
  // after the parcel was already scanned – keep the most advanced state.
  if (latest.statusCode === 'pre-transit') {
    const better = (s.events || []).find((e) => (DHL_RANK[e.statusCode] ?? -1) > 0);
    if (better) latest = better;
  }
  const text = dhlText(latest);
  const status = dhlStatus(latest.statusCode, `${clean(latest.status)} ${clean(latest.description)}`);
  const frame = s.estimatedDeliveryTimeFrame || {};
  const from = toIso(frame.estimatedFrom, timeZone) || toIso(s.estimatedTimeOfDelivery, timeZone);
  const to = toIso(frame.estimatedThrough, timeZone) || from;
  const time = toIso(latest.timestamp, timeZone);
  return {
    status,
    text,
    location: dhlPlace(latest),
    time,
    eta: status !== 'delivered' && from ? { from, to } : null,
    deliveredAt: status === 'delivered' ? time : null,
    carrier: s.service === 'express' ? 'DHL Express' : 'DHL',
  };
}

const T17_STATUS = {
  NotFound: 'unknown',
  InfoReceived: 'pre',
  InTransit: 'transit',
  Expired: 'unknown',
  AvailableForPickup: 'pickup',
  OutForDelivery: 'out',
  DeliveryFailure: 'exception',
  Delivered: 'delivered',
  Exception: 'exception',
};

// One accepted item of a 17TRACK /gettrackinfo response → normalised info.
export function parse17(item) {
  const info = item?.track_info || {};
  const status = T17_STATUS[info.latest_status?.status] || 'unknown';
  const ev = info.latest_event || {};
  const time = toIso(ev.time_utc) || toIso(ev.time_iso);
  const est = info.time_metrics?.estimated_delivery_date || {};
  const from = toIso(est.from);
  const to = toIso(est.to) || from;
  const provider = info.tracking?.providers?.[0]?.provider;
  return {
    status,
    text: clean(ev.description_translation?.description) || clean(ev.description),
    location: clean(ev.location),
    time,
    eta: status !== 'delivered' && from ? { from: from || to, to } : null,
    deliveredAt: status === 'delivered' ? time : null,
    carrier: clean(provider?.name) || '',
  };
}

// ---- API calls ------------------------------------------------------------------------

let dhlQueue = Promise.resolve();
let dhlLast = 0;
const dhlCount = { day: '', n: 0 };

function dhlBudgetLeft(now = new Date()) {
  const day = now.toISOString().slice(0, 10); // DHL counts per UTC day
  if (dhlCount.day !== day) Object.assign(dhlCount, { day, n: 0 });
  return DHL_DAILY_CAP - dhlCount.n;
}

// Serialised so DHL never sees two calls within 5 s.
function dhlThrottled(fn) {
  const run = dhlQueue.then(async () => {
    const wait = dhlLast + DHL_GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (dhlBudgetLeft() <= 0) throw fail('Daily DHL query limit reached – trying again tomorrow');
    dhlCount.n++;
    dhlLast = Date.now();
    return fn();
  });
  dhlQueue = run.catch(() => {});
  return run;
}

export const NOT_FOUND = 'not-found';

export async function fetchDhl({ number, postalCode, apiKey, lang, timeZone, base = DHL_API, throttle = dhlThrottled }) {
  const params = new URLSearchParams({ trackingNumber: number, language: lang === 'de' ? 'de' : 'en' });
  if (postalCode) params.set('recipientPostalCode', postalCode);
  const url = `${base}?${params}`;
  return throttle(async () => {
    let res;
    try {
      res = await fetch(url, { headers: { 'DHL-API-Key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    } catch (err) {
      throw fail('DHL not reachable ({reason})', { reason: err.cause?.code || err.message });
    }
    if (res.status === 404) return { status: NOT_FOUND };
    if (res.status === 401 || res.status === 403) throw fail('DHL rejected the API key');
    if (res.status === 429) throw fail('DHL query limit reached – trying again later');
    if (!res.ok) throw fail('DHL error (HTTP {status})', { status: res.status });
    return parseDhl(await res.json(), timeZone);
  });
}

async function post17(base, path, apiKey, body) {
  let res;
  try {
    res = await fetchRaw(`${base}/${path}`, { method: 'POST', headers: { '17token': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    if (/HTTP 40[13]\b/.test(err.message)) throw fail('17TRACK rejected the API key');
    if (/HTTP 429\b/.test(err.message)) throw fail('17TRACK query limit reached – trying again later');
    throw fail('17TRACK not reachable ({reason})', { reason: err.cause?.code || err.message });
  }
  const json = await res.json();
  if (json?.code !== 0) throw fail('17TRACK error: {message}', { message: clean(json?.data?.errors?.[0]?.message) || `code ${json?.code}` });
  return json.data || {};
}

const T17_NOT_REGISTERED = -18019902;
const T17_ALREADY_REGISTERED = -18019901;

export async function fetch17({ number, apiKey, base = T17_API }) {
  const data = await post17(base, 'gettrackinfo', apiKey, [{ number }]);
  const ok = (data.accepted || []).find((a) => a.number === number);
  if (ok) return parse17(ok);
  const rej = (data.rejected || []).find((r) => r.number === number) || data.rejected?.[0];
  if (rej?.error?.code !== T17_NOT_REGISTERED) {
    if (rej) throw fail('17TRACK error: {message}', { message: clean(rej.error?.message) || `code ${rej.error?.code}` });
    return { status: NOT_FOUND };
  }
  // First query of this number: register it (uses one unit of the quota).
  const reg = await post17(base, 'register', apiKey, [{ number, auto_detection: true }]);
  const regRej = (reg.rejected || [])[0];
  if (regRej && regRej.error?.code !== T17_ALREADY_REGISTERED) {
    throw fail('17TRACK error: {message}', { message: clean(regRej.error?.message) || `code ${regRej.error?.code}` });
  }
  return { status: 'unknown', registered: true, text: '', location: '', time: null, eta: null, carrier: '' };
}

// ---- polling state ------------------------------------------------------------------

const state = new Map(); // key → { result, error, nextAt, pending, usedAt, route }

// Milliseconds until the next poll of a parcel with this result.
export function nextDelay(result, source, dhlParcels) {
  const s = result?.status;
  let base;
  if (s === NOT_FOUND || result?.registered) base = source === 'dhl' ? 3 * HOUR : 20 * MIN;
  else if (s === 'delivered') base = 6 * HOUR;
  else if (s === 'pre' || s === 'unknown') base = 2 * HOUR;
  else base = source === 'dhl' ? 30 * MIN : HOUR;
  if (source === 'dhl') base = Math.max(base, (86400 * 1000 * Math.max(1, dhlParcels)) / DHL_BUDGET);
  return base;
}

// Route for a parcel: 'dhl' | '17track' | null (no usable key).
export function routeOf(carrier, keys, remembered) {
  if (carrier === 'dhl') return keys.dhl ? 'dhl' : null;
  if (carrier === 'other') return keys.t17 ? '17track' : null;
  if (remembered && (remembered === 'dhl' ? keys.dhl : keys.t17)) return remembered;
  return keys.dhl ? 'dhl' : keys.t17 ? '17track' : null;
}

export function _resetState() {
  state.clear();
  dhlQueue = Promise.resolve();
  dhlLast = 0;
  Object.assign(dhlCount, { day: '', n: 0 });
}

async function refresh(entry, p, ctx) {
  const { keys, dhlParcels, lang, timeZone, apis } = ctx;
  let route = routeOf(p.carrier, keys, entry.route);
  let result;
  if (route === 'dhl') {
    result = await fetchDhl({ number: p.number, postalCode: p.postalCode, apiKey: keys.dhl, lang, timeZone, base: apis?.dhl, throttle: apis?.throttle });
    // Unknown at DHL → maybe another carrier: ask 17TRACK once and remember.
    if (result.status === NOT_FOUND && p.carrier === 'auto' && keys.t17) {
      route = '17track';
      result = await fetch17({ number: p.number, apiKey: keys.t17, base: apis?.t17 });
    }
  } else {
    result = await fetch17({ number: p.number, apiKey: keys.t17, base: apis?.t17 });
  }
  entry.route = route;
  entry.result = result;
  entry.error = null;
  entry.nextAt = Date.now() + nextDelay(result, route === 'dhl' ? 'dhl' : '17track', dhlParcels);
}

function poll(key, p, ctx) {
  let entry = state.get(key);
  if (!entry) state.set(key, (entry = { result: null, error: null, nextAt: 0, pending: null, route: null }));
  entry.usedAt = Date.now();
  if (entry.pending) return entry.pending;
  const hide = ctx.hideMs;
  const r = entry.result;
  // Delivered and already hidden → never ask again.
  if (r?.status === 'delivered' && r.deliveredAt && Date.now() - Date.parse(r.deliveredAt) > hide) return Promise.resolve(entry);
  if (Date.now() < entry.nextAt) return Promise.resolve(entry);
  entry.pending = refresh(entry, p, ctx)
    .catch((err) => {
      entry.error = err;
      entry.nextAt = Date.now() + (entry.result ? 30 * MIN : 15 * MIN);
    })
    .then(() => {
      entry.pending = null;
      return entry;
    });
  return entry.pending;
}

// Forget parcels nobody asked about for a week.
function prune() {
  const limit = Date.now() - 7 * 24 * HOUR;
  for (const [k, v] of state) if (!v.pending && v.usedAt < limit) state.delete(k);
}

// ---- output -------------------------------------------------------------------------------

const ORDER = { out: 0, pickup: 1, exception: 2, transit: 3, pre: 4, unknown: 5, delivered: 6 };

export function visibleParcels(list, hideDays, now = Date.now()) {
  const hideMs = Math.max(0, Number(hideDays) || 0) * 24 * HOUR;
  return list
    .filter((p) => p.status !== 'delivered' || (hideMs > 0 && (!p.deliveredAt || now - Date.parse(p.deliveredAt) <= hideMs)))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ORDER[a.p.status] - ORDER[b.p.status] || a.i - b.i)
    .map(({ p }) => p);
}

const mask = (n) => `…${n.slice(-4)}`;

export async function provider(settings, cfg, mod, apis) {
  const t = translator(langOf(cfg.general.locale));
  const lang = langOf(cfg.general.locale);
  const timeZone = cfg.general.timezone || 'Europe/Berlin';
  const keys = { dhl: clean(settings.dhlApiKey), t17: clean(settings.trackApiKey) };
  const wanted = (settings.parcels || [])
    .filter((p) => p && p.enabled !== false)
    .map((p) => ({ name: clean(p.name), number: clean(p.number).replace(/\s+/g, '').toUpperCase(), carrier: p.carrier || 'auto', postalCode: clean(p.postalCode).replace(/\s+/g, '') }))
    .filter((p) => p.number)
    .slice(0, MAX_PARCELS);
  if (!wanted.length) return { parcels: [], total: 0, hidden: 0 };
  if (!keys.dhl && !keys.t17) throw new Error(t('No DHL or 17TRACK API key set'));

  const dhlParcels = wanted.filter((p) => routeOf(p.carrier, keys, null) === 'dhl').length;
  const hideMs = Math.max(0, Number(settings.hideDeliveredDays) || 0) * 24 * HOUR;
  const ctx = { keys, dhlParcels, lang, timeZone, hideMs, apis };
  prune();

  const tr = (err) => (err?.msgId ? t(err.msgId, err.params) : err?.message || '');
  const list = await Promise.all(
    wanted.map(async (p) => {
      const name = p.name || mask(p.number);
      if (!routeOf(p.carrier, keys, null)) {
        return { name, carrier: '', status: 'unknown', text: '', location: '', time: null, eta: null, deliveredAt: null, error: t(p.carrier === 'dhl' ? 'No DHL API key set' : 'No 17TRACK API key set') };
      }
      const key = hash(p.number, p.postalCode, p.carrier, keys.dhl, keys.t17);
      const entry = await poll(key, p, ctx);
      const r = entry.result;
      const base = { name, carrier: r?.carrier || '', text: '', location: '', time: null, eta: null, deliveredAt: null };
      if (!r) return { ...base, status: 'unknown', error: tr(entry.error) };
      if (r.status === NOT_FOUND) return { ...base, status: 'unknown', text: t('Not found yet – the carrier may not have scanned it'), error: entry.error ? tr(entry.error) : null };
      const out = { ...base, ...r, error: entry.error ? tr(entry.error) : null };
      if (r.registered) out.text = t('Registered at 17TRACK – waiting for the first update');
      delete out.registered;
      return out;
    }),
  );
  const parcels = visibleParcels(list, settings.hideDeliveredDays);
  return { parcels, total: list.length, hidden: list.length - parcels.length };
}

export const parcels = provider;
