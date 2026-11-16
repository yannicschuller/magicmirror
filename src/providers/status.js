// Service status: Uptime Kuma (public status page API), a status JSON of your own, or a
// Statuspage.io page. Every source becomes
//   { title, services: [{ key, name, status, latency, code, message, since, uptime, history }],
//     incidents: [{ title, status, since }], updatedAt }
// with status 'up' | 'degraded' | 'down' | 'maintenance' | 'pending' | 'unknown' and history
// as a list of those statuses, oldest first.
import { cached, fetchJson } from '../util.js';

const HISTORY = 30;
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const base = (u) => String(u || '').trim().replace(/\/+$/, '');

// "up", "OK", "operational", true, 1 … → our status names.
export function normStatus(v) {
  if (v === true) return 'up';
  if (v === false) return 'down';
  const s = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['up', 'ok', 'online', 'operational', 'healthy', 'pass', 'passing', 'running', 'green', '1'].includes(s)) return 'up';
  if (['degraded', 'degraded_performance', 'partial', 'partial_outage', 'warn', 'warning', 'slow', 'yellow'].includes(s)) return 'degraded';
  if (['down', 'error', 'offline', 'major_outage', 'outage', 'fail', 'failed', 'critical', 'unhealthy', 'red', '0'].includes(s)) return 'down';
  if (['maintenance', 'under_maintenance', 'paused', '3'].includes(s)) return 'maintenance';
  if (['pending', 'starting', '2'].includes(s)) return 'pending';
  return 'unknown';
}

