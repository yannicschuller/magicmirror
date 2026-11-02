// Electricity prices: day-ahead exchange price (Energy-Charts, aWATTar as fallback for
// Germany/Austria) or the Tibber tariff, as hourly prices in ct/kWh for today and tomorrow,
// plus the cheapest window and optional live values from Home Assistant.
import crypto from 'node:crypto';
import { cached, fetchJson, fetchRaw, dateKey } from '../util.js';
import { haConnection } from '../sensors.js';
import { normalizeUrl } from './homeassistant.js';

const HOUR = 3600000;
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// Slots of any length (15 min, 1 h) → hourly averages { start: ms, price }.
export function hourly(slots) {
  const byHour = new Map();
  for (const s of slots) {
    if (!Number.isFinite(s.price)) continue;
    const h = Math.floor(s.start / HOUR) * HOUR;
    const e = byHour.get(h) || { sum: 0, n: 0 };
    e.sum += s.price;
    e.n++;
    byHour.set(h, e);
  }
  return [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([start, e]) => ({ start, price: round(e.sum / e.n, 2) }));
}

// Cheapest block of `hours` consecutive hours starting at or after the current hour.
export function cheapestWindow(hours, n, now) {
  if (!n || n < 1) return null;
  const from = hours.findIndex((h) => h.start + HOUR > now);
  if (from < 0) return null;
  let best = null;
  for (let i = from; i + n <= hours.length; i++) {
    const block = hours.slice(i, i + n);
    if (block.some((h, j) => j && h.start - block[j - 1].start !== HOUR)) continue; // gap
    const avg = block.reduce((a, h) => a + h.price, 0) / n;
    if (!best || avg < best.avg) best = { start: block[0].start, end: block[n - 1].start + HOUR, avg: round(avg, 2) };
  }
  return best;
}

export function level(price, avg, cheapBelow) {
  if (!Number.isFinite(price)) return null;
  if (cheapBelow > 0) return price < cheapBelow ? 'cheap' : price > avg * 1.1 ? 'expensive' : 'normal';
  return price < avg * 0.9 ? 'cheap' : price > avg * 1.1 ? 'expensive' : 'normal';
}

// ---- sources ---------------------------------------------------------------------------
async function energyCharts(zone, from, to) {
  const j = await fetchJson(`https://api.energy-charts.info/price?bzn=${encodeURIComponent(zone)}&start=${from}&end=${to}`, { timeout: 20000 });
  const secs = j.unix_seconds || [];
  return secs.map((t, i) => ({ start: t * 1000, price: Number.isFinite(j.price?.[i]) ? j.price[i] / 10 : NaN })); // €/MWh → ct/kWh
}

async function awattar(zone, startMs) {
  const host = zone === 'AT' ? 'api.awattar.at' : 'api.awattar.de';
  const j = await fetchJson(`https://${host}/v1/marketdata?start=${startMs}&end=${startMs + 2 * 24 * HOUR}`, { timeout: 20000 });
  return (j.data || []).map((d) => ({ start: d.start_timestamp, price: d.marketprice / 10 }));
}

async function exchangePrices(s, tz, now) {
  const zone = s.zone || 'DE-LU';
  const today = dateKey(new Date(now), tz);
  const tomorrow = dateKey(new Date(now + 24 * HOUR), tz);
  // tomorrow's prices appear around 13:00 – refresh hourly until then
  return cached(`energy:ec:${zone}:${today}`, 3600, async () => {
    try {
      const slots = await energyCharts(zone, today, tomorrow);
      if (slots.some((x) => Number.isFinite(x.price))) return slots;
      throw new Error('no data');
    } catch (err) {
      if (zone !== 'DE-LU' && zone !== 'AT') throw err;
      const midnight = Date.parse(`${today}T00:00:00Z`) - 12 * HOUR;
      return awattar(zone, midnight);
    }
  });
}

const TIBBER_QUERY = '{ viewer { homes { currentSubscription { priceInfo { today { total startsAt level } tomorrow { total startsAt level } } } } } }';

