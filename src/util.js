const UA = 'MagicMirror/1.0 (+https://github.com/yannicschuller/magicmirror)';

export async function fetchRaw(url, { timeout = 15000, headers = {}, ...opts } = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} von ${new URL(url).host}`);
  return res;
}

export async function fetchJson(url, opts) {
  return (await fetchRaw(url, { ...opts, headers: { Accept: 'application/json', ...(opts?.headers || {}) } })).json();
}

export async function fetchText(url, opts) {
  return (await fetchRaw(url, opts)).text();
}

// Small TTL cache that deduplicates concurrent requests and can serve stale
// values when the upstream fails.
const store = new Map();

export async function cached(key, ttlSeconds, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.value !== undefined && hit.expires > now) return hit.value;
  if (hit && hit.pending) return hit.pending;
  const pending = (async () => {
    try {
      const value = await fn();
      store.set(key, { value, expires: Date.now() + ttlSeconds * 1000, stored: Date.now() });
      return value;
    } catch (err) {
      if (hit && hit.value !== undefined) {
        store.set(key, { ...hit, pending: null, expires: Date.now() + Math.min(ttlSeconds, 60) * 1000 });
        console.warn(`[cache] ${key}: ${err.message} – liefere alte Daten`);
        return hit.value;
      }
      store.delete(key);
      throw err;
    }
  })();
  store.set(key, { ...(hit || {}), pending });
  return pending;
}

// Drop old cache entries now and then so the Pi's memory stays small.
setInterval(() => {
  const limit = Date.now() - 6 * 3600 * 1000;
  for (const [k, v] of store) if (!v.pending && v.stored < limit) store.delete(k);
}, 3600 * 1000).unref();

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// YYYY-MM-DD for a Date in a given IANA time zone.
export function dateKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function splitList(text) {
  return String(text || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
