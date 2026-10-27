import express from 'express';
import { expandIcs, eventDay } from './ical.js';
import { cached, dateKey, splitList } from '../util.js';

// ---- "wastecollect" sidecar (compose profile "waste") ---------------------------------------
// Finds the collection calendar by town/address via the "Waste Collection Schedule" library.

export const WASTE_SERVICE_DOWN = 'Waste search service not enabled – add the waste profile';

export function wastecollectUrl() {
  return (process.env.WASTECOLLECT_URL || 'http://wastecollect:8098').replace(/\/+$/, '');
}

/** JSON call to the sidecar; errors carry `status` (and `data` from the sidecar's JSON error). */
export async function wastecollect(path, { body, timeout = 30000 } = {}) {
  let res;
  try {
    res = await fetch(`${wastecollectUrl()}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    const e = new Error(err.name === 'TimeoutError' ? 'The waste service did not answer in time' : WASTE_SERVICE_DOWN);
    e.status = err.name === 'TimeoutError' ? 504 : 503;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

/** Collection entries [{date, type}] for a configured `service` ({source, title, args}). */
export async function fetchService(service, days = 120) {
  const args = service.args && typeof service.args === 'object' ? service.args : {};
  const key = `wastesvc:${service.source}:${JSON.stringify(args)}`;
  return cached(key, 3 * 3600, async () => (await wastecollect('/fetch', { body: { source: service.source, args, days: Math.max(days, 120) }, timeout: 120000 })).entries || []);
}

/** Admin API (mounted at /api/admin/waste): proxies the sidecar's lookups. */
export function wasteAdminRouter() {
  const r = express.Router();
  const send = (res, err) => {
    const status = err.status === 503 || err.status === 504 ? err.status : err.status >= 400 && err.status < 500 ? err.status : 502;
    res.status(status).json({ ...(err.data || {}), error: err.message, ...(err.status === 503 ? { unavailable: true } : {}) });
  };
  const sourceOk = (s) => /^[a-z0-9_]+$/.test(String(s || ''));
  r.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    try {
      res.json(await wastecollect(`/search?${new URLSearchParams({ q, country: String(req.query.country || 'de') })}`));
    } catch (err) {
      send(res, err);
    }
  });
  r.get('/params', async (req, res) => {
    if (!sourceOk(req.query.source)) return res.status(400).json({ error: 'Unknown source' });
    try {
      res.json(await wastecollect(`/source/${req.query.source}/params?${new URLSearchParams({ lang: String(req.query.lang || 'de') })}`));
    } catch (err) {
      send(res, err);
    }
  });
  r.get('/options', async (req, res) => {
    const { source, param, q = '', args = '{}' } = req.query;
    if (!sourceOk(source) || !param) return res.status(400).json({ error: 'Unknown source' });
    try {
      res.json(await wastecollect(`/source/${source}/options?${new URLSearchParams({ param: String(param), q: String(q), args: String(args) })}`, { timeout: 90000 }));
    } catch (err) {
      send(res, err);
    }
  });
  r.post('/fetch', express.json(), async (req, res) => {
    const { source, args = {} } = req.body || {};
    if (!sourceOk(source)) return res.status(400).json({ error: 'Unknown source' });
    try {
      res.json(await wastecollect('/fetch', { body: { source, args, days: 120 }, timeout: 120000 }));
    } catch (err) {
      send(res, err);
    }
  });
  return r;
}

function addDays(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function waste(settings, cfg) {
  const tz = cfg.general.timezone;
  const now = new Date();
  const today = dateKey(now, tz);
  const last = addDays(today, settings.daysAhead);
  // past collections stay visible for this many days ("yesterday", "the day before yesterday", …)
  const pastDays = settings.showPastDays || 0;
  const first = addDays(today, -pastDays);
  const types = settings.types.map((t) => ({ ...t, keys: splitList(t.keywords) }));
  const byName = new Map(types.map((t) => [t.name.toLowerCase(), t]));
  const days = new Map();
  const errors = [];

  const add = (day, item) => {
    if (day < first || day > last) return;
    if (!days.has(day)) days.set(day, []);
    const list = days.get(day);
    if (!list.some((i) => i.name === item.name)) list.push(item);
  };

  const classify = (title) => {
    const t = String(title || '').toLowerCase();
    return types.find((type) => type.keys.some((k) => t.includes(k)));
  };

  // an entry from a calendar (iCal or waste service): map its title onto the configured types
  const addTitled = (day, title) => {
    const type = classify(title);
    if (type) {
      if (type.enabled) add(day, { name: type.name, color: type.color });
    } else if (settings.showUnknown && title) {
      add(day, { name: title, color: '#9ca3af' });
    }
  };

  const service = settings.service;
  const serviceJob = service?.source
    ? fetchService(service, settings.daysAhead + 1)
        .then((entries) => entries.forEach((e) => addTitled(String(e.date).slice(0, 10), String(e.type || ''))))
        .catch((err) => errors.push(`${service.title || service.source}: ${err.message}`))
    : null;

  await Promise.all(
    settings.sources
      .filter((s) => s.url)
      .map(async (s) => {
        try {
          const items = await expandIcs(s.url, new Date(now.getTime() - (pastDays + 1) * 86400000), new Date(now.getTime() + (settings.daysAhead + 1) * 86400000));
          for (const it of items) addTitled(eventDay(it, tz), it.title);
        } catch (err) {
          errors.push(`${s.name}: ${err.message}`);
        }
      }),
  );
  await serviceJob;

  for (const m of settings.manual) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.startDate)) continue;
    const type = byName.get(m.type.toLowerCase());
    if (type && !type.enabled) continue;
    const step = m.intervalWeeks * 7;
    const start = new Date(`${m.startDate}T12:00:00Z`);
    const diffDays = Math.round((new Date(`${first}T12:00:00Z`) - start) / 86400000);
    let k = diffDays > 0 ? Math.ceil(diffDays / step) : 0;
    for (let day = addDays(m.startDate, k * step); day <= last; day = addDays(m.startDate, ++k * step)) {
      add(day, { name: type?.name || m.type, color: type?.color || '#9ca3af' });
    }
  }

  const sorted = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  // "max. collection days" counts upcoming days; past ones come on top
  const list = [...sorted.filter(([d]) => d < today), ...sorted.filter(([d]) => d >= today).slice(0, settings.maxEntries)]
    .map(([date, items]) => ({ date, items, past: date < today }));

  return { today, tomorrow: addDays(today, 1), days: list, errors };
}