async function tibberPrices(token, today) {
  const key = `energy:tibber:${crypto.createHash('sha1').update(token).digest('hex')}:${today}`;
  return cached(key, 3600, async () => {
    const res = await fetchRaw('https://api.tibber.com/v1-beta/gql', {
      method: 'POST',
      timeout: 20000,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: TIBBER_QUERY }),
    }).catch((err) => {
      throw new Error(/HTTP 401|HTTP 400/.test(err.message) ? 'Tibber: invalid access token' : err.message);
    });
    const j = await res.json();
    if (j.errors?.length) throw new Error(`Tibber: ${j.errors[0].message}`);
    const info = j.data?.viewer?.homes?.find((h) => h.currentSubscription)?.currentSubscription?.priceInfo;
    if (!info) throw new Error('Tibber: no active subscription found');
    return [...(info.today || []), ...(info.tomorrow || [])].map((p) => ({ start: Date.parse(p.startsAt), price: p.total * 100 }));
  });
}

// Live values from Home Assistant (W or kW → kW).
async function homeValues(s, cfg) {
  const ids = { pv: s.pvEntity, grid: s.gridEntity, battery: s.batteryEntity };
  if (!Object.values(ids).some((v) => String(v || '').trim())) return null;
  const conn = haConnection(cfg);
  if (!conn) return { error: 'Home Assistant: no connection configured' };
  const base = normalizeUrl(conn.url);
  const out = {};
  for (const [k, id] of Object.entries(ids)) {
    if (!String(id || '').trim()) continue;
    try {
      const st = await fetchJson(`${base}/api/states/${encodeURIComponent(id.trim())}`, { timeout: 8000, headers: { Authorization: `Bearer ${String(conn.token).trim()}` } });
      const v = Number(st.state);
      if (!Number.isFinite(v)) continue;
      const unit = String(st.attributes?.unit_of_measurement || '').toLowerCase();
      out[k] = k === 'battery' ? Math.round(v) : round(unit === 'kw' ? v : v / 1000, 2);
    } catch (err) {
      out.error = `Home Assistant: ${err.message}`;
    }
  }
  return out;
}

export async function provider(settings, cfg, mod, { now = Date.now() } = {}) {
  const s = settings;
  const tz = cfg.general.timezone || 'Europe/Berlin';
  const today = dateKey(new Date(now), tz);
  let slots;
  if (s.source === 'tibber') {
    const token = String(s.tibberToken || '').trim();
    if (!token) return { needsSetup: true };
    slots = await tibberPrices(token, today);
  } else {
    const factor = 1 + Math.max(0, Number(s.vat) || 0) / 100;
    const add = Math.max(0, Number(s.surcharge) || 0);
    slots = (await exchangePrices(s, tz, now)).map((x) => ({ ...x, price: (x.price + add) * factor }));
  }
  const hours = hourly(slots);
  const todayHours = hours.filter((h) => dateKey(new Date(h.start), tz) === today);
  if (!todayHours.length) throw new Error('No prices for today');
  const prices = todayHours.map((h) => h.price);
  const avg = round(prices.reduce((a, b) => a + b, 0) / prices.length, 2);
  const cheapBelow = Number(s.cheapBelow) || 0;
  const cur = hours.find((h) => h.start <= now && now < h.start + HOUR) || null;
  const current = cur ? { price: cur.price, level: level(cur.price, avg, cheapBelow) } : null;
  const n = Math.min(12, Math.max(0, Number(s.windowHours) || 0));
  return {
    source: s.source === 'tibber' ? 'tibber' : 'exchange',
    current,
    today: { min: Math.min(...prices), max: Math.max(...prices), avg },
    hours: hours.filter((h) => dateKey(new Date(h.start), tz) >= today).map((h) => ({ ...h, level: level(h.price, avg, cheapBelow) })),
    window: n ? cheapestWindow(hours, n, now) : null,
    windowHours: n,
    hasTomorrow: hours.some((h) => dateKey(new Date(h.start), tz) > today),
    home: await homeValues(s, cfg),
  };
}