const KUMA = { 0: 'down', 1: 'up', 2: 'pending', 3: 'maintenance' };
// Kuma stores UTC as "2026-11-16 01:40:51.450" (no zone).
const kumaTime = (t) => (t ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${String(t).replace(' ', 'T')}Z`).toISOString() : null);

// ---- Uptime Kuma ---------------------------------------------------------------------------
export function fromKuma(page, beats) {
  const out = { title: page.config?.title || '', services: [], incidents: [] };
  for (const g of page.publicGroupList || []) {
    for (const m of g.monitorList || []) {
      const hb = beats.heartbeatList?.[m.id] || [];
      const last = hb.at(-1);
      const status = last ? KUMA[last.status] || 'unknown' : 'unknown';
      // since: the first beat of the current run of equal statuses
      let i = hb.length - 1;
      while (i > 0 && hb[i - 1].status === last?.status) i--;
      out.services.push({
        key: String(m.id),
        name: m.name,
        group: g.name,
        status,
        latency: Number.isFinite(last?.ping) ? last.ping : null,
        message: last?.msg || null,
        since: hb.length && i > 0 ? kumaTime(hb[i].time) : null,
        uptime: Number.isFinite(beats.uptimeList?.[`${m.id}_24`]) ? beats.uptimeList[`${m.id}_24`] : null,
        history: hb.slice(-HISTORY).map((b) => KUMA[b.status] || 'unknown'),
      });
    }
  }
  const incidents = page.incidents || (page.incident ? [page.incident] : []);
  for (const i of incidents) out.incidents.push({ title: i.title || i.content || '', status: i.style === 'danger' ? 'down' : i.style === 'warning' ? 'degraded' : 'unknown', since: i.createdDate ? kumaTime(i.createdDate) : null });
  for (const m of page.maintenanceList || []) out.incidents.push({ title: m.title || m.description || '', status: 'maintenance', since: null });
  return out;
}

async function kuma(s) {
  const url = base(s.url);
  const slug = String(s.slug || '').trim().replace(/^\/?(status\/)?/, '');
  if (!url || !slug) return null;
  const [page, beats] = await Promise.all([
    cached(`status:kuma:${url}:${slug}`, 300, () => fetchJson(`${url}/api/status-page/${encodeURIComponent(slug)}`, { timeout: 10000 })),
    cached(`status:kuma-hb:${url}:${slug}`, 45, () => fetchJson(`${url}/api/status-page/heartbeat/${encodeURIComponent(slug)}`, { timeout: 10000 })),
  ]).catch((err) => {
    throw new Error(/HTTP 404/.test(err.message) ? `Uptime Kuma: status page "${slug}" not found` : `Uptime Kuma: ${err.message}`);
  });
  return fromKuma(page, beats);
}

// ---- own JSON ---------------------------------------------------------------------------------
// Accepts { services: { key: { status, latency, code, message, since } }, days, incidents },
// { services: [{ name, status, … }] }, a plain array or a map { key: "up" | { status } }.
export function fromJson(j) {
  const out = { title: j?.title || j?.name || '', services: [], incidents: [], updatedAt: j?.updatedAt || j?.updated_at || null };
  const src = Array.isArray(j) ? j : j?.services ?? j?.components ?? j?.monitors ?? (j && typeof j === 'object' ? Object.fromEntries(Object.entries(j).filter(([k]) => !['days', 'incidents', 'updatedAt', 'title'].includes(k))) : []);
  const entries = Array.isArray(src) ? src.map((v, i) => [v?.key || v?.id || v?.name || String(i), v]) : Object.entries(src || {});
  for (const [key, raw] of entries) {
    const v = raw && typeof raw === 'object' ? raw : { status: raw };
    const days = j?.days?.[key];
    let history = null;
    let uptime = null;
    if (days && typeof days === 'object') {
      const keys = Object.keys(days).sort().slice(-HISTORY);
      history = keys.map((d) => (days[d].down > 0 ? 'down' : days[d].degraded > 0 ? 'degraded' : days[d].n > 0 ? 'up' : 'unknown'));
      const n = keys.reduce((a, d) => a + (days[d].n || 0), 0);
      const down = keys.reduce((a, d) => a + (days[d].down || 0), 0);
      if (n) uptime = Math.round((1 - down / n) * 10000) / 10000;
    }
    out.services.push({
      key: String(key),
      // own keys are often lower case ids: "app" → "App"
      name: String(v.name || v.title || (key.charAt(0).toUpperCase() + key.slice(1))),
      status: normStatus(v.status ?? v.state ?? v.up ?? v.ok),
      latency: Number.isFinite(v.latency ?? v.ping ?? v.responseTime) ? (v.latency ?? v.ping ?? v.responseTime) : null,
      code: Number.isFinite(v.code) ? v.code : null,
      message: v.message || v.error || null,
      since: v.since || null,
      uptime: Number.isFinite(v.uptime) ? (v.uptime > 1 ? v.uptime / 100 : v.uptime) : uptime,
      history,
    });
  }
  for (const i of Array.isArray(j?.incidents) ? j.incidents : []) {
    if (i && (i.resolved === true || /resolved|closed/i.test(i.status || ''))) continue;
    out.incidents.push({ title: String(i.title || i.name || i.message || ''), status: normStatus(i.severity || i.impact || i.status || 'degraded'), since: i.since || i.start || i.createdAt || null });
  }
  return out;
}

// ---- Statuspage.io -----------------------------------------------------------------------------
export function fromStatuspage(j) {
  const groups = new Map((j.components || []).filter((c) => c.group).map((c) => [c.id, c.name]));
  const out = { title: j.page?.name || '', services: [], incidents: [], updatedAt: j.page?.updated_at || null };
  for (const c of j.components || []) {
    if (c.group || /^visit /i.test(c.name)) continue; // groups themselves and "Visit … for more information"
    out.services.push({ key: c.id, name: c.name, group: groups.get(c.group_id) || null, status: normStatus(c.status), latency: null, message: null, since: c.updated_at || null, uptime: null, history: null });
  }
  for (const i of j.incidents || []) out.incidents.push({ title: i.name, status: normStatus(i.impact === 'none' ? 'degraded' : i.impact === 'critical' || i.impact === 'major' ? 'down' : 'degraded'), since: i.created_at || null });
  for (const m of j.scheduled_maintenances || []) if (m.status === 'in_progress') out.incidents.push({ title: m.name, status: 'maintenance', since: m.scheduled_for || null });
  return out;
}

export async function provider(settings) {
  const s = settings;
  let data;
  if (s.source === 'json') {
    const url = base(s.url);
    if (!url) return { needsSetup: true };
    const headers = s.authHeader ? { Authorization: String(s.authHeader).trim() } : {};
    data = fromJson(await cached(`status:json:${url}:${s.authHeader ? 'auth' : ''}`, 45, () => fetchJson(url, { timeout: 10000, headers })));
  } else if (s.source === 'statuspage') {
    const url = base(s.url).replace(/\/api\/v2\/summary\.json$/, '');
    if (!url) return { needsSetup: true };
    data = fromStatuspage(await cached(`status:sp:${url}`, 120, () => fetchJson(`${url}/api/v2/summary.json`, { timeout: 10000 })));
  } else {
    data = await kuma(s);
    if (!data) return { needsSetup: true };
  }
  // display names and hidden services
  const names = Object.fromEntries(list(s.names).map((x) => x.split('=').map((y) => y.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k.toLowerCase(), v]));
  const hide = new Set(list(s.hide).map((x) => x.toLowerCase()));
  data.services = data.services
    .filter((x) => !hide.has(x.key.toLowerCase()) && !hide.has(x.name.toLowerCase()))
    .map((x) => ({ ...x, name: names[x.key.toLowerCase()] || names[x.name.toLowerCase()] || x.name }));
  const problems = data.services.filter((x) => x.status === 'down' || x.status === 'degraded').length;
  return { ...data, problems, total: data.services.length };
}
